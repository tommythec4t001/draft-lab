// Testes do Fearless ao vivo (lib/esports.js) e das Configs LoL (lib/lolconfig.js), sem internet.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DRAFTLAB_DATA = mkdtempSync(join(tmpdir(), 'dl-pro-'));
const { agenda, partida, imageCode, imageUrlOf, setEsportsBase } = await import('../lib/esports.js');
const L = await import('../lib/lolconfig.js');

// ---------- API do lolesports falsa ----------
const team = (id, code) => ({ id, name: code + ' Esports', code, image: `http://static.lolesports.com/teams/${code}.png` });
const A = team('1', 'AAA'), B = team('2', 'BBB');
const ev = (id, state, start) => ({ startTime: new Date(Date.now() + start).toISOString(), state, type: 'match', league: { name: 'LCK', slug: 'lck' },
  match: { id, strategy: { count: 3 }, teams: [{ ...A, result: { gameWins: 1, outcome: state === 'completed' ? 'win' : null } }, { ...B, result: { gameWins: 0 } }] } });
let windowCalls = 0;
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const j = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  assert.equal(req.headers['x-api-key'] ? true : u.pathname.startsWith('/feed'), true);
  if (u.pathname === '/gw/getLive') return j({ data: { schedule: { events: [ev('9', 'inProgress', -1000)] } } });
  if (u.pathname === '/gw/getSchedule') return j({ data: { schedule: { pages: {}, events: [ev('9', 'unstarted', -1000), ev('8', 'completed', -9e7), ev('7', 'unstarted', 9e7), { type: 'show', state: 'unstarted' }] } } });
  if (u.pathname === '/gw/getEventDetails') return j({ data: { event: { id: '9', league: { name: 'LCK' }, match: { strategy: { count: 3 }, teams: [{ ...A, result: { gameWins: 1 } }, { ...B, result: { gameWins: 0 } }],
    games: [{ number: 2, id: 'G2', state: 'inProgress', teams: [{ id: '2', side: 'blue' }, { id: '1', side: 'red' }] }, { number: 1, id: 'G1', state: 'completed', teams: [{ id: '1', side: 'blue' }, { id: '2', side: 'red' }] }, { number: 3, id: 'G3', state: 'unstarted', teams: [] }] } } } });
  const w = u.pathname.match(/^\/feed\/window\/(\w+)$/);
  if (w) {
    windowCalls++;
    const p = (off) => ({ participantMetadata: ['support', 'top', 'jungle', 'mid', 'bottom'].map((r, i) => ({ championId: `${w[1]}c${off + i}`, summonerName: `p${off + i}`, role: r })) });
    return j({ gameMetadata: { blueTeamMetadata: p(0), redTeamMetadata: p(5) }, frames: [{ gameState: 'in_game', blueTeam: { totalGold: 5000, totalKills: 2, towers: 0, barons: 0, dragons: ['a'] }, redTeam: { totalGold: 4000, totalKills: 1, towers: 1, barons: 0, dragons: [] } }] });
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
setEsportsBase(base + '/gw', base + '/feed');

const ag = await agenda();
assert.deepEqual(ag.aoVivo.map((x) => x.id), ['9'], 'o getLive marca a partida 9 como ao vivo');
assert.deepEqual(ag.recentes.map((x) => x.id), ['8']);
assert.deepEqual(ag.proximas.map((x) => x.id), ['7']);
assert.equal(ag.aoVivo[0].teams[0].code, 'AAA');
assert.match(ag.aoVivo[0].teams[0].logo, /^\/img\/time\/[0-9a-f]{20}$/);
assert.equal(imageUrlOf(ag.aoVivo[0].teams[0].logo.split('/').pop()), 'https://static.lolesports.com/teams/AAA.png');
assert.equal(imageCode('https://evil.example.com/x.png'), null, 'logo de outro site não passa');

const m = await partida('9');
assert.deepEqual(m.games.map((g) => g.number), [1, 2, 3], 'jogos em ordem');
assert.equal(m.state, 'ao-vivo');
assert.equal(m.games[0].picks.blue[0].role, 'T', 'campeões na ordem das rotas');
assert.equal(m.games[0].picks.blue[0].champion, 'G1c1');
assert.equal(m.games[0].placar, null, 'jogo terminado não tem placar');
assert.equal(m.games[1].placar.blue.gold, 5000, 'jogo ao vivo tem placar');
assert.equal(m.games[1].placar.blue.dragons, 1);
assert.equal(m.games[1].sides.blue, '2');
assert.equal(m.games[2].picks, null);
const calls = windowCalls;
await partida('9');
assert.equal(windowCalls - calls, 2, 'o jogo terminado fica guardado; só o ao vivo é buscado de novo');
await assert.rejects(partida('abc'), /inválido/);
srv.close();

// ---------- Configs LoL ----------
const settings = { General: { WaitForVerticalSync: true, WindowMode: 2 }, Performance: { ShadowQuality: 4, EffectsQuality: 0, EnvironmentQuality: 3, EnableFXAA: true, CharacterInking: '1', FrameCapType: 4 } };
const plano = L.planoJogo(settings);
assert.deepEqual(plano.patch, { General: { WaitForVerticalSync: false }, Performance: { ShadowQuality: 0, EnvironmentQuality: 0, EnableFXAA: false, CharacterInking: '0' } });
assert.equal(plano.old.Performance.ShadowQuality, 4);
assert.ok(!('EffectsQuality' in plano.patch.Performance), 'qualidade já mais baixa não sobe');
assert.ok(!('FrameCapType' in plano.patch.Performance) && !('WindowMode' in plano.patch.General), 'limite de FPS e modo de tela ficam');

// Cliente falso e comandos do Windows falsos
const calls2 = [];
const state = { settings: JSON.parse(JSON.stringify(settings)), ux: { schemaVersion: 2, data: { potatoModeEnabled: false, closeLeagueClientDuringGame: false, outra: 1 } } };
const lcu = {
  flow: 'Lobby',
  async request(method, path, body) {
    calls2.push([method, path]);
    if (path === '/lol-game-settings/v1/game-settings') { if (method === 'GET') return JSON.parse(JSON.stringify(state.settings)); for (const [s, o] of Object.entries(body)) Object.assign(state.settings[s], o); return null; }
    if (path === '/lol-settings/v1/local/lol-user-experience') { if (method === 'GET') return JSON.parse(JSON.stringify(state.ux)); state.ux = body; return null; }
    if (path === '/data-store/v1/install-dir') return 'D:/Jogos/Riot Games/League of Legends';
    return null;
  },
};
let scheme = '381b4222-f694-41f0-9685-ff5bb260df2e', gpu = null;
const cmds = [];
L._setRunner(async (cmd, args) => {
  cmds.push([cmd, ...args].join(' '));
  if (cmd === 'powercfg' && args[0] === '/getactivescheme') return `GUID do Esquema de Energia: ${scheme}  (Equilibrado)`;
  if (cmd === 'powercfg' && args[0] === '/setactive') { scheme = args[1]; return ''; }
  if (cmd === 'reg' && args[0] === 'query') { if (gpu == null) throw new Error('não existe'); return `    ${args[3]}    REG_SZ    ${gpu}\n`; }
  if (cmd === 'reg' && args[0] === 'add') { gpu = args[7]; return ''; }
  if (cmd === 'reg' && args[0] === 'delete') { gpu = null; return ''; }
  return '';
});
await assert.rejects(L.aplicarFps({ ...lcu, flow: 'InProgress' }), /Termine a partida/);
const r = await L.aplicarFps(lcu);
assert.ok(r.passos.every((p) => p.ok), JSON.stringify(r.passos));
assert.equal(state.settings.Performance.ShadowQuality, 0);
assert.equal(state.settings.General.WaitForVerticalSync, false);
assert.ok(calls2.some(([m, p]) => m === 'POST' && p === '/lol-game-settings/v1/save'), 'salva as configurações');
assert.deepEqual(state.ux.data, { potatoModeEnabled: true, closeLeagueClientDuringGame: true, outra: 1 });
assert.equal(scheme, '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');
assert.equal(gpu, 'GpuPreference=2;');
assert.ok(cmds.some((c) => c.includes('D:\\Jogos\\Riot Games\\League of Legends\\Game\\League of Legends.exe')));
assert.ok(await L.temBackup());
// Aplicar de novo não perde os valores originais
await L.aplicarFps(lcu);
const back = await L.restaurar(lcu);
assert.ok(back.passos.every((p) => p.ok), JSON.stringify(back.passos));
assert.equal(state.settings.Performance.ShadowQuality, 4, 'sombras de volta');
assert.equal(state.settings.General.WaitForVerticalSync, true);
assert.equal(state.ux.data.potatoModeEnabled, false);
assert.equal(scheme, '381b4222-f694-41f0-9685-ff5bb260df2e', 'plano de energia de volta');
assert.equal(gpu, null, 'escolha da placa apagada');
assert.equal(await L.temBackup(), null, 'backup apagado depois de restaurar');
await assert.rejects(L.restaurar(lcu), /nada para restaurar/);


// ---------- Prioridade no competitivo (gol.gg) ----------
{
  const M = await import('../lib/meta.js');
  const champs = [{ id: 'Azir', name: 'Azir' }, { id: 'MonkeyKing', name: 'Wukong' }, { id: 'KSante', name: "K'Sante" }, { id: 'Teemo', name: 'Teemo' }];
  const html = `<html><table><tr><th>Champion</th><th>Picks</th><th>Bans</th><th>Prio. Score</th><th>Winrate</th></tr>
    <tr><td><img alt="Azir"></td><td>60</td><td>40</td><td>x</td><td>52.0%</td></tr>
    <tr><td>Wukong</td><td>20</td><td>5</td><td>x</td><td>48%</td></tr>
    <tr><td>KSante</td><td>10</td><td>0</td><td>x</td><td>40%</td></tr>
    <tr><td>Teemo</td><td>110</td><td>0</td><td>x</td><td>50%</td></tr><tr><td>Desconhecido</td><td>1</td><td>0</td><td>x</td><td>50%</td></tr></table></html>`;
  const r = M.parseGolgg(html, champs);
  assert.equal(r.jogos, 20, '200 picks / 10');
  assert.equal(r.champions.Azir.pr, 500, 'presença = (picks + bans) / jogos');
  assert.equal(r.champions.Wukong.pr, 125);
  assert.equal(r.champions["K'Sante"].wr, 40);
  assert.equal(r.champions.Teemo.pr, 550); assert.equal(Object.keys(r.champions).length, 4, "nome que não é campeão fica de fora");
  assert.equal(M.tierOf(45), 'S'); assert.equal(M.tierOf(25), 'A'); assert.equal(M.tierOf(12.1), 'B'); assert.equal(M.tierOf(4), 'C'); assert.equal(M.tierOf(1), 'D'); assert.equal(M.tierOf(null), 'D');
  assert.equal(M.seasonOf(2026), 'S16');
  // Servidor falso do gol.gg: lê, guarda em cache e usa a cópia salva quando cai
  let hits = 0, down = false;
  const g = createServer((req, res) => { hits++; if (down) { res.writeHead(503); return res.end(); } assert.match(req.url, /^\/champion\/list\/season-S16\/split-ALL\/tournament-ALL\//); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
  await new Promise((ok) => g.listen(0, ok));
  M.setGolggBase(`http://127.0.0.1:${g.address().port}`);
  const now = Date.UTC(2026, 10, 14);
  const a = await M.prioridade(champs, { now });
  assert.equal(a.temporada, 'S16'); assert.equal(a.champions.Azir.pr, 500);
  await M.prioridade(champs, { now: now + 1000 });
  assert.equal(hits, 1, 'cache de 6 horas');
  down = true;
  const b = await M.prioridade(champs, { now, fresh: true });
  assert.equal(b.antigo, true, 'sem o gol.gg, usa a última leitura');
  g.close();
}

console.log('Todos os testes do Fearless ao vivo e das Configs LoL passaram.');
