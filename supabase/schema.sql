-- ============================================================
-- schema.sql — banco e "servidor" do Estacionamento CSI no Supabase
-- ------------------------------------------------------------
-- COMO USAR (passo a passo completo em supabase/LEIA-ME.md):
--   Supabase > SQL Editor > New query > cole ESTE ARQUIVO INTEIRO > Run.
--   No fim aparece a senha inicial do usuário "admin". Anote.
--   Pode rodar de novo sem medo: não apaga dados (só atualiza as funções).
--
-- COMO FUNCIONA (é o antigo Apps Script/planilha, agora dentro do Postgres):
--   * Os dados ficam em tabelas do schema PRIVADO "estaciona". Elas têm RLS ligado, nenhuma
--     regra de acesso e nenhuma permissão para a chave pública (anon/authenticated), e o
--     schema nem é exposto pela API do Supabase. Quem tem a chave publishable (que fica
--     visível no site) NÃO consegue ler nem gravar nenhuma tabela.
--   * A única porta de entrada é a função public.estaciona_api(m, r, t, b). O site manda
--     { m: método, r: rota, t: token, b: corpo } e recebe { s: status, c: corpo }, o mesmo
--     formato de sempre (js/api.js). Login, sessões, limite de tentativas, permissões e
--     auditoria são conferidos AQUI, dentro do banco. Senhas ficam só como hash
--     sha256("salt:senha") (o mesmo formato do sistema antigo: backups antigos continuam valendo)
--     e nunca saem do banco.
--   * Cada coleção (tickets, caixas, mensalistas, usuarios, log, config, meta) tem uma versão e
--     um histórico de mudanças (deltas): o site baixa só o que mudou.
--   * Um registro = uma linha com o json inteiro, como era na planilha. Dinheiro é sempre
--     inteiro em centavos dentro do json.
-- ============================================================

create schema if not exists estaciona;

-- ---------- Tabelas ----------
-- Lista de registros de todas as coleções que são listas (usuarios, tickets, caixas, mensalistas, log).
-- "pos" guarda a ordem de chegada (a auditoria, que não tem id, recebe um id interno).
create table if not exists estaciona.registros (
  col  text   not null,
  id   text   not null,
  doc  jsonb  not null,
  pos  bigint generated always as identity,
  primary key (col, id)
);
create index if not exists registros_col_pos on estaciona.registros (col, pos);

-- Coleções que são um objeto só (config, meta).
create table if not exists estaciona.objetos   (col text primary key, doc jsonb not null);
-- Versão atual de cada coleção e histórico das últimas mudanças.
create table if not exists estaciona.controle  (col text primary key, versao bigint not null default 0);
create table if not exists estaciona.deltas    (col text not null, versao bigint not null, delta jsonb not null, primary key (col, versao));
-- Hash e salt das senhas (nunca vão para a tela).
create table if not exists estaciona.segredos  (id text primary key, hash text not null, salt text not null);
-- Sessões (login por token) e limite de tentativas de senha.
create table if not exists estaciona.sessoes   (token text primary key, uid text not null, pwv text not null, ultimo bigint not null);
create table if not exists estaciona.tentativas(chave text primary key, e int not null default 0, n int not null default 0, ate bigint not null default 0, atualizado bigint not null default 0);
-- Notas fiscais de teste, cópias de segurança tiradas antes de restaurar/zerar, e propriedades internas.
create table if not exists estaciona.notas     (pagamento_id text primary key, doc jsonb not null, pos bigint generated always as identity);
create table if not exists estaciona.copias    (id bigint generated always as identity primary key, criada bigint not null, tipo text not null, dados jsonb not null);
create table if not exists estaciona.propriedades (chave text primary key, valor text not null);

alter table estaciona.registros    enable row level security;
alter table estaciona.objetos      enable row level security;
alter table estaciona.controle     enable row level security;
alter table estaciona.deltas       enable row level security;
alter table estaciona.segredos     enable row level security;
alter table estaciona.sessoes      enable row level security;
alter table estaciona.tentativas   enable row level security;
alter table estaciona.notas        enable row level security;
alter table estaciona.copias       enable row level security;
alter table estaciona.propriedades enable row level security;

-- Ninguém de fora acessa o schema (a chave pública é o papel "anon").
revoke all on schema estaciona from public;
revoke all on all tables in schema estaciona from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema estaciona from anon;
    revoke all on all tables in schema estaciona from anon;
    revoke all on all functions in schema estaciona from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema estaciona from authenticated;
    revoke all on all tables in schema estaciona from authenticated;
    revoke all on all functions in schema estaciona from authenticated;
  end if;
end $$;

-- ---------- Utilidades ----------
create or replace function estaciona.agora() returns bigint language sql as
$$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

-- Interrompe a chamada com um erro HTTP (como o ErroHttp_ do Apps Script). Quem captura é public.estaciona_api.
create or replace function estaciona.falhar(p_cod int, p_msg text, p_extra jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin
  raise exception '%', jsonb_build_object('s', p_cod, 'erro', p_msg, 'extra', p_extra)::text using errcode = 'EH000';
end $$;

create or replace function estaciona.tipo(j jsonb) returns text language sql immutable as $$ select coalesce(jsonb_typeof(j), 'null') $$;
create or replace function estaciona.eh_lista(c text) returns boolean language sql immutable as
$$ select c in ('usuarios', 'tickets', 'caixas', 'mensalistas', 'log') $$;
create or replace function estaciona.colecao_valida(c text) returns boolean language sql immutable as
$$ select c in ('usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta') $$;
create or replace function estaciona.eh_inteiro(j jsonb) returns boolean language sql immutable as
$$ select estaciona.tipo(j) = 'number' and (j #>> '{}')::numeric = floor((j #>> '{}')::numeric) $$;

create or replace function estaciona.sha256_hex(p_texto text) returns text language sql immutable as
$$ select encode(sha256(convert_to(p_texto, 'UTF8')), 'hex') $$;
-- Formato sha256("salt:senha"), o mesmo que o navegador e o sistema antigo sempre usaram.
create or replace function estaciona.hash_senha(p_senha text, p_salt text) returns text language sql immutable as
$$ select estaciona.sha256_hex(p_salt || ':' || p_senha) $$;
create or replace function estaciona.novo_salt() returns text language sql as
$$ select substr(estaciona.sha256_hex(gen_random_uuid()::text || gen_random_uuid()::text || estaciona.agora()::text), 1, 24) $$;
create or replace function estaciona.novo_token() returns text language sql as
$$ select estaciona.sha256_hex(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text || estaciona.agora()::text) $$;

create or replace function estaciona.senha_aleatoria() returns text language plpgsql as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  b bytea := sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'));
  s text := '';
  i int;
begin
  for i in 0..11 loop s := s || substr(alfabeto, 1 + (get_byte(b, i) % length(alfabeto)), 1); end loop;
  return s;
end $$;

create or replace function estaciona.prop_get(p_chave text) returns text language sql stable as
$$ select valor from estaciona.propriedades where chave = p_chave $$;
create or replace function estaciona.prop_set(p_chave text, p_valor text) returns void language sql as
$$ insert into estaciona.propriedades(chave, valor) values (p_chave, p_valor) on conflict (chave) do update set valor = excluded.valor $$;

-- Uma gravação por vez (como o LockService do Apps Script). Leituras esperam só enquanto uma gravação está em andamento.
create or replace function estaciona.travar() returns void language sql as $$ select pg_advisory_xact_lock(7001) $$;
create or replace function estaciona.travar_leitura() returns void language sql as $$ select pg_advisory_xact_lock_shared(7001) $$;

-- Constantes
create or replace function estaciona.limite_log() returns int language sql immutable as $$ select 3000 $$;
create or replace function estaciona.historico_deltas() returns int language sql immutable as $$ select 300 $$;

-- ---------- Versões e leitura ----------
create or replace function estaciona.versoes() returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(c, coalesce(v.versao, 0)), '{}'::jsonb)
  from unnest(array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta']) as c
  left join estaciona.controle v on v.col = c
$$;

create or replace function estaciona.versao(p_col text) returns bigint language sql stable as
$$ select coalesce((select versao from estaciona.controle where col = p_col), 0) $$;

-- { v, dados } da coleção inteira. p_completo = com hash/salt das senhas (só backup/restauração).
create or replace function estaciona.ler_colecao(p_col text, p_completo boolean default false) returns jsonb language plpgsql stable as $$
declare v_dados jsonb;
begin
  if estaciona.eh_lista(p_col) then
    select coalesce(jsonb_agg(
             case when p_completo and p_col = 'usuarios' and s.id is not null
                  then r.doc || jsonb_build_object('hash', s.hash, 'salt', s.salt) else r.doc end
             order by r.pos), '[]'::jsonb)
      into v_dados
      from estaciona.registros r
      left join estaciona.segredos s on (p_col = 'usuarios' and s.id = r.id)
      where r.col = p_col;
  else
    v_dados := coalesce((select doc from estaciona.objetos where col = p_col), '{}'::jsonb);
  end if;
  return jsonb_build_object('v', estaciona.versao(p_col), 'dados', v_dados);
end $$;

create or replace function estaciona.tudo() returns jsonb language sql stable as $$
  select jsonb_object_agg(c, estaciona.ler_colecao(c))
  from unnest(array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta']) as c
$$;

create or replace function estaciona.completo() returns jsonb language sql stable as $$
  select jsonb_object_agg(c, (estaciona.ler_colecao(c, true))->'dados')
  from unnest(array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta']) as c
$$;

-- O que mudou em uma coleção desde a versão p_desde (só as diferenças, ou a coleção inteira se não der).
create or replace function estaciona.mudancas(p_col text, p_desde bigint) returns jsonb language plpgsql stable as $$
declare v bigint := estaciona.versao(p_col); n bigint; tem_x boolean; ds jsonb;
begin
  if p_desde is not null and p_desde = v then return jsonb_build_object('v', v, 'igual', true); end if;
  if p_desde is not null and p_desde >= 0 and p_desde < v then
    select count(*), coalesce(bool_or(delta ->> 't' = 'x'), false), coalesce(jsonb_agg(delta order by versao), '[]'::jsonb)
      into n, tem_x, ds
      from estaciona.deltas where col = p_col and versao > p_desde;
    if n = v - p_desde and not tem_x then return jsonb_build_object('v', v, 'deltas', ds); end if;
  end if;
  return estaciona.ler_colecao(p_col);
end $$;

-- ---------- Alterações (deltas) ----------
-- Regras iguais às de js/dados.js (aplicarDelta):  t = troca tudo | m = grava/apaga alguns registros | a = acrescenta no fim (auditoria)
create or replace function estaciona.validar_delta(p_col text, d jsonb) returns void language plpgsql as $$
declare lista boolean := estaciona.eh_lista(p_col);
begin
  if estaciona.tipo(d) <> 'object' then perform estaciona.falhar(400, 'Alteração inválida.'); end if;
  case d ->> 't'
    when 't' then
      if lista then
        if estaciona.tipo(d -> 'dados') <> 'array' or exists (select 1 from jsonb_array_elements(d -> 'dados') e where estaciona.tipo(e) <> 'object') then
          perform estaciona.falhar(400, 'Dados inválidos para ''' || p_col || '''.');
        end if;
      elsif estaciona.tipo(d -> 'dados') <> 'object' then
        perform estaciona.falhar(400, 'Dados inválidos para ''' || p_col || '''.');
      end if;
    when 'm' then
      if not lista or estaciona.tipo(d -> 'up') <> 'array' or estaciona.tipo(d -> 'rm') <> 'array'
         or exists (select 1 from jsonb_array_elements(d -> 'up') e where estaciona.tipo(e) <> 'object') then
        perform estaciona.falhar(400, 'Alteração inválida.');
      end if;
      if exists (select 1 from jsonb_array_elements(d -> 'up') e where estaciona.tipo(e -> 'id') not in ('string', 'number'))
         or exists (select 1 from jsonb_array_elements(d -> 'rm') e where estaciona.tipo(e) not in ('string', 'number')) then
        perform estaciona.falhar(400, 'Todo registro precisa de ''id''.');
      end if;
    when 'a' then
      if not lista or not estaciona.eh_inteiro(d -> 'n') or (d ->> 'n')::numeric < 0
         or estaciona.tipo(d -> 'add') <> 'array' or exists (select 1 from jsonb_array_elements(d -> 'add') e where estaciona.tipo(e) <> 'object') then
        perform estaciona.falhar(400, 'Alteração inválida.');
      end if;
    else
      perform estaciona.falhar(400, 'Tipo de alteração desconhecido.');
  end case;
end $$;

-- Grava o delta nas tabelas. (Usuários: o hash/salt já foi separado por separar_segredos.)
create or replace function estaciona.aplicar(p_col text, d jsonb) returns void language plpgsql as $$
declare n int;
begin
  if not estaciona.eh_lista(p_col) then
    insert into estaciona.objetos(col, doc) values (p_col, d -> 'dados') on conflict (col) do update set doc = excluded.doc;
    return;
  end if;
  case d ->> 't'
    when 't' then
      delete from estaciona.registros where col = p_col;
      insert into estaciona.registros(col, id, doc)
        select p_col, coalesce(e.doc ->> 'id', gen_random_uuid()::text), e.doc
        from jsonb_array_elements(d -> 'dados') with ordinality as e(doc, ord) order by e.ord
        on conflict (col, id) do nothing;
    when 'm' then
      -- id repetido no mesmo lote: vale o último, na posição do primeiro (como na planilha)
      with ordenado as (
        select e.doc, e.ord, row_number() over (partition by e.doc ->> 'id' order by e.ord desc) as rn,
               min(e.ord) over (partition by e.doc ->> 'id') as primeira
        from jsonb_array_elements(d -> 'up') with ordinality as e(doc, ord)
      )
      insert into estaciona.registros(col, id, doc)
        select p_col, o.doc ->> 'id', o.doc from ordenado o where o.rn = 1 order by o.primeira
        on conflict (col, id) do update set doc = excluded.doc;
      delete from estaciona.registros where col = p_col and id in (select e #>> '{}' from jsonb_array_elements(d -> 'rm') e);
    when 'a' then
      n := (d ->> 'n')::int;
      if n > 0 then
        delete from estaciona.registros where col = p_col and id in (select id from estaciona.registros where col = p_col order by pos limit n);
      end if;
      insert into estaciona.registros(col, id, doc)
        select p_col, coalesce(e.doc ->> 'id', gen_random_uuid()::text), e.doc
        from jsonb_array_elements(d -> 'add') with ordinality as e(doc, ord) order by e.ord
        on conflict (col, id) do nothing;
    else
      perform estaciona.falhar(400, 'Tipo de alteração desconhecido.');
  end case;
end $$;

create or replace function estaciona.sem_segredo(p_doc jsonb) returns jsonb language sql immutable as $$ select p_doc - 'hash' - 'salt' $$;

-- Usuários: guarda hash/salt à parte e devolve o delta só com os dados públicos.
create or replace function estaciona.separar_segredos(d jsonb) returns jsonb language plpgsql as $$
declare e jsonb; lista jsonb := case d ->> 't' when 'm' then d -> 'up' else d -> 'dados' end;
begin
  for e in select value from jsonb_array_elements(lista) loop
    if coalesce(e ->> 'hash', '') <> '' and coalesce(e ->> 'salt', '') <> '' then
      insert into estaciona.segredos(id, hash, salt) values (e ->> 'id', e ->> 'hash', e ->> 'salt')
        on conflict (id) do update set hash = excluded.hash, salt = excluded.salt;
    end if;
  end loop;
  if d ->> 't' = 'm' then
    delete from estaciona.segredos where id in (select r #>> '{}' from jsonb_array_elements(d -> 'rm') r);
    return jsonb_build_object('t', 'm', 'rm', d -> 'rm',
      'up', coalesce((select jsonb_agg(estaciona.sem_segredo(x.doc) order by x.ord) from jsonb_array_elements(d -> 'up') with ordinality x(doc, ord)), '[]'::jsonb));
  end if;
  delete from estaciona.segredos where id not in (select x ->> 'id' from jsonb_array_elements(d -> 'dados') x);
  return jsonb_build_object('t', 't',
    'dados', coalesce((select jsonb_agg(estaciona.sem_segredo(x.doc) order by x.ord) from jsonb_array_elements(d -> 'dados') with ordinality x(doc, ord)), '[]'::jsonb));
end $$;

-- Grava um delta já validado, sobe a versão e guarda o histórico. Só chame com a trava ativa.
create or replace function estaciona.confirmar(p_col text, p_delta jsonb) returns bigint language plpgsql as $$
declare v1 bigint; corpo jsonb; limpo jsonb := p_delta;
begin
  insert into estaciona.controle(col, versao) values (p_col, 0) on conflict (col) do nothing;
  select versao + 1 into v1 from estaciona.controle where col = p_col for update;
  if p_col = 'usuarios' then limpo := estaciona.separar_segredos(p_delta); end if;
  perform estaciona.aplicar(p_col, limpo);
  -- Usuários (têm hash de senha) e mudanças enormes não vão para o histórico: quem estiver atrás baixa a coleção inteira.
  corpo := case when p_col = 'usuarios' or length(p_delta::text) > 45000 then '{"t":"x"}'::jsonb else p_delta end;
  insert into estaciona.deltas(col, versao, delta) values (p_col, v1, corpo);
  update estaciona.controle set versao = v1 where col = p_col;
  delete from estaciona.deltas where col = p_col and versao <= v1 - estaciona.historico_deltas();
  return v1;
end $$;

-- Usuário que chega sem hash/salt (edição que não troca a senha) mantém o que já tinha.
create or replace function estaciona.preservar_senhas(d jsonb) returns jsonb language plpgsql as $$
declare
  chave text := case d ->> 't' when 'm' then 'up' when 't' then 'dados' else null end;
  lista jsonb := '[]'::jsonb; e jsonb; s record;
begin
  if chave is null then perform estaciona.falhar(400, 'Alteração inválida.'); end if;
  for e in select value from jsonb_array_elements(d -> chave) loop
    if coalesce(e ->> 'hash', '') = '' or coalesce(e ->> 'salt', '') = '' then
      select * into s from estaciona.segredos where id = e ->> 'id';
      if not found then perform estaciona.falhar(400, 'Usuário novo sem senha.'); end if;
      e := e || jsonb_build_object('hash', s.hash, 'salt', s.salt);
    end if;
    lista := lista || jsonb_build_array(e);
  end loop;
  return d || jsonb_build_object(chave, lista);
end $$;

-- Grava um delta se a versão base for a atual. Devolve { s, c } (409 = alguém gravou antes: já vai o que mudou).
create or replace function estaciona.escrever(p_col text, p_vbase bigint, p_delta jsonb) returns jsonb language plpgsql as $$
declare v bigint; delta jsonb := p_delta; atual int;
begin
  perform estaciona.validar_delta(p_col, delta);
  perform estaciona.travar();
  v := estaciona.versao(p_col);
  if p_vbase <> v then
    return jsonb_build_object('s', 409, 'c', estaciona.mudancas(p_col, p_vbase) || jsonb_build_object('ok', false, 'conflito', true));
  end if;
  if p_col = 'usuarios' then
    delta := estaciona.preservar_senhas(delta);
  elsif p_col = 'log' then
    if delta ->> 't' <> 'a' then perform estaciona.falhar(400, 'A auditoria só aceita novos registros.'); end if;
    select count(*) into atual from estaciona.registros where col = 'log';
    if (delta ->> 'n')::int > greatest(0, atual + jsonb_array_length(delta -> 'add') - estaciona.limite_log()) then
      perform estaciona.falhar(400, 'A auditoria não pode ser apagada.');
    end if;
  end if;
  return jsonb_build_object('s', 200, 'c', jsonb_build_object('ok', true, 'v', estaciona.confirmar(p_col, delta)));
end $$;

create or replace function estaciona.registrar_log(p_usuario jsonb, p_acao text, p_detalhe text default '') returns void language plpgsql as $$
declare reg jsonb; n int;
begin
  reg := jsonb_build_object('em', estaciona.agora(), 'usuarioId', p_usuario -> 'id', 'usuario', coalesce(p_usuario ->> 'nome', 'sistema'),
                            'perfil', coalesce(p_usuario ->> 'perfil', ''), 'acao', p_acao, 'detalhe', coalesce(p_detalhe, ''));
  select greatest(0, count(*) + 1 - estaciona.limite_log()) into n from estaciona.registros where col = 'log';
  perform estaciona.confirmar('log', jsonb_build_object('t', 'a', 'n', n, 'add', jsonb_build_array(reg)));
end $$;

-- ---------- Usuários, sessões e limite de tentativas ----------
-- Usuário completo (com hash e salt), ou null.
create or replace function estaciona.usuario_por(p_campo text, p_valor text) returns jsonb language sql stable as $$
  select r.doc || case when s.id is not null then jsonb_build_object('hash', s.hash, 'salt', s.salt) else '{}'::jsonb end
  from estaciona.registros r left join estaciona.segredos s on s.id = r.id
  where r.col = 'usuarios' and r.doc ->> p_campo = p_valor
  order by r.pos limit 1
$$;

create or replace function estaciona.nome_estabelecimento() returns text language sql stable as
$$ select coalesce(nullif((select doc ->> 'estabelecimento' from estaciona.objetos where col = 'config'), ''), 'Estacionamento CSI') $$;

-- Sem usar o sistema por 12 h = precisa entrar de novo. A hora do último uso só é regravada a cada 1 min.
create or replace function estaciona.sessao_obter(p_token text, p_tocar boolean) returns jsonb language plpgsql as $$
declare s record; agora bigint := estaciona.agora();
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into s from estaciona.sessoes where token = p_token;
  if not found then return null; end if;
  if agora - s.ultimo > 12 * 3600 * 1000 then
    delete from estaciona.sessoes where token = p_token;
    return null;
  end if;
  if p_tocar and agora - s.ultimo > 60000 then update estaciona.sessoes set ultimo = agora where token = p_token; end if;
  return jsonb_build_object('uid', s.uid, 'pwv', s.pwv);
end $$;

create or replace function estaciona.sessao_criar(p_usuario jsonb) returns text language plpgsql as $$
declare t text := estaciona.novo_token();
begin
  delete from estaciona.sessoes where ultimo < estaciona.agora() - 12 * 3600 * 1000;
  insert into estaciona.sessoes(token, uid, pwv, ultimo) values (t, p_usuario ->> 'id', coalesce(p_usuario ->> 'hash', ''), estaciona.agora());
  return t;
end $$;

create or replace function estaciona.sessao_encerrar(p_token text) returns void language sql as
$$ delete from estaciona.sessoes where token = p_token $$;

-- Quem troca a própria senha continua logado: a sessão passa a valer com o hash novo.
create or replace function estaciona.sessao_atualizar_senha(p_token text, p_hash text) returns void language sql as
$$ update estaciona.sessoes set pwv = coalesce(p_hash, '') where token = p_token $$;

-- Confere a sessão e devolve o usuário (completo). p_perfis = quem pode (null = qualquer logado).
create or replace function estaciona.exigir(p_token text, p_tocar boolean, p_perfis text[] default null) returns jsonb language plpgsql as $$
declare s jsonb := estaciona.sessao_obter(p_token, p_tocar); u jsonb := null;
begin
  if s is not null then
    u := estaciona.usuario_por('id', s ->> 'uid');
    if u is null or not coalesce((u ->> 'ativo')::boolean, false) or coalesce(u ->> 'hash', '') <> (s ->> 'pwv') then u := null; end if;
  end if;
  if u is null then
    perform estaciona.falhar(401, 'Sessão expirada. Entre novamente.', jsonb_build_object('estabelecimento', estaciona.nome_estabelecimento()));
  end if;
  if p_perfis is not null and not (u ->> 'perfil' = any (p_perfis)) then
    perform estaciona.falhar(403, 'Seu perfil não tem permissão para isso.');
  end if;
  return u;
end $$;

-- Confere a senha. Com usuário null gasta o mesmo trabalho (não revela se o login existe).
create or replace function estaciona.verificar_senha(p_usuario jsonb, p_senha text) returns boolean language plpgsql as $$
declare certo boolean;
begin
  certo := estaciona.hash_senha(p_senha, coalesce(p_usuario ->> 'salt', '-')) = coalesce(p_usuario ->> 'hash', repeat('0', 64));
  return p_usuario is not null and certo;
end $$;

-- 5 erros seguidos na mesma conta: bloqueia 30 s; cada bloqueio seguido dobra (até 15 min). Um acerto zera.
create or replace function estaciona.lim_restante(p_chave text) returns int language sql stable as $$
  select coalesce((select greatest(0, ceil((ate - estaciona.agora()) / 1000.0))::int from estaciona.tentativas where chave = p_chave), 0)
$$;
create or replace function estaciona.lim_falha(p_chave text) returns void language plpgsql as $$
begin
  insert into estaciona.tentativas(chave, e, n, ate, atualizado) values (p_chave, 1, 0, 0, estaciona.agora())
    on conflict (chave) do update set e = estaciona.tentativas.e + 1, atualizado = estaciona.agora();
  update estaciona.tentativas
     set e = 0, n = n + 1, ate = estaciona.agora() + (least(30 * power(2, n), 900) * 1000)::bigint
   where chave = p_chave and e >= 5;
end $$;
create or replace function estaciona.lim_sucesso(p_chave text) returns void language sql as
$$ delete from estaciona.tentativas where chave = p_chave $$;

-- ---------- Usuário administrador inicial ----------
create or replace function estaciona.senha_admin_inicial() returns text language plpgsql as $$
declare s text := estaciona.prop_get('SENHA_ADMIN_INICIAL');
begin
  if s is null then s := estaciona.senha_aleatoria(); perform estaciona.prop_set('SENHA_ADMIN_INICIAL', s); end if;
  return s;
end $$;

create or replace function estaciona.login_do_nome(p_nome text, p_usados text[]) returns text language plpgsql as $$
declare base text; login text; n int := 2;
begin
  base := lower(normalize(coalesce(nullif(p_nome, ''), 'usuario'), NFD));
  base := regexp_replace(base, '[̀-ͯ]', '', 'g');
  base := regexp_replace(base, '[^a-z0-9]+', '.', 'g');
  base := regexp_replace(base, '^\.+|\.+$', '', 'g');
  base := left(base, 16);
  if base = '' then base := 'usuario'; end if;
  if length(base) < 3 then base := base || '.usr'; end if;
  login := base;
  while login = any (p_usados) loop login := base || n; n := n + 1; end loop;
  return login;
end $$;

-- Garante o usuário "admin" e um login para cada cadastro. Devolve a senha inicial se acabou de criar o admin.
create or replace function estaciona.garantir_usuarios() returns text language plpgsql as $$
declare
  usados text[]; u jsonb; novos jsonb := '[]'::jsonb; criada text := null; salt text; login text;
begin
  select coalesce(array_agg(doc ->> 'login'), '{}') into usados
    from estaciona.registros where col = 'usuarios' and coalesce(doc ->> 'login', '') <> '';
  for u in select doc from estaciona.registros where col = 'usuarios' and coalesce(doc ->> 'login', '') = '' order by pos loop
    login := estaciona.login_do_nome(u ->> 'nome', usados);
    usados := usados || login;
    novos := novos || jsonb_build_array(u || jsonb_build_object('login', login));
  end loop;
  if not exists (select 1 from estaciona.registros where col = 'usuarios' and doc ->> 'perfil' = 'admin') then
    criada := estaciona.senha_admin_inicial();
    salt := estaciona.novo_salt();
    novos := novos || jsonb_build_array(jsonb_build_object(
      'id', 'u_admin', 'nome', 'Administrador', 'login', 'admin', 'perfil', 'admin', 'salt', salt,
      'hash', estaciona.hash_senha(criada, salt), 'ativo', true, 'criadoEm', estaciona.agora(), 'ultimoLogin', null));
  end if;
  if jsonb_array_length(novos) > 0 then
    perform estaciona.confirmar('usuarios', jsonb_build_object('t', 'm', 'up', novos, 'rm', '[]'::jsonb));
  end if;
  return criada;
end $$;

-- ---------- Nota fiscal (só o provedor de TESTE: sem valor fiscal) ----------
create or replace function estaciona.digitos(p_valor text) returns text language sql immutable as
$$ select regexp_replace(coalesce(p_valor, ''), '\D', '', 'g') $$;

create or replace function estaciona.cpf_valido(p_cpf text) returns boolean language plpgsql immutable as $$
declare d text := estaciona.digitos(p_cpf); t int; i int; soma int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1+$' then return false; end if;
  for t in 9..10 loop
    soma := 0;
    for i in 0..t - 1 loop soma := soma + substr(d, i + 1, 1)::int * (t + 1 - i); end loop;
    if ((soma * 10) % 11) % 10 <> substr(d, t + 1, 1)::int then return false; end if;
  end loop;
  return true;
end $$;

create or replace function estaciona.cnpj_valido(p_cnpj text) returns boolean language plpgsql immutable as $$
declare d text := estaciona.digitos(p_cnpj); pesos int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; t int; i int; soma int; resto int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1+$' then return false; end if;
  for t in 12..13 loop
    soma := 0;
    for i in 0..t - 1 loop soma := soma + substr(d, i + 1, 1)::int * pesos[13 - t + i + 1]; end loop;
    resto := soma % 11;
    if (case when resto < 2 then 0 else 11 - resto end) <> substr(d, t + 1, 1)::int then return false; end if;
  end loop;
  return true;
end $$;

-- Devolve o pedido limpo ou interrompe com erro 400.
create or replace function estaciona.validar_pedido_nota(d jsonb) returns jsonb language plpgsql as $$
declare ticket text; pagamento text; descricao text; t jsonb; doc text; tipo text; nome text; email text;
begin
  ticket := btrim(coalesce(d ->> 'ticketId', '')); pagamento := btrim(coalesce(d ->> 'pagamentoId', ''));
  if ticket = '' or pagamento = '' then perform estaciona.falhar(400, 'Faltam o ticket e o pagamento.'); end if;
  if not estaciona.eh_inteiro(d -> 'valor') or (d ->> 'valor')::numeric <= 0 then
    perform estaciona.falhar(400, 'Valor inválido (deve ser maior que zero, em centavos).');
  end if;
  descricao := left(btrim(regexp_replace(coalesce(d ->> 'descricao', ''), '\s+', ' ', 'g')), 200);
  t := d -> 'tomador';
  if estaciona.tipo(t) <> 'object' then perform estaciona.falhar(400, 'Informe os dados do cliente.'); end if;
  doc := estaciona.digitos(t ->> 'doc');
  tipo := case length(doc) when 11 then 'cpf' when 14 then 'cnpj' else '' end;
  if tipo = 'cpf' and not estaciona.cpf_valido(doc) then perform estaciona.falhar(400, 'CPF inválido.'); end if;
  if tipo = 'cnpj' and not estaciona.cnpj_valido(doc) then perform estaciona.falhar(400, 'CNPJ inválido.'); end if;
  if tipo = '' then perform estaciona.falhar(400, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).'); end if;
  nome := left(btrim(regexp_replace(coalesce(t ->> 'nome', ''), '\s+', ' ', 'g')), 115);
  if length(nome) < 3 then perform estaciona.falhar(400, 'Informe o nome (ou razão social) do cliente.'); end if;
  email := left(btrim(coalesce(t ->> 'email', '')), 80);
  if email <> '' and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform estaciona.falhar(400, 'E-mail inválido.'); end if;
  return jsonb_build_object('ticketId', ticket, 'pagamentoId', pagamento, 'valor', d -> 'valor', 'descricao', descricao,
    'tomador', jsonb_build_object('tipo', tipo, 'doc', doc, 'nome', nome, 'email', email));
end $$;

create or replace function estaciona.nota_publica(r jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('numero', r -> 'numero', 'codigoVerificacao', coalesce(r ->> 'codigoVerificacao', ''), 'chaveAcesso', coalesce(r ->> 'chaveAcesso', ''),
    'emitidaEm', r -> 'emitidaEm', 'linkPdf', coalesce(r -> 'linkPdf', 'null'::jsonb), 'homologacao', coalesce((r ->> 'homologacao')::boolean, false))
$$;

create or replace function estaciona.emitir_nota(p_dados jsonb) returns jsonb language plpgsql as $$
declare pedido jsonb := estaciona.validar_pedido_nota(p_dados); existente jsonb; seq text; reg jsonb;
begin
  perform estaciona.travar(); -- uma emissão por vez: impede nota duplicada
  select doc into existente from estaciona.notas where pagamento_id = pedido ->> 'pagamentoId';
  if existente is not null then return jsonb_build_object('ok', true, 'jaEmitida', true, 'nota', estaciona.nota_publica(existente)); end if;
  seq := ((select count(*) from estaciona.notas) + 1)::text;
  reg := jsonb_build_object('numero', 'T' || lpad(seq, 6, '0'), 'codigoVerificacao', 'TESTE', 'chaveAcesso', '', 'emitidaEm', estaciona.agora(), 'linkPdf', null,
    'pagamentoId', pedido -> 'pagamentoId', 'ticketId', pedido -> 'ticketId', 'valor', pedido -> 'valor', 'descricao', pedido -> 'descricao',
    'tomador', pedido -> 'tomador', 'homologacao', true);
  insert into estaciona.notas(pagamento_id, doc) values (pedido ->> 'pagamentoId', reg);
  return jsonb_build_object('ok', true, 'jaEmitida', false, 'nota', estaciona.nota_publica(reg));
end $$;

create or replace function estaciona.pode_emitir_nota(p_usuario jsonb) returns boolean language plpgsql stable as $$
declare perfis text[] := array['caixa', 'gerente']; aj jsonb := (select doc -> 'permissoes' -> 'nota.emitir' from estaciona.objetos where col = 'config');
begin
  if estaciona.tipo(aj) = 'array' then
    perfis := array['gerente'] || coalesce((select array_agg(x) from jsonb_array_elements_text(aj) x where x in ('manobrista', 'caixa')), '{}');
  end if;
  return p_usuario ->> 'perfil' = any (perfis);
end $$;

-- ---------- Painel da TV (público: só números de ticket) ----------
create or replace function estaciona.painel() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'estabelecimento', estaciona.nome_estabelecimento(),
    'mensagem', coalesce(nullif((select doc ->> 'mensagemPainel' from estaciona.objetos where col = 'config'), ''), 'Aguarde no ponto de retirada com o ticket em mãos.'),
    'preparando', coalesce((select jsonb_agg(r.id order by coalesce(nullif(r.doc ->> 'pagoEm', '')::numeric, 0), r.pos)
                              from estaciona.registros r where r.col = 'tickets' and r.doc ->> 'status' = 'PAGO'), '[]'::jsonb),
    'aCaminho', coalesce((select jsonb_agg(r.id order by coalesce(nullif(r.doc ->> 'buscaEm', '')::numeric, 0), r.pos)
                            from estaciona.registros r where r.col = 'tickets' and r.doc ->> 'status' = 'A_CAMINHO'), '[]'::jsonb))
$$;

-- ---------- Restaurar / zerar ----------
-- Antes de substituir tudo, guarda uma cópia (as 5 últimas) em estaciona.copias. Tudo numa transação: se algo falhar, nada muda.
create or replace function estaciona.substituir_tudo(p_dados jsonb) returns void language plpgsql as $$
declare c text;
begin
  foreach c in array array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta'] loop
    perform estaciona.validar_delta(c, jsonb_build_object('t', 't', 'dados', p_dados -> c));
  end loop;
  perform estaciona.travar();
  insert into estaciona.copias(criada, tipo, dados) values (estaciona.agora(), 'antes-de-restaurar', estaciona.completo());
  delete from estaciona.copias where id not in (select id from estaciona.copias order by id desc limit 5);
  foreach c in array array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta'] loop
    perform estaciona.confirmar(c, jsonb_build_object('t', 't', 'dados', p_dados -> c));
  end loop;
  perform estaciona.garantir_usuarios();
end $$;

-- ---------- Rotas ----------
create or replace function estaciona.ok(p_corpo jsonb) returns jsonb language sql immutable as
$$ select jsonb_build_object('s', 200, 'c', p_corpo) $$;

create or replace function estaciona.rota_login(d jsonb) returns jsonb language plpgsql as $$
declare login text; senha text; chave text; espera int; u jsonb;
begin
  login := left(lower(btrim(coalesce(d ->> 'login', ''))), 40);
  senha := left(coalesce(d ->> 'senha', ''), 200);
  perform estaciona.travar(); -- tentativas em paralelo não furam o limite de erros
  delete from estaciona.tentativas where atualizado < estaciona.agora() - 6 * 3600 * 1000;
  perform estaciona.garantir_usuarios();
  chave := 'c:' || login;
  espera := estaciona.lim_restante(chave);
  if espera > 0 then
    return jsonb_build_object('s', 429, 'c', jsonb_build_object('ok', false, 'bloqueado', true, 'erro', 'Muitas tentativas. Aguarde ' || espera || ' s.'));
  end if;
  u := case when login <> '' then estaciona.usuario_por('login', login) else null end;
  if not estaciona.verificar_senha(u, senha) then
    perform estaciona.lim_falha(chave);
    if u is not null then perform estaciona.registrar_log(u, 'senha_incorreta', u ->> 'nome'); end if;
    return jsonb_build_object('s', 401, 'c', jsonb_build_object('ok', false, 'erro', 'Usuário ou senha incorretos.'));
  end if;
  if not coalesce((u ->> 'ativo')::boolean, false) then
    return jsonb_build_object('s', 403, 'c', jsonb_build_object('ok', false, 'erro', 'Usuário desativado. Fale com o administrador.'));
  end if;
  perform estaciona.lim_sucesso(chave);
  perform estaciona.confirmar('usuarios', jsonb_build_object('t', 'm', 'rm', '[]'::jsonb,
    'up', jsonb_build_array(estaciona.sem_segredo(u) || jsonb_build_object('ultimoLogin', estaciona.agora()))));
  perform estaciona.registrar_log(u, 'login', u ->> 'nome');
  return estaciona.ok(jsonb_build_object('ok', true, 'token', estaciona.sessao_criar(u)));
end $$;

-- Autorização de gerente: o usuário logado confirma a senha de um gerente.
create or replace function estaciona.rota_verificar_senha(d jsonb) returns jsonb language plpgsql as $$
declare senha text := left(coalesce(d ->> 'senha', ''), 200); alvo jsonb; chave text; espera int;
begin
  perform estaciona.travar();
  alvo := estaciona.usuario_por('id', coalesce(d ->> 'id', ''));
  chave := 'c:' || coalesce(alvo ->> 'login', '?');
  espera := estaciona.lim_restante(chave);
  if espera > 0 then
    return estaciona.ok(jsonb_build_object('ok', false, 'bloqueado', true, 'erro', 'Muitas tentativas. Aguarde ' || espera || ' s.'));
  end if;
  if alvo is null or alvo ->> 'perfil' <> 'gerente' or not estaciona.verificar_senha(alvo, senha) then
    perform estaciona.lim_falha(chave);
    if alvo is not null then perform estaciona.registrar_log(alvo, 'senha_incorreta', alvo ->> 'nome'); end if;
    return estaciona.ok(jsonb_build_object('ok', false, 'erro', 'Senha incorreta.'));
  end if;
  if not coalesce((alvo ->> 'ativo')::boolean, false) then
    return estaciona.ok(jsonb_build_object('ok', false, 'erro', 'Usuário desativado. Fale com o administrador.'));
  end if;
  perform estaciona.lim_sucesso(chave);
  return estaciona.ok(jsonb_build_object('ok', true));
end $$;

create or replace function estaciona.rotear(p_metodo text, p_rota text, p_token text, p_corpo jsonb) returns jsonb language plpgsql as $$
declare
  caminho text := split_part(p_rota, '?', 1);
  consulta text := coalesce(nullif(split_part(p_rota, '?', 2), ''), '');
  u jsonb; col text; desde bigint; r jsonb; tudo jsonb; dados jsonb; eu jsonb; c text;
  escrita_perfis text[];
begin
  -- A trava vem ANTES de tudo (inclusive da conferência da sessão): leituras compartilham, gravações são uma por vez.
  if p_metodo = 'GET' then perform estaciona.travar_leitura(); else perform estaciona.travar(); end if;

  if p_metodo = 'GET' then
    if caminho = '/api/painel' then return estaciona.ok(estaciona.painel()); end if;
    if caminho = '/api/versoes' then
      perform estaciona.exigir(p_token, false);
      return estaciona.ok(jsonb_build_object('versoes', estaciona.versoes()));
    end if;
    if caminho = '/api/dados' then
      u := estaciona.exigir(p_token, true);
      return estaciona.ok(jsonb_build_object('sessao', jsonb_build_object('usuarioId', u -> 'id'), 'colecoes', estaciona.tudo()));
    end if;
    if caminho like '/api/dados/%' then
      perform estaciona.exigir(p_token, true);
      col := substr(caminho, length('/api/dados/') + 1);
      if not estaciona.colecao_valida(col) then perform estaciona.falhar(404, 'Coleção desconhecida.'); end if;
      desde := case when consulta ~ '(^|&)desde=[0-9]+(&|$)' then substring(consulta from '(?:^|&)desde=([0-9]+)')::bigint else null end;
      return estaciona.ok(estaciona.mudancas(col, desde));
    end if;
    if caminho = '/api/backup' then
      perform estaciona.exigir(p_token, true, array['gerente', 'admin']);
      return estaciona.ok(jsonb_build_object('sistema', 'EstacionaMais', 'versao', 2, 'exportadoEm', estaciona.agora(), 'dados', estaciona.completo()));
    end if;
    if caminho = '/api/nfse/status' then
      perform estaciona.exigir(p_token, true);
      return estaciona.ok(jsonb_build_object('habilitado', true, 'provedor', 'mock', 'homologacao', true, 'teste', true));
    end if;
    perform estaciona.falhar(404, 'Não encontrado.');
  end if;

  if p_metodo = 'PUT' and caminho like '/api/dados/%' then
    u := estaciona.exigir(p_token, true);
    col := substr(caminho, length('/api/dados/') + 1);
    if not estaciona.colecao_valida(col) then perform estaciona.falhar(404, 'Coleção desconhecida.'); end if;
    escrita_perfis := case col when 'usuarios' then array['admin'] when 'config' then array['admin', 'gerente'] else null end;
    if escrita_perfis is not null and not (u ->> 'perfil' = any (escrita_perfis)) then perform estaciona.falhar(403, 'Seu perfil não pode alterar isso.'); end if;
    if not estaciona.eh_inteiro(p_corpo -> 'v') then perform estaciona.falhar(400, 'Versão ausente.'); end if;
    r := estaciona.escrever(col, (p_corpo ->> 'v')::bigint, p_corpo -> 'delta');
    if (r ->> 's')::int = 200 and col = 'usuarios' then
      eu := estaciona.usuario_por('id', u ->> 'id');
      if eu is not null then perform estaciona.sessao_atualizar_senha(p_token, eu ->> 'hash'); end if;
    end if;
    return r;
  end if;

  if p_metodo = 'POST' then
    if caminho = '/api/login' then return estaciona.rota_login(p_corpo); end if;
    if caminho = '/api/logout' then perform estaciona.sessao_encerrar(p_token); return estaciona.ok(jsonb_build_object('ok', true)); end if;
    if caminho = '/api/senha/verificar' then
      perform estaciona.exigir(p_token, true);
      return estaciona.rota_verificar_senha(p_corpo);
    end if;
    if caminho = '/api/restaurar' then
      perform estaciona.exigir(p_token, true, array['gerente']);
      dados := p_corpo -> 'dados';
      if estaciona.tipo(dados) <> 'object' or exists (select 1 from unnest(array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta']) x where (dados -> x) is null) then
        perform estaciona.falhar(400, 'Backup incompleto.');
      end if;
      perform estaciona.substituir_tudo(dados);
      return estaciona.ok(jsonb_build_object('ok', true));
    end if;
    if caminho = '/api/zerar' then
      perform estaciona.exigir(p_token, true, array['gerente']);
      perform estaciona.substituir_tudo(jsonb_build_object('usuarios', '[]'::jsonb, 'tickets', '[]'::jsonb, 'caixas', '[]'::jsonb,
        'mensalistas', '[]'::jsonb, 'log', '[]'::jsonb, 'config', '{}'::jsonb, 'meta', '{}'::jsonb));
      return estaciona.ok(jsonb_build_object('ok', true));
    end if;
    if caminho = '/api/nfse/emitir' then
      u := estaciona.exigir(p_token, true);
      if not estaciona.pode_emitir_nota(u) then perform estaciona.falhar(403, 'Seu perfil não pode emitir nota fiscal.'); end if;
      return estaciona.ok(estaciona.emitir_nota(p_corpo));
    end if;
  end if;

  perform estaciona.falhar(404, 'Não encontrado.');
  return null;
end $$;

-- ---------- Instalação ----------
-- Cria o usuário admin (se ainda não existir) e devolve a senha inicial. Rode no SQL Editor:  select estaciona.instalar();
create or replace function estaciona.instalar() returns text language plpgsql as $$
declare c text; senha text;
begin
  foreach c in array array['usuarios', 'tickets', 'caixas', 'mensalistas', 'log', 'config', 'meta'] loop
    insert into estaciona.controle(col, versao) values (c, 0) on conflict (col) do nothing;
  end loop;
  perform estaciona.travar();
  perform estaciona.garantir_usuarios();
  senha := estaciona.senha_admin_inicial();
  return 'Usuário do administrador: admin' || E'\n' || 'Senha inicial: ' || senha || E'\n' ||
         '(Troque-a na tela do administrador. Para ver de novo: select estaciona.senha_admin_inicial();)';
end $$;

create or replace function estaciona.redefinir_senha_admin() returns text language plpgsql as $$
declare nova text := estaciona.senha_aleatoria(); salt text := estaciona.novo_salt(); adm jsonb;
begin
  perform estaciona.travar();
  select doc into adm from estaciona.registros where col = 'usuarios' and doc ->> 'perfil' = 'admin' order by pos limit 1;
  if adm is null then perform estaciona.garantir_usuarios(); return 'Administrador criado: ' || estaciona.senha_admin_inicial(); end if;
  perform estaciona.confirmar('usuarios', jsonb_build_object('t', 'm', 'rm', '[]'::jsonb,
    'up', jsonb_build_array(adm || jsonb_build_object('salt', salt, 'hash', estaciona.hash_senha(nova, salt), 'ativo', true))));
  perform estaciona.prop_set('SENHA_ADMIN_INICIAL', nova);
  delete from estaciona.sessoes where uid = adm ->> 'id'; -- quem estava logado como admin precisa entrar de novo
  return 'Nova senha do admin: ' || nova;
end $$;

-- ---------- A ÚNICA porta de entrada pública ----------
-- O site chama POST /rest/v1/rpc/estaciona_api com { m, r, t, b } e recebe { s, c }.
-- Tudo roda com os direitos do dono (security definer), mas o que cada pessoa pode fazer é decidido por estaciona.exigir (sessão por token).
create or replace function public.estaciona_api(m text default 'GET', r text default '', t text default '', b jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = estaciona, pg_temp as $$
declare corpo jsonb := case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end; e jsonb;
begin
  return estaciona.rotear(upper(coalesce(m, 'GET')), coalesce(r, ''), coalesce(t, ''), corpo);
exception
  when sqlstate 'EH000' then
    e := sqlerrm::jsonb;
    return jsonb_build_object('s', (e ->> 's')::int,
      'c', jsonb_build_object('ok', false, 'erro', e ->> 'erro') || coalesce(e -> 'extra', '{}'::jsonb));
  when others then
    raise warning 'estaciona_api: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('s', 500, 'c', jsonb_build_object('ok', false, 'erro', 'Erro inesperado no servidor. Veja Logs > Postgres no Supabase.'));
end $$;

revoke all on function public.estaciona_api(text, text, text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.estaciona_api(text, text, text, jsonb) to anon;
    -- O Supabase limita a 3 s as chamadas da chave pública. Restaurar um backup grande precisa de mais.
    begin
      alter role anon set statement_timeout = '60s';
    exception when others then
      raise notice 'Não consegui ajustar o tempo máximo da chave pública (%). Restaurar backups muito grandes pode estourar 3 s.', sqlerrm;
    end;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.estaciona_api(text, text, text, jsonb) to authenticated;
  end if;
end $$;

-- O Postgres dá EXECUTE a todos em funções novas: tira das internas (a única função pública é estaciona_api).
revoke all on all functions in schema estaciona from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all functions in schema estaciona from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all functions in schema estaciona from authenticated; end if;
end $$;

-- Cria o administrador e MOSTRA a senha inicial (veja a aba Results). Pode rodar de novo.
select estaciona.instalar() as "ANOTE: usuário e senha do administrador";

-- Faz a API do Supabase enxergar a função nova.
notify pgrst, 'reload schema';
