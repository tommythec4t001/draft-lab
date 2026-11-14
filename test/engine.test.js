// Teste do motor de leitura do draft (public/engine.js):  npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL('../public/engine.js', import.meta.url), 'utf8'), ctx);
const E = ctx.window.DraftEngine;
// O motor roda noutro contexto: compara pelo conteúdo.
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const names = (g) => g.items.map((x) => x.c.name);

const P = (perde_para = [], sinergia = [], extra = {}) => ({ ad: 50, estilo: [], curva: 'meio', perde_para, sinergia, ...extra });
const champs = [
  { name: 'Riven', roles: 'T', profile: P(['Poppy']) },
  { name: 'Poppy', roles: 'TJS', profile: P() },
  { name: 'Darius', roles: 'T', profile: P() },
  { name: 'Garen', roles: 'T', profile: P() },
  { name: 'Annie', roles: 'MST', profile: P() },
  { name: 'Teemo', roles: 'T', profile: P() },
  { name: 'Yorick', roles: 'T', profile: P() },
  { name: 'Vi', roles: 'J', profile: P([], ['Poppy']) },
];
const rel = E.relations(champs);
assert.ok(rel.beats('Poppy', 'Riven'), 'Poppy é historicamente forte contra Riven');

// Regras básicas
const { MIN_GAMES, MIN_PAIR, STRONG, WEAK } = E.RULES;
assert.equal(MIN_GAMES, 50); assert.equal(STRONG, 53); assert.equal(WEAK, 45);
same(E.openRoles(['MJ', 'J']), ['T', 'A', 'S']);

const role = (g, wr) => ({ g, wr, roles: { T: { g, wr, share: 90 } } });
const stats = {
  Poppy: role(400, 53.5),   // forte na rota e histórico contra Riven
  Darius: role(900, 54.2),  // forte na rota, sem histórico
  Garen: role(600, 51),     // perto de 50%: não aparece
  Annie: role(44, 60),      // poucos jogos no top: nunca aparece
  Teemo: role(300, 43),     // fraco
  Yorick: role(250, 41),    // mais fraco: vem antes em "Evite"
  Riven: role(800, 50),
};
const base = { champs, rel, allies: [], foes: ['Riven'], open: ['T'], isOut: (n) => n === 'Riven', stats, role: 'T' };
let r = E.read(base);
let [strong, avoid] = E.groups('pick', r);
same(names(strong), ['Poppy', 'Darius'], 'histórico na frente; Garen (51%) e Annie (44 jogos) ficam de fora');
same(names(avoid), ['Yorick', 'Teemo'], 'menor win rate primeiro');
assert.ok(!r.byName.Annie.eligible, 'Annie com 44 jogos no top não é considerada');

// Confronto direto com jogos suficientes decide no lugar da ficha
const lane = { Poppy: { Riven: { g: 60, w: 24 } }, Darius: { Riven: { g: MIN_PAIR, w: 18 } } };
r = E.read({ ...base, lane });
[strong, avoid] = E.groups('pick', r);
same(names(strong), ['Darius'], 'Darius 60% contra Riven; Poppy 40% contra Riven sai dos fortes');
same(r.byName.Poppy.bad, ['Riven']);
assert.equal(names(avoid)[0], 'Poppy', 'Poppy com 40% contra Riven vira a pior escolha');
assert.equal(r.byName.Darius.sit.vs, 'Riven');
assert.match(E.why(r.byName.Darius), /bom contra Riven \(60% em 30\)/);

// Sinergia: dupla com jogos suficientes acima de 53%
const r2 = E.read({ ...base, foes: [], allies: ['Vi'], isOut: () => false, duo: { Darius: { Vi: { g: 40, w: 24 } } } });
const syn = E.groups('pick', r2).find((g) => g.cls === 'syn');
same(names(syn), ['Darius', 'Poppy'], 'Darius tem 60% com Vi; Poppy combina com Vi pela ficha e tem 53,5% na rota');
const r3 = E.read({ ...base, foes: [], allies: ['Vi'], isOut: () => false, stats: { ...stats, Poppy: role(400, 52) } });
same(names(E.groups('pick', r3).find((g) => g.cls === 'syn')), [], 'com 52% a Poppy não passa de 53%, mesmo com a ficha');

// Sem estatísticas, valem só as fichas
const r4 = E.read({ ...base, stats: {} });
same(names(E.groups('pick', r4)[0]), ['Poppy']);

// Composição
const comp = E.analyze([{ name: 'A', profile: { ad: 100, estilo: ['engage'], curva: 'inicio' } }, { name: 'B', profile: { ad: 0, estilo: [], curva: 'fim' } }, { name: 'C', profile: { ad: 100, estilo: [], curva: 'meio' } }]);
assert.equal(E.damage(comp).pct, 67);
assert.ok(E.warnings(comp, E.analyze([])).includes('Sem linha de frente.'));

// Nota do draft
{
  const byName = Object.fromEntries(champs.map((c) => [c.name, c]));
  const mine = [{ name: 'Poppy', role: 'T' }, { name: 'Vi', role: 'J' }];
  const enemy = [{ name: 'Riven', role: 'T' }, { name: 'Yorick', role: 'J' }];
  const st = { ...stats, Vi: { wr: 50, g: 500, roles: { J: { g: 500, wr: 50 } } }, Yorick: { wr: 41, g: 250, roles: { J: { g: 250, wr: 41 } } } };
  const d = E.draftScore({ mine, enemy, byName, rel, stats: st });
  assert.ok(d.score > 5, 'Poppy forte contra Riven, Vi combina com Poppy, Yorick fraco na rota');
  assert.ok(d.parts.some((x) => /historicamente forte contra Riven/.test(x.text)));
  const inv = E.draftScore({ mine: enemy, enemy: mine, byName, rel, stats: st });
  assert.ok(Math.abs(d.score - 5 - (5 - inv.score)) < 0.11, 'trocar os lados espelha a nota');
  // Um item sozinho não passa do teto
  const huge = E.draftScore({ mine: [{ name: 'Poppy', role: 'T' }], enemy: [{ name: 'Riven', role: 'T' }], byName, rel, stats: st, lane: { Poppy: { Riven: { g: 5000, w: 4500 } } } });
  assert.equal(huge.parts.find((x) => /contra Riven/.test(x.text)).value, 6);
  const empty = E.draftScore({ mine: [], enemy: [], byName, rel });
  assert.equal(empty.score, 5);
}

// ---------- Counterpicks de ADC por classe (data/adc.json) ----------
{
  const raw = JSON.parse(readFileSync(new URL('../data/adc.json', import.meta.url), 'utf8'));
  const classOf = {};
  for (const [cls, list] of Object.entries(raw.classes)) for (const n of list) classOf[n] = cls;
  const ADC = { tabela: raw.tabela, prioridades: raw.prioridades, magica: raw.classe_magica, dano: raw.dano };
  const all = Object.keys(classOf).map((n) => ({ name: n, roles: 'A', adc: classOf[n], profile: P([], [], { ad: classOf[n] === 'Mage Bot' ? 0 : 100 }) }));
  all.push({ name: 'Ahri', roles: 'M', profile: P([], [], { ad: 0 }) }, { name: 'Lux', roles: 'S', profile: P([], [], { ad: 0 }) });
  const R = E.relations(all, ADC);
  const st = Object.fromEntries(Object.keys(classOf).map((n) => [n, { g: 300, wr: 50, pr: 5, roles: { A: { g: 120, wr: 50 } } }]));
  const go = (foes, o = {}) => E.read({ champs: all, rel: R, allies: o.allies || [], foes, open: ['A'], isOut: (n) => foes.includes(n), role: 'A', stats: o.stats || {}, lane: o.lane || null });
  const adcG = (r) => E.groups('pick', r).find((g) => g.title.startsWith('ADC'));

  // Sem estatísticas: Kai'Sa primeiro contra Ezreal; Caitlyn perde
  let q = go(['Ezreal']);
  assert.equal(adcG(q).items[0].c.name, "Kai'Sa");
  assert.ok(q.byName.Caitlyn.bad.includes('Ezreal') && q.byName.Kalista.good.includes('Ezreal'));
  // Com estatísticas e sem jogos do confronto: a classe vale como histórico e ordena o grupo de ADC
  q = go(['Ezreal'], { stats: st });
  assert.equal(adcG(q).items[0].c.name, "Kai'Sa");
  assert.ok(q.byName["Kai'Sa"].hist.has('Ezreal'));
  assert.match(E.why(q.byName["Kai'Sa"]), /^Skirm x Poke \(prioridade\); bom contra Ezreal/);
  // Com jogos do confronto direto, os números mandam (Caitlyn ganhando de Ezreal na soloQ)
  q = go(['Ezreal'], { stats: st, lane: { Caitlyn: { Ezreal: { g: 40, w: 23 } } } });
  assert.ok(q.byName.Caitlyn.good.includes('Ezreal') && !q.byName.Caitlyn.bad.length);
  // Contra Lane Bully: Jinx, Jhin e Ziggs
  q = go(['Draven'], { stats: st });
  same(adcG(q).items.slice(0, 3).map((x) => x.c.name).sort(), ['Jhin', 'Jinx', 'Ziggs']);
  // Time sem dano físico: ADC de dano AD na frente do Mage Bot
  q = go([], { allies: ['Ahri', 'Lux'] });
  assert.ok(q.byName.Jinx.fichaScore > q.byName.Ziggs.fichaScore);
  // Nota do draft: ADC contra ADC sem jogos do confronto usa a classe
  const byName = Object.fromEntries(all.map((c) => [c.name, c]));
  const ds = E.draftScore({ mine: [{ name: "Kai'Sa", role: 'A' }], enemy: [{ name: 'Ezreal', role: 'A' }], byName, rel: R });
  assert.ok(ds.parts.some((p) => p.kind === 'lane' && p.value === E.RULES.HIST && /Skirm/.test(p.text)));
}

// ---------- Counterpicks de suporte por classe (data/suporte.json) ----------
{
  const rawA = JSON.parse(readFileSync(new URL('../data/adc.json', import.meta.url), 'utf8'));
  const adcOf = {};
  for (const [cls, list] of Object.entries(rawA.classes)) for (const n of list) adcOf[n] = cls;
  const ADC = { tabela: rawA.tabela, prioridades: rawA.prioridades, magica: rawA.classe_magica, dano: rawA.dano };
  const rawS = JSON.parse(readFileSync(new URL('../data/suporte.json', import.meta.url), 'utf8'));
  const supOf = {};
  for (const [cls, list] of Object.entries(rawS.classes)) for (const n of list) supOf[n] = cls;
  const classes = Object.keys(rawS.classes);
  const excecoes = rawS.excecoes.map((e) => ({ ...e, tipo: classes.includes(e.contra) ? 'classe' : rawS.grupos[e.contra] ? 'grupo' : 'campeao' }));
  const SUP = { classes, grupos: rawS.grupos, tabela: rawS.tabela, excecoes, sinergia: rawS.sinergia_adc, duplas: rawS.duplas_ruins, notas: rawS.notas };
  const pool = [
    ...Object.keys(supOf).map((n) => ({ name: n, roles: 'S', sup: supOf[n], profile: P([], [], { ad: 50 }) })),
    ...["Kai'Sa", 'Jinx', 'Ezreal', 'Draven'].map((n) => ({ name: n, roles: 'A', adc: adcOf[n], profile: P([], [], { ad: 100 }) })),
  ];
  const R = E.relations(pool, ADC, SUP);
  const st = Object.fromEntries(pool.map((c) => [c.name, { g: 300, wr: 50, pr: 5, roles: { [c.roles]: { g: 120, wr: 50 } } }]));
  const go = (foes, o = {}) => E.read({ champs: pool, rel: R, allies: o.allies || [], foes, open: o.open || ['S'], isOut: (n) => foes.includes(n) || (o.allies || []).includes(n), role: (o.open || ['S'])[0], stats: o.stats || {}, lane: o.lane || null, duo: o.duo || null });
  const supG = (r) => E.groups('pick', r).find((g) => g.title.startsWith('Suporte'));

  // Sem estatísticas: contra Enchanter, Engage/Hook ganham; Janna ganha de Engage; Braum perde para Rell
  let q = go(['Lulu']);
  assert.ok(q.byName.Leona.good.includes('Lulu') && q.byName.Thresh.good.includes('Lulu'));
  assert.ok(go(['Leona']).byName.Janna.good.includes('Leona'));
  assert.ok(go(['Rell']).byName.Braum.bad.includes('Rell'));
  // Com estatísticas sem jogos do confronto: a classe vale como histórico e ordena o grupo de suporte
  q = go(['Lulu'], { stats: st });
  assert.ok(q.byName.Leona.hist.has('Lulu'));
  assert.ok(['Enchanter', 'Mage', 'Misfit'].every((cls) => supG(q).items[0].sup.classe !== cls));
  // Com jogos do confronto direto, os números mandam
  q = go(['Lulu'], { stats: st, lane: { Leona: { Lulu: { g: 40, w: 15 } } } });
  assert.ok(q.byName.Leona.bad.includes('Lulu') && !q.byName.Leona.good.includes('Lulu'));
  // Dupla do bot: Engage + Skirm combina; Ezreal + Yuumi combina mal
  q = go([], { allies: ["Kai'Sa"], stats: st });
  assert.ok(q.byName.Leona.syn.includes("Kai'Sa") && q.byName.Leona.hist.has("Kai'Sa"));
  q = go([], { allies: ['Ezreal'], stats: st });
  assert.ok(q.byName.Yuumi.anti.includes('Ezreal'));
  // Nota do draft: suporte contra suporte e dupla do bot pela classe
  const byName = Object.fromEntries(pool.map((c) => [c.name, c]));
  let ds = E.draftScore({ mine: [{ name: 'Leona', role: 'S' }, { name: "Kai'Sa", role: 'A' }], enemy: [{ name: 'Lulu', role: 'S' }], byName, rel: R });
  assert.ok(ds.parts.some((p) => p.kind === 'lane' && p.value === E.RULES.HIST && /Engage/.test(p.text)));
  assert.ok(ds.parts.some((p) => p.kind === 'duo' && p.value > 0 && /combinam no bot/.test(p.text)));
  ds = E.draftScore({ mine: [{ name: 'Yuumi', role: 'S' }, { name: 'Ezreal', role: 'A' }], enemy: [], byName, rel: R });
  assert.ok(ds.parts.some((p) => p.kind === 'duo' && p.value < 0 && /combinam mal/.test(p.text)));
}

// ---------- Counterpicks do topo por classe (data/topo.json) ----------
{
  const rawT = JSON.parse(readFileSync(new URL('../data/topo.json', import.meta.url), 'utf8'));
  const topOf = {};
  for (const [cls, list] of Object.entries(rawT.classes)) for (const n of list) topOf[n] = cls;
  const classes = Object.keys(rawT.classes);
  const excecoes = rawT.excecoes.map((e) => ({ ...e, tipo: classes.includes(e.contra) ? 'classe' : rawT.grupos[e.contra] ? 'grupo' : 'campeao' }));
  const TOP = { classes, grupos: rawT.grupos, tabela: rawT.tabela, excecoes, notas: rawT.notas };
  const pool = Object.keys(topOf).map((n) => ({ name: n, roles: 'T', top: topOf[n], profile: P([], [], { ad: 100 }) }));
  pool.push({ name: 'Ahri', roles: 'M', profile: P([], [], { ad: 100 }) });
  const RT = E.relations(pool, null, null, TOP);
  const topo = (foes, open = ['T']) => E.read({ champs: pool, rel: RT, allies: [], foes, open, isOut: (n) => foes.includes(n), role: open[0] });
  const topG = (r) => E.groups('pick', r).find((g) => g.title.startsWith('Topo'));

  // Contra Juggernaut: Ranged ganha (kite), Tank perde; Darius x Renekton é só uma leve vantagem (sem rótulo)
  let t = topo(['Darius']);
  assert.ok(t.byName.Teemo.good.includes('Darius') && t.byName.Malphite.bad.includes('Darius'));
  assert.ok(!t.byName.Renekton.bad.includes('Darius') && t.byName.Renekton.top.value === -1);
  // Contra Jayce: Nasus, Pantheon, Irelia e Shen vão bem; Yone vai mal, mesmo sendo Duelista como a Irelia
  t = topo(['Jayce']);
  assert.ok(['Nasus', 'Pantheon', 'Irelia', 'Shen'].every((n) => t.byName[n].good.includes('Jayce')));
  assert.ok(t.byName.Yone.bad.includes('Jayce'));
  assert.ok(['Nasus', 'Pantheon', 'Irelia', 'Shen'].includes(topG(t).items[0].c.name));
  assert.match(E.why(t.byName.Irelia), /Irelia x Jayce \(exceção\)/);
  // Contra Jax: Garen vai bem, Sett vai mal
  t = topo(['Jax']);
  assert.ok(t.byName.Garen.good.includes('Jax') && t.byName.Sett.bad.includes('Jax'));
  // Contra Malphite: Irelia sofre (não consegue dar auto), Fiora mata tanque
  t = topo(['Malphite']);
  assert.ok(t.byName.Irelia.bad.includes('Malphite') && t.byName.Fiora.good.includes('Malphite'));
  // Gangplank (laranja) e Kennen (fuga) anulam a vantagem do Renekton; Pantheon continua bem
  t = topo(['Gangplank']);
  assert.ok(!t.byName.Renekton.good.includes('Gangplank') && t.byName.Pantheon.good.includes('Gangplank'));
  // K'Sante perde para Kayle; Shen, Gnar e Teemo ganham da Ambessa
  assert.ok(topo(['Kayle']).byName["K'Sante"].bad.includes('Kayle'));
  t = topo(['Ambessa']);
  assert.ok(['Shen', 'Gnar', 'Teemo'].every((n) => t.byName[n].good.includes('Ambessa')));
  assert.ok(t.byName.Jayce.bad.includes('Ambessa'));
  // Nota da classe nos motivos; com a rota de topo fechada, nada de topo
  assert.match(E.why(topo(['Darius']).byName.Malphite), /valor garantido no fim do jogo/);
  assert.equal(topo(['Darius'], ['M']).byName.Teemo, undefined);
  // Nota do draft: topo contra topo pela classe, sem jogos do confronto
  const byName = Object.fromEntries(pool.map((c) => [c.name, c]));
  const ds = E.draftScore({ mine: [{ name: 'Nasus', role: 'T' }], enemy: [{ name: 'Jayce', role: 'T' }], byName, rel: RT });
  assert.ok(ds.parts.some((p) => p.kind === 'lane' && p.value === E.RULES.HIST && /Juggernaut/.test(p.text)));
}

// ---------- Counterpicks do meio por classe (data/meio.json) ----------
{
  const rawM = JSON.parse(readFileSync(new URL('../data/meio.json', import.meta.url), 'utf8'));
  const midOf = {};
  for (const [cls, list] of Object.entries(rawM.classes)) for (const n of list) midOf[n] = cls;
  const classes = Object.keys(rawM.classes);
  const excecoes = rawM.excecoes.map((e) => ({ ...e, tipo: classes.includes(e.contra) ? 'classe' : rawM.grupos[e.contra] ? 'grupo' : 'campeao' }));
  const MID = { classes, grupos: rawM.grupos, tabela: rawM.tabela, excecoes, notas: rawM.notas };
  const pool = Object.keys(midOf).map((n) => ({ name: n, roles: 'M', mid: midOf[n], profile: P([], [], { ad: 0 }) }));
  const RM = E.relations(pool, null, null, null, MID);
  const meio = (foes, open = ['M']) => E.read({ champs: pool, rel: RM, allies: [], foes, open, isOut: (n) => foes.includes(n), role: open[0] });
  const midG = (r) => E.groups('pick', r).find((g) => g.title.startsWith('Meio'));

  // A tabela em círculo: cada classe ganha de duas e perde para duas
  let m = meio(['Xerath']);
  assert.ok(m.byName.Zed.good.includes('Xerath') && m.byName.Yasuo.good.includes('Xerath'));
  assert.ok(m.byName.Syndra.bad.includes('Xerath') && m.byName.Ryze.bad.includes('Xerath'));
  assert.ok(!m.byName.Vladimir.bad.includes('Xerath')); // Vladimir cura o poke da artilharia
  m = meio(['Ryze']);
  assert.ok(m.byName.Syndra.good.includes('Ryze') && m.byName.Xerath.good.includes('Ryze'));
  assert.ok(m.byName.Zed.bad.includes('Ryze') && m.byName.Yasuo.bad.includes('Ryze'));
  m = meio(['Yasuo']);
  assert.ok(m.byName.Syndra.good.includes('Yasuo') && m.byName.Ryze.good.includes('Yasuo') && m.byName.Zed.bad.includes('Yasuo'));
  // Contra assassino: magos de controle perdem, mas Vex, Malzahar e Annie foram feitos para punir o assassino
  m = meio(['Zed']);
  assert.ok(m.byName.Syndra.bad.includes('Zed'));
  assert.ok(['Vex', 'Malzahar', 'Annie', 'Lissandra', 'Ryze', 'Yasuo'].every((n) => m.byName[n].good.includes('Zed')));
  assert.match(E.why(m.byName.Vex), /Vex x Zed \(exceção\)/);
  assert.equal(midG(m).items.length > 0, true);
  // Nota da classe nos motivos; com o meio fechado, nada de meio
  assert.match(E.why(meio(['Xerath']).byName.Zed), /tudo ou nada/);
  assert.equal(meio(['Xerath'], ['T']).byName.Zed, undefined);
  const byName = Object.fromEntries(pool.map((c) => [c.name, c]));
  const ds = E.draftScore({ mine: [{ name: 'Syndra', role: 'M' }], enemy: [{ name: 'Ryze', role: 'M' }], byName, rel: RM });
  assert.ok(ds.parts.some((p) => p.kind === 'lane' && p.value === E.RULES.HIST && /Controle/.test(p.text)));
}

// ---------- Counterpicks da selva por classe (data/selva.json) ----------
{
  const rawJ = JSON.parse(readFileSync(new URL('../data/selva.json', import.meta.url), 'utf8'));
  const jgOf = {};
  for (const [cls, list] of Object.entries(rawJ.classes)) for (const n of list) jgOf[n] = cls;
  const classes = Object.keys(rawJ.classes);
  const excecoes = rawJ.excecoes.map((e) => ({ ...e, tipo: classes.includes(e.contra) ? 'classe' : rawJ.grupos[e.contra] ? 'grupo' : 'campeao' }));
  const JG = { classes, grupos: rawJ.grupos, tabela: rawJ.tabela, excecoes, notas: rawJ.notas };
  const pool = Object.keys(jgOf).map((n) => ({ name: n, roles: 'J', jg: jgOf[n], profile: P([], [], { ad: 50 }) }));
  const RJ = E.relations(pool, null, null, null, null, JG);
  const selva = (foes, open = ['J']) => E.read({ champs: pool, rel: RJ, allies: [], foes, open, isOut: (n) => foes.includes(n), role: open[0] });
  const jgG = (r) => E.groups('pick', r).find((g) => g.title.startsWith('Selva'));

  // Pelas win rates do vídeo: Tank ganha de Skirmisher e de Assassino; Farmer só leva leve vantagem contra High Tempo
  let j = selva(['Hecarim']);
  assert.ok(j.byName.Sejuani.good.includes('Hecarim'));
  assert.ok(['Cho\'Gath', 'Zac', 'Nunu', 'Skarner', 'Sejuani', 'Amumu', 'Rammus'].includes(jgG(j).items[0].c.name));
  j = selva(['Sejuani']);
  assert.ok(j.byName.Hecarim.bad.includes('Sejuani') && j.byName["Kha'Zix"].bad.includes('Sejuani'));
  j = selva(['Lee Sin']);
  assert.ok(!j.byName['Master Yi'].good.includes('Lee Sin') && j.byName['Master Yi'].jg.value === 1.4);
  // Exceções: Master Yi contra Rengar, Hecarim contra Qiyana, Zac contra Lee Sin
  assert.ok(selva(['Rengar']).byName['Master Yi'].good.includes('Rengar'));
  assert.ok(selva(['Master Yi']).byName.Rengar.bad.includes('Master Yi'));
  assert.ok(selva(['Qiyana']).byName.Hecarim.good.includes('Qiyana'));
  assert.ok(j.byName.Zac.good.includes('Lee Sin'));
  assert.match(E.why(j.byName.Zac), /Zac x Lee Sin \(exceção\)/);
  assert.equal(jgG(j).items[0].c.name, 'Zac');
  // Nota da classe nos motivos; com a selva fechada, nada de selva
  assert.match(E.why(selva(['Hecarim']).byName.Sejuani), /jogando de trás/);
  assert.equal(selva(['Hecarim'], ['M']).byName.Sejuani, undefined);
  const byName = Object.fromEntries(pool.map((c) => [c.name, c]));
  const ds = E.draftScore({ mine: [{ name: 'Sejuani', role: 'J' }], enemy: [{ name: 'Hecarim', role: 'J' }], byName, rel: RJ });
  assert.ok(ds.parts.some((p) => p.kind === 'lane' && p.value === E.RULES.HIST && /Tank/.test(p.text)));
}

console.log('Todos os testes do motor de draft passaram.');
