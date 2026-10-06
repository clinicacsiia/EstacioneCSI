/* ============================================================
   fotos.js — fotos de avarias e problemas do veículo
   ------------------------------------------------------------
   Compartilhado por Manobrista, Caixa e Gerência (como o ficha.js).
   * seletor(raiz)         fotos tiradas ANTES do ticket existir (formulário de entrada): ficam na memória até enviar();
   * enviar(ticket, itens) manda essas fotos depois que o ticket foi criado;
   * galeria(raiz, ticket) fotos de um ticket que já existe: ver, adicionar (e o gerente apaga);
   * abrir(ticket)         a mesma galeria numa janela (atalho para a hora da entrega);
   * selo(ticket)          o "📷 2" das listas.

   Cada foto é reduzida NO APARELHO antes de subir (JPEG de até 1024 px + uma miniatura de 220 px): fica com ~60-100 KB e não
   pesa no plano de dados nem no banco. As imagens ficam na tabela estaciona.fotos (supabase/schema.sql); o ticket guarda só
   os ids (t.fotos), por isso a lista de tickets continua leve e o 📷 aparece sozinho em todas as telas.
   ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document, esc = global.Ui.esc, $ = global.Ui.$;
  var JPEG = 'data:image/jpeg;base64,';
  var LADO_MAX = 1024, LADO_MINIATURA = 220, QUALIDADE = 0.6;
  var MAX_ARQUIVO = 30 * 1024 * 1024;   // foto original acima disso nem é aberta (memória do celular)
  var MAX_POR_VEICULO = 10;             // o servidor confere o mesmo limite
  var LIMITE_ENVIO_MS = 60000;
  var cache = {};                       // id -> foto inteira já baixada (navegar no visor não baixa de novo)

  // ---------- Reduzir a foto no aparelho ----------
  function abrirImagem(arquivo) {
    return new Promise(function (ok, falha) {
      var url = global.URL.createObjectURL(arquivo), img = new global.Image();
      img.onload = function () { global.URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { global.URL.revokeObjectURL(url); falha(new Error('Não consegui abrir esta imagem.')); };
      img.src = url;
    });
  }

  /** Desenha `origem` (imagem ou canvas) com no máximo `ladoMax` px no maior lado. */
  function reduzir(origem, ladoMax) {
    var w = origem.naturalWidth || origem.width, h = origem.naturalHeight || origem.height;
    if (!w || !h) throw new Error('Imagem vazia.');
    var escala = Math.min(1, ladoMax / Math.max(w, h));
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(w * escala)); c.height = Math.max(1, Math.round(h * escala));
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // PNG com fundo transparente não vira preto
    g.imageSmoothingQuality = 'high';
    g.drawImage(origem, 0, 0, c.width, c.height);
    return c;
  }

  function emJpeg(canvas) {
    var url = canvas.toDataURL('image/jpeg', QUALIDADE);
    if (url.indexOf(JPEG) !== 0) throw new Error('Este aparelho não consegue gerar a foto.');
    return url;
  }

  /** Arquivo da câmera/galeria -> { imagem, miniatura } (data URLs JPEG). */
  function preparar(arquivo) {
    if (!arquivo) return Promise.reject(new Error('Nenhuma foto escolhida.'));
    if (arquivo.size > MAX_ARQUIVO) return Promise.reject(new Error('Esta foto é grande demais.'));
    return abrirImagem(arquivo).then(function (img) {
      var grande = reduzir(img, LADO_MAX);
      return { imagem: emJpeg(grande), miniatura: emJpeg(reduzir(grande, LADO_MINIATURA)) };
    });
  }

  // ---------- Servidor ----------
  /** Nunca rejeita: devolve { ok, status, corpo } (status 0 = sem conexão). */
  function chamar(metodo, url, corpo) {
    var ctl = new global.AbortController(), timer = global.setTimeout(function () { ctl.abort(); }, LIMITE_ENVIO_MS);
    return global.Api.buscar(url, { metodo: metodo, corpo: corpo, signal: ctl.signal }).then(function (r) {
      return r.json().then(function (c) { return { ok: r.ok, status: r.status, corpo: c || {} }; });
    }).catch(function (e) {
      global.Api.falha('Fotos: sem resposta do servidor (' + (e && e.message ? e.message : e) + ').');
      return { ok: false, status: 0, corpo: {} };
    }).then(function (r) { global.clearTimeout(timer); return r; });
  }

  /** Texto para a tela: a regra do servidor (ex.: "Este veículo já tem 10 fotos") ou, se o sistema falhou, só "Ocorreu um erro.". */
  function textoDoErro(r) {
    if (r.status === 401) return 'Sessão expirada. Entre novamente.';
    if (r.status === 404 && r.corpo.erro === 'Não encontrado.') { // rota desconhecida: o schema.sql ainda não foi atualizado no Supabase
      global.Api.falha('O servidor ainda não tem o recurso de fotos: rode o supabase/schema.sql de novo no SQL Editor do Supabase.');
      return global.Api.MSG_ERRO;
    }
    if (r.status === 0 || r.status >= 500) return global.Api.MSG_ERRO;
    return r.corpo.erro || global.Api.MSG_ERRO;
  }

  /**
   * Envia fotos { imagem, miniatura } para um ticket que já existe, uma de cada vez.
   * Na primeira falha para (sem sinal, limite...) e devolve o que ficou: Promise<{ enviadas, falhas:[itens], erro }>.
   */
  function enviar(ticketId, itens) {
    var res = { enviadas: 0, falhas: [], erro: '' }, i = 0;
    function proxima() {
      if (i >= itens.length) return Promise.resolve(res);
      var item = itens[i];
      return chamar('POST', '/api/fotos', { ticket: String(ticketId), imagem: item.imagem, miniatura: item.miniatura }).then(function (r) {
        if (r.ok && r.corpo.ok) { res.enviadas++; i++; return proxima(); }
        res.erro = textoDoErro(r);
        res.falhas = itens.slice(i);
        return res;
      });
    }
    return proxima();
  }

  function falhaComo(r) { throw new Error(textoDoErro(r)); }

  /** Miniaturas das fotos de um ticket: Promise<[{ id, em, porNome, miniatura }]>. */
  function listar(ticketId) {
    return chamar('GET', '/api/fotos?ticket=' + encodeURIComponent(ticketId)).then(function (r) {
      return r.ok && r.corpo.ok ? (r.corpo.fotos || []) : falhaComo(r);
    });
  }

  /** A foto inteira (data URL). */
  function inteira(foto) {
    if (foto.imagem) return Promise.resolve(foto.imagem); // ainda não enviada: já está aqui
    if (cache[foto.id]) return Promise.resolve(cache[foto.id]);
    return chamar('GET', '/api/fotos?id=' + encodeURIComponent(foto.id)).then(function (r) {
      if (!(r.ok && r.corpo.ok)) return falhaComo(r);
      cache[foto.id] = r.corpo.foto.imagem;
      return cache[foto.id];
    });
  }

  function excluir(foto) {
    return chamar('DELETE', '/api/fotos?id=' + encodeURIComponent(foto.id)).then(function (r) {
      if (!(r.ok && r.corpo.ok)) return falhaComo(r);
      delete cache[foto.id];
    });
  }

  // ---------- Peças de tela ----------
  function qtd(t) { return t && Array.isArray(t.fotos) ? t.fotos.length : 0; }
  function selo(t) {
    var n = qtd(t);
    return n ? '<span class="badge azul" title="Fotos de avarias ou problemas">📷 ' + n + '</span>' : '';
  }

  /** Botões "Tirar foto" (abre a câmera) e "Galeria". Devolve { el, desabilitar(sim) }. */
  function botoesAdicionar(aoEscolher) {
    var el = doc.createElement('div');
    el.className = 'fotos-botoes';
    el.innerHTML = '<button type="button" class="btn btn-contorno" data-f="camera"><span aria-hidden="true">📷</span> Tirar foto</button>' +
      '<button type="button" class="btn btn-contorno" data-f="galeria"><span aria-hidden="true">🖼️</span> Galeria</button>' +
      '<input type="file" accept="image/*" capture="environment" hidden data-in="camera">' +
      '<input type="file" accept="image/*" multiple hidden data-in="galeria">';
    ['camera', 'galeria'].forEach(function (k) {
      var botao = $('[data-f="' + k + '"]', el), campo = $('[data-in="' + k + '"]', el);
      botao.addEventListener('click', function () { campo.click(); });
      campo.addEventListener('change', function () {
        var arquivos = Array.prototype.slice.call(campo.files);
        campo.value = ''; // permite escolher a mesma foto de novo
        if (arquivos.length) aoEscolher(arquivos);
      });
    });
    return {
      el: el,
      desabilitar: function (sim) { Array.prototype.forEach.call(el.querySelectorAll('button'), function (b) { b.disabled = !!sim; }); }
    };
  }

  /** Reduz os arquivos um a um. aoFoto(item) a cada sucesso, aoErro(texto) a cada falha. Promise que termina quando acabou. */
  function processar(arquivos, aoFoto, aoErro) {
    return arquivos.reduce(function (p, arquivo) {
      return p.then(function () {
        return preparar(arquivo).then(aoFoto, function (e) { aoErro(e && e.message ? e.message : String(e)); });
      });
    }, Promise.resolve());
  }

  /**
   * Visor de fotos. lista: [{ id | imagem, miniatura, em, porNome }]; opc.excluir(foto) -> Promise (só passe se a pessoa pode apagar).
   */
  function visor(lista, indice, opc) {
    opc = opc || {};
    lista = lista.slice();
    var i = indice || 0, fechado = false, m;

    function mostrar() {
      var f = lista[i], img = $('#fv-img', m.corpo);
      m.titulo('Foto ' + (i + 1) + ' de ' + lista.length);
      $('#fv-info', m.corpo).textContent = f.em ? Ui.dataHora(f.em) + (f.porNome ? ' · ' + f.porNome : '') : 'Ainda não enviada';
      $('#fv-erro', m.corpo).textContent = '';
      m.botao('ant').disabled = i === 0;
      m.botao('prox').disabled = i === lista.length - 1;
      img.src = f.miniatura; img.className = 'foto-borrada'; // a miniatura (borrada) aparece enquanto a inteira não chega
      inteira(f).then(function (url) {
        if (fechado || lista[i] !== f) return;
        img.src = url; img.className = '';
      }, function (e) {
        if (!fechado && lista[i] === f) $('#fv-erro', m.corpo).textContent = e.message;
      });
    }
    function ir(passo) { return function () { var n = i + passo; if (n >= 0 && n < lista.length) { i = n; mostrar(); } }; }

    m = Ui.modal({
      titulo: 'Foto', largura: 'lg', aoFechar: function () { fechado = true; },
      html: '<div class="foto-visor"><img id="fv-img" alt="Foto do veículo"></div><div class="foto-info" id="fv-info"></div>' +
        '<div class="dica erro" id="fv-erro" role="alert"></div>' +
        (opc.excluir ? '<button type="button" class="btn btn-sm btn-contorno mt" id="fv-del" style="color:var(--verm-700)">🗑 Excluir esta foto</button>' : ''),
      botoes: [
        { id: 'ant', rotulo: '‹', classe: 'btn-contorno btn-seta', aoClicar: ir(-1) },
        { id: 'prox', rotulo: '›', classe: 'btn-contorno btn-seta', aoClicar: ir(1) },
        { rotulo: 'Fechar', classe: 'btn-primario', padrao: true, aoClicar: function (mm) { mm.fechar(); } }
      ]
    });
    m.botao('ant').setAttribute('aria-label', 'Foto anterior');
    m.botao('prox').setAttribute('aria-label', 'Próxima foto');
    var apagar = $('#fv-del', m.corpo);
    if (apagar) apagar.addEventListener('click', function () {
      var f = lista[i];
      Ui.confirmar({ titulo: 'Excluir foto?', mensagem: 'A foto é apagada de vez, para todo mundo.', ok: 'Excluir', perigo: true }).then(function (sim) {
        if (!sim || fechado) return;
        apagar.disabled = true;
        opc.excluir(f).then(function () {
          lista.splice(i, 1);
          if (!lista.length) { m.fechar(); return; }
          i = Math.min(i, lista.length - 1);
          apagar.disabled = false;
          mostrar();
        }, function (e) { apagar.disabled = false; $('#fv-erro', m.corpo).textContent = e.message; });
      });
    });
    mostrar();
    return m;
  }

  function miniaturaHtml(f, i, extra) {
    return '<div class="foto-mini"><button type="button" class="foto-ver" data-ver="' + i + '" aria-label="Ver foto ' + (i + 1) + '">' +
      '<img src="' + f.miniatura + '" alt="">' + (f.em ? '<span class="foto-hora">' + esc(Ui.dataHora(f.em)) + '</span>' : '') + '</button>' + (extra || '') + '</div>';
  }
  var ESPERA_HTML = '<div class="foto-mini foto-carregando" role="status" aria-label="Carregando foto">⏳</div>';
  var ESQUELETO = '<div class="fotos-grade" hidden></div><div class="fotos-acoes"></div><div class="dica" aria-live="polite"></div>';

  /**
   * Fotos tiradas ANTES de o ticket existir (formulário de entrada). Devolve
   * { itens() -> [{ imagem, miniatura }], ocupado() -> true enquanto reduz alguma foto, limpar() }.
   */
  function seletor(raiz) {
    var itens = [], ocupados = 0, max = MAX_POR_VEICULO;
    raiz.innerHTML = ESQUELETO;
    var grade = $('.fotos-grade', raiz), acoes = $('.fotos-acoes', raiz), msg = $('.dica', raiz);
    var botoes = botoesAdicionar(adicionar);
    acoes.appendChild(botoes.el);

    function aviso(texto) { msg.className = texto ? 'dica erro' : 'dica'; msg.textContent = texto || ''; }

    function desenhar() {
      grade.hidden = !itens.length && !ocupados;
      grade.innerHTML = itens.map(function (f, i) {
        return miniaturaHtml(f, i, '<button type="button" class="foto-x" data-rm="' + i + '" aria-label="Remover foto ' + (i + 1) + '">✕</button>');
      }).join('') + (ocupados ? ESPERA_HTML : '');
      botoes.desabilitar(itens.length + ocupados >= max);
    }

    function adicionar(arquivos) {
      aviso('');
      var vagas = Math.max(0, max - itens.length - ocupados);
      if (arquivos.length > vagas) { aviso('O máximo é ' + max + ' fotos por veículo.'); arquivos = arquivos.slice(0, vagas); }
      ocupados += arquivos.length; desenhar();
      return processar(arquivos, function (it) { ocupados--; itens.push(it); desenhar(); }, function (e) { ocupados--; aviso(e); desenhar(); });
    }

    grade.addEventListener('click', function (ev) {
      var rm = ev.target.closest('[data-rm]');
      if (rm) { itens.splice(Number(rm.getAttribute('data-rm')), 1); aviso(''); desenhar(); return; }
      var ver = ev.target.closest('[data-ver]');
      if (ver) visor(itens, Number(ver.getAttribute('data-ver')));
    });
    desenhar();

    return {
      itens: function () { return itens.slice(); },
      ocupado: function () { return ocupados > 0; },
      limpar: function () { itens = []; aviso(''); desenhar(); }
    };
  }

  /**
   * Fotos de um ticket que já existe. opc: { adicionar: pode tirar/escolher fotos, excluir: pode apagar (gerente) }.
   * Mostra as miniaturas, abre o visor ao tocar e, se pode adicionar, envia cada foto assim que é escolhida.
   */
  function galeria(raiz, ticketId, opc) {
    opc = opc || {};
    var t = global.Op.achar(ticketId);
    var fotos = t && !qtd(t) ? [] : null, enviando = 0, max = MAX_POR_VEICULO; // ticket sem fotos (pelo que o aparelho já sabe): nem consulta o servidor
    raiz.innerHTML = ESQUELETO;
    var grade = $('.fotos-grade', raiz), acoes = $('.fotos-acoes', raiz), msg = $('.dica', raiz);
    var botoes = opc.adicionar ? botoesAdicionar(adicionar) : null;
    if (botoes) acoes.appendChild(botoes.el);
    var vazio = doc.createElement('div');
    vazio.className = 'dica'; vazio.hidden = true; vazio.textContent = 'Nenhuma foto neste veículo.';
    raiz.insertBefore(vazio, acoes);

    function viva() { return doc.body.contains(raiz); } // a janela pode ter sido fechada enquanto a foto subia
    function aviso(texto) { msg.className = texto ? 'dica erro' : 'dica'; msg.textContent = texto || ''; }

    function desenhar() {
      if (!viva()) return;
      var n = fotos ? fotos.length : 0;
      grade.hidden = fotos !== null && !n && !enviando;
      vazio.hidden = fotos === null || n > 0 || enviando > 0;
      grade.innerHTML = fotos === null ? ESPERA_HTML : fotos.map(function (f, i) { return miniaturaHtml(f, i); }).join('') + (enviando ? ESPERA_HTML : '');
      if (botoes) botoes.desabilitar(fotos === null || n + enviando >= max);
    }

    function carregar() {
      return listar(ticketId).then(function (l) { fotos = l; desenhar(); }, function (e) {
        if (!viva()) return;
        if (fotos === null) fotos = [];
        aviso('Não consegui carregar as fotos. ' + e.message);
        desenhar();
      });
    }

    function adicionar(arquivos) {
      aviso('');
      var vagas = Math.max(0, max - (fotos ? fotos.length : 0) - enviando);
      if (arquivos.length > vagas) { aviso('O máximo é ' + max + ' fotos por veículo.'); arquivos = arquivos.slice(0, vagas); }
      enviando += arquivos.length; desenhar();
      var erro = '';
      return arquivos.reduce(function (p, arquivo) {
        return p.then(function () {
          if (erro) { enviando--; return null; } // uma falha já aconteceu: não adianta insistir nas outras
          return preparar(arquivo).then(function (it) { return enviar(ticketId, [it]); }).then(function (r) {
            if (r.falhas.length) erro = r.erro;
          }, function (e) { erro = e && e.message ? e.message : String(e); }).then(function () { enviando--; });
        });
      }, Promise.resolve()).then(function () {
        return carregar();
      }).then(function () {
        if (erro) aviso('Alguma foto não foi enviada. ' + erro);
      });
    }

    grade.addEventListener('click', function (ev) {
      var ver = ev.target.closest('[data-ver]');
      if (!ver || !fotos) return;
      visor(fotos, Number(ver.getAttribute('data-ver')), {
        excluir: opc.excluir ? function (f) { return excluir(f).then(carregar); } : null
      });
    });

    desenhar();
    if (fotos === null) carregar();
    return { recarregar: carregar };
  }

  /** A galeria de um ticket numa janela (atalho para a hora da entrega ou da conferência). */
  function abrir(ticketId) {
    var t = global.Op.achar(ticketId);
    if (!t) { Ui.toast('Ticket não encontrado.', 'erro'); return; }
    var m = Ui.modal({
      titulo: 'Fotos · #' + t.id + ' · ' + t.placa, largura: 'md', html: '<div id="fm-fotos"></div>',
      botoes: [{ rotulo: 'Fechar', classe: 'btn-primario', padrao: true, aoClicar: function (mm) { mm.fechar(); } }]
    });
    galeria($('#fm-fotos', m.corpo), t.id, { adicionar: global.Auth.pode('foto.adicionar'), excluir: global.Auth.pode('foto.excluir') });
  }

  global.Fotos = {
    MAX_POR_VEICULO: MAX_POR_VEICULO,
    preparar: preparar, enviar: enviar, listar: listar, qtd: qtd, selo: selo,
    seletor: seletor, galeria: galeria, abrir: abrir
  };
})(window);
