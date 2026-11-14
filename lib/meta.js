// Prioridade no competitivo: presença (picks + bans) de cada campeão na temporada, lida do gol.gg.
// É o que organiza a tier list da aba Fearless ao vivo. Fica em cache por 6 horas; sem internet,
// usa a última leitura salva.
import { join } from 'node:path';
import { CACHE, readJSON, writeJSON, fetchWithTimeout } from './util.js';
import { makeResolver } from './names.js';

const FILE = join(CACHE, 'meta-golgg.json');
const TTL = 6 * 60 * 60 * 1000;
let BASE = 'https://gol.gg';
export function setGolggBase(b) { BASE = b; }

// Temporada do gol.gg: S16 = 2026
export const seasonOf = (year = new Date().getFullYear()) => `S${year - 2010}`;
export const seasonUrl = (season) => `${BASE}/champion/list/season-${season}/split-ALL/tournament-ALL/`;

// ---------- Leitura da tabela de campeões (HTML sem dependências) ----------
const decode = (s) => s
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();
const num = (s) => {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
};
const round1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);

function tables(html) {
  const out = [];
  for (const t of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const rows = [];
    for (const r of t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
      const cells = [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => {
        const text = decode(c[1]);
        if (text) return text;
        return c[1].match(/(?:alt|title)="([^"]+)"/i)?.[1] || ''; // às vezes o nome está só na imagem
      });
      if (cells.length) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

function fromRows(rows, resolve) {
  const h = rows.findIndex((r) => r.some((c) => /champ|campe/i.test(c)));
  if (h < 0) return null;
  const head = rows[h];
  const col = (re, not) => head.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const c = { champ: col(/champ|campe/i), picks: col(/^picks?$/i), bans: col(/^bans?$/i), presence: col(/presen/i), wr: col(/win ?rate|^wr/i), games: col(/^games?$|^gp$/i) };
  if (c.champ < 0) return null;
  const items = [];
  for (const r of rows.slice(h + 1)) {
    const name = resolve(r[c.champ] || '');
    if (!name) continue;
    const g = (i) => (i >= 0 ? num(r[i]) : null);
    items.push({ name, picks: g(c.picks), bans: g(c.bans), pr: g(c.presence), wr: g(c.wr), games: g(c.games) ?? g(c.picks) });
  }
  if (!items.length) return null;
  // Presença = (picks + bans) / jogos. Cada jogo tem 10 picks: jogos = soma dos picks / 10.
  const totalPicks = items.reduce((s, x) => s + (x.picks || 0), 0);
  const games = totalPicks ? totalPicks / 10 : null;
  const champions = {};
  for (const x of items) {
    let pr = x.pr;
    if (pr == null && games && x.picks != null) pr = ((x.picks + (x.bans || 0)) / games) * 100;
    champions[x.name] = { pr: round1(pr), wr: round1(x.wr), picks: x.picks, bans: x.bans };
  }
  return { champions, jogos: games ? Math.round(games) : null };
}

export function parseGolgg(html, champions) {
  const resolve = makeResolver(champions);
  let best = null;
  for (const rows of tables(html)) {
    const r = fromRows(rows, resolve);
    if (r && (!best || Object.keys(r.champions).length > Object.keys(best.champions).length)) best = r;
  }
  return best;
}

// { temporada, fonte, atualizado, jogos, champions: { nome: { pr, wr, picks, bans } }, antigo? }
export async function prioridade(champions, { fresh = false, now = Date.now() } = {}) {
  const season = seasonOf(new Date(now).getFullYear());
  const saved = await readJSON(FILE, null);
  if (!fresh && saved?.temporada === season && now - saved.atualizado < TTL) return saved;
  try {
    const url = seasonUrl(season);
    const r = await fetchWithTimeout(url, { headers: { Accept: 'text/html' } }, 25000);
    if (!r.ok) throw new Error(`o gol.gg respondeu ${r.status}`);
    const parsed = parseGolgg(await r.text(), champions);
    if (!parsed || !Object.keys(parsed.champions).length) throw new Error('não achei a tabela de campeões');
    const out = { temporada: season, fonte: url, atualizado: now, ...parsed };
    await writeJSON(FILE, out, true);
    return out;
  } catch (err) {
    if (saved) return { ...saved, antigo: true, erro: err.message };
    throw new Error('Não consegui ler a prioridade do competitivo no gol.gg: ' + err.message);
  }
}

// Tiers por presença. Quem não aparece no competitivo fica no D.
export const TIERS = [['S', 40], ['A', 25], ['B', 12], ['C', 4], ['D', -1]];
export const tierOf = (pr) => (TIERS.find(([, min]) => (pr ?? 0) >= min) || TIERS[TIERS.length - 1])[0];
