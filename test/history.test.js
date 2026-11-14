// Teste do histórico de partidas e das métricas de desempenho:  npm test
import assert from 'node:assert/strict';
import { summarize } from '../lib/history.js';
import { metricsOf, percentile, median, addSamples, METRICS } from '../lib/metrics.js';

const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const part = (i, team, extra = {}) => ({
  puuid: `p${team}${i}`, championId: 100 + i + (team === 200 ? 10 : 0), teamId: team, teamPosition: POS[i], win: team === 100,
  kills: 2, deaths: 2, assists: 2, totalMinionsKilled: 180, neutralMinionsKilled: 0, goldEarned: 12000, champExperience: 15000,
  totalDamageDealtToChampions: 20000, wardsPlaced: 10, detectorWardsPlaced: 2, wardsKilled: 3, turretTakedowns: 2,
  summoner1Id: 4, summoner2Id: 12, item0: 3078, item6: 3340,
  perks: { styles: [{ style: 8000, selections: [{ perk: 8010 }] }, { style: 8400 }] },
  challenges: { laneMinionsFirst10Minutes: 70, dragonTakedowns: 1, voidMonsterKill: 2, turretPlatesTaken: 3, visionScorePerMinute: 0.6 },
  ...extra,
});
const match = {
  metadata: { matchId: 'BR1_1' },
  info: { queueId: 420, gameDuration: 1800, gameStartTimestamp: 1, gameVersion: '16.22.1.1',
    participants: [...[0, 1, 2, 3, 4].map((i) => part(i, 100, i === 0 ? { puuid: 'eu', kills: 8, deaths: 2, assists: 6 } : {})), ...[0, 1, 2, 3, 4].map((i) => part(i, 200))] },
};

const s = summarize(match, 'eu');
assert.equal(s.id, 'BR1_1');
assert.equal(s.win, true);
assert.equal(s.me.pos, 'T');
assert.equal(s.opp, 110, 'oponente de rota: o top do outro time');
assert.equal(s.me.rune, 8010);
assert.equal(s.players.length, 10);
assert.ok(!JSON.stringify(s.players).includes('p200'), 'sem ids de conta dos outros jogadores');
assert.equal(summarize({ ...match, info: { ...match.info, queueId: 450 } }, 'eu'), null, 'ARAM fica de fora');
assert.equal(summarize(match, 'outro'), null);

// Métricas: 30 minutos de jogo
const m = s.me.metrics;
assert.equal(m.csm, 6);
assert.equal(m.gpm, 400);
assert.equal(m.kp, 87.5, '(8 + 6) / 16 abates do time');
assert.equal(m.kda, 7);
assert.equal(m.grubs, 2);
assert.ok(METRICS.every((x) => x.id in m), 'todas as métricas presentes');
assert.deepEqual(metricsOf(part(0, 100), { ...match.info, gameDuration: 120 }), {}, 'partida curta demais');

// Percentil
const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
assert.equal(percentile(v, 8), 75);
assert.equal(percentile(v, 3, true), 75, 'menos é melhor: 3 mortes é melhor que 75%');
assert.equal(median(v), 5.5);
assert.equal(percentile([], 3), null);
const store = {};
for (let i = 0; i < 2500; i++) addSamples(store, 'T', { csm: i });
assert.equal(store.T.csm.v.length, 2000, 'guarda no máximo 2.000 amostras');
assert.equal(store.T.csm.n, 2500);

console.log('Todos os testes do histórico e das métricas passaram.');
