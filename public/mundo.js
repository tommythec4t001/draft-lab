// Draft Lab — Campeões, Leaderboard e busca de jogadores
// Usa o que app.js expõe em window.DL (lista de campeões, estatísticas de soloQ, troca de tela).
(() => {
  const $ = (id) => document.getElementById(id);
  const DL = window.DL;
  const E = window.DraftEngine;
  const { api, esc, fmt } = DL;
  const ROLE_PT = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
  const CLASSE_ROTA = [['top', 'T'], ['jg', 'J'], ['mid', 'M'], ['adc', 'A'], ['sup', 'S']];
  const TAG_PT = { Fighter: 'Lutador', Tank: 'Tanque', Mage: 'Mago', Assassin: 'Assassino', Marksman: 'Atirador', Support: 'Suporte' };
  const pct = (x) => (x == null ? '–' : `${String(x).replace('.', ',')}%`);
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const quando = (t) => {
    const d = (Date.now() - t) / 1000;
    if (d < 3600) return `há ${Math.max(1, Math.round(d / 60))} min`;
    if (d < 86400) return `há ${Math.round(d / 3600)} h`;
    if (d < 86400 * 7) return `há ${Math.round(d / 86400)} dia${Math.round(d / 86400) > 1 ? 's' : ''}`;
    return new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  };
  const byName = (n) => DL.CHAMPS.find((c) => c.name === n);
  const byKey = (k) => DL.CHAMPS.find((c) => String(c.key) === String(k));
  const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } } };

  // ============ Campeões ============
  let cRole = '';
  $('cRoles').innerHTML = [['', 'Todas'], ...E.ROLES.map((r) => [r, ROLE_PT[r]])].map(([r, t]) => `<button class="chip" data-r="${r}" aria-pressed="${r === cRole}">${t}</button>`).join('');
  $('cRoles').onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    cRole = b.dataset.r;
    for (const x of $('cRoles').children) x.setAttribute('aria-pressed', String(x.dataset.r === cRole));
    renderGrid();
  };
  $('cFilter').oninput = () => renderGrid();
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function renderGrid() {
    const q = norm($('cFilter').value || '');
    const list = DL.CHAMPS.filter((c) => (!q || norm(c.name).includes(q)) && (!cRole || (c.roles || '').includes(cRole)));
    $('cGrid').innerHTML = list.length
      ? list.map((c) => `<button class="ccard" data-id="${esc(c.id)}"><img src="${c.icon}" alt="" loading="lazy"><span>${esc(c.name)}</span></button>`).join('')
      : '<p class="note">Nenhum campeão encontrado.</p>';
  }
  $('cGrid').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) openChamp(b.dataset.id); };
  $('cBack').onclick = () => DL.showView('champs');

  function statRows(name) {
    const st = DL.stats.stats?.[name];
    if (!st) return '<p class="note">Ainda sem estatísticas de soloQ deste campeão. Elas aparecem conforme a coleta avança (Configurações).</p>';
    const roles = Object.entries(st.roles || {}).sort((a, b) => b[1].g - a[1].g);
    return `<div class="kpis">
        <div><b>${pct(st.wr)}</b><small>vitórias</small></div>
        <div><b>${pct(st.pick)}</b><small>escolha</small></div>
        <div><b>${pct(st.ban)}</b><small>banimento</small></div>
        <div><b>${fmt(st.g)}</b><small>partidas</small></div>
      </div>
      ${roles.length ? `<table class="tbl"><thead><tr><th>Rota</th><th>Partidas</th><th>Vitórias</th><th>Dos jogos</th></tr></thead><tbody>${roles.map(([r, x]) => `<tr><td>${ROLE_PT[r] || r}</td><td>${fmt(x.g)}</td><td>${pct(x.wr)}</td><td>${x.share}%</td></tr>`).join('')}</tbody></table>` : ''}`;
  }
  // Confrontos e duplas com jogos suficientes (mesma regra das sugestões)
  function pairs(table, name, min) {
    const row = table?.[name];
    if (!row) return [];
    return Object.entries(row).filter(([, x]) => x.g >= min).map(([n, x]) => ({ n, g: x.g, wr: Math.round((x.w / x.g) * 1000) / 10 }));
  }
  function pairList(list, empty) {
    if (!list.length) return `<p class="note">${empty}</p>`;
    return `<ul class="plist">${list.map((x) => { const c = byName(x.n); return `<li><button class="plink" data-id="${esc(c?.id || '')}">${c ? `<img src="${c.icon}" alt="" loading="lazy">` : ''}<span>${esc(x.n)}</span></button><b class="${x.wr >= 50 ? 'up' : 'down'}">${pct(x.wr)}</b><small>${fmt(x.g)} jogos</small></li>`; }).join('')}</ul>`;
  }

  async function openChamp(id) {
    const c = DL.CHAMPS.find((x) => x.id === id);
    if (!c) return;
    DL.showView('champ');
    const min = E.RULES?.MIN_PAIR || 30;
    const duo = pairs(DL.stats.duo, c.name, min);
    const duos = [...duo].sort((a, b) => b.wr - a.wr).slice(0, 5);
    const classes = CLASSE_ROTA.filter(([k]) => c[k]).map(([k, r]) => `<span class="pill"><small>${ROLE_PT[r]}</small>${esc(c[k])}</span>`).join('');
    $('cDetail').innerHTML = `
      <section class="chero" style="--bg:url('/img/centered/${esc(c.id)}')">
        <img class="chero-icon" src="${c.icon}" alt="">
        <div>
          <h1>${esc(c.name)}</h1>
          <p class="chero-title">${esc(c.title || '')}</p>
          <p class="chero-meta">${(c.roles || '').split('').map((r) => ROLE_PT[r]).filter(Boolean).join(' · ')}${c.tags?.length ? ` &nbsp;|&nbsp; ${c.tags.map((t) => TAG_PT[t] || t).join(', ')}` : ''}${c.info?.difficulty != null ? ` &nbsp;|&nbsp; Dificuldade ${c.info.difficulty}/10` : ''}</p>
          ${classes ? `<div class="pills">${classes}</div>` : ''}
        </div>
      </section>
      <div class="cbuild" id="cBuild"></div>
      <div class="cgrid2">
        <section class="card"><h2>SoloQ</h2>${statRows(c.name)}</section>
        <section class="card"><h2>Melhores duplas</h2>${pairList(duos, 'Sem duplas com jogos suficientes ainda.')}</section>
      </div>
      <section class="card" id="cAbil"><h2>Habilidades</h2><p class="note">Carregando…</p></section>`;
    if (window.DLBuild) window.DLBuild.render($('cBuild'), c.id);
    try {
      const d = await api('/api/campeao/' + encodeURIComponent(c.id));
      const ab = (img, kind, tecla, nome, desc, extra = '') => `<div class="abil"><img src="/img/${kind}/${esc(img)}" alt="" loading="lazy"><div><h3><span class="key">${tecla}</span>${esc(nome || '')}</h3>${extra}<p>${esc(desc || '')}</p></div></div>`;
      const extra = (s) => [s.recarga && `Recarga ${esc(s.recarga)} s`, s.custo && s.custo !== '0' && `Custo ${esc(s.custo)}`, s.alcance && !/^\d{5,}/.test(s.alcance) && `Alcance ${esc(s.alcance)}`].filter(Boolean).join(' · ');
      $('cAbil').innerHTML = `<h2>Habilidades</h2>
        ${ab(d.passiva.img, 'passiva', 'P', d.passiva.nome, d.passiva.desc)}
        ${d.habilidades.map((s) => ab(s.img, 'habilidade', s.tecla, s.nome, s.desc, extra(s) ? `<small class="lbl">${extra(s)}</small>` : '')).join('')}
        ${d.dicasAliado?.length ? `<h2>Dicas jogando com ${esc(c.name)}</h2><ul class="tips">${d.dicasAliado.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${d.dicasInimigo?.length ? `<h2>Dicas jogando contra</h2><ul class="tips">${d.dicasInimigo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${d.historia ? `<details class="lore"><summary>História</summary><p>${esc(d.historia)}</p></details>` : ''}`;
    } catch (err) { $('cAbil').innerHTML = `<h2>Habilidades</h2><p class="note err">${esc(err.message)}</p>`; }
  }
  $('cDetail').onclick = (e) => { const b = e.target.closest('.plink[data-id]'); if (b?.dataset.id) openChamp(b.dataset.id); };

  // ============ Leaderboard ============
  let MUNDO = null, lbReg = store.get('dl-lb-reg', 'br1'), lbFila = store.get('dl-lb-fila', 'RANKED_SOLO_5x5'), lbPag = 1, lbLoaded = '';
  const TIER_CLS = { CHALLENGER: 'chall', GRANDMASTER: 'gm', MASTER: 'master' };
  function segs() {
    $('lbReg').innerHTML = MUNDO.leaderboard.map((r) => `<button class="chip" data-v="${r}" aria-pressed="${r === lbReg}">${esc(MUNDO.regioes[r])}</button>`).join('');
    $('lbFila').innerHTML = Object.entries(MUNDO.filas).map(([k, t]) => `<button class="chip" data-v="${k}" aria-pressed="${k === lbFila}">${esc(t)}</button>`).join('');
  }
  $('lbReg').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; lbReg = b.dataset.v; store.set('dl-lb-reg', lbReg); lbPag = 1; segs(); loadLb(); };
  $('lbFila').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; lbFila = b.dataset.v; store.set('dl-lb-fila', lbFila); lbPag = 1; segs(); loadLb(); };
  async function loadLb() {
    const key = `${lbReg}|${lbFila}|${lbPag}`;
    lbLoaded = key;
    $('lbMsg').className = 'note'; $('lbMsg').textContent = 'Carregando o ranking…';
    try {
      const r = await api(`/api/leaderboard?regiao=${lbReg}&fila=${lbFila}&pagina=${lbPag}`);
      if (lbLoaded !== key) return;
      $('lbMsg').textContent = `${fmt(r.total)} jogadores entre Mestre e Desafiante · atualizado ${quando(r.atualizado)}`;
      $('lbList').innerHTML = `<table class="tbl lbt"><thead><tr><th>#</th><th>Jogador</th><th>Elo</th><th>PdL</th><th>V / D</th><th>Vitórias</th></tr></thead><tbody>${
        r.entradas.map((e) => `<tr><td class="num">${e.pos}</td><td>${e.nome ? `<button class="plink" data-q="${esc(e.nome + '#' + e.tag)}" data-r="${r.regiao}">${esc(e.nome)}<small>#${esc(e.tag)}</small></button>` : '<span class="note">nome indisponível</span>'}</td><td><span class="tier ${TIER_CLS[e.tier] || ''}">${esc(e.elo)}</span></td><td class="num">${fmt(e.lp)}</td><td class="num">${e.w} / ${e.l}</td><td class="num ${e.wr >= 50 ? 'up' : 'down'}">${pct(e.wr)}</td></tr>`).join('')
      }</tbody></table>`;
      $('lbPager').innerHTML = r.paginas > 1 ? `<button class="btn" data-p="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}>Anterior</button><span class="note">Página ${r.pagina} de ${r.paginas}</span><button class="btn" data-p="${r.pagina + 1}" ${r.pagina >= r.paginas ? 'disabled' : ''}>Próxima</button>` : '';
    } catch (err) {
      if (lbLoaded !== key) return;
      $('lbMsg').className = 'note err'; $('lbMsg').textContent = err.message; $('lbList').innerHTML = ''; $('lbPager').innerHTML = '';
    }
  }
  $('lbPager').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b || b.disabled) return; lbPag = Number(b.dataset.p); loadLb(); };
  $('lbList').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) search(b.dataset.q, b.dataset.r); };

  // ============ Busca de jogadores ============
  // Só jogadores (Riot ID), no mundo todo. Sem campeões na busca.
  let searchSeq = 0;
  $('searchForm').onsubmit = (e) => { e.preventDefault(); search($('searchQ').value, $('searchReg').value); };
  function rememberSearch(q, reg) {
    const list = store.get('dl-buscas', []).filter((x) => x.q.toLowerCase() !== q.toLowerCase());
    list.unshift({ q, reg });
    store.set('dl-buscas', list.slice(0, 8));
  }
  async function search(q, reg) {
    q = String(q || '').trim();
    if (!q) return;
    const seq = ++searchSeq;
    $('searchQ').value = q;
    if (reg) $('searchReg').value = reg;
    DL.showView('player');
    $('pfBody').innerHTML = `<div class="idle small"><p>Procurando <b>${esc(q)}</b>…</p></div>`;
    try {
      const r = await api(`/api/busca?q=${encodeURIComponent(q)}&regiao=${encodeURIComponent($('searchReg').value)}`);
      if (seq !== searchSeq) return;
      rememberSearch(`${r.jogador.nome}#${r.jogador.tag}`, r.jogador.regiao);
      renderProfile(r);
    } catch (err) {
      if (seq !== searchSeq) return;
      $('pfBody').innerHTML = `<div class="idle small"><p class="err">${esc(err.message)}</p></div>`;
    }
  }
  function eloCard(e) {
    if (!e) return '';
    return `<div class="elo ${TIER_CLS[e.tier] || ''}"><small>${esc(e.fila)}</small><b>${esc(e.elo)} ${esc(e.divisao || '')}</b><span>${fmt(e.lp)} PdL</span><span class="note">${e.w}V ${e.l}D · ${pct(e.wr)}</span></div>`;
  }
  function renderProfile(r) {
    const j = r.jogador;
    const solo = r.elos.find((e) => e.fila === 'Solo/Duo'), flex = r.elos.find((e) => e.fila === 'Flex');
    const sem = (fila) => `<div class="elo none"><small>${fila}</small><b>Sem elo</b><span class="note">sem partidas ranqueadas nesta temporada</span></div>`;
    $('pfBody').innerHTML = `
      <section class="pfhead">
        ${j.icone != null ? `<img class="pficon" src="/img/profile/${j.icone}" alt="">` : ''}
        <div><h1>${esc(j.nome)}<small>#${esc(j.tag)}</small></h1><p class="note">${esc(j.regiaoNome)}${j.nivel ? ` · nível ${j.nivel}` : ''}</p></div>
      </section>
      <div class="elos">${solo ? eloCard(solo) : sem('Solo/Duo')}${flex ? eloCard(flex) : sem('Flex')}</div>
      ${r.campeoes.length ? `<section class="card"><h2>Mais jogados nas partidas recentes</h2><ul class="plist">${r.campeoes.map((x) => { const c = byName(x.campeao) || DL.CHAMPS.find((y) => y.id === x.campeao); const kda = x.d ? ((x.k + x.a) / x.d).toFixed(1).replace('.', ',') : 'Perfeito'; return `<li><button class="plink" data-id="${esc(c?.id || '')}">${c ? `<img src="${c.icon}" alt="">` : ''}<span>${esc(c?.name || x.campeao)}</span></button><b class="${x.vitorias / x.jogos >= 0.5 ? 'up' : 'down'}">${Math.round((x.vitorias / x.jogos) * 100)}%</b><small>${x.jogos} jogos · KDA ${kda}</small></li>`; }).join('')}</ul></section>` : ''}
      <section class="card"><h2>Partidas recentes</h2>${r.partidas.length ? `<div class="pmatches">${r.partidas.map(matchRow).join('')}</div>` : '<p class="note">Nenhuma partida recente.</p>'}</section>`;
  }
  function matchRow(m) {
    const c = byKey(m.campeaoId);
    const res = m.remake ? 'Refeita' : m.vitoria ? 'Vitória' : 'Derrota';
    const cls = m.remake ? 'remake' : m.vitoria ? 'win' : 'loss';
    const kda = m.d ? ((m.k + m.a) / m.d).toFixed(2).replace('.', ',') : 'Perfeito';
    const itens = m.itens.map((i) => (i ? `<img src="/img/item/${i}" alt="" loading="lazy">` : '<i></i>')).join('');
    return `<div class="pm ${cls}">
      <span class="pm-res"><b>${res}</b><small>${esc(m.fila)}</small><small>${mmss(m.duracao)} · ${quando(m.inicio)}</small></span>
      ${c ? `<img class="pm-champ" src="${c.icon}" alt="${esc(c.name)}" title="${esc(c.name)}">` : `<span class="pm-champ"></span>`}
      <span class="pm-kda"><b>${m.k} / ${m.d} / ${m.a}</b><small>KDA ${kda}</small></span>
      <span class="pm-cs"><b>${m.cs} CS</b><small>${m.rota || '&nbsp;'}</small></span>
      <span class="pm-items">${itens}</span>
    </div>`;
  }
  $('pfBody').onclick = (e) => { const b = e.target.closest('.plink[data-id]'); if (b?.dataset.id) openChamp(b.dataset.id); };

  // ============ Inicialização ============
  async function init() {
    try { MUNDO = await api('/api/mundo'); } catch { MUNDO = { regioes: { br1: 'Brasil' }, leaderboard: ['br1'], filas: { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex' }, padrao: 'br1' }; }
    if (!MUNDO.leaderboard.includes(lbReg)) lbReg = MUNDO.leaderboard[0];
    if (!MUNDO.filas[lbFila]) lbFila = 'RANKED_SOLO_5x5';
    $('searchReg').innerHTML = Object.entries(MUNDO.regioes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('searchReg').value = store.get('dl-busca-reg', MUNDO.padrao || 'br1');
    $('searchReg').onchange = () => store.set('dl-busca-reg', $('searchReg').value);
    segs();
    if (!$('view-lb').hidden) loadLb();
    if (!$('view-champs').hidden) renderGrid();
  }
  const ready = init();
  document.addEventListener('dl:view', async (e) => {
    await ready;
    if (e.detail === 'champs') renderGrid();
    if (e.detail === 'lb' && !lbLoaded) loadLb();
  });
  // A lista de campeões chega depois: redesenha a grade se ela estiver na tela
  document.addEventListener('dl:stats', () => { if (!$('view-champs').hidden) renderGrid(); });
  window.DLMundo = { search, openChamp };
})();
