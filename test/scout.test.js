// Testes dos mais jogados dos aliados (histórico do cliente do LoL).
import assert from 'node:assert/strict';
import { parseHistory, topChampions, roleOfGame } from '../lib/scout.js';
import { lcu } from '../lib/lcu.js';
import { normalizeSession } from '../lib/lcu-draft.js';

const G = (championId, lane, role, win, extra = {}) => ({
  mapId: 11, gameMode: 'CLASSIC', queueId: 400,
  participantIdentities: [{ participantId: 1, player: { puuid: 'A' } }],
  participants: [{ participantId: 1, championId, stats: { win }, timeline: { lane, role } }], ...extra,
});
const hist = { games: { games: [
  G(103, 'MIDDLE', 'SOLO', true), G(103, 'MIDDLE', 'SOLO', false), G(7, 'MIDDLE', 'SOLO', true),
  G(103, 'MIDDLE', 'SOLO', true), G(61, 'MIDDLE', 'SOLO', true), G(7, 'MIDDLE', 'SOLO', false),
  G(222, 'BOTTOM', 'DUO_CARRY', true), G(412, 'BOTTOM', 'DUO_SUPPORT', true), G(64, 'JUNGLE', 'NONE', false),
  G(99, 'NONE', 'NONE', true, { mapId: 12, gameMode: 'ARAM' }), // ARAM não conta
] } };

assert.equal(roleOfGame({ timeline: { lane: 'BOTTOM', role: 'DUO_SUPPORT' } }), 'S');
assert.equal(roleOfGame({ timeline: { lane: 'BOTTOM', role: 'DUO_CARRY' } }), 'A');
const games = parseHistory(hist, 'A');
assert.equal(games.length, 9);
assert.deepEqual(games[6], { championId: 222, role: 'A', win: true });

// Rota conhecida: os 3 mais jogados no meio
let t = topChampions(games, 'M');
assert.equal(t.byRole, 'M');
assert.deepEqual(t.top.map((x) => x.champion), [103, 7, 61]);
assert.deepEqual(t.top[0], { champion: 103, games: 3, wins: 2 });
assert.equal(t.games, 6); assert.equal(t.total, 9);
// Rota com poucos jogos (suporte, 1 jogo): cai para o geral
t = topChampions(games, 'S');
assert.equal(t.byRole, '');
assert.equal(t.top[0].champion, 103);
// Sem rota: geral
assert.equal(topChampions(games, '').top.length, 3);

// No conector: o resumo vai por vaga (cellId), com a rota da vaga, e o puuid não sai
const raw = {
  localPlayerCellId: 0, actions: [], bans: {}, timer: { phase: 'BAN_PICK' },
  myTeam: [
    { cellId: 0, puuid: 'ME', championId: 0, assignedPosition: 'top', nameVisibilityType: 'VISIBLE', gameName: 'Eu', tagLine: 'BR1' },
    { cellId: 1, puuid: 'A', championId: 0, assignedPosition: 'middle', nameVisibilityType: 'VISIBLE', gameName: 'Amigo', tagLine: 'BR1' },
    { cellId: 2, puuid: 'H', championId: 0, assignedPosition: 'jungle', nameVisibilityType: 'HIDDEN' },
  ],
  theirTeam: [],
};
lcu.source = 'cliente';
lcu.raw = raw;
lcu.session = normalizeSession(raw);
lcu.scout.set('A', { status: 'ok', games });
lcu.scout.set('ME', { status: 'carregando' });
const snap = lcu.snapshot();
assert.equal(snap.scout[1].byRole, 'M');
assert.deepEqual(snap.scout[1].top.map((x) => x.champion), [103, 7, 61]);
assert.equal(snap.scout[0].status, 'carregando');
assert.equal(snap.scout[2], undefined);
assert.ok(!JSON.stringify(snap.scout).includes('"A"'));
// Sem cliente conectado não busca nada (e não quebra)
lcu.client = null;
lcu.scoutAllies(raw);
console.log('Todos os testes dos mais jogados passaram.');
