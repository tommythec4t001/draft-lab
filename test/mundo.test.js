// Testes do leaderboard, da busca de jogadores e do resumo de partidas (API da Riot falsa).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DRAFTLAB_DATA = mkdtempSync(join(tmpdir(), 'dl-mundo-'));
const { leaderboard, buscarJogador, parseRiotId, partidaResumo, REGIOES } = await import('../lib/mundo.js');
const { RiotApi } = await import('../lib/riot-api.js');

// Riot falsa: responde pelo caminho do pedido e conta os pedidos
const calls = [];
const P = (i) => `puuid-${i}`;
const entries = (n, base, off = 0) => Array.from({ length: n }, (_, i) => ({ puuid: P(off + i), leaguePoints: base - i * 10, wins: 100 + i, losses: 80 }));
const match = (id, puuid, win, champ = 'Ahri', key = 103, queue = 420) => ({
  metadata: { matchId: id },
  info: { queueId: queue, gameDuration: 1800, gameStartTimestamp: Date.now() - 3600e3, participants: [
    { puuid, championName: champ, championId: key, win, teamPosition: 'MIDDLE', kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 200, neutralMinionsKilled: 10, champLevel: 16, item0: 3089, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 3340 },
    { puuid: 'outro', championName: 'Zed', championId: 238, win: !win, teamPosition: 'MIDDLE' },
  ] },
});
const routes = [
  [/challengerleagues\/by-queue\/RANKED_SOLO_5x5/, () => ({ entries: entries(3, 1500) })],
  [/grandmasterleagues\/by-queue\/RANKED_SOLO_5x5/, () => ({ entries: entries(30, 900, 3) })],
  [/masterleagues/, () => ({ entries: entries(5, 200, 40) })],
  [/accounts\/by-puuid\/(puuid-\d+)/, (m) => ({ puuid: m[1], gameName: 'Jogador ' + m[1].split('-')[1], tagLine: 'BR1' })],
  [/accounts\/by-riot-id\/Enzo\/BR1/, () => ({ puuid: 'enzo', gameName: 'Enzo', tagLine: 'BR1' })],
  [/accounts\/by-riot-id\/Faker\/KR1/, () => ({ puuid: 'faker', gameName: 'Hide on bush', tagLine: 'KR1' })],
  [/region\/by-game\/lol\/by-puuid\/faker/, () => ({ puuid: 'faker', game: 'lol', region: 'kr' })],
  [/region\/by-game/, () => null],
  [/summoners\/by-puuid\/(\w+)/, () => ({ profileIconId: 29, summonerLevel: 312 })],
  [/entries\/by-puuid\/enzo/, () => [
    { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 40, wins: 10, losses: 12 },
    { queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'I', leaguePoints: 75, wins: 60, losses: 50 },
    { queueType: 'CHERRY', tier: 'GOLD', rank: 'I', leaguePoints: 0, wins: 1, losses: 1 },
  ]],
  [/entries\/by-puuid/, () => []],
  [/by-puuid\/enzo\/ids/, () => ['BR1_1', 'BR1_2', 'BR1_3']],
  [/by-puuid\/faker\/ids/, () => []],
  [/matches\/BR1_1$/, () => match('BR1_1', 'enzo', true)],
  [/matches\/BR1_2$/, () => match('BR1_2', 'enzo', false)],
  [/matches\/BR1_3$/, () => match('BR1_3', 'enzo', true, 'Syndra', 134, 450)],
];
const fetchFn = async (url) => {
  calls.push(url);
  for (const [re, f] of routes) {
    const m = url.match(re);
    if (m) { const body = f(m); return { status: body == null ? 404 : 200, json: async () => body, headers: new Map() }; }
  }
  return { status: 404, json: async () => null, headers: new Map() };
};
const apiOf = (platform) => new RiotApi({ key: 'k', platform, fetchFn, limits: [[1000, 1000]] });

// Riot ID: com tag, sem tag (usa a do servidor) e inválido
assert.deepEqual(parseRiotId('Enzo#BR1', 'kr'), { nome: 'Enzo', tag: 'BR1', comTag: true });
assert.deepEqual(parseRiotId('Faker', 'kr'), { nome: 'Faker', tag: 'KR1', comTag: false });
assert.equal(parseRiotId('  ', 'br1'), null);
assert.equal(REGIOES.euw1.tag, 'EUW');

// Leaderboard: Desafiante + Grão-Mestre em ordem de PdL; Mestre só se faltar gente; nomes pela conta
let lb = await leaderboard(apiOf('br1'), 'RANKED_SOLO_5x5', { pagina: 1, por: 25 });
assert.equal(lb.total, 38);
assert.equal(lb.paginas, 2);
assert.equal(lb.entradas[0].pos, 1);
assert.equal(lb.entradas[0].elo, 'Desafiante');
assert.equal(lb.entradas[0].nome, 'Jogador 0');
assert.equal(lb.entradas[3].elo, 'Grão-Mestre');
assert.ok(lb.entradas.every((e, i, a) => !i || a[i - 1].lp >= e.lp));
assert.equal(lb.entradas[0].wr, 55.6);
// Página 2 usa o ranking guardado (sem pedir as ligas de novo) e só busca os nomes que faltam
const antes = calls.filter((u) => /leagues/.test(u)).length;
lb = await leaderboard(apiOf('br1'), 'RANKED_SOLO_5x5', { pagina: 2, por: 25 });
assert.equal(calls.filter((u) => /leagues/.test(u)).length, antes);
assert.equal(lb.entradas[0].pos, 26);
assert.equal(lb.entradas.length, 13);
const nomes = calls.filter((u) => /accounts\/by-puuid/.test(u)).length;
await leaderboard(apiOf('br1'), 'RANKED_SOLO_5x5', { pagina: 1, por: 25 });
assert.equal(calls.filter((u) => /accounts\/by-puuid/.test(u)).length, nomes); // nomes em cache
await assert.rejects(() => leaderboard(apiOf('br1'), 'ARAM'));

// Busca: perfil com elos (Solo/Duo primeiro), partidas de qualquer fila e mais jogados
const r = await buscarJogador(apiOf, 'Enzo#BR1', 'br1');
assert.equal(r.jogador.nome, 'Enzo');
assert.equal(r.jogador.regiao, 'br1');
assert.equal(r.jogador.nivel, 312);
assert.deepEqual(r.elos.map((e) => e.fila), ['Solo/Duo', 'Flex']);
assert.equal(r.elos[0].elo, 'Esmeralda');
assert.equal(r.elos[0].wr, 54.5);
assert.equal(r.partidas.length, 3);
assert.equal(r.partidas[2].fila, 'ARAM');
assert.equal(r.partidas[0].cs, 210);
assert.deepEqual(r.campeoes.map((c) => [c.campeao, c.jogos, c.vitorias]), [['Ahri', 2, 1], ['Syndra', 1, 1]]);
// Sem tag: usa a do servidor escolhido; a Riot diz em que servidor a conta joga
const f = await buscarJogador(apiOf, 'Faker', 'kr');
assert.equal(f.jogador.nome, 'Hide on bush');
assert.equal(f.jogador.regiao, 'kr');
assert.equal(f.jogador.regiaoNome, 'Coreia');
// Não encontrado
assert.match((await buscarJogador(apiOf, 'Ninguem', 'euw1')).erro, /Ninguem#EUW/);
assert.match((await buscarJogador(apiOf, '', 'br1')).erro, /Riot ID/);

// Resumo de partida: jogador que não está na partida
assert.equal(partidaResumo(match('X', 'a', true), 'b'), null);
console.log('Todos os testes do leaderboard e da busca passaram.');
