const API = '';
let token = localStorage.getItem('token');
let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');

// ---------- helpers ----------
async function apiFetch(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      ...(opts.headers || {})
    }
  });
  if (r.status === 401) { doLogout(); throw new Error('Sessao expirada'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.erro || 'Erro na requisicao');
    err.faltas = data.faltas;
    throw err;
  }
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function badge(status) {
  const map = {
    planejada: 'badge-gray', liberada: 'badge-blue', em_montagem: 'badge-yellow',
    concluida: 'badge-green', aguardando_inspecao: 'badge-yellow',
    aprovado: 'badge-green', reprovado: 'badge-red', vendido: 'badge-blue',
    aguardando_aprovacao: 'badge-yellow', entregue: 'badge-green'
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status}</span>`;
}

function fmtDinheiro(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Login ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    if (!r.ok) throw new Error('Credenciais invalidas');
    const data = await r.json();
    token = data.token;
    usuario = data.usuario;
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    bootApp();
  } catch (err) {
    document.getElementById('login-erro').textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', doLogout);

function doLogout() {
  if (token) fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  token = null; usuario = null;
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

// ---------- Navegacao ----------
const SECOES = [
  { id: 'dashboard',    label: 'Dashboard',    render: renderDashboard },
  { id: 'componentes',  label: 'Componentes',  render: renderComponentes },
  { id: 'fornecedores', label: 'Fornecedores', render: renderFornecedores },
  { id: 'estoque',      label: 'Estoque',      render: renderEstoque },
  { id: 'modelos',      label: 'Modelos',      render: renderModelos },
  { id: 'producao',     label: 'Producao',     render: renderProducao },
  { id: 'qualidade',    label: 'Qualidade',    render: renderQualidade },
  { id: 'veiculos',     label: 'Veiculos',     render: renderVeiculos },
  { id: 'clientes',     label: 'Clientes',     render: renderClientes },
  { id: 'vendas',       label: 'Vendas',       render: renderVendas },
  { id: 'relatorios',   label: 'Relatorios',   render: renderRelatorios },
  { id: 'auditoria',    label: 'Auditoria',    render: renderAuditoria }
];

function bootApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  document.getElementById('user-info').textContent = `${usuario.nome} (${usuario.perfil})`;
  const nav = document.getElementById('tabs');
  nav.innerHTML = SECOES.map(s => `<a href="#${s.id}" data-sec="${s.id}">${s.label}</a>`).join('');
  window.addEventListener('hashchange', navigate);
  navigate();
}

function navigate() {
  const id = location.hash.slice(1) || 'dashboard';
  const sec = SECOES.find(s => s.id === id) || SECOES[0];
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.sec === sec.id));
  document.getElementById('content').innerHTML = '<p>Carregando...</p>';
  sec.render().catch(err => {
    document.getElementById('content').innerHTML = `<div class="erro-box">${err.message}</div>`;
  });
}

// ---------- Dashboard ----------
async function renderDashboard() {
  const r = await apiFetch('/api/relatorios');
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Dashboard</h2>
    <div class="grid">
      <div class="stat"><div class="label">Itens em estoque</div><div class="value">${r.estoque.valorTotalUnidades}</div></div>
      <div class="stat" style="border-left-color:#dc2626"><div class="label">Itens em alerta</div><div class="value">${r.estoque.itensEmAlerta.length}</div></div>
      <div class="stat"><div class="label">Ordens de producao</div><div class="value">${Object.values(r.producao.ordensPorStatus).reduce((a,b)=>a+b,0)}</div></div>
      <div class="stat" style="border-left-color:#059669"><div class="label">Veiculos aprovados</div><div class="value">${(r.producao.veiculosPorStatus.aprovado || 0)}</div></div>
      <div class="stat" style="border-left-color:#059669"><div class="label">Receita entregue</div><div class="value">${fmtDinheiro(r.vendas.receitaTotal)}</div></div>
      <div class="stat"><div class="label">Inspecoes OK / NOK</div><div class="value">${r.qualidade.aprovadas} / ${r.qualidade.reprovadas}</div></div>
    </div>
    <h3>Itens em alerta de estoque</h3>
    ${r.estoque.itensEmAlerta.length === 0
      ? '<div class="card">Nenhum item em alerta.</div>'
      : `<table><thead><tr><th>Codigo</th><th>Descricao</th><th>Saldo</th><th>Minimo</th></tr></thead><tbody>
         ${r.estoque.itensEmAlerta.map(i => `<tr><td>${i.codigo}</td><td>${i.descricao}</td><td>${i.saldo}</td><td>${i.minimo}</td></tr>`).join('')}
         </tbody></table>`}`;
}

// ---------- Componentes ----------
async function renderComponentes() {
  const comps = await apiFetch('/api/componentes');
  const fornecedores = await apiFetch('/api/fornecedores');
  const content = document.getElementById('content');
  content.innerHTML = `
    <h2>Componentes</h2>
    <div class="card">
      <h3>Novo componente</h3>
      <form id="form-comp" class="form-row">
        <div><label>Codigo</label><input name="codigo" required></div>
        <div><label>Descricao</label><input name="descricao" required></div>
        <div><label>Fornecedor</label>
          <select name="fornecedorId" required>
            ${fornecedores.map(f => `<option value="${f.id}">${f.nome}</option>`).join('')}
          </select>
        </div>
        <div><label>Estoque minimo</label><input name="estoqueMinimo" type="number" min="0" value="5" required></div>
        <div><label>Unidade</label><input name="unidade" value="un" required></div>
        <button class="btn" type="submit">Cadastrar</button>
      </form>
    </div>
    <table>
      <thead><tr><th>Codigo</th><th>Descricao</th><th>Fornecedor</th><th>Saldo</th><th>Minimo</th><th>Status</th></tr></thead>
      <tbody>
        ${comps.map(c => `<tr>
          <td>${c.codigo}</td><td>${c.descricao}</td><td>${c.fornecedor}</td>
          <td>${c.saldo}</td><td>${c.estoqueMinimo}</td>
          <td>${c.emAlerta ? '<span class="badge badge-red">Alerta</span>' : '<span class="badge badge-green">OK</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('form-comp').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/componentes', {
        method: 'POST',
        body: JSON.stringify({
          codigo: fd.get('codigo'), descricao: fd.get('descricao'),
          fornecedorId: Number(fd.get('fornecedorId')),
          estoqueMinimo: Number(fd.get('estoqueMinimo')),
          unidade: fd.get('unidade')
        })
      });
      navigate();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Fornecedores ----------
async function renderFornecedores() {
  const lista = await apiFetch('/api/fornecedores');
  document.getElementById('content').innerHTML = `
    <h2>Fornecedores</h2>
    <div class="card">
      <h3>Novo fornecedor</h3>
      <form id="form-forn" class="form-row">
        <div><label>Nome</label><input name="nome" required></div>
        <div><label>CNPJ</label><input name="cnpj" required></div>
        <div><label>Contato</label><input name="contato" required></div>
        <div><label>Prazo (dias)</label><input name="prazoEntrega" type="number" min="1" value="7" required></div>
        <button class="btn" type="submit">Cadastrar</button>
      </form>
    </div>
    <table>
      <thead><tr><th>Nome</th><th>CNPJ</th><th>Contato</th><th>Prazo entrega</th></tr></thead>
      <tbody>${lista.map(f => `<tr><td>${f.nome}</td><td>${f.cnpj}</td><td>${f.contato}</td><td>${f.prazoEntrega} dias</td></tr>`).join('')}</tbody>
    </table>`;
  document.getElementById('form-forn').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/fornecedores', { method: 'POST', body: JSON.stringify({
        nome: fd.get('nome'), cnpj: fd.get('cnpj'), contato: fd.get('contato'),
        prazoEntrega: Number(fd.get('prazoEntrega'))
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Estoque ----------
async function renderEstoque() {
  const comps = await apiFetch('/api/componentes');
  const movs = await apiFetch('/api/estoque/movimentacoes');
  document.getElementById('content').innerHTML = `
    <h2>Estoque</h2>
    <div class="card">
      <h3>Entrada de componentes</h3>
      <form id="form-entrada" class="form-row">
        <div><label>Componente</label><select name="componenteId" required>
          ${comps.map(c => `<option value="${c.id}">${c.codigo} - ${c.descricao}</option>`).join('')}
        </select></div>
        <div><label>Quantidade</label><input type="number" name="quantidade" min="1" required></div>
        <div><label>Numero do lote</label><input name="numeroLote" placeholder="opcional"></div>
        <button class="btn" type="submit">Registrar entrada</button>
      </form>
    </div>
    <div class="card">
      <h3>Saida manual de estoque</h3>
      <form id="form-saida" class="form-row">
        <div><label>Componente</label><select name="componenteId" required>
          ${comps.map(c => `<option value="${c.id}">${c.codigo} - ${c.descricao} (saldo ${c.saldo})</option>`).join('')}
        </select></div>
        <div><label>Quantidade</label><input type="number" name="quantidade" min="1" required></div>
        <div><label>Motivo</label><input name="motivo" value="Ajuste manual"></div>
        <button class="btn btn-warn" type="submit">Registrar saida</button>
      </form>
    </div>
    <h3>Movimentacoes recentes</h3>
    <table>
      <thead><tr><th>Data</th><th>Componente</th><th>Tipo</th><th>Qtd</th><th>Motivo</th></tr></thead>
      <tbody>${movs.slice(0, 50).map(m => `<tr>
        <td>${new Date(m.data).toLocaleString('pt-BR')}</td>
        <td>${m.componente}</td>
        <td>${m.tipo === 'entrada' ? '<span class="badge badge-green">entrada</span>' : '<span class="badge badge-red">saida</span>'}</td>
        <td>${m.quantidade}</td><td>${m.motivo}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  document.getElementById('form-entrada').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/estoque/entrada', { method: 'POST', body: JSON.stringify({
        componenteId: Number(fd.get('componenteId')),
        quantidade: Number(fd.get('quantidade')),
        numeroLote: fd.get('numeroLote') || null
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
  document.getElementById('form-saida').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/estoque/saida', { method: 'POST', body: JSON.stringify({
        componenteId: Number(fd.get('componenteId')),
        quantidade: Number(fd.get('quantidade')),
        motivo: fd.get('motivo')
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Modelos ----------
async function renderModelos() {
  const modelos = await apiFetch('/api/modelos');
  const comps = await apiFetch('/api/componentes');
  document.getElementById('content').innerHTML = `
    <h2>Modelos de veiculo</h2>
    <div class="card">
      <h3>Novo modelo</h3>
      <form id="form-modelo">
        <div class="form-row">
          <div><label>Nome</label><input name="nome" required></div>
          <div><label>Preco base (R$)</label><input name="preco" type="number" min="1" required></div>
        </div>
        <h3>Componentes necessarios (por unidade)</h3>
        <div id="lista-comp-modelo"></div>
        <button type="button" class="btn btn-sec" id="add-comp-btn">+ Adicionar componente</button>
        <button class="btn" type="submit" style="margin-left:8px">Salvar modelo</button>
      </form>
    </div>
    ${modelos.map(m => `
      <div class="card">
        <h3>${m.nome} — ${fmtDinheiro(m.preco)}</h3>
        <table>
          <thead><tr><th>Componente</th><th>Qtd por unidade</th></tr></thead>
          <tbody>${m.componentesDetalhados.map(c => `<tr><td>${c.descricao}</td><td>${c.quantidade}</td></tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}`;

  const lista = document.getElementById('lista-comp-modelo');
  function addCompRow() {
    const row = el(`<div class="form-row">
      <div><label>Componente</label>
        <select class="comp-select" required>
          ${comps.map(c => `<option value="${c.id}">${c.codigo} - ${c.descricao}</option>`).join('')}
        </select>
      </div>
      <div><label>Quantidade</label><input class="comp-qtd" type="number" min="1" value="1" required></div>
      <button type="button" class="btn btn-danger btn-sm" onclick="this.closest('.form-row').remove()">Remover</button>
    </div>`);
    lista.appendChild(row);
  }
  document.getElementById('add-comp-btn').addEventListener('click', addCompRow);
  addCompRow();

  document.getElementById('form-modelo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const componentes = [...lista.querySelectorAll('.form-row')].map(r => ({
      componenteId: Number(r.querySelector('.comp-select').value),
      quantidade: Number(r.querySelector('.comp-qtd').value)
    }));
    try {
      await apiFetch('/api/modelos', { method: 'POST', body: JSON.stringify({
        nome: fd.get('nome'), preco: Number(fd.get('preco')), componentes
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Producao ----------
async function renderProducao() {
  const ordens = await apiFetch('/api/producao/ordens');
  const modelos = await apiFetch('/api/modelos');
  document.getElementById('content').innerHTML = `
    <h2>Producao</h2>
    <div class="card">
      <h3>Nova ordem de producao</h3>
      <form id="form-op" class="form-row">
        <div><label>Modelo</label><select name="modeloId" required>
          ${modelos.map(m => `<option value="${m.id}">${m.nome}</option>`).join('')}
        </select></div>
        <div><label>Quantidade</label><input type="number" name="quantidade" min="1" value="5" required></div>
        <button class="btn" type="submit">Criar OP</button>
      </form>
    </div>
    <table>
      <thead><tr><th>#</th><th>Modelo</th><th>Qtd</th><th>Status</th><th>Acoes</th></tr></thead>
      <tbody>
        ${ordens.map(o => `<tr>
          <td>${o.id}</td><td>${o.modeloNome}</td><td>${o.quantidade}</td>
          <td>${badge(o.status)}</td>
          <td>
            ${o.status === 'planejada' ? `<button class="btn btn-sm" data-acao="liberar" data-id="${o.id}">Liberar</button>` : ''}
            ${o.status === 'liberada' ? `<button class="btn btn-sm btn-warn" data-acao="iniciar" data-id="${o.id}">Iniciar montagem</button>` : ''}
            ${o.status === 'em_montagem' ? `<button class="btn btn-sm btn-sec" data-acao="concluir" data-id="${o.id}">Concluir</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  document.getElementById('form-op').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/producao/ordens', { method: 'POST', body: JSON.stringify({
        modeloId: Number(fd.get('modeloId')), quantidade: Number(fd.get('quantidade'))
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });

  document.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const acao = btn.dataset.acao;
      const id = btn.dataset.id;
      try {
        await apiFetch(`/api/producao/ordens/${id}/${acao}`, { method: 'POST' });
        navigate();
      } catch (err) {
        if (err.faltas) {
          alert('Estoque insuficiente:\n' + err.faltas.map(f => `- ${f.descricao}: necessario ${f.necessario}, disponivel ${f.disponivel}`).join('\n'));
        } else alert(err.message);
      }
    });
  });
}

// ---------- Qualidade ----------
async function renderQualidade() {
  const veiculos = await apiFetch('/api/veiculos');
  const inspecoes = await apiFetch('/api/qualidade/inspecoes');
  const pendentes = veiculos.filter(v => v.status === 'aguardando_inspecao');
  document.getElementById('content').innerHTML = `
    <h2>Controle de qualidade</h2>
    <h3>Veiculos aguardando inspecao</h3>
    ${pendentes.length === 0 ? '<div class="card">Nenhum veiculo pendente.</div>' : `
      <table>
        <thead><tr><th>Chassi</th><th>Modelo</th><th>Inspecionar</th></tr></thead>
        <tbody>${pendentes.map(v => `<tr>
          <td>${v.numeroChassi}</td><td>${v.modeloNome}</td>
          <td>
            <button class="btn btn-sm" data-id="${v.id}" data-res="aprovado">Aprovar</button>
            <button class="btn btn-sm btn-danger" data-id="${v.id}" data-res="reprovado">Reprovar</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>`}
    <h3>Historico de inspecoes</h3>
    <table>
      <thead><tr><th>Data</th><th>Chassi</th><th>Resultado</th><th>Observacoes</th></tr></thead>
      <tbody>${inspecoes.map(i => `<tr>
        <td>${new Date(i.data).toLocaleString('pt-BR')}</td>
        <td>${i.chassi}</td>
        <td>${badge(i.resultado)}</td>
        <td>${i.observacoes || '-'}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  document.querySelectorAll('[data-res]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const obs = prompt('Observacoes (opcional):') || '';
      try {
        await apiFetch('/api/qualidade/inspecoes', { method: 'POST', body: JSON.stringify({
          veiculoId: Number(btn.dataset.id),
          resultado: btn.dataset.res,
          observacoes: obs
        })});
        navigate();
      } catch (err) { alert(err.message); }
    });
  });
}

// ---------- Veiculos ----------
async function renderVeiculos() {
  const veiculos = await apiFetch('/api/veiculos');
  document.getElementById('content').innerHTML = `
    <h2>Veiculos</h2>
    <table>
      <thead><tr><th>Chassi</th><th>Modelo</th><th>OP</th><th>Status</th><th>Rastreabilidade</th></tr></thead>
      <tbody>${veiculos.map(v => `<tr>
        <td>${v.numeroChassi}</td><td>${v.modeloNome}</td><td>#${v.ordemProducaoId}</td>
        <td>${badge(v.status)}</td>
        <td>
          <details>
            <summary>${v.rastreabilidade.length} lote(s)</summary>
            <ul>${v.rastreabilidade.map(r => `<li>${r.componente}: lote ${r.lote} (${r.quantidade})</li>`).join('')}</ul>
          </details>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

// ---------- Clientes ----------
async function renderClientes() {
  const lista = await apiFetch('/api/clientes');
  document.getElementById('content').innerHTML = `
    <h2>Clientes</h2>
    <div class="card">
      <h3>Novo cliente</h3>
      <form id="form-cli" class="form-row">
        <div><label>Nome</label><input name="nome" required></div>
        <div><label>Documento</label><input name="documento" required></div>
        <div><label>Tipo</label><select name="tipo"><option value="pf">PF</option><option value="pj">PJ</option></select></div>
        <div><label>Email</label><input name="email" type="email" required></div>
        <div><label>Telefone</label><input name="telefone" required></div>
        <button class="btn" type="submit">Cadastrar</button>
      </form>
    </div>
    <table>
      <thead><tr><th>Nome</th><th>Documento</th><th>Tipo</th><th>Email</th><th>Telefone</th></tr></thead>
      <tbody>${lista.map(c => `<tr><td>${c.nome}</td><td>${c.documento}</td><td>${c.tipo.toUpperCase()}</td><td>${c.email}</td><td>${c.telefone}</td></tr>`).join('')}</tbody>
    </table>`;
  document.getElementById('form-cli').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/clientes', { method: 'POST', body: JSON.stringify({
        nome: fd.get('nome'), documento: fd.get('documento'), tipo: fd.get('tipo'),
        email: fd.get('email'), telefone: fd.get('telefone')
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
}

// ---------- Vendas ----------
async function renderVendas() {
  const pedidos = await apiFetch('/api/vendas/pedidos');
  const clientes = await apiFetch('/api/clientes');
  const veiculos = await apiFetch('/api/veiculos');
  const disponiveis = veiculos.filter(v => v.status === 'aprovado');
  document.getElementById('content').innerHTML = `
    <h2>Vendas</h2>
    <div class="card">
      <h3>Novo pedido de venda</h3>
      <form id="form-pedido" class="form-row">
        <div><label>Cliente</label><select name="clienteId" required>
          ${clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
        </select></div>
        <div><label>Veiculo aprovado</label><select name="veiculoId" required>
          ${disponiveis.length === 0 ? '<option value="">(nenhum veiculo aprovado)</option>' :
            disponiveis.map(v => `<option value="${v.id}">${v.numeroChassi} - ${v.modeloNome}</option>`).join('')}
        </select></div>
        <div><label>Desconto (%)</label><input type="number" name="descontoPct" min="0" max="100" value="0" step="0.1"></div>
        <button class="btn" type="submit">Criar pedido</button>
      </form>
      <p class="detalhes" style="margin-top:8px">Descontos acima de 5% exigem aprovacao do administrador.</p>
    </div>
    <table>
      <thead><tr><th>#</th><th>Cliente</th><th>Veiculo</th><th>Valor</th><th>Desconto</th><th>Status</th><th>Acoes</th></tr></thead>
      <tbody>${pedidos.map(p => `<tr>
        <td>${p.id}</td><td>${p.clienteNome}</td><td>${p.chassi}</td>
        <td>${fmtDinheiro(p.valorFinal)}</td><td>${p.descontoPct}%</td>
        <td>${badge(p.status)}</td>
        <td>
          ${p.status === 'aguardando_aprovacao' && usuario.perfil === 'admin'
            ? `<button class="btn btn-sm btn-warn" data-aprovar="${p.id}">Aprovar</button>` : ''}
          ${p.status === 'aprovado' ? `<button class="btn btn-sm" data-entregar="${p.id}">Entregar</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;

  document.getElementById('form-pedido').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch('/api/vendas/pedidos', { method: 'POST', body: JSON.stringify({
        clienteId: Number(fd.get('clienteId')),
        veiculoId: Number(fd.get('veiculoId')),
        descontoPct: Number(fd.get('descontoPct'))
      })});
      navigate();
    } catch (err) { alert(err.message); }
  });
  document.querySelectorAll('[data-aprovar]').forEach(b => b.addEventListener('click', async () => {
    try { await apiFetch(`/api/vendas/pedidos/${b.dataset.aprovar}/aprovar`, { method: 'POST' }); navigate(); }
    catch (err) { alert(err.message); }
  }));
  document.querySelectorAll('[data-entregar]').forEach(b => b.addEventListener('click', async () => {
    try { await apiFetch(`/api/vendas/pedidos/${b.dataset.entregar}/entregar`, { method: 'POST' }); navigate(); }
    catch (err) { alert(err.message); }
  }));
}

// ---------- Relatorios ----------
async function renderRelatorios() {
  const r = await apiFetch('/api/relatorios');
  document.getElementById('content').innerHTML = `
    <h2>Relatorios</h2>
    <div class="grid">
      <div class="stat"><div class="label">Itens em alerta</div><div class="value">${r.estoque.itensEmAlerta.length}</div></div>
      <div class="stat"><div class="label">Inspecoes aprovadas</div><div class="value">${r.qualidade.aprovadas}</div></div>
      <div class="stat"><div class="label">Inspecoes reprovadas</div><div class="value">${r.qualidade.reprovadas}</div></div>
      <div class="stat"><div class="label">Pedidos entregues</div><div class="value">${r.vendas.entregues}</div></div>
      <div class="stat" style="border-left-color:#059669"><div class="label">Receita total</div><div class="value">${fmtDinheiro(r.vendas.receitaTotal)}</div></div>
    </div>
    <h3>Ordens de producao por status</h3>
    <table><thead><tr><th>Status</th><th>Quantidade</th></tr></thead>
      <tbody>${Object.entries(r.producao.ordensPorStatus).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') || '<tr><td colspan=2>Sem ordens</td></tr>'}</tbody>
    </table>
    <h3>Veiculos por status</h3>
    <table><thead><tr><th>Status</th><th>Quantidade</th></tr></thead>
      <tbody>${Object.entries(r.producao.veiculosPorStatus).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') || '<tr><td colspan=2>Sem veiculos</td></tr>'}</tbody>
    </table>`;
}

// ---------- Auditoria ----------
async function renderAuditoria() {
  try {
    const lista = await apiFetch('/api/auditoria');
    document.getElementById('content').innerHTML = `
      <h2>Auditoria</h2>
      <table>
        <thead><tr><th>Data</th><th>Usuario</th><th>Acao</th><th>Entidade</th><th>ID</th></tr></thead>
        <tbody>${lista.map(a => `<tr>
          <td>${new Date(a.data).toLocaleString('pt-BR')}</td>
          <td>${a.usuarioNome}</td><td>${a.acao}</td><td>${a.entidade}</td><td>${a.entidadeId}</td>
        </tr>`).join('') || '<tr><td colspan=5>Sem registros</td></tr>'}</tbody>
      </table>`;
  } catch (err) {
    document.getElementById('content').innerHTML = `<div class="erro-box">${err.message}</div>`;
  }
}

// ---------- Boot ----------
if (token && usuario) bootApp();