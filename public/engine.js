// Draft Lab — motor de leitura do draft
// Junta as fichas dos campeões com as estatísticas de soloQ (win rate, matchups e duplas).
// Não mexe na tela: recebe campeões, fichas e estatísticas e devolve as contas.
window.DraftEngine = (() => {
  const ROLES = ['T', 'J', 'M', 'A', 'S'];
  const ROLE_NAME = { T: 'Top', J: 'Jungle', M: 'Mid', A: 'ADC', S: 'Suporte' };
  const ESTILOS = ['frente', 'engage', 'desengage', 'poke', 'pick', 'dive', 'peel', 'split', 'teamfight', 'cc'];
  const ESTILO_NOME = { frente: 'Linha de frente', engage: 'Engage', desengage: 'Desengage', poke: 'Poke', pick: 'Pick', dive: 'Dive', peel: 'Peel', split: 'Split push', teamfight: 'Teamfight', cc: 'Controle de grupo' };
  const CURVA_N = { inicio: -1, meio: 0, fim: 1 };

  // Quem perde para quem e quem combina com quem, a partir das fichas.
  // adc (opcional): regras de counterpick da rota de ADC por classe, vindas de data/adc.json.
  // sup (opcional): regras de counterpick da rota de suporte, vindas de data/suporte.json.
  function relations(champs, adc = null, sup = null, top = null, mid = null, jg = null) {
    const loses = {}, syn = {}, classOf = {}, dmg = {}, supOf = {}, topOf = {}, midOf = {}, jgOf = {}, roles = {};
    for (const c of champs) { loses[c.name] = new Set(c.profile?.perde_para || []); syn[c.name] ||= new Set(); }
    for (const c of champs) for (const o of c.profile?.sinergia || []) { syn[c.name].add(o); (syn[o] ||= new Set()).add(c.name); }
    for (const c of champs) { if (c.adc) classOf[c.name] = c.adc; if (c.sup) supOf[c.name] = c.sup; if (c.top) topOf[c.name] = c.top; if (c.mid) midOf[c.name] = c.mid; if (c.jg) jgOf[c.name] = c.jg; roles[c.name] = c.roles || ''; const d = dmgOf(c); if (d) dmg[c.name] = d; }
    const rules = adc && adc.tabela ? { ...adc, classOf } : null;
    const supRules = sup && sup.tabela ? { ...sup, classOf: supOf } : null;
    const topRules = top && top.tabela ? { ...top, classOf: topOf } : null;
    const midRules = mid && mid.tabela ? { ...mid, classOf: midOf } : null;
    const jgRules = jg && jg.tabela ? { ...jg, classOf: jgOf } : null;
    return { loses, syn, adc: rules, sup: supRules, top: topRules, mid: midRules, jg: jgRules, dmg, roles, beats: (a, b) => !!loses[b]?.has(a) }; // beats(a, b): a é bom contra b
  }

  // ---------- Counterpicks de suporte por classe (data/suporte.json) ----------
  // Ordem: exceção do próprio campeão (contra campeão, grupo ou classe) → exceção do inimigo, ao contrário → tabela.
  // S: regras de uma rota (rel.sup ou rel.top).
  function classVs(S, name, foe) {
    const mine = S?.classOf[name], theirs = S?.classOf[foe];
    if (!mine || !theirs) return null;
    const inGroup = (g, n) => !!S.grupos[g]?.includes(n);
    const rank = (e, target, cls) => (e.tipo === 'campeao' ? (e.contra === target ? 3 : 0) : e.tipo === 'grupo' ? (inGroup(e.contra, target) ? 2 : 0) : e.contra === cls ? 1 : 0);
    const best = (who, target, cls) => {
      let pick = null, r = 0;
      for (const e of S.excecoes) if (e.campeao === who) { const k = rank(e, target, cls); if (k > r) { r = k; pick = e; } }
      return pick;
    };
    const own = best(name, foe, theirs);
    if (own) return { v: own.valor, mine, theirs, tag: 'exceção' };
    const rev = best(foe, name, mine);
    if (rev) return { v: -rev.valor, mine, theirs, tag: 'exceção' };
    return { v: S.tabela[mine]?.[theirs] ?? 0, mine, theirs, tag: '' };
  }
  const supVs = (rel, name, foe) => classVs(rel.sup, name, foe);
  const topVs = (rel, name, foe) => classVs(rel.top, name, foe);
  const midVs = (rel, name, foe) => classVs(rel.mid, name, foe);
  const jgVs = (rel, name, foe) => classVs(rel.jg, name, foe);
  // Quem é o suporte (ou o ADC) de um time: pela rota, quando conhecida; senão, quem tem a classe e joga mais na rota.
  function pickRole(rel, names, classOf, role, roleOf) {
    const withClass = names.filter((n) => classOf[n]);
    const known = withClass.filter((n) => roleOf?.(n) === role);
    if (known.length) return known;
    const free = withClass.filter((n) => !roleOf?.(n) || roleOf(n) === role);
    const main = free.filter((n) => (rel.roles?.[n] || '')[0] === role);
    return free.length > 1 && main.length ? main : free;
  }
  // Leitura de suporte do campeão c: confronto com o suporte inimigo e a dupla com o ADC do time.
  //   supOpen/adcOpen: a rota está em aberto (true/false) ou leitura avulsa (null)
  function supRead(rel, c, { allies, foes, roleOf, supOpen = null, adcOpen = null }) {
    const S = rel.sup;
    if (!S) return null;
    const mine = S.classOf[c.name] || null;
    const adcOf = rel.adc?.classOf || {};
    const out = { classe: mine, vs: [], value: 0, duo: [], note: '' };
    if (mine && supOpen !== false) {
      out.vs = pickRole(rel, foes, S.classOf, 'S', roleOf).map((f) => ({ foe: f, me: c.name, ...supVs(rel, c.name, f) }));
      out.value = out.vs.length ? out.vs.reduce((s, x) => s + x.v, 0) / out.vs.length : 0;
      out.note = S.notas[mine] || '';
      for (const a of pickRole(rel, allies.filter((n) => n !== c.name), adcOf, 'A', roleOf))
        if (S.sinergia[mine]?.includes(adcOf[a])) out.duo.push({ ally: a, v: 1, txt: `${mine} + ${adcOf[a]}` });
    }
    if (adcOf[c.name] && adcOpen !== false)
      for (const s of pickRole(rel, allies.filter((n) => n !== c.name), S.classOf, 'S', roleOf))
        if (S.sinergia[S.classOf[s]]?.includes(adcOf[c.name])) out.duo.push({ ally: s, v: 1, txt: `${adcOf[c.name]} + ${S.classOf[s]}` });
    for (const [a, b] of S.duplas) {
      const other = c.name === a ? b : c.name === b ? a : null;
      if (other && allies.includes(other)) out.duo.push({ ally: other, v: -2, txt: `dupla ruim com ${other}` });
    }
    if (!mine && !out.duo.length) return null;
    out.total = out.value + out.duo.reduce((s, d) => s + d.v, 0);
    return out;
  }
  const supWhy = (a) => {
    if (!a) return '';
    const v = a.vs.map((x) => (x.tag === 'exceção' ? `${x.me} x ${x.foe} (exceção)` : `${x.mine} x ${x.theirs}`));
    return [...new Set(v)].concat(a.duo.map((d) => d.txt), a.note && a.vs.length ? [a.note] : []).join(', ');
  };
  // Rotas solo por classe (topo: data/topo.json, meio: data/meio.json, selva: data/selva.json): confronto com o adversário da rota. Sem dupla.
  function soloRead(rules, role, rel, c, { foes, roleOf, open = null }) {
    const mine = rules?.classOf[c.name];
    if (!mine || open === false) return null;
    const vs = pickRole(rel, foes, rules.classOf, role, roleOf).map((f) => ({ foe: f, me: c.name, ...classVs(rules, c.name, f) }));
    const value = vs.length ? vs.reduce((s, x) => s + x.v, 0) / vs.length : 0;
    return { classe: mine, vs, value, total: value, note: rules.notas?.[mine] || '' };
  }
  const topRead = (rel, c, { foes, roleOf, topOpen = null }) => soloRead(rel.top, 'T', rel, c, { foes, roleOf, open: topOpen });
  const midRead = (rel, c, { foes, roleOf, midOpen = null }) => soloRead(rel.mid, 'M', rel, c, { foes, roleOf, open: midOpen });
  const jgRead = (rel, c, { foes, roleOf, jgOpen = null }) => soloRead(rel.jg, 'J', rel, c, { foes, roleOf, open: jgOpen });
  const soloWhy = (a) => {
    if (!a || !a.vs.length) return '';
    const v = a.vs.map((x) => (x.tag === 'exceção' ? `${x.me} x ${x.foe} (exceção)` : `${x.mine} x ${x.theirs}`));
    return [...new Set(v)].concat(a.note ? [a.note] : []).join(', ');
  };
  const topWhy = soloWhy, midWhy = soloWhy, jgWhy = soloWhy;


  // ---------- Counterpicks de ADC por classe ----------
  // Quanto o ADC c rende contra o ADC inimigo, pela classe e pelas prioridades de data/adc.json.
  // Devolve null quando não se aplica (c não é ADC com classe ou não há ADC inimigo com classe).
  function adcVs(rel, name, foe) {
    const A = rel.adc;
    const mine = A?.classOf[name], theirs = A?.classOf[foe];
    if (!mine || !theirs) return null;
    let v = A.tabela[mine]?.[theirs] ?? 0;
    const pr = A.prioridades[`${mine} x ${theirs}`];
    let tag = '';
    if (pr?.priorize?.includes(name)) { v = Math.max(v + 1, 1.5); tag = 'prioridade'; }
    else if (pr?.evite?.includes(name)) { v -= 1; tag = 'evitar'; }
    return { v, mine, theirs, tag };
  }
  // O ADC inimigo: quem tem classe de ADC e, se a rota for conhecida, está no bot.
  function enemyAdcs(rel, foes, roleOf) {
    const A = rel.adc;
    if (!A) return [];
    const withClass = foes.filter((f) => A.classOf[f]);
    const known = withClass.filter((f) => roleOf?.(f) === 'A');
    if (known.length) return known;
    return withClass.filter((f) => !roleOf?.(f) || roleOf(f) === 'A');
  }
  // Leitura completa da rota de ADC para o campeão c.
  //   adcOpen: o time ainda precisa de ADC (liga a regra de dano do time)
  function adcRead(rel, c, { allies, foes, roleOf, adcOpen }) {
    const A = rel.adc;
    const mine = A?.classOf[c.name];
    if (!mine) return null;
    const vs = enemyAdcs(rel, foes, roleOf).map((f) => ({ foe: f, ...adcVs(rel, c.name, f) }));
    const value = vs.length ? vs.reduce((s, x) => s + x.v, 0) / vs.length : 0;
    // Dano do time: falta físico → ADCs de dano AD; time quase todo físico → Mage Bot.
    let need = 0, needTxt = '';
    if (adcOpen) {
      const ds = allies.map((n) => rel.dmg[n]).filter(Boolean);
      if (ds.length >= 2) {
        const phys = (ds.reduce((s, d) => s + d.f, 0) / ds.length) * 100;
        const mage = mine === A.magica;
        if (phys < A.dano.pouco_fisico) { need = mage ? -1 : 1; needTxt = 'o time precisa de dano físico'; }
        else if (phys >= A.dano.muito_fisico && mage) { need = 1.5; needTxt = 'time quase todo físico: equilibra o dano'; }
      }
    }
    return { classe: mine, vs, value, need, needTxt, total: value + need };
  }


  // Distribui os campeões pelas rotas (respeitando flex picks) e devolve as rotas que sobraram.
  // roleSets: uma string de rotas por campeão escolhido, por exemplo ['TJ', 'M'].
  function openRoles(roleSets) {
    let best = { n: -1, used: new Set() };
    const used = new Set();
    (function dfs(i, n) {
      if (best.n === roleSets.length) return;
      if (i === roleSets.length) { if (n > best.n) best = { n, used: new Set(used) }; return; }
      for (const r of roleSets[i]) if (!used.has(r)) { used.add(r); dfs(i + 1, n + 1); used.delete(r); }
      dfs(i + 1, n);
    })(0, 0);
    return ROLES.filter((r) => !best.used.has(r));
  }
  const fits = (c, open) => open && [...c.roles].some((r) => open.includes(r));

  // ---------- Regras das sugestões ----------
  // Com estatísticas de soloQ:
  //  - um campeão só aparece nas sugestões com pelo menos MIN_GAMES jogos na rota (ou no total, se a rota não é conhecida);
  //  - forte = mais de STRONG% de vitória na situação; pior escolha = menos de WEAK%;
  //  - "situação" = o confronto direto contra aquele campeão (ou a dupla, para sinergia) quando há
  //    pelo menos MIN_PAIR jogos dele; senão, o win rate do campeão na rota;
  //  - o histórico das fichas (Poppy forte contra Riven, por exemplo) dá prioridade na ordem,
  //    mas o campeão ainda precisa passar pelos números.
  //  - counterpicks de ADC por classe (data/adc.json): valem como histórico quando não há jogos do confronto
  //    direto, e a vantagem da classe (e do dano do time) entra na ordem com ADC_W pontos por ponto da tabela.
  // Sem estatísticas, valem só as fichas.
  const RULES = { MIN_GAMES: 50, MIN_PAIR: 30, STRONG: 53, WEAK: 45, HIST: 3, ADC_W: 1.5 };
  const pctOf = (x) => Math.round((x.w / x.g) * 1000) / 10;

  // Leitura de um campeão contra o draft atual. Também serve para analisar um hover.
  //   roleOf(nome) (opcional): rota de um campeão já escolhido; adcOpen: o time ainda precisa de ADC (null = leitura avulsa)
  function rate(c, { rel, allies, foes, stats = {}, hasStats = Object.keys(stats).length > 0, lane = null, duo = null, role = null, roleOf = null, adcOpen = null, supOpen = null, topOpen = null, midOpen = null, jgOpen = null }) {
    const good = [], bad = [], syn = [], nums = {}, hist = new Set();
    let vs = null;    // confronto direto com mais jogos
    for (const e of foes) {
      const m = lane?.[c.name]?.[e];
      if (m && m.g >= RULES.MIN_PAIR) {
        const wr = pctOf(m);
        nums[e] = { wr: Math.round(wr), g: m.g };
        if (!vs || m.g > vs.g) vs = { name: e, wr, g: m.g };
        if (wr > RULES.STRONG) good.push(e); else if (wr < RULES.WEAK) bad.push(e);
        continue; // há jogos suficientes: os números decidem este confronto
      }
      if (rel.beats(c.name, e)) { good.push(e); hist.add(e); }
      if (rel.beats(e, c.name)) { bad.push(e); hist.add(e); }
    }
    // Counterpick de ADC por classe: sem jogos do confronto direto, a classe vale como histórico.
    const adc = adcOpen === false ? null : adcRead(rel, c, { allies, foes, roleOf, adcOpen: !!adcOpen });
    if (adc) for (const x of adc.vs) {
      if (nums[x.foe]) continue; // os números do confronto direto já decidiram
      if (x.v >= 1.5 && !good.includes(x.foe)) { good.push(x.foe); hist.add(x.foe); }
      if (x.v <= -1.5 && !bad.includes(x.foe)) { bad.push(x.foe); hist.add(x.foe); }
    }
    // Suporte por classe: igual ao ADC (sem jogos do confronto direto, a classe vale como histórico),
    // mais a dupla do bot: classes que combinam viram "combina com"; duplas ruins, "combina mal".
    const sup = supRead(rel, c, { allies, foes, roleOf, supOpen, adcOpen });
    const anti = [];
    if (sup) {
      for (const x of sup.vs) {
        if (nums[x.foe]) continue;
        if (x.v >= 1.5 && !good.includes(x.foe)) { good.push(x.foe); hist.add(x.foe); }
        if (x.v <= -1.5 && !bad.includes(x.foe)) { bad.push(x.foe); hist.add(x.foe); }
      }
      for (const d of sup.duo) if (d.v < 0 && !anti.includes(d.ally)) anti.push(d.ally);
    }
    // Topo por classe: igual ao ADC e ao suporte (sem jogos do confronto direto, a classe vale como histórico).
    const top = topRead(rel, c, { foes, roleOf, topOpen });
    if (top) for (const x of top.vs) {
      if (nums[x.foe]) continue;
      if (x.v >= 1.5 && !good.includes(x.foe)) { good.push(x.foe); hist.add(x.foe); }
      if (x.v <= -1.5 && !bad.includes(x.foe)) { bad.push(x.foe); hist.add(x.foe); }
    }
    // Meio por classe: igual ao topo.
    const mid = midRead(rel, c, { foes, roleOf, midOpen });
    if (mid) for (const x of mid.vs) {
      if (nums[x.foe]) continue;
      if (x.v >= 1.5 && !good.includes(x.foe)) { good.push(x.foe); hist.add(x.foe); }
      if (x.v <= -1.5 && !bad.includes(x.foe)) { bad.push(x.foe); hist.add(x.foe); }
    }
    // Selva por classe: igual ao topo e ao meio.
    const jg = jgRead(rel, c, { foes, roleOf, jgOpen });
    if (jg) for (const x of jg.vs) {
      if (nums[x.foe]) continue;
      if (x.v >= 1.5 && !good.includes(x.foe)) { good.push(x.foe); hist.add(x.foe); }
      if (x.v <= -1.5 && !bad.includes(x.foe)) { bad.push(x.foe); hist.add(x.foe); }
    }
    const adcBonus = (adc ? adc.total * RULES.ADC_W : 0) + (sup ? sup.total * RULES.ADC_W : 0) + (top ? top.total * RULES.ADC_W : 0) + (mid ? mid.total * RULES.ADC_W : 0) + (jg ? jg.total * RULES.ADC_W : 0);
    const supDuo = new Set((sup?.duo || []).filter((d) => d.v > 0).map((d) => d.ally));
    let duoBest = null; // dupla com mais jogos
    for (const a of allies) {
      if (a === c.name) continue;
      const d = duo?.[c.name]?.[a];
      if (d && d.g >= RULES.MIN_PAIR) {
        const wr = pctOf(d);
        if (!duoBest || d.g > duoBest.g) duoBest = { name: a, wr, g: d.g };
        if (wr > RULES.STRONG) { syn.push(a); nums[a] = { wr: Math.round(wr), g: d.g }; }
        continue;
      }
      if (rel.syn[c.name]?.has(a) || supDuo.has(a)) { syn.push(a); hist.add(a); }
    }
    const st = stats[c.name];
    const rr = role ? st?.roles?.[role] : null;
    const games = role ? rr?.g ?? 0 : st?.g ?? 0;
    const baseWr = role ? rr?.wr ?? null : st?.wr ?? null;
    const eligible = !hasStats || games >= RULES.MIN_GAMES;
    // Win rate na situação: confronto direto se houver jogos, senão o da rota
    const sit = vs ? { wr: vs.wr, g: vs.g, vs: vs.name } : baseWr != null ? { wr: baseWr, g: games, vs: null } : null;
    const synWr = duoBest ? { wr: duoBest.wr, g: duoBest.g, with: duoBest.name } : sit;
    const histGood = good.filter((n) => hist.has(n)).length, histBad = bad.filter((n) => hist.has(n)).length, histSyn = syn.filter((n) => hist.has(n)).length;
    return {
      c, good, bad, syn, anti, nums, hist, eligible, games, sit, synWr, adc, sup, top, mid, jg,
      wr: baseWr, meta: st?.pr ?? 0, roleStats: !!role && !!rr,
      // Ordem: win rate na situação, com bônus de RULES.HIST pontos para cada confronto histórico das fichas
      strongScore: (sit?.wr ?? 50) + RULES.HIST * histGood + adcBonus,
      synScore: (synWr?.wr ?? 50) + RULES.HIST * histSyn - RULES.HIST * anti.length,
      weakScore: (sit?.wr ?? 50) - RULES.HIST * histBad + adcBonus,
      adcScore: (sit?.wr ?? 50) + adcBonus,
      fichaScore: good.length * 2 - bad.length * 2 + syn.length * 1.5 + adcBonus,
    };
  }

  function read({ champs, rel, allies, foes, open, isOut, stats = {}, lane = null, duo = null, role = null, roleOf = null }) {
    const hasStats = Object.keys(stats).length > 0;
    const adcOpen = !open.length || open.includes('A');
    const supOpen = !open.length || open.includes('S');
    const topOpen = !open.length || open.includes('T');
    const midOpen = !open.length || open.includes('M');
    const jgOpen = !open.length || open.includes('J');
    const rows = [];
    for (const c of champs) {
      if (isOut(c.name)) continue;
      if (open.length && !fits(c, open)) continue;
      rows.push(rate(c, { rel, allies, foes, stats, hasStats, lane, duo, role, roleOf, adcOpen, supOpen, topOpen, midOpen, jgOpen }));
    }
    return { allies, foes, open, rows, hasStats, byName: Object.fromEntries(rows.map((r) => [r.c.name, r])) };
  }

  // Os grupos de sugestão que aparecem na tela.  kind: 'pick' ou 'ban'; r: resultado de read()
  function groups(kind, r, { teamName = 'o adversário', names = (s) => s.join(', '), limit = 6 } = {}) {
    const out = [];
    const top = (arr, by, dir = -1) => arr.sort((a, b) => dir * (a[by] - b[by]) || b.games - a.games).slice(0, limit);
    // Rota de ADC em aberto: melhores escolhas pela classe do ADC inimigo e pelo dano do time.
    const adcGroup = (rows, by) => {
      if (kind !== 'pick' || (r.open.length && !r.open.includes('A'))) return;
      const list = rows.filter((x) => x.adc && (x.adc.vs.length || x.adc.need) && x.adc.total > 0);
      if (!list.length) return;
      const vs = [...new Set(list.flatMap((x) => x.adc.vs.map((v) => v.foe)))];
      out.push({ title: vs.length ? `ADC contra ${names(vs)}` : 'ADC para o dano do time', items: top(list, by), cls: 'good' });
    };
    // Rota de suporte em aberto: pela classe do suporte inimigo e pela dupla com o ADC.
    const jgGroup = (rows, by) => {
      if (kind !== 'pick' || (r.open.length && !r.open.includes('J'))) return;
      const list = rows.filter((x) => x.jg?.vs.length && x.jg.total > 0);
      if (!list.length) return;
      const vs = [...new Set(list.flatMap((x) => x.jg.vs.map((v) => v.foe)))];
      out.push({ title: `Selva contra ${names(vs)}`, items: top(list, by), cls: 'good' });
    };
    const midGroup = (rows, by) => {
      if (kind !== 'pick' || (r.open.length && !r.open.includes('M'))) return;
      const list = rows.filter((x) => x.mid?.vs.length && x.mid.total > 0);
      if (!list.length) return;
      const vs = [...new Set(list.flatMap((x) => x.mid.vs.map((v) => v.foe)))];
      out.push({ title: `Meio contra ${names(vs)}`, items: top(list, by), cls: 'good' });
    };
    const topGroup = (rows, by) => {
      if (kind !== 'pick' || (r.open.length && !r.open.includes('T'))) return;
      const list = rows.filter((x) => x.top?.vs.length && x.top.total > 0);
      if (!list.length) return;
      const vs = [...new Set(list.flatMap((x) => x.top.vs.map((v) => v.foe)))];
      out.push({ title: `Topo contra ${names(vs)}`, items: top(list, by), cls: 'good' });
    };
    const supGroup = (rows, by) => {
      if (kind !== 'pick' || (r.open.length && !r.open.includes('S'))) return;
      const list = rows.filter((x) => x.sup?.classe && (x.sup.vs.length || x.sup.duo.length) && x.sup.total > 0);
      if (!list.length) return;
      const vs = [...new Set(list.flatMap((x) => x.sup.vs.map((v) => v.foe)))];
      out.push({ title: vs.length ? `Suporte contra ${names(vs)}` : 'Suporte para a dupla do bot', items: top(list, by), cls: 'good' });
    };
    if (!r.hasStats) {
      // Sem estatísticas: só as fichas
      if (kind === 'ban') return [{ title: `Mais fortes para ${teamName}`, items: top(r.rows.filter((x) => x.good.length || x.syn.length), 'fichaScore'), cls: 'good' }];
      if (r.foes.length) out.push({ title: `Fortes contra ${names(r.foes)}`, items: top(r.rows.filter((x) => x.good.length && !x.bad.length), 'fichaScore'), cls: 'good' });
      adcGroup(r.rows, 'fichaScore');
      supGroup(r.rows, 'fichaScore');
      topGroup(r.rows, 'fichaScore');
      midGroup(r.rows, 'fichaScore');
      jgGroup(r.rows, 'fichaScore');
      if (r.allies.length) out.push({ title: `Combinam com ${names(r.allies)}`, items: top(r.rows.filter((x) => x.syn.length && !x.bad.length), 'fichaScore'), cls: 'syn' });
      if (r.foes.length) out.push({ title: `Evite: fracos contra ${names(r.foes)}`, items: top(r.rows.filter((x) => x.bad.length), 'fichaScore', 1), cls: 'bad' });
      return out;
    }
    const ok = r.rows.filter((x) => x.eligible && x.sit);
    const strong = (x) => x.sit.wr > RULES.STRONG;
    if (kind === 'ban') return [{ title: `Mais fortes para ${teamName}`, items: top(ok.filter((x) => strong(x) && !x.bad.length), 'strongScore'), cls: 'good' }];
    if (r.foes.length) out.push({ title: `Fortes contra ${names(r.foes)}`, items: top(ok.filter((x) => strong(x) && !x.bad.length && (x.good.length || !x.sit.vs)), 'strongScore'), cls: 'good' });
    // No grupo de ADC os números ainda mandam: fica de fora quem está abaixo de WEAK% na situação.
    adcGroup(ok.filter((x) => x.sit.wr >= RULES.WEAK), 'adcScore');
    supGroup(ok.filter((x) => x.sit.wr >= RULES.WEAK), 'adcScore');
    topGroup(ok.filter((x) => x.sit.wr >= RULES.WEAK), 'adcScore');
    midGroup(ok.filter((x) => x.sit.wr >= RULES.WEAK), 'adcScore');
    jgGroup(ok.filter((x) => x.sit.wr >= RULES.WEAK), 'adcScore');
    if (r.allies.length) out.push({ title: `Combinam com ${names(r.allies)}`, items: top(ok.filter((x) => x.syn.length && !x.bad.length && x.synWr.wr > RULES.STRONG), 'synScore'), cls: 'syn' });
    if (r.foes.length || r.allies.length) out.push({ title: r.foes.length ? `Evite: fracos contra ${names(r.foes)}` : 'Evite: piores escolhas agora', items: top(ok.filter((x) => x.sit.wr < RULES.WEAK), 'weakScore', 1), cls: 'bad' });
    if (!r.foes.length && !r.allies.length) {
      out.push({ title: 'Mais fortes no patch para as rotas em aberto', items: top(ok.filter(strong), 'strongScore'), cls: 'good' });
      out.push({ title: 'Evite: piores no patch', items: top(ok.filter((x) => x.sit.wr < RULES.WEAK), 'weakScore', 1), cls: 'bad' });
    }
    return out;
  }

  // Texto curto com os motivos de uma sugestão (usado nos testes e em telas simples).
  const withNums = (row, names) => names.map((n) => (row.nums?.[n] ? `${n} (${row.nums[n].wr}% em ${row.nums[n].g})` : n)).join(', ');
  const adcWhy = (a) => {
    if (!a) return '';
    const v = a.vs.map((x) => `${x.mine} x ${x.theirs}${x.tag === 'prioridade' ? ' (prioridade)' : x.tag === 'evitar' ? ' (evite)' : ''}`);
    return [...new Set(v)].concat(a.needTxt ? [a.needTxt] : []).join(', ');
  };
  const why = (row) => [
    adcWhy(row.adc),
    supWhy(row.sup),
    topWhy(row.top),
    midWhy(row.mid),
    jgWhy(row.jg),
    row.good.length ? 'bom contra ' + withNums(row, row.good) : '',
    row.syn.length ? 'combina com ' + withNums(row, row.syn) : '',
    row.bad.length ? 'perde para ' + withNums(row, row.bad) : '',
    row.anti?.length ? 'combina mal com ' + row.anti.join(', ') : '',
    row.sit ? `${row.sit.wr}% ${row.sit.vs ? 'contra ' + row.sit.vs : row.roleStats ? 'na rota' : 'de vitória'} em ${row.sit.g} jogos` : '',
  ].filter(Boolean).join('; ');

  // ---------- Nota do draft (0 a 10) ----------
  // Avalia um draft completo do ponto de vista do seu time. Soma, em pontos de win rate:
  //  1. a força de cada campeão na rota (win rate na rota - 50, só com MIN_GAMES jogos ou mais);
  //  2. os confrontos de rota (confronto direto com MIN_PAIR jogos ou mais; senão, a ficha vale ±HIST);
  //  3. as duplas de cada time (quanto a dupla ganha acima da média dos dois; senão, sinergia da ficha +1,5);
  //  4. os alertas de composição (-2 cada um no seu time, +2 cada um no time inimigo).
  // Os itens do inimigo entram com sinal trocado. Nota = 5 + total / 2, entre 0 e 10.
  // Win rates com poucos jogos são puxados para 50% (como se houvesse mais SHRINK jogos de 50%), para um
  // campeão com 60 jogos não pesar como um com 600.
  //   mine, enemy: [{ name, role }]; byName: { nome: campeão }
  function draftScore({ mine, enemy, byName, rel, stats = {}, lane = null, duo = null }) {
    const parts = [];
    const add = (value, text, kind) => { if (value) parts.push({ value: Math.round(value * 10) / 10, text, kind }); };
    const SHRINK = { role: 100, pair: 30, duo: 100 };
    // Nenhum item sozinho decide o draft: cada um tem um teto, em pontos de win rate.
    const CAP = { role: 5, lane: 6, duo: 3 };
    const cap = (v, k) => Math.max(-CAP[k], Math.min(CAP[k], v));
    const pull = (wr, g, k) => (wr * g + 50 * k) / (g + k);
    const roleWr = (p) => { const r = stats[p.name]?.roles?.[p.role]; return r && r.g >= RULES.MIN_GAMES ? { wr: r.wr, g: r.g } : null; };
    // 1. Força na rota
    for (const [team, sign] of [[mine, 1], [enemy, -1]]) for (const p of team) {
      const r = roleWr(p);
      if (r) add(sign * cap(pull(r.wr, r.g, SHRINK.role) - 50, 'role'), `${p.name} tem ${r.wr}% de vitória na rota em ${r.g} jogos`, sign > 0 ? 'mine' : 'enemy');
    }
    // 2. Confrontos de rota
    for (const p of mine) {
      const o = enemy.find((e) => e.role && e.role === p.role);
      if (!o) continue;
      const m = lane?.[p.name]?.[o.name];
      if (m && m.g >= RULES.MIN_PAIR) { const wr = Math.round((m.w / m.g) * 1000) / 10; add(cap(pull(wr, m.g, SHRINK.pair) - 50, 'lane'), `${p.name} contra ${o.name}: ${wr}% em ${m.g} jogos`, 'lane'); }
      else if (rel.beats(p.name, o.name)) add(RULES.HIST, `${p.name} é historicamente forte contra ${o.name}`, 'lane');
      else if (rel.beats(o.name, p.name)) add(-RULES.HIST, `${p.name} é historicamente fraco contra ${o.name}`, 'lane');
      else {
        // ADC contra ADC sem jogos do confronto: vale a classe (data/adc.json), só nos confrontos claros
        // Suporte contra suporte: a classe (data/suporte.json), com as exceções
        const a = p.role === 'A' ? adcVs(rel, p.name, o.name) : p.role === 'S' ? supVs(rel, p.name, o.name) : p.role === 'T' ? topVs(rel, p.name, o.name) : p.role === 'M' ? midVs(rel, p.name, o.name) : p.role === 'J' ? jgVs(rel, p.name, o.name) : null;
        if (a && a.v >= 1.5) add(RULES.HIST, `${p.name} (${a.mine}) é forte contra ${o.name} (${a.theirs})`, 'lane');
        else if (a && a.v <= -1.5) add(-RULES.HIST, `${p.name} (${a.mine}) é fraco contra ${o.name} (${a.theirs})`, 'lane');
      }
    }
    // 3. Duplas
    for (const [team, sign] of [[mine, 1], [enemy, -1]]) for (let i = 0; i < team.length; i++) for (let j = i + 1; j < team.length; j++) {
      const a = team[i], b = team[j], d = duo?.[a.name]?.[b.name];
      const wa = stats[a.name]?.wr, wb = stats[b.name]?.wr;
      if (d && d.g >= RULES.MIN_PAIR && wa != null && wb != null) {
        const wr = (d.w / d.g) * 100, extra = cap(pull(wr, d.g, SHRINK.duo) - (wa + wb) / 2, 'duo');
        if (Math.abs(extra) >= 1) add(sign * extra, `${a.name} e ${b.name} juntos: ${Math.round(wr)}% em ${d.g} jogos`, 'duo');
      } else if (rel.syn[a.name]?.has(b.name)) add(sign * 1.5, `${a.name} e ${b.name} combinam`, 'duo');
      else {
        // Dupla do bot sem jogos juntos: classes que combinam (data/suporte.json) e duplas ruins
        const bad = rel.sup?.duplas.some(([x, y]) => (x === a.name && y === b.name) || (x === b.name && y === a.name));
        const [s, t] = a.role === 'S' ? [a, b] : [b, a];
        const fit = s.role === 'S' && t.role === 'A' && rel.sup?.sinergia[rel.sup.classOf[s.name]]?.includes(rel.adc?.classOf[t.name]);
        if (bad) add(sign * -2, `${a.name} e ${b.name} combinam mal`, 'duo');
        else if (fit) add(sign * 1.5, `${s.name} (${rel.sup.classOf[s.name]}) e ${t.name} (${rel.adc.classOf[t.name]}) combinam no bot`, 'duo');
      }
    }
    // 4. Composição
    const an = (team) => analyze(team.map((p) => byName[p.name]).filter(Boolean));
    const A = an(mine), O = an(enemy);
    for (const w of warnings(A, O)) add(-2, `Seu time: ${w}`, 'comp');
    for (const w of warnings(O, A)) add(2, `Time inimigo: ${w}`, 'comp');
    const total = parts.reduce((s, x) => s + x.value, 0);
    const score = Math.max(0, Math.min(10, Math.round((5 + total / 2) * 10) / 10));
    parts.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
    return { score, total: Math.round(total * 10) / 10, parts };
  }

  // ---------- Composição ----------
  // Divide o dano em físico, verdadeiro e mágico (frações de 0 a 1).
  function dmgOf(c) {
    if (typeof c.profile?.ad === 'number') { const f = c.profile.ad / 100, v = (c.profile.vd || 0) / 100; return { f, v, m: Math.max(0, 1 - f - v) }; }
    if (c.info && c.info.attack + c.info.magic > 0) { const f = c.info.attack / (c.info.attack + c.info.magic); return { f, v: 0, m: 1 - f }; }
    return null;
  }
  // cs: objetos de campeão do time
  function analyze(cs) {
    const ds = cs.map(dmgOf).filter(Boolean);
    const avg = (k) => (ds.length ? ds.reduce((s, d) => s + d[k], 0) / ds.length : null);
    const by = {};
    for (const e of ESTILOS) by[e] = cs.filter((c) => c.profile?.estilo?.includes(e));
    const curve = cs.length ? cs.reduce((s, c) => s + (CURVA_N[c.profile?.curva] ?? 0), 0) / cs.length : 0;
    return { n: cs.length, phys: avg('f'), tru: avg('v'), mag: avg('m'), by, curve, cs };
  }
  // Porcentagens de dano já arredondadas para mostrar.
  function damage(a) {
    const pct = a.phys == null ? null : Math.round(a.phys * 100);
    const vpct = a.tru == null || pct == null ? 0 : Math.round((a.phys + a.tru) * 100) - pct;
    const mpct = pct == null ? null : Math.max(0, 100 - pct - vpct);
    return { pct, vpct, mpct };
  }
  const curveText = (curve) => (curve <= -0.35 ? 'Forte no início' : curve >= 0.35 ? 'Forte no fim de jogo' : 'Equilibrada');
  // Alertas de um time (a) olhando para o adversário (o).
  function warnings(a, o) {
    const { pct } = damage(a);
    const warn = [];
    if (pct != null && a.n >= 3 && pct >= 75) warn.push('Dano quase todo físico: o adversário pode montar armadura.');
    if (pct != null && a.n >= 3 && pct <= 25) warn.push('Dano quase todo mágico: o adversário pode montar resistência mágica.');
    if (a.n >= 3 && !a.by.frente.length) warn.push('Sem linha de frente.');
    if (a.n >= 4 && !a.by.engage.length && !a.by.pick.length) warn.push('Sem campeão para iniciar lutas.');
    if (o.by.engage.length >= 2 && a.n >= 3 && !a.by.desengage.length && !a.by.peel.length) warn.push('O adversário tem muito engage e este time não tem desengage nem peel.');
    if (o.by.dive.length >= 2 && a.n >= 3 && !a.by.peel.length) warn.push('O adversário tem dive e ninguém aqui protege os carregadores.');
    return warn;
  }

  return { jgVs, jgRead, midVs, midRead, topVs, topRead, topWhy, adcVs, adcRead, adcWhy, supVs, supRead, supWhy, RULES, ROLES, ROLE_NAME, ESTILOS, ESTILO_NOME, relations, openRoles, fits, read, rate, groups, why, draftScore, dmgOf, analyze, damage, curveText, warnings };
})();
