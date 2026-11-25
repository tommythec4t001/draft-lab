// Transforma a sessão de champ select que o cliente do LoL envia num formato simples para a tela.
// Regra de anonimato da Riot: no champ select, só aparecem o seu nome e os de quem está no seu grupo.
// Os outros viram "Aliado 1", "Aliado 2"… e "Inimigo 1", "Inimigo 2"…

const POS = { top: 'T', jungle: 'J', middle: 'M', mid: 'M', bottom: 'A', utility: 'S', support: 'S' };
const PHASE = {
  PLANNING: 'Declaração de intenção',
  BAN_PICK: 'Banimentos e escolhas',
  FINALIZATION: 'Finalização',
  GAME_STARTING: 'Partida começando',
};

// Posição de cada vez no tabuleiro do draft profissional (mesma ordem de public/app.js).
export const PRO_PICKS = { B: [6, 9, 10, 17, 18], R: [7, 8, 11, 16, 19] };
export const PRO_BANS = { B: [0, 2, 4, 13, 15], R: [1, 3, 5, 12, 14] };

const visibleName = (m) => {
  const name = m.gameName || m.summonerName || '';
  if (!name) return null;
  return m.tagLine ? `${name}#${m.tagLine}` : name;
};

export function normalizeSession(s, now = Date.now(), speed = 1) {
  if (!s || typeof s !== 'object') return null;
  const me = s.localPlayerCellId;
  const myTeam = s.myTeam || [], theirTeam = s.theirTeam || [];
  const all = [...myTeam, ...theirTeam];
  const byCell = new Map(all.map((m) => [m.cellId, m]));
  const sideOf = (cellId) => {
    const m = byCell.get(cellId);
    if (m && (m.team === 1 || m.team === 2)) return m.team === 1 ? 'B' : 'R';
    return cellId < 5 ? 'B' : 'R';
  };
  const mySide = myTeam.length ? sideOf(myTeam[0].cellId) : sideOf(me);
  const enemySide = mySide === 'B' ? 'R' : 'B';

  const actions = (s.actions || []).flat().filter((a) => a && (a.type === 'ban' || a.type === 'pick'));
  const lockedPick = new Map();
  for (const a of actions) if (a.type === 'pick' && a.completed && a.championId > 0) lockedPick.set(a.actorCellId, a.championId);

  // Banimentos em ordem. Sem ação visível (fila ranqueada antes da revelação), usa a lista de bans.
  const bans = { B: [], R: [] };
  for (const a of actions) {
    if (a.type !== 'ban' || !a.completed) continue;
    bans[sideOf(a.actorCellId)].push(a.championId > 0 ? a.championId : 0); // 0 = sem ban
  }
  const fb = s.bans || {};
  if (!bans[mySide].length && fb.myTeamBans?.length) bans[mySide] = fb.myTeamBans.map((c) => (c > 0 ? c : 0));
  if (!bans[enemySide].length && fb.theirTeamBans?.length) bans[enemySide] = fb.theirTeamBans.map((c) => (c > 0 ? c : 0));

  // Picks na ordem em que foram travados (é a ordem que importa para o draft profissional).
  const picks = { B: [], R: [] };
  for (const a of actions) if (a.type === 'pick' && a.completed && a.championId > 0) picks[sideOf(a.actorCellId)].push(a.championId);

  // Na ranqueada, todos banem ao mesmo tempo: a sua ação vem primeiro.
  // Na declaração de intenção o cliente já marca os bans como "em andamento", mas ninguém bane ainda.
  const inProgress = s.timer?.phase === 'PLANNING' ? [] : actions.filter((a) => a.isInProgress && !a.completed);
  const current = inProgress.find((a) => a.actorCellId === me) || inProgress[0] || null;
  const phase = s.timer?.phase || '';
  const swapsDone = phase === 'FINALIZATION' || phase === 'GAME_STARTING';

  const players = { B: [], R: [] };
  for (const [team, ally] of [[myTeam, true], [theirTeam, false]]) {
    team.forEach((m, i) => {
      const side = sideOf(m.cellId);
      const isMe = m.cellId === me;
      // Campeão travado: pela ação concluída; na finalização (depois de trocas) ou do lado inimigo, pelo próprio slot.
      const locked = lockedPick.get(m.cellId) || 0;
      const own = m.championId > 0 ? m.championId : 0;
      const champion = ally ? (swapsDone ? own || locked : locked) : own || locked;
      // Intenção (hover) só existe para aliados: o cliente não mostra a do inimigo.
      let hover = 0;
      if (ally && !champion) {
        if (current && current.type === 'pick' && current.actorCellId === m.cellId && current.championId > 0) hover = current.championId;
        else if (m.championPickIntent > 0) hover = m.championPickIntent;
        else if (m.championId > 0) hover = m.championId;
      }
      const showName = isMe || (ally && m.nameVisibilityType === 'VISIBLE');
      players[side].push({
        cellId: m.cellId,
        side,
        ally,
        isMe,
        role: POS[String(m.assignedPosition || '').toLowerCase()] || '',
        label: isMe ? 'Você' : `${ally ? 'Aliado' : 'Inimigo'} ${i + 1}`,
        name: showName ? visibleName(m) : null,
        champion,
        hover,
      });
    });
  }

  const t = s.timer || {};
  const timer = {
    phase,
    phaseLabel: PHASE[phase] || phase,
    total: (t.totalTimeInPhase || 0) / speed,
    endsAt: t.adjustedTimeLeftInPhase > 0 ? now + t.adjustedTimeLeftInPhase / speed : null,
  };

  return {
    gameId: s.gameId || 0,
    custom: !!s.isCustomGame,
    spectating: !!s.isSpectating,
    mySide,
    bans,
    picks,
    players,
    current: current ? {
      side: sideOf(current.actorCellId),
      type: current.type,
      ally: current.isAllyAction ?? sideOf(current.actorCellId) === mySide,
      cellId: current.actorCellId,
      champion: current.championId > 0 ? current.championId : 0,
    } : null,
    timer,
    done: swapsDone || (actions.length > 0 && actions.every((a) => a.completed)),
    // Há banimentos neste modo (no às cegas e no ARAM não há).
    hasBans: actions.some((a) => a.type === 'ban') || !!(fb.myTeamBans?.length || fb.theirTeamBans?.length),
  };
}

// Preenche as 20 casas do draft profissional (ids numéricos dos campeões, 0 = vazio).
// Bans e picks de cada lado entram na ordem em que aconteceram. Serve para ligar ao tabuleiro principal.
export function toProSteps(d) {
  const steps = new Array(20).fill(0);
  if (!d) return steps;
  for (const side of ['B', 'R']) {
    d.bans[side].slice(0, 5).forEach((c, i) => { steps[PRO_BANS[side][i]] = c || -1; }); // -1 = time não baniu
    d.picks[side].slice(0, 5).forEach((c, i) => { steps[PRO_PICKS[side][i]] = c; });
  }
  return steps;
}

// Tira dados pessoais antes de gravar um draft em disco: nomes, ids de conta e chat.
const PRIVATE = new Set(['gameName', 'tagLine', 'summonerName', 'summonerId', 'puuid', 'obfuscatedPuuid', 'obfuscatedSummonerId', 'internalName', 'playerAlias', 'chatDetails', 'nameVisibilityType']);
export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!PRIVATE.has(k)) out[k] = sanitize(v);
  return out;
}
