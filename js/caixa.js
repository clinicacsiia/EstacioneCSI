/* ============================================================
   caixa.js — tela do atendente (recepção / caixa)
   Fluxo do dia a dia:
     1) bipar o ticket (ou digitar placa/número) + ENTER
     2) conferir o valor → escolher a forma de pagamento
     3) confirmar → o carro vai para a fila do manobrista
   Desconto, ticket perdido, cancelamento e retirada de dinheiro
   pedem a senha de um gerente (configurável).
   ============================================================ */
(function () {
  'use strict';

  Dados.iniciar();
  const usuario = Auth.exigirPagina('caixa');
  if (!usuario) return;

  const R = Regras, $ = Ui.$, esc = Ui.esc, moeda = R.moeda;
  Ui.montarTopo({ pagina: 'Caixa / Recepção', ativo: 'caixa' });
  Ui.iniciarRelogios();

  const busca = $('#busca');

  // ============================================================
  //  ABAS
  // ============================================================
  function mostrarAba(nome) {
    Ui.$$('.aba').forEach(a => { a.hidden = a.id !== 'aba-' + nome; });
    Ui.$$('.abas-topo button').forEach(b => b.classList.toggle('ativo', b.dataset.aba === nome));
    if (nome === 'receber') focarBusca();
    if (nome === 'caixa') renderCaixa();
    if (nome === 'atendimento') renderAtendimento();
  }
  Ui.$$('.abas-topo button').forEach(b => b.addEventListener('click', () => mostrarAba(b.dataset.aba)));
  function focarBusca() { if (!$('#aba-receber').hidden) setTimeout(() => busca.focus(), 60); }

  // ============================================================
  //  RECEBER: busca + lista
  // ============================================================

  function limparBusca() { busca.value = ''; renderReceber(); }

  function resolverBusca() {
    const q = R.limparCodigo(busca.value), dica = $('#busca-dica');
    if (!q) return;
    const porId = Dados.tickets.find(t => t.id === q);
    if (porId) { tratar(porId); return; }
    const aPagar = R.buscar(Dados.tickets.filter(t => t.status === 'ESTACIONADO'), q);
    if (aPagar.length === 1) { tratar(aPagar[0]); return; }
    if (aPagar.length > 1) { dica.className = 'dica'; dica.textContent = `${aPagar.length} veículos combinam. Toque em "Receber" no correto.`; return; }
    const outro = R.buscar(Dados.tickets, q)[0];
    if (outro) { Ui.toast(Pagamento.statusTexto(outro), 'info', 6000); limparBusca(); return; }
    dica.className = 'dica erro'; dica.textContent = 'Nenhum ticket ou placa encontrado. Confira o número.';
  }

  function tratar(t) {
    if (t.status === 'ESTACIONADO') { limparBusca(); receber(t.id); }
    else { Ui.toast(Pagamento.statusTexto(t), 'info', 6000); limparBusca(); }
  }

  busca.addEventListener('input', () => { $('#busca-dica').className = 'dica'; $('#busca-dica').textContent = 'Pressione ENTER para abrir o pagamento.'; renderReceber(); });
  busca.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); resolverBusca(); } });

  function renderReceber() {
    const agora = Date.now(), cfg = Dados.config;
    let lista = Dados.tickets.filter(t => t.status === 'ESTACIONADO').sort((a, b) => b.entradaEm - a.entradaEm);
    const total = lista.length;
    if (busca.value.trim()) lista = R.buscar(lista, busca.value);
    $('#lista-receber').innerHTML = lista.length ? lista.slice(0, 100).map(t => {
      const dev = R.calcularDevido(t, agora, cfg, Op.mensalistaDe(t, agora));
      const excedente = dev.quitado > 0;
      const mens = Op.mensalistaDe(t, agora);
      return `<div class="item ${excedente ? 'amar' : ''}">
        <div class="item-corpo">
          <div><span class="item-ticket">#${esc(t.id)}</span>
            ${mens ? '<span class="badge amar">Mensalista</span>' : ''}${excedente ? `<span class="badge verm">EXCEDENTE · já pago ${moeda(dev.quitado)}</span>` : ''}
            ${(t.avarias && t.avarias.length) || t.obs ? '<span class="badge">com observações</span>' : ''} ${Fotos.selo(t)}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · entrada ${Ui.hora(t.entradaEm)} · há <b data-desde="${t.entradaEm}" data-fmt="min">—</b></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
          <div class="item-valor">${dev.aCobrar === 0 ? '<span class="mudo" style="font-size:1rem">sem cobrança</span>' : moeda(dev.aCobrar)}</div>
          <button type="button" class="btn btn-sucesso btn-grande" data-acao="receber" data-id="${esc(t.id)}">Receber</button>
          <span><button type="button" class="btn btn-link" data-acao="ficha" data-id="${esc(t.id)}">✏️ corrigir</button>
          <button type="button" class="btn btn-link" data-acao="cancelar" data-id="${esc(t.id)}" style="color:var(--verm-700)">cancelar</button></span>
        </div>
      </div>`;
    }).join('') + (lista.length > 100 ? '<div class="vazio">Mostrando 100. Use a busca.</div>' : '')
      : `<div class="vazio">${total ? 'Nenhum veículo combina com a busca.' : 'Nenhum veículo aguardando pagamento. 🎉'}</div>`;
    const c = $('#c-receber'); c.textContent = total; c.classList.toggle('zero', !total);
  }

  $('#lista-receber').addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id, a = b.dataset.acao;
    if (a === 'receber') receber(id);
    else if (a === 'ficha') Ficha.editar(id);
    else if (a === 'cancelar') cancelarTicket(id);
  });

  async function cancelarTicket(id) {
    const t = Op.achar(id); if (!t) return;
    const motivo = await Ui.perguntar({ titulo: `Cancelar ticket #${id}`, mensagem: `${t.placa} — use apenas para entrada registrada por engano.`, rotulo: 'Motivo do cancelamento', dica: 'Ex.: placa digitada errada, carro não ficou' });
    if (!motivo) return;
    if (!(await Auth.autorizar('entrada.cancelar', `Cancelar o ticket #${id} (${t.placa}): ${motivo}`))) { Ui.toast('Cancelamento não autorizado.', 'aviso'); return; }
    const r = Op.cancelarEntrada(id, motivo);
    Ui.toast(r.ok ? 'Ticket cancelado.' : r.erro, r.ok ? 'sucesso' : 'erro');
  }

  // ============================================================
  //  PAGAMENTO (a janela fica em js/pagamento.js)
  // ============================================================
  function receber(id) {
    Pagamento.abrir(id, { semCaixa: () => { Ui.toast('Abra o seu caixa antes de receber.', 'aviso'); mostrarAba('caixa'); }, aoConcluir: focarBusca });
  }

  // ============================================================
  //  NA FILA (já pagos)
  // ============================================================
  function renderAtendimento() {
    const cfg = Dados.config;
    const lista = Dados.tickets.filter(t => t.status === 'PAGO' || t.status === 'A_CAMINHO').sort((a, b) => a.pagoEm - b.pagoEm);
    const c = $('#c-atend'); c.textContent = lista.length; c.classList.toggle('zero', !lista.length);
    $('#lista-atend').innerHTML = lista.length ? lista.map(t => {
      const up = R.ultimoPagamento(t);
      const nafila = t.status === 'PAGO';
      return `<div class="item ${t.ticketPerdido ? 'verm' : (nafila ? 'azul' : 'verde')}">
        <div class="item-corpo">
          <div><span class="item-ticket">#${esc(t.id)}</span> <span class="badge ${nafila ? 'azul' : 'verde'}">${nafila ? 'Na fila do manobrista' : 'A caminho'}</span>
            ${t.ticketPerdido ? '<span class="badge verm">Ticket perdido</span>' : ''}</div>
          <div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · ${nafila ? 'esperando' : 'a caminho há'} <b data-desde="${nafila ? t.pagoEm : t.buscaEm}" data-fmt="cron" ${nafila ? 'data-alerta="3,6"' : ''}>00:00</b>
            · pago ${up ? moeda(up.valor) + ' (' + esc(R.METODOS[up.metodo]) + ') às ' + Ui.hora(up.em) : '—'}</div>
        </div>
        <div class="item-acoes">
          ${up ? `<button type="button" class="btn btn-sm btn-contorno" data-acao="recibo" data-id="${esc(t.id)}">🧾 Recibo</button>` : ''}
          ${nafila && Auth.pode('pagamento.estornar') ? `<button type="button" class="btn btn-sm btn-perigo" data-acao="estornar" data-id="${esc(t.id)}">↩ Estornar</button>` : ''}
        </div></div>`;
    }).join('') : '<div class="vazio">Nenhum veículo pago aguardando o manobrista.</div>';
  }

  $('#lista-atend').addEventListener('click', async ev => {
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id, t = Op.achar(id); if (!t) return;
    if (b.dataset.acao === 'recibo') { Impressao.imprimirRecibo(t, R.ultimoPagamento(t)); }
    if (b.dataset.acao === 'estornar') {
      const motivo = await Ui.perguntar({ titulo: `Estornar pagamento #${id}`, mensagem: `${t.placa} volta para "aguardando pagamento".`, rotulo: 'Motivo do estorno', dica: 'Ex.: forma de pagamento errada' });
      if (!motivo) return;
      const r = Op.estornar(id, motivo);
      Ui.toast(r.ok ? 'Pagamento estornado. Devolva o valor ao cliente.' : r.erro, r.ok ? 'sucesso' : 'erro', 6000);
    }
  });

  // ============================================================
  //  MEU CAIXA (turno)
  // ============================================================
  function renderCaixa() {
    const cx = Op.caixaAberto(usuario.id);
    $('#ponto-caixa').classList.toggle('on', !!cx);
    const box = $('#conteudo-caixa');
    if ($('#aba-caixa').hidden) return;
    if (!cx) {
      if (document.activeElement && document.activeElement.id === 'fundo') return;
      const meus = Dados.caixas.filter(x => x.operadorId === usuario.id && x.fechadoEm).sort((a, b) => b.fechadoEm - a.fechadoEm).slice(0, 5);
      box.innerHTML = `<div class="card"><h2 class="titulo-pagina">Abrir caixa</h2>
        <p class="mudo" style="margin-top:0">Conte o dinheiro de troco que está na gaveta e informe abaixo. Sem caixa aberto não é possível receber pagamentos.</p>
        <label class="rotulo" for="fundo">Fundo de troco (R$)</label>
        <input id="fundo" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" data-foco>
        <button type="button" class="btn btn-sucesso btn-grande btn-bloco mt" data-acao="abrir">🔓 Abrir caixa</button></div>` +
        (meus.length ? `<div class="card mt"><h3 class="mb">Seus últimos fechamentos</h3><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Caixa</th><th>Fechado</th><th class="num">Total</th><th class="num">Diferença</th></tr></thead><tbody>` +
          meus.map(x => `<tr><td>nº ${x.numero}</td><td>${Ui.dataHora(x.fechadoEm)}</td><td class="num">${moeda(x.resumo ? x.resumo.total : 0)}</td><td class="num ${x.diferenca ? (x.diferenca < 0 ? 'verm' : 'amar') : 'verde'}">${moeda(x.diferenca)}</td></tr>`).join('') + '</tbody></table></div></div>' : '');
      Ui.campoMoeda($('#fundo'));
      return;
    }
    const res = R.resumoCaixa(cx, Dados.tickets);
    const antigo = R.inicioDoDia(cx.abertoEm) < R.inicioDoDia(Date.now());
    box.innerHTML = `${antigo ? '<div class="card alerta mb"><b>⚠ Este caixa está aberto desde ' + Ui.dataHora(cx.abertoEm) + '.</b> Feche-o ao final do turno.</div>' : ''}
      <div class="card ok mb"><b>Caixa nº ${cx.numero} aberto</b> <span class="mudo pequeno">desde ${Ui.dataHora(cx.abertoEm)} · fundo ${moeda(cx.fundo)}</span></div>
      <div class="grade-kpi mb">
        <div class="kpi verde"><div class="kpi-rot">Total recebido</div><div class="kpi-val">${moeda(res.total)}</div><div class="kpi-sub">${res.qtd} pagamento(s)</div></div>
        <div class="kpi"><div class="kpi-rot">Dinheiro esperado na gaveta</div><div class="kpi-val">${moeda(res.esperadoDinheiro)}</div><div class="kpi-sub">fundo ${moeda(cx.fundo)} + dinheiro ${moeda(res.dinheiro)} − retiradas ${moeda(res.sangrias)}</div></div>
        <div class="kpi amar"><div class="kpi-rot">Descontos dados</div><div class="kpi-val">${moeda(res.descontos)}</div><div class="kpi-sub">${(cx.sangrias || []).length} retirada(s) no caixa</div></div>
      </div>
      <div class="card mb"><h3 class="mb">Por forma de pagamento</h3><div class="tabela-wrap"><table class="tabela"><tbody>` +
      Object.keys(R.METODOS).filter(k => res.porMetodo[k] && res.porMetodo[k].qtd).map(k => `<tr><td>${esc(R.METODOS[k])}</td><td class="num">${res.porMetodo[k].qtd}×</td><td class="num negrito">${moeda(res.porMetodo[k].valor)}</td></tr>`).join('') +
      (res.qtd ? '' : '<tr><td class="mudo">Nenhum pagamento ainda.</td></tr>') + `</tbody></table></div></div>
      <div class="gap mb"><button type="button" class="btn btn-contorno btn-grande" data-acao="sangria">💸 Retirada (sangria)</button>
        <button type="button" class="btn btn-perigo btn-grande" data-acao="fechar">🔒 Fechar caixa</button></div>
      <div class="card"><h3 class="mb">Pagamentos deste caixa</h3><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Hora</th><th>Ticket</th><th>Placa</th><th>Forma</th><th class="num">Valor</th><th></th></tr></thead><tbody>` +
      (res.pagamentos.length ? res.pagamentos.slice(0, 60).map(({ ticket: t, pagamento: p }) =>
        `<tr><td>${Ui.hora(p.em)}</td><td>#${esc(t.id)}</td><td class="mono">${esc(t.placa)}</td><td>${esc(R.METODOS[p.metodo])}${p.desconto ? ' <span class="badge amar">desc.</span>' : ''}</td><td class="num">${moeda(p.valor)}</td>` +
        `<td class="direita"><button type="button" class="btn btn-sm btn-link" data-recibo="${esc(t.id)}" data-pid="${esc(p.id)}">recibo</button>` +
        (p.nota ? ` <span class="badge verde" title="Nota fiscal de serviço">NFS-e ${esc(p.nota.numero)}</span>`
          : (Nota.podeEmitir(p) ? ` <button type="button" class="btn btn-sm btn-link" data-emitir-nota="${esc(t.id)}" data-pid="${esc(p.id)}">nota fiscal</button>` : '')) +
        `</td></tr>`).join('')
        : '<tr><td colspan="6" class="vazio">Nada por aqui ainda.</td></tr>') + '</tbody></table></div></div>';
  }

  $('#conteudo-caixa').addEventListener('click', ev => {
    const rb = ev.target.closest('[data-recibo]');
    if (rb) {
      const t = Op.achar(rb.dataset.recibo), p = t && t.pagamentos.find(x => x.id === rb.dataset.pid);
      if (t && p) Impressao.imprimirRecibo(t, p);
      return;
    }
    const nf = ev.target.closest('[data-emitir-nota]');
    if (nf) { Nota.emitir(nf.dataset.emitirNota, nf.dataset.pid); return; }
    const b = ev.target.closest('[data-acao]'); if (!b) return;
    const a = b.dataset.acao;
    if (a === 'abrir') {
      const v = $('#fundo').value.trim() === '' ? 0 : Ui.valorCampoMoeda($('#fundo'));
      if (v === null) { Ui.toast('Valor inválido.', 'erro'); return; }
      const r = Op.abrirCaixa(v);
      Ui.toast(r.ok ? 'Caixa aberto. Bom trabalho!' : r.erro, r.ok ? 'sucesso' : 'erro');
      if (r.ok) mostrarAba('receber');
    } else if (a === 'sangria') abrirSangria();
    else if (a === 'fechar') Pagamento.fecharCaixa();
  });

  function abrirSangria() {
    const cx = Op.caixaAberto(usuario.id); if (!cx) return;
    const disp = R.resumoCaixa(cx, Dados.tickets).esperadoDinheiro;
    Ui.modal({
      titulo: 'Retirada de dinheiro (sangria)', largura: 'sm',
      html: `<p class="mudo" style="margin-top:0">Dinheiro disponível no caixa: <b>${moeda(disp)}</b></p>
        <label class="rotulo" for="s-valor">Valor retirado (R$)</label><input id="s-valor" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" data-foco autocomplete="off">
        <label class="rotulo mt" for="s-motivo">Motivo</label><input id="s-motivo" type="text" maxlength="60" placeholder="Ex.: levado ao cofre" autocomplete="off">
        <div class="dica erro" id="s-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        {
          rotulo: 'Registrar retirada', classe: 'btn-primario', padrao: true, aoClicar: async m => {
            const v = Ui.valorCampoMoeda($('#s-valor', m.corpo)), mot = $('#s-motivo', m.corpo).value.trim(), er = $('#s-erro', m.corpo);
            if (!(v > 0)) { er.textContent = 'Informe o valor.'; return; }
            if (mot.length < 3) { er.textContent = 'Informe o motivo.'; return; }
            if (v > disp) { er.textContent = 'Não há tanto dinheiro no caixa.'; return; }
            if (!(await Auth.autorizar('caixa.sangria', `Retirada de ${moeda(v)} do caixa: ${mot}`))) { er.textContent = 'Autorização do gerente não concedida.'; return; }
            const r = Op.sangria(cx.id, v, mot);
            if (!r.ok) { er.textContent = r.erro; return; }
            m.fechar(); Ui.toast('Retirada registrada.');
          }
        }
      ]
    });
  }

  // ============================================================
  //  AVISO DE CAIXA FECHADO + DESENHO GERAL
  // ============================================================
  function renderAviso() {
    const cx = Op.caixaAberto(usuario.id);
    $('#ponto-caixa').classList.toggle('on', !!cx);
    $('#aviso-caixa').innerHTML = cx ? '' :
      `<div class="card alerta"><div class="gap"><div class="espaco"><b>Seu caixa está fechado.</b><br><span class="mudo">Abra o caixa para começar a receber pagamentos.</span></div>
       <button type="button" class="btn btn-primario" data-acao="ir-caixa">Abrir caixa</button></div></div>`;
  }
  $('#aviso-caixa').addEventListener('click', ev => { if (ev.target.closest('[data-acao="ir-caixa"]')) mostrarAba('caixa'); });

  function renderTudo() {
    renderAviso(); renderReceber(); renderAtendimento(); renderCaixa();
  }

  Dados.aoMudar(nome => {
    if (nome === 'log' || nome === 'meta') return;
    if (!Auth.atual()) { window.location.replace('index.html'); return; }
    Ui.agendar(renderTudo);
  });
  window.setInterval(() => { renderReceber(); }, 20000); // mantém os valores em dia

  renderTudo();
  focarBusca();
  if (!Op.caixaAberto(usuario.id)) Ui.toast('Abra o seu caixa para começar.', 'info', 4500);
})();
