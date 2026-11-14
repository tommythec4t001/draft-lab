// Leaderboard, busca de jogadores e detalhes de campeões.
// Leaderboard e busca usam a API oficial da Riot (mesma chave das estatísticas); os detalhes de campeão, o Data Dragon.
// Os pedidos que alguém espera na tela passam na frente da coleta (urgent).
import { join } from 'node:path';
import { CACHE, readJSON, writeJSON, fetchWithTimeout } from './util.js';

const DD = 'https://ddragon.leagueoflegends.com';

// Servidores da Riot: os do leaderboard e todos os da busca (o mundo todo).
export const REGIOES = {
  br1: { nome: 'Brasil', tag: 'BR1' }, na1: { nome: 'América do Norte', tag: 'NA1' },
  la1: { nome: 'América Latina Norte', tag: 'LAN' }, la2: { nome: 'América Latina Sul', tag: 'LAS' },
  euw1: { nome: 'Europa Oeste', tag: 'EUW' }, eun1: { nome: 'Europa Nórdica e Leste', tag: 'EUNE' },
  tr1: { nome: 'Turquia', tag: 'TR1' }, ru: { nome: 'Rússia', tag: 'RU' }, me1: { nome: 'Oriente Médio', tag: 'ME1' },
  kr: { nome: 'Coreia', tag: 'KR1' }, jp1: { nome: 'Japão', tag: 'JP1' },
  oc1: { nome: 'Oceania', tag: 'OCE' }, sg2: { nome: 'Sudeste Asiático', tag: 'SG2' }, tw2: { nome: 'Taiwan', tag: 'TW2' }, vn2: { nome: 'Vietnã', tag: 'VN2' },
};
export const LB_REGIOES = ['br1', 'euw1', 'eun1', 'kr'];
export const FILAS = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex' };
export const TIER_PT = { CHALLENGER: 'Desafiante', GRANDMASTER: 'Grão-Mestre', MASTER: 'Mestre', DIAMOND: 'Diamante', EMERALD: 'Esmeralda', PLATINUM: 'Platina', GOLD: 'Ouro', SILVER: 'Prata', BRONZE: 'Bronze', IRON: 'Ferro' };
const QUEUE_PT = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal', 430: 'Às cegas', 490: 'Partida rápida', 450: 'ARAM', 700: 'Clash', 1700: 'Arena', 1900: 'URF', 900: 'ARURF' };
const POS = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };

// ---------- Nomes das contas (Riot ID), com cache de 7 dias ----------
const CONTAS = join(CACHE, 'contas.json');
const CONTA_TTL = 7 * 24 * 3600 * 1000;
let contas = null, contasP = null;
// Uma leitura só, mesmo com vários pedidos ao mesmo tempo (senão um apagaria os nomes do outro)
function contasCache() { contasP ||= readJSON(CONTAS).then((x) => (contas = x || {})); return contasP; }
let salvando = null;
function salvarContas() { clearTimeout(salvando); salvando = setTimeout(() => writeJSON(CONTAS, contas, true).catch(() => {}), 1500); }

export async function riotIdOf(api, puuid) {
  const c = await contasCache();
  const x = c[puuid];
  if (x && Date.now() - x.at < CONTA_TTL) return x;
  const a = await api.urgent('region', `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`);
  if (!a) return null;
  c[puuid] = { n: a.gameName || '', t: a.tagLine || '', at: Date.now() };
  salvarContas();
  return c[puuid];
}

// ---------- Leaderboard ----------
// Desafiante + Grão-Mestre (e Mestre, se faltar gente), em ordem de PdL. Fica guardado 15 minutos.
const LB_TTL = 15 * 60 * 1000;
const boards = new Map();
export async function leaderboard(api, fila, { pagina = 1, por = 25 } = {}) {
  if (!FILAS[fila]) throw new Error('fila inválida');
  const k = api.platform + '|' + fila;
  let b = boards.get(k);
  if (!b || Date.now() - b.at > LB_TTL) {
    const lista = [];
    for (const [tier, path] of [['CHALLENGER', 'challengerleagues'], ['GRANDMASTER', 'grandmasterleagues'], ['MASTER', 'masterleagues']]) {
      if (tier === 'MASTER' && lista.length >= 200) break;
      const l = await api.urgent('platform', `/lol/league/v4/${path}/by-queue/${fila}`);
      for (const e of l?.entries || []) lista.push({ puuid: e.puuid, tier, lp: e.leaguePoints || 0, w: e.wins || 0, l: e.losses || 0 });
    }
    lista.sort((a, c) => c.lp - a.lp || (c.w - c.l) - (a.w - a.l));
    b = { at: Date.now(), lista };
    boards.set(k, b);
  }
  const total = b.lista.length;
  const paginas = Math.max(1, Math.ceil(total / por));
  const p = Math.min(Math.max(1, pagina | 0), paginas);
  const fatia = b.lista.slice((p - 1) * por, p * por);
  const entradas = await Promise.all(fatia.map(async (e, i) => {
    const id = e.puuid ? await riotIdOf(api, e.puuid).catch(() => null) : null;
    const jogos = e.w + e.l;
    return { pos: (p - 1) * por + i + 1, nome: id?.n || '', tag: id?.t || '', tier: e.tier, elo: TIER_PT[e.tier], lp: e.lp, w: e.w, l: e.l, wr: jogos ? Math.round((e.w / jogos) * 1000) / 10 : 0 };
  }));
  return { regiao: api.platform, fila, total, pagina: p, paginas, atualizado: b.at, entradas };
}

// ---------- Busca de jogadores ----------
// "Nome#TAG" ou só "Nome" (aí tenta a tag padrão do servidor escolhido). Só jogadores: nada de campeões.
export function parseRiotId(q, regiao) {
  const s = String(q || '').trim();
  if (!s) return null;
  const i = s.lastIndexOf('#');
  const nome = (i >= 0 ? s.slice(0, i) : s).trim();
  const tag = (i >= 0 ? s.slice(i + 1) : REGIOES[regiao]?.tag || '').trim();
  if (!nome || !tag || nome.length > 16 || tag.length > 5) return null;
  return { nome, tag, comTag: i >= 0 };
}

// Resumo leve de uma partida para o perfil (qualquer fila).
export function partidaResumo(m, puuid) {
  const info = m?.info;
  const p = info?.participants?.find((x) => x.puuid === puuid);
  if (!p) return null;
  const dur = info.gameDuration || 0;
  return {
    id: m.metadata?.matchId, fila: QUEUE_PT[info.queueId] || 'Outro modo', inicio: info.gameStartTimestamp || info.gameCreation || 0, duracao: dur,
    remake: dur < 300 || !!p.gameEndedInEarlySurrender, vitoria: !!p.win,
    campeao: p.championName, campeaoId: p.championId, rota: POS[p.teamPosition] || '',
    k: p.kills, d: p.deaths, a: p.assists, cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0), nivel: p.champLevel,
    itens: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
  };
}

const perfis = new Map(); // puuid → { at, perfil }
const PERFIL_TTL = 2 * 60 * 1000;
// apiOf(platform) → RiotApi daquele servidor
export async function buscarJogador(apiOf, q, regiao = 'br1', { partidas = 10 } = {}) {
  const id = parseRiotId(q, regiao);
  if (!id) return { erro: 'Digite o Riot ID do jogador, por exemplo Nome#BR1.' };
  let api = apiOf(REGIOES[regiao] ? regiao : 'br1');
  const conta = await api.urgent('region', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(id.nome)}/${encodeURIComponent(id.tag)}`);
  if (!conta) return { erro: id.comTag ? `Não encontrei ${id.nome}#${id.tag}.` : `Não encontrei ${id.nome}#${id.tag}. Se a tag do jogador for outra, digite Nome#TAG.` };
  const hit = perfis.get(conta.puuid);
  if (hit && Date.now() - hit.at < PERFIL_TTL) return hit.perfil;
  // Servidor onde a conta joga LoL (se a Riot não informar, fica o escolhido na busca)
  const ativa = await api.urgent('region', `/riot/account/v1/region/by-game/lol/by-puuid/${encodeURIComponent(conta.puuid)}`).catch(() => null);
  const plat = ativa?.region && REGIOES[ativa.region] ? ativa.region : regiao;
  if (plat !== api.platform) api = apiOf(plat);
  await contasCache();
  contas[conta.puuid] = { n: conta.gameName, t: conta.tagLine, at: Date.now() };
  salvarContas();
  const [sum, ligas, ids] = await Promise.all([
    api.urgent('platform', `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(conta.puuid)}`),
    api.urgent('platform', `/lol/league/v4/entries/by-puuid/${encodeURIComponent(conta.puuid)}`),
    api.urgent('region', `/lol/match/v5/matches/by-puuid/${encodeURIComponent(conta.puuid)}/ids?start=0&count=${partidas}`),
  ]);
  const jogos = (await Promise.all((ids || []).map((mid) => api.urgent('region', `/lol/match/v5/matches/${mid}`).catch(() => null))))
    .map((m) => partidaResumo(m, conta.puuid)).filter(Boolean);
  const elos = (ligas || []).filter((l) => FILAS[l.queueType]).map((l) => ({
    fila: FILAS[l.queueType], tier: l.tier, elo: TIER_PT[l.tier] || l.tier, divisao: ['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(l.tier) ? '' : l.rank,
    lp: l.leaguePoints, w: l.wins, l: l.losses, wr: l.wins + l.losses ? Math.round((l.wins / (l.wins + l.losses)) * 1000) / 10 : 0,
  })).sort((a, b) => (a.fila === 'Solo/Duo' ? -1 : 1) - (b.fila === 'Solo/Duo' ? -1 : 1));
  // Campeões mais jogados nas partidas recentes (sem remakes)
  const porCamp = new Map();
  for (const j of jogos) if (!j.remake) {
    const x = porCamp.get(j.campeao) || { campeao: j.campeao, jogos: 0, vitorias: 0, k: 0, d: 0, a: 0 };
    x.jogos++; if (j.vitoria) x.vitorias++; x.k += j.k; x.d += j.d; x.a += j.a;
    porCamp.set(j.campeao, x);
  }
  const perfil = {
    jogador: { nome: conta.gameName, tag: conta.tagLine, regiao: plat, regiaoNome: REGIOES[plat]?.nome || plat, nivel: sum?.summonerLevel || null, icone: sum?.profileIconId ?? null },
    elos, partidas: jogos,
    campeoes: [...porCamp.values()].sort((a, b) => b.jogos - a.jogos).slice(0, 5),
  };
  perfis.set(conta.puuid, { at: Date.now(), perfil });
  return perfil;
}

// ---------- Detalhes de campeão (Data Dragon) ----------
const det = new Map();
const tira = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
export async function campeaoDetalhe(id, version) {
  if (!/^[A-Za-z0-9]+$/.test(id) || !version) return null;
  const k = id + '@' + version;
  if (det.has(k)) return det.get(k);
  const file = join(CACHE, 'campeoes', `${id}-${version}.json`);
  let d = await readJSON(file);
  if (!d) {
    try {
      const j = await fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/champion/${id}.json`).then((r) => (r.ok ? r.json() : null));
      const c = j?.data?.[id];
      if (!c) return null;
      d = {
        id, nome: c.name, titulo: c.title, historia: tira(c.lore), tags: c.tags || [], info: c.info || null,
        recurso: c.partype || '',
        passiva: { nome: c.passive?.name, desc: tira(c.passive?.description), img: c.passive?.image?.full || '' },
        habilidades: (c.spells || []).map((s, i) => ({ tecla: 'QWER'[i], nome: s.name, desc: tira(s.description), recarga: s.cooldownBurn || '', custo: s.costBurn || '', alcance: s.rangeBurn || '', img: s.image?.full || '' })),
        dicasAliado: (c.allytips || []).map(tira), dicasInimigo: (c.enemytips || []).map(tira),
        atributos: c.stats || null,
      };
      await writeJSON(file, d, true);
    } catch { return null; }
  }
  det.set(k, d);
  return d;
}
export const abilityImageUrl = (kind, file, version) => (kind === 'passiva' ? `${DD}/cdn/${version}/img/passive/${file}` : `${DD}/cdn/${version}/img/spell/${file}`);
