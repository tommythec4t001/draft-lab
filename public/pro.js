// Draft Lab — Fearless ao vivo (partidas profissionais)
// Acompanha as partidas do lolesports: placar da série, campeões de cada jogo, campeões travados pelo
// Fearless, leitura de rota contra rota, nota do draft e composição, com as mesmas regras do draft ao vivo.
(() => {
  const $ = (id) => document.getElementById(id);
  const DL = window.DL;
  const E = window.DraftEngine;
  const { api, esc, fmt } = DL;
  const ROLE_PT = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
  const ROLES = ['T', 'J', 'M', 'A', 'S'];
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };
  const byId = () => Object.fromEntries(DL.CHAMPS.map((c) => [c.id, c]));
  const byNameMap = () => Object.fromEntries(DL.CHAMPS.map((c) => [c.name, c]));
  const n1 = (x) => x.toFixed(1).replace('.', ',');
  const kGold = (g) => `${n1(g / 1000)} mil`;

  let AG = null;              // agenda
  let LIGA = store.get('dl-pro-liga', '');
  let SEL = store.get('dl-pro-sel', null);
  let MATCH = null;
  let GAME = null;            // número do jogo aberto
  let POOL_ROLE = '';
  let POOL_Q = '';
  let timer = null;

  const visible = () => !$('view-pro').hidden;
  const logo = (src, cls = 'tlogo') => (src ? `<img class="${cls}" src="${src}" alt="" loading="lazy" data-fail="${cls} none">` : `<span class="${cls} none"></span>`);
  const quando = (iso) => {
    if (!iso) return '';
    const d = new Date(iso), hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, hoje)) return `hoje, ${hora}`;
    if (same(d, amanha)) return `amanhã, ${hora}`;
    if (same(d, ontem)) return `ontem, ${hora}`;
    return `${d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}, ${hora}`;
  };

  // ============ Lista de partidas ============
  async function loadAgenda(fresh = false) {
    $('proMsg').className = 'note';
    if (!AG) $('proMsg').textContent = 'Carregando as partidas…';
    try {
      AG = await api('/api/pro/agenda' + (fresh ? '?atualizar=1' : ''));
      $('proMsg').textContent = '';
      renderLigas();
      renderList();
      if (!SEL) {
        const first = AG.aoVivo[0] || AG.recentes[0];
        if (first) openMatch(first.id);
      }
    } catch (err) {
      $('proMsg').className = 'note err';
      $('proMsg').textContent = err.message;
    }
  }
  function all() { return AG ? [...AG.aoVivo, ...AG.recentes, ...AG.proximas] : []; }
  function renderLigas() {
    const ligas = [...new Set(all().map((x) => x.league).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (LIGA && !ligas.includes(LIGA)) ligas.unshift(LIGA);
    $('proLiga').innerHTML = `<option value="">Todas as ligas</option>${ligas.map((l) => `<option value="${esc(l)}"${l === LIGA ? ' selected' : ''}>${esc(l)}</option>`).join('')}`;
  }
  $('proLiga').onchange = () => { LIGA = $('proLiga').value; store.set('dl-pro-liga', LIGA); renderList(); };
  $('proRefresh').onclick = async () => { await loadAgenda(true); if (SEL) openMatch(SEL, true); };

  function itemHTML(x) {
    const [a, b] = x.teams;
    const score = x.state === 'em-breve' ? `<small>${esc(quando(x.start))}</small>` : `<b class="num">${a?.wins ?? 0} – ${b?.wins ?? 0}</b>`;
    const side = (t, won) => `<span class="pt${won ? ' won' : ''}">${logo(t?.logo)}<span>${esc(t?.code || '?')}</span></span>`;
    return `<li><button class="pitem${x.id === SEL ? ' on' : ''}" data-id="${esc(x.id)}">
      <span class="pleague">${x.state === 'ao-vivo' ? '<i class="livedot" aria-label="ao vivo"></i>' : ''}${esc(x.league)}<small>MD${x.bestOf}${x.block ? ' · ' + esc(x.block) : ''}</small></span>
      <span class="pteams">${side(a, a?.outcome === 'win')}${score}${side(b, b?.outcome === 'win')}</span>
    </button></li>`;
  }
  function renderList() {
    if (!AG) return;
    const f = (arr) => arr.filter((x) => !LIGA || x.league === LIGA);
    const sec = (title, arr, empty) => `<h2 class="psec">${title}</h2>${arr.length ? `<ul class="plist2">${arr.map(itemHTML).join('')}</ul>` : `<p class="note">${empty}</p>`}`;
    $('proList').innerHTML =
      sec('Ao vivo agora', f(AG.aoVivo), 'Nenhuma partida acontecendo agora.') +
      sec('Terminadas', f(AG.recentes).slice(0, 15), 'Nenhuma partida recente.') +
      sec('Próximas', f(AG.proximas).slice(0, 12), 'Nenhuma partida marcada.');
  }
  $('proList').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openMatch(b.dataset.id); };

  // ============ Partida ============
  async function openMatch(id, keepGame = false) {
    const changed = id !== SEL;
    SEL = id; store.set('dl-pro-sel', id);
    if (changed) { MATCH = null; GAME = null; $('proMain').innerHTML = '<div class="idle small"><p>Carregando a série…</p></div>'; }
    renderList();
    try {
      const m = await api('/api/pro/partida/' + encodeURIComponent(id));
      if (SEL !== id) return;
      MATCH = m;
      const playable = m.games.filter((g) => g.picks);
      const live = m.games.find((g) => g.state === 'ao-vivo');
      if (!keepGame || !GAME || !m.games.some((g) => g.number === GAME)) GAME = (live || playable[playable.length - 1] || m.games[0])?.number ?? null;
      renderMatch();
    } catch (err) {
      if (SEL !== id) return;
      $('proMain').innerHTML = `<div class="idle small"><p class="err">${esc(err.message)}</p></div>`;
    }
    schedule();
  }

  // Atualiza sozinho: a série aberta a cada 20 s quando está ao vivo; a lista a cada minuto.
  function schedule() {
    clearTimeout(timer);
    if (!visible()) return;
    const live = MATCH?.state === 'ao-vivo' || MATCH?.games?.some((g) => g.state === 'ao-vivo');
    timer = setTimeout(async () => {
      if (!visible()) return;
      if (live && SEL) await openMatch(SEL, true);
      else { await loadAgenda(); schedule(); }
    }, live ? 20000 : 60000);
  }

  const teamOf = (id) => MATCH.teams.find((t) => t.id === id) || null;
  // Campeões já usados antes do jogo n (Fearless: travados para os dois times).
  function usedBefore(n) {
    const out = new Map(); // id do campeão -> { team, game }
    for (const g of MATCH.games) {
      if (g.number >= n || !g.picks) continue;
      for (const side of ['blue', 'red']) for (const p of g.picks[side]) if (p.champion && !out.has(p.champion)) out.set(p.champion, { team: teamOf(g.sides[side]), game: g.number });
    }
    return out;
  }
  function nextNumber() {
    const done = MATCH.games.filter((g) => g.picks).map((g) => g.number);
    return (done.length ? Math.max(...done) : 0) + 1;
  }

  function renderMatch() {
    const m = MATCH;
    const [a, b] = m.teams;
    const over = m.state === 'terminada';
    const head = `
      <header class="series">
        <div class="series-league">${logo(m.leagueLogo, 'llogo')}<span>${esc(m.league)}</span><small>Melhor de ${m.bestOf} · Fearless</small>${m.state === 'ao-vivo' ? '<span class="livebadge">AO VIVO</span>' : ''}</div>
        <div class="series-score">
          <div class="steam${a?.outcome === 'win' ? ' won' : ''}">${logo(a?.logo, 'tlogo big')}<b>${esc(a?.name || '?')}</b></div>
          <div class="sscore num">${a?.wins ?? 0}<span>–</span>${b?.wins ?? 0}</div>
          <div class="steam right${b?.outcome === 'win' ? ' won' : ''}">${logo(b?.logo, 'tlogo big')}<b>${esc(b?.name || '?')}</b></div>
        </div>
      </header>`;
    const tabs = m.games.length ? `<nav class="gtabs" aria-label="Jogos da série">${m.games.map((g) => `<button class="gtab ${g.state}" data-g="${g.number}" aria-pressed="${g.number === GAME}">Jogo ${g.number}${g.state === 'ao-vivo' ? ' <i class="livedot"></i>' : ''}</button>`).join('')}</nav>` : '';
    const g = m.games.find((x) => x.number === GAME);
    $('proMain').innerHTML = head + fearlessHTML(over) + tabs + (g ? gameHTML(g) : '<div class="idle small"><p>A série ainda não começou.</p></div>') + poolHTML(over);
    bindPool();
  }

  // Campeões travados para o próximo jogo, separados por quem usou.
  function fearlessHTML(over) {
    const n = nextNumber();
    const used = usedBefore(n);
    if (!used.size) return `<section class="card fear"><h2>Travados pelo Fearless</h2><p class="note">Nenhum campeão travado ainda: os campeões de cada jogo entram aqui quando o jogo começa.</p></section>`;
    const C = byId();
    const groups = MATCH.teams.map((t) => [t, [...used].filter(([, u]) => u.team?.id === t.id)]);
    const icon = ([id, u]) => { const c = C[id]; return `<span class="fchamp" title="${esc(c?.name || id)} · jogo ${u.game}">${c ? `<img src="${c.icon}" alt="" loading="lazy">` : ''}<small>${esc(c?.name || id)}</small></span>`; };
    return `<section class="card fear">
      <h2>${over ? 'Campeões usados na série' : `Travados para o jogo ${n}`}<span class="count">${used.size}</span></h2>
      <p class="note">${over ? 'No Fearless, cada campeão só pode ser escolhido uma vez na série inteira.' : 'Nenhum dos dois times pode escolher estes campeões até o fim da série.'}</p>
      ${groups.map(([t, list]) => `<div class="fgroup"><h3>${logo(t.logo)}${esc(t.name)} <small>${list.length}</small></h3><div class="frow">${list.map(icon).join('')}</div></div>`).join('')}
    </section>`;
  }

  // Leitura de um confronto de rota, do ponto de vista do lado azul.
  function laneRead(role, a, b) {
    const { lane } = DL.stats;
    const rel = DL.REL;
    const m = lane?.[a]?.[b];
    if (m && m.g >= 30) { const wr = Math.round((m.w / m.g) * 1000) / 10; return { v: (wr - 50) / 2, txt: `${String(wr).replace('.', ',')}% na soloQ em ${m.g} jogos` }; }
    if (rel.beats(a, b)) return { v: 2, txt: `${a} é historicamente forte contra ${b}` };
    if (rel.beats(b, a)) return { v: -2, txt: `${a} é historicamente fraco contra ${b}` };
    const f = { T: E.topVs, J: E.jgVs, M: E.midVs, A: E.adcVs, S: E.supVs }[role];
    const r = f ? f(rel, a, b) : null;
    if (r && r.mine && r.theirs) return { v: r.v, txt: `${r.mine} contra ${r.theirs}${r.tag ? ' (exceção)' : ''}` };
    return { v: 0, txt: '' };
  }

  function gameHTML(g) {
    if (!g.picks) {
      const why = g.state === 'desnecessario' ? 'Este jogo não foi necessário: a série acabou antes.' : 'Os campeões aparecem quando o jogo começa. A API do lolesports não mostra a seleção de campeões nem os bans.';
      return `<section class="card game"><p class="note">${why}</p></section>`;
    }
    const C = byId();
    const blue = teamOf(g.sides.blue), red = teamOf(g.sides.red);
    const pick = (side, r) => g.picks[side].find((p) => p.role === r) || null;
    const nameOf = (p) => C[p?.champion]?.name || p?.champion || null;
    const rows = ROLES.map((r) => {
      const pb = pick('blue', r), pr = pick('red', r);
      const nb = nameOf(pb), nr = nameOf(pr);
      const read = nb && nr ? laneRead(r, nb, nr) : { v: 0, txt: '' };
      const tone = read.v >= 1.5 ? 'blue' : read.v <= -1.5 ? 'red' : 'even';
      const cell = (p, n, right) => {
        const c = C[p?.champion];
        return `<div class="gcell${right ? ' right' : ''}">${c ? `<img src="${c.icon}" alt="" loading="lazy">` : '<span class="noimg"></span>'}<span><b>${esc(n || '?')}</b><small>${esc(p?.player || '')}</small></span></div>`;
      };
      return `<div class="g-lane">${cell(pb, nb, false)}<div class="gmid ${tone}" title="${esc(read.txt)}"><small>${ROLE_PT[r]}</small><span>${tone === 'blue' ? '◀ vantagem' : tone === 'red' ? 'vantagem ▶' : 'equilibrado'}</span></div>${cell(pr, nr, true)}</div>`;
    }).join('');
    const placar = g.placar?.blue && g.placar?.red ? placarHTML(g.placar, blue, red) : '';

    // Nota do draft e composição (mesmas regras do draft ao vivo)
    const BN = byNameMap();
    const side = (s) => g.picks[s].map((p) => ({ name: nameOf(p), role: p.role })).filter((p) => p.name && BN[p.name]);
    const { stats, lane, duo } = DL.stats;
    const sb = E.draftScore({ mine: side('blue'), enemy: side('red'), byName: BN, rel: DL.REL, stats, lane, duo });
    const sr = E.draftScore({ mine: side('red'), enemy: side('blue'), byName: BN, rel: DL.REL, stats, lane, duo });
    const tag = (t, fb) => esc(t?.code || fb);
    const parts = sb.parts.slice(0, 7).map((x) => `<li class="${x.value > 0 ? 'up' : 'down'}"><b class="num">${x.value > 0 ? '+' : ''}${n1(x.value)}</b> ${esc(x.text.replace(/^Seu time:/, `${tag(blue, 'Azul')}:`).replace(/^Time inimigo:/, `${tag(red, 'Vermelho')}:`))}</li>`).join('');
    const A = E.analyze(side('blue').map((p) => BN[p.name])), O = E.analyze(side('red').map((p) => BN[p.name]));
    return `<section class="card game">
      <div class="gsides"><span class="gs blue">${logo(blue?.logo)}${esc(blue?.name || 'Azul')}<small>lado azul</small></span><span class="gs red"><small>lado vermelho</small>${esc(red?.name || 'Vermelho')}${logo(red?.logo)}</span></div>
      ${placar}
      <div class="grid5">${rows}</div>
    </section>
    <section class="card gscore">
      <h2>Nota do draft</h2>
      <div class="notes2"><div class="nota blue"><small>${esc(blue?.name || 'Azul')}</small><b class="num">${n1(sb.score)}</b></div><div class="nota red"><small>${esc(red?.name || 'Vermelho')}</small><b class="num">${n1(sr.score)}</b></div></div>
      ${parts ? `<ul class="whys">${parts}</ul><p class="note">Pontos do ponto de vista do lado azul. Sem estatísticas de soloQ coletadas, a nota usa só as fichas e as classes de cada rota.</p>` : '<p class="note">Draft equilibrado pelas fichas: nenhum confronto ou composição se destacou.</p>'}
    </section>
    <section class="comps pro-comp" aria-label="Composição dos times"><div class="compcard bside">${DL.compHTML(A, O, true, 'B', `${esc(blue?.name || 'Azul')}<span>lado azul</span>`)}</div><div class="compcard rside">${DL.compHTML(O, A, false, 'R', `${esc(red?.name || 'Vermelho')}<span>lado vermelho</span>`)}</div></section>`;
  }

  function placarHTML(p, blue, red) {
    const d = p.blue.gold - p.red.gold;
    const lead = Math.abs(d) < 300 ? 'Ouro equilibrado' : `${esc((d > 0 ? blue : red)?.code || (d > 0 ? 'Azul' : 'Vermelho'))} +${kGold(Math.abs(d))}`;
    const stat = (label, x, y) => `<div class="ps"><b class="num">${x}</b><small>${label}</small><b class="num">${y}</b></div>`;
    return `<div class="placar">
      <div class="pgold"><span class="num">${kGold(p.blue.gold)}</span><span class="lead ${d > 300 ? 'blue' : d < -300 ? 'red' : ''}">${lead}</span><span class="num">${kGold(p.red.gold)}</span></div>
      <div class="pstats">${stat('Abates', p.blue.kills, p.red.kills)}${stat('Torres', p.blue.towers, p.red.towers)}${stat('Dragões', p.blue.dragons, p.red.dragons)}${stat('Barões', p.blue.barons, p.red.barons)}</div>
      ${p.estado === 'paused' ? '<p class="note">Jogo pausado.</p>' : ''}
    </div>`;
  }

  // Tier list de prioridade no competitivo (presença em picks e bans na temporada, pelo gol.gg).
  // Série em andamento: só os campeões ainda livres para o próximo jogo. Série terminada: todos,
  // com os usados na série apagados.
  let PRIO = null, PRIO_ERR = null, PRIO_LOADING = null;
  const TIER_INFO = { S: '40% ou mais', A: '25% a 40%', B: '12% a 25%', C: '4% a 12%', D: 'menos de 4% ou fora do competitivo' };
  function loadPrio(fresh = false) {
    if (PRIO_LOADING) return PRIO_LOADING;
    PRIO_LOADING = api('/api/pro/prioridade' + (fresh ? '?atualizar=1' : ''))
      .then((r) => { PRIO = r; PRIO_ERR = null; })
      .catch((err) => { PRIO_ERR = err.message; })
      .finally(() => { PRIO_LOADING = null; if (visible() && MATCH) renderPool(); });
    return PRIO_LOADING;
  }
  function poolHTML(over) {
    const n = nextNumber();
    const used = usedBefore(over ? 99 : n);
    const title = over ? 'Prioridade dos campeões no competitivo' : `Campeões livres no jogo ${n}, por prioridade`;
    return `<section class="card pool">
      <h2>${title}<span class="count">${over ? DL.CHAMPS.length : DL.CHAMPS.length - used.size}</span></h2>
      <p class="note" id="poolNote"></p>
      <div class="pool-tools"><input id="poolQ" type="search" placeholder="Filtrar campeões" aria-label="Filtrar campeões" value="${esc(POOL_Q)}">
      <div class="chips" id="poolRoles">${[['', 'Todas'], ...ROLES.map((r) => [r, ROLE_PT[r]])].map(([r, t]) => `<button class="chip" data-r="${r}" aria-pressed="${r === POOL_ROLE}">${t}</button>`).join('')}</div></div>
      <div class="tiers" id="poolGrid"></div>
    </section>`;
  }
  function renderPool() {
    const grid = $('poolGrid');
    if (!grid) return;
    const over = MATCH?.state === 'terminada';
    const used = usedBefore(over ? 99 : nextNumber());
    const note = $('poolNote');
    if (!PRIO && !PRIO_ERR) { note.textContent = 'Carregando a prioridade do competitivo…'; loadPrio(); }
    else if (PRIO) {
      const quando = new Date(PRIO.atualizado).toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      note.innerHTML = `Do melhor para o pior pela <b>presença</b> (em quantos jogos o campeão foi escolhido ou banido) na temporada ${esc(String(2010 + Number(String(PRIO.temporada).slice(1))))} do competitivo, pelo gol.gg${PRIO.jogos ? `: ${fmt(PRIO.jogos)} jogos` : ''}. Lido ${quando}${PRIO.antigo ? ' (sem conexão: última leitura salva)' : ''}. <button class="linkbtn" type="button" id="prioRefresh">Atualizar</button>`;
    } else note.innerHTML = `<span class="err">${esc(PRIO_ERR)}</span> Os campeões aparecem em ordem alfabética. <button class="linkbtn" type="button" id="prioRefresh">Tentar de novo</button>`;
    const q = POOL_Q.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
    const P = PRIO?.campeoes || {};
    const list = DL.CHAMPS
      .filter((c) => (over || !used.has(c.id)) && (!POOL_ROLE || (c.roles || '').includes(POOL_ROLE)) && (!q || c.name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '').includes(q)))
      .sort((x, y) => (P[y.name]?.pr ?? -1) - (P[x.name]?.pr ?? -1) || x.name.localeCompare(y.name, 'pt-BR'));
    if (!list.length) { grid.innerHTML = '<p class="note">Nenhum campeão livre com esse filtro.</p>'; return; }
    const tile = (c) => {
      const p = P[c.name], u = over && used.get(c.id);
      return `<span class="pc${u ? ' locked' : ''}" title="${esc(c.name)}${p ? ` · presença ${String(p.pr).replace('.', ',')}%${p.wr != null ? `, ${String(p.wr).replace('.', ',')}% de vitória` : ''}` : ' · fora do competitivo'}${u ? ` · usado no jogo ${u.game}` : ''}"><img src="${c.icon}" alt="" loading="lazy"><small>${esc(c.name)}</small>${p?.pr ? `<em>${p.pr >= 10 ? Math.round(p.pr) : String(Math.floor(p.pr * 10) / 10).replace('.', ',')}%</em>` : ''}</span>`;
    };
    if (!PRIO) { grid.innerHTML = `<div class="tier"><div class="tc">${list.map(tile).join('')}</div></div>`; return; }
    grid.innerHTML = ['S', 'A', 'B', 'C', 'D'].map((t) => {
      const champs = list.filter((c) => (P[c.name]?.tier || 'D') === t);
      return champs.length ? `<div class="tier t-${t}"><span class="tl" title="Presença ${TIER_INFO[t]}">${t}<small>${TIER_INFO[t].replace(' ou fora do competitivo', '')}</small></span><div class="tc">${champs.map(tile).join('')}</div></div>` : '';
    }).join('');
  }
  $('proMain').addEventListener('click', (e) => { if (e.target.id === 'prioRefresh') { PRIO_ERR = null; loadPrio(true); renderPool(); } });
  function bindPool() {
    renderPool();
    const q = $('poolQ'), roles = $('poolRoles');
    if (q) q.oninput = () => { POOL_Q = q.value; renderPool(); };
    if (roles) roles.onclick = (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      POOL_ROLE = b.dataset.r;
      for (const x of roles.querySelectorAll('[data-r]')) x.setAttribute('aria-pressed', String(x.dataset.r === POOL_ROLE));
      renderPool();
    };
  }
  $('proMain').addEventListener('click', (e) => {
    const t = e.target.closest('.gtab[data-g]');
    if (!t) return;
    GAME = Number(t.dataset.g);
    renderMatch();
  });

  document.addEventListener('dl:view', (e) => {
    if (e.detail !== 'pro') { clearTimeout(timer); return; }
    const had = SEL;
    loadAgenda().then(() => { if (had) openMatch(had, true); else schedule(); });
  });
  document.addEventListener('dl:stats', () => { if (visible() && MATCH) renderMatch(); });
})();
