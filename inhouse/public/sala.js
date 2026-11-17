// Página da sala InHouse: conexão em tempo real, lobby, draft, resultado e série Fearless.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VAGAS = ['T', 'J', 'M', 'A', 'S'];
  const NOME_VAGA = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
  const TAGS = [['Fighter', 'Lutador'], ['Tank', 'Tanque'], ['Mage', 'Mago'], ['Assassin', 'Assassino'], ['Marksman', 'Atirador'], ['Support', 'Suporte']];
  const sem = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const id = location.pathname.split('/')[2];
  const embutido = window.parent !== window;
  if (embutido) document.body.classList.add('embutido');

  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  let cid = ler('dl-inhouse-cid');
  if (!cid || !/^[A-Za-z0-9_-]{8,40}$/.test(cid)) {
    cid = Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
    guardar('dl-inhouse-cid', cid);
  }

  let E = null; // estado vindo do servidor
  let desvio = 0; // relógio do servidor - relógio local
  let camps = null; // id -> { nome, tags }
  let ordem = []; // ids em ordem alfabética do nome
  let carregandoCamps = null;
  let filtro = { texto: '', tag: null };
  let modoMeio = null;
  let selecionado = null; // campeão clicado por mim (antes do servidor confirmar o hover)

  // ---------- utilidades ----------
  let toastT = null;
  function toast(msg, ok = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast on${ok ? ' ok' : ''}`;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = 'toast'; }, 3800);
  }
  const icone = (c) => (E && c ? `${E.dd}/cdn/${E.versao}/img/champion/${c}.png` : '');
  const arte = (c) => (E && c ? `${E.dd}/cdn/img/champion/centered/${c}_0.jpg` : '');
  const nome = (c) => (c ? camps?.[c]?.nome || c : '');
  const jogo = () => E.jogos[E.jogos.length - 1];
  const timeNoLado = (lado, j = jogo()) => (lado === 'azul' ? j.azul : j.azul === 'A' ? 'B' : 'A');
  const ladoDe = (t, j = jogo()) => (j.azul === t ? 'azul' : 'vermelho');
  const agoraServ = () => Date.now() + desvio;

  async function carregarCampeoes() {
    if (camps || carregandoCamps) return carregandoCamps;
    carregandoCamps = fetch(`${E.dd}/cdn/${E.versao}/data/pt_BR/champion.json`).then((r) => r.json()).then((d) => {
      camps = {};
      for (const c of Object.values(d.data)) camps[c.id] = { nome: c.name, tags: c.tags || [] };
      ordem = Object.keys(camps).sort((a, b) => camps[a].nome.localeCompare(camps[b].nome, 'pt-BR'));
      modoMeio = null;
      render();
    }).catch(() => { carregandoCamps = null; toast('Não consegui carregar os campeões. Recarregue a página.'); });
    return carregandoCamps;
  }

  // ---------- conexão ----------
  let ws = null;
  let tentativas = 0;
  let pingT = null;
  function conectar() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sala/${id}/ws`;
    ws = new WebSocket(url);
    ws.onopen = () => {
      tentativas = 0;
      $('conexao').className = 'conexao';
      ws.send(JSON.stringify({ t: 'ola', cid }));
      clearInterval(pingT);
      pingT = setInterval(() => { if (ws.readyState === 1) ws.send('{"t":"ping"}'); }, 30000);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'estado') {
        E = m.estado;
        desvio = E.agora - Date.now();
        carregarCampeoes();
        render();
        if (embutido) window.parent.postMessage({ tipo: 'draftlab-inhouse', estado: E, eu: cid }, '*');
      } else if (m.t === 'erro') {
        toast(m.msg);
        selecionado = null;
        render();
      }
    };
    ws.onclose = () => {
      clearInterval(pingT);
      const c = $('conexao');
      c.textContent = E ? 'Conexão perdida. Reconectando…' : 'Conectando…';
      c.className = 'conexao on';
      tentativas++;
      setTimeout(conectar, Math.min(1000 * tentativas, 5000));
    };
  }
  const enviar = (m) => {
    if (!ws || ws.readyState !== 1) { toast('Sem conexão com a sala. Aguarde a reconexão.'); return; }
    ws.send(JSON.stringify(m));
  };

  // ---------- render ----------
  function render() {
    if (!E) return;
    document.title = `${E.times.A.nome} x ${E.times.B.nome} · Draft Lab InHouse`;
    renderPlacar();
    renderTimes();
    renderBans();
    renderFase();
    renderMeio();
    renderExtras();
  }

  function renderPlacar() {
    const n = E.jogos.length;
    const serie = E.config.serie > 1 ? `Jogo ${n} · MD${E.config.serie}${E.config.fearless ? ' Fearless' : ''}` : 'MD1';
    $('placar').innerHTML = `<span class="tA">${esc(E.times.A.nome)}</span><span class="n">${E.times.A.vitorias}</span><span class="meio"><span class="sep">x</span><span class="info">${esc(serie)}</span></span><span class="n">${E.times.B.vitorias}</span><span class="tB">${esc(E.times.B.nome)}</span>`;
    let quem;
    if (E.eu) quem = `Você: <b>${NOME_VAGA[E.eu.vaga]}</b> · ${esc(E.times[E.eu.time].nome)}${E.eu.capitao ? ' · <b>capitão</b>' : ''}`;
    else if (E.fase === 'lobby') quem = 'Escolha o seu time e a sua rota';
    else quem = 'Você está assistindo';
    $('quem').innerHTML = quem;
  }

  function pickDe(t, v, j = jogo()) { return j.acoes.find((a) => a.tipo === 'pick' && a.time === t && a.vaga === v); }

  function renderTimes() {
    const vez = E.vez;
    for (const lado of ['azul', 'vermelho']) {
      const t = timeNoLado(lado);
      const T = E.times[t];
      const col = $(`col-${lado}`);
      col.className = `time ${lado}${vez && vez.time === t ? ' vez' : ''}`;
      const estado = E.fase === 'lobby' ? (T.pronto ? '<span class="pronto">Pronto</span>' : '<span class="aguardando">aguardando</span>') : '';
      let html = `<div class="cab"><div class="lado">Lado ${lado}</div><div class="nome">${esc(T.nome)} ${estado}</div></div>`;
      for (const v of VAGAS) {
        const p = T.vagas[v];
        const pk = pickDe(t, v);
        const hv = !pk && E.hovers?.[t]?.[v];
        const c = pk?.champ || hv || null;
        const agindo = vez && vez.tipo === 'pick' && vez.time === t && !pk && (!!p || (E.eu?.capitao && E.eu.time === t));
        const clicavel = E.fase === 'lobby' && !p;
        const cls = ['vaga', c ? 'tem' : '', hv ? 'marcando' : '', agindo ? 'agindo' : '', !p && !pk ? 'livre' : '', clicavel ? 'clicavel' : ''].filter(Boolean).join(' ');
        const jog = p ? `<span class="jog">${p.capitao ? '<span class="cap" title="Capitão">♛</span>' : ''}${esc(p.nome)}${p.eu ? '<span class="eu">você</span>' : ''}</span>` : `<span class="jog vazio">${clicavel ? 'Clique para entrar' : 'Vaga livre'}</span>`;
        html += `<div class="${cls}" data-vaga="${v}" data-time="${t}">${c ? `<div class="arte" style="background-image:url('${esc(arte(c))}')"></div>` : '<div class="arte"></div>'}<div class="txt"><span class="rota">${NOME_VAGA[v]}</span><span class="camp">${c ? esc(nome(c)) : '&nbsp;'}</span>${jog}</div></div>`;
      }
      col.innerHTML = html;
    }
  }

  function renderBans() {
    const j = jogo();
    const vez = E.vez;
    const fila = (lado) => {
      const t = timeNoLado(lado);
      const bans = j.acoes.filter((a) => a.tipo === 'ban' && a.lado === lado);
      const agora = vez && vez.tipo === 'ban' && vez.lado === lado;
      const marcado = agora ? Object.values(E.hovers?.[t] || {})[0] : null;
      const out = [];
      for (let i = 0; i < 5; i++) {
        const b = bans[i];
        if (b) out.push(b.champ ? `<div class="b cheio" title="${esc(nome(b.champ))}" style="background-image:url('${esc(icone(b.champ))}')"></div>` : '<div class="b vazio-ban" title="Sem ban">—</div>');
        else if (i === bans.length && agora) out.push(`<div class="b agora${marcado ? ' marcado' : ''}"${marcado ? ` style="background-image:url('${esc(icone(marcado))}')"` : ''}></div>`);
        else out.push('<div class="b"></div>');
      }
      return lado === 'vermelho' ? out.reverse().join('') : out.join('');
    };
    $('bans').innerHTML = `<div class="fila">${fila('azul')}</div><span class="tit">Bans</span><div class="fila verm">${fila('vermelho')}</div>`;
  }

  function renderFase() {
    const f = $('fase');
    const vez = E.vez;
    if (E.fase === 'draft' && vez) {
      const T = E.times[vez.time];
      const quem = vez.tipo === 'ban' ? 'o capitão bane' : 'quem ainda não escolheu pode travar';
      const minha = E.eu?.podeAgir;
      f.innerHTML = `<div class="esq ${vez.lado === 'azul' ? 'azul' : 'verm'}">${vez.tipo === 'ban' ? 'Ban' : 'Pick'} ${vez.n + 1} de 20<span class="grande">${esc(T.nome)}</span></div><div class="relogio ${vez.lado === 'azul' ? 'azul' : 'verm'}" id="relogio"></div><div class="dir">${minha ? '<b style="color:var(--verde2)">Sua vez!</b><br>' : ''}Lado ${vez.lado}: ${quem}</div>`;
      tique();
      return;
    }
    const textos = {
      lobby: ['Antes do draft', E.jogos.length > 1 ? `Jogo ${E.jogos.length}` : 'Montando os times', 'O draft começa quando os dois capitães confirmarem.'],
      jogando: ['Draft encerrado', 'Boa partida!', 'Depois do jogo, um capitão informa quem venceu.'],
      lado: ['Próximo jogo', 'Escolha de lado', `O capitão de ${esc(E.times[E.ladoPor]?.nome || '')} escolhe o lado.`],
      encerrada: ['Série encerrada', E.times.A.vitorias > E.times.B.vitorias ? `${esc(E.times.A.nome)} venceu` : `${esc(E.times.B.nome)} venceu`, `Placar final ${E.times.A.vitorias} x ${E.times.B.vitorias}.`],
    }[E.fase] || ['', '', ''];
    f.innerHTML = `<div class="esq">${textos[0]}<span class="grande">${textos[1]}</span></div><div></div><div class="dir">${textos[2]}</div>`;
  }

  function tique() {
    const r = $('relogio');
    if (!r || !E?.vez) return;
    if (E.vez.esgotado || !E.vez.prazo) {
      r.textContent = 'tempo';
      r.classList.add('parado');
      r.title = 'Tempo esgotado: o draft espera até alguém travar.';
      return;
    }
    const s = Math.max(0, Math.ceil((E.vez.prazo - agoraServ()) / 1000));
    r.textContent = s;
    r.classList.toggle('pouco', s <= 5);
  }
  setInterval(tique, 250);

  // ---------- meio ----------
  function renderMeio() {
    const m = $('meio');
    let modo = E.fase;
    if (E.fase === 'lobby') modo = `lobby:${E.eu ? 'dentro' : 'entrar'}`;
    if (E.fase === 'draft') modo = camps ? 'draft' : 'carregando';
    if (modo !== modoMeio) {
      modoMeio = modo;
      m.innerHTML = '';
      if (modo === 'draft') montarGrade(m);
    }
    if (modo === 'draft') return atualizarGrade();
    if (modo === 'carregando') { m.innerHTML = '<div class="painel"><p>Carregando campeões…</p></div>'; return; }
    if (E.fase === 'lobby') return lobby(m);
    if (E.fase === 'jogando') return jogando(m);
    if (E.fase === 'lado') return escolherLado(m);
    if (E.fase === 'encerrada') return encerrada(m);
  }

  // Nome e senha da personalizada: gerados pelo servidor, iguais para todos.
  function partidaHTML() {
    const P = E.partida;
    if (!P) return '';
    return `<div class="partida"><span class="rot">Partida personalizada</span>
      <div class="dado"><small>Nome</small><code>${esc(P.nome)}</code><button class="btn peq" data-copiar="${esc(P.nome)}" type="button">Copiar</button></div>
      <div class="dado"><small>Senha</small><code>${esc(P.senha)}</code><button class="btn peq" data-copiar="${esc(P.senha)}" type="button">Copiar</button></div></div>`;
  }

  function lobby(m) {
    const statusTimes = `<div class="status-times">${['A', 'B'].map((t) => {
      const T = E.times[t];
      const n = VAGAS.filter((v) => T.vagas[v]).length;
      return `<div><b>${esc(T.nome)}</b> · ${n}/5 jogadores · ${T.pronto ? '<span style="color:var(--verde2)">pronto</span>' : 'aguardando o capitão'}</div>`;
    }).join('')}</div>`;
    if (E.eu) {
      const T = E.times[E.eu.time];
      const outros = VAGAS.filter((v) => T.vagas[v] && !T.vagas[v].eu);
      const cap = E.eu.capitao
        ? `<div class="linha-acoes">
            <button class="btn ${T.pronto ? '' : 'primario'}" id="btn-pronto">${T.pronto ? 'Cancelar pronto' : 'Time pronto'}</button>
            ${outros.length ? `<select id="sel-cap" class="btn"><option value="">Passar capitania…</option>${outros.map((v) => `<option value="${v}">${esc(T.vagas[v].nome)} (${NOME_VAGA[v]})</option>`).join('')}</select>
            <select id="sel-tirar" class="btn"><option value="">Tirar do time…</option>${outros.map((v) => `<option value="${v}">${esc(T.vagas[v].nome)} (${NOME_VAGA[v]})</option>`).join('')}</select>` : ''}
          </div>
          <p style="margin-top:12px">Você é o capitão: faz os bans, confirma que o time está pronto e informa o resultado. Os picks são de cada jogador, e você pode escolher por quem não apareceu. Se alguém entrar no lugar errado, tire do time.</p>`
        : `<div class="linha-acoes"><button class="btn" id="btn-sair">Sair da vaga</button></div><p style="margin-top:12px">Na vez do seu time, trave o seu campeão. O capitão faz os bans.</p>`;
      m.innerHTML = `<div class="painel"><h2>Você está no ${NOME_VAGA[E.eu.vaga]} de ${esc(T.nome)}</h2>${partidaHTML()}${cap}${statusTimes}</div>`;
      $('btn-pronto')?.addEventListener('click', () => enviar({ t: 'pronto', valor: !T.pronto }));
      $('btn-sair')?.addEventListener('click', () => enviar({ t: 'sair' }));
      $('sel-cap')?.addEventListener('change', (e) => { if (e.target.value) enviar({ t: 'capitao', vaga: e.target.value }); });
      $('sel-tirar')?.addEventListener('change', (e) => {
        const v = e.target.value;
        if (v && confirm(`Tirar ${T.vagas[v].nome} do time?`)) enviar({ t: 'remover', vaga: v });
        e.target.value = '';
      });
      ligarCopiar(m);
      return;
    }
    m.innerHTML = `<div class="painel"><h2>Entrar na partida</h2><p>Digite o seu nick e clique na sua rota, no seu time. Quem só vai assistir não precisa fazer nada.</p>
      <div class="campo"><label for="nick">Seu nick (Riot ID)</label><input id="nick" maxlength="24" placeholder="Nome#TAG" value="${esc(ler('dl-inhouse-nick') || '')}"></div>
      <div class="escolha-times">${['A', 'B'].map((t) => `<div><span class="rot-time">${esc(E.times[t].nome)}</span>${trocarRota(t)}</div>`).join('')}</div>
      ${partidaHTML()}${statusTimes}</div>`;
    ligarRotas();
    ligarCopiar(m);
  }

  function ligarCopiar(m) {
    for (const b of m.querySelectorAll('[data-copiar]')) b.addEventListener('click', () => copiar(b.dataset.copiar, 'Copiado.'));
  }

  function trocarRota(t) {
    const T = E.times[t];
    return `<div class="rotas">${VAGAS.map((v) => {
      const p = T.vagas[v];
      return `<button data-rota="${v}" data-time="${t}" class="${p?.eu ? 'minha' : ''}" ${p && !p.eu ? 'disabled' : ''}>${NOME_VAGA[v]}<small>${p ? esc(p.nome) : 'livre'}</small></button>`;
    }).join('')}</div>`;
  }

  function entrar(v, t) {
    const atual = E.eu ? E.times[E.eu.time].vagas[E.eu.vaga]?.nome : null;
    const nick = ($('nick')?.value ?? atual ?? ler('dl-inhouse-nick') ?? '').trim();
    if (!nick) { toast('Digite o seu nick primeiro.'); $('nick')?.focus(); return; }
    guardar('dl-inhouse-nick', nick);
    enviar({ t: 'entrar', time: t, vaga: v, nome: nick });
  }

  function ligarRotas() {
    for (const b of document.querySelectorAll('[data-rota]')) b.addEventListener('click', () => entrar(b.dataset.rota, b.dataset.time));
  }

  // grade de campeões (montada uma vez por draft; depois só muda classes)
  function montarGrade(m) {
    m.innerHTML = `<div class="painel">
      <div class="filtros"><input id="busca" placeholder="Buscar campeão" autocomplete="off" value="${esc(filtro.texto)}">${TAGS.map(([k, n]) => `<button data-tag="${k}" class="${filtro.tag === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="grade" id="grade">${ordem.map((c) => `<button class="ch" data-c="${c}" title="${esc(camps[c].nome)}"><img loading="lazy" alt="" src="${esc(icone(c))}"><span>${esc(camps[c].nome)}</span></button>`).join('')}</div>
      <div class="travar" id="barra-travar"><span class="dica" id="dica"></span><select id="sel-vaga" hidden></select><button class="btn primario" id="btn-travar" disabled>Travar</button></div>
    </div>`;
    $('busca').addEventListener('input', (e) => { filtro.texto = e.target.value; atualizarGrade(); });
    for (const b of m.querySelectorAll('[data-tag]')) b.addEventListener('click', () => {
      filtro.tag = filtro.tag === b.dataset.tag ? null : b.dataset.tag;
      for (const x of m.querySelectorAll('[data-tag]')) x.classList.toggle('on', x.dataset.tag === filtro.tag);
      atualizarGrade();
    });
    $('grade').addEventListener('click', (e) => {
      const b = e.target.closest('.ch');
      if (!b || !E.eu) return;
      selecionado = b.dataset.c;
      enviar({ t: 'hover', champ: selecionado });
      atualizarGrade();
    });
    $('grade').addEventListener('dblclick', (e) => {
      const b = e.target.closest('.ch');
      if (b && E.eu?.podeAgir) travar(b.dataset.c);
    });
    $('btn-travar').addEventListener('click', () => travar());
  }

  function meuHover() {
    if (!E.eu) return null;
    return E.hovers?.[E.eu.time]?.[E.eu.vaga] || null;
  }

  function travar(c) {
    const champ = c || selecionado || meuHover();
    if (!champ) { toast('Escolha um campeão.'); return; }
    const sel = $('sel-vaga');
    const vaga = sel && !sel.hidden ? sel.value : undefined;
    enviar({ t: 'travar', champ, vaga });
    selecionado = null;
  }

  function atualizarGrade() {
    const grade = $('grade');
    if (!grade) return;
    const j = jogo();
    const usados = new Set(j.acoes.map((a) => a.champ).filter(Boolean));
    const fearless = new Set(E.fearless || []);
    const txt = sem(filtro.texto.trim());
    if (selecionado && (usados.has(selecionado) || fearless.has(selecionado))) selecionado = null;
    const marcado = selecionado || meuHover();
    for (const b of grade.children) {
      const c = b.dataset.c;
      const info = camps[c];
      const visivel = (!txt || sem(info.nome).includes(txt) || sem(c).includes(txt)) && (!filtro.tag || info.tags.includes(filtro.tag));
      b.hidden = !visivel;
      const fora = usados.has(c) || fearless.has(c);
      b.classList.toggle('fora', fora);
      b.classList.toggle('fearless', fearless.has(c));
      b.classList.toggle('sel', c === marcado);
      b.title = fearless.has(c) ? `${info.nome}: usado na série (Fearless)` : usados.has(c) ? `${info.nome}: indisponível` : info.nome;
    }
    grade.classList.toggle('so-ver', !E.eu);
    $('barra-travar').hidden = !E.eu;
    const btn = $('btn-travar');
    const dica = $('dica');
    const sel = $('sel-vaga');
    const vez = E.vez;
    const pode = !!E.eu?.podeAgir;
    btn.disabled = !pode || !marcado;
    btn.textContent = marcado ? `${vez?.tipo === 'ban' ? 'Banir' : 'Travar'} ${nome(marcado)}` : vez?.tipo === 'ban' ? 'Banir' : 'Travar';
    btn.className = `btn ${vez?.tipo === 'ban' ? 'verm' : 'primario'}`;
    // capitão no pick: escolher para qual rota vai o campeão
    const livres = E.eu?.livres || [];
    const mostrarSel = pode && vez?.tipo === 'pick' && E.eu.capitao && livres.length > 0 && (livres.length > 1 || livres[0] !== E.eu.vaga);
    if (mostrarSel) {
      const atual = sel.value;
      const T = E.times[E.eu.time];
      sel.innerHTML = livres.map((v) => `<option value="${v}">Para: ${NOME_VAGA[v]}${T.vagas[v] ? ` (${esc(T.vagas[v].nome)})` : ' (vaga livre)'}</option>`).join('');
      sel.value = livres.includes(atual) ? atual : livres.includes(E.eu.vaga) ? E.eu.vaga : livres[0];
    }
    sel.hidden = !mostrarSel;
    if (!E.eu) dica.textContent = 'Você está assistindo.';
    else if (pode) dica.textContent = vez.tipo === 'ban' ? 'Clique num campeão e confirme o ban (ou dê dois cliques).' : 'Clique no seu campeão e trave (ou dê dois cliques).';
    else if (vez && vez.time === E.eu.time && vez.tipo === 'ban') dica.textContent = 'O capitão está banindo. Marque um campeão para o seu time ver.';
    else dica.textContent = 'Você pode ir marcando o seu campeão: só o seu time vê.';
  }

  function jogando(m) {
    const cap = E.eu?.capitao;
    m.innerHTML = `<div class="painel"><h2>Draft encerrado</h2><p>Entrem na personalizada no LoL, cada um com o campeão que travou aqui. ${cap ? 'Depois do jogo, informe quem venceu:' : 'Depois do jogo, um capitão informa o resultado aqui.'}</p>${partidaHTML()}
      ${cap ? `<div class="resultado"><button class="btn azul" data-venc="${jogo().azul}">${esc(E.times[jogo().azul].nome)} venceu</button><button class="btn verm" data-venc="${timeNoLado('vermelho')}">${esc(E.times[timeNoLado('vermelho')].nome)} venceu</button></div>` : ''}
      <div class="linha-acoes" style="margin-top:14px"><button class="btn peq" id="btn-copiar-draft">Copiar draft em texto</button></div></div>`;
    for (const b of m.querySelectorAll('[data-venc]')) b.addEventListener('click', () => {
      if (confirm(`Confirmar vitória de ${E.times[b.dataset.venc].nome}?`)) enviar({ t: 'resultado', vencedor: b.dataset.venc });
    });
    $('btn-copiar-draft').addEventListener('click', () => copiar(textoDraft(), 'Draft copiado.'));
    ligarCopiar(m);
  }

  function escolherLado(m) {
    const pode = E.eu?.capitao && E.eu.time === E.ladoPor;
    const T = E.times[E.ladoPor];
    m.innerHTML = `<div class="painel"><h2>Próximo jogo</h2><p>${pode ? 'Seu time perdeu o jogo anterior, então você escolhe o lado do próximo jogo.' : `O capitão de ${esc(T.nome)} está escolhendo o lado.`}</p>
      ${pode ? '<div class="resultado"><button class="btn azul" data-lado="azul">Lado azul</button><button class="btn verm" data-lado="vermelho">Lado vermelho</button></div>' : ''}</div>`;
    for (const b of m.querySelectorAll('[data-lado]')) b.addEventListener('click', () => enviar({ t: 'lado', lado: b.dataset.lado }));
  }

  function encerrada(m) {
    const venc = E.times.A.vitorias > E.times.B.vitorias ? 'A' : 'B';
    m.innerHTML = `<div class="painel"><h2>${esc(E.times[venc].nome)} venceu ${E.config.serie > 1 ? `a série por ${Math.max(E.times.A.vitorias, E.times.B.vitorias)} x ${Math.min(E.times.A.vitorias, E.times.B.vitorias)}` : 'o jogo'}</h2>
      <p>O resultado entrou nas estatísticas das InHouses.</p><div class="linha-acoes"><a class="btn" href="/estatisticas" target="_blank" rel="noopener">Ver estatísticas</a><button class="btn" id="btn-copiar-draft">Copiar draft em texto</button></div></div>`;
    $('btn-copiar-draft').addEventListener('click', () => copiar(textoDraft(), 'Draft copiado.'));
  }

  function textoDraft() {
    const linhas = [];
    E.jogos.forEach((j, i) => {
      if (!j.acoes.length) return;
      linhas.push(`Jogo ${i + 1}${j.vencedor ? ` (venceu ${E.times[j.vencedor].nome})` : ''}`);
      for (const lado of ['azul', 'vermelho']) {
        const t = timeNoLado(lado, j);
        const picks = VAGAS.map((v) => `${NOME_VAGA[v]}: ${nome(pickDe(t, v, j)?.champ) || '—'}`).join(' | ');
        const bans = j.acoes.filter((a) => a.tipo === 'ban' && a.time === t).map((a) => nome(a.champ) || 'sem ban').join(', ');
        linhas.push(`${lado === 'azul' ? '🔵' : '🔴'} ${E.times[t].nome}: ${picks} · Bans: ${bans}`);
      }
    });
    return linhas.join('\n');
  }

  async function copiar(txt, ok) {
    try { await navigator.clipboard.writeText(txt); toast(ok, true); } catch { prompt('Copie:', txt); }
  }

  // ---------- extras: Fearless e jogos anteriores ----------
  function renderExtras() {
    const x = $('extras');
    const ant = E.jogos.filter((j) => j.vencedor);
    if (!E.config.fearless && !ant.length) { x.innerHTML = ''; return; }
    let html = '';
    if (E.config.fearless && E.fase !== 'encerrada') {
      html += `<div class="bloco"><h3>Fearless · ${E.fearless.length} campeões já usados na série</h3>${E.fearless.length ? `<div class="icones">${E.fearless.map((c) => `<img src="${esc(icone(c))}" title="${esc(nome(c))}" alt="">`).join('')}</div>` : '<span style="color:var(--fraco);font-size:13.5px">Os campeões escolhidos em cada jogo ficam bloqueados para os próximos jogos da série.</span>'}</div>`;
    }
    if (ant.length) {
      html += `<div class="bloco"><h3>Jogos da série</h3>${ant.map((j) => {
        const n = E.jogos.indexOf(j) + 1;
        const lado = (l) => { const t = timeNoLado(l, j); return `<div class="icones">${VAGAS.map((v) => pickDe(t, v, j)?.champ).filter(Boolean).map((c) => `<img src="${esc(icone(c))}" title="${esc(nome(c))}" alt="">`).join('')}</div>`; };
        return `<div class="jogo-ant"><b>Jogo ${n}</b><span>${esc(E.times[j.vencedor].nome)} venceu (${ladoDe(j.vencedor, j)})</span><span class="lado-a">${esc(E.times[timeNoLado('azul', j)].nome)}</span>${lado('azul')}<span class="lado-v">${esc(E.times[timeNoLado('vermelho', j)].nome)}</span>${lado('vermelho')}</div>`;
      }).join('')}</div>`;
    }
    x.innerHTML = html;
  }

  // clicar numa vaga livre do próprio time entra nela (lobby)
  document.addEventListener('click', (e) => {
    const v = e.target.closest('.vaga.clicavel');
    if (!v) return;
    entrar(v.dataset.vaga, v.dataset.time);
  });

  if (!/^[A-Za-z0-9]{8}$/.test(id || '')) {
    document.body.innerHTML = '<div style="padding:60px;text-align:center"><h1>Sala não encontrada</h1><p>Confira o link.</p></div>';
  } else {
    conectar();
  }
})();
