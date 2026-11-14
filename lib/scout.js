// Campeões mais jogados de cada aliado, pelo histórico de partidas do próprio cliente do LoL.
// Só para quem tem o nome visível no champ select (fora da Ranqueada Solo/Duo, o cliente mostra os nomes).
// O champ select nunca mostra os inimigos, então só os aliados entram.

// Rota de uma partida do histórico (campos lane/role do cliente)
export function roleOfGame(p) {
  const lane = String(p?.timeline?.lane || '').toUpperCase();
  const role = String(p?.timeline?.role || '').toUpperCase();
  if (lane === 'TOP') return 'T';
  if (lane === 'JUNGLE') return 'J';
  if (lane === 'MIDDLE' || lane === 'MID') return 'M';
  if (lane === 'BOTTOM' || lane === 'BOT') return role === 'DUO_SUPPORT' || role === 'SUPPORT' ? 'S' : 'A';
  return '';
}

// Resposta de /lol-match-history/v1/products/lol/{puuid}/matches → [{ championId, role, win }]
// Só partidas de Summoner's Rift (sem ARAM e modos especiais).
export function parseHistory(json, puuid) {
  const games = json?.games?.games || [];
  const out = [];
  for (const g of games) {
    if (g.mapId !== 11 || (g.gameMode && g.gameMode !== 'CLASSIC')) continue;
    const ids = g.participantIdentities || [];
    const id = ids.find((x) => x.player?.puuid === puuid)?.participantId;
    const p = (g.participants || []).find((x) => x.participantId === id) || (g.participants?.length === 1 ? g.participants[0] : null);
    if (!p?.championId) continue;
    out.push({ championId: p.championId, role: roleOfGame(p), win: !!p.stats?.win });
  }
  return out;
}

// Os n mais jogados: na rota, quando ela é conhecida e há jogos suficientes nela; senão, no geral.
export function topChampions(games, role = '', n = 3, minRole = 3) {
  const inRole = role ? games.filter((g) => g.role === role) : [];
  const useRole = inRole.length >= minRole;
  const list = useRole ? inRole : games;
  const by = new Map();
  for (const g of list) {
    const x = by.get(g.championId) || { champion: g.championId, games: 0, wins: 0 };
    x.games++; if (g.win) x.wins++;
    by.set(g.championId, x);
  }
  const top = [...by.values()].sort((a, b) => b.games - a.games || b.wins - a.wins).slice(0, n);
  return { byRole: useRole ? role : '', games: list.length, total: games.length, top };
}
