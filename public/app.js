// Draft Lab — tela principal
// O draft chega pelo servidor (lib/lcu.js) a cada mudança. As sugestões juntam as fichas
// dos campeões com as estatísticas de soloQ coletadas pelo próprio app (lib/soloq.js).
(() => {
  const E = window.DraftEngine;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { T: 'TOP', J: 'JG', M: 'MID', A: 'ADC', S: 'SUP' };
  const other = (side) => (side === 'B' ? 'R' : 'B');
  let CHAMPS = [], BYKEY = {};
  let REL = E.relations([]);
  let STATS = {}, LANE = null, DUO = null, SOLO = null, SOLO_ST = null;
  let SNAP = null;

  // Imagem que não carregou: some, ou vira um espaço vazio com as classes de data-fail.
  // Fica aqui, e não num onerror dentro do HTML, porque a página proíbe scripts embutidos (segurança).
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement) || t.dataset.fail == null) return;
    if (t.dataset.fail === 'remove') t.remove();
    else t.replaceWith(Object.assign(document.createElement('span'), { className: t.dataset.fail }));
  }, true);

  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...window.DLKey.headers() } }); // com a chave de sessão (chave.js)
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
    return j;
  };
  const champ = (key) => (key > 0 ? BYKEY[String(key)] || { name: `Campeão ${key}`, tile: '', icon: '', roles: '' } : null);
  const nameOf = (key) => (key > 0 ? BYKEY[String(key)]?.name || null : null);
  const msg = (t, k = '') => { $('msg').className = 'note ' + k; $('msg').textContent = t; };
  const boldList = (s) => s.map((n) => `<b>${esc(n)}</b>`).join(', ');
  const rolesTxt = (open) => open.map((r) => E.ROLE_NAME[r]).join(' ou ');

  // ---------- Leitura do draft ao vivo ----------
  const lockedNames = (d, side) => d.players[side].map((p) => nameOf(p.champion)).filter(Boolean);
  // Rota de cada campeão travado, quando o cliente informa (ex.: o ADC inimigo nas partidas em que a rota aparece).
  const roleOfIn = (d) => { const m = {}; for (const side of ['B', 'R']) for (const p of d.players[side]) { const n = nameOf(p.champion); if (n && p.role) m[n] = p.role; } return (n) => m[n] || null; };
  const findPlayer = (d, cellId) => d.players.B.find((p) => p.cellId === cellId) || d.players.R.find((p) => p.cellId === cellId) || null;

  // Rotas que um time ainda precisa. Na ranqueada a rota de cada um já vem do cliente;
  // sem rotas (personalizada), deduz pelos campeões já travados, como no simulador.
  function openFor(d, side, actor) {
    if (actor?.role) return [actor.role];
    const team = d.players[side];
    if (team.length && team.every((p) => p.role)) return E.ROLES.filter((r) => team.some((p) => p.role === r && !p.champion));
    return E.openRoles(team.map((p) => champ(p.champion)).filter(Boolean).map((c) => c.roles || ''));
  }

  // Para quem as sugestões são agora: quem está na vez, ou você durante a declaração de intenção.
  function focusOf(d) {
    const cur = d.current;
    if (cur) {
      const actor = findPlayer(d, cur.cellId);
      return { kind: cur.type, acting: cur.side, aim: cur.type === 'pick' ? cur.side : other(cur.side), actor };
    }
    if (d.done) return null;
    const me = d.players[d.mySide].find((p) => p.isMe);
    return me && !me.champion ? { kind: 'pick', acting: d.mySide, aim: d.mySide, actor: me, planning: true } : null;
  }

  function suggestions(d, owned) {
    const f = focusOf(d);
    if (!f) return null;
    const mine = f.acting === d.mySide;
    const banned = new Set([...d.bans.B, ...d.bans.R, ...(d.fora || [])].map(nameOf).filter(Boolean)); // fora: travados pelo Fearless (InHouse)
    const picked = new Set([...lockedNames(d, 'B'), ...lockedNames(d, 'R')]);
    // Hovers dos aliados: ninguém quer banir ou roubar o campeão que o colega já declarou.
    const allyHovers = new Set(d.players[d.mySide].filter((p) => !p.champion && p.hover && p.cellId !== f.actor?.cellId).map((p) => nameOf(p.hover)));
    // Só os campeões que você tem (ou estão na rotação) quando a vez é sua.
    const ids = f.actor?.isMe ? (f.kind === 'pick' ? owned?.pick : owned?.ban) : null;
    const allowed = ids ? new Set(ids.map(nameOf).filter(Boolean)) : null;
    const open = openFor(d, f.aim, f.kind === 'pick' ? f.actor : null);
    const r = E.read({
      champs: CHAMPS, rel: REL,
      allies: lockedNames(d, f.aim), foes: lockedNames(d, other(f.aim)), open,
      isOut: (n) => banned.has(n) || picked.has(n) || (mine && allyHovers.has(n)) || (allowed && !allowed.has(n)),
      stats: STATS, lane: LANE, duo: DUO,
      role: f.kind === 'pick' && open.length === 1 ? open[0] : null,
      roleOf: roleOfIn(d),
    });
    const teamName = f.aim === d.mySide ? 'o seu time' : 'o time inimigo';
    const groups = E.groups(f.kind, r, { teamName, names: boldList });

    let title, sub;
    const who = f.actor?.isMe ? 'Você' : f.actor?.label || '';
    const roles = open.length && open.length < 5 ? ` para ${rolesTxt(open)}` : '';
    const onlyOwned = allowed ? ' Só aparecem campeões que você pode usar.' : '';
    if (f.kind === 'pick' && mine) {
      title = f.actor?.isMe ? (f.planning ? 'O que declarar' : 'O que escolher') : `Sugestões para ${who}`;
      sub = `Campeões${roles} contra o que o inimigo já travou e com o que o seu time já tem.${onlyOwned}`;
    } else if (f.kind === 'pick') {
      title = 'O que o inimigo pode escolher';
      sub = `Campeões${roles} que funcionam contra o seu time. Bom para prever o próximo pick.`;
    } else if (mine) {
      title = f.actor?.isMe ? 'O que banir' : 'Banimento do seu time';
      sub = `Campeões${roles} que seriam fortes no time inimigo.${onlyOwned}`;
    } else {
      title = 'O que o inimigo pode banir';
      sub = 'Campeões que seriam fortes no seu time.';
    }
    if (Object.keys(STATS).length) sub += ` Só entram campeões com ${E.RULES.MIN_GAMES} jogos ou mais${f.kind === 'pick' && open.length === 1 ? ' na rota' : ''}: fortes acima de ${E.RULES.STRONG}% de vitória, fracos abaixo de ${E.RULES.WEAK}%.`;
    return { title, sub, groups, kind: f.kind };
  }

  // ---------- Desenho ----------
  // Cada parte só é redesenhada quando muda: nada pisca a cada evento do cliente.
  function setHTML(el, html) { if (el && el._html !== html) { el._html = html; el.innerHTML = html; return true; } return false; }

  function status(s) {
    const el = $('status');
    if (!s) { el.className = 'conn off'; el.textContent = 'App desligado: abra o Iniciar.bat'; return; }
    if (s.source === 'replay') { el.className = 'conn replay'; el.textContent = s.replay?.finished ? 'Gravação terminada' : `Gravação em ${s.replay?.speed}x`; return; }
    if (s.status === 'conectado') { el.className = 'conn on'; el.textContent = 'Cliente conectado'; return; }
    el.className = 'conn'; el.textContent = 'Procurando o cliente';
  }

  const pctOf = (x, name) => (x.nums[name] ? ` ${x.nums[name].wr}%` : '');
  // Leitura de um campeão (travado ou em hover) contra o draft: quem ele vence, para quem perde, com quem combina.
  function readLine(d, p, c) {
    if (!c || !BYKEY[String(c.key)]) return '';
    const allies = lockedNames(d, p.side).filter((n) => n !== c.name);
    const foes = lockedNames(d, other(p.side));
    const x = E.rate(c, { rel: REL, allies, foes, stats: STATS, lane: LANE, duo: DUO, role: p.role || null, roleOf: roleOfIn(d) });
    const parts = [];
    if (x.good.length) parts.push(`<span class="g">Vence ${esc(x.good.map((n) => n + pctOf(x, n)).join(', '))}</span>`);
    if (x.bad.length) parts.push(`<span class="b">Perde para ${esc(x.bad.map((n) => n + pctOf(x, n)).join(', '))}</span>`);
    if (x.syn.length) parts.push(`<span>Combina com ${esc(x.syn.map((n) => n + pctOf(x, n)).join(', '))}</span>`);
    // Win rate só com jogos suficientes; abaixo disso o número engana.
    if (x.sit && x.eligible) parts.push(`<span>${Math.round(x.sit.wr * 10) / 10}% ${x.sit.vs ? 'contra ' + esc(x.sit.vs) : x.roleStats ? 'na rota' : 'de vitória'}, ${fmt(x.sit.g)} jogos</span>`);
    else if (Object.keys(STATS).length) parts.push(`<span>Poucos jogos${x.roleStats ? ' na rota' : ''} (${fmt(x.games)})</span>`);
    return parts.length ? `<span class="reads">${parts.join('')}</span>` : '';
  }

  // Mais jogados do aliado (histórico do cliente): na rota dele, quando a rota é conhecida.
  function mainsHTML(p) {
    const x = p.ally && SNAP?.scout?.[p.cellId];
    if (!x) return '';
    if (x.status === 'carregando') return '<span class="mains muted">Buscando o histórico…</span>';
    if (x.status === 'vazio') return '<span class="mains muted">Sem partidas recentes no histórico</span>';
    if (x.status !== 'ok' || !x.top?.length) return '';
    const icons = x.top.map((t) => {
      const c = BYKEY[String(t.champion)];
      if (!c) return '';
      const tip = `${c.name}: ${t.games} ${t.games === 1 ? 'jogo' : 'jogos'}, ${Math.round((t.wins / t.games) * 100)}% de vitória`;
      return `<img src="${c.icon}" alt="${esc(c.name)}" title="${esc(tip)}">`;
    }).join('');
    const where = x.byRole ? `na rota (${x.games} de ${x.total} jogos)` : `(${x.total} jogos recentes)`;
    return `<span class="mains">${icons}<span>Mais jogados ${where}</span></span>`;
  }

  function slotHTML(d, p, active) {
    const c = champ(p.champion), h = !c && champ(p.hover);
    const shown = c || h;
    const pic = shown?.tile ? ` style="background-image:url('${shown.tile}')"` : '';
    const who = p.isMe ? 'Você' : p.name ? `${esc(p.label)}, ${esc(p.name)}` : esc(p.label);
    const what = c ? `<span class="cname">${esc(c.name)}</span>`
      : h ? `<span class="cname hover">${esc(h.name)}</span>`
      : `<span class="cname empty">${active ? 'Escolhendo…' : 'Ainda não escolheu'}</span>`;
    return `<div class="slot${p.isMe ? ' me' : ''}${active ? ' active' : ''}">
      <span class="pic${c ? ' set' : h ? ' set hover' : ''}"${pic}>${p.role ? `<span class="role">${ROLE[p.role]}</span>` : ''}</span>
      <span class="info">${what}<span class="pname">${who}${h ? ', intenção' : ''}</span>${mainsHTML(p)}${readLine(d, p, shown)}</span>
    </div>`;
  }

  // Um time: cabeçalho + 5 vagas. Cada vaga é um elemento fixo, atualizado só quando muda.
  const lastLocked = {};
  function renderTeam(el, d, side, ally) {
    const cur = d.current;
    setHTML(el.querySelector('.team-head') || (el.innerHTML = '<div class="team-head"></div>', el.firstChild),
      `<h2>${ally ? 'Seu time' : 'Time inimigo'}</h2><span>lado ${side === 'B' ? 'azul' : 'vermelho'}</span>`);
    // Na ranqueada cada um tem rota: mostra na ordem Top, Jungle, Mid, ADC, Suporte.
    const order = 'TJMAS';
    const list = d.players[side].every((p) => p.role) ? [...d.players[side]].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)) : d.players[side];
    list.forEach((p, i) => {
      let slot = el.children[i + 1];
      if (!slot) { slot = document.createElement('div'); el.appendChild(slot); }
      const changed = setHTML(slot, slotHTML(d, p, cur && cur.type === 'pick' && cur.cellId === p.cellId));
      // Campeão recém-travado: um efeito curto de "trava" no retrato.
      const key = `${d.gameId}:${p.cellId}`;
      if (changed && p.champion && lastLocked[key] !== p.champion && lastLocked[key] !== undefined) slot.querySelector('.pic')?.classList.add('locked');
      lastLocked[key] = p.champion;
    });
    while (el.children.length > d.players[side].length + 1) el.lastChild.remove();
  }

  function banRow(el, d, side) {
    const list = d.bans[side] || [];
    const cur = d.current;
    const activeIdx = cur && cur.type === 'ban' && cur.side === side ? list.length : -1;
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (i < list.length) {
        const c = champ(list[i]);
        html += c ? `<span class="ban set" title="${esc(c.name)}" style="background-image:url('${c.icon}')"></span>` : '<span class="ban none" title="Sem ban">–</span>';
      } else if (i === activeIdx) {
        const h = cur.ally && champ(cur.champion);
        html += `<span class="ban active" ${h ? `title="${esc(h.name)}" style="background-image:url('${h.icon}');opacity:.5"` : ''}></span>`;
      } else html += '<span class="ban"></span>';
    }
    setHTML(el, html);
  }

  // Motivos de uma sugestão, em frases curtas. Separa o que vem dos números do que vem do histórico das fichas.
  function reasons(x) {
    const split = (list) => ({ num: list.filter((n) => x.nums[n]), hist: list.filter((n) => x.hist.has(n)) });
    const numTxt = (n) => `${n} ${x.nums[n].wr}% em ${fmt(x.nums[n].g)}`;
    const out = [];
    const g = split(x.good), s = split(x.syn), b = split(x.bad);
    if (g.hist.length) out.push(`<span class="g">Historicamente forte contra ${esc(g.hist.join(', '))}</span>`);
    if (g.num.length) out.push(`<span class="g">Vence ${esc(g.num.map(numTxt).join(', '))}</span>`);
    if (s.hist.length) out.push(`Historicamente combina com ${esc(s.hist.join(', '))}`);
    if (s.num.length) out.push(`Com ${esc(s.num.map(numTxt).join(', '))}`);
    if (b.hist.length) out.push(`<span class="b">Historicamente fraco contra ${esc(b.hist.join(', '))}</span>`);
    if (b.num.length) out.push(`<span class="b">Perde para ${esc(b.num.map(numTxt).join(', '))}</span>`);
    return out.join('. ');
  }
  function pickHTML(x, cls) {
    // Número da direita: o win rate que decidiu a sugestão
    const n = cls === 'syn' ? x.synWr : x.sit;
    const where = !n ? '' : n.vs ? `contra ${esc(n.vs)}` : n.with ? `com ${esc(n.with)}` : x.roleStats ? 'na rota' : 'no geral';
    const wr = n ? `<span class="wr ${n.wr > E.RULES.STRONG ? 'up' : n.wr < E.RULES.WEAK ? 'down' : ''}">${Math.round(n.wr * 10) / 10}%<small>${where}, ${fmt(n.g)} jogos</small></span>` : '';
    const img = x.c.icon ? `<img src="${x.c.icon}" alt="" loading="lazy" data-fail="noimg">` : '<span class="noimg"></span>';
    const why = reasons(x);
    return `<div class="pick">${img}<span><span class="pn">${esc(x.c.name)}</span>${why ? `<br><span class="why">${why}</span>` : ''}</span>${wr}</div>`;
  }
  function emptyText(cls, hasStats) {
    if (!hasStats) return 'Nenhum campeão nas rotas em aberto.';
    if (cls === 'bad') return `Nenhum campeão com ${E.RULES.MIN_GAMES} jogos ou mais abaixo de ${E.RULES.WEAK}% aqui.`;
    return `Nenhum campeão com ${E.RULES.MIN_GAMES} jogos ou mais passa de ${E.RULES.STRONG}% aqui ainda. A lista cresce com a coleta.`;
  }

  // Uma lista só para o time: junta os grupos (contra cada campeão, por rota, combina com) num ranking.
  // Quem aparece em mais grupos e mais no alto de cada um sobe. Os motivos viram etiquetas curtas;
  // o texto completo fica na dica ao passar o mouse. Os "evite" viram uma linha só, embaixo.
  const chipOf = (title) => title.replace(/^Fortes contra/, 'Forte contra').replace(/^Combinam com/, 'Combina com').replace(/^Mais fortes no patch.*/, 'Forte no patch').replace(/^Mais fortes para.*/, '');
  function oneList(groups) {
    const merged = new Map();
    for (const g of groups) {
      if (g.cls === 'bad') continue;
      g.items.forEach((x, i) => {
        const e = merged.get(x.c.name) || { x, cls: g.cls, pts: 0, chips: [] };
        e.pts += 10 - i;
        if (!e.chips.includes(g.title)) e.chips.push(g.title);
        if (e.cls === 'syn' && g.cls === 'good') { e.x = x; e.cls = 'good'; }
        merged.set(x.c.name, e);
      });
    }
    const wrOf = (e) => (e.cls === 'syn' ? e.x.synWr : e.x.sit)?.wr ?? 0;
    const list = [...merged.values()].sort((a, b) => b.pts - a.pts || b.chips.length - a.chips.length || wrOf(b) - wrOf(a)).slice(0, 10);
    const hasStats = !!Object.keys(STATS).length;
    const bad = groups.filter((g) => g.cls === 'bad').flatMap((g) => g.items).filter((x, i, arr) => arr.findIndex((y) => y.c.name === x.c.name) === i).slice(0, 6);
    const row = (e) => {
      const n = e.cls === 'syn' ? e.x.synWr : e.x.sit;
      const where = !n ? '' : n.vs ? `contra ${esc(n.vs)}` : n.with ? `com ${esc(n.with)}` : e.x.roleStats ? 'na rota' : 'no geral';
      const wr = n ? `<span class="wr ${n.wr > E.RULES.STRONG ? 'up' : n.wr < E.RULES.WEAK ? 'down' : ''}">${Math.round(n.wr * 10) / 10}%<small>${where}, ${fmt(n.g)} jogos</small></span>` : '';
      const img = e.x.c.icon ? `<img src="${e.x.c.icon}" alt="" loading="lazy" data-fail="noimg">` : '<span class="noimg"></span>';
      const tip = reasons(e.x).replace(/<[^>]+>/g, '');
      return `<div class="pick one" title="${esc(tip)}">${img}<span><span class="pn">${esc(e.x.c.name)}</span><span class="chips1">${e.chips.map(chipOf).filter(Boolean).map((t) => `<span class="chip1">${t}</span>`).join('')}</span></span>${wr}</div>`;
    };
    const avoid = bad.length ? `<p class="avoid"><b>Evite:</b> ${bad.map((x) => `<span>${esc(x.c.name)}${x.sit ? ` <small>${Math.round(x.sit.wr * 10) / 10}%</small>` : ''}</span>`).join('')}</p>` : '';
    return `<div class="onelist">${list.length ? list.map(row).join('') : `<p class="empty-col">${emptyText('good', hasStats)}</p>`}</div>${avoid}`;
  }

  function renderSuggest(d) {
    const s = suggestions(d, SNAP?.owned);
    $('sugBox').hidden = !s;
    if (!s) return;
    $('sugTitle').textContent = s.title;
    $('sugSub').textContent = s.sub;
    if (!CHAMPS.length) return setHTML($('suggest'), '<p class="empty-col">Lista de campeões indisponível.</p>');
    setHTML($('suggest'), oneList(s.groups));
  }

  // Composição dos dois times.
  function compHTML(a, o, ally, side, title = null) {
    const head = title != null ? `<h3>${title}</h3>` : `<h3>${ally ? 'Seu time' : 'Time inimigo'}<span>lado ${side === 'B' ? 'azul' : 'vermelho'}</span></h3>`;
    if (!a.n) return head + '<p class="wait">A análise aparece quando o time travar o primeiro campeão.</p>';
    const { pct, vpct, mpct } = E.damage(a);
    const names = (arr) => (arr.length ? arr.map((c) => esc(c.name)).join(', ') : '<span class="none">ninguém</span>');
    const styles = E.ESTILOS.filter((e) => !['frente', 'engage', 'cc'].includes(e))
      .map((e) => `<span class="style${a.by[e].length ? ' on' : ''}" title="${a.by[e].map((c) => esc(c.name)).join(', ') || 'ninguém'}">${E.ESTILO_NOME[e]}<b class="num">${a.by[e].length}</b></span>`).join('');
    const warn = E.warnings(a, o);
    const pend = a.cs.filter((c) => !c.profile || c.profile.pendente);
    return head + `
      <div>
        <div class="dmg-top"><span class="f">Físico ${pct ?? '–'}%</span>${vpct ? `<span>Verdadeiro ${vpct}%</span>` : ''}<span class="m">Mágico ${mpct ?? '–'}%</span></div>
        <div class="dmg-bar"><i class="f" style="width:${pct ?? 50}%"></i><i class="v" style="width:${vpct}%"></i></div>
      </div>
      <dl class="traits">
        <dt>Linha de frente</dt><dd>${names(a.by.frente)}</dd>
        <dt>Engage</dt><dd>${names(a.by.engage)}</dd>
        <dt>Controle de grupo</dt><dd>${names(a.by.cc)}</dd>
        <dt>Curva de força</dt><dd><span class="curve"><i style="left:${50 + a.curve * 50}%"></i></span>${E.curveText(a.curve)}</dd>
      </dl>
      <div class="styles">${styles}</div>
      ${warn.length ? `<ul class="alerts">${warn.map((w) => `<li>${w}</li>`).join('')}</ul>` : ''}
      ${pend.length ? `<p class="wait">Ficha pendente: ${pend.map((c) => esc(c.name)).join(', ')}.</p>` : ''}`;
  }
  function renderComp(d) {
    const mine = d.mySide, theirs = other(mine);
    const an = (side) => E.analyze(lockedNames(d, side).map((n) => CHAMPS.find((c) => c.name === n)).filter(Boolean));
    const A = an(mine), O = an(theirs);
    $('compBox').hidden = !(A.n || O.n);
    setHTML($('compA'), compHTML(A, O, true, mine));
    setHTML($('compE'), compHTML(O, A, false, theirs));
  }

  function render() {
    const s = SNAP, d = s?.session;
    status(s);
    $('stop').hidden = s?.source !== 'replay';
    $('record').checked = !!s?.record;
    $('updated').textContent = s?.updatedAt ? `Atualizado às ${new Date(s.updatedAt).toLocaleTimeString('pt-BR')}` : '';
    $('board').hidden = !d;
    $('empty').hidden = !!d;
    if (!d) {
      $('sugBox').hidden = true; $('compBox').hidden = true;
      $('emptyTitle').textContent = s?.status === 'conectado' ? 'Cliente conectado. Esperando o champ select' : 'Esperando o champ select';
      return;
    }
    const mine = d.mySide, theirs = other(mine);
    renderTeam($('teamA'), d, mine, true);
    renderTeam($('teamE'), d, theirs, false);
    banRow($('bansA'), d, mine);
    banRow($('bansE'), d, theirs);

    const cur = d.current;
    $('phase').textContent = d.timer.phaseLabel || '';
    const turn = $('turn'), bar = document.querySelector('.clock-bar');
    if (cur) {
      const actor = findPlayer(d, cur.cellId);
      const ally = cur.side === mine;
      turn.textContent = actor?.isMe
        ? `Sua vez de ${cur.type === 'ban' ? 'banir' : 'escolher'}`
        : `${ally ? (actor ? actor.label : 'Seu time') : 'Inimigo'} ${cur.type === 'ban' ? 'banindo' : 'escolhendo'}`;
      turn.className = 'turn ' + (ally ? 'ally' : 'enemy');
      bar.className = 'clock-bar ' + (ally ? 'ally' : 'enemy');
    } else {
      turn.textContent = d.done ? 'Draft completo' : d.timer.phase === 'PLANNING' ? 'Declare o seu campeão' : 'Aguardando';
      turn.className = 'turn';
      bar.className = 'clock-bar';
    }
    renderSuggest(d);
    renderComp(d);
  }

  // Timer suave, calculado pelo relógio local a partir do fim da fase informado pelo cliente.
  function tick() {
    const t = SNAP?.session?.timer;
    if (t?.endsAt && t.total) {
      const left = Math.max(0, t.endsAt - Date.now());
      $('timerFill').style.width = `${(left / t.total) * 100}%`;
      $('timeLeft').textContent = `${Math.ceil(left / 1000)}s`;
    } else { $('timerFill').style.width = '0'; $('timeLeft').textContent = ''; }
    requestAnimationFrame(tick);
  }

  // ---------- Controles ----------
  async function loadRecordings() {
    const list = await api('/api/lcu/gravacoes').catch(() => []);
    const sel = $('rec'), prev = sel.value;
    sel.innerHTML = list.length ? list.map((f) => `<option value="${esc(f)}">${esc(f.replace(/\.jsonl$/, '').replace(/^draft_/, '').replace('exemplo_torneio', 'Exemplo: draft de torneio'))}</option>`).join('') : '<option value="">Nenhuma gravação</option>';
    if (list.includes(prev)) sel.value = prev;
    $('play').disabled = !list.length;
  }
  $('play').onclick = async () => {
    showView('live');
    try { msg(''); await api('/api/lcu/replay', { method: 'POST', body: JSON.stringify({ arquivo: $('rec').value, velocidade: Number($('speed').value) }) }); }
    catch (err) { msg(err.message, 'err'); }
  };
  $('stop').onclick = () => api('/api/lcu/replay/parar', { method: 'POST' }).catch((err) => msg(err.message, 'err'));
  $('record').onchange = (e) => api('/api/lcu/gravar', { method: 'POST', body: JSON.stringify({ ligado: e.target.checked }) }).catch((err) => msg(err.message, 'err'));

  // ---------- Estatísticas de soloQ ----------
  const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
  function sourceText() {
    if (!SOLO?.matches) return 'Sugestões pelas fichas dos campeões. Ative as estatísticas de soloQ para ver win rates e matchups.';
    const pts = SOLO.patches?.length > 1 ? `dos patches ${SOLO.patches.join(' e ')}` : `do patch ${SOLO.patch}`;
    return `Estatísticas de ${fmt(SOLO.matches)} ranqueadas ${SOLO_ST?.eloNome || ''} ${pts}`.replace(/\s+/g, ' ');
  }
  async function loadSoloq() {
    try { SOLO = await api('/api/soloq'); } catch { SOLO = null; }
    STATS = SOLO?.champions || {}; LANE = SOLO?.lane || null; DUO = SOLO?.duo || null;
    // Rotas: as do arquivo de rotas mais as que o campeão joga de verdade na soloQ (10% ou mais dos jogos).
    for (const c of CHAMPS) {
      c.baseRoles ??= c.roles || '';
      const extra = Object.entries(STATS[c.name]?.roles || {}).filter(([, x]) => x.share >= 10).map(([r]) => r);
      c.roles = [...new Set([...c.baseRoles, ...extra])].join('');
    }
    renderSolo();
    document.dispatchEvent(new CustomEvent('dl:stats'));
  }
  function renderSolo() {
    $('source').textContent = sourceText();
    const st = SOLO_ST, el = $('soloStatus');
    const n = SOLO?.patchMatches ?? st?.matches ?? 0;
    $('gearBtn').classList.toggle('warn', !!st?.error);
    $('gearBtn').title = st?.error ? st.error : n ? `${fmt(n)} partidas de soloQ coletadas` : '';
    if (!st) { el.textContent = ''; return; }
    const lines = [];
    if (st.error) lines.push(`<span class="err">${esc(st.error)}</span>`);
    if (st.patch) lines.push(`<b>${fmt(st.matches)}</b> ranqueadas ${esc(st.eloNome)} do patch ${esc(st.patch)}`);
    if (st.prevMatches && st.matches < 1500) lines.push(`Enquanto o patch atual tem menos de 1.500 partidas, as ${fmt(st.prevMatches)} do patch anterior também entram.`);
    if (st.running) lines.push(`<span class="live"></span>${esc(st.phase || 'Coletando')}${st.perMinute != null ? `, ${st.perMinute} partidas por minuto` : ''}`);
    else if (!st.error) lines.push('Coleta parada.');
    el.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
  }
  async function loadConfig() {
    const c = await api('/api/config');
    $('platform').innerHTML = Object.entries(c.platforms).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('elo').innerHTML = Object.entries(c.elos).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('platform').value = c.platform; $('elo').value = c.elo; $('coleta').checked = c.coleta;
    $('key').placeholder = c.hasKey ? 'Chave salva (cole outra para trocar)' : 'RGAPI-…';
    $('gearBtn').classList.toggle('warn', !c.hasKey);
    if (!c.hasKey) $('gearBtn').title = 'Falta a chave da Riot';
  }
  $('saveCfg').onclick = async () => {
    const b = { platform: $('platform').value, elo: $('elo').value, coleta: $('coleta').checked };
    if ($('key').value.trim()) b.key = $('key').value.trim();
    try {
      const c = await api('/api/config', { method: 'PUT', body: JSON.stringify(b) });
      $('key').value = '';
      $('cfgMsg').className = 'note ok';
      $('cfgMsg').textContent = c.hasKey ? (c.coleta ? 'Salvo. A coleta começa em alguns segundos.' : 'Salvo. Coleta desligada.') : 'Salvo. Falta a chave da Riot para coletar.';
      $('key').placeholder = c.hasKey ? 'Chave salva (cole outra para trocar)' : 'RGAPI-…';
      setTimeout(loadSoloq, 1500);
    } catch (err) { $('cfgMsg').className = 'note err'; $('cfgMsg').textContent = err.message; }
  };
  $('tryReplay').onclick = async () => {
    showView('live');
    const ex = [...$('rec').options].find((o) => o.value.startsWith('exemplo'));
    if (ex) $('rec').value = ex.value;
    $('play').click();
  };

  // ---------- Canal ao vivo ----------
  let lastSaved = null, lastSoloLoad = 0, soloAtLoad = 0;
  function listen() {
    const es = new EventSource(window.DLKey.stream());
    es.addEventListener('lcu', (e) => {
      SNAP = JSON.parse(e.data);
      if (SNAP.lastSaved !== lastSaved) { lastSaved = SNAP.lastSaved; loadRecordings(); }
      render();
      document.dispatchEvent(new CustomEvent('dl:lcu'));
    });
    es.addEventListener('soloq', (e) => {
      SOLO_ST = JSON.parse(e.data);
      renderSolo();
      // Recarrega as estatísticas a cada minuto durante a coleta (ou logo, quando ainda são poucas).
      const grew = SOLO_ST.matches - soloAtLoad;
      if (grew > 0 && (Date.now() - lastSoloLoad > 60000 || (soloAtLoad < 200 && grew >= 25))) {
        lastSoloLoad = Date.now(); soloAtLoad = SOLO_ST.matches;
        loadSoloq().then(render);
      }
    });
    // Partida nova no histórico (busca automática depois do fim da partida)
    es.addEventListener('partidas', (e) => document.dispatchEvent(new CustomEvent('dl:partidas', { detail: JSON.parse(e.data) })));
    es.onopen = () => window.DLKey.ok();
    es.onerror = () => { if (!window.DLKey.renew()) status(null); }; // o navegador tenta de novo sozinho; se o app religou, a tela recarrega com a chave nova
  }

  async function loadData() {
    try {
      const c = await api('/api/champions');
      CHAMPS = c.champions; BYKEY = {};
      for (const x of CHAMPS) if (x.key) BYKEY[String(x.key)] = x;
      REL = E.relations(CHAMPS, c.adc, c.sup, c.top, c.mid, c.jg);
      $('patch').textContent = c.version ? 'Patch ' + c.version.split('.').slice(0, 2).join('.') : '';
      document.dispatchEvent(new CustomEvent('dl:champs'));
    } catch { msg('Não consegui carregar a lista de campeões.', 'err'); }
  }

  // ---------- Abas ----------
  // Telas sem aba própria acendem a aba "mãe" (detalhe de campeão → Campeões)
  const PARENT = { champ: 'champs', lolcfg: 'settings' };
  function showView(v) {
    const tabV = PARENT[v] || v;
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-current', t.dataset.view === tabV ? 'page' : 'false');
    $('gearBtn').setAttribute('aria-pressed', String(tabV === 'settings'));
    for (const el of document.querySelectorAll('.view')) el.hidden = el.id !== 'view-' + v;
    if (!['player', 'champ'].includes(v)) try { localStorage.setItem('dl-view', v); } catch { /* sem armazenamento */ }
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('dl:view', { detail: v }));
  }
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => showView(t.dataset.view);
  // Engrenagem: abre e fecha as configurações (fechar volta para a última tela)
  let beforeSettings = 'live';
  $('gearBtn').onclick = () => {
    const open = !$('view-settings').hidden || !$('view-lolcfg').hidden;
    if (open) return showView(beforeSettings);
    beforeSettings = [...document.querySelectorAll('.view')].find((el) => !el.hidden)?.id.replace('view-', '') || 'live';
    showView('settings');
  };
  $('openLolCfg').onclick = () => showView('lolcfg');
  $('lolBack').onclick = () => showView('settings');
  // Começou um champ select: volta para o draft ao vivo
  let hadSession = false;
  document.addEventListener('dl:lcu', () => {
    const has = !!SNAP?.session;
    if (has && !hadSession && SNAP.source === 'cliente') showView('live');
    hadSession = has;
  });

  // InHouse (inhouse.js): o mesmo painel de sugestões e composição, para um draft montado a partir da sala.
  function analiseInhouse(d, { tituloA = null, tituloE = null } = {}) {
    const s = suggestions(d, null);
    const mine = d.mySide, theirs = other(mine);
    const an = (side) => E.analyze(lockedNames(d, side).map((n) => CHAMPS.find((c) => c.name === n)).filter(Boolean));
    const A = an(mine), O = an(theirs);
    return {
      sug: s && { title: s.title, sub: s.sub, kind: s.kind, html: CHAMPS.length ? oneList(s.groups) : '<p class="empty-col">Lista de campeões indisponível.</p>' },
      compA: compHTML(A, O, true, mine, tituloA),
      compE: compHTML(O, A, false, theirs, tituloE),
    };
  }

  // O que as outras telas (you.js) usam daqui
  window.DL = {
    analiseInhouse,
    api, esc, fmt, champ, nameOf, compHTML,
    get CHAMPS() { return CHAMPS; }, get REL() { return REL; }, get snap() { return SNAP; },
    get stats() { return { stats: STATS, lane: LANE, duo: DUO, solo: SOLO, soloStatus: SOLO_ST }; },
    showView,
  };


  (async () => {
    let v = 'live';
    try { v = localStorage.getItem('dl-view') || 'live'; } catch { /* sem armazenamento */ }
    showView(document.getElementById('view-' + v) ? v : 'live');
    await loadData();
    await loadSoloq();
    soloAtLoad = SOLO?.patchMatches || 0; lastSoloLoad = Date.now();
    await Promise.all([loadRecordings(), loadConfig().catch(() => {})]);
    listen();
    requestAnimationFrame(tick);
  })();
})();
