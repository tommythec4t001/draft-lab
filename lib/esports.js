// Partidas profissionais pela API de esports da Riot (a mesma que o site lolesports.com usa).
// Ela não é documentada oficialmente; a chave abaixo é a chave pública embutida no próprio site.
// Os campeões de cada jogo vêm do feed de estatísticas ao vivo, que só tem dados depois que o jogo começa:
// a seleção de campeões em si (e os bans) não aparece em nenhuma das duas APIs.
import { createHash } from 'node:crypto';
import { fetchWithTimeout } from './util.js';

const KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const HL = 'pt-BR';
let REL = 'https://esports-api.lolesports.com/persisted/gw';
let FEED = 'https://feed.lolesports.com/livestats/v1';
// Para os testes: aponta as duas APIs para um servidor falso.
export function setEsportsBase(rel, feed) { REL = rel; FEED = feed; }

async function rel(path) {
  const r = await fetchWithTimeout(`${REL}/${path}`, { headers: { 'x-api-key': KEY } }, 12000);
  if (!r.ok) throw new Error(`a API de esports respondeu ${r.status}`);
  return (await r.json())?.data;
}

// ---------- Imagens (logos dos times e das ligas) ----------
// A tela só pode mostrar imagens do próprio app (segurança), então os logos passam pelo servidor.
// Cada endereço vira um código curto; só endereços dos servidores de imagem do lolesports são aceitos.
const IMG_HOSTS = new Set(['static.lolesports.com', 'am-a.akamaihd.net']);
const images = new Map(); // código -> endereço original
export function imageCode(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).replace(/^http:/, 'https:')); } catch { return null; }
  if (u.protocol !== 'https:' || !IMG_HOSTS.has(u.hostname)) return null;
  const code = createHash('sha1').update(u.href).digest('hex').slice(0, 20);
  images.set(code, u.href);
  return `/img/time/${code}`;
}
export const imageUrlOf = (code) => images.get(code) || null;

// ---------- Times e partidas ----------
const team = (t) => ({
  name: t?.name || 'A definir',
  code: t?.code || (t?.name || '?').slice(0, 3).toUpperCase(),
  logo: imageCode(t?.image),
  wins: t?.result?.gameWins ?? 0,
  outcome: t?.result?.outcome || null, // win, loss
  record: t?.record ? { w: t.record.wins ?? 0, l: t.record.losses ?? 0 } : null,
});

function eventView(e) {
  const m = e.match;
  return {
    id: String(m?.id || e.id),
    start: e.startTime || null,
    state: e.state === 'inProgress' ? 'ao-vivo' : e.state === 'completed' ? 'terminada' : 'em-breve',
    league: e.league?.name || '',
    leagueSlug: e.league?.slug || '',
    block: e.blockName || '',
    bestOf: m?.strategy?.count || 1,
    teams: (m?.teams || []).slice(0, 2).map(team),
  };
}

// Agenda: o que está ao vivo agora, as partidas terminadas mais recentes e as próximas.
const AGENDA_TTL = 60 * 1000;
let agendaCache = null;
export async function agenda({ fresh = false } = {}) {
  if (!fresh && agendaCache && Date.now() - agendaCache.at < AGENDA_TTL) return agendaCache.value;
  const [live, sched] = await Promise.all([
    rel(`getLive?hl=${HL}`).catch(() => null),
    rel(`getSchedule?hl=${HL}`),
  ]);
  let events = sched?.schedule?.events || [];
  // Uma página mais antiga: a primeira costuma ter poucas partidas terminadas.
  const older = sched?.schedule?.pages?.older;
  if (older) {
    const o = await rel(`getSchedule?hl=${HL}&pageToken=${encodeURIComponent(older)}`).catch(() => null);
    events = [...(o?.schedule?.events || []), ...events];
  }
  const byId = new Map();
  for (const e of events) if (e.type === 'match' && e.match) byId.set(String(e.match.id || e.id), eventView(e));
  // O getLive é a fonte mais fresca do que está acontecendo agora.
  for (const e of live?.schedule?.events || []) {
    if (e.type !== 'match' || !e.match) continue;
    const v = eventView({ ...e, state: 'inProgress' });
    const old = byId.get(v.id);
    byId.set(v.id, { ...old, ...v, start: old?.start || v.start, block: old?.block || v.block });
  }
  const all = [...byId.values()];
  const t = (x) => (x.start ? Date.parse(x.start) : 0);
  const value = {
    atualizado: Date.now(),
    aoVivo: all.filter((x) => x.state === 'ao-vivo').sort((a, b) => t(a) - t(b)),
    recentes: all.filter((x) => x.state === 'terminada').sort((a, b) => t(b) - t(a)).slice(0, 40),
    proximas: all.filter((x) => x.state === 'em-breve').sort((a, b) => t(a) - t(b)).slice(0, 30),
  };
  agendaCache = { at: Date.now(), value };
  return value;
}

// ---------- Campeões e placar de cada jogo ----------
const ROLE = { top: 'T', jungle: 'J', mid: 'M', bottom: 'A', support: 'S' };
const ORDER = ['T', 'J', 'M', 'A', 'S'];
function sidePicks(meta) {
  return (meta?.participantMetadata || [])
    .map((p) => ({ champion: p.championId, role: ROLE[p.role] || null, player: p.summonerName || '' }))
    .sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
}
function teamFrame(t) {
  if (!t) return null;
  return { gold: t.totalGold ?? 0, kills: t.totalKills ?? 0, towers: t.towers ?? 0, inhibitors: t.inhibitors ?? 0, barons: t.barons ?? 0, dragons: (t.dragons || []).length };
}

function isoRounded(msAgo) {
  const d = new Date(Date.now() - msAgo);
  d.setMilliseconds(0);
  d.setSeconds(d.getSeconds() - (d.getSeconds() % 10));
  return d.toISOString();
}
async function windowOf(gameId, startingTime = '') {
  try {
    const r = await fetchWithTimeout(`${FEED}/window/${gameId}${startingTime ? `?startingTime=${startingTime}` : ''}`, {}, 12000);
    if (r.status !== 200) return null;
    const j = await r.json();
    return j?.gameMetadata ? j : null;
  } catch { return null; }
}

// Jogos terminados não mudam: os campeões e o placar final ficam guardados.
const gameCache = new Map();
async function gameData(g) {
  if (gameCache.has(g.id)) return gameCache.get(g.id);
  const live = g.state === 'inProgress';
  // Sem startingTime, o feed devolve o começo do jogo, onde já estão os campeões.
  // Com startingTime, devolve o último minuto: é de onde sai o placar.
  const [first, last] = await Promise.all([windowOf(g.id), live ? windowOf(g.id, isoRounded(60000)) : null]);
  const meta = (first || last)?.gameMetadata;
  if (!meta) return null;
  const picks = { blue: sidePicks(meta.blueTeamMetadata), red: sidePicks(meta.redTeamMetadata) };
  // Placar só do jogo em andamento: o feed não guarda o fim dos jogos terminados num lugar fácil de achar.
  const frames = live ? last?.frames || [] : [];
  const f = frames[frames.length - 1];
  const out = {
    picks,
    placar: f ? { estado: f.gameState || '', blue: teamFrame(f.blueTeam), red: teamFrame(f.redTeam), em: f.rfc460Timestamp || null } : null,
  };
  if (g.state === 'completed' && picks.blue.length === 5 && picks.red.length === 5) gameCache.set(g.id, out);
  return out;
}

export async function partida(id) {
  if (!/^\d{1,25}$/.test(String(id))) throw new Error('ID de partida inválido.');
  const data = await rel(`getEventDetails?hl=${HL}&id=${id}`);
  const ev = data?.event;
  if (!ev?.match) throw new Error('Partida não encontrada.');
  const teams = (ev.match.teams || []).slice(0, 2).map((t) => ({ id: t.id, ...team(t) }));
  const games = [];
  for (const g of ev.match.games || []) {
    const sides = {};
    for (const t of g.teams || []) if (t.side === 'blue' || t.side === 'red') sides[t.side] = String(t.id);
    const d = g.state !== 'unstarted' && g.id ? await gameData(g) : null;
    games.push({
      number: g.number,
      id: g.id,
      state: g.state === 'inProgress' ? 'ao-vivo' : g.state === 'completed' ? 'terminado' : g.state === 'unneeded' ? 'desnecessario' : 'em-breve',
      sides,
      picks: d?.picks || null,
      placar: d?.placar || null,
    });
  }
  games.sort((a, b) => a.number - b.number);
  const anyLive = games.some((g) => g.state === 'ao-vivo');
  return {
    id: String(ev.id),
    league: ev.league?.name || '',
    leagueLogo: imageCode(ev.league?.image),
    bestOf: ev.match.strategy?.count || 1,
    state: anyLive ? 'ao-vivo' : games.length && games.every((g) => g.state !== 'em-breve' && g.state !== 'ao-vivo') && teams.some((t) => t.outcome) ? 'terminada' : 'em-breve',
    teams: teams.map((t) => ({ ...t, id: String(t.id) })),
    games,
    atualizado: Date.now(),
  };
}
