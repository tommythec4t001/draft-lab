// Métricas de desempenho de um jogador numa partida, com a mesma definição para você e para o elo.
// Tudo vem do resumo da partida da API da Riot (match-v5), sem pedidos extras.

// lower: true quando menos é melhor (mortes). percent: o valor já é uma porcentagem.
export const METRICS = [
  { id: 'csm', group: 'recursos', label: 'CS por minuto', digits: 1 },
  { id: 'cs10', group: 'recursos', label: 'CS aos 10 minutos', digits: 0 },
  { id: 'gpm', group: 'recursos', label: 'Ouro por minuto', digits: 0 },
  { id: 'xpm', group: 'recursos', label: 'Experiência por minuto', digits: 0 },
  { id: 'kp', group: 'combate', label: 'Participação em abates', digits: 0, percent: true },
  { id: 'kda', group: 'combate', label: 'KDA', digits: 2 },
  { id: 'dpm', group: 'combate', label: 'Dano em campeões por minuto', digits: 0 },
  { id: 'deaths', group: 'combate', label: 'Mortes por partida', digits: 1, lower: true },
  { id: 'dragons', group: 'objetivos', label: 'Dragões', digits: 1 },
  { id: 'grubs', group: 'objetivos', label: 'Vastilarvas', digits: 1 },
  { id: 'turrets', group: 'objetivos', label: 'Torres', digits: 1 },
  { id: 'plates', group: 'objetivos', label: 'Placas de torre', digits: 1 },
  { id: 'vspm', group: 'visao', label: 'Placar de visão por minuto', digits: 2 },
  { id: 'wards', group: 'visao', label: 'Sentinelas colocadas', digits: 1 },
  { id: 'control', group: 'visao', label: 'Sentinelas de controle', digits: 1 },
  { id: 'wardsKilled', group: 'visao', label: 'Sentinelas destruídas', digits: 1 },
];
export const GROUPS = [
  { id: 'recursos', label: 'Recursos' },
  { id: 'combate', label: 'Combate' },
  { id: 'objetivos', label: 'Objetivos' },
  { id: 'visao', label: 'Visão' },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// p: participante (ParticipantDto), info: InfoDto. Devolve { id: valor } só com o que existe.
export function metricsOf(p, info) {
  const min = (info.gameDuration || 0) / 60;
  if (min < 5) return {};
  const ch = p.challenges || {};
  const teamKills = (info.participants || []).filter((o) => o.teamId === p.teamId).reduce((s, o) => s + (o.kills || 0), 0);
  const out = {
    csm: ((p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0)) / min,
    cs10: num(ch.laneMinionsFirst10Minutes) != null ? ch.laneMinionsFirst10Minutes + (num(ch.jungleCsBefore10Minutes) || 0) : null,
    gpm: num(p.goldEarned) != null ? p.goldEarned / min : null,
    xpm: num(p.champExperience) != null ? p.champExperience / min : null,
    kp: teamKills ? ((p.kills || 0) + (p.assists || 0)) / teamKills * 100 : null,
    kda: ((p.kills || 0) + (p.assists || 0)) / Math.max(1, p.deaths || 0),
    dpm: num(p.totalDamageDealtToChampions) != null ? p.totalDamageDealtToChampions / min : null,
    deaths: num(p.deaths),
    dragons: num(ch.dragonTakedowns),
    grubs: num(ch.voidMonsterKill),
    turrets: num(p.turretTakedowns),
    plates: num(ch.turretPlatesTaken),
    vspm: num(ch.visionScorePerMinute) ?? (num(p.visionScore) != null ? p.visionScore / min : null),
    wards: num(p.wardsPlaced),
    control: num(p.detectorWardsPlaced) ?? num(ch.controlWardsPlaced),
    wardsKilled: num(p.wardsKilled),
  };
  for (const k of Object.keys(out)) { out[k] = r2(out[k]); if (out[k] == null) delete out[k]; }
  return out;
}

// ---------- Amostras do elo ----------
// Para cada rota e métrica, guarda até MAX valores de partidas do elo (amostragem aleatória justa:
// cada partida tem a mesma chance de ficar, por mais partidas que cheguem).
const MAX = 2000;
export function addSamples(store, role, values, rnd = Math.random) {
  const r = (store[role] ||= {});
  for (const [k, v] of Object.entries(values)) {
    const s = (r[k] ||= { n: 0, v: [] });
    s.n++;
    if (s.v.length < MAX) s.v.push(v);
    else { const j = Math.floor(rnd() * s.n); if (j < MAX) s.v[j] = v; }
  }
}
export function mergeSamples(a = {}, b = {}) {
  const out = {};
  for (const src of [a, b]) for (const [role, ms] of Object.entries(src)) for (const [k, s] of Object.entries(ms)) {
    const o = ((out[role] ||= {})[k] ||= { n: 0, v: [] });
    o.n += s.n; o.v = o.v.concat(s.v).slice(0, MAX);
  }
  return out;
}

// Em quantos % das partidas do elo o valor foi pior que o seu (empates contam metade).
export function percentile(samples, value, lower = false) {
  if (!samples?.length || value == null) return null;
  let worse = 0, eq = 0;
  for (const v of samples) {
    if (v === value) eq++;
    else if (lower ? v > value : v < value) worse++;
  }
  return Math.round(((worse + eq / 2) / samples.length) * 100);
}
export function median(samples) {
  if (!samples?.length) return null;
  const s = [...samples].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
