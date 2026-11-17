import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciar } from '../dev.js';
import { mensagemDiscord, nomePartida } from '../src/worker.js';

const fixture = join(tmpdir(), 'dl-inhouse-dd.json');
const data = Object.fromEntries(['Aatrox', 'Ahri', 'Akali', 'MonkeyKing', 'Zed', 'Lux', 'Jinx', 'Thresh', 'LeeSin', 'Garen', 'Darius', 'Annie', 'Ashe', 'Braum', 'Brand', 'Caitlyn', 'Ekko', 'Fiora', 'Gwen', 'Irelia', 'Jax', 'Karma'].map((id) => [id, { id, name: id === 'MonkeyKing' ? 'Wukong' : id, tags: ['Fighter'] }]));
writeFileSync(fixture, JSON.stringify({ version: '16.22.1', data }));
const srv = await iniciar({ porta: 0, ddFixture: fixture, quieto: true, vars: { NOME_PARTIDA: 'KABUM_s4_l{n} : Open Low', PARTIDA_INICIAL: '2227' } });
after(() => srv.fechar());

const criar = (corpo) => fetch(`${srv.url}/api/salas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function conectar(id, cid) {
  const ws = new WebSocket(`${srv.url.replace('http', 'ws')}/sala/${id}/ws`);
  const fila = [];
  const espera = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); const w = espera.shift(); if (w) w(m); else fila.push(m); };
  const proxima = () => (fila.length ? Promise.resolve(fila.shift()) : new Promise((ok) => espera.push(ok)));
  return new Promise((ok) => { ws.onopen = () => { ws.send(JSON.stringify({ t: 'ola', cid })); ok({ ws, proxima, enviar: (m) => ws.send(JSON.stringify(m)) }); }; });
}

test('cria sala com link único, nome da partida em sequência e senha sorteada; ignora nome escolhido', async () => {
  const ruim = await fetch(`${srv.url}/api/salas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'não é json' });
  assert.equal(ruim.status, 400);
  const r = await criar({ timeA: 'Zirigude', timeB: 'Abelinha', serie: 5, tempo: 20, titulo: 'nome que eu quero', partida: { nome: 'x' } });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.match(d.link, /\/sala\/[A-Za-z0-9]{8}$/);
  assert.equal(d.partida.nome, 'KABUM_s4_l2227 : Open Low');
  assert.match(d.partida.senha, /^[A-Za-z0-9]{4}$/);
  assert.match(d.mensagem, /MD5 Fearless/);
  assert.match(d.mensagem, /Senha: `/);
  const d2 = await (await criar({ timeA: 'X', timeB: 'Y' })).json();
  assert.equal(d2.partida.nome, 'KABUM_s4_l2228 : Open Low');
  const pub = await (await fetch(`${srv.url}/api/salas/${d.id}`)).json();
  assert.equal(pub.partida.nome, 'KABUM_s4_l2227 : Open Low');
  assert.equal((await fetch(`${srv.url}/api/salas/naoexiste`)).status, 404);
  assert.equal((await fetch(`${srv.url}/api/salas/abcdefgh`)).status, 404);
});

test('WebSocket: entrar, erro só para quem errou, tempo esgotado pelo alarme', async () => {
  const d = await (await criar({ timeA: 'Azuis', timeB: 'Vermelhos', tempo: 20 })).json();
  const a = await conectar(d.id, 'jogadorA_123');
  const b = await conectar(d.id, 'jogadorB_123');
  assert.equal((await a.proxima()).estado.fase, 'lobby');
  await b.proxima();
  a.enviar({ t: 'entrar', time: 'A', vaga: 'T', nome: '' });
  assert.deepEqual(await a.proxima(), { t: 'erro', msg: 'Digite seu nick.' });
  a.enviar({ t: 'entrar', time: 'A', vaga: 'T', nome: 'Capitão A' });
  const ea = (await a.proxima()).estado;
  assert.equal(ea.eu.capitao, true);
  assert.equal((await b.proxima()).estado.times.A.vagas.T.nome, 'Capitão A');
  b.enviar({ t: 'entrar', time: 'B', vaga: 'M', nome: 'Capitão B' });
  await a.proxima(); await b.proxima();
  a.enviar({ t: 'pronto', valor: true });
  await a.proxima(); await b.proxima();
  b.enviar({ t: 'pronto', valor: true });
  const ini = (await a.proxima()).estado;
  await b.proxima();
  assert.equal(ini.fase, 'draft');
  assert.ok(ini.vez.prazo - ini.agora <= 20_000);
  // o capitão A marca Ahri e deixa o tempo acabar: o alarme trava o ban marcado
  a.enviar({ t: 'hover', champ: 'Ahri' });
  await a.proxima(); await b.proxima();
  const inst = srv.env.SALAS.pegar(d.id);
  inst.s.prazo = Date.now() - 1;
  await inst.alarm();
  const depois = (await b.proxima()).estado;
  await a.proxima();
  assert.deepEqual(depois.jogos[0].acoes[0], { n: 0, lado: 'azul', time: 'A', tipo: 'ban', champ: 'Ahri', vaga: null });
  assert.equal(depois.vez.time, 'B');
  a.ws.close(); b.ws.close();
});

test('mensagem para copiar no Discord e nome da partida seguem o modelo', () => {
  assert.equal(nomePartida('KABUM_s4_l{n} : Open Low', 2229), 'KABUM_s4_l2229 : Open Low');
  assert.equal(nomePartida(undefined, 5), 'DraftLab 5');
  const msg = mensagemDiscord({ link: 'L', partida: { nome: 'N', senha: 'S' }, config: { timeA: 'X', timeB: 'Y', serie: 1 } });
  assert.equal(msg, '**X** x **Y** · MD1\nNome: `N`\nSenha: `S`\nDraft: <L>');
});
