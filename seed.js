const db = require('./db');

const usuarios = [
  { id: 1, nome: 'Administrador', email: 'admin@tesx.com',     senha: 'admin123',     perfil: 'admin' },
  { id: 2, nome: 'Ana Estoque',   email: 'estoque@tesx.com',   senha: 'estoque123',   perfil: 'estoque' },
  { id: 3, nome: 'Bruno Producao',email: 'producao@tesx.com',  senha: 'producao123',  perfil: 'producao' },
  { id: 4, nome: 'Carla Qualidade',email:'qualidade@tesx.com', senha: 'qualidade123', perfil: 'qualidade' },
  { id: 5, nome: 'Diego Vendas',  email: 'vendas@tesx.com',    senha: 'vendas123',    perfil: 'vendas' }
];

const fornecedores = [
  { id: 1, nome: 'MotorBrasil Ltda',    cnpj: '11.111.111/0001-11', contato: 'contato@motorbrasil.com', prazoEntrega: 7  },
  { id: 2, nome: 'PneusJa S.A.',        cnpj: '22.222.222/0001-22', contato: 'vendas@pneusja.com',      prazoEntrega: 5  },
  { id: 3, nome: 'EletroCar Sistemas',  cnpj: '33.333.333/0001-33', contato: 'sac@eletrocar.com',       prazoEntrega: 10 }
];

const componentes = [
  { id: 1, codigo: 'MOT-001', descricao: 'Motor 1.0 Flex',      fornecedorId: 1, estoqueMinimo: 10, saldo: 50,  unidade: 'un' },
  { id: 2, codigo: 'PNE-001', descricao: 'Pneu Aro 15',         fornecedorId: 2, estoqueMinimo: 40, saldo: 200, unidade: 'un' },
  { id: 3, codigo: 'BAT-001', descricao: 'Bateria 60Ah',        fornecedorId: 3, estoqueMinimo: 15, saldo: 30,  unidade: 'un' },
  { id: 4, codigo: 'CAR-001', descricao: 'Carroceria Sedan',    fornecedorId: 1, estoqueMinimo: 5,  saldo: 12,  unidade: 'un' },
  { id: 5, codigo: 'ECU-001', descricao: 'Central Eletronica',  fornecedorId: 3, estoqueMinimo: 10, saldo: 25,  unidade: 'un' }
];

const modelos = [
  {
    id: 1,
    nome: 'Tesx Sedan 1.0',
    preco: 80000,
    componentes: [
      { componenteId: 1, quantidade: 1 },
      { componenteId: 2, quantidade: 4 },
      { componenteId: 3, quantidade: 1 },
      { componenteId: 4, quantidade: 1 },
      { componenteId: 5, quantidade: 1 }
    ]
  },
  {
    id: 2,
    nome: 'Tesx Utilitario',
    preco: 120000,
    componentes: [
      { componenteId: 1, quantidade: 1 },
      { componenteId: 2, quantidade: 4 },
      { componenteId: 3, quantidade: 1 },
      { componenteId: 4, quantidade: 1 },
      { componenteId: 5, quantidade: 2 }
    ]
  }
];

const clientes = [
  { id: 1, nome: 'Joao da Silva',       documento: '123.456.789-00',        tipo: 'pf', email: 'joao@email.com',        telefone: '(51) 99999-0001' },
  { id: 2, nome: 'Locadora Roda Livre', documento: '44.444.444/0001-44',    tipo: 'pj', email: 'compras@rodalivre.com', telefone: '(51) 3333-0002' }
];

const lotes = componentes.map(c => ({
  id: c.id,
  componenteId: c.id,
  numeroLote: `LOTE-${c.codigo}-INICIAL`,
  quantidade: c.saldo,
  dataEntrada: new Date().toISOString()
}));

db.write('usuarios', usuarios);
db.write('fornecedores', fornecedores);
db.write('componentes', componentes);
db.write('modelos', modelos);
db.write('clientes', clientes);
db.write('lotes', lotes);
db.write('movimentacoes', []);
db.write('ordensProducao', []);
db.write('veiculos', []);
db.write('inspecoes', []);
db.write('pedidosVenda', []);
db.write('auditoria', []);

console.log('Banco de dados inicial criado em ./data');