// Motor do draft InHouse: lógica pura, sem rede nem armazenamento.
// Usado pelo Durable Object na Cloudflare (worker.js) e pelo servidor local de testes (dev.js).
//
// Times fixos A e B (os nomes que o admin deu). A cada jogo, um deles fica no lado azul.
// Ordem do draft alternado de torneio (20 ações por jogo):
//   bans 1: azul, verm, azul, verm, azul, verm
//   picks 1: azul, verm, verm, azul, azul, verm
//   bans 2: verm, azul, verm, azul
//   picks 2: verm, azul, azul, verm

export const ORDEM = [
  ['azul', 'ban'], ['vermelho', 'ban'], ['azul', 'ban'], ['vermelho', 'ban'], ['azul', 'ban'], ['vermelho', 'ban'],
  ['azul', 'pick'], ['vermelho', 'pick'], ['vermelho', 'pick'], ['azul', 'pick'], ['azul', 'pick'], ['vermelho', 'pick'],
  ['vermelho', 'ban'], ['azul', 'ban'], ['vermelho', 'ban'], ['azul', 'ban'],
  ['vermelho', 'pick'], ['azul', 'pick'], ['azul', 'pick'], ['vermelho', 'pick'],
];
export const VAGAS = ['T', 'J', 'M', 'A', 'S'];
export const NOME_VAGA = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
export const SERIES = [1, 3, 5];
const TEMPOS = [20, 30, 45, 60, 90];
const NOME_MAX = 24;

export class ErroSala extends Error {
  constructor(msg) { super(msg); this.code = 'SALA'; }
}
const erro = (msg) => { throw new ErroSala(msg); };

const limpa = (s, max = NOME_MAX) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const outro = (t) => (t === 'A' ? 'B' : 'A');
const vencidos = (s, t) => s.jogos.filter((j) => j.vencedor === t).length;

// ---------- criação ----------

// partida: nome e senha da personalizada no LoL, gerados pelo servidor (ninguém escolhe).
export function novaSala({ id, campeoes, nomes, versao, dd, partida = null, agora = Date.now(), config = {} }) {
  const serie = SERIES.includes(Number(config.serie)) ? Number(config.serie) : 1;
  const tempo = TEMPOS.includes(Number(config.tempo)) ? Number(config.tempo) : 30;
  const nomeA = limpa(config.timeA) || 'Time 1';
  const nomeB = limpa(config.timeB) || 'Time 2';
  const vagasVazias = () => Object.fromEntries(VAGAS.map((v) => [v, null]));
  return {
    v: 1,
    id,
    criado: agora,
    ativo: agora,
    versao: versao || null,
    dd: dd || 'https://ddragon.leagueoflegends.com',
    campeoes: [...new Set(campeoes || [])],
    nomes: nomes || {}, // id -> nome do campeão, para as mensagens do Discord
    config: { serie, fearless: serie > 1 && config.fearless !== false, tempo },
    partida: partida ? { nome: limpa(partida.nome, 60), senha: limpa(partida.senha, 20) } : null,
    times: {
      A: { nome: nomeA, capitao: null, vagas: vagasVazias(), fora: [] },
      B: { nome: nomeB, capitao: null, vagas: vagasVazias(), fora: [] },
    },
    jogos: [novoJogo('A')],
    fase: 'lobby', // lobby | draft | jogando | lado | encerrada
    prontos: { A: false, B: false },
    vez: 0,
    prazo: null,
    esgotado: false,
    hover: {}, // cid -> { champ, em }
    ladoPor: null, // time que escolhe o lado do próximo jogo
  };
}

function novoJogo(azul) {
  return { azul, acoes: [], vencedor: null, inicio: null, fimDraft: null, fim: null };
}

// ---------- consultas ----------

export const jogoAtual = (s) => s.jogos[s.jogos.length - 1];
export const timeNoLado = (s, lado, jogo = jogoAtual(s)) => (lado === 'azul' ? jogo.azul : outro(jogo.azul));
export const ladoDoTime = (s, t, jogo = jogoAtual(s)) => (jogo.azul === t ? 'azul' : 'vermelho');

export function vezAtual(s) {
  if (s.fase !== 'draft' || s.vez >= ORDEM.length) return null;
  const [lado, tipo] = ORDEM[s.vez];
  return { n: s.vez, lado, tipo, time: timeNoLado(s, lado) };
}

// Campeões fora do draft atual: bans e picks deste jogo + picks de jogos anteriores (Fearless).
export function indisponiveis(s) {
  const fora = new Set();
  const atual = jogoAtual(s);
  for (const a of atual.acoes) if (a.champ) fora.add(a.champ);
  for (const c of bloqueadosFearless(s)) fora.add(c);
  return fora;
}

export function bloqueadosFearless(s) {
  const fora = new Set();
  if (!s.config.fearless) return fora;
  for (const j of s.jogos.slice(0, -1)) for (const a of j.acoes) if (a.tipo === 'pick' && a.champ) fora.add(a.champ);
  return fora;
}

export function assentoDe(s, cid) {
  if (!cid) return null;
  for (const t of ['A', 'B']) for (const v of VAGAS) if (s.times[t].vagas[v]?.cid === cid) return { time: t, vaga: v };
  return null;
}

const ehCapitao = (s, cid, t) => !!cid && s.times[t].capitao === cid;
const pickDaVaga = (jogo, t, v) => jogo.acoes.find((a) => a.tipo === 'pick' && a.time === t && a.vaga === v);

// Quem pode agir agora: o capitão nos bans; nos picks, qualquer jogador do time que ainda não escolheu
// (e o capitão, que pode escolher por uma vaga vazia ou por quem não apareceu).
export function podeAgir(s, cid) {
  const vez = vezAtual(s);
  if (!vez || !cid) return false;
  const assento = assentoDe(s, cid);
  if (!assento || assento.time !== vez.time) return false;
  if (vez.tipo === 'ban') return ehCapitao(s, cid, vez.time);
  if (ehCapitao(s, cid, vez.time)) return vagasSemPick(s, vez.time).length > 0;
  return !pickDaVaga(jogoAtual(s), vez.time, assento.vaga);
}

export function vagasSemPick(s, t) {
  const jogo = jogoAtual(s);
  return VAGAS.filter((v) => !pickDaVaga(jogo, t, v));
}

// ---------- ações ----------
// Cada ação recebe o estado, o cid de quem age e os dados; muda o estado ou lança ErroSala.
// Devolve uma lista de eventos ('draft-fim', 'resultado', 'serie-fim') para o servidor avisar o Discord e o arquivo.

export function aplicar(s, cid, msg, agora = Date.now()) {
  const ev = [];
  switch (msg?.t) {
    case 'entrar': entrar(s, cid, msg); break;
    case 'sair': sair(s, cid); break;
    case 'remover': remover(s, cid, msg.vaga); break;
    case 'capitao': passarCapitao(s, cid, msg.vaga); break;
    case 'pronto': pronto(s, cid, !!msg.valor, agora); break;
    case 'hover': hover(s, cid, msg.champ, agora); break;
    case 'travar': travar(s, cid, msg, agora, ev); break;
    case 'resultado': resultado(s, cid, msg.vencedor, agora, ev); break;
    case 'lado': escolherLado(s, cid, msg.lado); break;
    default: erro('Ação desconhecida.');
  }
  s.ativo = agora;
  return ev;
}

// Um link só para todos: cada um escolhe o time e a rota. O capitão pode tirar quem entrou no lugar errado.
function entrar(s, cid, { time, vaga, nome }) {
  if (!cid) erro('Conexão sem identificação.');
  if (time !== 'A' && time !== 'B') erro('Escolha um time.');
  if (s.times[time].fora.includes(cid)) erro('O capitão tirou você deste time. Fale com ele na call.');
  if (!VAGAS.includes(vaga)) erro('Escolha uma rota.');
  const n = limpa(nome);
  if (!n) erro('Digite seu nick.');
  if (s.fase === 'encerrada') erro('A série já terminou.');
  const ocup = s.times[time].vagas[vaga];
  if (ocup && ocup.cid !== cid) erro(`${NOME_VAGA[vaga]} já está com ${ocup.nome}.`);
  const antes = assentoDe(s, cid);
  if (antes && s.fase === 'draft') {
    if (antes.time !== time || antes.vaga !== vaga) erro('Não dá para trocar de rota durante o draft.');
  }
  if (antes && antes.time !== time && s.times[antes.time].capitao === cid) s.times[antes.time].capitao = null;
  if (antes) s.times[antes.time].vagas[antes.vaga] = null;
  s.times[time].vagas[vaga] = { cid, nome: n };
  if (!s.times[time].capitao) s.times[time].capitao = cid;
  if (antes && antes.time !== time) novoCapitao(s, antes.time);
}

function sair(s, cid) {
  const a = assentoDe(s, cid);
  if (!a) return;
  if (s.fase === 'draft') erro('Não dá para sair no meio do draft. O capitão pode escolher pela sua rota.');
  s.times[a.time].vagas[a.vaga] = null;
  delete s.hover[cid];
  if (s.times[a.time].capitao === cid) novoCapitao(s, a.time);
  s.prontos[a.time] = false;
}

function remover(s, cid, vaga) {
  const a = assentoDe(s, cid);
  if (!a || !ehCapitao(s, cid, a.time)) erro('Só o capitão pode tirar alguém do time.');
  if (s.fase === 'draft') erro('Não dá para tirar ninguém durante o draft.');
  const p = VAGAS.includes(vaga) && s.times[a.time].vagas[vaga];
  if (!p) erro('Essa rota já está livre.');
  if (p.cid === cid) erro('Para sair, passe a capitania antes.');
  s.times[a.time].vagas[vaga] = null;
  s.times[a.time].fora.push(p.cid);
  delete s.hover[p.cid];
  s.prontos[a.time] = false;
}

function novoCapitao(s, t) {
  const primeiro = VAGAS.map((v) => s.times[t].vagas[v]).find(Boolean);
  s.times[t].capitao = primeiro ? primeiro.cid : null;
}

// O navegador não conhece os ids dos outros jogadores: a capitania é passada pela rota.
function passarCapitao(s, cid, vaga) {
  const a = assentoDe(s, cid);
  if (!a || !ehCapitao(s, cid, a.time)) erro('Só o capitão pode passar a capitania.');
  const p = VAGAS.includes(vaga) && s.times[a.time].vagas[vaga];
  if (!p) erro('Escolha alguém do seu time.');
  s.times[a.time].capitao = p.cid;
}

function pronto(s, cid, valor, agora) {
  if (s.fase !== 'lobby') erro('O draft já começou.');
  const a = assentoDe(s, cid);
  if (!a || !ehCapitao(s, cid, a.time)) erro('Só o capitão confirma que o time está pronto.');
  s.prontos[a.time] = valor;
  if (s.prontos.A && s.prontos.B) iniciarDraft(s, agora);
}

function iniciarDraft(s, agora) {
  s.fase = 'draft';
  s.vez = 0;
  s.hover = {};
  s.esgotado = false;
  jogoAtual(s).inicio = agora;
  s.prazo = agora + s.config.tempo * 1000;
}

function validaCampeao(s, champ) {
  if (typeof champ !== 'string' || !s.campeoes.includes(champ)) erro('Campeão inválido.');
  if (bloqueadosFearless(s).has(champ)) erro('Esse campeão já foi usado na série (Fearless).');
  if (indisponiveis(s).has(champ)) erro('Esse campeão já foi banido ou escolhido.');
}

function hover(s, cid, champ, agora) {
  if (s.fase !== 'draft') erro('O draft não está acontecendo.');
  const a = assentoDe(s, cid);
  if (!a) erro('Você está assistindo.');
  if (champ === null) { delete s.hover[cid]; return; }
  validaCampeao(s, champ);
  s.hover[cid] = { champ, em: agora };
}

function travar(s, cid, { champ, vaga }, agora, ev) {
  const vez = vezAtual(s);
  if (!vez) erro('Não é hora de escolher.');
  if (!podeAgir(s, cid)) {
    const a = assentoDe(s, cid);
    if (!a || a.time !== vez.time) erro('Não é a vez do seu time.');
    erro(vez.tipo === 'ban' ? 'Só o capitão bane.' : 'Você já escolheu o seu campeão.');
  }
  const c = champ ?? s.hover[cid]?.champ;
  if (!c) erro('Escolha um campeão.');
  validaCampeao(s, c);
  let v = null;
  if (vez.tipo === 'pick') {
    const meu = assentoDe(s, cid);
    const livres = vagasSemPick(s, vez.time);
    if (ehCapitao(s, cid, vez.time) && vaga) {
      if (!livres.includes(vaga)) erro('Essa rota já escolheu.');
      v = vaga;
    } else {
      if (!livres.includes(meu.vaga)) erro('Você já escolheu. Escolha a rota de quem vai receber o campeão.');
      v = meu.vaga;
    }
  }
  registrar(s, vez, c, v, cid, agora, ev);
}

function registrar(s, vez, champ, vaga, cid, agora, ev) {
  const jogo = jogoAtual(s);
  jogo.acoes.push({ n: vez.n, lado: vez.lado, time: vez.time, tipo: vez.tipo, champ, vaga, por: cid || null, em: agora });
  for (const [k, h] of Object.entries(s.hover)) if (h.champ === champ) delete s.hover[k];
  if (vaga) { const dono = s.times[vez.time].vagas[vaga]; if (dono) delete s.hover[dono.cid]; }
  s.vez += 1;
  s.esgotado = false;
  if (s.vez >= ORDEM.length) {
    s.fase = 'jogando';
    s.prazo = null;
    s.hover = {};
    jogo.fimDraft = agora;
    ev.push({ tipo: 'draft-fim', jogo: s.jogos.length });
  } else {
    s.prazo = agora + s.config.tempo * 1000;
  }
}

// Tempo esgotado. Ban: trava o que o capitão marcou ou fica sem ban. Pick: trava a marcação mais antiga
// de quem ainda não escolheu; sem marcação, o draft espera (o time combina na call e alguém trava).
export function tempoEsgotado(s, agora = Date.now()) {
  const vez = vezAtual(s);
  if (!vez || !s.prazo || agora < s.prazo) return [];
  const ev = [];
  const t = s.times[vez.time];
  if (vez.tipo === 'ban') {
    const h = t.capitao && s.hover[t.capitao];
    let champ = null;
    if (h) { try { validaCampeao(s, h.champ); champ = h.champ; } catch { champ = null; } }
    registrar(s, vez, champ, null, null, agora, ev);
    return ev;
  }
  const livres = new Set(vagasSemPick(s, vez.time));
  const candidatos = VAGAS.filter((v) => livres.has(v) && t.vagas[v] && s.hover[t.vagas[v].cid])
    .map((v) => ({ v, h: s.hover[t.vagas[v].cid] }))
    .sort((x, y) => x.h.em - y.h.em);
  for (const { v, h } of candidatos) {
    try { validaCampeao(s, h.champ); } catch { continue; }
    registrar(s, vez, h.champ, v, null, agora, ev);
    return ev;
  }
  s.prazo = null;
  s.esgotado = true;
  return ev;
}

function resultado(s, cid, vencedor, agora, ev) {
  if (s.fase !== 'jogando') erro('Ainda não dá para informar o resultado.');
  if (vencedor !== 'A' && vencedor !== 'B') erro('Time inválido.');
  const a = assentoDe(s, cid);
  if (!a || !ehCapitao(s, cid, a.time)) erro('Só um capitão informa o resultado.');
  const jogo = jogoAtual(s);
  jogo.vencedor = vencedor;
  jogo.fim = agora;
  jogo.informadoPor = a.time;
  ev.push({ tipo: 'resultado', jogo: s.jogos.length, vencedor });
  const precisa = Math.ceil(s.config.serie / 2);
  if (vencidos(s, vencedor) >= precisa) {
    s.fase = 'encerrada';
    s.ladoPor = null;
    ev.push({ tipo: 'serie-fim', vencedor });
    return;
  }
  s.fase = 'lado';
  s.ladoPor = outro(vencedor); // quem perdeu escolhe o lado do próximo jogo
}

function escolherLado(s, cid, lado) {
  if (s.fase !== 'lado') erro('Não é hora de escolher o lado.');
  if (lado !== 'azul' && lado !== 'vermelho') erro('Lado inválido.');
  const t = s.ladoPor;
  if (!ehCapitao(s, cid, t)) erro('Quem escolhe o lado é o capitão do time que perdeu.');
  s.jogos.push(novoJogo(lado === 'azul' ? t : outro(t)));
  s.fase = 'lobby';
  s.prontos = { A: false, B: false };
  s.ladoPor = null;
  s.vez = 0;
  s.prazo = null;
  s.esgotado = false;
  s.hover = {};
}

// ---------- visão pública ----------
// O que cada conexão recebe. Tokens nunca saem; marcações (hover) só aparecem para o próprio time,
// exceto a do time que está escolhendo agora, que todos veem (igual no cliente do LoL).

export function visao(s, cid, agora = Date.now()) {
  const meu = assentoDe(s, cid);
  const vez = vezAtual(s);
  const hovers = {};
  for (const t of ['A', 'B']) {
    for (const v of VAGAS) {
      const p = s.times[t].vagas[v];
      const h = p && s.hover[p.cid];
      if (!h) continue;
      if ((meu && meu.time === t) || (vez && vez.time === t)) (hovers[t] ||= {})[v] = h.champ;
    }
  }
  const times = {};
  for (const t of ['A', 'B']) {
    const T = s.times[t];
    times[t] = {
      nome: T.nome,
      vitorias: vencidos(s, t),
      pronto: s.prontos[t],
      vagas: Object.fromEntries(VAGAS.map((v) => [v, T.vagas[v] ? { nome: T.vagas[v].nome, capitao: T.vagas[v].cid === T.capitao, eu: T.vagas[v].cid === cid } : null])),
    };
  }
  return {
    id: s.id,
    agora,
    versao: s.versao,
    dd: s.dd,
    config: s.config,
    partida: s.partida,
    fase: s.fase,
    times,
    jogos: s.jogos.map((j) => ({
      azul: j.azul,
      vencedor: j.vencedor,
      acoes: j.acoes.map((a) => ({ n: a.n, lado: a.lado, time: a.time, tipo: a.tipo, champ: a.champ, vaga: a.vaga })),
    })),
    vez: vez && { ...vez, prazo: s.prazo, esgotado: s.esgotado },
    hovers,
    fearless: [...bloqueadosFearless(s)],
    ladoPor: s.ladoPor,
    eu: meu ? { ...meu, capitao: ehCapitao(s, cid, meu.time), podeAgir: podeAgir(s, cid), livres: vez && vez.tipo === 'pick' && vez.time === meu.time ? vagasSemPick(s, meu.time) : [] } : null,
  };
}

// Resumo de um jogo terminado, para o arquivo de estatísticas e para o Discord.
export function resumoJogo(s, n) {
  const j = s.jogos[n - 1];
  if (!j) return null;
  const lado = (t) => (j.azul === t ? 'azul' : 'vermelho');
  const times = {};
  for (const t of ['A', 'B']) {
    times[t] = {
      nome: s.times[t].nome,
      lado: lado(t),
      bans: j.acoes.filter((a) => a.tipo === 'ban' && a.time === t).map((a) => a.champ),
      picks: VAGAS.map((v) => {
        const a = j.acoes.find((x) => x.tipo === 'pick' && x.time === t && x.vaga === v);
        return { vaga: v, champ: a?.champ || null, jogador: s.times[t].vagas[v]?.nome || null };
      }),
    };
  }
  return {
    sala: s.id,
    jogo: n,
    serie: s.config.serie,
    fearless: s.config.fearless,
    titulo: s.partida?.nome || null,
    versao: s.versao,
    inicio: j.inicio,
    fimDraft: j.fimDraft,
    fim: j.fim,
    vencedor: j.vencedor,
    times,
  };
}
