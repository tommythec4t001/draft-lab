// Draft Lab — suas partidas e o seu desempenho comparado com o elo
(() => {
  const D = window.DL, E = window.DraftEngine;
  const $ = (id) => document.getElementById(id);
  const { esc, fmt, api } = D;
  const ROLE = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Suporte' };
  const ROLE_PL = { T: 'tops', J: 'junglers', M: 'mids', A: 'ADCs', S: 'suportes' };
  let PLAYER = null, MATCHES = [], NAMES = { spells: {}, runes: {} }, QUEUES = {}, FILA = '';
  let open = null; // partida aberta

  // ---------- Você ----------
  function youHTML(p, note = '') {
    if (!p) return `
      <div class="you-empty">
        <h2>Quem é você?</h2>
        <p>Com o cliente do LoL aberto o Draft Lab descobre sozinho. Ou escreva o seu Riot ID.</p>
        <form class="you-form" id="youForm-${note}">
          <label class="field wide">Riot ID <input name="riotId" placeholder="Nome#BR1" autocomplete="off" spellcheck="false"></label>
          <button class="btn primary">Usar esta conta</button>
          <span class="note" role="status"></span>
        </form>
      </div>`;
    const icon = p.profileIconId != null ? `<img class="you-icon" src="/img/profile/${p.profileIconId}" alt="" data-fail="remove">` : '';
    return `<div class="you-card">${icon}<div><h2>${esc(p.gameName)}<span>#${esc(p.tagLine)}</span></h2>
      <p>${p.summonerLevel ? `Nível ${p.summonerLevel}. ` : ''}${p.source === 'cliente' ? 'Conta do cliente do LoL.' : 'Conta escolhida pelo Riot ID.'}</p></div></div>`;
  }
  function bindYouForm() {
    for (const f of document.querySelectorAll('.you-form')) f.onsubmit = async (e) => {
      e.preventDefault();
      const note = f.querySelector('.note');
      note.className = 'note'; note.textContent = 'Procurando…';
      try {
        const r = await api('/api/jogador', { method: 'PUT', body: JSON.stringify({ riotId: f.riotId.value }) });
        PLAYER = r.player; loadMatches(true);
      } catch (err) { note.className = 'note err'; note.textContent = err.message; }
    };
  }

  // ---------- Nota do draft ----------
  function draftOf(m) {
    const byName = Object.fromEntries(D.CHAMPS.map((c) => [c.name, c]));
    const side = (team) => m.players.filter((p) => p.team === team).map((p) => ({ name: D.nameOf(p.champ), role: p.pos })).filter((p) => p.name);
    const { stats, lane, duo } = D.stats;
    return E.draftScore({ mine: side(m.me.team), enemy: side(m.me.team === 100 ? 200 : 100), byName, rel: D.REL, stats, lane, duo });
  }
  const tone = (score) => (score >= 6.5 ? 'up' : score < 4 ? 'down' : '');
  function ring(value, max, cls, label, text = value.toFixed(1).replace('.', ',')) {
    const r = 21, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, value / max));
    return `<svg class="ring ${cls}" viewBox="0 0 52 52" role="img" aria-label="${label}"><circle cx="26" cy="26" r="${r}" class="ring-bg"/><circle cx="26" cy="26" r="${r}" class="ring-fg" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 26 26)"/><text x="26" y="31" text-anchor="middle">${text}</text></svg>`;
  }

  // ---------- Partidas ----------
  const ago = (t) => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const img = (kind, id, title, cls = '') => (id ? `<img class="${cls}" src="/img/${kind}/${id}" alt="${esc(title || '')}" title="${esc(title || '')}" loading="lazy" data-fail="${cls} slot-empty">` : `<span class="${cls} slot-empty"></span>`);

  function matchHTML(m) {
    const c = D.champ(m.me.champ), o = D.champ(m.opp);
    const min = Math.max(1, m.duration / 60);
    const res = m.remake ? 'Refeita' : m.win ? 'Vitória' : 'Derrota';
    const kda = ((m.me.k + m.me.a) / Math.max(1, m.me.d)).toFixed(1);
    const d = m.remake ? null : draftOf(m);
    const items = m.me.items.slice(0, 6).map((id) => img('item', id || 0, '', 'item')).join('') + img('item', m.me.items[6] || 0, '', 'item trinket');
    const isOpen = open === m.id;
    return `<article class="match ${m.remake ? 'remake' : m.win ? 'win' : 'loss'}${isOpen ? ' open' : ''}" data-id="${esc(m.id)}">
      <button class="mrow" aria-expanded="${isOpen}">
        <span class="mchamp">
          ${c?.icon ? `<img src="${c.icon}" alt="" class="mc">` : '<span class="mc"></span>'}
          ${m.me.pos ? `<span class="mrole">${ROLE[m.me.pos]}</span>` : ''}
        </span>
        <span class="mvs">${o ? `contra ${o.icon ? `<img src="${o.icon}" alt="">` : ''}<b>${esc(o.name)}</b>` : ''}</span>
        <span class="mres"><b>${res}</b><small>${esc(QUEUES[m.queue] || '')}</small><small>${mmss(m.duration)}, ${ago(m.start)}</small></span>
        <span class="mload">
          <span class="msp">${img('spell', m.me.spells[0], NAMES.spells[m.me.spells[0]])}${img('spell', m.me.spells[1], NAMES.spells[m.me.spells[1]])}</span>
          <span class="msp">${img('rune', m.me.rune, NAMES.runes[m.me.rune], 'rune')}${img('rune', m.me.runeSub, NAMES.runes[m.me.runeSub], 'rune sub')}</span>
          <span class="mitems">${items}</span>
        </span>
        <span class="mstats">
          <b class="num">${m.me.k}/${m.me.d}/${m.me.a}</b><small>KDA ${kda}</small>
          <small class="num">${(m.me.cs / min).toFixed(1)} CS/min, ${Math.round(m.me.gold / min)} ouro/min</small>
        </span>
        <span class="mscore">${d ? ring(d.score, 10, tone(d.score), `Nota do draft ${d.score}`) + '<small>Nota do draft</small>' : ''}</span>
      </button>
      ${isOpen && !m.remake ? `<div class="coach-slot" data-coach="${esc(m.id)}"></div>` : ''}
      ${isOpen && d ? detailHTML(m, d) : ''}
    </article>`;
  }

  function detailHTML(m, d) {
    const team = (t) => m.players.filter((p) => p.team === t).sort((a, b) => 'TJMAS'.indexOf(a.pos) - 'TJMAS'.indexOf(b.pos)).map((p) => {
      const c = D.champ(p.champ);
      return `<li class="${p.me ? 'me' : ''}">${c?.icon ? `<img src="${c.icon}" alt="">` : ''}<span>${esc(c?.name || '?')}</span><small>${ROLE[p.pos] || ''}</small></li>`;
    }).join('');
    const mineT = m.me.team, theirT = mineT === 100 ? 200 : 100;
    const parts = d.parts.slice(0, 8).map((x) => `<li class="${x.value > 0 ? 'g' : 'b'}"><b class="num">${x.value > 0 ? '+' : ''}${x.value}</b>${esc(x.text)}</li>`).join('');
    return `<div class="mdetail">
      <div class="mteams">
        <div><h4 class="ally">Seu time</h4><ul class="mteam">${team(mineT)}</ul></div>
        <div><h4 class="enemy">Time inimigo</h4><ul class="mteam">${team(theirT)}</ul></div>
      </div>
      <div class="mwhy">
        <h4>Por que ${d.score.toFixed(1).replace('.', ',')}</h4>
        ${parts ? `<ul class="mparts">${parts}</ul>` : '<p class="note">Sem estatísticas nem fichas suficientes para esses campeões: a nota fica em 5, neutra.</p>'}
        <p class="fine">A nota soma, em pontos de win rate, a força de cada campeão na rota, os confrontos de rota, as duplas e os alertas de composição. 5 é um draft equilibrado; acima de 6,5 o seu time saiu na frente.</p>
      </div>
    </div>`;
  }

  function renderMatches() {
    $('youMatches').innerHTML = youHTML(PLAYER, 'm');
    bindYouForm();
    const list = $('mList');
    if (!PLAYER) { list.innerHTML = ''; return; }
    if (!MATCHES.length) { list.innerHTML = `<p class="idle-line">Nenhuma partida salva ainda. Clique em Buscar partidas novas.</p>`; return; }
    list.innerHTML = MATCHES.map(matchHTML).join('');
    for (const a of list.querySelectorAll('.match')) a.querySelector('.mrow').onclick = () => { open = open === a.dataset.id ? null : a.dataset.id; renderMatches(); };
    // Coach pós-partida no topo da partida aberta (public/coach.js)
    for (const el of list.querySelectorAll('[data-coach]')) window.DLCoach?.montar(el, el.dataset.coach);
  }

  let loading = false;
  async function loadMatches(refresh = false) {
    if (loading) return;
    loading = true;
    $('mRefresh').disabled = true;
    $('mMsg').className = 'note'; $('mMsg').textContent = refresh ? 'Buscando na Riot…' : '';
    try {
      const r = await api(`/api/partidas?fila=${FILA}${refresh ? '&atualizar=1' : ''}`);
      PLAYER = r.player; MATCHES = r.matches; QUEUES = r.queues || {}; NAMES = r.names || NAMES;
      $('mMsg').textContent = r.error && r.error !== 'player' ? r.error : refresh ? 'Atualizado.' : '';
      if (r.error && r.error !== 'player') $('mMsg').className = 'note err';
    } catch (err) { $('mMsg').className = 'note err'; $('mMsg').textContent = err.message; }
    loading = false; $('mRefresh').disabled = false;
    renderMatches();
    if (!$('view-perf').hidden) loadPerf();
  }
  $('mRefresh').onclick = () => loadMatches(true);
  for (const b of document.querySelectorAll('[data-fila]')) b.onclick = () => {
    FILA = b.dataset.fila;
    for (const x of document.querySelectorAll('[data-fila]')) x.setAttribute('aria-pressed', String(x === b));
    loadMatches();
  };

  // ---------- Desempenho ----------
  let ROLE_SEL = null;
  const pctTone = (p) => (p == null ? '' : p >= 60 ? 'up' : p < 40 ? 'down' : '');
  const show = (m, v) => (v == null ? '–' : m.percent ? `${Math.round(v)}%` : v.toFixed(m.digits).replace('.', ','));

  async function loadPerf() {
    $('youPerf').innerHTML = youHTML(PLAYER, 'p');
    bindYouForm();
    if (!PLAYER) { $('pGroups').innerHTML = ''; $('pIntro').textContent = ''; $('pRoles').innerHTML = ''; return; }
    const q = new URLSearchParams({ fila: $('pQueue').value, n: $('pN').value });
    if (ROLE_SEL) q.set('rota', ROLE_SEL);
    let r;
    try { r = await api('/api/desempenho?' + q); } catch (err) { $('pIntro').textContent = err.message; return; }
    $('pRoles').innerHTML = Object.entries(r.roles || {}).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<button class="chip" data-role="${k}" aria-pressed="${k === r.role}">${ROLE[k]} <small>${n}</small></button>`).join('');
    for (const b of $('pRoles').querySelectorAll('[data-role]')) b.onclick = () => { ROLE_SEL = b.dataset.role; loadPerf(); };
    if (!r.role || !r.games) {
      $('pIntro').textContent = 'Ainda não há partidas suas salvas nessa fila. Vá em Partidas e clique em Buscar partidas novas.';
      $('pGroups').innerHTML = ''; return;
    }
    const who = `${ROLE_PL[r.role]} ${r.elo}`;
    $('pIntro').innerHTML = r.eloSamples
      ? `Suas últimas <b>${r.games}</b> partidas de ${ROLE[r.role]} comparadas com <b>${fmt(r.eloSamples)}</b> partidas de ${esc(who)} coletadas. A porcentagem diz em quantas dessas partidas o resultado foi pior que a sua média.`
      : `Suas últimas <b>${r.games}</b> partidas de ${ROLE[r.role]}. A comparação com ${esc(who)} aparece quando a coleta juntar partidas novas: as amostras de desempenho começaram a ser guardadas nesta versão.`;
    $('pGroups').innerHTML = r.groups.map((g) => {
      const ms = r.metrics.filter((m) => m.group === g.id);
      const head = g.pct != null
        ? `${ring(g.pct, 100, pctTone(g.pct), `${g.label}: melhor que ${g.pct}%`, `${g.pct}%`)}<div><h3>${g.label}</h3><p>Melhor que ${g.pct}% das partidas de ${esc(who)}</p></div>`
        : `<div><h3>${g.label}</h3><p>Sem comparação ainda</p></div>`;
      return `<section class="pcard"><div class="phead">${head}</div>
        <ul class="pmetrics">${ms.map((m) => `
          <li>
            <div class="pm-top"><span>${m.label}</span><b class="num">${show(m, m.mine)}</b></div>
            <div class="pm-bar ${pctTone(m.pct)}"><i style="width:${m.pct ?? 0}%"></i></div>
            <div class="pm-sub">${m.elo != null ? `Elo: ${show(m, m.elo)}` : 'Elo: sem dados'}${m.pct != null ? `<span class="${pctTone(m.pct)}">melhor que ${m.pct}%</span>` : ''}</div>
          </li>`).join('')}</ul>
      </section>`;
    }).join('');
  }
  $('pQueue').onchange = loadPerf;
  $('pN').onchange = loadPerf;

  // ---------- Quando cada tela abre ----------
  let loadedOnce = false;
  document.addEventListener('dl:view', (e) => {
    if (e.detail === 'matches') { if (!loadedOnce) { loadedOnce = true; loadMatches(true); } else renderMatches(); }
    if (e.detail === 'perf') { if (!loadedOnce) { loadedOnce = true; loadMatches(true).then(loadPerf); } else loadPerf(); }
  });
  // Estatísticas recarregadas: recalcula as notas
  document.addEventListener('dl:stats', () => { if (!$('view-matches').hidden && MATCHES.length) renderMatches(); });
  // A conta do cliente apareceu: busca o histórico dela
  let lastMe = null;
  document.addEventListener('dl:lcu', () => {
    const me = D.snap?.me ? `${D.snap.me.gameName}#${D.snap.me.tagLine}` : null;
    if (me && me !== lastMe) { lastMe = me; if (!$('view-matches').hidden || !$('view-perf').hidden) loadMatches(true); }
  });
  // Partida nova buscada sozinha depois do fim do jogo: atualiza a lista e o desempenho
  document.addEventListener('dl:partidas', (e) => {
    if (!loadedOnce) return;
    loadMatches(false).then(() => {
      $('mMsg').className = 'note ok';
      $('mMsg').textContent = e.detail?.added === 1 ? 'A partida que acabou de terminar já está aqui.' : `${e.detail?.added || ''} partidas novas.`;
    });
  });

  // A tela salva pode já ser Partidas ou Desempenho ao abrir o app
  if (!$('view-matches').hidden || !$('view-perf').hidden) { loadedOnce = true; loadMatches(true); }
})();
