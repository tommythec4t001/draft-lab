// Teste de ponta a ponta: 10 jogadores + 1 espectador, cada um num navegador, jogando uma MD3 Fearless pela interface.
// Uso: node test/e2e.mjs <playwright index.mjs> <fixture do Data Dragon> <pasta das capturas>
import assert from 'node:assert/strict';
import { iniciar } from '../dev.js';

const [pw, fixture, capturas = '/tmp'] = process.argv.slice(2);
const { chromium } = await import(pw);
const VAGAS = ['T', 'J', 'M', 'A', 'S'];
const NOME = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };

const srv = await iniciar({ porta: 0, ddFixture: fixture, quieto: true, vars: { NOME_PARTIDA: 'KABUM_s4_l{n} : Open Low', PARTIDA_INICIAL: '2227' } });
const navegador = await chromium.launch();
const erros = [];
try {
  const r = await fetch(`${srv.url}/api/salas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeA: 'Zirigude', timeB: 'Abelinha', serie: 3, fearless: true, tempo: 30 }) });
  const salaInfo = await r.json();
  assert.equal(r.status, 201);
  const estado = async () => (await fetch(`${srv.url}/api/salas/${salaInfo.id}`)).json();

  const abrir = async (url, largura = 1440) => {
    const ctx = await navegador.newContext({ viewport: { width: largura, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) erros.push(m.text()); });
    await p.goto(url);
    return p;
  };

  const esp = await abrir(salaInfo.link);
  await esp.waitForSelector('text=Entrar na partida');
  await esp.screenshot({ path: `${capturas}/ih-entrar.png` });
  const jog = { A: {}, B: {} };
  for (const t of ['A', 'B']) {
    for (const v of VAGAS) {
      const p = await abrir(salaInfo.link, 1280);
      await p.fill('#nick', `${t === 'A' ? 'Zi' : 'Abe'}${NOME[v]}#BR1`);
      await p.click(`[data-rota="${v}"][data-time="${t}"]`);
      await p.waitForSelector(`text=Você está no ${NOME[v]}`);
      jog[t][v] = p;
    }
  }
  await jog.A.T.screenshot({ path: `${capturas}/ih-lobby.png` });
  let s = await estado();
  assert.equal(Object.values(s.times.A.vagas).filter(Boolean).length, 5);
  assert.equal(s.times.A.vagas.T.capitao, true);

  // capitania: o Topo passa para o Selva no time B
  await jog.B.T.selectOption('#sel-cap', 'J');
  await jog.B.J.waitForSelector('#btn-pronto');
  const cap = { A: jog.A.T, B: jog.B.J };

  let usados = new Set();
  const { readFileSync } = await import('node:fs');
  const fixtureIds = Object.keys(JSON.parse(readFileSync(fixture, 'utf8')).data).sort();

  async function jogarDraft(n) {
    await cap.A.click('#btn-pronto');
    await cap.B.click('#btn-pronto');
    await esp.waitForSelector('#grade');
    let passo = 0;
    for (;;) {
      s = await estado();
      if (s.fase !== 'draft') break;
      const vez = s.vez;
      let p;
      if (vez.tipo === 'ban') p = cap[vez.time];
      else {
        const j = s.jogos.at(-1);
        const v = VAGAS.find((x) => !j.acoes.some((a) => a.tipo === 'pick' && a.time === vez.time && a.vaga === x));
        p = jog[vez.time][v];
      }
      const c = fixtureIds.find((x) => !usados.has(x) && !s.fearless.includes(x) && !s.jogos.at(-1).acoes.some((a) => a.champ === x));
      usados.add(c);
      await p.waitForSelector('#btn-travar');
      await p.click(`.ch[data-c="${c}"]`);
      await p.waitForFunction((c) => !document.querySelector('#btn-travar').disabled && document.querySelector(`.ch[data-c="${c}"]`).classList.contains('sel'), c);
      if (n === 1 && passo === 7) await p.screenshot({ path: `${capturas}/ih-jogador-vez.png` });
      if (n === 1 && passo === 7) await esp.screenshot({ path: `${capturas}/ih-espectador.png` });
      await p.click('#btn-travar');
      for (let k = 0; k < 50; k++) { const e2 = await estado(); if (e2.fase !== 'draft' || e2.vez.n !== vez.n) break; await new Promise((r) => setTimeout(r, 30)); }
      passo++;
    }
    assert.equal(s.fase, 'jogando');
    await esp.waitForSelector('text=Draft encerrado');
  }

  // Jogo 1
  await jogarDraft(1);
  await esp.screenshot({ path: `${capturas}/ih-fim-draft.png` });
  cap.A.once('dialog', (d) => d.accept());
  await cap.A.click(`[data-venc="A"]`);
  await cap.B.waitForSelector('text=Seu time perdeu');
  await cap.B.screenshot({ path: `${capturas}/ih-lado.png` });
  await cap.B.click('[data-lado="azul"]');
  await cap.A.waitForSelector('#btn-pronto');
  s = await estado();
  assert.equal(s.jogos[1].azul, 'B', 'quem perdeu escolheu o lado azul');
  assert.equal(s.fearless.length, 10);

  // Jogo 2: os 10 do jogo 1 bloqueados
  const bloqueado = s.fearless[0];
  await cap.A.click('#btn-pronto');
  await cap.B.click('#btn-pronto');
  await cap.B.waitForSelector('#grade');
  assert.equal(await cap.B.$eval(`.ch[data-c="${bloqueado}"]`, (e) => e.classList.contains('fora') && e.classList.contains('fearless')), true);
  await cap.B.screenshot({ path: `${capturas}/ih-fearless.png` });
  // continua o draft do jogo 2
  let passo = 0;
  for (;;) {
    s = await estado();
    if (s.fase !== 'draft') break;
    const vez = s.vez;
    const j = s.jogos.at(-1);
    const p = vez.tipo === 'ban' ? cap[vez.time] : jog[vez.time][VAGAS.find((x) => !j.acoes.some((a) => a.tipo === 'pick' && a.time === vez.time && a.vaga === x))];
    const c = fixtureIds.find((x) => !usados.has(x) && !s.fearless.includes(x) && !j.acoes.some((a) => a.champ === x));
    usados.add(c);
    await p.click(`.ch[data-c="${c}"]`);
    await p.waitForFunction(() => !document.querySelector('#btn-travar').disabled);
    await p.click('#btn-travar');
    for (let k = 0; k < 50; k++) { const e2 = await estado(); if (e2.fase !== 'draft' || e2.vez.n !== vez.n) break; await new Promise((r) => setTimeout(r, 30)); }
    passo++;
  }
  cap.B.once('dialog', (d) => d.accept());
  await cap.B.click('[data-venc="A"]');
  await esp.waitForSelector('text=Série encerrada');
  await esp.screenshot({ path: `${capturas}/ih-final.png`, fullPage: true });
  s = await estado();
  assert.equal(s.fase, 'encerrada');
  assert.equal(s.times.A.vitorias, 2);

  const est = await (await fetch(`${srv.url}/api/estatisticas`)).json();
  assert.equal(est.jogos, 2);
  assert.equal(est.campeoes.filter((c) => c.picks).length, 20);
  const ult = await (await fetch(`${srv.url}/api/jogos`)).json();
  assert.equal(ult.length, 2);
  assert.equal(JSON.stringify(ult).includes('#BR1'), false, 'nicks não aparecem nas estatísticas públicas');

  const pag = await abrir(`${srv.url}/estatisticas`);
  await pag.waitForSelector('table');
  await pag.screenshot({ path: `${capturas}/ih-estatisticas.png`, fullPage: true });
  const criar = await abrir(`${srv.url}/`);
  await criar.screenshot({ path: `${capturas}/ih-criar.png` });
  const cel = await abrir(salaInfo.link, 390);
  await cel.waitForSelector('text=Série encerrada');
  await cel.screenshot({ path: `${capturas}/ih-celular.png`, fullPage: true });

  assert.deepEqual(erros, []);
  console.log('E2E OK: MD3 Fearless completa com 10 jogadores e espectador');
} finally {
  await navegador.close();
  await srv.fechar();
}
