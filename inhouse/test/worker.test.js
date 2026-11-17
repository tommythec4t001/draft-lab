import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciar } from '../dev.js';
import { embedDraft, mensagemDiscord } from '../src/worker.js';
import { novaSala, aplicar, resumoJogo, VAGAS } from '../src/draft.js';

const fixture = join(tmpdir(), 'dl-inhouse-dd.json');
const data = Object.fromEntries(['Aatrox', 'Ahri', 'Akali', 'MonkeyKing', 'Zed', 'Lux', 'Jinx', 'Thresh', 'LeeSin', 'Garen', 'Darius', 'Annie', 'Ashe', 'Braum', 'Brand', 'Caitlyn', 'Ekko', 'Fiora', 'Gwen', 'Irelia', 'Jax', 'Karma'].map((id) => [id, { id, name: id === 'MonkeyKing' ? 'Wukong' : id, tags: ['Fighter'] }]));
writeFileSync(fixture, JSON.stringify({ version: '16.22.1', data }));
const srv = await iniciar({ porta: 0, ddFixture: fixture, quieto: true });
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

test('cria sala, recusa webhook que não é do Discord e não mostra tokens no estado público', async () => {
  const ruim = await criar({ timeA: 'A', timeB: 'B', webhook: 'https://exemplo.com/x' });
  assert.equal(ruim.status, 400);
  const r = await criar({ timeA: 'Zirigude', timeB: 'Abelinha', serie: 5, tempo: 20 });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.match(d.links.A, /\/sala\/[A-Za-z0-9]{8}\?time=A&t=/);
  assert.match(d.mensagem, /MD5 Fearless/);
  const pub = await (await fetch(`${srv.url}/api/salas/${d.id}`)).text();
  assert.equal(pub.includes(d.links.A.split('t=')[1]), false);
  assert.equal((await fetch(`${srv.url}/api/salas/naoexiste`)).status, 404);
  assert.equal((await fetch(`${srv.url}/api/salas/abcdefgh`)).status, 404);
});

test('WebSocket: entrar, erro só para quem errou, tempo esgotado pelo alarme', async () => {
  const d = await (await criar({ timeA: 'Azuis', timeB: 'Vermelhos', tempo: 20 })).json();
  const tok = (t) => new URL(d.links[t]).searchParams.get('t');
  const a = await conectar(d.id, 'jogadorA_123');
  const b = await conectar(d.id, 'jogadorB_123');
  assert.equal((await a.proxima()).estado.fase, 'lobby');
  await b.proxima();
  a.enviar({ t: 'entrar', time: 'A', token: tok('B'), vaga: 'T', nome: 'x' });
  assert.deepEqual(await a.proxima(), { t: 'erro', msg: 'Este link não é deste time.' });
  a.enviar({ t: 'entrar', time: 'A', token: tok('A'), vaga: 'T', nome: 'Capitão A' });
  const ea = (await a.proxima()).estado;
  assert.equal(ea.eu.capitao, true);
  assert.equal((await b.proxima()).estado.times.A.vagas.T.nome, 'Capitão A');
  b.enviar({ t: 'entrar', time: 'B', token: tok('B'), vaga: 'M', nome: 'Capitão B' });
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

test('mensagem e embed do Discord usam os nomes em português dos campeões', () => {
  const s = novaSala({ id: 'abcdefgh', tokens: { A: 'a', B: 'b' }, campeoes: Object.keys(data), nomes: Object.fromEntries(Object.values(data).map((c) => [c.id, c.name])), config: { timeA: 'Azuis', timeB: 'Verm' } });
  for (const t of ['A', 'B']) for (const v of VAGAS) aplicar(s, `${t}${v}xxxxxxx`, { t: 'entrar', time: t, token: t.toLowerCase(), vaga: v, nome: `${t}${v}` });
  s.jogos[0].acoes.push({ n: 6, lado: 'azul', time: 'A', tipo: 'pick', champ: 'MonkeyKing', vaga: 'J' });
  const e = embedDraft(s, resumoJogo(s, 1), 'https://x.dev');
  assert.match(e.fields[0].value, /\*\*Selva:\*\* Wukong \(AJ\)/);
  assert.equal(e.url, 'https://x.dev/sala/abcdefgh');
  assert.match(mensagemDiscord('', { links: { A: 'la', B: 'lb', espectador: 'le' }, config: { timeA: 'X', timeB: 'Y', serie: 1 } }), /MD1/);
});
