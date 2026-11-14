// Teste das estatísticas de soloQ, com uma API da Riot de mentira (sem internet e sem chave):  npm test
import assert from 'node:assert/strict';
import { addMatch, emptyBook, mergeBooks, view, patchOf, newer, collector } from '../lib/soloq.js';
import { RiotApi, KeyError } from '../lib/riot-api.js';

const POS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
// Partida falsa: azul (100) com os campeões de "blue", vermelho (200) com "red"
function match(id, blue, red, blueWins, version = '16.22.734.1', extra = {}) {
  const ps = [...blue.map((c, i) => ({ championId: c, teamId: 100, teamPosition: POS[i], win: blueWins })), ...red.map((c, i) => ({ championId: c, teamId: 200, teamPosition: POS[i], win: !blueWins }))];
  return { metadata: { matchId: id }, info: { queueId: 420, gameVersion: version, gameDuration: 1800, participants: ps, teams: [{ teamId: 100, bans: [{ championId: 99 }, { championId: -1 }] }, { teamId: 200, bans: [{ championId: 98 }] }] }, ...extra };
}

assert.equal(patchOf('16.22.734.1'), '16.22');
assert.ok(newer('16.23', '16.22') && newer('17.1', '16.24') && !newer('16.22', '16.22'));

// ---------- Soma das partidas ----------
const book = emptyBook('16.22', 'EMERALD+', 'br1');
assert.ok(addMatch(book, match('BR1_1', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true)));
assert.ok(addMatch(book, match('BR1_2', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], false)));
assert.ok(addMatch(book, match('BR1_3', [6, 2, 3, 4, 5], [1, 7, 8, 9, 10], true)));
assert.ok(!addMatch(book, match('BR1_4', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true, '16.21.1.1')), 'patch antigo não conta');
const remake = match('BR1_5', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true); remake.info.gameDuration = 200;
assert.ok(!addMatch(book, remake), 'remake não conta');
const aram = match('BR1_6', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true); aram.info.queueId = 450;
assert.ok(!addMatch(book, aram), 'só ranqueada solo/duo');

assert.equal(book.matches, 3);
assert.deepEqual({ g: book.champs[1].g, w: book.champs[1].w }, { g: 3, w: 1 });
assert.equal(book.champs[99].b, 3);
assert.deepEqual(book.champs[1].roles.T, { g: 3, w: 1 });
assert.deepEqual(book.lane[1][6], { g: 3, w: 1 }, 'top 1 contra top 6');
assert.deepEqual(book.duo[2][3], { g: 3, w: 2 }, 'jungle 2 com mid 3');

// ---------- Formato da tela ----------
const names = { 1: 'Aatrox', 2: 'Vi', 3: 'Ahri', 6: 'Gnar', 99: 'Zed' };
const v = view(book, (k) => names[k] || null);
assert.equal(v.matches, 3);
assert.equal(v.champions.Aatrox.wr, 33.3);
assert.equal(v.champions.Aatrox.pr, 100);
assert.equal(v.champions.Zed.ban, 100);
assert.equal(v.champions.Aatrox.roles.T.share, 100);
assert.deepEqual(v.lane.Aatrox.Gnar, { g: 3, w: 1 });

const both = mergeBooks(book, book);
assert.equal(both.matches, 6);
assert.equal(both.champs[1].g, 6);
assert.equal(both.lane[1][6].g, 6);
assert.equal(book.champs[1].g, 3, 'juntar não altera o original');

// ---------- Limite de pedidos e erros da Riot ----------
{
  const calls = [];
  let n = 0;
  const fakeFetch = async (url) => {
    calls.push(Date.now()); n++;
    if (n === 2) return { status: 429, headers: { get: () => '0.1' }, json: async () => ({}) };
    return { status: 200, headers: { get: () => null }, json: async () => ({ ok: n }) };
  };
  const api = new RiotApi({ key: 'x', limits: [[3, 300]], fetchFn: fakeFetch });
  const t0 = Date.now();
  const r = await Promise.all([1, 2, 3, 4].map(() => api.get('platform', '/a')));
  assert.equal(r.length, 4);
  assert.ok(Date.now() - t0 >= 300, 'esperou a janela de 3 pedidos');
  const denied = new RiotApi({ key: 'x', fetchFn: async () => ({ status: 403, headers: { get: () => null } }) });
  await assert.rejects(denied.get('region', '/b'), KeyError);
}

// ---------- Coleta completa contra uma Riot de mentira ----------
{
  const players = ['p1', 'p2', 'p3'];
  const games = { p1: ['BR1_10', 'BR1_11', 'BR1_OLD'], p2: ['BR1_11', 'BR1_12'], p3: ['BR1_13'] };
  const matches = {
    BR1_10: match('BR1_10', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true),
    BR1_11: match('BR1_11', [6, 2, 3, 4, 5], [1, 7, 8, 9, 10], true),
    BR1_12: match('BR1_12', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], false),
    BR1_13: match('BR1_13', [1, 7, 3, 4, 5], [6, 2, 8, 9, 10], true),
    BR1_OLD: match('BR1_OLD', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true, '16.21.5.1'),
  };
  const ok = (j) => ({ status: 200, headers: { get: () => null }, json: async () => j });
  const fakeFetch = async (url) => {
    const p = new URL(url).pathname;
    if (p.includes('/entries/RANKED_SOLO_5x5/EMERALD/I')) return ok(players.map((puuid) => ({ puuid })));
    if (p.includes('/entries/')) return ok([]);
    if (p.includes('leagues/by-queue')) return ok({ entries: [] });
    const ids = p.match(/by-puuid\/(\w+)\/ids/);
    if (ids) return ok(games[ids[1]]);
    const m = p.match(/matches\/(\w+)$/);
    if (m) return ok(matches[m[1]]);
    return { status: 404, headers: { get: () => null } };
  };
  // Pasta de dados temporária para não mexer nos dados de verdade
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'draftlab-'));
  collector.file = (patch) => join(dir, `soloq_${patch}.json`);
  collector.save = async function () { this.dirty = 0; };
  await collector.start({ key: 'x', platform: 'br1', elo: 'EMERALD+', patch: '16.22' }, { fetchFn: fakeFetch, base: 'http://riot.test' });
  for (let i = 0; i < 100 && collector.book.matches < 4; i++) await new Promise((r) => setTimeout(r, 30));
  await collector.stop();
  assert.equal(collector.book.matches, 4, '4 partidas do patch, a repetida e a antiga ficam de fora');
  assert.equal(collector.builds.matches, 4, 'as mesmas partidas entram nas builds (a linha do tempo pode faltar)');
  assert.equal(collector.error, null);
  await rm(dir, { recursive: true, force: true });
}

console.log('Todos os testes das estatísticas de soloQ passaram.');
