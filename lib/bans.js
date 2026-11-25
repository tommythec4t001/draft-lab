// Bans pela sua conta: os campeões inimigos contra quem você mais perde, a partir do seu histórico salvo.
// Conta toda partida (sem remakes) em que o campeão estava no time inimigo, em qualquer rota.
// Também guarda, por rota, quantas vezes ele foi o seu adversário direto (ele e você na mesma rota).

export const MIN_JOGOS = 4;

// Rota mais jogada no histórico (para quando o cliente não informa a rota, como na personalizada).
export function rotaMaisJogada(matches) {
  const n = {};
  for (const m of matches) if (m && !m.remake && m.me?.pos) n[m.me.pos] = (n[m.me.pos] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Vitórias e jogos contra cada campeão inimigo. Devolve { [championId]: { g, w, rotas: { T: { g, w }, … } } }
// g/w: no total; rotas[X]: só as partidas em que você jogou na rota X e ele também.
export function contraCampeoes(matches) {
  const out = {};
  for (const m of matches) {
    if (!m || m.remake || !m.me || !Array.isArray(m.players)) continue;
    for (const p of m.players) {
      if (p.me || p.team === m.me.team || !(p.champ > 0)) continue;
      const e = (out[p.champ] ||= { g: 0, w: 0, rotas: {} });
      e.g++; if (m.win) e.w++;
      if (m.me.pos && p.pos === m.me.pos) { const r = (e.rotas[m.me.pos] ||= { g: 0, w: 0 }); r.g++; if (m.win) r.w++; }
    }
  }
  return out;
}

// Lista de bans em ordem de prioridade (todos os campeões com MIN_JOGOS ou mais; a tela corta em 10).
// rota: T/J/M/A/S; rolesOf(id): rotas do campeão, como "MT" (de data/roles.json ou das tags da Riot).
// "Da sua rota": o campeão joga nessa rota, ou foi o seu adversário direto nela pelo menos duas vezes.
// Ordem: da sua rota com menos de 50% → os outros com menos de 50% → o resto; dentro de cada grupo,
// menor taxa de vitória primeiro e, empatando, mais jogos primeiro.
export function bansSugeridos(matches, { rota = null, rolesOf = () => '', min = MIN_JOGOS } = {}) {
  const tab = contraCampeoes(matches);
  const lista = Object.entries(tab)
    .filter(([, e]) => e.g >= min)
    .map(([id, e]) => {
      const champ = Number(id);
      const lane = (rota && e.rotas[rota]) || { g: 0, w: 0 };
      const daRota = !!rota && (String(rolesOf(champ) || '').includes(rota) || lane.g >= 2);
      return { champ, jogos: e.g, vitorias: e.w, wr: Math.round((e.w / e.g) * 1000) / 10, daRota, naRota: { jogos: lane.g, vitorias: lane.w } };
    });
  const grupo = (x) => (x.wr < 50 ? (x.daRota ? 0 : 1) : 2);
  return lista.sort((a, b) => grupo(a) - grupo(b) || a.wr - b.wr || b.jogos - a.jogos || a.champ - b.champ);
}
