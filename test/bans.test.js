// Teste dos bans pela sua conta (lib/bans.js):  npm test
import assert from 'node:assert/strict';
import { contraCampeoes, bansSugeridos, rotaMaisJogada, MIN_JOGOS } from '../lib/bans.js';

// Partida resumida como em lib/history.js. inimigos: [champ, pos] do time 200; você joga no time 100.
const partida = (win, pos, inimigos, extra = {}) => ({
  win, remake: false, me: { champ: 1, pos, team: 100 },
  players: [{ champ: 1, team: 100, pos, me: true }, { champ: 2, team: 100, pos: 'J' }, ...inimigos.map(([champ, p]) => ({ champ, team: 200, pos: p }))],
  ...extra,
});
const repetir = (n, f) => Array.from({ length: n }, (_, i) => f(i));

assert.equal(MIN_JOGOS, 4);

// Contagem: só o time inimigo, sem remakes; separa quando ele estava na sua rota.
{
  const ms = [
    partida(true, 'M', [[61, 'M'], [64, 'J']]),
    partida(false, 'M', [[61, 'M']]),
    partida(false, 'T', [[61, 'M']]),
    partida(false, 'M', [[61, 'M']], { remake: true }),
    null,
  ];
  const t = contraCampeoes(ms);
  assert.deepEqual(t[61], { g: 3, w: 1, rotas: { M: { g: 2, w: 1 } } });
  assert.deepEqual(t[64], { g: 1, w: 1, rotas: {} });
  assert.equal(t[2], undefined, 'aliado não conta');
  assert.equal(t[1], undefined, 'você não conta');
}

// Ordem: a sua rota com menos de 50% vem primeiro; mínimo de 4 jogos; o resto por taxa de vitória.
{
  const ms = [
    ...repetir(5, (i) => partida(i < 2, 'M', [[61, 'M']])),   // Orianna (mid): 2/5 = 40%
    ...repetir(4, () => partida(false, 'M', [[64, 'J']])),     // Lee Sin (jungle): 0/4 = 0%
    ...repetir(4, (i) => partida(i < 1, 'M', [[103, 'M']])),   // Ahri (mid): 1/4 = 25%
    ...repetir(3, () => partida(false, 'M', [[238, 'M']])),    // Zed: só 3 jogos, fica de fora
    ...repetir(6, (i) => partida(i < 4, 'M', [[99, 'M']])),    // Lux (mid): 4/6 = 66,7%
  ];
  const roles = { 61: 'M', 64: 'J', 103: 'M', 238: 'M', 99: 'MS' };
  const l = bansSugeridos(ms, { rota: 'M', rolesOf: (id) => roles[id] });
  assert.deepEqual(l.map((x) => x.champ), [103, 61, 64, 99]);
  assert.equal(l[0].wr, 25);
  assert.equal(l[0].daRota, true);
  assert.equal(l[1].wr, 40);
  assert.deepEqual(l[1].naRota, { jogos: 5, vitorias: 2 });
  assert.equal(l[2].daRota, false);
  assert.equal(l[3].wr, 66.7);
  assert.ok(!l.some((x) => x.champ === 238));

  // Sem rota: só a taxa de vitória decide.
  assert.deepEqual(bansSugeridos(ms, { rolesOf: (id) => roles[id] }).map((x) => x.champ), [64, 103, 61, 99]);
  // Campeão de outra rota que você enfrentou duas vezes na sua rota conta como "da sua rota".
  const top = [...repetir(4, () => partida(false, 'T', [[64, 'T']]))];
  assert.equal(bansSugeridos(top, { rota: 'T', rolesOf: () => 'J' })[0].daRota, true);
  // Adversário direto em outra rota não conta para a rota atual: MF contra você no ADC não é "da sua rota" no Mid.
  const adc = repetir(4, () => partida(false, 'A', [[21, 'A']]));
  const mf = bansSugeridos(adc, { rota: 'M', rolesOf: () => 'A' })[0];
  assert.equal(mf.daRota, false);
  assert.deepEqual(mf.naRota, { jogos: 0, vitorias: 0 });
  assert.deepEqual(bansSugeridos(adc, { rota: 'A', rolesOf: () => 'A' })[0].naRota, { jogos: 4, vitorias: 0 });
  // Empate na taxa: mais jogos primeiro.
  const emp = [...repetir(4, () => partida(false, 'M', [[61, 'M']])), ...repetir(6, () => partida(false, 'M', [[103, 'M']]))];
  assert.deepEqual(bansSugeridos(emp, { rota: 'M', rolesOf: () => 'M' }).map((x) => x.champ), [103, 61]);
}

// Rota mais jogada (para a personalizada, em que o cliente não informa a rota).
assert.equal(rotaMaisJogada([partida(true, 'T', []), partida(true, 'A', []), partida(true, 'A', []), partida(true, 'T', [], { remake: true }), partida(true, 'T', [], { remake: true })]), 'A');
assert.equal(rotaMaisJogada([]), null);

console.log('bans: ok');
