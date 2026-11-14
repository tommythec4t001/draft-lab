// Teste da conexão com o cliente do LoL (sem precisar do jogo aberto):  npm test
import assert from 'node:assert/strict';
import { encodeFrame, decodeFrames } from '../lib/lcu-ws.js';
import { normalizeSession, toProSteps, sanitize } from '../lib/lcu-draft.js';
import { parseLockfile, parseCommandLine } from '../lib/lcu.js';

// ---------- Quadros do WebSocket ----------
for (const size of [5, 300, 70000]) {
  const text = 'x'.repeat(size);
  const { frames, rest } = decodeFrames(encodeFrame(text));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data.toString(), text, `mensagem de ${size} bytes`);
  assert.equal(rest.length, 0);
}
// Quadro cortado no meio espera o resto chegar
const half = encodeFrame('{"a":1}');
assert.equal(decodeFrames(half.subarray(0, 5)).frames.length, 0);

// ---------- Descobrir porta e senha ----------
assert.deepEqual(parseLockfile('LeagueClient:1234:54321:abcDEF-123:https'), { port: 54321, password: 'abcDEF-123', via: 'lockfile' });
assert.equal(parseLockfile('lixo'), null);
const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--riotclient-auth-token=zzz" "--app-port=61234" "--remoting-auth-token=Tok_en-9" "--install-directory=C:/Riot Games/League of Legends"';
const found = parseCommandLine(cmd);
assert.equal(found.port, 61234);
assert.equal(found.password, 'Tok_en-9');

// ---------- Sessão do champ select ----------
const member = (cellId, team, pos, extra = {}) => ({ cellId, team, assignedPosition: pos, championId: 0, championPickIntent: 0, gameName: `Jogador${cellId}`, tagLine: 'BR1', nameVisibilityType: 'HIDDEN', puuid: `p${cellId}`, ...extra });
const session = {
  localPlayerCellId: 7,
  myTeam: [member(5, 2, 'top', { nameVisibilityType: 'VISIBLE' }), member(6, 2, 'jungle', { championPickIntent: 64 }), member(7, 2, 'middle', { championId: 103 }), member(8, 2, 'bottom'), member(9, 2, 'utility')],
  theirTeam: [member(0, 1, 'top', { championId: 150, nameVisibilityType: 'VISIBLE' }), member(1, 1, 'jungle'), member(2, 1, 'middle'), member(3, 1, 'bottom'), member(4, 1, 'utility')],
  actions: [
    [{ actorCellId: 0, championId: 72, completed: true, type: 'ban' }, { actorCellId: 5, championId: 254, completed: true, type: 'ban' }],
    [{ actorCellId: 0, championId: 150, completed: true, type: 'pick' }],
    [{ actorCellId: 7, championId: 103, completed: false, isInProgress: true, isAllyAction: true, type: 'pick' }],
  ],
  timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 20000, totalTimeInPhase: 30000 },
};
const d = normalizeSession(session, 1000);
assert.equal(d.mySide, 'R');
assert.deepEqual(d.bans, { B: [72], R: [254] });
assert.deepEqual(d.picks, { B: [150], R: [] });
assert.equal(d.timer.endsAt, 21000);
assert.deepEqual(d.current, { side: 'R', type: 'pick', ally: true, cellId: 7, champion: 103 });

const red = d.players.R, blue = d.players.B;
// Anonimato: você aparece; aliado do grupo aparece; os outros viram Aliado N / Inimigo N
assert.equal(red[2].label, 'Você');
assert.equal(red[2].name, 'Jogador7#BR1');
assert.equal(red[0].name, 'Jogador5#BR1');
assert.equal(red[1].name, null);
assert.equal(red[1].label, 'Aliado 2');
assert.equal(blue[0].name, null, 'nome do inimigo nunca aparece');
assert.equal(blue[0].label, 'Inimigo 1');
// Hover: o seu em andamento e a intenção do aliado; o inimigo só aparece quando trava
assert.equal(red[2].hover, 103);
assert.equal(red[2].champion, 0);
assert.equal(red[1].hover, 64);
assert.equal(blue[0].champion, 150);
assert.equal(blue[1].hover, 0);
assert.deepEqual(red.map((p) => p.role), ['T', 'J', 'M', 'A', 'S']);

// Casas do draft profissional
const steps = toProSteps(d);
assert.equal(steps[0], 72);   // primeiro ban do azul
assert.equal(steps[1], 254);  // primeiro ban do vermelho
assert.equal(steps[6], 150);  // primeiro pick do azul
assert.equal(normalizeSession(null), null);

// Gravação sem dados pessoais
const clean = JSON.stringify(sanitize(session));
assert.ok(!clean.includes('Jogador') && !clean.includes('puuid'), 'gravação sem nomes nem ids de conta');
assert.ok(clean.includes('"championId":103'));

console.log('lcu: ok');
