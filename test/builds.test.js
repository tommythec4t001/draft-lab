// Testes das builds, confrontos e histórico de alto elo (lib/builds.js) e da importação (lib/importar.js).
import assert from 'node:assert/strict';
import { skillOrder, readTimeline, addBuildMatch, emptyBuilds, buildView, rolesOfChamp, prune, runeKey, parseRuneKey } from '../lib/builds.js';
import { classifyItems } from '../lib/assets.js';
import { importRunes, importItemSet, importSpells } from '../lib/importar.js';

// Itens: classifica lendários e botas pelo item.json
const items = classifyItems({
  1055: { name: 'Lâmina de Doran', gold: { total: 450 }, tags: [], into: [] },
  2003: { name: 'Poção', gold: { total: 50 }, tags: ['Consumable'], into: [] },
  1001: { name: 'Botas', gold: { total: 300 }, tags: ['Boots'], into: ['3047'] },
  3047: { name: 'Botas de Ninja', gold: { total: 1200 }, tags: ['Boots'], into: [] },
  3071: { name: 'Cutelo Negro', gold: { total: 3000 }, tags: [], into: [] },
  6610: { name: 'Hidra', gold: { total: 3300 }, tags: [], into: [] },
  3053: { name: 'Sterak', gold: { total: 3200 }, tags: [], into: [] },
  3074: { name: 'Hidra Raivosa', gold: { total: 3300 }, tags: [], into: [] },
  1037: { name: 'Picareta', gold: { total: 875 }, tags: [], into: ['3071'] },
  3340: { name: 'Totem', gold: { total: 0 }, tags: ['Trinket'], into: [] },
  9999: { name: 'Arena', gold: { total: 3000 }, tags: [], into: [], maps: { 11: false } },
});
assert.equal(items[3071].l, true); assert.equal(items[1037].l, false); assert.equal(items[3047].b, true);
assert.equal(items[1001].b, false, 'bota básica não conta como bota'); assert.equal(items[2003].l, false); assert.equal(items[9999], undefined);

assert.equal(skillOrder(['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W']), 'QEW');
assert.equal(skillOrder(['Q', 'W', 'E', 'E', 'E', 'R']), 'EQW', 'partida curta: desempata por pontos');

// Partida falsa: Darius (122) topo do time 100 contra Garen (86); Riot ID dos jogadores
const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
function match(n, win) {
  const ps = [];
  for (let i = 0; i < 10; i++) ps.push({
    participantId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: roles[i % 5], championId: i === 0 ? 122 : i === 5 ? 86 : 1000 + i,
    win: i < 5 ? win : !win, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 200, neutralMinionsKilled: 10,
    summoner1Id: 4, summoner2Id: 12, riotIdGameName: `Jogador${i}`, riotIdTagline: 'BR1',
    item0: 3071, item1: 6610, item2: 3047, item3: 3053, item4: 0, item5: 1037, item6: 3340,
    perks: { statPerks: { offense: 5008, flex: 5008, defense: 5011 }, styles: [{ description: 'primaryStyle', style: 8000, selections: [{ perk: 8010 }, { perk: 9111 }, { perk: 9104 }, { perk: 8299 }] }, { description: 'subStyle', style: 8400, selections: [{ perk: 8444 }, { perk: 8242 }] }] },
  });
  return { metadata: { matchId: 'BR1_' + n }, info: { platformId: 'BR1', gameDuration: 1800, gameEndTimestamp: 1_700_000_000_000 + n, participants: ps } };
}
const tl = { info: { frames: [
  { events: [
    { type: 'ITEM_PURCHASED', participantId: 1, itemId: 1055, timestamp: 1000 }, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 2003, timestamp: 1500 },
    { type: 'ITEM_PURCHASED', participantId: 1, itemId: 2003, timestamp: 1600 }, { type: 'ITEM_UNDO', participantId: 1, beforeId: 2003, afterId: 0, timestamp: 1700 },
    ...['Q', 'E', 'W', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E'].map((k, i) => ({ type: 'SKILL_LEVEL_UP', participantId: 1, skillSlot: { Q: 1, W: 2, E: 3, R: 4 }[k], levelUpType: 'NORMAL', timestamp: 2000 + i })),
  ] },
  ...Array.from({ length: 13 }, () => ({ events: [] })),
  { participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), { totalGold: i === 0 ? 6000 : i === 5 ? 5600 : 5000 }])), events: [
    { type: 'ITEM_PURCHASED', participantId: 1, itemId: 1037, timestamp: 400000 }, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3047, timestamp: 500000 },
    { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3071, timestamp: 600000 }, { type: 'ITEM_PURCHASED', participantId: 1, itemId: 6610, timestamp: 900000 },
    { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3053, timestamp: 1200000 },
  ] },
] } };
const t = readTimeline(tl);
assert.deepEqual(t.buys[1].filter((b) => b.t < 60000).map((b) => b.id), [1055, 2003], 'o desfazer tira a segunda poção');
assert.equal(t.gold14['1'], 6000);

const book = emptyBuilds('16.22', 'EMERALD+', 'br1');
for (let i = 0; i < 12; i++) addBuildMatch(book, match(i, i % 3 !== 0), tl, items, { tier: i < 4 ? 'DIAMOND' : 'EMERALD' });
addBuildMatch(book, match(99, true), null, items, { tier: 'EMERALD' }); // sem linha do tempo
assert.equal(book.matches, 13); assert.equal(book.timelines, 12);
const e = book.champs['122|T'];
assert.equal(e.g, 13);
assert.deepEqual(Object.keys(e.core), ['3071,6610,3053']);
assert.deepEqual(Object.keys(e.start), ['1055,2003']);
assert.deepEqual(Object.keys(e.boots), ['3047']);
assert.deepEqual(Object.keys(e.skills), ['QEW']);
assert.equal(book.gd['122|T']['86'].s / book.gd['122|T']['86'].n, 400, 'Darius 400 de ouro na frente aos 14');
assert.equal(book.games['122|T'].length, 4, 'só as partidas Diamante+ entram no histórico');
assert.equal(book.games['122|T'][0].nome, 'Jogador0');
assert.equal(book.games['122|T'][0].opp, 86);

const lane = { 122: { 86: { g: 40, w: 26 }, 1001: { g: 5, w: 5 }, 55: { g: 30, w: 12 } } };
const v = buildView(book, null, 122, 'T', { soloLane: lane, roleWr: 50 });
assert.equal(v.g, 13);
assert.deepEqual(v.runas.perks, [8010, 9111, 9104, 8299, 8444, 8242]);
assert.deepEqual(v.runas.shards, [5008, 5008, 5011]);
assert.deepEqual(v.feiticos.ids, [4, 12]);
assert.deepEqual(v.core.ids, [3071, 6610, 3053]);
assert.equal(v.bota.id, 3047);
assert.equal(v.habilidades.ordem, 'QEW'); assert.equal(v.habilidades.primeiras, 'QEW');
assert.deepEqual(v.confrontos.map((x) => x.opp), [86, 55], 'confronto com poucos jogos fica de fora; melhor primeiro');
assert.equal(v.confrontos[0].d, 15); assert.equal(v.confrontos[0].rota, 'boa');
assert.equal(v.confrontos[1].d, -10); assert.equal(v.confrontos[1].rota, null);
assert.equal(v.historico.length, 4);
assert.deepEqual(rolesOfChamp(book, null, 122), [{ role: 'T', g: 13 }]);
assert.equal(runeKey(parseRuneKey('8000:8010,9111,9104,8299|8400:8444,8242|5008,5008,5011')), '8000:8010,9111,9104,8299|8400:8444,8242|5008,5008,5011');
// Patch novo com poucos jogos soma o anterior
const novo = emptyBuilds('16.23', 'EMERALD+', 'br1');
addBuildMatch(novo, match(200, true), null, items, {});
assert.equal(buildView(novo, book, 122, 'T').g, 14);
// Corte das variações raras
const big = emptyBuilds('1.1', 'x', 'y');
big.champs['1|T'] = { g: 100, w: 50, runes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), { g: i, w: 0 }])), spells: {}, start: {}, boots: {}, core: {}, i4: {}, i5: {}, items: {}, skills: {}, first: {} };
prune(big);
assert.equal(Object.keys(big.champs['1|T'].runes).length, 24); assert.ok(big.champs['1|T'].runes['39']);

// ---------- Importar ----------
const calls = [];
const state = { pages: [{ id: 1, name: 'Minha página', isDeletable: true, isEditable: true }, { id: 2, name: 'Padrão', isDeletable: false }], sets: { accountId: 77, itemSets: [{ uid: 'meu', title: 'Meu set' }] } };
const lcu = {
  flow: 'ChampSelect', session: {},
  async request(method, path, body) {
    calls.push([method, path, body]);
    if (path === '/lol-perks/v1/pages' && method === 'GET') return state.pages;
    if (path === '/lol-perks/v1/inventory') return { ownedPageCount: 2 };
    if (path === '/lol-perks/v1/pages' && method === 'POST') { state.pages.push({ id: 9, ...body, isDeletable: true }); return {}; }
    if (path.startsWith('/lol-perks/v1/pages/') && method === 'DELETE') { state.pages = state.pages.filter((p) => p.id !== Number(path.split('/').pop())); return null; }
    if (path === '/lol-summoner/v1/current-summoner') return { summonerId: 123, accountId: 77 };
    if (path.startsWith('/lol-item-sets/') && method === 'GET') return state.sets;
    if (path.startsWith('/lol-item-sets/') && method === 'PUT') { state.sets = body; return null; }
    if (path === '/lol-champ-select/v1/session') return { localPlayerCellId: 3, myTeam: [{ cellId: 3, spell1Id: 14, spell2Id: 4 }] };
    return null;
  },
};
await importRunes(lcu, 'Darius', 'T', v.runas);
assert.equal(state.pages.length, 3);
const pg = state.pages.find((p) => p.id === 9);
assert.equal(pg.name, 'Runas Draft Lab'); assert.deepEqual(pg.selectedPerkIds, [8010, 9111, 9104, 8299, 8444, 8242, 5008, 5008, 5011]); assert.equal(pg.current, true);
// Importar de novo troca a página do Draft Lab, sem tocar nas suas
await importRunes(lcu, 'Darius', 'T', v.runas);
assert.equal(state.pages.filter((p) => p.name === 'Runas Draft Lab').length, 1);
assert.ok(state.pages.some((p) => p.name === 'Minha página'));
// Página antiga "Draft Lab: ..." também é do app e é trocada
state.pages = [{ id: 1, name: 'A', isDeletable: true }, { id: 4, name: 'Draft Lab: Syndra Meio', isDeletable: true }];
await importRunes(lcu, 'Darius', 'T', v.runas);
assert.deepEqual(state.pages.map((p) => p.name), ['A', 'Runas Draft Lab']);
// Sem página livre e sem página do Draft Lab: devolve as suas páginas para você escolher, não apaga nada
state.pages = [{ id: 1, name: 'A', isDeletable: true, current: true }, { id: 3, name: 'B', isDeletable: true }, { id: 2, name: 'Padrão', isDeletable: false }];
const err = await importRunes(lcu, 'Darius', 'T', v.runas).catch((e) => e);
assert.equal(err.code, 'PAGINAS_CHEIAS');
assert.deepEqual(err.paginas, [{ id: 1, nome: 'A', atual: true }, { id: 3, nome: 'B', atual: false }]);
assert.equal(state.pages.length, 3);
// Você escolhe a página B: o app apaga ela e cria a dele
await importRunes(lcu, 'Darius', 'T', v.runas, { apagar: 3 });
assert.deepEqual(state.pages.map((p) => p.name), ['A', 'Padrão', 'Runas Draft Lab']);
// Página que não pode ser apagada: recusa
state.pages = state.pages.filter((p) => p.name !== 'Runas Draft Lab');
await assert.rejects(importRunes(lcu, 'Darius', 'T', v.runas, { apagar: 2 }), /não pode ser apagada/);

await importItemSet(lcu, { name: 'Darius', key: '122' }, 'T', v, (id) => items[id]?.n);
await importItemSet(lcu, { name: 'Darius', key: '122' }, 'T', v, (id) => items[id]?.n);
assert.equal(state.sets.itemSets.length, 2, 'o seu conjunto fica e o do Draft Lab é trocado, não duplicado');
const set = state.sets.itemSets.find((s) => s.uid === 'draftlab-122-T');
assert.deepEqual(set.associatedChampions, [122]);
assert.deepEqual(set.blocks[0].items.map((x) => x.id), ['1055', '2003']);
assert.equal(set.blocks[1].items[0].id, '3047');
assert.match(set.blocks[2].type, /Cutelo Negro > Hidra > Sterak/);

await importSpells(lcu, [4, 12]);
const patch = calls.find(([m, p]) => m === 'PATCH' && p.endsWith('my-selection'))[2];
assert.deepEqual(patch, { spell1Id: 12, spell2Id: 4 }, 'Flash fica na tecla de sempre (F)');
assert.equal(await importSpells({ ...lcu, flow: 'Lobby' }, [4, 12]), null, 'fora do champ select não mexe');


// ---------- WPA ----------
{
  const B = await import('../lib/builds.js');
  assert.ok(Math.abs(B.wpPrior(10 * 60000, 0) - 0.5) < 1e-9, 'ouro igual: 50%');
  assert.ok(B.wpPrior(10 * 60000, 3000) > 0.7 && B.wpPrior(10 * 60000, -3000) < 0.3);
  assert.ok(B.wpPrior(30 * 60000, 3000) < B.wpPrior(10 * 60000, 3000), 'mesma vantagem pesa menos no fim');
  // Dois itens, mesmo win rate (50%): quem compra o A está sempre 4 mil na frente; quem compra o B, empatado.
  // O A tem WPA negativo (ganhar 50% estando na frente é pouco); o B fica perto de zero.
  const roles2 = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const items2 = { 1: { l: true, g: 3000 }, 2: { l: true, g: 3000 }, 3: { l: true, g: 3000 }, 4: { l: true, g: 3000 }, 5: { l: true, g: 3000 }, 3047: { b: true, g: 1100 }, 1055: { g: 450 } };
  const bk = B.emptyBuilds('16.22', 'x', 'y');
  for (let i = 0; i < 80; i++) {
    const first = i % 2 ? 1 : 2, lead = first === 1 ? 4000 : 0, win = i % 4 < 2;
    const ps = Array.from({ length: 10 }, (_, j) => ({ participantId: j + 1, teamId: j < 5 ? 100 : 200, teamPosition: roles2[j % 5], championId: j === 0 ? 122 : 500 + j, win: j < 5 ? win : !win, summoner1Id: 4, summoner2Id: 12,
      perks: { statPerks: {}, styles: [{ description: 'primaryStyle', style: 8000, selections: [{ perk: 8010 }, { perk: 1 }, { perk: 2 }, { perk: 3 }] }, { description: 'subStyle', style: 8400, selections: [{ perk: 4 }, { perk: 5 }] }] } }));
    const gold = (j) => (j === 1 ? 6000 + lead : 5000 + (j <= 5 ? 0 : (lead / 5) * 0));
    const frames = Array.from({ length: 21 }, (_, f) => ({ participantFrames: Object.fromEntries(Array.from({ length: 10 }, (_, j) => [String(j + 1), { totalGold: j === 0 ? 1000 + f * 400 + (f >= 10 ? lead : 0) : j < 5 ? 1000 + f * 400 : 1000 + f * 400 + (j === 5 ? 1000 : 0) * 0 }])), events: [] }));
    frames[0].events.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: 1055, timestamp: 1000 });
    frames[12].events.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: first, timestamp: 12 * 60000 + 5 });
    frames[14].events.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: 3, timestamp: 14 * 60000 + 5 });
    frames[16].events.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: 4, timestamp: 16 * 60000 + 5 });
    frames[18].events.push({ type: 'ITEM_PURCHASED', participantId: 1, itemId: 5, timestamp: 18 * 60000 + 5 });
    B.addBuildMatch(bk, { metadata: { matchId: 'X' + i }, info: { participants: ps, gameDuration: 1500 } }, { info: { frames } }, items2, { draftWp: () => 0.5 });
    void gold;
  }
  const w = bk.champs['122|T'].wpa;
  assert.equal(w.i1['1'].g, 40); assert.equal(w.i1['2'].g, 40);
  const v = B.buildView(bk, null, 122, 'T');
  const a = v.wpa.i1.find((x) => x.id === 1), b = v.wpa.i1.find((x) => x.id === 2);
  assert.ok(a.wpa < -10, `quem já estava na frente: WPA bem negativo (${a.wpa})`);
  assert.ok(Math.abs(b.wpa) < 3, `ouro igual: WPA perto de zero (${b.wpa})`);
  assert.equal(v.core.porWpa, true);
  assert.equal(v.core.ids[0], 2, 'o 1º item recomendado é o de maior WPA, não o de quem já ganhava');
  assert.equal(v.wpa.key[0].id, 8010);
  assert.ok(Object.keys(bk.wp).length > 0, 'tabela de probabilidade de vitória montada com as partidas');
  const ex = bk.champs['122|T'];
  assert.equal(ex.gt, 80, 'partidas com linha do tempo');
  assert.equal(ex.itx.L1['1'][0], 40); assert.equal(ex.itx.L2['3'][0], 80, '3º comprado é o 2º lendário');
  assert.equal(ex.itx.T0['1055'][0], 80, 'item inicial');
  assert.equal(ex.rx.r8010[0], 80); assert.equal(ex.rx.P8000[0], 80); assert.equal(ex.rx.S8400[0], 80);
  assert.ok(v.explorador.itens.L1 && v.explorador.partidasItens === 80);
  // Pouca amostra não entra na recomendação
  const few = B.wpaView({ wpa: { i1: { 7: { g: 10, w: 10, p: 5 } } } });
  assert.equal(few.i1[0].poucos, true);
}

console.log('Todos os testes das builds e da importação passaram.');
