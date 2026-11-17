// Draft Lab — InHouse
// Sala de draft alternado de torneio para partidas personalizadas (os 10 jogadores escolhem pelo navegador).
// A sala vive no servidor InHouse (pasta inhouse/); aqui ela aparece num quadro, com a análise do Draft Lab ao lado.
(() => {
  const $ = (id) => document.getElementById(id);
  const DL = window.DL;
  const { api, esc } = DL;
  const VAGAS = ['T', 'J', 'M', 'A', 'S'];
  const ROTA = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };

  let BASE = '';          // endereço do servidor InHouse
  let CRIADA = null;      // última sala criada aqui
  let ABERTA = store.get('dl-ih-aberta', null); // link da sala aberta no quadro
  let ESTADO = null;      // último estado recebido da sala
  let byId = null;

  const msg = (t, k = '') => { const el = $('ihMsg'); el.className = 'note ' + k; el.textContent = t; };
  const copiar = async (txt, ok) => { try { await navigator.clipboard.writeText(txt); msg(ok, 'ok'); } catch { prompt('Copie:', txt); } };

  async function carregar() {
    try { BASE = (await api('/api/inhouse')).url || ''; } catch { BASE = ''; }
    $('ihServidor').hidden = !!BASE;
    $('ihInicio').hidden = !BASE;
    $('ihServTxt').textContent = BASE ? BASE.replace(/^https?:\/\//, '') : '';
    $('ihServInfo').hidden = !BASE;
    if (BASE && ABERTA) abrir(ABERTA, false);
  }

  // ---------- servidor ----------
  $('ihServForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      BASE = (await api('/api/inhouse', { method: 'PUT', body: JSON.stringify({ url: $('ihServUrl').value }) })).url;
      msg(BASE ? 'Servidor InHouse configurado.' : 'Endereço removido.', 'ok');
      await carregar();
    } catch (err) { msg(err.message, 'err'); }
  };
  $('ihTrocarServ').onclick = () => { $('ihServidor').hidden = false; $('ihServUrl').value = BASE; $('ihServUrl').focus(); };

  // ---------- criar ----------
  const serie = $('ihSerie');
  const ajustar = () => { $('ihLinhaFearless').hidden = serie.value === '1'; };
  serie.onchange = ajustar;
  ajustar();
  $('ihForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('ihCriar');
    btn.disabled = true;
    msg('Criando a sala…');
    try {
      CRIADA = await api('/api/inhouse/criar', {
        method: 'POST',
        body: JSON.stringify({ timeA: $('ihTimeA').value, timeB: $('ihTimeB').value, serie: Number(serie.value), fearless: $('ihFearless').checked, tempo: Number($('ihTempo').value) }),
      });
      msg('Sala criada. Mande a mensagem no Discord e entre na sala.', 'ok');
      mostrarCriada();
    } catch (err) { msg(err.message, 'err'); }
    finally { btn.disabled = false; }
  };

  function mostrarCriada() {
    const c = CRIADA;
    $('ihCriada').hidden = !c;
    if (!c) return;
    const linha = (rot, valor, entrar) => `<div class="ih-link"><b>${esc(rot)}</b><code title="${esc(valor)}">${esc(valor)}</code><button class="btn small" data-copiar="${esc(valor)}" type="button">Copiar</button>${entrar ? `<button class="btn small primary" data-abrir="${esc(valor)}" type="button">Entrar</button>` : '<span></span>'}</div>`;
    $('ihLinks').innerHTML = linha('Link da sala', c.link, true) + linha('Nome', c.partida.nome, false) + linha('Senha', c.partida.senha, false);
  }
  $('ihLinks').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copiar) copiar(b.dataset.copiar, 'Copiado.');
    if (b.dataset.abrir) abrir(b.dataset.abrir);
  };
  $('ihCopiarMsg').onclick = () => CRIADA && copiar(CRIADA.mensagem, 'Mensagem copiada. É só colar no Discord.');

  // ---------- abrir ----------
  $('ihAbrirForm').onsubmit = (e) => { e.preventDefault(); abrir($('ihLink').value); };

  async function abrir(link, avisar = true) {
    try {
      const { link: ok } = await api('/api/inhouse/abrir', { method: 'POST', body: JSON.stringify({ link }) });
      ABERTA = ok;
      store.set('dl-ih-aberta', ok);
      ESTADO = null;
      $('ihFrame').src = ok;
      $('ihSalaInfo').textContent = 'Escolha o seu time e a sua rota na sala, ou só assista.';
      $('ihNavegador').href = ok;
      $('ihSala').hidden = false;
      $('ihInicio').hidden = true;
      $('ihAnalise').innerHTML = '<p class="wait">A análise aparece quando a sala carregar.</p>';
    } catch (err) {
      if (avisar) msg(err.message, 'err');
      ABERTA = null;
      store.set('dl-ih-aberta', null);
    }
  }
  $('ihFechar').onclick = () => {
    ABERTA = null;
    ESTADO = null;
    store.set('dl-ih-aberta', null);
    $('ihFrame').src = 'about:blank';
    $('ihSala').hidden = true;
    $('ihInicio').hidden = !BASE;
  };

  // ---------- análise ----------
  window.addEventListener('message', (e) => {
    if (!BASE || e.origin !== BASE || e.source !== $('ihFrame').contentWindow) return;
    const d = e.data;
    if (!d || d.tipo !== 'draftlab-inhouse' || !d.estado) return;
    ESTADO = d.estado;
    analisar();
  });
  document.addEventListener('dl:champs', () => { byId = null; if (ESTADO) analisar(); });

  const chaveDe = (id) => {
    if (!id) return 0;
    if (!byId) byId = Object.fromEntries(DL.CHAMPS.map((c) => [c.id, c]));
    return Number(byId[id]?.key) || 0;
  };

  // Converte o estado da sala no formato do draft ao vivo (o mesmo que vem do cliente do LoL).
  function montarDraft(S) {
    const j = S.jogos[S.jogos.length - 1];
    const ladoDe = (t) => (j.azul === t ? 'B' : 'R');
    const players = { B: [], R: [] };
    for (const t of ['A', 'B']) {
      const lado = ladoDe(t);
      VAGAS.forEach((v, i) => {
        const pk = j.acoes.find((a) => a.tipo === 'pick' && a.time === t && a.vaga === v);
        const p = S.times[t].vagas[v];
        players[lado].push({ cellId: (lado === 'B' ? 0 : 5) + i, role: v, champion: chaveDe(pk?.champ), hover: chaveDe(S.hovers?.[t]?.[v]), isMe: !!(S.eu && S.eu.time === t && S.eu.vaga === v), label: p?.nome || ROTA[v] });
      });
    }
    const bans = { B: j.acoes.filter((a) => a.tipo === 'ban' && a.lado === 'azul').map((a) => chaveDe(a.champ)), R: j.acoes.filter((a) => a.tipo === 'ban' && a.lado === 'vermelho').map((a) => chaveDe(a.champ)) };
    let current = null;
    const vez = S.vez;
    if (vez) {
      const lado = vez.lado === 'azul' ? 'B' : 'R';
      const time = players[lado];
      const alvo = vez.tipo === 'pick' ? time.find((p) => p.isMe && !p.champion) || time.find((p) => !p.champion) : time[0];
      current = { type: vez.tipo, side: lado, cellId: alvo?.cellId ?? time[0].cellId };
    }
    const mySide = S.eu ? ladoDe(S.eu.time) : vez ? (vez.lado === 'azul' ? 'B' : 'R') : 'B';
    return { d: { players, bans, current, mySide, done: S.fase !== 'draft', fora: (S.fearless || []).map(chaveDe) }, ladoDe };
  }

  function analisar() {
    const S = ESTADO;
    const box = $('ihAnalise');
    if (!S || !DL.CHAMPS.length) return;
    if (S.fase === 'lobby' && !S.jogos[S.jogos.length - 1].acoes.length) {
      box.innerHTML = `<h2 class="ih-h">Análise do Draft Lab</h2><p class="wait">Quando o draft começar, aqui aparecem as sugestões de pick e ban com as estatísticas de soloQ do Draft Lab${S.config.fearless ? ', já sem os campeões bloqueados pelo Fearless' : ''}, e a composição dos dois times.</p>`;
      return;
    }
    const { d, ladoDe } = montarDraft(S);
    const nomeLado = (lado) => {
      const t = ['A', 'B'].find((x) => ladoDe(x) === lado);
      return `${esc(S.times[t].nome)}<span>lado ${lado === 'B' ? 'azul' : 'vermelho'}</span>`;
    };
    const outro = d.mySide === 'B' ? 'R' : 'B';
    const r = DL.analiseInhouse(d, { tituloA: nomeLado(d.mySide), tituloE: nomeLado(outro) });
    let sug = '';
    if (r.sug) {
      let titulo = r.sug.title;
      if (!S.eu && S.vez) titulo = `${S.vez.tipo === 'ban' ? 'Bans' : 'Picks'} para ${S.times[S.vez.time].nome}`;
      sug = `<section class="ih-sug"><h2 class="ih-h">${esc(titulo)}</h2><p class="note">${esc(r.sug.sub)}${S.config.fearless && S.fearless.length ? ` Campeões bloqueados pelo Fearless já estão fora.` : ''}</p>${r.sug.html}</section>`;
    } else if (S.fase !== 'draft') {
      sug = '<section class="ih-sug"><h2 class="ih-h">Draft encerrado</h2><p class="note">Veja abaixo como ficaram as composições.</p></section>';
    }
    box.innerHTML = `${sug}<section class="ih-comp"><div class="compcard">${r.compA}</div><div class="compcard">${r.compE}</div></section>`;
  }

  document.addEventListener('dl:view', (e) => { if (e.detail === 'inhouse' && !BASE) carregar(); });
  carregar();
})();
