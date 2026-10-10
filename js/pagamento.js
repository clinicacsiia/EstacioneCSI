/* ============================================================
   pagamento.js — janela de "Receber pagamento"
   Usada pelo caixa (caixa.html) e pelos manobristas que o
   administrador liberou para receber (aba Buscar).
   Também abre e fecha o caixa de quem recebe (abrirCaixa / fecharCaixa).
   Pagamento.abrir(id, opts):
     opts.semCaixa()      chamado se a pessoa não tem caixa aberto
     opts.aoConcluir()    chamado quando a janela de sucesso fecha
     opts.buscarAgora     true = oferece o botão "Buscar agora" no sucesso
   ============================================================ */
(function (global) {
  'use strict';

  var R = global.Regras, $ = Ui.$, esc = Ui.esc, moeda = R.moeda;
  var METODOS = [['dinheiro', '💵', 'Dinheiro'], ['pix', '📱', 'PIX'], ['debito', '💳', 'Débito'], ['credito', '💳', 'Crédito']];

  function statusTexto(t) {
    const cfg = Dados.config;
    switch (t.status) {
      case 'PAGO': return `Ticket #${t.id} (${t.placa}) já está PAGO e na fila do manobrista.`;
      case 'A_CAMINHO': return `Ticket #${t.id} (${t.placa}): o manobrista já está trazendo o veículo.`;
      case 'ENTREGUE': return `Ticket #${t.id} (${t.placa}) já foi ENTREGUE em ${Ui.dataHora(t.entregueEm)}.`;
      case 'CANCELADO': return `Ticket #${t.id} (${t.placa}) foi CANCELADO.`;
      default: return `Ticket #${t.id} — ${R.descricaoVeiculo(t, cfg)}`;
    }
  }

  function abrir(id, opts) {
    opts = opts || {};
    if (!Op.caixaAberto(Auth.atual().id)) { if (opts.semCaixa) opts.semCaixa(); else Ui.toast('Abra o seu caixa antes de receber.', 'aviso'); return; }
    const t = Op.achar(id);
    if (!t) return;
    if (t.status !== 'ESTACIONADO') { Ui.toast(statusTexto(t), 'info', 6000); return; }

    const cfg = Dados.config, quando = Date.now();
    const dev = R.calcularDevido(t, quando, cfg, Op.mensalistaDe(t, quando));
    const bruto = dev.aCobrar;
    const pg = { desconto: null, metodo: null, recebido: null, perdido: false };

    const m = Ui.modal({
      titulo: 'Receber pagamento', largura: 'md',
      html: `<div class="centro mb">
          <div class="item-ticket">Ticket #${esc(t.id)}</div><div class="item-placa">${esc(t.placa)}</div>
          <div class="item-sub">${esc(R.descricaoVeiculo(t, cfg))}</div>
          <div class="item-meta">${esc(R.localVeiculo(t, cfg))} · entrada ${Ui.hora(t.entradaEm)} · permanência ${R.duracao(dev.tarifa.minutos)}</div>
          ${dev.quitado > 0 ? `<div class="badge amar mt">Excedente — já pago ${moeda(dev.quitado)}</div>` : ''}
        </div>
        <div class="card ok centro mb" style="padding:12px">
          <div class="rotulo" style="margin:0">VALOR A PAGAR</div>
          <div id="pg-total" style="font-size:2.7rem;font-weight:700;color:var(--verde-700);line-height:1.15"></div>
          <div id="pg-desc" class="pequeno amar negrito"></div>
          <details class="pequeno mt"><summary style="cursor:pointer">Ver cálculo</summary><div id="pg-linhas" style="text-align:left;margin-top:6px"></div></details>
        </div>
        <div class="gap mb" id="pg-extras">
          <button type="button" class="btn btn-sm btn-contorno" id="pg-b-desc">🏷️ Desconto / cortesia</button>
          <button type="button" class="btn btn-sm btn-contorno" id="pg-b-perdido">🎫 Cliente perdeu o ticket</button>
        </div>
        <div class="card perigo mb" id="pg-perdido" hidden>
          <b>🎫 Ticket perdido</b>
          <div class="pequeno mb">Confira o documento. Não se cobra multa por perda de ticket — apenas a tarifa normal (o valor acima).</div>
          <div class="linha-campos">
            <div class="campo"><label class="rotulo" for="pd-nome">Nome completo</label><input id="pd-nome" type="text" maxlength="60" autocomplete="off"></div>
            <div class="campo"><label class="rotulo" for="pd-doc">CPF ou RG</label><input id="pd-doc" type="text" maxlength="20" autocomplete="off"></div>
            <div class="campo"><label class="rotulo" for="pd-tel">Telefone</label><input id="pd-tel" type="tel" maxlength="15" autocomplete="off"></div>
          </div>
        </div>
        <div id="pg-metodos-box"><div class="rotulo">Forma de pagamento</div>
          <div class="grade-4" id="pg-metodos">${METODOS.map(([k, e, n]) => `<button type="button" class="tile" data-metodo="${k}"><span class="emoji" aria-hidden="true">${e}</span>${n}</button>`).join('')}</div></div>
        <div id="pg-dinheiro" class="mt" hidden>
          <div class="rotulo">Valor recebido do cliente</div>
          <div class="chips" id="pg-notas"></div>
          <input id="pg-recebido" type="text" inputmode="decimal" placeholder="0,00" class="input-busca mt" autocomplete="off">
          <div id="pg-troco" class="centro mt" style="font-size:1.6rem;font-weight:700"></div>
        </div>
        <div class="dica erro" id="pg-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        { id: 'ok', rotulo: 'Confirmar', classe: 'btn-sucesso', padrao: true, desabilitado: true, aoClicar: confirmar }
      ]
    });
    const c = m.corpo;

    const totalAtual = () => bruto - R.calcularDesconto(bruto, pg.desconto);

    function atualizar() {
      const desc = R.calcularDesconto(bruto, pg.desconto), tot = bruto - desc;
      $('#pg-total', c).textContent = moeda(tot);
      $('#pg-desc', c).textContent = desc ? `Desconto de ${moeda(desc)} — ${pg.desconto.motivo}` : '';
      const l = (a, b, neg) => `<div style="display:flex;justify-content:space-between;gap:10px"><span>${esc(a)}</span><span class="${neg ? 'verm' : ''}">${esc(b)}</span></div>`;
      $('#pg-linhas', c).innerHTML = dev.tarifa.linhas.map(x => l(x.d, moeda(x.v))).join('') +
        (dev.quitado ? l('Já pago antes', '-' + moeda(dev.quitado), true) : '') + (desc ? l('Desconto', '-' + moeda(desc), true) : '') +
        `<div class="negrito">${l('A pagar', moeda(tot))}</div>`;
      $('#pg-b-desc', c).hidden = bruto === 0 || !Auth.pode('pagamento.desconto');
      $('#pg-b-perdido', c).hidden = !Auth.pode('pagamento.ticketPerdido');
      $('#pg-b-desc', c).textContent = pg.desconto ? '🏷️ Alterar desconto' : '🏷️ Desconto / cortesia';
      $('#pg-b-perdido', c).textContent = pg.perdido ? '✖ Não perdeu o ticket' : '🎫 Cliente perdeu o ticket';
      $('#pg-perdido', c).hidden = !pg.perdido;
      $('#pg-metodos-box', c).hidden = tot === 0;
      Ui.$$('[data-metodo]', c).forEach(b => b.classList.toggle('sel', b.dataset.metodo === pg.metodo));
      const din = tot > 0 && pg.metodo === 'dinheiro';
      $('#pg-dinheiro', c).hidden = !din;
      if (din) {
        const notas = [2000, 5000, 10000, 20000].filter(n => n > tot).slice(0, 3);
        $('#pg-notas', c).innerHTML = [tot].concat(notas).map((n, i) =>
          `<button type="button" class="chip ${pg.recebido === n ? 'sel' : ''}" data-nota="${n}">${i === 0 ? 'Exato' : moeda(n)}</button>`).join('');
        const tr = $('#pg-troco', c);
        if (pg.recebido == null) tr.textContent = '';
        else if (pg.recebido >= tot) { tr.textContent = 'Troco: ' + moeda(pg.recebido - tot); tr.style.color = 'var(--verde-700)'; }
        else { tr.textContent = 'Faltam ' + moeda(tot - pg.recebido); tr.style.color = 'var(--verm-700)'; }
      }
      let ok = tot === 0 || (!!pg.metodo && (pg.metodo !== 'dinheiro' || (pg.recebido != null && pg.recebido >= tot)));
      if (pg.perdido) ok = ok && $('#pd-nome', c).value.trim().length >= 3 && $('#pd-doc', c).value.trim().length >= 5;
      const btn = m.botao('ok');
      btn.disabled = !ok || processando;
      btn.textContent = tot === 0 ? '✅ Liberar (sem cobrança)' : `✅ Confirmar ${moeda(tot)}`;
    }

    c.addEventListener('click', ev => {
      const mt = ev.target.closest('[data-metodo]');
      if (mt) { pg.metodo = mt.dataset.metodo; if (pg.metodo !== 'dinheiro') pg.recebido = null; atualizar(); if (pg.metodo === 'dinheiro') $('#pg-recebido', c).focus(); return; }
      const nt = ev.target.closest('[data-nota]');
      if (nt) { pg.recebido = Number(nt.dataset.nota); $('#pg-recebido', c).value = (pg.recebido / 100).toFixed(2).replace('.', ','); atualizar(); return; }
      if (ev.target.closest('#pg-b-perdido')) { pg.perdido = !pg.perdido; atualizar(); if (pg.perdido) $('#pd-nome', c).focus(); return; }
      if (ev.target.closest('#pg-b-desc')) abrirDesconto();
    });
    $('#pg-recebido', c).addEventListener('input', e => { pg.recebido = R.parseMoeda(e.target.value); atualizar(); });
    Ui.$$('#pd-nome,#pd-doc,#pd-tel', c).forEach(i => i.addEventListener('input', atualizar));

    function abrirDesconto() {
      let tipo = pg.desconto ? pg.desconto.tipo : 'percentual';
      const md = Ui.modal({
        titulo: 'Desconto / cortesia', largura: 'sm',
        html: `<div class="grade-3 mb" id="d-tipos"></div>
          <div id="d-valor-box" class="mb"><label class="rotulo" id="d-valor-rot" for="d-valor"></label><input id="d-valor" type="text" inputmode="decimal" autocomplete="off" data-foco></div>
          <div class="campo mb"><label class="rotulo" for="d-motivo">Motivo (obrigatório)</label>
            <select id="d-motivo">${R.MOTIVOS_DESCONTO.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>
          <div class="campo mb" id="d-outro-box" hidden><input id="d-outro" type="text" maxlength="60" placeholder="Descreva o motivo"></div>
          <div class="dica erro" id="d-erro" role="alert"></div>`,
        botoes: [
          { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
          pg.desconto ? { rotulo: 'Remover', classe: 'btn-perigo', aoClicar: mm => { pg.desconto = null; mm.fechar(); atualizar(); } } : null,
          { rotulo: 'Aplicar', classe: 'btn-primario', padrao: true, aoClicar: aplicar }
        ].filter(Boolean)
      });
      const d = md.corpo;
      const desenhar = () => {
        $('#d-tipos', d).innerHTML = [['cortesia', 'Cortesia', '100%'], ['percentual', 'Percentual', '%'], ['valor', 'Valor', 'R$']]
          .map(([k, n, s]) => `<button type="button" class="tile ${tipo === k ? 'sel' : ''}" data-tipo="${k}">${n}<small>${s}</small></button>`).join('');
        $('#d-valor-box', d).hidden = tipo === 'cortesia';
        $('#d-valor-rot', d).textContent = tipo === 'percentual' ? 'Percentual de desconto (1 a 100)' : 'Valor do desconto (R$)';
      };
      desenhar();
      if (pg.desconto) {
        if (pg.desconto.tipo === 'percentual') $('#d-valor', d).value = String(pg.desconto.valor);
        else if (pg.desconto.tipo === 'valor') $('#d-valor', d).value = (pg.desconto.valor / 100).toFixed(2).replace('.', ',');
        const opt = R.MOTIVOS_DESCONTO.indexOf(pg.desconto.motivo);
        if (opt > -1) $('#d-motivo', d).selectedIndex = opt; else { $('#d-motivo', d).value = 'Outro'; $('#d-outro-box', d).hidden = false; $('#d-outro', d).value = pg.desconto.motivo; }
      }
      d.addEventListener('click', ev => { const b = ev.target.closest('[data-tipo]'); if (b) { tipo = b.dataset.tipo; desenhar(); } });
      $('#d-motivo', d).addEventListener('change', e => { $('#d-outro-box', d).hidden = e.target.value !== 'Outro'; });
      function aplicar(mm) {
        const er = $('#d-erro', d); er.textContent = '';
        let valor = 0;
        if (tipo === 'percentual') {
          valor = Number(String($('#d-valor', d).value).replace(',', '.'));
          if (!(valor > 0 && valor <= 100)) { er.textContent = 'Informe um percentual entre 1 e 100.'; return; }
        } else if (tipo === 'valor') {
          valor = R.parseMoeda($('#d-valor', d).value);
          if (!(valor > 0)) { er.textContent = 'Informe o valor do desconto.'; return; }
          if (valor > bruto) { er.textContent = 'O desconto não pode ser maior que o valor a pagar.'; return; }
        }
        let motivo = $('#d-motivo', d).value;
        if (motivo === 'Outro') { motivo = $('#d-outro', d).value.trim(); if (motivo.length < 3) { er.textContent = 'Descreva o motivo.'; return; } }
        pg.desconto = { tipo: tipo, valor: valor, motivo: motivo };
        mm.fechar(); atualizar();
      }
    }

    let processando = false;
    async function confirmar(mm) {
      if (processando) return; // impede duplo envio (clique duplo, Enter repetido)
      processando = true;
      const btn = mm.botao('ok');
      btn.disabled = true;
      const erroEl = $('#pg-erro', c); erroEl.textContent = '';
      const acoes = [];
      if (pg.desconto) acoes.push('pagamento.desconto');
      if (pg.perdido) acoes.push('pagamento.ticketPerdido');
      const desc = R.calcularDesconto(bruto, pg.desconto);
      const texto = `${t.placa}: ` + [pg.desconto ? `desconto de ${moeda(desc)} (${pg.desconto.motivo})` : '', pg.perdido ? 'entrega sem ticket (perdido)' : ''].filter(Boolean).join(' e ');
      if (acoes.length && !(await Auth.autorizar(acoes, texto))) {
        erroEl.textContent = 'Autorização do gerente não concedida.'; processando = false; atualizar(); return;
      }
      const r = Op.pagar(id, {
        metodo: pg.metodo, recebido: pg.recebido, calculadoEm: quando, desconto: pg.desconto,
        perdido: pg.perdido ? { nome: $('#pd-nome', c).value, documento: $('#pd-doc', c).value, telefone: $('#pd-tel', c).value } : null
      });
      if (!r.ok) {
        if (r.codigo === 'VALOR_MUDOU' || r.codigo === 'CONFLITO' || r.codigo === 'SEM_CAIXA') {
          mm.fechar(); Ui.toast(r.erro, 'aviso', 6000);
          if (r.codigo === 'VALOR_MUDOU') abrir(id, opts);
          return;
        }
        erroEl.textContent = r.erro; processando = false; atualizar(); return;
      }
      mm.fechar();
      sucesso(r.ticket, r.pagamento, opts);
    }

    atualizar();
  }

  function sucesso(t, p, opts) {
    const troco = p.metodo === 'dinheiro' && p.troco > 0;
    Ui.modal({
      titulo: 'Pagamento confirmado', largura: 'sm', semFechar: true, aoFechar: opts.aoConcluir,
      html: `<div class="centro"><div style="font-size:3rem" aria-hidden="true">✅</div>
        <div class="item-placa">${esc(t.placa)}</div>
        <div class="negrito" style="font-size:1.4rem">${moeda(p.valor)} <span class="mudo" style="font-size:1rem">${esc(R.METODOS[p.metodo])}</span></div>
        ${troco ? `<div class="card alerta mt"><div class="rotulo" style="margin:0">DEVOLVER TROCO</div><div style="font-size:2.7rem;font-weight:700">${moeda(p.troco)}</div></div>` : ''}
        <p class="mudo mt" style="margin-bottom:0">${t.ticketPerdido ? '⚠ Ticket perdido: o manobrista vai conferir o documento.' : 'Veículo enviado para a fila do manobrista.'}</p></div>`,
      botoes: [
        { rotulo: '🧾 Recibo', classe: 'btn-contorno', aoClicar: () => Impressao.imprimirRecibo(t, p) },
        p.valor > 0 && global.Nota && Auth.pode('nota.emitir') ? { rotulo: '📄 Nota fiscal', classe: 'btn-contorno', aoClicar: () => Nota.emitir(t.id, p.id) } : null,
        opts.buscarAgora && Auth.pode('valet.buscar') ? { rotulo: '🔑 Buscar agora', classe: 'btn-sucesso', aoClicar: mm => { const rb = Op.buscar(t.id); mm.fechar(); Ui.toast(rb.ok ? `Buscando ${t.placa} — ${R.localVeiculo(rb.ticket, Dados.config)}` : rb.erro, rb.ok ? 'info' : 'erro'); } } : null,
        { rotulo: 'Concluir', classe: 'btn-primario', padrao: true, aoClicar: mm => mm.fechar() }
      ].filter(Boolean)
    });
  }

  function fecharCaixa() {
    const cx = Op.caixaAberto(Auth.atual().id); if (!cx) return;
    const res = R.resumoCaixa(cx, Dados.tickets);
    const l = (a, b, forte) => `<div style="display:flex;justify-content:space-between;gap:10px;${forte ? 'font-weight:700' : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    const m = Ui.modal({
      titulo: `Fechar caixa nº ${cx.numero}`, largura: 'md',
      html: `<div class="card mb" style="background:var(--cinza-50);box-shadow:none">` +
        Object.keys(R.METODOS).filter(k => res.porMetodo[k] && res.porMetodo[k].qtd).map(k => l(`${R.METODOS[k]} (${res.porMetodo[k].qtd})`, moeda(res.porMetodo[k].valor))).join('') +
        l('TOTAL RECEBIDO', moeda(res.total), true) + '<hr style="border:0;border-top:1px solid var(--cinza-300)">' +
        l('Fundo de troco', moeda(cx.fundo)) + l('+ Dinheiro recebido', moeda(res.dinheiro)) + l('− Retiradas', moeda(res.sangrias)) +
        l('Dinheiro esperado na gaveta', moeda(res.esperadoDinheiro), true) + `</div>
        <label class="rotulo" for="f-contado">Dinheiro contado na gaveta (R$)</label>
        <input id="f-contado" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" data-foco autocomplete="off">
        <div id="f-dif" class="centro negrito mt" style="font-size:1.3rem;min-height:1.6em"></div>
        <label class="rotulo mt" for="f-obs">Observação <span class="mudo" id="f-obs-obrig"></span></label>
        <textarea id="f-obs" maxlength="200"></textarea>
        <div class="dica erro" id="f-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: mm => mm.fechar() },
        { rotulo: '🔒 Fechar caixa', classe: 'btn-perigo', padrao: true, aoClicar: fechar }
      ]
    });
    const d = m.corpo;
    Ui.campoMoeda($('#f-contado', d));
    $('#f-contado', d).addEventListener('input', () => {
      const v = Ui.valorCampoMoeda($('#f-contado', d)), el = $('#f-dif', d);
      if (v === null) { el.textContent = ''; $('#f-obs-obrig', d).textContent = ''; return; }
      const dif = v - res.esperadoDinheiro;
      el.textContent = dif === 0 ? '✅ Caixa confere' : (dif > 0 ? `Sobra de ${moeda(dif)}` : `Falta de ${moeda(-dif)}`);
      el.style.color = dif === 0 ? 'var(--verde-700)' : (dif > 0 ? 'var(--amar-700)' : 'var(--verm-700)');
      $('#f-obs-obrig', d).textContent = dif === 0 ? '' : '(obrigatória: explique a diferença)';
    });
    function fechar(mm) {
      const v = Ui.valorCampoMoeda($('#f-contado', d)), er = $('#f-erro', d);
      if (v === null) { er.textContent = 'Informe o dinheiro contado (pode ser 0,00).'; return; }
      const r = Op.fecharCaixa(cx.id, v, $('#f-obs', d).value);
      if (!r.ok) { er.textContent = r.erro; return; }
      mm.fechar();
      const fechado = r.caixa, rs = R.resumoCaixa(fechado, Dados.tickets);
      Ui.modal({
        titulo: 'Caixa fechado', largura: 'sm', semFechar: true,
        html: `<div class="centro"><div style="font-size:3rem" aria-hidden="true">🔒</div>
          <div class="negrito" style="font-size:1.3rem">Total ${moeda(rs.total)}</div>
          <p class="${r.diferenca === 0 ? 'verde' : (r.diferenca < 0 ? 'verm' : 'amar')} negrito">${r.diferenca === 0 ? 'Caixa conferido, sem diferença ✅' : (r.diferenca > 0 ? 'Sobra de ' : 'Falta de ') + moeda(Math.abs(r.diferenca))}</p></div>`,
        botoes: [
          { rotulo: '🖨️ Imprimir resumo', classe: 'btn-contorno', aoClicar: () => Impressao.imprimirFechamento(fechado, rs) },
          { rotulo: 'Concluir', classe: 'btn-primario', padrao: true, aoClicar: x => x.fechar() }
        ]
      });
    }
  }

  /** Pede o fundo de troco e abre o caixa de quem ainda não tem um (manobrista que recebe). */
  function abrirCaixa(aoAbrir) {
    Ui.modal({
      titulo: 'Abrir caixa', largura: 'sm',
      html: `<p class="mudo" style="margin-top:0">Para receber pagamentos é preciso um caixa aberto. Conte o dinheiro de troco que você tem e informe abaixo (pode ser 0,00).</p>
        <label class="rotulo" for="ac-fundo">Fundo de troco (R$)</label>
        <input id="ac-fundo" class="input-busca" type="text" inputmode="decimal" placeholder="0,00" autocomplete="off" data-foco>
        <div class="dica erro" id="ac-erro" role="alert"></div>`,
      botoes: [
        { rotulo: 'Cancelar', classe: 'btn-contorno', aoClicar: m => m.fechar() },
        {
          rotulo: '🔓 Abrir caixa', classe: 'btn-sucesso', padrao: true, aoClicar: m => {
            const campo = $('#ac-fundo', m.corpo);
            const v = campo.value.trim() === '' ? 0 : Ui.valorCampoMoeda(campo);
            if (v === null) { $('#ac-erro', m.corpo).textContent = 'Valor inválido.'; return; }
            const r = Op.abrirCaixa(v);
            if (!r.ok) { $('#ac-erro', m.corpo).textContent = r.erro; return; }
            m.fechar(); Ui.toast('Caixa aberto. Bom trabalho!', 'sucesso');
            if (aoAbrir) aoAbrir(r.caixa);
          }
        }
      ]
    });
    Ui.campoMoeda($('#ac-fundo'));
  }

  global.Pagamento = { abrir: abrir, statusTexto: statusTexto, abrirCaixa: abrirCaixa, fecharCaixa: fecharCaixa };
})(window);
