// Builds, runas, confrontos e partidas de alto elo, calculados com as mesmas partidas da coleta de soloQ.
//
// De cada partida coletada sai, para cada um dos 10 jogadores (campeão + rota):
//   runas, feitiços, itens iniciais, bota, os 3 primeiros itens completos (na ordem de compra),
//   o 4º e o 5º item, a ordem de habilidades e a diferença de ouro para o adversário de rota aos 14 minutos.
// A ordem de compra, os iniciais, as habilidades e o ouro aos 14 vêm da "linha do tempo" da partida (outro
// pedido à Riot por partida). Sem ela, a partida ainda conta para runas, feitiços e itens finais.
// Partidas de jogadores Diamante ou acima também entram no histórico de cada campeão (as mais recentes).
import { join } from 'node:path';
import { DATA, readJSON, writeJSON } from './util.js';

const DIR = join(DATA, 'soloq');
const POS = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' };
export const HIGH = new Set(['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']);
const KEEP = 24;        // variações guardadas de cada coisa (runas, itens…) por campeão e rota
const HISTORY = 60;     // partidas de alto elo guardadas por campeão e rota
const SKILL = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };

export function emptyBuilds(patch, elo, platform) {
  return { patch, elo, platform, matches: 0, timelines: 0, champs: {}, gd: {}, games: {} };
}
export const buildsFile = (patch, elo, platform) => join(DIR, `builds_${patch}_${elo}_${platform}.json`);
export async function loadBuilds(patch, elo, platform) {
  return (await readJSON(buildsFile(patch, elo, platform))) || emptyBuilds(patch, elo, platform);
}
export async function saveBuilds(book) {
  prune(book);
  await writeJSON(buildsFile(book.patch, book.elo, book.platform), book, true);
}

const bump = (obj, k, win) => { const x = (obj[k] ||= { g: 0, w: 0 }); x.g++; if (win) x.w++; };
const entry = (book, key) => (book.champs[key] ||= { g: 0, w: 0, runes: {}, spells: {}, start: {}, boots: {}, core: {}, i4: {}, i5: {}, items: {}, skills: {}, first: {} });

// Ordem de evolução das habilidades: qual das três (Q, W, E) chegou primeiro ao nível máximo.
// Se a partida acabou antes, desempata por quem tinha mais pontos e depois por quem recebeu o primeiro ponto.
export function skillOrder(seq) {
  const pts = { Q: 0, W: 0, E: 0 }, maxAt = {}, firstAt = {};
  seq.forEach((s, i) => {
    if (!(s in pts)) return;
    pts[s]++;
    if (firstAt[s] == null) firstAt[s] = i;
    if (pts[s] === 5 && maxAt[s] == null) maxAt[s] = i;
  });
  return ['Q', 'W', 'E'].sort((a, b) => (maxAt[a] ?? 99) - (maxAt[b] ?? 99) || pts[b] - pts[a] || (firstAt[a] ?? 99) - (firstAt[b] ?? 99)).join('');
}

// Lê a linha do tempo: compras (com desfazer), níveis de habilidade e ouro aos 14 minutos.
export function readTimeline(tl) {
  const frames = tl?.info?.frames || [];
  const buys = {}, skills = {};
  for (const f of frames) for (const e of f.events || []) {
    const pid = e.participantId;
    if (e.type === 'ITEM_PURCHASED') (buys[pid] ||= []).push({ id: e.itemId, t: e.timestamp });
    else if (e.type === 'ITEM_UNDO') {
      const list = buys[pid] || [];
      // Desfazer uma compra tira a última compra daquele item
      for (let i = list.length - 1; i >= 0; i--) if (list[i].id === e.beforeId) { list.splice(i, 1); break; }
    } else if (e.type === 'SKILL_LEVEL_UP' && e.levelUpType !== 'EVOLVE') (skills[pid] ||= []).push(SKILL[e.skillSlot]);
  }
  const at14 = frames[14]?.participantFrames || null;
  const gold14 = {};
  if (at14) for (const [pid, pf] of Object.entries(at14)) gold14[pid] = pf.totalGold ?? null;
  // Ouro de cada jogador a cada minuto (para a probabilidade de vitória antes de cada compra)
  const gold = frames.map((f) => { const g = {}; for (const [pid, pf] of Object.entries(f.participantFrames || {})) g[pid] = pf.totalGold ?? 0; return g; });
  return { buys, skills, gold14: at14 ? gold14 : null, gold };
}

const perksOf = (p) => {
  const st = p.perks?.styles || [];
  const pri = st.find((s) => s.description === 'primaryStyle') || st[0];
  const sub = st.find((s) => s.description === 'subStyle') || st[1];
  const sp = p.perks?.statPerks || {};
  if (!pri || !sub) return null;
  return {
    pri: pri.style, sub: sub.style,
    perks: [...(pri.selections || []).map((x) => x.perk), ...(sub.selections || []).map((x) => x.perk)],
    shards: [sp.offense, sp.flex, sp.defense].filter(Boolean),
  };
};
// "8000:8010,9111,9104,8014|8400:8444,8242|5008,5008,5011"
export const runeKey = (r) => `${r.pri}:${r.perks.slice(0, 4).join(',')}|${r.sub}:${r.perks.slice(4, 6).join(',')}|${r.shards.join(',')}`;
export function parseRuneKey(k) {
  const [a, b, c] = k.split('|');
  const [pri, p1] = a.split(':'); const [sub, p2] = b.split(':');
  return { pri: Number(pri), sub: Number(sub), perks: [...p1.split(','), ...p2.split(',')].map(Number), shards: c ? c.split(',').map(Number) : [] };
}

// ---------- WPA (Win Probability Added) ----------
// WPA = vitórias de quem escolheu − a probabilidade de vitória que essas pessoas já tinham antes da escolha.
// Itens: a probabilidade antes da compra vem do minuto e da diferença de ouro entre os times, numa tabela
// montada com as próprias partidas coletadas (com um palpite inicial enquanto a tabela tem poucos jogos).
// Runa principal, feitiços e item inicial: a probabilidade depois do draft (pelo confronto de rota).
export const WPA_SLOTS = ['key', 'spell', 'start', 'boots', 'i1', 'i2', 'i3', 'i4'];
const mBin = (ms) => Math.min(Math.floor(ms / 120000), 20); // blocos de 2 minutos, até 40+
const gBin = (gd) => Math.max(-12, Math.min(12, Math.round(gd / 1000))); // blocos de mil de ouro
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
// Palpite inicial: 2,6 mil de vantagem cedo ≈ 73% de vitória; depois dos 20 minutos o ouro pesa um pouco menos
export const wpPrior = (ms, gd) => sigmoid(gd / 1000 / (ms < 20 * 60000 ? 2.6 : 3.6));
export function wpOf(book, ms, gd) {
  const c = book.wp?.[`${mBin(ms)}|${gBin(gd)}`];
  const p0 = wpPrior(ms, gd);
  return c ? (c.w + 30 * p0) / (c.g + 30) : p0;
}
function teamGold(t, ps, ms) {
  const f = t.gold[Math.min(Math.floor(ms / 60000), t.gold.length - 1)] || {};
  const sum = { 100: 0, 200: 0 };
  for (const p of ps) sum[p.teamId] = (sum[p.teamId] || 0) + (f[p.participantId] || 0);
  return sum;
}
const addW = (e, slot, id, win, pre) => {
  const x = (((e.wpa ||= {})[slot] ||= {})[id] ||= { g: 0, w: 0, p: 0 });
  x.g++; if (win) x.w++; x.p += pre;
};

// Soma uma partida. items: getItemData(); tier: elo do jogador que trouxe a partida (para o histórico).
// draftWp(p, opp): probabilidade de vitória depois do draft (a coleta calcula pelo confronto de rota).
export function addBuildMatch(book, m, tl, items, { tier = null, draftWp = () => 0.5 } = {}) {
  const info = m?.info;
  const ps = info?.participants || [];
  if (ps.length !== 10) return false;
  book.matches++;
  const t = tl ? readTimeline(tl) : null;
  if (t) book.timelines++;
  const isLeg = (id) => items[id]?.l, isBoot = (id) => items[id]?.b;
  const high = tier && HIGH.has(tier);
  for (const p of ps) {
    const role = POS[p.teamPosition];
    if (!role) continue;
    const key = `${p.championId}|${role}`;
    const e = entry(book, key);
    const win = !!p.win;
    e.g++; if (win) e.w++;
    const r = perksOf(p);
    if (r && r.perks.length === 6) bump(e.runes, runeKey(r), win);
    if (p.summoner1Id && p.summoner2Id) bump(e.spells, [p.summoner1Id, p.summoner2Id].sort((a, b) => a - b).join(','), win);
    const finalItems = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter((x) => x > 0);
    for (const id of new Set(finalItems)) if (isLeg(id)) bump(e.items, id, win);
    const opp = ps.find((o) => o.teamId !== p.teamId && POS[o.teamPosition] === role);
    const pre = Math.min(0.8, Math.max(0.2, draftWp(p, opp) ?? 0.5));
    if (r?.perks?.[0]) addW(e, 'key', r.perks[0], win, pre);
    // Explorador de runas: cada runa, cada fragmento (por linha) e cada árvore
    if (r && r.perks.length === 6) {
      const rx = (e.rx ||= {});
      const put = (k) => { const x = (rx[k] ||= [0, 0, 0]); x[0]++; if (win) x[1]++; x[2] = Math.round((x[2] + pre) * 1000) / 1000; };
      r.perks.forEach((id) => put(`r${id}`));
      r.shards.forEach((id, row) => put(`s${row}:${id}`));
      put(`P${r.pri}`); put(`S${r.sub}`);
    }
    for (const sp of new Set([p.summoner1Id, p.summoner2Id])) if (sp) addW(e, 'spell', sp, win, pre);
    if (t) {
      const buys = t.buys[p.participantId] || [];
      const start = buys.filter((b) => b.t < 60000).map((b) => b.id).sort((a, b) => a - b);
      if (start.length) bump(e.start, start.join(','), win);
      const boot = buys.find((b) => isBoot(b.id));
      if (boot) bump(e.boots, boot.id, win);
      const legs = [];
      for (const b of buys) if (isLeg(b.id) && !legs.includes(b.id)) legs.push(b.id);
      if (legs.length >= 3) bump(e.core, legs.slice(0, 3).join(','), win);
      if (legs[3]) bump(e.i4, legs[3], win);
      if (legs[4]) bump(e.i5, legs[4], win);
      // WPA: probabilidade de vitória do time logo antes de cada compra
      if (t.gold.length > 1) e.gt = (e.gt || 0) + 1; // partidas com linha do tempo (base do "% de escolha" dos itens)
      if (t.gold.length > 1) {
        const before = (ms) => { const g = teamGold(t, ps, ms); const gd = g[p.teamId] - g[p.teamId === 100 ? 200 : 100]; return wpOf(book, ms, gd); };
        const main = buys.filter((b) => b.t < 60000).sort((a, b) => (items[b.id]?.g || 0) - (items[a.id]?.g || 0))[0];
        if (main) addW(e, 'start', main.id, win, pre);
        if (boot) addW(e, 'boots', boot.id, win, before(boot.t));
        const seen = new Set();
        let n = 0;
        for (const b of buys) {
          if (!isLeg(b.id) || seen.has(b.id)) continue;
          seen.add(b.id); n++;
          addW(e, n <= 3 ? `i${n}` : 'i4', b.id, win, before(b.t));
        }
        // Explorador de itens: cada compra numa categoria (L lendário, C componente, B bota, S suporte,
        // T inicial) e na fase em que foi feita (1 = a caminho do 1º item, ..., 4 = 4º item em diante)
        const itx = (e.itx ||= {});
        const done = new Set();
        let legsBefore = 0;
        const legSeen = new Set();
        for (const b of buys) {
          const it = items[b.id];
          if (!it) continue;
          let cat = null;
          if (b.t < 60000) cat = 'T';
          else if (it.l) cat = 'L';
          else if (it.b) cat = 'B';
          else if (it.s) cat = 'S';
          else if (it.c) cat = 'C';
          if (cat) {
            const slot = cat === 'T' ? 0 : Math.min(4, legsBefore + 1);
            const k = `${cat}${slot}:${b.id}`;
            if (!done.has(k)) {
              done.add(k);
              const x = ((itx[`${cat}${slot}`] ||= {})[b.id] ||= [0, 0, 0]);
              x[0]++; if (win) x[1]++;
              x[2] = Math.round((x[2] + (cat === 'T' ? pre : before(b.t))) * 1000) / 1000;
            }
          }
          if (it.l && !legSeen.has(b.id)) { legSeen.add(b.id); legsBefore++; }
        }
      }
      const seq = t.skills[p.participantId] || [];
      if (seq.length >= 6) bump(e.skills, skillOrder(seq), win);
      if (seq.length >= 3) bump(e.first, seq.slice(0, 3).join(''), win);
      // Ouro aos 14 minutos contra o adversário de rota: diz se o confronto é bom na fase de rotas
      if (opp && t.gold14?.[p.participantId] != null && t.gold14?.[opp.participantId] != null) {
        const x = ((book.gd[key] ||= {})[opp.championId] ||= { n: 0, s: 0 });
        x.n++; x.s += t.gold14[p.participantId] - t.gold14[opp.participantId];
      }
    }
    if (high) {
      const list = (book.games[key] ||= []);
      list.unshift({
        id: m.metadata?.matchId || null,
        t: info.gameEndTimestamp || (info.gameStartTimestamp || 0) + (info.gameDuration || 0) * 1000,
        plat: info.platformId || '',
        nome: p.riotIdGameName || p.summonerName || '',
        tag: p.riotIdTagline || '',
        tier,
        opp: opp?.championId || null,
        win,
        k: p.kills, d: p.deaths, a: p.assists,
        cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
        dur: info.gameDuration || 0,
        spells: [p.summoner1Id, p.summoner2Id],
        runes: r ? [r.perks[0], r.sub] : [],
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      });
      list.sort((a, b) => b.t - a.t);
      if (list.length > HISTORY) list.length = HISTORY;
    }
  }
  // A tabela de probabilidade de vitória aprende com esta partida só depois de usada nela
  if (t && t.gold.length > 1) {
    const win100 = !!ps.find((p) => p.teamId === 100)?.win;
    book.wp ||= {};
    for (let f = 1; f < t.gold.length; f++) {
      const g = { 100: 0, 200: 0 };
      for (const p of ps) g[p.teamId] = (g[p.teamId] || 0) + (t.gold[f][p.participantId] || 0);
      const gd = g[100] - g[200];
      for (const [d, w] of [[gd, win100], [-gd, !win100]]) {
        const c = (book.wp[`${mBin(f * 60000)}|${gBin(d)}`] ||= { g: 0, w: 0 });
        c.g++; if (w) c.w++;
      }
    }
  }
  return true;
}

// Mantém só as variações mais jogadas, para o arquivo não crescer sem fim.
export function prune(book) {
  const cut = (obj) => { const ent = Object.entries(obj || {}); return ent.length <= KEEP ? obj : Object.fromEntries(ent.sort((a, b) => b[1].g - a[1].g).slice(0, KEEP)); };
  for (const e of Object.values(book.champs)) {
    for (const k of ['runes', 'spells', 'start', 'boots', 'core', 'i4', 'i5', 'items', 'skills', 'first']) e[k] = cut(e[k]);
    for (const k of Object.keys(e.wpa || {})) e.wpa[k] = cut(e.wpa[k]);
    for (const k of Object.keys(e.itx || {})) {
      const ent = Object.entries(e.itx[k]);
      if (ent.length > 30) e.itx[k] = Object.fromEntries(ent.sort((a, b) => b[1][0] - a[1][0]).slice(0, 30));
    }
  }
  return book;
}

// ---------- Para a tela ----------
const pct = (w, g) => (g ? Math.round((w / g) * 1000) / 10 : null);
function mergeMaps(a = {}, b = {}) {
  const out = {};
  for (const src of [a, b]) for (const [k, x] of Object.entries(src)) {
    if (typeof x?.g === 'number') { const y = (out[k] ||= { g: 0, w: 0 }); y.g += x.g; y.w += x.w; }
  }
  return out;
}
function mergeEntry(a, b) {
  if (!a) return b; if (!b) return a;
  const out = { g: a.g + b.g, w: a.w + b.w };
  for (const k of ['runes', 'spells', 'start', 'boots', 'core', 'i4', 'i5', 'items', 'skills', 'first']) out[k] = mergeMaps(a[k], b[k]);
  out.wpa = {};
  for (const k of WPA_SLOTS) {
    const m = {};
    for (const src of [a.wpa?.[k], b.wpa?.[k]]) for (const [id, x] of Object.entries(src || {})) { const y = (m[id] ||= { g: 0, w: 0, p: 0 }); y.g += x.g; y.w += x.w; y.p += x.p; }
    out.wpa[k] = m;
  }
  const addArr = (dst, src) => { for (const [id, x] of Object.entries(src || {})) { const y = (dst[id] ||= [0, 0, 0]); y[0] += x[0]; y[1] += x[1]; y[2] += x[2]; } return dst; };
  out.gt = (a.gt || 0) + (b.gt || 0);
  out.rx = addArr(addArr({}, a.rx), b.rx);
  out.itx = {};
  for (const k of new Set([...Object.keys(a.itx || {}), ...Object.keys(b.itx || {})])) out.itx[k] = addArr(addArr({}, a.itx?.[k]), b.itx?.[k]);
  return out;
}
// O mais escolhido; entre os que têm pelo menos 60% dos jogos do primeiro, ganha o que soma escolha e vitória.
function best(map, total) {
  const ent = Object.entries(map || {}).sort((a, b) => b[1].g - a[1].g);
  if (!ent.length) return null;
  const top = ent[0][1].g;
  const pool = ent.filter(([, x]) => x.g >= Math.max(5, top * 0.6));
  const [k, x] = (pool.length ? pool : ent).sort((a, b) => b[1].g * (0.5 + b[1].w / b[1].g) - a[1].g * (0.5 + a[1].w / a[1].g))[0];
  return { k, g: x.g, wr: pct(x.w, x.g), share: total ? Math.round((x.g / total) * 100) : 0 };
}
const list = (map, total, n) => Object.entries(map || {}).sort((a, b) => b[1].g - a[1].g).slice(0, n).map(([k, x]) => ({ k, g: x.g, wr: pct(x.w, x.g), share: total ? Math.round((x.g / total) * 100) : 0 }));

// WPA de cada opção, em pontos percentuais. Com menos de MIN_WPA escolhas o número engana: fica
// marcado como "poucos" e não entra na build recomendada. "forca" puxa o WPA para zero quando há
// poucas escolhas, para um item com 30 compras não passar na frente de um com 3 mil.
export const MIN_WPA = 25;
export function wpaView(e) {
  const out = {};
  for (const slot of WPA_SLOTS) {
    const rows = Object.entries(e.wpa?.[slot] || {}).map(([id, x]) => {
      const wpa = ((x.w - x.p) / x.g) * 100;
      return { id: Number(id), g: x.g, wpa: Math.round(wpa * 100) / 100, forca: wpa * (x.g / (x.g + 60)), poucos: x.g < MIN_WPA };
    }).filter((x) => x.g >= 5);
    rows.sort((a, b) => a.poucos - b.poucos || b.wpa - a.wpa);
    out[slot] = rows.slice(0, 12);
  }
  return out;
}

// key: chave numérica do campeão. Devolve null sem dados.
//   soloLane: livro de confrontos da coleta de soloQ { chave: { chaveAdversário: { g, w } } }
//   roleWr: win rate do campeão na rota (para o "+2,5%" dos confrontos)
export function buildView(book, prev, key, role, { soloLane = {}, roleWr = null, minPair = 15 } = {}) {
  const k = `${key}|${role}`;
  const cur = book?.champs?.[k], old = prev?.champs?.[k];
  // Patch novo com poucos jogos: soma o patch anterior
  const e = cur && cur.g >= 60 ? cur : mergeEntry(cur, old);
  const out = { role, g: e?.g || 0, wr: e ? pct(e.w, e.g) : null, patches: cur && cur.g >= 60 ? [book.patch] : [book?.patch, prev?.patch].filter(Boolean) };
  if (e && e.g) {
    const r = best(e.runes, e.g);
    const s = best(e.spells, e.g);
    const st = best(e.start, e.g);
    const bo = best(e.boots, e.g);
    const co = best(e.core, e.g);
    const sk = best(e.skills, e.g);
    const f3 = best(e.first, e.g);
    out.runas = r && { ...parseRuneKey(r.k), g: r.g, wr: r.wr, share: r.share };
    out.feiticos = s && { ids: s.k.split(',').map(Number), g: s.g, wr: s.wr, share: s.share };
    out.iniciais = st && { ids: st.k.split(',').map(Number), g: st.g, wr: st.wr, share: st.share };
    out.bota = bo && { id: Number(bo.k), g: bo.g, wr: bo.wr, share: bo.share };
    out.core = co && { ids: co.k.split(',').map(Number), g: co.g, wr: co.wr, share: co.share };
    const coreIds = new Set(out.core?.ids || []);
    out.quarto = list(e.i4, e.g, 6).filter((x) => !coreIds.has(Number(x.k))).slice(0, 3).map((x) => ({ id: Number(x.k), share: x.share, wr: x.wr, g: x.g }));
    out.quinto = list(e.i5, e.g, 6).filter((x) => !coreIds.has(Number(x.k))).slice(0, 3).map((x) => ({ id: Number(x.k), share: x.share, wr: x.wr, g: x.g }));
    // Sem linha do tempo ainda: itens mais comuns no fim da partida
    out.itens = list(e.items, e.g, 6).map((x) => ({ id: Number(x.k), share: x.share, wr: x.wr, g: x.g }));
    out.habilidades = sk && { ordem: sk.k, primeiras: f3?.k || null, share: sk.share, wr: sk.wr };
    // WPA por posição, e a build recomendada passa a escolher pelo WPA quando há dados
    out.wpa = wpaView(e);
    // Exploradores (no estilo do coachless): números brutos [compras, vitórias, soma da chance antes]
    out.explorador = { partidasItens: e.gt || 0, itens: e.itx || {}, runas: e.rx || {} };
    const top = (slot, skip = new Set()) => (out.wpa[slot] || []).filter((x) => !x.poucos && !skip.has(x.id)).sort((a, b) => b.forca - a.forca)[0] || null;
    const i1 = top('i1'), i2 = i1 && top('i2', new Set([i1.id])), i3 = i2 && top('i3', new Set([i1.id, i2.id]));
    if (i1 && i2 && i3) {
      out.core = { ids: [i1.id, i2.id, i3.id], porWpa: true, wpa: [i1.wpa, i2.wpa, i3.wpa], g: Math.min(i1.g, i2.g, i3.g), wr: null, share: null };
      const used = new Set(out.core.ids);
      const late = (out.wpa.i4 || []).filter((x) => !x.poucos && !used.has(x.id)).sort((a, b) => b.forca - a.forca);
      if (late.length) { out.quarto = late.slice(0, 3).map((x) => ({ id: x.id, wpa: x.wpa, g: x.g })); out.quinto = []; }
    }
    const bt = top('boots');
    if (bt) out.bota = { id: bt.id, wpa: bt.wpa, g: bt.g, porWpa: true };
    const ks = top('key');
    if (ks) {
      // A página mais usada com a runa principal de maior WPA
      const pg = Object.entries(e.runes || {}).filter(([kk]) => parseRuneKey(kk).perks[0] === ks.id).sort((a, b) => b[1].g - a[1].g)[0];
      if (pg) out.runas = { ...parseRuneKey(pg[0]), g: pg[1].g, wr: pct(pg[1].w, pg[1].g), share: Math.round((pg[1].g / e.g) * 100), porWpa: true, wpa: ks.wpa };
    }
    const stt = top('start');
    if (stt) {
      const set = Object.entries(e.start || {}).filter(([kk]) => kk.split(',').map(Number).includes(stt.id)).sort((a, b) => b[1].g - a[1].g)[0];
      if (set) out.iniciais = { ids: set[0].split(',').map(Number), g: set[1].g, wr: pct(set[1].w, set[1].g), share: Math.round((set[1].g / e.g) * 100), porWpa: true, wpa: stt.wpa };
    }
  }
  // Confrontos: win rate da coleta de soloQ e ouro aos 14 minutos das linhas do tempo
  const lane = soloLane[key] || {};
  const gdCur = book?.gd?.[k] || {}, gdOld = prev?.gd?.[k] || {};
  const rows = [];
  for (const [opp, x] of Object.entries(lane)) {
    if (x.g < minPair) continue;
    const wr = (x.w / x.g) * 100;
    const g1 = gdCur[opp], g0 = gdOld[opp];
    const n = (g1?.n || 0) + (g0?.n || 0), s = (g1?.s || 0) + (g0?.s || 0);
    const gd = n >= 5 ? Math.round(s / n) : null;
    const base = roleWr ?? 50;
    // Para ordenar, puxa os confrontos com poucos jogos para a média (não deixa 15 jogos valerem como 500)
    const pulled = (wr * x.g + base * 30) / (x.g + 30);
    rows.push({ opp: Number(opp), g: x.g, wr: Math.round(wr * 10) / 10, d: Math.round((wr - base) * 10) / 10, sort: pulled - base, gd, rota: gd == null ? null : gd >= 250 ? 'boa' : gd <= -250 ? 'ruim' : 'media' });
  }
  rows.sort((a, b) => b.sort - a.sort);
  out.confrontos = rows.map(({ sort, ...x }) => x);
  // Histórico de alto elo (patch atual + anterior, mais recentes primeiro)
  out.historico = [...(book?.games?.[k] || []), ...(prev?.games?.[k] || [])].sort((a, b) => b.t - a.t).slice(0, HISTORY);
  return out;
}

// Rotas com dados do campeão, da mais jogada para a menos.
export function rolesOfChamp(book, prev, key) {
  const out = {};
  for (const b of [book, prev]) for (const [k, e] of Object.entries(b?.champs || {})) {
    const [c, r] = k.split('|');
    if (c === String(key)) out[r] = (out[r] || 0) + e.g;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]).map(([role, g]) => ({ role, g }));
}
