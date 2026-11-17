import assert from 'node:assert/strict';
import { test } from 'node:test';
import { novaSala, aplicar, tempoEsgotado, visao, vezAtual, podeAgir, indisponiveis, resumoJogo, ORDEM, VAGAS, ErroSala } from '../src/draft.js';

const CAMPS = Array.from({ length: 80 }, (_, i) => `C${i}`);

function sala(config = {}) {
  const s = novaSala({ id: 'sala1', campeoes: CAMPS, versao: '16.22.1', partida: { nome: 'DraftLab 7', senha: 'ab12' }, agora: 0, config: { timeA: 'Azuis', timeB: 'Vermelhos', ...config } });
  for (const t of ['A', 'B']) for (const v of VAGAS) aplicar(s, `${t}${v}`, { t: 'entrar', time: t, vaga: v, nome: `${t}-${v}` }, 1);
  return s;
}
const capitao = (s, t) => s.times[t].capitao;
const comecar = (s, agora = 10) => { aplicar(s, capitao(s, 'A'), { t: 'pronto', valor: true }, agora); aplicar(s, capitao(s, 'B'), { t: 'pronto', valor: true }, agora); };

// Joga um draft inteiro: capitão bane, cada jogador trava o seu na ordem T, J, M, A, S.
function draftCompleto(s, campeoes, agora = 100) {
  let i = 0;
  while (s.fase === 'draft') {
    const vez = vezAtual(s);
    let quem = capitao(s, vez.time);
    if (vez.tipo === 'pick') {
      const jogo = s.jogos.at(-1);
      const v = VAGAS.find((x) => !jogo.acoes.some((a) => a.tipo === 'pick' && a.time === vez.time && a.vaga === x));
      quem = `${vez.time}${v}`;
    }
    const livre = campeoes.find((c) => !indisponiveis(s).has(c) && !s.jogos.slice(0, -1).some((j) => j.acoes.some((a) => a.tipo === 'pick' && a.champ === c)));
    aplicar(s, quem, { t: 'travar', champ: livre }, agora + i++);
  }
}

test('ordem de torneio tem 10 bans e 10 picks, 5 de cada lado', () => {
  assert.equal(ORDEM.length, 20);
  for (const lado of ['azul', 'vermelho']) for (const tipo of ['ban', 'pick']) assert.equal(ORDEM.filter(([l, t]) => l === lado && t === tipo).length, 5);
});

test('entrada pelo link único: escolhe time e rota, primeiro vira capitão', () => {
  const s = novaSala({ id: 'x', campeoes: CAMPS, agora: 0 });
  assert.throws(() => aplicar(s, 'c1', { t: 'entrar', time: 'C', vaga: 'T', nome: 'a' }), /Escolha um time/);
  aplicar(s, 'c1', { t: 'entrar', time: 'A', vaga: 'T', nome: 'Zirigude' });
  assert.equal(s.times.A.capitao, 'c1');
  assert.throws(() => aplicar(s, 'c2', { t: 'entrar', time: 'A', vaga: 'T', nome: 'b' }), /Topo já está com Zirigude/);
  aplicar(s, 'c2', { t: 'entrar', time: 'A', vaga: 'J', nome: 'b' });
  assert.equal(s.times.A.capitao, 'c1');
  aplicar(s, 'c1', { t: 'entrar', time: 'A', vaga: 'M', nome: 'Zirigude' }); // troca de rota no lobby
  assert.equal(s.times.A.vagas.T, null);
  assert.equal(s.times.A.vagas.M.cid, 'c1');
  aplicar(s, 'c1', { t: 'sair' });
  assert.equal(s.times.A.capitao, 'c2');
});

test('draft só começa com os dois capitães prontos', () => {
  const s = sala();
  assert.throws(() => aplicar(s, 'AJ', { t: 'pronto', valor: true }), /Só o capitão/);
  aplicar(s, capitao(s, 'A'), { t: 'pronto', valor: true }, 5);
  assert.equal(s.fase, 'lobby');
  aplicar(s, capitao(s, 'B'), { t: 'pronto', valor: true }, 6);
  assert.equal(s.fase, 'draft');
  assert.equal(s.prazo, 6 + 30_000);
  assert.deepEqual(vezAtual(s), { n: 0, lado: 'azul', tipo: 'ban', time: 'A' });
});

test('ban só do capitão; pick de qualquer um do time que ainda não escolheu', () => {
  const s = sala();
  comecar(s);
  assert.equal(podeAgir(s, 'AJ'), false);
  assert.throws(() => aplicar(s, 'AJ', { t: 'travar', champ: 'C1' }), /Só o capitão bane/);
  assert.throws(() => aplicar(s, 'BT', { t: 'travar', champ: 'C1' }), ErroSala);
  aplicar(s, 'AT', { t: 'travar', champ: 'C1' });
  assert.throws(() => aplicar(s, 'BT', { t: 'travar', champ: 'C1' }), /já foi banido/);
  for (let i = 0; i < 5; i++) aplicar(s, i % 2 ? 'AT' : 'BT', { t: 'travar', champ: `C${10 + i}` });
  assert.equal(vezAtual(s).tipo, 'pick');
  aplicar(s, 'AM', { t: 'travar', champ: 'C20' }); // o meio do azul pega primeiro
  assert.equal(s.jogos[0].acoes.at(-1).vaga, 'M');
  assert.equal(vezAtual(s).time, 'B');
  aplicar(s, 'BS', { t: 'travar', champ: 'C21' });
  assert.throws(() => aplicar(s, 'BS', { t: 'travar', champ: 'C22' }), /Você já escolheu o seu/);
  aplicar(s, 'BT', { t: 'travar', champ: 'C22' });
  // capitão escolhe por uma rota que ainda não pegou
  aplicar(s, 'AT', { t: 'travar', champ: 'C23', vaga: 'S' });
  assert.equal(s.jogos[0].acoes.at(-1).vaga, 'S');
  assert.equal(s.jogos[0].acoes.at(-1).time, 'A');
});

test('tempo esgotado: ban sem marcação fica vazio; ban marcado é travado', () => {
  const s = sala();
  comecar(s, 0);
  assert.deepEqual(tempoEsgotado(s, 29_999), []);
  tempoEsgotado(s, 30_000);
  assert.equal(s.jogos[0].acoes[0].champ, null);
  aplicar(s, 'BT', { t: 'hover', champ: 'C5' }, 30_001);
  tempoEsgotado(s, 70_000);
  assert.equal(s.jogos[0].acoes[1].champ, 'C5');
});

test('tempo esgotado no pick: trava a marcação mais antiga; sem marcação, espera', () => {
  const s = sala();
  comecar(s, 0);
  for (let i = 0; i < 6; i++) aplicar(s, i % 2 ? 'BT' : 'AT', { t: 'travar', champ: `C${i}` }, 1);
  aplicar(s, 'AA', { t: 'hover', champ: 'C40' }, 2);
  aplicar(s, 'AJ', { t: 'hover', champ: 'C41' }, 3);
  tempoEsgotado(s, 1 + 30_000);
  assert.deepEqual(s.jogos[0].acoes.at(-1), { n: 6, lado: 'azul', time: 'A', tipo: 'pick', champ: 'C40', vaga: 'A', por: null, em: 30_001 });
  tempoEsgotado(s, 30_001 + 30_000);
  assert.equal(s.esgotado, true);
  assert.equal(s.prazo, null);
  assert.equal(vezAtual(s).time, 'B');
  aplicar(s, 'BM', { t: 'travar', champ: 'C42' }, 99_999);
  assert.equal(s.esgotado, false);
  assert.ok(s.prazo > 99_999);
});

test('marcações: só o próprio time vê, exceto o time da vez', () => {
  const s = sala();
  comecar(s);
  aplicar(s, 'BM', { t: 'hover', champ: 'C3' });
  assert.equal(visao(s, 'AT').hovers.B, undefined);
  assert.equal(visao(s, 'BJ').hovers.B.M, 'C3');
  aplicar(s, 'AT', { t: 'hover', champ: 'C4' });
  assert.equal(visao(s, 'espectador').hovers.A.T, 'C4');
  assert.deepEqual(visao(s, null).partida, { nome: 'DraftLab 7', senha: 'ab12' });
});

test('série MD3 Fearless: campeões escolhidos ficam bloqueados; perdedor escolhe o lado', () => {
  const s = sala({ serie: 3, fearless: true });
  comecar(s);
  draftCompleto(s, CAMPS);
  assert.equal(s.fase, 'jogando');
  const picks1 = s.jogos[0].acoes.filter((a) => a.tipo === 'pick').map((a) => a.champ);
  assert.equal(picks1.length, 10);
  assert.throws(() => aplicar(s, 'AJ', { t: 'resultado', vencedor: 'A' }), /Só um capitão/);
  const ev = aplicar(s, capitao(s, 'B'), { t: 'resultado', vencedor: 'A' }, 500);
  assert.deepEqual(ev, [{ tipo: 'resultado', jogo: 1, vencedor: 'A' }]);
  assert.equal(s.fase, 'lado');
  assert.equal(s.ladoPor, 'B');
  assert.throws(() => aplicar(s, capitao(s, 'A'), { t: 'lado', lado: 'azul' }), /time que perdeu/);
  aplicar(s, capitao(s, 'B'), { t: 'lado', lado: 'azul' });
  assert.equal(s.jogos[1].azul, 'B');
  assert.equal(s.fase, 'lobby');
  comecar(s, 600);
  assert.deepEqual(vezAtual(s), { n: 0, lado: 'azul', tipo: 'ban', time: 'B' });
  assert.throws(() => aplicar(s, capitao(s, 'B'), { t: 'travar', champ: picks1[0] }), /Fearless/);
  draftCompleto(s, CAMPS, 700);
  const picks2 = s.jogos[1].acoes.filter((a) => a.tipo === 'pick').map((a) => a.champ);
  assert.equal(picks2.some((c) => picks1.includes(c)), false);
  aplicar(s, capitao(s, 'A'), { t: 'resultado', vencedor: 'A' }, 900);
  assert.equal(s.fase, 'encerrada');
  assert.equal(visao(s, null).times.A.vitorias, 2);
});

test('MD1 não usa Fearless e termina no primeiro resultado', () => {
  const s = sala({ serie: 1, fearless: true });
  assert.equal(s.config.fearless, false);
  comecar(s);
  draftCompleto(s, CAMPS);
  const ev = aplicar(s, capitao(s, 'A'), { t: 'resultado', vencedor: 'B' });
  assert.deepEqual(ev.map((e) => e.tipo), ['resultado', 'serie-fim']);
});

test('draft-fim é avisado e o resumo traz picks por rota com jogador', () => {
  const s = sala();
  comecar(s);
  let ev = [];
  while (s.fase === 'draft') {
    const vez = vezAtual(s);
    const quem = vez.tipo === 'ban' ? capitao(s, vez.time) : `${vez.time}${VAGAS.find((v) => !s.jogos[0].acoes.some((a) => a.tipo === 'pick' && a.time === vez.time && a.vaga === v))}`;
    ev = aplicar(s, quem, { t: 'travar', champ: CAMPS.find((c) => !indisponiveis(s).has(c)) });
  }
  assert.deepEqual(ev, [{ tipo: 'draft-fim', jogo: 1 }]);
  aplicar(s, capitao(s, 'A'), { t: 'resultado', vencedor: 'A' });
  const r = resumoJogo(s, 1);
  assert.equal(r.times.A.lado, 'azul');
  assert.equal(r.times.A.bans.length, 5);
  assert.deepEqual(r.times.B.picks.map((p) => p.vaga), VAGAS);
  assert.equal(r.times.B.picks[0].jogador, 'B-T');
  assert.equal(r.vencedor, 'A');
});

test('nomes e configurações são limpos', () => {
  const s = novaSala({ id: 'x', campeoes: CAMPS, config: { timeA: '<script>x</script>', serie: 7, tempo: 999 } });
  assert.equal(s.times.A.nome.includes('<'), false);
  assert.equal(s.config.serie, 1);
  assert.equal(s.config.tempo, 30);
  assert.throws(() => aplicar(s, 'c', { t: 'qualquer' }), /Ação desconhecida/);
});

test('capitão tira do time quem entrou no lugar errado, e a pessoa não volta para esse time', () => {
  const s = sala();
  assert.throws(() => aplicar(s, 'AJ', { t: 'remover', vaga: 'M' }), /Só o capitão/);
  assert.throws(() => aplicar(s, 'AT', { t: 'remover', vaga: 'T' }), /passe a capitania/);
  aplicar(s, 'AT', { t: 'pronto', valor: true });
  aplicar(s, 'AT', { t: 'remover', vaga: 'M' });
  assert.equal(s.times.A.vagas.M, null);
  assert.equal(s.prontos.A, false);
  assert.throws(() => aplicar(s, 'AM', { t: 'entrar', time: 'A', vaga: 'M', nome: 'de novo' }), /tirou você/);
  aplicar(s, 'novo', { t: 'entrar', time: 'A', vaga: 'M', nome: 'Certo' });
  assert.equal(s.times.A.vagas.M.nome, 'Certo');
  comecar(s);
  assert.throws(() => aplicar(s, 'AT', { t: 'remover', vaga: 'J' }), /durante o draft/);
});
