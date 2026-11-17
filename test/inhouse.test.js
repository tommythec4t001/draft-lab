import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizarUrl, linkDeSala, criarSala, urlDe } from '../lib/inhouse.js';

test('endereço do servidor: https ou localhost, só o domínio', () => {
  assert.equal(normalizarUrl('https://draft-lab-inhouse.enzo.workers.dev/'), 'https://draft-lab-inhouse.enzo.workers.dev');
  assert.equal(normalizarUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizarUrl(''), '');
  assert.equal(normalizarUrl('http://exemplo.com'), null);
  assert.equal(normalizarUrl('https://x.dev/caminho'), null);
  assert.equal(normalizarUrl('javascript:alert(1)'), null);
  assert.equal(normalizarUrl('https://user:senha@x.dev'), null);
  assert.equal(urlDe({ inhouse: 'https://a.dev' }), process.env.INHOUSE_URL ? normalizarUrl(process.env.INHOUSE_URL) : 'https://a.dev');
});

test('link de sala: só do servidor configurado, um link para todos', () => {
  const base = 'https://ih.dev';
  assert.equal(linkDeSala(base, 'https://ih.dev/sala/AbCd2345'), 'https://ih.dev/sala/AbCd2345');
  assert.equal(linkDeSala(base, ' https://ih.dev/sala/AbCd2345/?x=1 '), 'https://ih.dev/sala/AbCd2345');
  assert.equal(linkDeSala(base, 'https://outro.dev/sala/AbCd2345'), null);
  assert.equal(linkDeSala(base, 'https://ih.dev/estatisticas'), null);
  assert.equal(linkDeSala('', 'https://ih.dev/sala/AbCd2345'), null);
});

test('criar sala repassa só os campos conhecidos e traduz os erros', async () => {
  let enviado;
  const ok = async (url, init) => { enviado = { url, corpo: JSON.parse(init.body) }; return new Response(JSON.stringify({ id: 'x', links: {} }), { status: 201 }); };
  await criarSala('https://ih.dev', { timeA: 'A', timeB: 'B', serie: '3', extra: 'não vai', titulo: 'nome escolhido' }, { fetchImpl: ok });
  assert.equal(enviado.url, 'https://ih.dev/api/salas');
  assert.equal(enviado.corpo.serie, 3);
  assert.equal('extra' in enviado.corpo, false);
  assert.equal('titulo' in enviado.corpo, false, 'o nome da partida é do servidor');
  assert.equal('webhook' in enviado.corpo, false);
  const ruim = async () => new Response(JSON.stringify({ erro: 'Envie os dados da sala em JSON.' }), { status: 400 });
  await assert.rejects(criarSala('https://ih.dev', {}, { fetchImpl: ruim }), /JSON/);
  await assert.rejects(criarSala('https://ih.dev', {}, { fetchImpl: async () => { throw new Error('rede'); } }), /Não consegui falar/);
  await assert.rejects(criarSala('', {}), /Configure/);
});
