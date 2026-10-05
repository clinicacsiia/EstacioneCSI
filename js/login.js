/* ============================================================
   login.js — entrada do sistema: usuário + senha.
   Os usuários (inclusive gerentes) são cadastrados pelo
   administrador em admin.html.
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  var raiz = Ui.$('#login-raiz');
  var VERSAO = '2.0';

  function irParaHome(u) {
    var home = Auth.homeDe(u);
    if (home) window.location.replace(home);
    else Auth.sair(false, true);
  }

  /** Depois de entrar: quem está com senha temporária (primeiro acesso ou senha redefinida) escolhe a própria senha antes de tudo. */
  function seguir(u) {
    if (Auth.precisaTrocarSenha(u)) mostrarTrocaSenha(u);
    else irParaHome(u);
  }

  /** Liga o botão 👁 que mostra/oculta o campo de senha ao lado. */
  function ligarVerSenha(botao, campos) {
    botao.onclick = function () {
      var mostrar = campos[0].type === 'password';
      campos.forEach(function (c) { c.type = mostrar ? 'text' : 'password'; });
      botao.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
      botao.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
    };
  }

  function mostrarTrocaSenha(u) {
    raiz.innerHTML =
      '<div class="login-marca"><div class="logo" aria-hidden="true">🔑</div><h1>Crie sua senha</h1>' +
      '<div class="mudo">Olá, ' + Ui.esc(u.nome) + '!</div></div>' +
      '<div class="card alerta mb pequeno">Você entrou com uma <b>senha temporária</b>. Escolha agora uma senha só sua para continuar (de 6 a 40 caracteres, diferente da temporária).</div>' +
      '<form id="f-troca" novalidate>' +
      '<div class="campo mb"><label class="rotulo" for="t-nova">Nova senha</label>' +
      '<div class="campo-senha"><input id="t-nova" type="password" maxlength="40" autocomplete="new-password" data-foco>' +
      '<button type="button" class="btn btn-contorno" id="t-ver" aria-label="Mostrar senha" aria-pressed="false">👁</button></div></div>' +
      '<div class="campo mb"><label class="rotulo" for="t-conf">Repita a nova senha</label>' +
      '<input id="t-conf" type="password" maxlength="40" autocomplete="new-password"></div>' +
      '<div class="dica erro" id="t-erro" role="alert"></div>' +
      '<button type="submit" class="btn btn-primario btn-grande btn-bloco mt" id="t-salvar">Salvar e entrar</button></form>' +
      '<div class="centro mt2 pequeno"><button type="button" class="btn btn-contorno" id="t-sair">Sair</button></div>' +
      rodapeStatus();

    var nova = Ui.$('#t-nova'), conf = Ui.$('#t-conf'), erroTroca = Ui.$('#t-erro');
    nova.focus();
    ligarVerSenha(Ui.$('#t-ver'), [nova, conf]);
    Ui.$('#t-sair').onclick = function () { Auth.sair(); };
    Ui.$('#f-troca').addEventListener('submit', function (ev) {
      ev.preventDefault();
      erroTroca.textContent = '';
      var r;
      try { r = Auth.trocarSenhaTemporaria(nova.value, conf.value); } catch (e) { r = { ok: false, erro: e.message }; }
      if (r.ok) { irParaHome(r.usuario); return; }
      erroTroca.textContent = r.erro;
      nova.focus();
    });
  }

  /** Pontinho verde/vermelho (conexão com o banco de dados) + versão, sempre no rodapé da tela de login. */
  function rodapeStatus() {
    var conectado = !Dados.semServidor;
    return '<div class="login-status">' +
      '<span class="ponto' + (conectado ? ' on' : '') + '" title="' + (conectado ? 'Conectado ao banco de dados' : 'Sem conexão com o banco de dados') + '"></span>' +
      ' v' + VERSAO + '</div>';
  }

  if (Dados.semServidor) {
    raiz.innerHTML = '<div class="card perigo"><b>' + Api.MSG_ERRO + '</b><br><br>' +
      '<button type="button" class="btn btn-primario" onclick="location.reload()">Tentar de novo</button></div>' + rodapeStatus();
    return;
  }

  var jaLogado = Auth.atual();
  if (jaLogado) { seguir(jaLogado); return; }

  var busca = window.location.search;
  var aviso = /inativo=1/.test(busca) ? '<div class="card alerta mb pequeno">Sessão encerrada por inatividade. Entre novamente.</div>'
    : (/semacesso=1/.test(busca) ? '<div class="card alerta mb pequeno">Seu perfil não tem nenhuma tela liberada. Fale com o administrador.</div>' : '');

  raiz.innerHTML =
    '<div class="login-marca"><div class="logo" aria-hidden="true">🅿️</div><h1>' + Ui.esc(Dados.config.estabelecimento) + '</h1>' +
    '<div class="mudo">Entre com seu usuário e senha</div></div>' + aviso +
    '<form id="f-login" novalidate>' +
    '<div class="campo mb"><label class="rotulo" for="l-usuario">Usuário</label>' +
    '<input id="l-usuario" type="text" maxlength="30" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" data-foco></div>' +
    '<div class="campo mb"><label class="rotulo" for="l-senha">Senha</label>' +
    '<div class="campo-senha"><input id="l-senha" type="password" maxlength="40" autocomplete="current-password">' +
    '<button type="button" class="btn btn-contorno" id="l-ver" aria-label="Mostrar senha" aria-pressed="false">👁</button></div></div>' +
    '<div class="dica erro" id="l-erro" role="alert"></div>' +
    '<button type="submit" class="btn btn-primario btn-grande btn-bloco mt" id="l-entrar">Entrar</button></form>' +
    '<div class="centro mt2 pequeno"><a href="painel.html" target="_blank" rel="noopener">Abrir painel do cliente (TV) ↗</a></div>' +
    rodapeStatus();

  var campoUsuario = Ui.$('#l-usuario'), campoSenha = Ui.$('#l-senha'), erro = Ui.$('#l-erro');
  campoUsuario.focus();

  ligarVerSenha(Ui.$('#l-ver'), [campoSenha]);

  Ui.$('#f-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    erro.textContent = '';
    if (!campoUsuario.value.trim() || !campoSenha.value) { erro.textContent = 'Informe o usuário e a senha.'; return; }
    var r;
    try { r = Auth.entrar(campoUsuario.value, campoSenha.value); } catch (e) { r = { ok: false, erro: e.message }; }
    if (r.ok) { seguir(r.usuario); return; }
    erro.textContent = r.erro;
    campoSenha.value = '';
    campoSenha.focus();
  });
})();
