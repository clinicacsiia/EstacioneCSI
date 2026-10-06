/* ============================================================
   manobrista.js — tela de quem trabalha na ponta (celular)
   Quatro abas: ENTRADA · BUSCAR (fila) · PÁTIO · FECHAMENTO
   Regra de ouro: só a placa é obrigatória; o resto é toque.
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('manobrista');
  if (!usuario) return;

  const R = Regras, $ = Ui.$, esc = Ui.esc;
  Ui.montarTopo({ pagina: 'Manobrista', ativo: 'manobrista' });
  Ui.iniciarRelogios();

  $('#lista-modelos').innerHTML = Ficha.MODELOS.map(m => `<option value="${m}">`).join('');

  const est = { categoria: 'carro', cor: '', patio: null, avarias: [], filtroPatio: 'todos', diaFechamento: 'hoje' };
  let vistos = null; // tickets pagos já conhecidos (para avisar quando entra um novo)
  const fotosEntrada = Auth.pode('foto.adicionar') ? Fotos.seletor($('#fotos-entrada')) : null;
  if (!fotosEntrada) $('#bloco-fotos').hidden = true;
  const fotosPendentes = []; // fotos que não subiram (sem sinal...): ficam aqui até dar certo ou serem descartadas { id, placa, itens, erro }

  // ============================================================
  //  ABAS
  // ============================================================
  const TITULO_ABA = { entrada: 'Nova entrada de veículo', fila: 'Veículos para buscar', patio: 'Veículos no pátio', fechamento: 'Meu fechamento' };
  function mostrarAba(nome) {
    Ui.$$('.aba').forEach(a => { a.hidden = a.id !== 'aba-' + nome; });
    Ui.$$('.tabbar button').forEach(b => {
      const ativa = b.dataset.aba === nome;
      b.classList.toggle('ativo', ativa);
      if (ativa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#titulo-aba').textContent = TITULO_ABA[nome] || '';
    try { sessionStorage.setItem('estacionamais.abaManobrista', nome); } catch (e) { /* ok */ }
    if (nome === 'entrada') $('#placa').focus();
    if (nome === 'patio') renderPatio();
    if (nome === 'fechamento') renderFechamento();
  }
  Ui.$$('.tabbar button').forEach(b => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

  // ============================================================
  //  FORMULÁRIO DE ENTRADA
  // ============================================================
  function renderCategorias() {
    const cfg = Dados.config, emoji = { carro: '🚗', moto: '🏍️', grande: '🚙' };
    if (!cfg.tabela[est.categoria]) est.categoria = 'carro';
    $('#grupo-categoria').innerHTML = Object.keys(cfg.tabela).map(k =>
      `<button type="button" class="tile ${est.categoria === k ? 'sel' : ''}" aria-pressed="${est.categoria === k}" data-cat="${k}"><span class="emoji" aria-hidden="true">${emoji[k] || '🚘'}</span>${esc(cfg.tabela[k].rotulo)}</button>`).join('');
  }

  function renderPatios() {
    const cfg = Dados.config, oc = R.ocupacao(Dados.tickets, cfg);
    const ativos = cfg.patios.filter(p => p.ativo !== false);
    if (!est.patio || !ativos.some(p => p.id === est.patio)) {
      const ult = Dados.meta.ultimoPatio;
      est.patio = ativos.some(p => p.id === ult) ? ult : ativos[0].id;
    }
    $('#grupo-patio').innerHTML = ativos.map(p => {
      const usados = oc[p.id] ? oc[p.id].usados : 0, cheio = p.capacidade > 0 && usados >= p.capacidade;
      return `<button type="button" class="tile ${est.patio === p.id ? 'sel' : ''} ${cheio ? 'cheio' : ''}" aria-pressed="${est.patio === p.id}" data-patio="${esc(p.id)}">${esc(p.nome)}<small>${usados}${p.capacidade ? ' / ' + p.capacidade : ''} ${usados === 1 && !p.capacidade ? 'carro' : 'carros'}${cheio ? ' · LOTADO' : ''}</small></button>`;
    }).join('');
  }

  function renderCores() {
    $('#grupo-cor').innerHTML = R.CORES.map(([nome, css]) =>
      `<button type="button" class="chip ${est.cor === nome ? 'sel' : ''}" aria-pressed="${est.cor === nome}" data-cor="${nome}"><span class="amostra" aria-hidden="true" style="background:${css}"></span>${nome}</button>`).join('');
    atualizarResumos();
  }

  function renderAvarias() {
    $('#grupo-avarias').innerHTML = R.AVARIAS.map(a =>
      `<button type="button" class="chip ${est.avarias.includes(a) ? 'sel' : ''}" aria-pressed="${est.avarias.includes(a)}" data-avaria="${esc(a)}">${esc(a)}</button>`).join('');
    atualizarResumos();
  }

  $('#grupo-categoria').addEventListener('click', ev => { const b = ev.target.closest('[data-cat]'); if (b) { est.categoria = b.dataset.cat; renderCategorias(); } });
  $('#grupo-patio').addEventListener('click', ev => { const b = ev.target.closest('[data-patio]'); if (b) { est.patio = b.dataset.patio; renderPatios(); } });
  $('#grupo-cor').addEventListener('click', ev => { const b = ev.target.closest('[data-cor]'); if (b) { est.cor = est.cor === b.dataset.cor ? '' : b.dataset.cor; renderCores(); } });
  $('#grupo-avarias').addEventListener('click', ev => {
    const b = ev.target.closest('[data-avaria]'); if (!b) return;
    const a = b.dataset.avaria;
    est.avarias = est.avarias.includes(a) ? est.avarias.filter(x => x !== a) : est.avarias.concat(a);
    renderAvarias();
  });

  // ----- resumo das seções recolhidas (o manobrista vê o que já preencheu sem abrir) -----
  function atualizarResumos() {
    const set = (id, txt, erro) => {
      const e = $('#' + id); if (!e) return;
      e.textContent = txt || '';
      e.classList.toggle('preenchido', !!txt && !erro);
      e.classList.toggle('erro-resumo', !!erro);
    };
    const plural = (n, um, varios) => n === 1 ? '1 ' + um : n + ' ' + varios;
    const nFotos = fotosEntrada ? fotosEntrada.itens().length : 0;
    const av = [];
    if (est.avarias.length) av.push(plural(est.avarias.length, 'avaria', 'avarias'));
    if ($('#avarias-desc').value.trim()) av.push('descrita');
    if (nFotos) av.push(plural(nFotos, 'foto', 'fotos'));
    set('res-avarias', av.join(' · '));
    set('res-objetos', $('#objetos-valor').value.trim() ? 'informado' : '');
    set('res-veiculo', [$('#modelo').value.trim(), est.cor].filter(Boolean).join(' · '));
    const cpfDigitos = $('#cpf').value.replace(/\D/g, ''), cpfRuim = cpfDigitos.length > 0 && !R.cpfValido(cpfDigitos);
    set('res-paciente', cpfRuim ? 'CPF a corrigir' : [$('#telefone').value.trim() ? 'telefone' : '', cpfDigitos ? 'CPF' : ''].filter(Boolean).join(' · '), cpfRuim);
    set('res-extras', $('#obs').value.trim() ? 'preenchida' : '');
  }
  $('#form-entrada').addEventListener('input', atualizarResumos);
  if (fotosEntrada) new MutationObserver(atualizarResumos).observe($('#fotos-entrada'), { childList: true, subtree: true });

  // ----- placa -----
  const inPlaca = $('#placa'), chkLivre = $('#placa-livre');

  function atualizarInfoPlaca() {
    calcularInfoPlaca();
    inPlaca.setAttribute('aria-invalid', String($('#placa-info').classList.contains('erro')));
  }

  // ----- placa repetida: puxa os dados da última visita (só preenche o que está vazio) -----
  const ROTULO_AUTO = { categoria: 'tipo', modelo: 'modelo', cor: 'cor', telefone: 'telefone', cpf: 'CPF' };
  let auto = {};          // campo -> valor que ESTE código preencheu (para desfazer se a placa mudar)
  let autoChave = null;   // placa (sem hífen) cujos dados já foram puxados
  let autoVisita = null;  // ticket usado como fonte

  const ultimaVisita = chave => Dados.tickets
    .filter(t => t.status !== 'CANCELADO' && R.chavePlaca(t.placa) === chave)
    .sort((a, b) => b.entradaEm - a.entradaEm)[0];

  /** Se a placa mudou (erro de digitação corrigido) tira o que foi puxado e o manobrista não mexeu. */
  function limparAuto() {
    if (!autoChave && !Object.keys(auto).length) return;
    ['modelo', 'telefone', 'cpf'].forEach(c => { if (auto[c] !== undefined && $('#' + c).value === auto[c]) $('#' + c).value = ''; });
    if (auto.cor !== undefined && est.cor === auto.cor) est.cor = '';
    if (auto.categoria !== undefined && est.categoria === auto.categoria) est.categoria = 'carro';
    const mexeu = Object.keys(auto).length > 0;
    auto = {}; autoChave = null; autoVisita = null;
    if (mexeu) { renderCategorias(); renderCores(); atualizarInfoCpf(); }
  }

  function aplicarHistorico(chave) {
    if (autoChave === chave) return;
    limparAuto();
    autoChave = chave;
    const u = ultimaVisita(chave);
    if (!u) return;
    autoVisita = u;
    const vazio = id => !$('#' + id).value.trim();
    if (u.modelo && vazio('modelo')) { $('#modelo').value = u.modelo; auto.modelo = u.modelo; }
    if (u.telefone && vazio('telefone')) { $('#telefone').value = u.telefone; auto.telefone = u.telefone; }
    if (u.cpf && vazio('cpf')) { const f = R.formatarCpf(u.cpf); $('#cpf').value = f; auto.cpf = f; }
    if (u.cor && !est.cor) { est.cor = u.cor; auto.cor = u.cor; }
    if (u.categoria && u.categoria !== est.categoria && est.categoria === 'carro' && Dados.config.tabela[u.categoria]) { est.categoria = u.categoria; auto.categoria = u.categoria; }
    if (Object.keys(auto).length) { renderCategorias(); renderCores(); atualizarInfoCpf(); }
  }

  function calcularInfoPlaca() {
    const v = inPlaca.value, info = $('#placa-info'), livre = chkLivre.checked;
    $('#linha-livre').hidden = !(v.length >= 6 || livre);
    if (!v) { limparAuto(); info.className = 'dica'; info.textContent = ''; return; }
    const res = R.validarPlaca(v, livre);
    if (!res.ok) {
      limparAuto();
      info.className = v.length < 7 ? 'dica' : 'dica erro';
      info.textContent = v.length < 7 ? 'Digite os 7 caracteres da placa.' : res.erro;
      return;
    }
    const chave = R.chavePlaca(res.placa);
    const dentro = Dados.tickets.find(t => R.estaAtivo(t) && R.chavePlaca(t.placa) === chave);
    if (dentro) {
      limparAuto();
      info.className = 'dica erro';
      info.textContent = `⚠ Este veículo já está no pátio: ticket #${dentro.id} (${R.nomePatio(Dados.config, dentro.patio)}).`;
      return;
    }
    const mens = R.mensalistaVigente(chave, Dados.mensalistas, Date.now());
    aplicarHistorico(chave);
    const puxados = Object.keys(auto).map(c => ROTULO_AUTO[c]);
    info.className = 'dica ok';
    info.textContent = `✔ ${res.formato} · ${res.placa}` + (mens ? ` · MENSALISTA (${mens.nome}) — sem cobrança` : '') +
      (autoVisita && puxados.length ? ` · Já esteve aqui em ${Ui.data(autoVisita.entradaEm)}. Preenchi: ${puxados.join(', ')}. Confira.` : '');
  }

  inPlaca.addEventListener('input', () => {
    inPlaca.value = inPlaca.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, chkLivre.checked ? 10 : 7);
    atualizarInfoPlaca();
  });
  chkLivre.addEventListener('change', atualizarInfoPlaca);

  // ----- CPF (opcional, mas se vier preenchido tem que ser válido) -----
  const inCpf = $('#cpf');
  function atualizarInfoCpf() {
    calcularInfoCpf();
    inCpf.setAttribute('aria-invalid', String($('#cpf-info').classList.contains('erro')));
    atualizarResumos();
  }
  function calcularInfoCpf() {
    const info = $('#cpf-info'), d = inCpf.value.replace(/\D/g, '');
    if (!d) { info.className = 'dica'; info.textContent = ''; return; }
    if (d.length < 11) { info.className = 'dica'; info.textContent = 'Digite os 11 números do CPF.'; return; }
    const ok = R.cpfValido(d);
    info.className = ok ? 'dica ok' : 'dica erro';
    info.textContent = ok ? '✔ CPF válido' : 'CPF inválido. Confira os números.';
  }
  inCpf.addEventListener('input', () => { inCpf.value = R.formatarCpf(inCpf.value); atualizarInfoCpf(); });

  // ----- envio -----
  const form = $('#form-entrada');
  form.addEventListener('keydown', ev => {
    // Enter só envia a partir da placa; nos outros campos apenas "confirma" o campo.
    if (ev.key === 'Enter' && ev.target.id !== 'placa' && ev.target.tagName !== 'TEXTAREA' && ev.target.type !== 'submit') ev.preventDefault();
  });
  form.addEventListener('submit', ev => { ev.preventDefault(); enviarEntrada(); });

  function enviarEntrada() {
    if (fotosEntrada && fotosEntrada.ocupado()) { Ui.toast('Aguarde a foto terminar de carregar.', 'aviso'); return; }
    const fotos = fotosEntrada ? fotosEntrada.itens() : [];
    const r = Op.registrarEntrada({
      placa: inPlaca.value, placaLivre: chkLivre.checked, categoria: est.categoria,
      modelo: $('#modelo').value, cor: est.cor, patio: est.patio, vaga: $('#vaga').value,
      telefone: $('#telefone').value, cpf: inCpf.value, avarias: est.avarias, avariasDescricao: $('#avarias-desc').value,
      objetosValor: $('#objetos-valor').value, obs: $('#obs').value
    });
    if (!r.ok) {
      Ui.toast(r.erro, 'erro');
      const campo = r.campo === 'cpf' ? inCpf : inPlaca;
      if (r.campo === 'cpf') $('#det-paciente').open = true; // o campo precisa estar à vista para receber o foco
      campo.setAttribute('aria-invalid', 'true');
      campo.focus();
      return;
    }
    if (r.aviso) Ui.toast(r.aviso, 'aviso', 6500);
    mostrarUltimo(r.ticket, r.mensalista);
    limparFormulario();
    Impressao.imprimirTicket(r.ticket);
    if (fotos.length) enviarFotos(r.ticket, fotos);
  }

  // ----- fotos da entrada: sobem depois que o ticket existe (a impressão não espera) -----
  async function enviarFotos(ticket, itens) {
    const r = await Fotos.enviar(ticket.id, itens);
    if (!r.falhas.length) { Ui.toast(`📷 ${r.enviadas === 1 ? 'Foto enviada' : r.enviadas + ' fotos enviadas'} (ticket #${ticket.id}).`, 'sucesso'); return; }
    fotosPendentes.push({ id: ticket.id, placa: ticket.placa, itens: r.falhas, erro: r.erro });
    renderPendentes();
    Ui.toast(`⚠ Ticket #${ticket.id}: ${r.falhas.length === 1 ? 'a foto NÃO foi enviada' : r.falhas.length + ' fotos NÃO foram enviadas'}. ${r.erro}`, 'aviso', 9000);
  }

  function renderPendentes() {
    const box = $('#fotos-pendentes');
    box.hidden = !fotosPendentes.length;
    box.innerHTML = fotosPendentes.map((p, i) => `<div class="card alerta mb" role="alert">
      <b><span aria-hidden="true">⚠</span> Ticket #${esc(p.id)} · ${esc(p.placa)}:</b> ${p.itens.length === 1 ? '1 foto não foi enviada' : p.itens.length + ' fotos não foram enviadas'}. ${esc(p.erro)}
      <div class="gap mt"><button type="button" class="btn btn-sm btn-primario" data-reenviar="${i}" ${p.enviando ? 'disabled' : ''}>${p.enviando ? 'Enviando...' : 'Tentar de novo'}</button>
        <button type="button" class="btn btn-sm btn-contorno" data-descartar="${i}">Descartar</button></div></div>`).join('');
  }

  $('#fotos-pendentes').addEventListener('click', async ev => {
    const re = ev.target.closest('[data-reenviar]'), de = ev.target.closest('[data-descartar]');
    if (de) {
      const p = fotosPendentes[Number(de.dataset.descartar)];
      if (p && await Ui.confirmar({ titulo: 'Descartar fotos?', mensagem: `As fotos do ticket #${p.id} que não subiram serão perdidas. Para tirá-las de novo, use a ficha do veículo.`, ok: 'Descartar', perigo: true })) {
        fotosPendentes.splice(fotosPendentes.indexOf(p), 1); renderPendentes();
      }
      return;
    }
    if (!re) return;
    const p = fotosPendentes[Number(re.dataset.reenviar)];
    if (!p || p.enviando) return; // o item guarda o "enviando": a lista é redesenhada quando outro termina e o botão não pode voltar a valer
    p.enviando = true; renderPendentes();
    const r = await Fotos.enviar(p.id, p.itens);
    p.enviando = false;
    if (r.falhas.length) { p.itens = r.falhas; p.erro = r.erro; Ui.toast(r.erro, 'erro'); }
    else { fotosPendentes.splice(fotosPendentes.indexOf(p), 1); Ui.toast('📷 Fotos enviadas.', 'sucesso'); }
    renderPendentes();
  });

  // não deixa fechar a página com foto que ainda não subiu
  window.addEventListener('beforeunload', ev => { if (fotosPendentes.length) { ev.preventDefault(); ev.returnValue = ''; } });

  function limparFormulario() {
    auto = {}; autoChave = null; autoVisita = null;
    inPlaca.value = ''; chkLivre.checked = false;
    $('#modelo').value = ''; $('#vaga').value = ''; $('#telefone').value = ''; $('#obs').value = '';
    inCpf.value = ''; $('#avarias-desc').value = ''; $('#objetos-valor').value = '';
    est.cor = ''; est.avarias = []; est.categoria = 'carro';
    if (fotosEntrada) fotosEntrada.limpar();
    Ui.$$('#form-entrada details').forEach(d => { d.open = false; });
    renderCategorias(); renderCores(); renderAvarias(); renderPatios(); atualizarInfoPlaca(); atualizarInfoCpf();
    inPlaca.focus();
  }

  function mostrarUltimo(t, mens) {
    const box = $('#ultimo-ticket');
    box.hidden = false;
    box.innerHTML = `<div class="gap"><div class="espaco"><b><span aria-hidden="true">✔</span> Ticket #${esc(t.id)} criado</b> · <span class="mono negrito">${esc(t.placa)}</span><br>
      <span class="mudo pequeno">${esc(R.localVeiculo(t, Dados.config))}${mens ? ' · MENSALISTA (sem cobrança)' : ''}</span></div>
      <button type="button" class="btn btn-sm btn-contorno" data-ver="${esc(t.id)}"><span aria-hidden="true">👁</span> Ver</button>
      <button type="button" class="btn btn-sm btn-contorno" data-reimp="${esc(t.id)}"><span aria-hidden="true">🖨️</span> Reimprimir</button></div>`;
  }
  $('#ultimo-ticket').addEventListener('click', ev => {
    const v = ev.target.closest('[data-ver]'); if (v) { Ficha.verTicket(v.dataset.ver); return; }
    const b = ev.target.closest('[data-reimp]'); if (b) reimprimir(b.dataset.reimp);
  });

  const reimprimir = Ficha.reimprimir;

  // ============================================================
  //  FILA (para buscar / a caminho)
  // ============================================================
  const rotuloFicha = t => `Abrir ficha do ticket ${t.id}, placa ${t.placa}`;
  // cartão clicável também responde a Enter e Espaço
  function teclaCartao(ev) {
    const c = ev.target.closest('.item-corpo[role=button]');
    if (c && c === ev.target && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); c.click(); }
  }
  ['#lista-fila', '#lista-caminho', '#lista-patio'].forEach(sel => $(sel).addEventListener('keydown', teclaCartao));

  function cartaoFila(t) {
    const cfg = Dados.config, perdido = t.ticketPerdido;
    return `<div class="item ${perdido ? 'verm' : 'azul'}">
      <div class="item-corpo" data-ficha="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(rotuloFicha(t))}">
        <div><span class="item-ticket">#${esc(t.id)}</span> ${perdido ? '<span class="badge verm"><span aria-hidden="true">⚠</span> TICKET PERDIDO</span>' : ''} ${Fotos.selo(t)}</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
        <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · esperando <b data-desde="${t.pagoEm}" data-fmt="cron" data-alerta="3,6">00:00</b></div>
      </div>
      <div class="item-acoes"><button type="button" class="btn btn-primario btn-grande" data-acao="buscar" data-id="${esc(t.id)}" aria-label="Buscar veículo ${esc(t.placa)}, ticket ${esc(t.id)}"><span aria-hidden="true">🔑</span> BUSCAR</button></div>
    </div>`;
  }

  function cartaoCaminho(t) {
    const cfg = Dados.config, perdido = t.ticketPerdido;
    const zap = t.telefone && t.telefone.length >= 10
      ? `<a class="btn btn-sm btn-contorno" target="_blank" rel="noopener" aria-label="Avisar o paciente do veículo ${esc(t.placa)} pelo WhatsApp (abre em nova janela)" href="https://wa.me/${t.telefone.length <= 11 ? '55' : ''}${t.telefone}?text=${encodeURIComponent('Olá! Seu veículo ' + t.placa + ' está a caminho da retirada.')}"><span aria-hidden="true">📱</span> Avisar</a>` : '';
    return `<div class="item ${perdido ? 'verm' : 'verde'}">
      <div class="item-corpo" data-ficha="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(rotuloFicha(t))}">
        <div><span class="item-ticket">#${esc(t.id)}</span> ${perdido ? '<span class="badge verm"><span aria-hidden="true">⚠</span> SEM TICKET · CONFERIR DOCUMENTO</span>' : ''} ${Fotos.selo(t)}</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
        <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · a caminho há <b data-desde="${t.buscaEm}" data-fmt="cron">00:00</b></div>
      </div>
      <div class="item-acoes">
        <button type="button" class="btn btn-sucesso btn-grande" data-acao="entregar" data-id="${esc(t.id)}" aria-label="Entregar veículo ${esc(t.placa)}, ticket ${esc(t.id)}"><span aria-hidden="true">✅</span> ${perdido ? 'ENTREGAR (sem ticket)' : 'ENTREGAR'}</button>
        ${zap}<button type="button" class="btn btn-link" data-acao="desfazer" data-id="${esc(t.id)}" aria-label="Desfazer a busca do veículo ${esc(t.placa)}">desfazer</button>
      </div>
    </div>`;
  }

  function renderFila() {
    const pagos = Dados.tickets.filter(t => t.status === 'PAGO').sort((a, b) => a.pagoEm - b.pagoEm);
    const caminho = Dados.tickets.filter(t => t.status === 'A_CAMINHO').sort((a, b) => a.buscaEm - b.buscaEm);
    $('#lista-fila').innerHTML = pagos.length ? pagos.map(cartaoFila).join('') : '<div class="vazio">Nenhum carro esperando. 👍</div>';
    $('#lista-caminho').innerHTML = caminho.length ? caminho.map(cartaoCaminho).join('') : '<div class="vazio">Nenhum carro a caminho.</div>';
    const cf = $('#cont-fila'), cc = $('#cont-caminho');
    cf.textContent = pagos.length; cf.classList.toggle('zero', !pagos.length);
    cc.textContent = caminho.length; cc.classList.toggle('zero', !caminho.length);
    atualizarMarcas();
  }

  // contadores das abas: o número aparece na tela e é lido junto com o nome da aba
  function atualizarMarcas() {
    const nf = Dados.tickets.filter(t => t.status === 'PAGO').length, np = R.ativos(Dados.tickets).length;
    [['fila', nf, 'Buscar', n => n === 1 ? '1 veículo esperando' : n + ' veículos esperando'],
     ['patio', np, 'Pátio', n => n === 1 ? '1 veículo' : n + ' veículos']].forEach(([aba, n, nome, texto]) => {
      const m = $('#marca-' + aba); m.textContent = n; m.classList.toggle('zero', !n);
      Ui.$$('.tabbar button').find(b => b.dataset.aba === aba).setAttribute('aria-label', n ? nome + ', ' + texto(n) : nome);
    });
  }

  function verificarNovos() {
    const ids = Dados.tickets.filter(t => t.status === 'PAGO').map(t => t.id);
    if (vistos === null) { vistos = new Set(ids); return; }
    const novos = ids.filter(id => !vistos.has(id));
    vistos = new Set(ids);
    if (novos.length) {
      const t = Op.achar(novos[0]);
      Ui.bip();
      Ui.toast(`🔔 Buscar: ${t.placa}${novos.length > 1 ? ' (+' + (novos.length - 1) + ')' : ''}`, 'info', 6000);
    }
  }

  function tratarResultado(r, ok) {
    if (r.ok) { if (ok) Ui.toast(ok, 'sucesso'); return true; }
    Ui.toast(r.erro, 'erro'); return false;
  }

  ['#lista-fila', '#lista-caminho'].forEach(sel => $(sel).addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]');
    if (b) {
      const id = b.dataset.id, a = b.dataset.acao;
      if (a === 'buscar') { const r = Op.buscar(id); if (tratarResultado(r)) Ui.toast(`Buscando ${r.ticket.placa} — ${R.localVeiculo(r.ticket, Dados.config)}`, 'info'); }
      else if (a === 'entregar') abrirEntrega(id);
      else if (a === 'desfazer') Ui.confirmar({ titulo: 'Desfazer busca?', mensagem: 'O veículo volta para a fila "Para buscar".', ok: 'Desfazer' }).then(sim => { if (sim) tratarResultado(Op.desfazerBusca(id), 'Voltou para a fila.'); });
      return;
    }
    const f = ev.target.closest('[data-ficha]');
    if (f) Ficha.editar(f.dataset.ficha);
  }));

  // ============================================================
  //  ENTREGA (bipar o ticket)
  // ============================================================
  function abrirEntrega(id) {
    const t = Op.achar(id);
    if (!t || t.status !== 'A_CAMINHO') { Ui.toast('Este veículo não está mais "a caminho".', 'aviso'); return; }
    const cfg = Dados.config, p = t.ticketPerdido;
    const podeCamera = 'BarcodeDetector' in window && !!navigator.mediaDevices;
    const cab = `<div class="centro mb"><div class="item-ticket">Ticket #${esc(t.id)}</div><div class="item-placa">${esc(t.placa)}</div>
      <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div><div class="item-meta">${esc(R.localVeiculo(t, cfg))}</div>
      <button type="button" class="btn btn-sm btn-contorno mt" id="ent-fotos"><span aria-hidden="true">📷</span> Fotos / problema ${Fotos.qtd(t) ? '(' + Fotos.qtd(t) + ')' : ''}</button></div>`;
    const corpo = p
      ? `<div class="card perigo mb"><b>⚠ TICKET PERDIDO</b><br>Quem retira: <b>${esc(p.nome)}</b><br>Documento: <b class="mono">${esc(p.documento)}</b>` +
        `${p.autorizadoPor ? '<br>Autorizado por: ' + esc(p.autorizadoPor) : ''}</div>
         <label class="check"><input type="checkbox" id="ent-doc" data-foco> Conferi o documento e o cliente descreveu o veículo corretamente.</label>
         <div class="dica erro" id="ent-erro" role="alert"></div>`
      : `<label class="rotulo" for="ent-cod">Bipe o ticket ou digite o número</label>
         <input id="ent-cod" class="input-busca" type="text" inputmode="numeric" autocomplete="off" data-foco placeholder="#${esc(t.id)}">
         ${podeCamera ? '<button type="button" class="btn btn-contorno btn-bloco mt" id="ent-cam"><span aria-hidden="true">📷</span> Ler com a câmera</button>' : ''}
         <div class="dica erro" id="ent-erro" role="alert"></div>`;

    const m = Ui.modal({
      titulo: 'Entregar veículo', html: cab + corpo,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        {
          id: 'ok', rotulo: '✅ Confirmar entrega', classe: 'btn-sucesso', padrao: true, desabilitado: !!p,
          aoClicar: mm => {
            const r = Op.entregar(id, p ? { confirmouDocumento: $('#ent-doc', mm.corpo).checked } : { codigo: $('#ent-cod', mm.corpo).value });
            if (r.ok) { mm.fechar(); Ui.toast(`Veículo ${r.ticket.placa} entregue. Bom trabalho!`, 'sucesso'); return; }
            if (r.codigo === 'VENCIDO') {
              mm.fechar();
              Ui.modal({
                titulo: '⚠ Pagamento vencido', largura: 'sm', semFechar: true,
                html: `<p style="margin-top:0;font-size:1.1rem">${esc(r.erro)}</p><p class="mudo">Não entregue o veículo. Peça ao cliente que volte ao caixa.</p>`,
                botoes: [{ rotulo: 'Entendi', classe: 'btn-primario', padrao: true, aoClicar: x => x.fechar() }]
              });
              return;
            }
            if (r.codigo === 'CONFLITO') { mm.fechar(); Ui.toast(r.erro, 'aviso'); return; }
            $('#ent-erro', mm.corpo).textContent = r.erro;
            const c = $('#ent-cod', mm.corpo); if (c) { c.value = ''; c.focus(); }
            if (navigator.vibrate) navigator.vibrate(200);
          }
        }
      ]
    });
    $('#ent-fotos', m.corpo).addEventListener('click', () => Fotos.abrir(id));
    if (p) $('#ent-doc', m.corpo).addEventListener('change', e => { m.botao('ok').disabled = !e.target.checked; });
    const cam = $('#ent-cam', m.corpo);
    if (cam) cam.addEventListener('click', () => lerCamera(codigo => { $('#ent-cod', m.corpo).value = codigo; m.botao('ok').click(); }));
  }

  async function lerCamera(aoLer) {
    let stream = null, ativo = true;
    const m = Ui.modal({
      titulo: 'Aponte para o código de barras', largura: 'sm',
      html: '<video id="cam-video" aria-label="Imagem da câmera" playsinline muted style="width:100%;border-radius:12px;background:#000;min-height:180px"></video><div class="dica" id="cam-msg" role="status">Procurando código...</div>',
      aoFechar: () => { ativo = false; if (stream) stream.getTracks().forEach(t => t.stop()); },
      botoes: [{ rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() }]
    });
    try {
      const det = new BarcodeDetector({ formats: ['code_39', 'code_128', 'qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('#cam-video', m.corpo); v.srcObject = stream; await v.play();
      const laco = async () => {
        if (!ativo) return;
        try { const r = await det.detect(v); if (r.length) { ativo = false; m.fechar(); aoLer(r[0].rawValue); return; } } catch (e) { /* tenta de novo */ }
        setTimeout(laco, 250);
      };
      laco();
    } catch (e) {
      m.fechar();
      Api.falha('Não consegui usar a câmera: ' + (e.message || e.name));
      Ui.toast(Api.MSG_ERRO, 'erro');
    }
  }

  // ============================================================
  //  PÁTIO (todos os veículos + correção)
  // ============================================================
  function renderPatio() {
    const cfg = Dados.config;
    const chips = [['todos', 'Todos']].concat(cfg.patios.filter(p => p.ativo !== false).map(p => [p.id, p.nome]));
    $('#filtro-patio').innerHTML = chips.map(([id, nome]) => `<button type="button" class="chip ${est.filtroPatio === id ? 'sel' : ''}" aria-pressed="${est.filtroPatio === id}" data-fp="${esc(id)}">${esc(nome)}</button>`).join('');
    let lista = R.ativos(Dados.tickets);
    if (est.filtroPatio !== 'todos') lista = lista.filter(t => t.patio === est.filtroPatio);
    lista = R.buscar(lista, $('#busca-patio').value);
    lista.sort((a, b) => b.entradaEm - a.entradaEm);
    const cls = { ESTACIONADO: ['', 'No pátio'], PAGO: ['azul', 'Pago · na fila'], A_CAMINHO: ['verde', 'A caminho'] };
    $('#lista-patio').innerHTML = lista.length ? lista.slice(0, 80).map(t => `
      <div class="item ${t.ticketPerdido ? 'verm' : (t.status === 'ESTACIONADO' ? '' : cls[t.status][0])}">
        <div class="item-corpo" data-ficha="${esc(t.id)}" role="button" tabindex="0" aria-label="${esc(rotuloFicha(t))}">
          <div><span class="item-ticket">#${esc(t.id)}</span> <span class="badge ${cls[t.status][0]}">${cls[t.status][1]}</span>
            ${t.mensalistaId ? '<span class="badge amar">Mensalista</span>' : ''} ${Fotos.selo(t)}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · há <b data-desde="${t.entradaEm}" data-fmt="min">—</b></div>
        </div>
        <div class="item-acoes"><button type="button" class="btn btn-sm btn-contorno" data-ficha="${esc(t.id)}" aria-label="Editar ficha do ticket ${esc(t.id)}"><span aria-hidden="true">✏️</span> Ficha</button>
          <button type="button" class="btn btn-sm btn-contorno" data-ver="${esc(t.id)}" aria-label="Ver o ticket ${esc(t.id)}"><span aria-hidden="true">👁</span> Ver ticket</button>
          <button type="button" class="btn btn-sm btn-contorno" data-reimp="${esc(t.id)}" aria-label="Reimprimir o ticket ${esc(t.id)}"><span aria-hidden="true">🖨️</span> Ticket</button></div>
      </div>`).join('') + (lista.length > 80 ? '<div class="vazio">Mostrando 80 de ' + lista.length + '. Refine a busca.</div>' : '')
      : '<div class="vazio">Nenhum veículo encontrado.</div>';
    atualizarMarcas();
  }

  $('#filtro-patio').addEventListener('click', ev => { const b = ev.target.closest('[data-fp]'); if (b) { est.filtroPatio = b.dataset.fp; renderPatio(); } });
  $('#busca-patio').addEventListener('input', () => renderPatio());
  $('#lista-patio').addEventListener('click', ev => {
    const v = ev.target.closest('[data-ver]'); if (v) { Ficha.verTicket(v.dataset.ver); return; }
    const r = ev.target.closest('[data-reimp]'); if (r) { reimprimir(r.dataset.reimp); return; }
    const f = ev.target.closest('[data-ficha]'); if (f) Ficha.editar(f.dataset.ficha);
  });

  // ============================================================
  //  FECHAMENTO (o que EU fiz hoje ou ontem — nunca o movimento dos colegas)
  // ============================================================
  const ROTULO_ACAO = { entrada: 'Entrada', busca: 'Busca', entrega: 'Entrega' };

  function renderFechamento() {
    const agora = Date.now();
    $('#filtro-dia').innerHTML = ['hoje', 'ontem'].map(dia => {
      const per = R.periodoFechamento(dia, agora);
      return `<button type="button" class="chip ${est.diaFechamento === dia ? 'sel' : ''}" aria-pressed="${est.diaFechamento === dia}" data-dia="${dia}">${dia === 'hoje' ? 'Hoje' : 'Ontem'} · ${Ui.data(per.ini).slice(0, 5)}</button>`;
    }).join('');

    const per = R.periodoFechamento(est.diaFechamento, agora);
    const res = R.atendimentosManobrista(Dados.tickets, usuario.id, per.ini, per.fim);
    const kpi = (rot, n) => `<div class="centro"><div class="negrito" style="font-size:1.6rem">${n}</div><div class="mudo pequeno">${rot}</div></div>`;
    $('#resumo-fechamento').innerHTML = kpi('Entradas', res.entradas) + kpi('Buscas', res.buscas) + kpi('Entregas', res.entregas);

    const cfg = Dados.config;
    $('#lista-fechamento').innerHTML = res.itens.length ? res.itens.map(({ ticket: t, acoes }) => `
      <div class="item ${t.status === 'ENTREGUE' ? 'verde' : t.status === 'CANCELADO' ? 'verm' : 'azul'}">
        <div class="item-corpo">
          <div><span class="item-ticket">#${esc(t.id)}</span> <span class="badge ${t.status === 'ENTREGUE' ? 'verde' : t.status === 'CANCELADO' ? 'verm' : 'azul'}">${esc(R.ROTULO_STATUS[t.status] || t.status)}</span></div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${acoes.map(a => `${ROTULO_ACAO[a.tipo]} <b>${Ui.hora(a.em)}</b>`).join(' · ')}</div>
        </div>
      </div>`).join('') : `<div class="vazio">Nenhum veículo atendido por você ${est.diaFechamento === 'hoje' ? 'hoje' : 'ontem'}.</div>`;
  }

  $('#filtro-dia').addEventListener('click', ev => {
    const b = ev.target.closest('[data-dia]'); if (b) { est.diaFechamento = b.dataset.dia; renderFechamento(); }
  });

  // ============================================================
  //  DESENHO GERAL + TEMPO REAL
  // ============================================================
  function renderTudo() {
    renderCategorias(); renderPatios(); renderCores(); renderAvarias(); renderFila();
    if (!$('#aba-fechamento').hidden) renderFechamento();
    if (!$('#aba-patio').hidden) renderPatio();
    atualizarInfoPlaca();
  }

  Dados.aoMudar((nome) => {
    if (nome === 'log' || nome === 'meta') return;
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    Ui.agendar(() => { verificarNovos(); renderTudo(); });
  });

  verificarNovos();
  renderTudo();
  let abaInicial = 'entrada';
  try { abaInicial = sessionStorage.getItem('estacionamais.abaManobrista') || 'entrada'; } catch (e) { /* ok */ }
  mostrarAba(['entrada', 'fila', 'patio', 'fechamento'].includes(abaInicial) ? abaInicial : 'entrada');
})();
