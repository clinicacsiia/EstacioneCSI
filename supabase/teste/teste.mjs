/* teste.mjs — testes do supabase/schema.sql num Postgres de verdade (PGlite), sem internet e sem tocar no seu projeto.
   Rodar:   cd supabase/teste && npm install && npm test
   Cada teste começa com um banco novo e chama public.estaciona_api como o site chama (m, r, t, b). */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const SCHEMA = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const testes = [];
const teste = (nome, fn) => testes.push({ nome, fn });

async function novoBanco() {
  const db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;'); // os papéis que o Supabase já tem
  await db.exec(SCHEMA);
  const b = {
    db,
    api: async (m, r, t, corpo) => (await db.query('select public.estaciona_api($1,$2,$3,$4::jsonb) as x', [m, r, t || '', JSON.stringify(corpo === undefined ? {} : corpo)])).rows[0].x,
    senhaAdmin: async () => (await db.query('select estaciona.senha_admin_inicial() as s')).rows[0].s,
    n: async (sql) => (await db.query(sql)).rows[0].n,
  };
  b.entrar = async (login, senha) => { const r = await b.api('POST', '/api/login', '', { login, senha }); assert.equal(r.s, 200, JSON.stringify(r)); return r.c.token; };
  b.admin = async () => b.entrar('admin', await b.senhaAdmin());
  b.versao = async (t, col) => (await b.api('GET', '/api/versoes', t)).c.versoes[col];
  b.gravar = async (t, col, delta) => b.api('PUT', '/api/dados/' + col, t, { v: await b.versao(t, col), delta });
  return b;
}
const sha = (x) => crypto.createHash('sha256').update(x, 'utf8').digest('hex');
const usuario = (id, login, perfil, senha, extra) => { const salt = 'sal-' + login; return { id, nome: 'Pessoa ' + login, login, perfil, salt, hash: sha(salt + ':' + senha), ativo: true, criadoEm: 1700000000000, ultimoLogin: null, ...extra }; };
const ticket = (id, extra) => ({ id: String(id), placa: 'ABC' + id, status: 'ESTACIONADO', entradaEm: 1000, pagamentos: [], pagoEm: null, ...extra });
async function comUsuarios(b) {
  const adm = await b.admin();
  await b.gravar(adm, 'usuarios', { t: 'm', up: [usuario('u_man', 'man', 'manobrista', 'senha-man'), usuario('u_cai', 'cai', 'caixa', 'senha-cai'), usuario('u_ger', 'ger', 'gerente', 'senha-ger')], rm: [] });
  return { adm, man: await b.entrar('man', 'senha-man'), cai: await b.entrar('cai', 'senha-cai'), ger: await b.entrar('ger', 'senha-ger') };
}

// ------------------------------------------------------------ segurança
teste('a chave pública (papel anon) NÃO lê nem grava nenhuma tabela, mas chama a API', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(1001)], rm: [] });
  await b.db.exec('set role anon');
  for (const tabela of ['registros', 'segredos', 'sessoes', 'objetos', 'controle', 'deltas', 'tentativas', 'notas', 'copias', 'propriedades']) {
    await assert.rejects(b.db.query(`select * from estaciona.${tabela}`), /permission denied/i, tabela);
  }
  await assert.rejects(b.db.query("insert into estaciona.registros(col,id,doc) values ('tickets','x','{}')"), /permission denied/i);
  await assert.rejects(b.db.query('select estaciona.instalar()'), /permission denied/i);
  await assert.rejects(b.db.query('select estaciona.senha_admin_inicial()'), /permission denied/i);
  const r = await b.api('GET', '/api/painel');
  assert.equal(r.s, 200);
  await b.db.exec('reset role');
});

teste('todas as tabelas têm RLS ligado e nenhuma função interna é executável por anon/authenticated', async () => {
  const b = await novoBanco();
  const sem = (await b.db.query("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'estaciona' and c.relkind = 'r' and not c.relrowsecurity")).rows;
  assert.deepEqual(sem, [], 'tabelas sem RLS: ' + JSON.stringify(sem));
  const abertas = (await b.db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'estaciona' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)).rows;
  assert.deepEqual(abertas, [], 'funções internas abertas: ' + JSON.stringify(abertas));
  const publicas = (await b.db.query("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'estaciona%'")).rows.map((x) => x.proname);
  assert.deepEqual(publicas, ['estaciona_api'], 'a única porta pública é estaciona_api');
  assert.equal(await b.n("select count(*)::int n from pg_namespace where nspname = 'estaciona'"), 1);
});

teste('hash e salt das senhas nunca aparecem nas respostas normais (só no backup)', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  for (const [rota, quem] of [['/api/dados', t.man], ['/api/dados/usuarios', t.man], ['/api/dados/usuarios?desde=0', t.man]]) {
    const r = await b.api('GET', rota, quem);
    assert.equal(r.s, 200);
    assert.ok(!/"hash"|"salt"/.test(JSON.stringify(r)), rota);
  }
  assert.equal(await b.n("select count(*)::int n from estaciona.registros where col = 'usuarios' and (doc ? 'hash' or doc ? 'salt')"), 0);
  const bk = await b.api('GET', '/api/backup', t.ger);
  assert.ok(bk.c.dados.usuarios.every((u) => u.hash && u.salt), 'o backup leva hash/salt para poder restaurar');
});

teste('o hash do navegador (sha256 de "salt:senha" em UTF-8, com acento) é o mesmo que o banco confere', async () => {
  const b = await novoBanco();
  const adm = await b.admin();
  await b.gravar(adm, 'usuarios', { t: 'm', up: [usuario('u_ac', 'acento', 'caixa', 'Sênha-çãõ-😀')], rm: [] });
  assert.equal((await b.api('POST', '/api/login', '', { login: 'acento', senha: 'Sênha-çãõ-😀' })).s, 200);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'acento', senha: 'Senha-cao' })).s, 401);
});

teste('rodar o schema.sql de novo não apaga dados nem muda a senha do admin', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(1001)], rm: [] });
  const senha = await b.senhaAdmin();
  await b.db.exec(SCHEMA);
  assert.equal(await b.senhaAdmin(), senha);
  assert.equal((await b.api('GET', '/api/dados/tickets', t.man)).c.dados.length, 1);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'admin', senha })).s, 200);
});

// ------------------------------------------------------------ login e sessão
teste('login: erros iguais para usuário inexistente e senha errada, ignora maiúsculas/espaços, recusa inativo', async () => {
  const b = await novoBanco();
  await comUsuarios(b);
  const adm = await b.admin();
  await b.gravar(adm, 'usuarios', { t: 'm', up: [usuario('u_off', 'off', 'caixa', 'x123456', { ativo: false })], rm: [] });
  const a = await b.api('POST', '/api/login', '', { login: 'admin', senha: 'errada' });
  const f = await b.api('POST', '/api/login', '', { login: 'fantasma', senha: 'errada' });
  assert.deepEqual(a, f);
  assert.equal(a.s, 401);
  assert.equal((await b.api('POST', '/api/login', '', { login: '  MAN ', senha: 'senha-man' })).s, 200);
  const off = await b.api('POST', '/api/login', '', { login: 'off', senha: 'x123456' });
  assert.equal(off.s, 403);
  assert.equal((await b.api('POST', '/api/login', '', {})).s, 401);
});

teste('login: 5 erros bloqueiam a conta (429), até com a senha certa', async () => {
  const b = await novoBanco();
  await comUsuarios(b);
  for (let i = 1; i <= 5; i++) assert.equal((await b.api('POST', '/api/login', '', { login: 'cai', senha: 'x' + i })).s, 401);
  const bloq = await b.api('POST', '/api/login', '', { login: 'cai', senha: 'senha-cai' });
  assert.equal(bloq.s, 429);
  assert.match(bloq.c.erro, /Muitas tentativas/);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'man', senha: 'senha-man' })).s, 200, 'outra conta não é afetada');
  await b.db.exec("update estaciona.tentativas set ate = 0"); // passou o tempo do bloqueio
  assert.equal((await b.api('POST', '/api/login', '', { login: 'cai', senha: 'senha-cai' })).s, 200);
});

teste('sessão: token inválido, expira após 12 h parado, troca de senha e desativação derrubam, logout encerra', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  assert.equal((await b.api('GET', '/api/versoes', 'f'.repeat(64))).s, 401);
  assert.equal((await b.api('GET', '/api/versoes', 'curto')).s, 401);
  assert.equal((await b.api('GET', '/api/versoes', '')).s, 401);
  assert.equal((await b.api('GET', '/api/versoes', t.man)).s, 200);
  await b.db.exec(`update estaciona.sessoes set ultimo = ultimo - 13 * 3600 * 1000 where uid = 'u_man'`);
  assert.equal((await b.api('GET', '/api/versoes', t.man)).s, 401, 'ocioso por 13 h');
  const man2 = await b.entrar('man', 'senha-man');
  await b.gravar(t.adm, 'usuarios', { t: 'm', up: [usuario('u_man', 'man', 'manobrista', 'outra-senha')], rm: [] });
  assert.equal((await b.api('GET', '/api/versoes', man2)).s, 401, 'senha trocada derruba a sessão');
  const man3 = await b.entrar('man', 'outra-senha');
  await b.gravar(t.adm, 'usuarios', { t: 'm', up: [usuario('u_man', 'man', 'manobrista', 'outra-senha', { ativo: false })], rm: [] });
  assert.equal((await b.api('GET', '/api/versoes', man3)).s, 401, 'desativado perde a sessão');
  assert.equal((await b.api('POST', '/api/logout', t.cai, {})).s, 200);
  assert.equal((await b.api('GET', '/api/versoes', t.cai)).s, 401);
});

teste('quem troca a PRÓPRIA senha continua logado', async () => {
  const b = await novoBanco();
  const adm = await b.admin();
  await b.gravar(adm, 'usuarios', { t: 'm', up: [usuario('u_admin', 'admin', 'admin', 'nova-senha', { nome: 'Administrador' })], rm: [] });
  assert.equal((await b.api('GET', '/api/versoes', adm)).s, 200);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'admin', senha: 'nova-senha' })).s, 200);
});

// ------------------------------------------------------------ dados
teste('versões, deltas, "desde" e conflito de versão (409 já com o que mudou)', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const v0 = await b.versao(t.man, 'tickets');
  const r1 = await b.api('PUT', '/api/dados/tickets', t.man, { v: v0, delta: { t: 'm', up: [ticket(1001), ticket(1002)], rm: [] } });
  assert.deepEqual(r1, { s: 200, c: { ok: true, v: v0 + 1 } });
  const velho = await b.api('PUT', '/api/dados/tickets', t.cai, { v: v0, delta: { t: 'm', up: [ticket(1003)], rm: [] } });
  assert.equal(velho.s, 409);
  assert.equal(velho.c.conflito, true);
  assert.equal(velho.c.deltas[0].up.length, 2, 'devolve o que mudou');
  await b.gravar(t.cai, 'tickets', { t: 'm', up: [ticket(1001, { status: 'PAGO' })], rm: ['1002'] });
  const dif = (await b.api('GET', `/api/dados/tickets?desde=${v0}`, t.man)).c;
  assert.equal(dif.deltas.length, 2);
  assert.deepEqual((await b.api('GET', `/api/dados/tickets?desde=${v0 + 2}`, t.man)).c, { v: v0 + 2, igual: true });
  const tudo = (await b.api('GET', `/api/dados/tickets?desde=${v0 + 99}`, t.man)).c;
  assert.equal(tudo.dados.length, 1);
  assert.equal(tudo.dados[0].status, 'PAGO');
  assert.equal((await b.api('GET', '/api/dados/tickets?desde=abc', t.man)).c.dados.length, 1);
});

teste('registros novos entram no fim, atualizar mantém a posição, id repetido no lote vale o último', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(1), ticket(2), ticket(3)], rm: [] });
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(2, { obs: 'mudou' }), ticket(4), ticket(5), ticket(4, { obs: 'último' })], rm: ['3'] });
  const ids = (await b.api('GET', '/api/dados/tickets', t.man)).c.dados.map((x) => x.id + (x.obs ? ':' + x.obs : ''));
  assert.deepEqual(ids, ['1', '2:mudou', '4:último', '5']);
});

teste('deltas inválidos são recusados (400) e nada é gravado', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const casos = [[{}, 'tickets'], [{ t: 'z' }, 'tickets'], [{ t: 't', dados: 5 }, 'tickets'], [{ t: 't', dados: [1] }, 'tickets'], [{ t: 'm', up: [{ placa: 'x' }], rm: [] }, 'tickets'],
    [{ t: 'm', up: [], rm: [{}] }, 'tickets'], [{ t: 'm', up: [] }, 'tickets'], [{ t: 'a', n: -1, add: [] }, 'log'], [{ t: 'a', n: 1.5, add: [] }, 'log'], [{ t: 'a', n: 0 }, 'log'],
    [{ t: 't', dados: [] }, 'config'], [{ t: 'm', up: [], rm: [] }, 'config'], [{ t: 'm', up: [{ id: 'a' }], rm: [] }, 'log'], [null, 'tickets'], [[], 'tickets']];
  for (const [delta, col] of casos) {
    const r = await b.api('PUT', '/api/dados/' + col, col === 'config' ? t.ger : t.man, { v: await b.versao(t.man, col), delta });
    assert.equal(r.s, 400, JSON.stringify(delta) + ' em ' + col + ' -> ' + JSON.stringify(r));
  }
  assert.equal((await b.api('GET', '/api/dados/tickets', t.man)).c.dados.length, 0);
});

teste('permissões: usuários só o admin, config admin/gerente, coleção ou rota inexistente, sem login', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const vazio = { t: 'm', up: [], rm: [] };
  assert.equal((await b.gravar(t.man, 'usuarios', vazio)).s, 403);
  assert.equal((await b.gravar(t.ger, 'usuarios', vazio)).s, 403);
  assert.equal((await b.gravar(t.cai, 'config', { t: 't', dados: { a: 1 } })).s, 403);
  assert.equal((await b.gravar(t.ger, 'config', { t: 't', dados: { estabelecimento: 'Meu' } })).s, 200);
  assert.equal((await b.api('PUT', '/api/dados/xyz', t.man, { v: 0, delta: vazio })).s, 404);
  assert.equal((await b.api('GET', '/api/dados/xyz', t.man)).s, 404);
  assert.equal((await b.api('GET', '/api/naoexiste', t.man)).s, 404);
  assert.equal((await b.api('PUT', '/api/dados/tickets', '', { v: 0, delta: vazio })).s, 401);
  assert.equal((await b.api('PUT', '/api/dados/tickets', t.man, { delta: vazio })).s, 400, 'sem versão');
  assert.equal((await b.api('PUT', '/api/dados/tickets', t.man, { v: 1.5, delta: vazio })).s, 400);
});

teste('usuários: editar sem mandar a senha mantém a senha; usuário novo sem senha é recusado', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const u = (await b.api('GET', '/api/dados/usuarios', t.adm)).c.dados.find((x) => x.id === 'u_cai');
  assert.equal((await b.gravar(t.adm, 'usuarios', { t: 'm', up: [{ ...u, nome: 'Cida' }], rm: [] })).s, 200);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'cai', senha: 'senha-cai' })).s, 200);
  const sem = await b.gravar(t.adm, 'usuarios', { t: 'm', up: [{ id: 'u_x', nome: 'X', login: 'xx', perfil: 'caixa', ativo: true }], rm: [] });
  assert.equal(sem.s, 400);
  assert.match(sem.c.erro, /sem senha/);
  assert.equal((await b.gravar(t.adm, 'usuarios', { t: 'm', up: [], rm: ['u_cai'] })).s, 200);
  assert.equal(await b.n("select count(*)::int n from estaciona.segredos where id = 'u_cai'"), 0, 'a senha de quem foi removido também some');
  assert.equal((await b.api('POST', '/api/login', '', { login: 'cai', senha: 'senha-cai' })).s, 401);
});

teste('auditoria só cresce: o site corta os mais antigos no limite e o servidor não deixa apagar mais que isso', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.db.exec("create or replace function estaciona.limite_log() returns int language sql immutable as $$ select 3 $$");
  const total = () => b.n("select count(*)::int n from estaciona.registros where col = 'log'");
  const reg = (k) => Array.from({ length: k }, (_, i) => ({ em: 1700000000000 + i, usuario: 'x', acao: 'a' + i, detalhe: '' }));
  assert.equal((await b.gravar(t.man, 'log', { t: 'm', up: [{ id: 'a' }], rm: [] })).s, 400, 'não aceita alterar/apagar');
  assert.equal((await b.gravar(t.man, 'log', { t: 't', dados: [] })).s, 400);
  const atual = await total();
  assert.equal((await b.gravar(t.man, 'log', { t: 'a', n: atual + 99, add: reg(1) })).s, 400, 'apagar mais do que o limite exige');
  const n = Math.max(0, atual + 2 - 3); // o que js/dados.js calcula
  assert.equal((await b.gravar(t.man, 'log', { t: 'a', n, add: reg(2) })).s, 200);
  assert.equal(await total(), 3, 'ficaram só os 3 mais novos');
  const ultimos = (await b.api('GET', '/api/dados/log', t.man)).c.dados.slice(-2).map((x) => x.acao);
  assert.deepEqual(ultimos, ['a0', 'a1'], 'os novos ficam no fim');
});

teste('"uma gravação por vez": duas gravações com a mesma versão base — só uma vale', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const v = await b.versao(t.man, 'tickets');
  const [x, y] = await Promise.all([
    b.api('PUT', '/api/dados/tickets', t.man, { v, delta: { t: 'm', up: [ticket(1)], rm: [] } }),
    b.api('PUT', '/api/dados/tickets', t.cai, { v, delta: { t: 'm', up: [ticket(2)], rm: [] } }),
  ]);
  assert.deepEqual([x.s, y.s].sort(), [200, 409]);
});

// ------------------------------------------------------------ painel, nota, backup
teste('painel da TV é público e mostra só números de ticket, nunca a placa', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(1001, { status: 'PAGO', pagoEm: 50 }), ticket(1002, { status: 'PAGO', pagoEm: 20 }), ticket(1003, { status: 'A_CAMINHO', buscaEm: 70 }), ticket(1004)], rm: [] });
  await b.gravar(t.ger, 'config', { t: 't', dados: { estabelecimento: 'Meu Estacionamento', mensagemPainel: 'Olá' } });
  const r = await b.api('GET', '/api/painel', '');
  assert.deepEqual(r.c, { estabelecimento: 'Meu Estacionamento', mensagem: 'Olá', preparando: ['1002', '1001'], aCaminho: ['1003'] });
  assert.ok(!/ABC/.test(JSON.stringify(r)));
});

teste('nota fiscal de teste: valida CPF/CNPJ, não duplica por pagamento, respeita a permissão', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const nota = (x) => ({ ticketId: '1001', pagamentoId: 'p1', valor: 1500, descricao: 'Estacionamento', tomador: { doc: '529.982.247-25', nome: 'Fulano de Tal', email: 'a@b.co' }, ...x });
  const ok1 = await b.api('POST', '/api/nfse/emitir', t.cai, nota());
  assert.equal(ok1.s, 200);
  assert.equal(ok1.c.nota.numero, 'T000001'); assert.equal(ok1.c.jaEmitida, false); assert.equal(ok1.c.nota.homologacao, true);
  const repetida = await b.api('POST', '/api/nfse/emitir', t.cai, nota());
  assert.equal(repetida.c.jaEmitida, true); assert.equal(repetida.c.nota.numero, 'T000001');
  assert.equal((await b.api('POST', '/api/nfse/emitir', t.cai, nota({ pagamentoId: 'p2', tomador: { doc: '11.222.333/0001-81', nome: 'Empresa' } }))).c.nota.numero, 'T000002');
  for (const ruim of [{ tomador: { doc: '111.111.111-11', nome: 'Fulano' } }, { tomador: { doc: '11.222.333/0001-82', nome: 'Empresa' } }, { tomador: { doc: '529.982.247-25', nome: 'Fu' } },
    { tomador: { doc: '529.982.247-25', nome: 'Fulano', email: 'ruim' } }, { valor: 0 }, { valor: 10.5 }, { ticketId: '' }, { tomador: null }]) {
    assert.equal((await b.api('POST', '/api/nfse/emitir', t.cai, nota({ pagamentoId: 'novo', ...ruim }))).s, 400, JSON.stringify(ruim));
  }
  assert.equal((await b.api('POST', '/api/nfse/emitir', '', nota())).s, 401);
  await b.gravar(t.ger, 'config', { t: 't', dados: { permissoes: { 'nota.emitir': ['manobrista'] } } });
  assert.equal((await b.api('POST', '/api/nfse/emitir', t.cai, nota({ pagamentoId: 'p3' }))).s, 403, 'o gerente tirou a permissão do caixa');
  assert.equal((await b.api('POST', '/api/nfse/emitir', t.man, nota({ pagamentoId: 'p3' }))).s, 200);
});

teste('restaurar e zerar: só o gerente, guardam cópia interna, preservam as senhas e recriam o admin', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  await b.gravar(t.man, 'tickets', { t: 'm', up: [ticket(1001), ticket(1002)], rm: [] });
  const bk = (await b.api('GET', '/api/backup', t.ger)).c;
  assert.equal((await b.api('GET', '/api/backup', t.cai)).s, 403);
  assert.equal((await b.api('POST', '/api/restaurar', t.adm, { dados: bk.dados })).s, 403, 'o admin não restaura (só gerente)');
  assert.equal((await b.api('POST', '/api/restaurar', t.ger, { dados: { tickets: [] } })).s, 400);
  assert.equal((await b.api('POST', '/api/restaurar', t.ger, { dados: { ...bk.dados, tickets: 'x' } })).s, 400);
  assert.equal((await b.api('POST', '/api/restaurar', t.ger, { dados: { ...bk.dados, tickets: [ticket(9001)] } })).s, 200);
  assert.deepEqual((await b.api('GET', '/api/dados/tickets', t.ger)).c.dados.map((x) => x.id), ['9001']);
  assert.equal((await b.api('POST', '/api/login', '', { login: 'cai', senha: 'senha-cai' })).s, 200, 'senhas do backup continuam valendo');
  assert.equal(await b.n("select count(*)::int n from estaciona.copias where tipo = 'antes-de-restaurar'"), 1);
  const velho = await b.versao(t.ger, 'tickets');
  assert.equal((await b.api('GET', `/api/dados/tickets?desde=${velho - 1}`, t.ger)).c.dados?.length ?? 1, 1, 'clientes atrasados recebem a coleção inteira');
  assert.equal((await b.api('POST', '/api/zerar', t.cai, {})).s, 403);
  assert.equal((await b.api('POST', '/api/zerar', t.ger, {})).s, 200);
  assert.equal((await b.api('GET', '/api/dados', t.ger)).s, 401, 'quem estava logado cai');
  assert.equal((await b.api('POST', '/api/login', '', { login: 'admin', senha: await b.senhaAdmin() })).s, 200, 'admin volta com a senha inicial');
  assert.equal(await b.n("select count(*)::int n from estaciona.registros where col = 'tickets'"), 0);
});

teste('desempenho: restaurar 5.000 tickets e ler tudo cabe no limite de tempo da chave pública', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  const bk = (await b.api('GET', '/api/backup', t.ger)).c;
  const tickets = Array.from({ length: 5000 }, (_, i) => ticket(1000 + i, { modelo: 'Onix', cor: 'Prata', obs: 'x'.repeat(200), pagamentos: [{ id: 'p' + i, valor: 1500, linhas: [{ d: 'Tarifa', v: 1500 }] }] }));
  let t0 = Date.now();
  assert.equal((await b.api('POST', '/api/restaurar', t.ger, { dados: { ...bk.dados, tickets } })).s, 200);
  const tRest = Date.now() - t0;
  t0 = Date.now();
  const tudo = await b.api('GET', '/api/dados', t.ger);
  const tLer = Date.now() - t0;
  assert.equal(tudo.c.colecoes.tickets.dados.length, 5000);
  t0 = Date.now();
  await b.gravar(t.ger, 'tickets', { t: 'm', up: [ticket(1000, { status: 'PAGO' })], rm: [] });
  const tGravar = Date.now() - t0;
  console.log(`      (5.000 tickets: restaurar ${tRest} ms, ler tudo ${tLer} ms, gravar 1 ticket ${tGravar} ms; PGlite roda em WebAssembly: o Postgres do Supabase é bem mais rápido)`);
  assert.ok(tRest < 30000 && tLer < 10000 && tGravar < 3000);
});

teste('falha inesperada do servidor: a tela recebe só "Ocorreu um erro." (sem detalhes técnicos)', async () => {
  const b = await novoBanco();
  const t = await comUsuarios(b);
  // versão enorme: passa na conferência de "inteiro" mas estoura o bigint dentro do banco (erro que ninguém previu)
  const r = await b.api('PUT', '/api/dados/tickets', t.man, { v: 1e30, delta: { t: 'm', up: [ticket(1001)], rm: [] } });
  assert.equal(r.s, 500);
  assert.deepEqual(r.c, { ok: false, erro: 'Ocorreu um erro.' });
});

// ------------------------------------------------------------ execução
let falhas = 0;
for (const { nome, fn } of testes) {
  try { await fn(); console.log('  ✔ ' + nome); } catch (e) { falhas++; console.log('  ✘ ' + nome + '\n      ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 7).join('\n      ')); }
}
console.log('\n' + (falhas ? falhas + ' teste(s) FALHARAM' : 'Todos os ' + testes.length + ' testes passaram.'));
process.exit(falhas ? 1 : 0);
