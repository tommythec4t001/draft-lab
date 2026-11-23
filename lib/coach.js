// Coach pós-partida: tira os fatos de uma partida sua (resumo + linha do tempo da Riot, match-v5)
// e compara com as partidas do elo coletadas pelo Draft Lab. O texto em tom de coach fica em coach-falas.js.
import { metricsOf, METRICS, percentile, median } from './metrics.js';

const POS = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' };
const OBJ = { DRAGON: 'dragão', BARON_NASHOR: 'Barão', RIFTHERALD: 'Arauto', HORDE: 'Vastilarvas', ELDER_DRAGON: 'Dragão Ancião' };
// Tempo para renascer por nível (segundos), sem o acréscimo do fim de jogo: dá a janela em que você estava morto.
const RENASCER = [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5];
const MIN_AMOSTRAS = 30;

// Referência aproximada (mediana de Esmeralda+) para quando ainda não há partidas do elo coletadas.
const REF = {
  T: { csm: 6.9, cs10: 68, gpm: 400, kp: 45, kda: 2.4, dpm: 650, deaths: 5.5, vspm: 0.75, control: 2 },
  J: { csm: 5.7, cs10: 58, gpm: 390, kp: 62, kda: 3.0, dpm: 520, deaths: 5.5, vspm: 1.05, control: 4 },
  M: { csm: 7.3, cs10: 74, gpm: 410, kp: 55, kda: 2.8, dpm: 780, deaths: 5.5, vspm: 0.8, control: 2 },
  A: { csm: 7.7, cs10: 76, gpm: 430, kp: 55, kda: 2.8, dpm: 780, deaths: 5.5, vspm: 0.75, control: 2 },
  S: { csm: 1.1, cs10: 10, gpm: 280, kp: 62, kda: 3.0, dpm: 380, deaths: 6, vspm: 2.3, control: 7 },
};

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Percentil aproximado contra a referência, quando não há amostras: 50 na referência, ±50% leva a 5/95.
function pctAprox(valor, ref, lower) {
  if (valor == null || !ref) return null;
  const r = lower ? ref / Math.max(valor, 0.5) : valor / ref;
  return Math.max(5, Math.min(95, Math.round(50 + (r - 1) * 90)));
}

export function letraDe(pct) {
  if (pct == null) return null;
  return pct >= 80 ? 'S' : pct >= 65 ? 'A' : pct >= 48 ? 'B' : pct >= 33 ? 'C' : 'D';
}

// match: MatchDto, timeline: TimelineDto (pode faltar), puuid: o seu (da mesma chave da API),
// samples: amostras do elo por métrica para a sua rota ({ csm: { v: [...] } }), nome(championId) -> nome.
export function fatos({ match, timeline = null, puuid, samples = {}, nome: nomeCru = (k) => String(k) }) {
  const nome = (k) => nomeCru(k) || 'campeão inimigo';
  const info = match?.info;
  const me = info?.participants?.find((p) => p.puuid === puuid);
  if (!me) throw new Error('Essa partida não é da conta configurada.');
  const role = POS[me.teamPosition] || null;
  const min = (info.gameDuration || 0) / 60;
  const inimigos = info.participants.filter((p) => p.teamId !== me.teamId);
  const opp = role ? inimigos.find((p) => p.teamPosition === me.teamPosition) : null;
  const jgInimigo = inimigos.find((p) => p.teamPosition === 'JUNGLE') || null;

  // ---------- métricas contra o elo ----------
  const m = metricsOf(me, info);
  const ref = REF[role] || REF.M;
  let aprox = false;
  const metricas = METRICS.filter((x) => m[x.id] != null).map((x) => {
    const s = samples?.[x.id]?.v || [];
    if (s.length >= MIN_AMOSTRAS) return { id: x.id, label: x.label, valor: m[x.id], elo: median(s), pct: percentile(s, m[x.id], x.lower), lower: !!x.lower };
    if (ref[x.id] == null) return { id: x.id, label: x.label, valor: m[x.id], elo: null, pct: null, lower: !!x.lower };
    aprox = true;
    return { id: x.id, label: x.label, valor: m[x.id], elo: ref[x.id], pct: pctAprox(m[x.id], ref[x.id], x.lower), lower: !!x.lower };
  });
  const M = Object.fromEntries(metricas.map((x) => [x.id, x]));

  // ---------- linha do tempo ----------
  const frames = timeline?.info?.frames || [];
  const pidDe = {};
  for (const p of info.participants) pidDe[p.puuid] = p.participantId;
  const eu = me.participantId, adv = opp?.participantId, jg = jgInimigo?.participantId;
  const quadro = (min) => frames[Math.min(min, frames.length - 1)];
  const pf = (f, id) => f?.participantFrames?.[String(id)];
  const csDe = (x) => (x?.minionsKilled || 0) + (x?.jungleMinionsKilled || 0);

  let rota = null;
  if (opp && frames.length > 10) {
    const aos = (t) => {
      const f = quadro(t), a = pf(f, eu), b = pf(f, adv);
      if (!a || !b) return null;
      return { min: t, ouro: a.totalGold - b.totalGold, cs: csDe(a) - csDe(b), xp: a.xp - b.xp };
    };
    rota = { oponente: nome(opp.championId), aos10: aos(10), aos14: frames.length > 14 ? aos(14) : null };
  }

  const eventos = frames.flatMap((f) => f.events || []);
  const nivelEm = (t) => pf(quadro(Math.floor(t / 60)), eu)?.level || me.champLevel || 1;
  const mortes = eventos.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === eu).map((e) => {
    const t = Math.round(e.timestamp / 1000);
    const ajud = e.assistingParticipantIds || [];
    const killer = info.participants.find((p) => p.participantId === e.killerId);
    return {
      t,
      quando: mmss(t),
      por: killer ? nome(killer.championId) : 'torre ou tropas',
      ajudantes: ajud.length,
      sozinho: !!killer && ajud.length === 0,
      contraRota: !!adv && e.killerId === adv && ajud.length === 0,
      gank: role !== 'J' && !!jg && (e.killerId === jg || ajud.includes(jg)),
      renascer: RENASCER[Math.min(Math.max(nivelEm(t), 1), 18) - 1],
    };
  });
  const cedo = mortes.filter((d) => d.t <= 14 * 60);

  // Objetivos que o inimigo pegou enquanto você esperava para renascer
  const perdidos = [];
  for (const e of eventos) {
    if (e.type !== 'ELITE_MONSTER_KILL' || e.killerTeamId === me.teamId) continue;
    const tipo = e.monsterType === 'DRAGON' && e.monsterSubType === 'ELDER_DRAGON' ? 'ELDER_DRAGON' : e.monsterType;
    if (!OBJ[tipo]) continue;
    const t = Math.round(e.timestamp / 1000);
    const d = mortes.find((x) => x.t <= t && t - x.t <= x.renascer + 5);
    if (d) perdidos.push({ obj: OBJ[tipo], quando: mmss(t), morteEm: d.quando, depois: t - d.t });
  }

  // Objetivos do seu time
  const doTime = (tipo) => eventos.filter((e) => e.type === 'ELITE_MONSTER_KILL' && e.killerTeamId === me.teamId && e.monsterType === tipo).length;

  // ---------- destaques ----------
  const ch = me.challenges || {};
  const multi = me.pentaKills ? 'penta' : me.quadraKills ? 'quadra' : me.tripleKills ? 'triple' : null;
  const destaques = {
    multi,
    soloKills: ch.soloKills || 0,
    firstBlood: !!me.firstBloodKill,
    semMortes: (me.deaths || 0) === 0 && min >= 15,
  };

  // ---------- nota ----------
  // Média dos percentis que mais dizem sobre a sua parte, ajustada pela fase de rotas. A vitória pesa pouco.
  const peso = role === 'S' ? { kp: 2, vspm: 2, deaths: 1.5, kda: 1, control: 1, dpm: 0.5 } : { csm: 1.5, kp: 1, deaths: 1.5, kda: 1, dpm: 1.5, gpm: 1, vspm: 0.5 };
  let soma = 0, pesos = 0;
  for (const [k, w] of Object.entries(peso)) if (M[k]?.pct != null) { soma += M[k].pct * w; pesos += w; }
  let pct = pesos ? soma / pesos : null;
  const ouro14 = rota?.aos14?.ouro ?? rota?.aos10?.ouro;
  if (pct != null && ouro14 != null && role !== 'S') pct += Math.max(-8, Math.min(8, ouro14 / 150));
  // O que a linha do tempo mostra também pesa: mortes cedo, mortes no um contra um e objetivos perdidos por morte.
  if (pct != null) {
    pct -= Math.max(0, cedo.length - 1) * 4;
    pct -= mortes.filter((d) => d.contraRota).length * 2;
    pct -= perdidos.length * 4;
    pct = Math.round(Math.max(1, Math.min(99, pct + (me.win ? 3 : 0))));
  }

  return {
    id: match.metadata?.matchId,
    v: 1,
    champ: nome(me.championId),
    champKey: me.championId,
    role,
    win: !!me.win,
    remake: (info.gameDuration || 0) < 300 || !!me.gameEndedInEarlySurrender,
    duracao: mmss(info.gameDuration || 0),
    minutos: Math.round(min),
    kda: { k: me.kills || 0, d: me.deaths || 0, a: me.assists || 0 },
    nota: { pct, letra: letraDe(pct) },
    aprox,
    metricas,
    rota,
    jgInimigo: jgInimigo ? nome(jgInimigo.championId) : null,
    mortes,
    mortesCedo: cedo.length,
    ganks: cedo.filter((d) => d.gank).length,
    mortesNaRota: mortes.filter((d) => d.contraRota).length,
    perdidos,
    objetivos: { dragoes: doTime('DRAGON'), baroes: doTime('BARON_NASHOR'), arautos: doTime('RIFTHERALD') },
    controle: me.detectorWardsPlaced ?? ch.controlWardsPlaced ?? null,
    destaques,
    temLinhaDoTempo: frames.length > 0,
  };
}
