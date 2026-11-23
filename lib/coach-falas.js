// Coach pós-partida: transforma os fatos (coach.js) em texto, em dois tons.
//   serio: direto, de treinador, focado em subir de elo.
//   divertido: brincalhão, para stream e para rir de si mesmo, sem ofender ninguém.
// Cada situação tem algumas versões; a escolhida depende da partida, então a mesma partida sempre lê igual.

export const TONS = { serio: 'Sério', divertido: 'Divertido' };
const ROTA = { T: 'topo', J: 'selva', M: 'meio', A: 'atirador', S: 'suporte' };

const fmtN = (n, d = 0) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const abs = (n) => fmtN(Math.abs(Math.round(n)));
const plural = (n, um, varios) => (n === 1 ? um : varios);

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Escolhe uma versão de forma estável (mesma partida e situação = mesma frase).
const pick = (lista, semente) => lista[hash(semente) % lista.length];
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

const F = {
  abertura: {
    bomVitoria: {
      serio: ['Partida sólida de {champ}: nota {letra}. Você foi uma das razões da vitória.', 'Nota {letra} com {champ}. Atuação de quem está pronto para subir.'],
      divertido: ['Nota {letra} e vitória? Hoje o {champ} acordou inspirado.', 'Nota {letra}. Pode printar e mandar no grupo, essa foi bonita.'],
    },
    bomDerrota: {
      serio: ['Derrota, mas a sua parte foi bem feita: nota {letra}. Nem toda partida dá para carregar sozinho.', 'Nota {letra} numa derrota. Continue jogando assim que as vitórias vêm.'],
      divertido: ['Você fez o seu, nota {letra}. O resto do time é que esqueceu de vir junto.', 'Nota {letra} e derrota. Injustiça? Um pouco. Mas o PDL não liga para sentimentos.'],
    },
    medioVitoria: {
      serio: ['Vitória com uma atuação correta (nota {letra}). Dá para tirar mais de partidas assim.', 'Nota {letra} e vitória. Bom resultado, com espaço claro para melhorar.'],
      divertido: ['Vitória na conta, nota {letra}. Ganhou, mas dá para ganhar mais bonito.', 'Nota {letra}. Venceu no estilo "deu certo, não mexe".'],
    },
    medioDerrota: {
      serio: ['Derrota com uma atuação mediana (nota {letra}). Alguns ajustes teriam mudado a partida.', 'Nota {letra} numa derrota. Vamos ver onde estava a diferença.'],
      divertido: ['Nota {letra} e derrota: não foi tragédia, mas também não foi filme de herói.', 'Nota {letra}. Nem o vilão, nem o herói: o figurante dessa derrota.'],
    },
    ruimVitoria: {
      serio: ['Vitória, mas a sua atuação ficou abaixo do esperado (nota {letra}). O time segurou essa.', 'Nota {letra}. Vitória importante, mas não dá para contar com isso toda partida.'],
      divertido: ['Ganhou, mas vamos ser honestos: o time te carregou nas costas hoje. Nota {letra}.', 'Nota {letra} e vitória. Agradeça ao time com um "gg wp" bem caprichado.'],
    },
    ruimDerrota: {
      serio: ['Partida difícil: nota {letra}. Vamos olhar o que pesou mais.', 'Nota {letra}. Partida para aprender, não para lamentar.'],
      divertido: ['Nota {letra}... Respira, toma uma água, e vamos ver onde a coisa desandou.', 'Nota {letra}. Essa vai para a pasta "partidas que nunca aconteceram".'],
    },
  },
  rota: {
    muitoFrente: {
      serio: ['Fase de rotas forte: aos {min} minutos você tinha {ouro} de ouro e {cs} de CS a mais que {opp}.', 'Você dominou a rota: {ouro} de ouro de vantagem sobre {opp} aos {min} minutos.'],
      divertido: ['Você atropelou {opp} na rota: {ouro} de ouro à frente aos {min} minutos. Coitado.', '{ouro} de ouro na frente de {opp} aos {min} minutos. Alguém avisa ele que acabou.'],
    },
    frente: {
      serio: ['Rota vencida: {ouro} de ouro de vantagem sobre {opp} aos {min} minutos.', 'Você saiu da fase de rotas na frente de {opp}, com {ouro} de ouro a mais aos {min} minutos.'],
      divertido: ['Rota ganha no detalhe: {ouro} de ouro a mais que {opp} aos {min} minutos. Ganhar é ganhar.', 'Vantagem de {ouro} de ouro sobre {opp} aos {min}. Nada épico, mas o placar é seu.'],
    },
    empate: {
      serio: ['Rota equilibrada contra {opp}: {dif} de ouro aos {min} minutos.', 'Fase de rotas empatada contra {opp} ({dif} de ouro aos {min} minutos).'],
      divertido: ['Empate técnico contra {opp}. Ninguém ganhou, ninguém perdeu, todo mundo farmou.', 'Você e {opp} passaram {min} minutos se encarando. Empate.'],
    },
    atras: {
      serio: ['{opp} saiu da rota na frente: {ouro} de ouro a mais que você aos {min} minutos.', 'Rota perdida por pouco: {ouro} de ouro atrás de {opp} aos {min} minutos.'],
      divertido: ['{opp} levou a melhor na rota: {ouro} de ouro de vantagem aos {min}. Acontece.', '{ouro} de ouro atrás de {opp} aos {min} minutos. Nada que uma boa luta não resolva... ou não.'],
    },
    muitoAtras: {
      serio: ['A fase de rotas pesou: {opp} chegou aos {min} minutos com {ouro} de ouro a mais.', 'Rota perdida: {ouro} de ouro de desvantagem para {opp} aos {min} minutos.'],
      divertido: ['A rota virou um pesadelo: {opp} chegou aos {min} com {ouro} de ouro a mais. Vamos esquecer essa parte.', '{opp} fez a festa: {ouro} de ouro à frente aos {min} minutos. Ele vai lembrar dessa partida com carinho.'],
    },
  },
  mortesCedo: {
    serio: ['{n} mortes antes dos 14 minutos{gankTxt}. Cada uma dá ouro ao inimigo e tira você do mapa.', 'Você morreu {n} vezes até os 14 minutos{gankTxt}. É aí que a partida escapou.'],
    divertido: ['{n} mortes antes dos 14 minutos{gankTxt}. O tempo de renascer virou o seu segundo trabalho.', '{n} mortes até os 14{gankTxt}. A fonte já estava com saudade de você.'],
  },
  ganks: {
    serio: [', {g} delas com {jg} envolvido', ', {g} com participação de {jg}'],
    divertido: [', {g} delas cortesia de {jg}', ', e {jg} apareceu em {g} delas como se tivesse convite'],
  },
  sozinho: {
    serio: ['{s} mortes sozinho contra {opp}: essas trocas não estavam a seu favor.', '{opp} te abateu sozinho {s} vezes. Respeite mais o dano dele na rota.'],
    divertido: ['{opp} te pegou sozinho {s} vezes. Ele deve estar contando para os amigos.', '{s} mortes no mano a mano para {opp}. Ele já te chama pelo nome.'],
  },
  semMortes: {
    serio: ['Nenhuma morte na partida: posicionamento muito seguro.', 'Zero mortes. Esse é o padrão a manter.'],
    divertido: ['Zero mortes. Imortal. Lendário. Quase suspeito.', 'Não morreu nenhuma vez. A fonte nem lembra da sua cara.'],
  },
  perdido: {
    serio: ['Sua morte aos {morteEm} deixou o time sem você no {obj}, que o inimigo pegou {depois} segundos depois.', 'Você morreu aos {morteEm} e o inimigo pegou o {obj} {depois} segundos depois. Morrer antes de objetivo custa caro.'],
    divertido: ['Você morreu aos {morteEm} e, {depois} segundos depois, lá se foi o {obj}. Timing de novela.', 'Morte aos {morteEm}, {obj} inimigo {depois} segundos depois. O time sentiu a sua falta.'],
  },
  farmBaixo: {
    serio: ['Farm abaixo {daMedia}: {v} CS por minuto, contra {elo}.', '{v} CS por minuto, abaixo dos {elo} {doElo}. Farm é ouro garantido.'],
    divertido: ['{v} CS por minuto... os minions agradecem por terem sobrevivido.', '{v} CS por minuto. A média {doElo} é {elo}. Os minions estão rindo.'],
  },
  farmAlto: {
    serio: ['Farm acima da média: {v} CS por minuto.', 'Ótimo farm: {v} CS por minuto, acima dos {elo} {doElo}.'],
    divertido: ['{v} CS por minuto. Os minions não tiveram chance.', '{v} CS por minuto. Fazendeiro do ano.'],
  },
  semControle: {
    serio: ['Nenhuma sentinela de controle na partida. Uma a cada volta à base já muda o controle do mapa.', 'Zero sentinelas de controle. Esse é um ajuste fácil para a próxima.'],
    divertido: ['Zero sentinelas de controle. 75 de ouro, gente. 75.', 'Nenhuma sentinela de controle. O mapa ficou no escuro e você também.'],
  },
  visaoAlta: {
    serio: ['Boa visão: {v} de placar de visão por minuto, acima {daMedia}.', 'Placar de visão de {v} por minuto. O time jogou com o mapa aceso.'],
    divertido: ['Visão impecável: {v} por minuto. O mapa era todo seu.', '{v} de visão por minuto. Você tem um farol no lugar do campeão.'],
  },
  danoAlto: {
    serio: ['Muito dano: {v} por minuto em campeões, bem acima {daMedia}.', 'Dano alto: {v} por minuto em campeões.'],
    divertido: ['{v} de dano por minuto. Você não estava lá para fazer amigos.', '{v} de dano por minuto. O time inimigo pediu nerf.'],
  },
  danoBaixo: {
    serio: ['Pouco dano nas lutas: {v} por minuto em campeões, abaixo {daMedia}.', 'Dano baixo: {v} por minuto. Procure lutas em que você consiga encostar.'],
    divertido: ['{v} de dano por minuto. Faltou apertar os botões nas lutas.', '{v} de dano por minuto. Os inimigos nem perceberam que você estava lá.'],
  },
  kpBaixa: {
    serio: ['Participação em abates de {v}%: você ficou longe das lutas do time.', 'Só {v}% de participação em abates. O time lutou sem você.'],
    divertido: ['{v}% de participação em abates. O time lutou e você estava... onde mesmo?', '{v}% de participação. Você jogou um modo solo dentro de um jogo em equipe.'],
  },
  kpAlta: {
    serio: ['Participação em abates de {v}%: presente em quase toda luta.', '{v}% de participação em abates. Você esteve onde a partida aconteceu.'],
    divertido: ['{v}% de participação em abates. Não teve briga sem você.', '{v}% de participação. Onde tinha confusão, tinha você.'],
  },
  multi: {
    serio: ['Destaque: um {multi} kill.', 'Destaque da partida: {multi} kill.'],
    divertido: ['{Multi} kill! Pode deixar o clipe rodando.', '{Multi} kill. A fila de espera já tem medo de você.'],
  },
  soloKills: {
    serio: ['{s} abates sozinho: você ganhou as trocas que importavam.', '{s} abates no um contra um.'],
    divertido: ['{s} abates no mano a mano. Respeita.', '{s} abates sozinho. Você não precisa de ajuda, né?'],
  },
  firstBlood: {
    serio: ['Primeiro abate da partida foi seu.', 'Você abriu o placar com o primeiro abate.'],
    divertido: ['First blood! Começou a partida com o pé na porta.', 'Primeiro sangue é seu. Educação zero, eficiência total.'],
  },
};

const FOCO = {
  mortesCedo: {
    serio: 'Próxima partida: nos primeiros 14 minutos, saiba onde está o caçador inimigo antes de avançar e evite trocas sem visão.',
    divertido: 'Próxima partida: antes de avançar na rota, pergunte "onde está o caçador inimigo?". Se não souber, não vá.',
  },
  sozinho: {
    serio: 'Próxima partida: só troque com o adversário de rota quando ele errar o farm ou gastar a habilidade principal.',
    divertido: 'Próxima partida: mano a mano só quando ele errar. Coragem é bonita, mas o PDL é mais.',
  },
  perdido: {
    serio: 'Próxima partida: quando um objetivo estiver para nascer, jogue mais seguro no minuto anterior. Estar vivo vale mais que um abate.',
    divertido: 'Próxima partida: objetivo nascendo? Não morra no minuto antes. Simples assim. Quase.',
  },
  farm: {
    serio: 'Próxima partida: meta de {alvo} CS aos 10 minutos. Pense em farm antes de pensar em trocas.',
    divertido: 'Próxima partida: {alvo} CS aos 10 minutos. Cada minion é uma moedinha. Pegue as moedinhas.',
  },
  visao: {
    serio: 'Próxima partida: compre uma sentinela de controle em toda volta à base.',
    divertido: 'Próxima partida: sentinela de controle em toda volta à base. É o item mais barato e o mais esquecido.',
  },
  kp: {
    serio: 'Próxima partida: depois da fase de rotas, acompanhe o time nos objetivos em vez de ficar farmando longe.',
    divertido: 'Próxima partida: quando o time for para o dragão, vá junto. Farmar sozinho é bom, ganhar é melhor.',
  },
  dano: {
    serio: 'Próxima partida: nas lutas, procure posições em que você consiga usar todas as habilidades com segurança.',
    divertido: 'Próxima partida: nas lutas, aperte os botões. Todos. De preferência no inimigo.',
  },
  rota: {
    serio: 'Próxima partida: na rota, priorize o farm e espere o adversário errar antes de buscar a troca.',
    divertido: 'Próxima partida: deixe o adversário de rota errar primeiro. Paciência também ganha partida.',
  },
  manter: {
    serio: 'Próxima partida: mantenha o que funcionou e tente transformar a vantagem em objetivos mais cedo.',
    divertido: 'Próxima partida: faça igualzinho. E, se der, termine a partida mais cedo para dar tempo de jogar outra.',
  },
};

// Monta o texto: { titulo, blocos: [{ tipo: 'bom'|'ruim'|'info', texto }], foco, falado }
export function textoCoach(f, tom = 'serio') {
  const t = TONS[tom] ? tom : 'serio';
  const s = (k) => `${f.id}:${t}:${k}`;
  const M = Object.fromEntries((f.metricas || []).map((x) => [x.id, x]));
  const pct = (id) => M[id]?.pct;
  const val = (id, d = 1) => (M[id] ? fmtN(M[id].valor, d) : '');
  const elo = (id, d = 1) => (M[id]?.elo != null ? fmtN(M[id].elo, d) : '');
  const blocos = [];
  // Sem partidas do elo coletadas, a comparação é com uma referência aproximada: o texto diz isso.
  const ref = f.aprox ? { doElo: 'da referência', daMedia: 'da referência' } : { doElo: 'do elo', daMedia: 'da média do elo' };
  const add = (tipo, lista, vars, chave) => blocos.push({ tipo, texto: fill(pick(lista[t], s(chave)), { ...ref, ...vars }) });
  const problemas = []; // [gravidade, foco]

  // Abertura
  const letra = f.nota?.letra || '?';
  const faixa = ['S', 'A'].includes(letra) ? 'bom' : letra === 'B' ? 'medio' : 'ruim';
  const titulo = fill(pick(F.abertura[`${faixa}${f.win ? 'Vitoria' : 'Derrota'}`][t], s('abertura')), { champ: f.champ, letra });

  // Fase de rotas
  const r = f.rota?.aos14 || f.rota?.aos10;
  if (r && f.role !== 'S') {
    const vars = { opp: f.rota.oponente, ouro: abs(r.ouro), dif: (r.ouro >= 0 ? '+' : '−') + abs(r.ouro), cs: abs(r.cs), min: r.min };
    const k = r.ouro >= 1000 ? 'muitoFrente' : r.ouro >= 300 ? 'frente' : r.ouro > -300 ? 'empate' : r.ouro > -1000 ? 'atras' : 'muitoAtras';
    add(r.ouro >= 300 ? 'bom' : r.ouro > -300 ? 'info' : 'ruim', F.rota[k], vars, 'rota');
    if (r.ouro <= -1000) problemas.push([3, 'rota']);
    else if (r.ouro <= -300) problemas.push([1.5, 'rota']);
  }

  // Mortes
  if (f.destaques?.semMortes) add('bom', F.semMortes, {}, 'semMortes');
  else if (f.mortesCedo >= 2) {
    const gankTxt = f.ganks && f.jgInimigo ? fill(pick(F.ganks[t], s('ganks')), { g: f.ganks, jg: f.jgInimigo }) : '';
    add('ruim', F.mortesCedo, { n: f.mortesCedo, gankTxt }, 'mortesCedo');
    problemas.push([2 + f.mortesCedo * 0.5, 'mortesCedo']);
  }
  if (f.mortesNaRota >= 2 && f.rota) {
    add('ruim', F.sozinho, { s: f.mortesNaRota, opp: f.rota.oponente }, 'sozinho');
    problemas.push([2 + f.mortesNaRota * 0.4, 'sozinho']);
  }
  const perdido = f.perdidos?.[0];
  if (perdido) {
    add('ruim', F.perdido, perdido, 'perdido');
    problemas.push([2.5 + (f.perdidos.length - 1), 'perdido']);
  }

  // Farm (não vale para suporte)
  if (f.role !== 'S' && pct('csm') != null) {
    if (pct('csm') < 35) { add('ruim', F.farmBaixo, { v: val('csm'), elo: elo('csm') }, 'farm'); problemas.push([(35 - pct('csm')) / 10 + 1.5, 'farm']); }
    else if (pct('csm') >= 70) add('bom', F.farmAlto, { v: val('csm'), elo: elo('csm') }, 'farm');
  }

  // Lutas
  if (pct('dpm') != null && f.role !== 'S') {
    if (pct('dpm') >= 75) add('bom', F.danoAlto, { v: val('dpm', 0), p: Math.round(pct('dpm')) }, 'dano');
    else if (pct('dpm') < 25) { add('ruim', F.danoBaixo, { v: val('dpm', 0) }, 'dano'); problemas.push([1.5, 'dano']); }
  }
  if (pct('kp') != null) {
    if (pct('kp') >= 75) add('bom', F.kpAlta, { v: val('kp', 0) }, 'kp');
    else if (pct('kp') < 25) { add('ruim', F.kpBaixa, { v: val('kp', 0) }, 'kp'); problemas.push([1.8, 'kp']); }
  }

  // Visão
  if (f.controle === 0 && f.minutos >= 20) { add('ruim', F.semControle, {}, 'controle'); problemas.push([f.role === 'S' || f.role === 'J' ? 2.2 : 1.2, 'visao']); }
  else if (pct('vspm') != null && pct('vspm') >= 75) add('bom', F.visaoAlta, { v: val('vspm', 2) }, 'visao');

  // Destaques
  const d = f.destaques || {};
  if (d.multi) add('bom', F.multi, { multi: d.multi, Multi: d.multi[0].toUpperCase() + d.multi.slice(1) }, 'multi');
  else if (d.soloKills >= 2) add('bom', F.soloKills, { s: d.soloKills }, 'solo');
  else if (d.firstBlood) add('bom', F.firstBlood, {}, 'fb');

  // Foco: o problema mais grave; sem problemas, manter o que funcionou.
  problemas.sort((a, b) => b[0] - a[0]);
  const chave = problemas[0]?.[1] || 'manter';
  const alvo = M.cs10?.elo != null ? Math.round(Math.max(M.cs10.elo, (M.cs10.valor || 0) + 8)) : f.role === 'J' ? 60 : 70;
  const foco = fill(FOCO[chave][t], { alvo });

  return { tom: t, titulo, blocos, foco, focoChave: chave, rota: ROTA[f.role] || null, mortesTxt: f.mortes?.length ? `${f.mortes.length} ${plural(f.mortes.length, 'morte', 'mortes')}` : null };
}
