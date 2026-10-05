/* ============================================================
   api.js — como o site fala com o servidor (Supabase)
   ------------------------------------------------------------
   O "servidor" é a função estaciona_api do banco (supabase/schema.sql).
   O endereço e a chave pública ficam em js/config.js.
   Para o resto do sistema nada mudou: cada pedido é um POST com
   { m: método, r: rota, t: token, b: corpo } e a resposta volta
   { s: status, c: corpo }. O token do login fica no sessionStorage
   (fechar a aba encerra o login).
   O resto do sistema usa só Api.requisitar (síncrona) e Api.buscar (Promise).
   ============================================================ */
(function (global) {
  'use strict';

  var URL_BASE = String(global.ESTACIONA_SUPABASE_URL || '').replace(/\s+/g, '').replace(/\/+$/, '');
  var CHAVE = String(global.ESTACIONA_SUPABASE_KEY || '').replace(/\s+/g, '');
  var CONFIGURADO = /^https:\/\/[^/]+\.supabase\.co$/i.test(URL_BASE) && CHAVE.length > 10;
  var ENDERECO = CONFIGURADO ? URL_BASE + '/rest/v1/rpc/estaciona_api' : '';
  var CHAVE_TOKEN = 'estacionamais.token';
  var MSG_RESPOSTA = 'O servidor (Supabase) não respondeu como esperado. Confira a URL e a chave em js/config.js, se o supabase/schema.sql foi executado e se o projeto não está pausado.';
  var MSG_SEM_CONFIG = 'Servidor não configurado. Preencha a URL e a chave do Supabase em js/config.js (veja supabase/LEIA-ME.md).';

  function lerToken() { try { return global.sessionStorage.getItem(CHAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function guardarToken(t) {
    try { if (t) global.sessionStorage.setItem(CHAVE_TOKEN, t); else global.sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* ok */ }
  }

  function pedido(metodo, url, corpo) {
    return JSON.stringify({ m: metodo, r: url, t: lerToken(), b: corpo === undefined ? {} : corpo });
  }

  /** Confere o envelope { s, c } e cuida do token. Devolve { status, corpo }. */
  function abrirEnvelope(url, texto) {
    var env = null;
    try { env = JSON.parse(texto); } catch (e) { /* não é JSON: erro do gateway (chave errada, projeto pausado...) */ }
    if (!env || typeof env.s !== 'number') return { status: 502, corpo: { ok: false, erro: MSG_RESPOSTA } };
    var c = env.c;
    if (c && typeof c.token === 'string') guardarToken(c.token);
    if (env.s === 401 || url === '/api/logout') guardarToken('');
    return { status: env.s, corpo: c === undefined ? null : c };
  }

  /** Chamada síncrona. Devolve { status, corpo } (status 0 = sem conexão). */
  function requisitar(metodo, url, corpo) {
    if (!CONFIGURADO) return { status: 503, corpo: { ok: false, erro: MSG_SEM_CONFIG } };
    var x = new XMLHttpRequest();
    try {
      x.open('POST', ENDERECO, false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.setRequestHeader('apikey', CHAVE);
      x.send(pedido(metodo, url, corpo));
    } catch (e) { return { status: 0, corpo: null }; }
    if (!x.status) return { status: 0, corpo: null };
    return abrirEnvelope(url, x.responseText);
  }

  /**
   * Chamada assíncrona (sondagem, painel, nota fiscal). Devolve uma Promise de
   * { ok, status, json() }. opc: { metodo, corpo, signal }.
   */
  function buscar(url, opc) {
    opc = opc || {};
    if (!CONFIGURADO) {
      return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({ ok: false, erro: MSG_SEM_CONFIG }); } });
    }
    return global.fetch(ENDERECO, {
      method: 'POST', cache: 'no-store', redirect: 'follow', signal: opc.signal,
      headers: { 'Content-Type': 'application/json', 'apikey': CHAVE },
      body: pedido(opc.metodo || 'GET', url, opc.corpo)
    }).then(function (r) { return r.text(); }).then(function (texto) {
      var a = abrirEnvelope(url, texto);
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: function () { return Promise.resolve(a.corpo); } };
    });
  }

  global.Api = {
    configurado: CONFIGURADO,
    endereco: ENDERECO,
    intervaloMs: 3000,          // sondagem "o que mudou?" (leve: só as versões, e baixa só as diferenças)
    intervaloPainelMs: 3000,
    limiteBuscaMs: 30000,       // tempo máximo de uma consulta (o Supabase responde em ~0,2 s; só um projeto pausado demora)
    requisitar: requisitar,
    buscar: buscar
  };
})(window);
