// Seu histórico de partidas, pela API oficial da Riot.
// Guarda um resumo de cada partida em data/partidas.json: da sua parte, tudo o que a tela mostra;
// dos outros nove jogadores, só campeão, time, rota e resultado (nada de nomes nem ids de conta).
import { join } from 'node:path';
import { DATA, readJSON, writeJSON } from './util.js';
import { metricsOf } from './metrics.js';

const FILE = join(DATA, 'partidas.json');
const POS = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' };
export const QUEUES = {
  420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (escolha alternada)', 430: 'Normal (às cegas)',
  490: 'Partida rápida', 700: 'Clash',
};
const MAX_SAVED = 300;

// Resumo de uma partida do ponto de vista de um jogador.
export function summarize(m, puuid) {
  const info = m?.info;
  if (!info || !QUEUES[info.queueId]) return null;
  const me = info.participants?.find((p) => p.puuid === puuid);
  if (!me) return null;
  const pos = POS[me.teamPosition] || '';
  const opp = pos ? info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition) : null;
  const styles = me.perks?.styles || [];
  return {
    id: m.metadata?.matchId,
    queue: info.queueId,
    start: info.gameStartTimestamp || info.gameCreation || 0,
    duration: info.gameDuration || 0,
    remake: (info.gameDuration || 0) < 300 || !!me.gameEndedInEarlySurrender,
    version: String(info.gameVersion || '').split('.').slice(0, 2).join('.'),
    win: !!me.win,
    me: {
      champ: me.championId, pos, team: me.teamId,
      k: me.kills, d: me.deaths, a: me.assists,
      cs: (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0),
      gold: me.goldEarned, level: me.champLevel,
      spells: [me.summoner1Id, me.summoner2Id],
      rune: styles[0]?.selections?.[0]?.perk || null,
      runeSub: styles[1]?.style || null,
      items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6],
      metrics: metricsOf(me, info),
    },
    opp: opp ? opp.championId : null,
    players: info.participants.map((p) => ({ champ: p.championId, team: p.teamId, pos: POS[p.teamPosition] || '', win: !!p.win, me: p.puuid === puuid || undefined })),
  };
}

export class History {
  constructor() { this.data = null; }

  async load() {
    if (!this.data) this.data = (await readJSON(FILE)) || { owner: null, matches: {} };
    return this.data;
  }

  // Busca as partidas mais recentes que ainda não estão salvas. api: RiotApi; usa pedidos urgentes.
  // puuid: o da API para a chave atual; owner: o Riot ID, que identifica de quem é o histórico salvo.
  async refresh(api, puuid, owner, count = 20) {
    const d = await this.load();
    if (d.owner !== owner) { d.owner = owner; d.matches = {}; }
    const ids = (await api.urgent('region', `/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=${Math.min(100, count)}`)) || [];
    let added = 0;
    for (const id of ids) {
      if (d.matches[id] !== undefined) continue;
      const m = await api.urgent('region', `/lol/match/v5/matches/${id}`);
      d.matches[id] = summarize(m, puuid); // null = fila que não mostramos (ARAM, arena…)
      added++;
    }
    // Mantém só as mais recentes
    const all = Object.entries(d.matches).sort((a, b) => (b[1]?.start || 0) - (a[1]?.start || 0));
    if (all.length > MAX_SAVED) d.matches = Object.fromEntries(all.slice(0, MAX_SAVED));
    if (added) await writeJSON(FILE, d, true);
    return added;
  }

  async list({ owner, queue = null, limit = 30 } = {}) {
    const d = await this.load();
    if (owner && d.owner !== owner) return [];
    return Object.values(d.matches).filter(Boolean)
      .filter((m) => !queue || String(m.queue) === String(queue))
      .sort((a, b) => b.start - a.start)
      .slice(0, limit);
  }
}

export const history = new History();
