import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fatos, letraDe } from '../lib/coach.js';
import { textoCoach } from '../lib/coach-falas.js';

const NOMES = { 1: 'Annie', 2: 'Darius', 3: 'Lee Sin', 4: 'Ahri', 5: 'Jinx', 6: 'Thresh', 7: 'Garen', 8: 'Vi', 9: 'Lux', 10: 'Ezreal' };
const nome = (k) => NOMES[k] || String(k);
const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

// Partida de 30 minutos: você é o Darius no topo (participante 1), contra o Garen (6); Vi é o caçador inimigo (7).
function partida({ win = false, deaths = 6, control = 0, cs = 150 } = {}) {
  const participants = [];
  for (let i = 0; i < 10; i++) {
    const azul = i < 5;
    participants.push({
      participantId: i + 1, puuid: `p${i + 1}`, teamId: azul ? 100 : 200, teamPosition: POS[i % 5],
      championId: [2, 3, 4, 5, 6, 7, 8, 9, 10, 1][i], win: azul ? win : !win,
      kills: i === 0 ? 3 : 2, deaths: i === 0 ? deaths : 3, assists: 4, champLevel: 15,
      totalMinionsKilled: i === 0 ? cs : 200, neutralMinionsKilled: 0, goldEarned: 11000, champExperience: 14000,
      totalDamageDealtToChampions: 15000, visionScore: 20, wardsPlaced: 8, wardsKilled: 2,
      detectorWardsPlaced: i === 0 ? control : 2, turretTakedowns: 1,
      challenges: { soloKills: 0, laneMinionsFirst10Minutes: 55, visionScorePerMinute: 0.7 },
    });
  }
  return { metadata: { matchId: 'BR1_123' }, info: { gameDuration: 1800, participants } };
}

function linhaDoTempo() {
  const frames = [];
  for (let m = 0; m <= 30; m++) {
    const pfs = {};
    for (let i = 1; i <= 10; i++) pfs[i] = { totalGold: 500 + m * 380, xp: m * 500, level: Math.min(18, 1 + Math.floor(m / 2)), minionsKilled: m * 7, jungleMinionsKilled: 0 };
    pfs[1].totalGold -= m * 90; // você fica para trás do Garen
    pfs[1].minionsKilled -= m;
    frames.push({ timestamp: m * 60000, participantFrames: pfs, events: [] });
  }
  // Mortes: 4:10 (Garen sozinho), 7:30 (Garen com a Vi), 12:00 (Garen sozinho), 21:30 (Vi)
  frames[4].events.push({ type: 'CHAMPION_KILL', timestamp: 250000, victimId: 1, killerId: 6, assistingParticipantIds: [] });
  frames[7].events.push({ type: 'CHAMPION_KILL', timestamp: 450000, victimId: 1, killerId: 6, assistingParticipantIds: [7] });
  frames[12].events.push({ type: 'CHAMPION_KILL', timestamp: 720000, victimId: 1, killerId: 6, assistingParticipantIds: [] });
  frames[21].events.push({ type: 'CHAMPION_KILL', timestamp: 1290000, victimId: 1, killerId: 7, assistingParticipantIds: [6] });
  // Barão inimigo 20 s depois da morte das 21:30
  frames[21].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 1310000, killerTeamId: 200, monsterType: 'BARON_NASHOR' });
  // Dragão do seu time
  frames[9].events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 560000, killerTeamId: 100, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON' });
  return { info: { frames } };
}

test('fatos: rota, mortes cedo, gank, objetivo perdido e nota', () => {
  const f = fatos({ match: partida(), timeline: linhaDoTempo(), puuid: 'p1', nome });
  assert.equal(f.champ, 'Darius');
  assert.equal(f.role, 'T');
  assert.equal(f.rota.oponente, 'Garen');
  assert.equal(f.rota.aos14.ouro, -1260);
  assert.equal(f.rota.aos10.cs, -10);
  assert.equal(f.mortes.length, 4);
  assert.equal(f.mortesCedo, 3);
  assert.equal(f.ganks, 1);
  assert.equal(f.mortesNaRota, 2);
  assert.deepEqual(f.perdidos, [{ obj: 'Barão', quando: '21:50', morteEm: '21:30', depois: 20 }]);
  assert.equal(f.objetivos.dragoes, 1);
  assert.equal(f.aprox, true, 'sem amostras do elo, usa a referência aproximada');
  assert.ok(f.nota.pct < 48, `nota baixa esperada, veio ${f.nota.pct}`);
});

test('fatos usa as amostras do elo quando existem', () => {
  const v = Array.from({ length: 100 }, (_, i) => 3 + i * 0.06); // 3,0 a 8,9 CS/min
  const f = fatos({ match: partida(), timeline: linhaDoTempo(), puuid: 'p1', nome, samples: { csm: { v } } });
  const csm = f.metricas.find((m) => m.id === 'csm');
  assert.equal(csm.valor, 5);
  assert.ok(Math.abs(csm.elo - 5.97) < 0.05);
  assert.ok(csm.pct > 25 && csm.pct < 40);
});

test('partida de outra conta é recusada', () => {
  assert.throws(() => fatos({ match: partida(), puuid: 'outro', nome }), /não é da conta/);
});

test('texto sério e divertido: mesmas observações, tons diferentes, estável por partida', () => {
  const f = fatos({ match: partida(), timeline: linhaDoTempo(), puuid: 'p1', nome });
  const s = textoCoach(f, 'serio');
  const d = textoCoach(f, 'divertido');
  assert.equal(s.blocos.length, d.blocos.length);
  assert.notEqual(s.titulo, d.titulo);
  assert.match(s.blocos.map((b) => b.texto).join(' '), /Garen/);
  assert.match(s.blocos.map((b) => b.texto).join(' '), /Barão/);
  assert.match(s.blocos.map((b) => b.texto).join(' '), /Vi/);
  assert.ok(['mortesCedo', 'perdido', 'rota', 'sozinho'].includes(s.focoChave), s.focoChave);
  assert.deepEqual(textoCoach(f, 'serio'), s, 'a mesma partida lê sempre igual');
  assert.ok(s.falado.startsWith(s.titulo) && s.falado.endsWith(s.foco));
  assert.equal(textoCoach(f, 'outro').tom, 'serio');
  for (const b of [...s.blocos, ...d.blocos]) assert.doesNotMatch(b.texto, /\{|\}|undefined|NaN/);
});

test('boa partida sem mortes: elogios e foco em manter', () => {
  const f = fatos({ match: partida({ win: true, deaths: 0, control: 4, cs: 260 }), puuid: 'p1', nome });
  const s = textoCoach(f, 'divertido');
  assert.ok(s.blocos.some((b) => b.tipo === 'bom' && /mortes|morreu/i.test(b.texto)));
  assert.equal(s.blocos.filter((b) => b.tipo === 'ruim').length, 0);
  assert.equal(s.focoChave, 'manter');
  assert.equal(f.temLinhaDoTempo, false);
});

test('letras da nota', () => {
  assert.deepEqual([90, 70, 50, 40, 10, null].map(letraDe), ['S', 'A', 'B', 'C', 'D', null]);
});
