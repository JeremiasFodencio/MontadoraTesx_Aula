const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

if (!require('fs').existsSync(path.join(__dirname, 'data', 'usuarios.json'))) {
  console.log('Banco nao encontrado. Rodando seed automaticamente...');
  require('./seed');
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== AUTENTICACAO =====================
const sessoes = {}; // token -> { usuarioId, perfil, nome }

function auth(req, res, next) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token || !sessoes[token]) return res.status(401).json({ erro: 'Nao autenticado' });
  req.usuario = sessoes[token];
  next();
}

function perfil(...perfis) {
  return (req, res, next) => {
    if (req.usuario.perfil !== 'admin' && !perfis.includes(req.usuario.perfil)) {
      return res.status(403).json({ erro: 'Sem permissao para esta acao' });
    }
    next();
  };
}

function auditar(usuarioId, acao, entidade, entidadeId, detalhes = {}) {
  const lista = db.read('auditoria');
  lista.push({
    id: db.nextId('auditoria'),
    usuarioId, acao, entidade, entidadeId, detalhes,
    data: new Date().toISOString()
  });
  db.write('auditoria', lista);
}

app.post('/api/auth/login', (req, res) => {
  const { email, senha } = req.body;
  const u = db.read('usuarios').find(x => x.email === email && x.senha === senha);
  if (!u) return res.status(401).json({ erro: 'Credenciais invalidas' });
  const token = crypto.randomBytes(16).toString('hex');
  sessoes[token] = { usuarioId: u.id, perfil: u.perfil, nome: u.nome };
  res.json({ token, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil } });
});

app.post('/api/auth/logout', auth, (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  delete sessoes[token];
  res.json({ ok: true });
});

// ===================== FORNECEDORES =====================
app.get('/api/fornecedores', auth, (req, res) => res.json(db.read('fornecedores')));

app.post('/api/fornecedores', auth, perfil('estoque'), (req, res) => {
  const lista = db.read('fornecedores');
  const novo = { id: db.nextId('fornecedores'), ...req.body };
  lista.push(novo);
  db.write('fornecedores', lista);
  auditar(req.usuario.usuarioId, 'criar', 'fornecedor', novo.id, novo);
  res.status(201).json(novo);
});

// ===================== COMPONENTES =====================
app.get('/api/componentes', auth, (req, res) => {
  const componentes = db.read('componentes');
  const fornecedores = db.read('fornecedores');
  res.json(componentes.map(c => ({
    ...c,
    fornecedor: fornecedores.find(f => f.id === c.fornecedorId)?.nome || '-',
    emAlerta: c.saldo <= c.estoqueMinimo
  })));
});

app.post('/api/componentes', auth, perfil('estoque'), (req, res) => {
  const lista = db.read('componentes');
  const novo = { id: db.nextId('componentes'), saldo: 0, ...req.body };
  lista.push(novo);
  db.write('componentes', lista);
  auditar(req.usuario.usuarioId, 'criar', 'componente', novo.id, novo);
  res.status(201).json(novo);
});

// ===================== ESTOQUE =====================
app.get('/api/estoque/movimentacoes', auth, (req, res) => {
  const movs = db.read('movimentacoes').slice().reverse();
  const comps = db.read('componentes');
  res.json(movs.map(m => ({
    ...m,
    componente: comps.find(c => c.id === m.componenteId)?.descricao || '?'
  })));
});

app.post('/api/estoque/entrada', auth, perfil('estoque'), (req, res) => {
  const { componenteId, quantidade, numeroLote } = req.body;
  const qtd = Number(quantidade);
  if (!componenteId || !qtd || qtd <= 0) return res.status(400).json({ erro: 'Dados invalidos' });

  const componentes = db.read('componentes');
  const comp = componentes.find(c => c.id === Number(componenteId));
  if (!comp) return res.status(404).json({ erro: 'Componente nao encontrado' });

  comp.saldo += qtd;

  const lotes = db.read('lotes');
  const novoLote = {
    id: db.nextId('lotes'),
    componenteId: comp.id,
    numeroLote: numeroLote || `LOTE-${comp.codigo}-${Date.now()}`,
    quantidade: qtd,
    dataEntrada: new Date().toISOString()
  };
  lotes.push(novoLote);

  const movs = db.read('movimentacoes');
  movs.push({
    id: db.nextId('movimentacoes'),
    componenteId: comp.id, tipo: 'entrada', quantidade: qtd,
    motivo: `Entrada lote ${novoLote.numeroLote}`,
    data: new Date().toISOString(), usuarioId: req.usuario.usuarioId
  });

  db.write('componentes', componentes);
  db.write('lotes', lotes);
  db.write('movimentacoes', movs);
  auditar(req.usuario.usuarioId, 'entrada', 'estoque', comp.id, { qtd, lote: novoLote.numeroLote });
  res.status(201).json({ ok: true, saldoAtual: comp.saldo });
});

app.post('/api/estoque/saida', auth, perfil('estoque'), (req, res) => {
  const { componenteId, quantidade, motivo } = req.body;
  const qtd = Number(quantidade);
  if (!componenteId || !qtd || qtd <= 0) return res.status(400).json({ erro: 'Dados invalidos' });

  const componentes = db.read('componentes');
  const comp = componentes.find(c => c.id === Number(componenteId));
  if (!comp) return res.status(404).json({ erro: 'Componente nao encontrado' });
  if (comp.saldo < qtd) return res.status(400).json({ erro: 'Saldo insuficiente' });

  comp.saldo -= qtd;

  const lotes = db.read('lotes').filter(l => l.componenteId === comp.id && l.quantidade > 0).sort((a,b) => a.id - b.id);
  let falta = qtd;
  for (const lote of lotes) {
    if (falta <= 0) break;
    const usar = Math.min(lote.quantidade, falta);
    lote.quantidade -= usar;
    falta -= usar;
  }
  db.write('lotes', db.read('lotes').map(l => {
    const novo = lotes.find(x => x.id === l.id);
    return novo ? novo : l;
  }));

  const movs = db.read('movimentacoes');
  movs.push({
    id: db.nextId('movimentacoes'),
    componenteId: comp.id, tipo: 'saida', quantidade: qtd,
    motivo: motivo || 'Saida manual',
    data: new Date().toISOString(), usuarioId: req.usuario.usuarioId
  });
  db.write('componentes', componentes);
  db.write('movimentacoes', movs);
  auditar(req.usuario.usuarioId, 'saida', 'estoque', comp.id, { qtd, motivo });
  res.json({ ok: true, saldoAtual: comp.saldo });
});

// ===================== MODELOS =====================
app.get('/api/modelos', auth, (req, res) => {
  const modelos = db.read('modelos');
  const comps = db.read('componentes');
  res.json(modelos.map(m => ({
    ...m,
    componentesDetalhados: m.componentes.map(c => ({
      ...c,
      descricao: comps.find(x => x.id === c.componenteId)?.descricao || '?'
    }))
  })));
});

app.post('/api/modelos', auth, perfil('estoque', 'producao'), (req, res) => {
  const lista = db.read('modelos');
  const novo = { id: db.nextId('modelos'), ...req.body };
  lista.push(novo);
  db.write('modelos', lista);
  auditar(req.usuario.usuarioId, 'criar', 'modelo', novo.id, novo);
  res.status(201).json(novo);
});

// ===================== PRODUCAO =====================
function checarEstoqueOP(ordem) {
  const modelo = db.read('modelos').find(m => m.id === ordem.modeloId);
  const comps = db.read('componentes');
  const faltas = [];
  for (const item of modelo.componentes) {
    const comp = comps.find(c => c.id === item.componenteId);
    const necessario = item.quantidade * ordem.quantidade;
    if (!comp || comp.saldo < necessario) {
      faltas.push({
        componenteId: item.componenteId,
        descricao: comp?.descricao || '?',
        necessario,
        disponivel: comp?.saldo || 0
      });
    }
  }
  return faltas;
}

app.get('/api/producao/ordens', auth, (req, res) => {
  const ordens = db.read('ordensProducao');
  const modelos = db.read('modelos');
  res.json(ordens.map(o => ({
    ...o,
    modeloNome: modelos.find(m => m.id === o.modeloId)?.nome || '?'
  })));
});

app.post('/api/producao/ordens', auth, perfil('producao'), (req, res) => {
  const { modeloId, quantidade } = req.body;
  const qtd = Number(quantidade);
  if (!modeloId || !qtd || qtd <= 0) return res.status(400).json({ erro: 'Dados invalidos' });
  const modelo = db.read('modelos').find(m => m.id === Number(modeloId));
  if (!modelo) return res.status(404).json({ erro: 'Modelo nao encontrado' });

  const lista = db.read('ordensProducao');
  const nova = {
    id: db.nextId('ordensProducao'),
    modeloId: modelo.id,
    quantidade: qtd,
    status: 'planejada',
    dataCriacao: new Date().toISOString()
  };
  lista.push(nova);
  db.write('ordensProducao', lista);
  auditar(req.usuario.usuarioId, 'criar', 'ordemProducao', nova.id, nova);
  res.status(201).json(nova);
});

app.post('/api/producao/ordens/:id/liberar', auth, perfil('producao'), (req, res) => {
  const ordens = db.read('ordensProducao');
  const ordem = ordens.find(o => o.id === Number(req.params.id));
  if (!ordem) return res.status(404).json({ erro: 'Ordem nao encontrada' });
  if (ordem.status !== 'planejada') return res.status(400).json({ erro: 'Ordem precisa estar planejada' });

  const faltas = checarEstoqueOP(ordem);
  if (faltas.length > 0) {
    return res.status(400).json({
      erro: 'Estoque insuficiente para liberar a ordem',
      faltas
    });
  }
  ordem.status = 'liberada';
  db.write('ordensProducao', ordens);
  auditar(req.usuario.usuarioId, 'liberar', 'ordemProducao', ordem.id, {});
  res.json(ordem);
});

app.post('/api/producao/ordens/:id/iniciar', auth, perfil('producao'), (req, res) => {
  const ordens = db.read('ordensProducao');
  const ordem = ordens.find(o => o.id === Number(req.params.id));
  if (!ordem) return res.status(404).json({ erro: 'Ordem nao encontrada' });
  if (ordem.status !== 'liberada') return res.status(400).json({ erro: 'Ordem precisa estar liberada' });

  const modelo = db.read('modelos').find(m => m.id === ordem.modeloId);
  const comps = db.read('componentes');
  const lotes = db.read('lotes');
  const movs = db.read('movimentacoes');
  const veiculos = db.read('veiculos');

  let proxIdVeiculo = veiculos.length ? Math.max(...veiculos.map(v => v.id)) + 1 : 1;
  let proxIdMov = movs.length ? Math.max(...movs.map(m => m.id)) + 1 : 1;

  try {
    for (let i = 0; i < ordem.quantidade; i++) {
      const lotesUtilizados = [];
      for (const item of modelo.componentes) {
        const comp = comps.find(c => c.id === item.componenteId);
        if (comp.saldo < item.quantidade) throw new Error(`Saldo insuficiente de ${comp.descricao}`);
        comp.saldo -= item.quantidade;

        let falta = item.quantidade;
        const disponiveis = lotes
          .filter(l => l.componenteId === comp.id && l.quantidade > 0)
          .sort((a, b) => a.id - b.id);
        for (const lote of disponiveis) {
          if (falta <= 0) break;
          const usar = Math.min(lote.quantidade, falta);
          lote.quantidade -= usar;
          falta -= usar;
          lotesUtilizados.push({ componenteId: comp.id, loteId: lote.id, quantidade: usar });
        }
        if (falta > 0) throw new Error(`Lotes insuficientes de ${comp.descricao}`);

        movs.push({
          id: proxIdMov++,
          componenteId: comp.id, tipo: 'saida', quantidade: item.quantidade,
          motivo: `Consumo OP #${ordem.id}`,
          data: new Date().toISOString(), usuarioId: req.usuario.usuarioId
        });
      }

      const chassi = 'TESX' + Date.now().toString().slice(-8) + String(proxIdVeiculo).padStart(3, '0');
      veiculos.push({
        id: proxIdVeiculo++,
        numeroChassi: chassi,
        modeloId: ordem.modeloId,
        ordemProducaoId: ordem.id,
        lotesUtilizados,
        status: 'em_montagem',
        dataCriacao: new Date().toISOString()
      });
    }
  } catch (err) {
    return res.status(400).json({ erro: err.message });
  }

  ordem.status = 'em_montagem';
  db.write('componentes', comps);
  db.write('lotes', lotes);
  db.write('movimentacoes', movs);
  db.write('veiculos', veiculos);
  db.write('ordensProducao', ordens);
  auditar(req.usuario.usuarioId, 'iniciar', 'ordemProducao', ordem.id, {});
  res.json({ ok: true, ordem });
});

app.post('/api/producao/ordens/:id/concluir', auth, perfil('producao'), (req, res) => {
  const ordens = db.read('ordensProducao');
  const ordem = ordens.find(o => o.id === Number(req.params.id));
  if (!ordem) return res.status(404).json({ erro: 'Ordem nao encontrada' });
  if (ordem.status !== 'em_montagem') return res.status(400).json({ erro: 'Ordem nao esta em montagem' });

  const veiculos = db.read('veiculos');
  veiculos.forEach(v => {
    if (v.ordemProducaoId === ordem.id && v.status === 'em_montagem') {
      v.status = 'aguardando_inspecao';
    }
  });
  ordem.status = 'concluida';
  db.write('veiculos', veiculos);
  db.write('ordensProducao', ordens);
  auditar(req.usuario.usuarioId, 'concluir', 'ordemProducao', ordem.id, {});
  res.json({ ok: true, ordem });
});

// ===================== VEICULOS =====================
app.get('/api/veiculos', auth, (req, res) => {
  const veiculos = db.read('veiculos');
  const modelos = db.read('modelos');
  const comps = db.read('componentes');
  const lotes = db.read('lotes');
  res.json(veiculos.map(v => ({
    ...v,
    modeloNome: modelos.find(m => m.id === v.modeloId)?.nome || '?',
    rastreabilidade: v.lotesUtilizados.map(l => ({
      componente: comps.find(c => c.id === l.componenteId)?.descricao || '?',
      lote: lotes.find(x => x.id === l.loteId)?.numeroLote || '?',
      quantidade: l.quantidade
    }))
  })));
});

// ===================== QUALIDADE =====================
app.get('/api/qualidade/inspecoes', auth, (req, res) => {
  const insp = db.read('inspecoes').slice().reverse();
  const veiculos = db.read('veiculos');
  res.json(insp.map(i => ({
    ...i,
    chassi: veiculos.find(v => v.id === i.veiculoId)?.numeroChassi || '?'
  })));
});

app.post('/api/qualidade/inspecoes', auth, perfil('qualidade'), (req, res) => {
  const { veiculoId, resultado, observacoes } = req.body;
  if (!veiculoId || !['aprovado', 'reprovado'].includes(resultado)) {
    return res.status(400).json({ erro: 'Dados invalidos' });
  }
  const veiculos = db.read('veiculos');
  const v = veiculos.find(x => x.id === Number(veiculoId));
  if (!v) return res.status(404).json({ erro: 'Veiculo nao encontrado' });
  if (v.status !== 'aguardando_inspecao') {
    return res.status(400).json({ erro: 'Veiculo nao esta aguardando inspecao' });
  }

  v.status = resultado;
  const inspecoes = db.read('inspecoes');
  const nova = {
    id: db.nextId('inspecoes'),
    veiculoId: v.id,
    resultado,
    observacoes: observacoes || '',
    data: new Date().toISOString(),
    inspetorId: req.usuario.usuarioId
  };
  inspecoes.push(nova);
  db.write('veiculos', veiculos);
  db.write('inspecoes', inspecoes);
  auditar(req.usuario.usuarioId, resultado, 'inspecao', nova.id, { veiculoId: v.id });
  res.status(201).json(nova);
});

// ===================== CLIENTES =====================
app.get('/api/clientes', auth, (req, res) => res.json(db.read('clientes')));

app.post('/api/clientes', auth, perfil('vendas'), (req, res) => {
  const lista = db.read('clientes');
  const novo = { id: db.nextId('clientes'), ...req.body };
  lista.push(novo);
  db.write('clientes', lista);
  auditar(req.usuario.usuarioId, 'criar', 'cliente', novo.id, novo);
  res.status(201).json(novo);
});

// ===================== VENDAS =====================
const LIMITE_DESCONTO_PCT = 5;

app.get('/api/vendas/pedidos', auth, (req, res) => {
  const pedidos = db.read('pedidosVenda');
  const clientes = db.read('clientes');
  const veiculos = db.read('veiculos');
  const modelos = db.read('modelos');
  res.json(pedidos.map(p => {
    const v = veiculos.find(x => x.id === p.veiculoId);
    const m = v ? modelos.find(x => x.id === v.modeloId) : null;
    return {
      ...p,
      clienteNome: clientes.find(c => c.id === p.clienteId)?.nome || '?',
      chassi: v?.numeroChassi || '?',
      modeloNome: m?.nome || '?'
    };
  }));
});

app.post('/api/vendas/pedidos', auth, perfil('vendas'), (req, res) => {
  const { clienteId, veiculoId, descontoPct } = req.body;
  const veiculos = db.read('veiculos');
  const v = veiculos.find(x => x.id === Number(veiculoId));
  if (!v) return res.status(404).json({ erro: 'Veiculo nao encontrado' });
  if (v.status !== 'aprovado') return res.status(400).json({ erro: 'Veiculo nao esta aprovado pela qualidade' });

  const modelo = db.read('modelos').find(m => m.id === v.modeloId);
  const pct = Number(descontoPct || 0);
  if (pct < 0 || pct > 100) return res.status(400).json({ erro: 'Desconto invalido' });

  const precisaAprovacao = pct > LIMITE_DESCONTO_PCT;
  const pedidos = db.read('pedidosVenda');
  const novo = {
    id: db.nextId('pedidosVenda'),
    clienteId: Number(clienteId),
    veiculoId: v.id,
    precoBase: modelo.preco,
    descontoPct: pct,
    descontoValor: +(modelo.preco * pct / 100).toFixed(2),
    valorFinal: +(modelo.preco * (1 - pct / 100)).toFixed(2),
    status: precisaAprovacao ? 'aguardando_aprovacao' : 'aprovado',
    data: new Date().toISOString(),
    aprovadoPor: precisaAprovacao ? null : req.usuario.usuarioId
  };
  pedidos.push(novo);
  db.write('pedidosVenda', pedidos);
  auditar(req.usuario.usuarioId, 'criar', 'pedidoVenda', novo.id, { precisaAprovacao, pct });
  res.status(201).json(novo);
});

app.post('/api/vendas/pedidos/:id/aprovar', auth, perfil('admin'), (req, res) => {
  const pedidos = db.read('pedidosVenda');
  const p = pedidos.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ erro: 'Pedido nao encontrado' });
  if (p.status !== 'aguardando_aprovacao') return res.status(400).json({ erro: 'Pedido nao aguarda aprovacao' });
  p.status = 'aprovado';
  p.aprovadoPor = req.usuario.usuarioId;
  db.write('pedidosVenda', pedidos);
  auditar(req.usuario.usuarioId, 'aprovar', 'pedidoVenda', p.id, {});
  res.json(p);
});

app.post('/api/vendas/pedidos/:id/entregar', auth, perfil('vendas'), (req, res) => {
  const pedidos = db.read('pedidosVenda');
  const p = pedidos.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).json({ erro: 'Pedido nao encontrado' });
  if (p.status !== 'aprovado') return res.status(400).json({ erro: 'Pedido precisa estar aprovado' });

  const veiculos = db.read('veiculos');
  const v = veiculos.find(x => x.id === p.veiculoId);
  if (!v) return res.status(404).json({ erro: 'Veiculo nao encontrado' });

  v.status = 'vendido';
  p.status = 'entregue';
  p.dataEntrega = new Date().toISOString();
  db.write('veiculos', veiculos);
  db.write('pedidosVenda', pedidos);
  auditar(req.usuario.usuarioId, 'entregar', 'pedidoVenda', p.id, { veiculoId: v.id });
  res.json(p);
});

// ===================== RELATORIOS =====================
app.get('/api/relatorios', auth, (req, res) => {
  const comps = db.read('componentes');
  const ordens = db.read('ordensProducao');
  const veiculos = db.read('veiculos');
  const inspecoes = db.read('inspecoes');
  const pedidos = db.read('pedidosVenda');

  res.json({
    estoque: {
      totalItens: comps.length,
      itensEmAlerta: comps.filter(c => c.saldo <= c.estoqueMinimo).map(c => ({
        codigo: c.codigo, descricao: c.descricao, saldo: c.saldo, minimo: c.estoqueMinimo
      })),
      valorTotalUnidades: comps.reduce((s, c) => s + c.saldo, 0)
    },
    producao: {
      ordensPorStatus: ordens.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1; return acc;
      }, {}),
      veiculosPorStatus: veiculos.reduce((acc, v) => {
        acc[v.status] = (acc[v.status] || 0) + 1; return acc;
      }, {})
    },
    qualidade: {
      aprovadas: inspecoes.filter(i => i.resultado === 'aprovado').length,
      reprovadas: inspecoes.filter(i => i.resultado === 'reprovado').length
    },
    vendas: {
      totalPedidos: pedidos.length,
      entregues: pedidos.filter(p => p.status === 'entregue').length,
      receitaTotal: pedidos.filter(p => p.status === 'entregue').reduce((s, p) => s + p.valorFinal, 0)
    }
  });
});

// ===================== AUDITORIA =====================
app.get('/api/auditoria', auth, perfil('admin'), (req, res) => {
  const lista = db.read('auditoria').slice().reverse().slice(0, 200);
  const usuarios = db.read('usuarios');
  res.json(lista.map(a => ({
    ...a,
    usuarioNome: usuarios.find(u => u.id === a.usuarioId)?.nome || '?'
  })));
});

// ===================== START =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Montadora Tesx rodando em http://localhost:${PORT}`);
  console.log('Login admin: admin@tesx.com / admin123');
});