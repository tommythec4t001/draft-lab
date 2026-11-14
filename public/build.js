// Draft Lab — Build, confrontos e partidas de alto elo de um campeão (página do campeão e champ select)
(() => {
  const $ = (id) => document.getElementById(id);
  const DL = window.DL;
  const { api, esc, fmt } = DL;
  const ROLE_PT = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
  const pct = (x) => (x == null ? '–' : `${String(x).replace('.', ',')}%`);
  const sinal = (x) => `${x > 0 ? '+' : ''}${String(x).replace('.', ',')}%`;
  const byKey = (k) => DL.CHAMPS.find((c) => String(c.key) === String(k));
  const PLAT = { BR1: 'BR', NA1: 'NA', EUW1: 'EUW', EUN1: 'EUNE', KR: 'KR', LA1: 'LAN', LA2: 'LAS', JP1: 'JP', OC1: 'OCE', TR1: 'TR', RU: 'RU', ME1: 'ME', SG2: 'SEA', TW2: 'TW', VN2: 'VN' };
  const TIER = { DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
  const quando = (t) => {
    const d = (Date.now() - t) / 1000;
    if (d < 3600) return `há ${Math.max(1, Math.round(d / 60))} min`;
    if (d < 86400) return `há ${Math.round(d / 3600)} h`;
    return `há ${Math.round(d / 86400)} d`;
  };

  let B = null;          // resposta de /api/build
  let VS = null;         // filtro do histórico por adversário
  let FULL = false;      // lista completa de confrontos
  let SHOW = 10;         // partidas visíveis no histórico
  let XCAT = 'L', XSLOT = 'all', XSORT = 'wpa', XALL = false; // explorador de itens
  let RPRI = null, RSUB = null;                                // explorador de runas
  let host = null;

  // Nomes de itens, runas e feitiços da resposta que está sendo desenhada (página do campeão ou prévia)
  let N = { itens: {}, runas: {}, feiticos: {} };
  const item = (id, cls = 'bi') => (id ? `<img class="${cls}" src="/img/item/${id}" alt="" title="${esc(N.itens[id]?.n || '')}" loading="lazy" data-fail="${cls} none">` : `<span class="${cls} none"></span>`);
  const spell = (id, cls = 'bs') => (id ? `<img class="${cls}" src="/img/spell/${id}" alt="" title="${esc(N.feiticos[id] || '')}" loading="lazy" data-fail="${cls} none">` : '');
  const rune = (id, cls = 'br', on = true) => `<img class="${cls}${on ? ' on' : ''}" src="/img/rune/${id}" alt="" title="${esc(N.runas[id] || '')}" loading="lazy" data-fail="${cls}${on ? ' on' : ''} none">`;
  const wpaTxt = (w) => `${w > 0 ? '+' : ''}${w.toFixed(2).replace('.', ',')}`;
  const wpaTag = (w) => `<b class="wpa ${w >= 0 ? 'up' : 'down'}" title="WPA: quanto a escolha soma à chance de vitória, em pontos percentuais">${wpaTxt(w)}</b>`;
  const share = (x) => {
    if (!x) return '';
    const w = Array.isArray(x.wpa) ? x.wpa.map(wpaTag).join(' ') : x.wpa != null ? wpaTag(x.wpa) : '';
    const s = x.share != null ? `${x.share}% · ${pct(x.wr)}` : x.g ? `${fmt(x.g)} escolhas` : '';
    return `<small class="sh">${w ? `WPA ${w}${s ? ' · ' : ''}` : ''}${s}</small>`;
  };

  // Redesenha só um quadro, sem pular a página
  function redraw(sel) {
    const old = host.querySelector(sel);
    if (!old) return draw();
    N = B.nomes;
    const html = sel === '.xp' ? itemsExplorerHTML(B.build) : runesExplorerHTML(B.build);
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    old.replaceWith(tmp.firstElementChild);
  }

  async function render(el, champId, role = null) {
    host = el;
    VS = null; FULL = false; SHOW = 10; XALL = false; RPRI = null; RSUB = null;
    el.innerHTML = '<section class="card"><p class="note">Carregando a build…</p></section>';
    try { B = await api(`/api/build/${encodeURIComponent(champId)}${role ? `?rota=${role}` : ''}`); }
    catch (err) { el.innerHTML = `<section class="card"><p class="note err">${esc(err.message)}</p></section>`; return; }
    draw();
  }

  function draw() {
    N = B.nomes;
    const b = B.build;
    const tabs = B.rotas.length > 1 ? `<div class="chips">${B.rotas.map((r) => `<button class="chip" data-rota="${r.role}" aria-pressed="${r.role === B.rota}">${ROLE_PT[r.role]}<small>${fmt(r.g)}</small></button>`).join('')}</div>` : '';
    if (!b || !b.g) {
      host.innerHTML = `<section class="card build"><h2>Build</h2><p class="note">${B.coleta.partidas ? 'Ainda sem partidas deste campeão na coleta.' : 'As builds, os confrontos e o histórico de alto elo saem das partidas da coleta de soloQ. Ligue a coleta na engrenagem (Estatísticas de soloQ) e eles aparecem conforme as partidas chegam.'}</p></section>`;
      return;
    }
    host.innerHTML = buildHTML(b, tabs) + overviewHTML(b) + itemsExplorerHTML(b) + runesExplorerHTML(b) + matchupsHTML(b) + historyHTML(b);
  }

  function runesHTML(b, t = B.arvore) {
    const r = b.runas;
    if (!r || !t?.pri) return '<p class="note">Sem runas suficientes ainda.</p>';
    const chosen = new Set(r.perks);
    const tree = (style, rows) => `<div class="rtree">${rune(style.id, 'rstyle')}${rows.map((row) => `<div class="rrow">${row.map((id) => rune(id, 'br', chosen.has(id))).join('')}</div>`).join('')}</div>`;
    const shards = t.shards.map((row, i) => `<div class="rrow small">${row.map((id) => rune(id, 'bshard', r.shards[i] === id)).join('')}</div>`).join('');
    return `<div class="runes">${tree(t.pri, t.pri.slots)}${t.sub ? `<div class="rtree">${rune(t.sub.id, 'rstyle')}${t.sub.slots.slice(1).map((row) => `<div class="rrow">${row.map((id) => rune(id, 'br', chosen.has(id))).join('')}</div>`).join('')}<div class="shards">${shards}</div></div>` : ''}</div>${share(r)}`;
  }

  function buildHTML(b, tabs) {
    const sk = b.habilidades;
    const order = sk ? sk.ordem.split('').map((k) => `<span class="skey">${k}</span>`).join('<i>›</i>') : '';
    const path = b.core ? b.core.ids.map((id) => item(id, 'bi big')).join('<i class="arr">›</i>') : (b.itens || []).slice(0, 3).map((x) => item(x.id, 'bi big')).join('<i class="arr">›</i>');
    const opts = (arr) => (arr?.length ? `<div class="opts">${arr.map((x) => `<span>${item(x.id)}<small>${x.wpa != null ? wpaTxt(x.wpa) : x.share + '%'}</small></span>`).join('')}</div>` : '');
    return `<section class="card build">
      <div class="bhead">
        <h2>Build${B.rota ? ` · ${ROLE_PT[B.rota]}` : ''}</h2>
        <span class="note">${fmt(b.g)} partidas ${esc(B.coleta.eloNome)} · ${pct(b.wr)} de vitória · patch ${esc(b.patches.join(' + '))}</span>
        ${tabs}
        <button class="btn primary bimport" type="button" data-import>Importar para o cliente</button>
      </div>
      <p class="note bmsg" role="status"></p>
      <div class="bpages"></div>
      <div class="bgrid">
        <div class="bcol"><h3>Runas</h3>${runesHTML(b)}</div>
        <div class="bcol">
          <h3>Feitiços</h3><div class="row">${(b.feiticos?.ids || []).map((id) => spell(id)).join('')}</div>${share(b.feiticos)}
          <h3>Ordem das habilidades</h3>${sk ? `<div class="skills">${order}</div><small class="sh">Começa ${esc((sk.primeiras || '').split('').join(' › '))} · ${sk.share}%</small>` : '<p class="note">Sem dados ainda.</p>'}
        </div>
        <div class="bcol">
          <h3>Itens iniciais</h3><div class="row">${(b.iniciais?.ids || []).map((id) => item(id)).join('') || '<span class="note">–</span>'}</div>${share(b.iniciais)}
          <h3>Bota</h3><div class="row">${b.bota ? item(b.bota.id) : '<span class="note">–</span>'}</div>${share(b.bota)}
        </div>
        <div class="bcol wide">
          <h3>${b.core ? (b.core.porWpa ? 'Itens principais (melhor WPA em cada posição)' : 'Itens principais (ordem de compra)') : 'Itens mais comuns'}</h3><div class="path">${path}</div>${share(b.core)}
          ${b.quarto?.length ? `<h3>4º item</h3>${opts(b.quarto)}` : ''}
          ${b.quinto?.length ? `<h3>5º item</h3>${opts(b.quinto)}` : ''}
        </div>
      </div>
    </section>`;
  }

  // Visão geral: cada posição da build com as opções em ordem de WPA
  const SLOTS = [['key', 'Runa principal', 'Escolhas'], ['start', 'Item inicial', 'Compras'], ['i1', '1º item', 'Compras'], ['i2', '2º item', 'Compras'],
    ['spell', 'Feitiço', 'Escolhas'], ['boots', 'Bota', 'Compras'], ['i3', '3º item', 'Compras'], ['i4', '4º item em diante', 'Compras']];
  function overviewHTML(b) {
    const W = b.wpa || {};
    if (!SLOTS.some(([k]) => W[k]?.length)) return `<section class="card"><h2>Visão geral por WPA</h2><p class="note">O WPA aparece conforme a coleta de soloQ baixa partidas novas: as partidas coletadas antes desta versão não guardaram o ouro no momento de cada compra.</p></section>`;
    const bar = (w) => { const n = Math.min(5, Math.ceil(Math.abs(w) / 0.5)); return `<span class="wbar ${w >= 0 ? 'up' : 'down'}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>`; };
    const row = (slot, x) => {
      const icon = slot === 'key' ? rune(x.id, 'ov-i') : slot === 'spell' ? spell(x.id, 'ov-i') : item(x.id, 'ov-i');
      const name = slot === 'key' ? N.runas[x.id] : slot === 'spell' ? N.feiticos[x.id] : N.itens[x.id]?.n;
      return `<tr class="${x.poucos ? 'few' : ''}"><td>${icon}<span>${esc(name || String(x.id))}</span></td><td>${x.poucos ? '<small>poucos dados</small>' : `<b class="${x.wpa >= 0 ? 'up' : 'down'}">${wpaTxt(x.wpa)}</b>${bar(x.wpa)}`}</td><td>${fmt(x.g)}</td></tr>`;
    };
    const box = ([k, title, col]) => `<div class="ovbox"><table><thead><tr><th>${title}</th><th>WPA</th><th>${col}</th></tr></thead><tbody>${(W[k] || []).slice(0, 7).map((x) => row(k, x)).join('') || '<tr><td colspan="3"><small>Sem dados ainda.</small></td></tr>'}</tbody></table></div>`;
    return `<section class="card ov">
      <h2>Visão geral por WPA</h2>
      <p class="note"><b>WPA</b> (Win Probability Added) é quanto a escolha soma à chance de vitória, em pontos percentuais: a taxa de vitória de quem escolheu menos a chance que essas pessoas já tinham antes de escolher (pelo minuto e pela diferença de ouro na hora da compra; para runas, feitiços e item inicial, pelo confronto de rota). Assim, um item comprado só por quem já está ganhando não parece melhor do que é. Opções com menos de 25 escolhas ficam como "poucos dados" e não entram na build recomendada.</p>
      <div class="ovgrid">${SLOTS.map(box).join('')}</div>
    </section>`;
  }

  // ---------- Explorador de itens (no estilo do coachless) ----------
  const XCATS = [['L', 'Lendários'], ['C', 'Componentes'], ['B', 'Botas'], ['S', 'Suporte'], ['T', 'Inicial']];
  const XSLOTS = [['all', 'Todos'], ['1', '1º'], ['2', '2º'], ['3', '3º'], ['4', '4º+']];
  const MINX = 25;
  const p1 = (x) => `${(Math.round(x * 10) / 10).toFixed(1).replace('.', ',')}%`;
  const segs = (frac, cls) => { const n = Math.max(frac > 0 ? 1 : 0, Math.min(5, Math.round(frac * 5))); return `<span class="wbar ${cls}">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(5 - n)}</span>`; };
  const wseg = (w) => segs(Math.min(1, Math.abs(w) / 2.5), w >= 0 ? 'up' : 'down');
  function xrows(b) {
    const X = b.explorador?.itens || {};
    const keys = XCAT === 'T' ? ['T0'] : (XSLOT === 'all' ? ['1', '2', '3', '4'] : [XSLOT]).map((sl) => XCAT + sl);
    const sum = {};
    for (const k of keys) for (const [id, x] of Object.entries(X[k] || {})) { const y = (sum[id] ||= [0, 0, 0]); y[0] += x[0]; y[1] += x[1]; y[2] += x[2]; }
    const base = b.explorador?.partidasItens || 1;
    const rows = Object.entries(sum).filter(([, x]) => x[0] >= 5).map(([id, [g, w, p]]) => ({ id: Number(id), g, wpa: ((w - p) / g) * 100, pick: (g / base) * 100, pre: (p / g) * 100, wr: (w / g) * 100, poucos: g < MINX }));
    const by = { wpa: (r) => r.wpa, g: (r) => r.g, pick: (r) => r.pick, pre: (r) => r.pre, wr: (r) => r.wr }[XSORT];
    rows.sort((a, c) => (XSORT === 'wpa' ? a.poucos - c.poucos : 0) || by(c) - by(a));
    return rows;
  }
  function itemsExplorerHTML(b) {
    if (!b.explorador?.partidasItens) return '';
    const rows = xrows(b);
    const maxG = Math.max(1, ...rows.map((r) => r.g));
    const head = [['item', 'Item'], ['wpa', 'WPA'], ['g', 'Compras'], ['pick', '% de escolha'], ['pre', 'Chance antes'], ['wr', 'Vitórias']];
    const th = head.map(([k, t]) => (k === 'item' ? `<th>${t}</th>` : `<th class="num"><button type="button" class="xsort${XSORT === k ? ' on' : ''}" data-xsort="${k}">${XSORT === k ? '▾ ' : ''}${t}</button></th>`)).join('');
    const list = XALL ? rows : rows.slice(0, 15);
    const tr = (r) => `<tr class="${r.poucos ? 'few' : ''}">
      <td><span class="xi">${item(r.id, 'ov-i')}<span>${esc(N.itens[r.id]?.n || String(r.id))}</span></span></td>
      <td class="num">${r.poucos ? '<small>poucos dados</small>' : `<b class="${r.wpa >= 0 ? 'up' : 'down'}">${wpaTxt(r.wpa)}</b>${wseg(r.wpa)}`}</td>
      <td class="num">${fmt(r.g)}${segs(r.g / maxG, 'neu')}</td>
      <td class="num">${p1(r.pick)}</td><td class="num">${p1(r.pre)}</td><td class="num">${p1(r.wr)}</td></tr>`;
    return `<section class="card xp">
      <div class="xhead"><h2>Itens</h2>
        <div class="chips">${XCATS.map(([k, t]) => `<button class="chip" type="button" data-xcat="${k}" aria-pressed="${XCAT === k}">${t}</button>`).join('')}</div>
        ${XCAT === 'T' ? '' : `<div class="chips xslots">${XSLOTS.map(([k, t]) => `<button class="chip" type="button" data-xslot="${k}" aria-pressed="${XSLOT === k}">${t}</button>`).join('')}</div>`}
      </div>
      <p class="note">${XCAT === 'T' ? 'Itens comprados no primeiro minuto. A chance antes vem do confronto de rota.' : 'A fase (1º, 2º, 3º, 4º+) é o item lendário que o jogador estava montando na hora da compra. A chance antes vem do minuto e da diferença de ouro naquele momento.'} % de escolha: em quantas partidas com linha do tempo (${fmt(b.explorador.partidasItens)}) o item foi comprado nessa fase. Clique no título de uma coluna para ordenar.</p>
      ${rows.length ? `<div class="xtable"><table class="tbl xt"><thead><tr>${th}</tr></thead><tbody>${list.map(tr).join('')}</tbody></table></div>${rows.length > 15 ? `<button class="linkbtn" type="button" data-xall>${XALL ? 'Mostrar menos' : `Mostrar todos (${rows.length})`}</button>` : ''}` : '<p class="note">Sem compras suficientes nesta categoria ainda.</p>'}
    </section>`;
  }

  // ---------- Explorador de runas ----------
  const SHARD_ROWS_D = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
  function runesExplorerHTML(b) {
    const R = b.explorador?.runas || {};
    const trees = B.arvores || [];
    if (!trees.length || !Object.keys(R).length) return '';
    const tot = b.g || 1;
    const share = (k) => (R[k]?.[0] || 0) / tot;
    const pri = RPRI ?? trees.map((t) => t.id).sort((x, y) => share(`P${y}`) - share(`P${x}`))[0];
    const sub = RSUB ?? trees.map((t) => t.id).filter((id) => id !== pri).sort((x, y) => share(`S${y}`) - share(`S${x}`))[0];
    const tP = trees.find((t) => t.id === pri), tS = trees.find((t) => t.id === sub);
    const card = (k, id, cls = '') => {
      const x = R[k];
      const icon = rune(id, 'rx-i', !!x && x[0] >= MINX);
      if (!x) return `<div class="rcard off ${cls}">${icon}<span class="rv"><b>–</b><small>–</small></span></div>`;
      const w = ((x[1] - x[2]) / x[0]) * 100, few = x[0] < MINX;
      return `<div class="rcard ${few ? 'few' : ''} ${cls}" title="${esc(N.runas[id] || '')}: ${fmt(x[0])} escolhas, ${p1((x[1] / x[0]) * 100)} de vitória">${icon}<span class="rv"><b class="${few ? '' : w >= 0 ? 'up' : 'down'}">${few ? '–' : wpaTxt(w)}</b>${few ? '' : wseg(w)}<small>${fmt(x[0])}</small></span></div>`;
    };
    const styles = (sel, pre, attr, skip) => trees.filter((t) => t.id !== skip).map((t) => `<button type="button" class="rstyle-b" data-${attr}="${t.id}" aria-pressed="${t.id === sel}" title="${esc(N.runas[t.id] || '')}">${rune(t.id, 'rs-i')}<small>${Math.round(share(`${pre}${t.id}`) * 100)}%</small></button>`).join('');
    const rowsP = tP ? tP.slots.map((row, i) => `<div class="rrow2 ${i === 0 ? 'keys' : ''}">${row.map((id) => card(`r${id}`, id)).join('')}</div>`).join('') : '';
    const rowsS = tS ? tS.slots.slice(1).map((row) => `<div class="rrow2">${row.map((id) => card(`r${id}`, id)).join('')}</div>`).join('') : '';
    const shards = (B.arvore?.shards || SHARD_ROWS_D).map((row, i) => `<div class="rrow2 small">${row.map((id) => card(`s${i}:${id}`, id, 'shard')).join('')}</div>`).join('');
    return `<section class="card rxp">
      <h2>Runas</h2>
      <p class="note">WPA e número de escolhas de cada runa e fragmento. A porcentagem em cada árvore é em quantas partidas ela foi a principal (esquerda) ou a secundária (direita). Clique numa árvore para ver as runas dela.</p>
      <div class="rx">
        <div class="rcol"><div class="rstyles">${styles(pri, 'P', 'rpri', null)}</div>${rowsP}</div>
        <div class="rcol"><div class="rstyles">${styles(sub, 'S', 'rsub', pri)}</div>${rowsS}<h3 class="rsh">Fragmentos</h3>${shards}</div>
      </div>
    </section>`;
  }

  function mcard(x) {
    const c = byKey(x.opp);
    const rota = x.rota ? `<em class="lane ${x.rota}">${x.rota === 'boa' ? 'Rota boa' : x.rota === 'ruim' ? 'Rota ruim' : 'Rota média'}</em>` : '<em class="lane">Sem dados de rota</em>';
    return `<button class="mcard${VS === x.opp ? ' on' : ''}" data-vs="${x.opp}" title="${esc(c?.name || '')}: ${pct(x.wr)} de vitória em ${fmt(x.g)} jogos${x.gd != null ? `, ${x.gd > 0 ? '+' : ''}${fmt(x.gd)} de ouro aos 14 min` : ''}">
      <span class="mart">${c ? `<img src="/img/loading/${esc(c.id)}" alt="" loading="lazy" data-fail="noimg">` : '<span class="noimg"></span>'}<span class="mname">${esc(c?.name || '?')}</span></span>
      <b class="${x.d >= 0 ? 'up' : 'down'}">${sinal(x.d)}</b><small>${fmt(x.g)} jogos</small>${rota}</button>`;
  }
  function matchupsHTML(b) {
    const rows = b.confrontos || [];
    if (!rows.length) return `<section class="card"><h2>Confrontos na rota</h2><p class="note">Ainda sem confrontos com jogos suficientes (15 ou mais).</p></section>`;
    const good = rows.filter((x) => x.d > 0).slice(0, 5);
    const bad = rows.filter((x) => x.d < 0).slice(-5).reverse();
    const full = FULL ? `<table class="tbl mt"><thead><tr><th>Contra</th><th>Vitórias</th><th>Diferença</th><th>Jogos</th><th>Ouro aos 14 min</th></tr></thead><tbody>${rows.map((x) => { const c = byKey(x.opp); return `<tr data-vs="${x.opp}" class="${VS === x.opp ? 'on' : ''}"><td><span class="tc">${c ? `<img src="${c.icon}" alt="">` : ''}${esc(c?.name || x.opp)}</span></td><td>${pct(x.wr)}</td><td class="${x.d >= 0 ? 'up' : 'down'}">${sinal(x.d)}</td><td>${fmt(x.g)}</td><td>${x.gd == null ? '–' : `${x.gd > 0 ? '+' : ''}${fmt(x.gd)}`}</td></tr>`; }).join('')}</tbody></table>` : '';
    const me = B.campeao.name;
    return `<section class="card mups">
      <h2>Confrontos de ${esc(me)}${B.rota ? ` ${{ T: 'no topo', J: 'na selva', M: 'no meio', A: 'na rota inferior', S: 'como suporte' }[B.rota]}` : ''}</h2>
      <p class="note">A porcentagem é a diferença de vitória contra a média do ${esc(me)} na rota. "Rota boa" ou "ruim" vem do ouro aos 14 minutos. Clique num campeão para ver as partidas de alto elo contra ele.</p>
      <div class="mboard">
        <div class="mside good"><h3 class="up">Bom contra</h3><div class="mu-row">${good.map(mcard).join('') || '<p class="note">Nenhum ainda.</p>'}</div></div>
        <div class="mside bad"><h3 class="down">Ruim contra</h3><div class="mu-row">${bad.map(mcard).join('') || '<p class="note">Nenhum ainda.</p>'}</div></div>
        <button class="mfull" type="button" data-full><span aria-hidden="true">${FULL ? '−' : '+'}</span>${FULL ? 'Esconder a lista' : 'Lista completa'}<small>${rows.length} confrontos</small></button>
      </div>
      ${full}
    </section>`;
  }

  function historyHTML(b) {
    const me = DL.CHAMPS.find((c) => c.id === B.campeao.id);
    const all = b.historico || [];
    const list = VS ? all.filter((g) => String(g.opp) === String(VS)) : all;
    const vs = VS && byKey(VS);
    const rows = list.slice(0, SHOW).map((g) => {
      const o = byKey(g.opp);
      return `<li class="hrow ${g.win ? 'win' : 'loss'}">
        <span class="hmeta"><b>${g.win ? 'Vitória' : 'Derrota'}</b><small>${quando(g.t)}</small><small><span class="plat">${esc(PLAT[g.plat] || g.plat)}</span> ${esc(TIER[g.tier] || '')}</small></span>
        <span class="hvs">${me ? `<img src="${me.icon}" alt="">` : ''}<i>vs</i>${o ? `<img src="${o.icon}" alt="" title="${esc(o.name)}">` : '<span class="noimg"></span>'}</span>
        <button class="plink hname" type="button" data-q="${esc(g.nome + '#' + g.tag)}" data-plat="${esc(g.plat)}">${esc(g.nome)}<small>#${esc(g.tag)}</small></button>
        <span class="hrunes">${g.runes.map((id) => rune(id, 'hr')).join('')}${g.spells.map((id) => spell(id, 'hs')).join('')}</span>
        <span class="hitems">${g.items.map((id) => item(id, 'hi')).join('')}</span>
        <span class="hkda"><b>${g.k} / <span class="down">${g.d}</span> / ${g.a}</b><small>${g.cs} CS · ${Math.round(g.dur / 60)} min</small></span>
      </li>`;
    }).join('');
    return `<section class="card hist">
      <h2>Partidas de Diamante ou acima${vs ? ` contra ${esc(vs.name)}` : ''}<span class="count">${list.length}</span></h2>
      ${VS ? '<button class="linkbtn" type="button" data-clear>Ver todas as partidas</button>' : ''}
      ${list.length ? `<ul class="hlist">${rows}</ul>${list.length > SHOW ? `<button class="linkbtn more" type="button" data-more>Mostrar mais ${Math.min(10, list.length - SHOW)} de ${list.length - SHOW}</button>` : ''}` : `<p class="note">${all.length ? 'Nenhuma partida recente de alto elo neste confronto.' : 'As partidas de jogadores Diamante ou acima aparecem aqui conforme a coleta encontra. Escolha o elo Esmeralda+ ou mais alto na engrenagem.'}</p>`}
    </section>`;
  }

  // Importa e mostra o resultado em box (que tem .bmsg e .bpages). Se as páginas de runas estiverem
  // cheias, lista as suas páginas para você escolher qual o app pode apagar.
  async function doImport(btn, box, champId, role, extra = {}) {
    const msg = box.querySelector('.bmsg'), pages = box.querySelector('.bpages');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Importando…';
    if (pages) pages.innerHTML = '';
    try {
      const r = await api('/api/build/importar', { method: 'POST', body: JSON.stringify({ campeao: champId, rota: role, ...extra }) });
      msg.className = 'note bmsg ' + (r.passos.every((p) => p.ok) ? 'ok' : 'err');
      msg.innerHTML = r.passos.map((p) => `<span><b>${esc(p.nome)}:</b> ${esc(p.detalhe)}</span>`).join('');
      const cheias = r.passos.find((p) => p.paginas);
      if (cheias && pages) pagesChoice(pages, cheias.paginas, (id) => doImport(btn, box, champId, role, { itens: false, feiticos: false, apagarPagina: id }));
    } catch (err) { msg.className = 'note bmsg err'; msg.textContent = err.message; }
    btn.disabled = false; btn.textContent = label;
  }
  function pagesChoice(el, paginas, go) {
    let sel = null;
    const draw2 = () => {
      el.innerHTML = `<p>Escolha a página que o Draft Lab pode apagar. No lugar dela entra a página <b>Runas Draft Lab</b>, e as próximas importações usam sempre essa mesma página.</p>
        <div class="pgchips">${paginas.map((p) => `<button type="button" class="chip" data-pg="${esc(String(p.id))}" aria-pressed="${String(p.id) === sel}">${esc(p.nome)}${p.atual ? ' <small>(em uso)</small>' : ''}</button>`).join('')}</div>
        ${sel ? `<button type="button" class="btn danger" data-pgok>Apagar "${esc(paginas.find((p) => String(p.id) === sel)?.nome || '')}" e criar Runas Draft Lab</button>` : ''}`;
    };
    draw2();
    el.onclick = (e) => {
      const b = e.target.closest('[data-pg]');
      if (b) { sel = b.dataset.pg; return draw2(); }
      if (e.target.closest('[data-pgok]') && sel) { el.onclick = null; el.innerHTML = ''; go(sel); }
    };
  }

  document.addEventListener('click', (e) => {
    if (!host || !host.contains(e.target)) return;
    const t = e.target;
    const rota = t.closest('[data-rota]');
    if (rota) return render(host, B.campeao.id, rota.dataset.rota);
    if (t.closest('[data-import]')) return doImport(t.closest('[data-import]'), t.closest('.build'), B.campeao.id, B.rota);
    if (t.closest('[data-full]')) { FULL = !FULL; return draw(); }
    const xc = t.closest('[data-xcat]'); if (xc) { XCAT = xc.dataset.xcat; XALL = false; return redraw('.xp'); }
    const xs = t.closest('[data-xslot]'); if (xs) { XSLOT = xs.dataset.xslot; XALL = false; return redraw('.xp'); }
    const xo = t.closest('[data-xsort]'); if (xo) { XSORT = xo.dataset.xsort; return redraw('.xp'); }
    if (t.closest('[data-xall]')) { XALL = !XALL; return redraw('.xp'); }
    const rp = t.closest('[data-rpri]'); if (rp) { RPRI = Number(rp.dataset.rpri); if (RSUB === RPRI) RSUB = null; return redraw('.rxp'); }
    const rs = t.closest('[data-rsub]'); if (rs) { RSUB = Number(rs.dataset.rsub); return redraw('.rxp'); }
    if (t.closest('[data-clear]')) { VS = null; SHOW = 10; return draw(); }
    if (t.closest('[data-more]')) { SHOW += 10; return draw(); }
    const vs = t.closest('[data-vs]');
    if (vs) { VS = String(VS) === vs.dataset.vs ? null : Number(vs.dataset.vs); SHOW = 10; draw(); host.querySelector('.hist')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const q = t.closest('.hname[data-q]');
    if (q && window.DLMundo) {
      const reg = { BR1: 'br1', NA1: 'na1', EUW1: 'euw1', EUN1: 'eun1', KR: 'kr', LA1: 'la1', LA2: 'la2', JP1: 'jp1', OC1: 'oc1', TR1: 'tr1', RU: 'ru', ME1: 'me1', SG2: 'sg2', TW2: 'tw2', VN2: 'vn2' }[q.dataset.plat];
      window.DLMundo.search(q.dataset.q, reg);
    }
  });

  // ---------- Champ select: ver a build do seu campeão e importar ----------
  let LIVE = null; // { id, role, data }
  function previewHTML(P) {
    const b = P.build;
    if (!b || !b.g) return '<p class="note">Ainda não há partidas deste campeão na coleta de soloQ: não há o que importar.</p>';
    N = P.nomes;
    const r = b.runas;
    const names = r ? r.perks.map((id) => P.nomes.runas[id]).filter(Boolean) : [];
    const items = [...(b.iniciais?.ids || []).map((id) => item(id)), b.bota ? item(b.bota.id) : '', ...(b.core?.ids || b.itens?.slice(0, 3).map((x) => x.id) || []).map((id) => item(id))].join('');
    return `<div class="pv">
      <div class="pv-runes"><h4>Runas que vão para a página <b>Runas Draft Lab</b></h4>${runesHTML(b, P.arvore)}${names.length ? `<p class="pv-names">${names.map(esc).join(' · ')}</p>` : ''}</div>
      <div class="pv-side">
        <h4>Feitiços</h4><div class="row">${(b.feiticos?.ids || []).map((id) => spell(id)).join('') || '<span class="note">–</span>'}</div>
        <h4>Conjunto de itens na loja</h4><div class="row">${items || '<span class="note">–</span>'}</div>
        <p class="note">${fmt(b.g)} partidas ${esc(P.coleta.eloNome)} · ${String(b.wr).replace('.', ',')}% de vitória</p>
      </div>
    </div>`;
  }
  async function openPreview(c, role) {
    const box = $('importBar').querySelector('.pvbox');
    box.hidden = false;
    box.innerHTML = '<p class="note">Carregando a build…</p>';
    try {
      const P = await api(`/api/build/${encodeURIComponent(c.id)}${role ? `?rota=${role}` : ''}`);
      LIVE = { ...LIVE, data: P };
      const ok = !!P.build?.g;
      box.innerHTML = `${previewHTML(P)}<div class="row pv-act">${ok ? '<button class="btn primary" type="button" data-liveok>Importar esta build</button>' : ''}<button class="btn" type="button" data-liveclose>Fechar</button></div><p class="note bmsg" role="status"></p><div class="bpages"></div>`;
    } catch (err) { box.innerHTML = `<p class="note err">${esc(err.message)}</p>`; }
  }
  function liveBar() {
    const bar = $('importBar');
    const s = DL.snap, d = s?.session;
    const me = d?.players?.[d.mySide]?.find((p) => p.isMe);
    const key = me?.champion || me?.hover;
    const c = key ? DL.CHAMPS.find((x) => String(x.key) === String(key)) : null;
    if (!c || s.source !== 'cliente') { bar.hidden = true; LIVE = null; return; }
    const id = `${c.id}|${me.role || ''}`;
    if (LIVE?.id === id && !bar.hidden) return;
    LIVE = { id, c, role: me.role || null };
    bar.hidden = false;
    bar.innerHTML = `<div class="ib-head"><img src="${c.icon}" alt=""><span><b>${esc(c.name)}${me.role ? ` · ${ROLE_PT[me.role]}` : ''}</b><small>Runas, itens na loja e feitiços da coleta de soloQ</small></span>
      <button class="btn primary" type="button" data-liveopen>Ver build para importar</button></div><div class="pvbox" hidden></div>`;
  }
  $('importBar').addEventListener('click', (e) => {
    if (!LIVE) return;
    const t = e.target;
    if (t.closest('[data-liveopen]')) return openPreview(LIVE.c, LIVE.role);
    if (t.closest('[data-liveclose]')) { const box = $('importBar').querySelector('.pvbox'); box.hidden = true; box.innerHTML = ''; return; }
    if (t.closest('[data-liveok]')) return doImport(t.closest('[data-liveok]'), $('importBar').querySelector('.pvbox'), LIVE.c.id, LIVE.role);
  });
  document.addEventListener('dl:lcu', liveBar);

  window.DLBuild = { render };
})();
