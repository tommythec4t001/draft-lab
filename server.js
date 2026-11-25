// Draft Lab — servidor local
// Acompanha o champ select do seu cliente do LoL e sugere picks e bans com fichas e estatísticas de soloQ.
// Rode com:  npm start   (ou: node server.js)
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, extname, normalize, sep } from 'node:path';
import { exec } from 'node:child_process';
import { ROOT, DATA, CACHE, readJSON, writeJSON, fetchWithTimeout, logError } from './lib/util.js';
import { getChampions, imageUrl } from './lib/champions.js';
import { loadProfiles } from './lib/profiles.js';
import { loadAdc } from './lib/adc.js';
import { loadSup, loadTop, loadMid, loadJg } from './lib/suporte.js';
import { makeResolver } from './lib/names.js';
import { lcu, listRecordings } from './lib/lcu.js';
import { collector, ELOS, ELO_NOME, patchOf } from './lib/soloq.js';
import { RiotApi, KeyError } from './lib/riot-api.js';
import { history, QUEUES } from './lib/history.js';
import { METRICS, GROUPS, percentile, median } from './lib/metrics.js';
import { fatos as fatosCoach } from './lib/coach.js';
import { bansSugeridos, rotaMaisJogada, MIN_JOGOS } from './lib/bans.js';
import { textoCoach, TONS } from './lib/coach-falas.js';
import { getAssets, assetUrl, getItemPrices, getItemData, SHARDS, SHARD_ROWS } from './lib/assets.js';
import { importRunes, importItemSet, importSpells, PaginasCheias } from './lib/importar.js';
import { REGIOES, LB_REGIOES, FILAS, leaderboard, buscarJogador, campeaoDetalhe, abilityImageUrl } from './lib/mundo.js';
import { agenda, partida, imageUrlOf, setEsportsBase } from './lib/esports.js';
import { prioridade, tierOf, setGolggBase } from './lib/meta.js';
import { aplicarFps, restaurar, temBackup } from './lib/lolconfig.js';
import { urlDe, normalizarUrl, linkDeSala, criarSala } from './lib/inhouse.js';

if (process.env.GOLGG_BASE) setGolggBase(process.env.GOLGG_BASE);
if (process.env.ESPORTS_BASE) setEsportsBase(process.env.ESPORTS_BASE + '/persisted/gw', process.env.ESPORTS_BASE + '/livestats/v1');

process.on('uncaughtException', (err) => logError('erro inesperado', err));
process.on('unhandledRejection', (err) => logError('promessa rejeitada', err));

const PUBLIC = join(ROOT, 'public');
const CONFIG = join(DATA, 'config.json');
const START_PORT = Number(process.env.PORT) || 3100;
const PLATFORMS = { br1: 'Brasil', la1: 'LAN', la2: 'LAS', na1: 'América do Norte', euw1: 'Europa Oeste', eun1: 'Europa Nórdica e Leste', kr: 'Coreia' };

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

// ---------- Configuração ----------
const DEFAULT_CFG = { riotKey: '', platform: 'br1', elo: 'EMERALD+', coleta: true, painelOuro: true };
const getConfig = async () => ({ ...DEFAULT_CFG, ...(await readJSON(CONFIG, {})) });
// Coach pós-partida: tom do texto (sério ou divertido).
export const coachCfg = (c) => ({ tom: TONS[c?.coach?.tom] ? c.coach.tom : 'serio' });
const publicConfig = (c) => ({ hasKey: !!c.riotKey, platform: c.platform, elo: c.elo, coleta: c.coleta, painelOuro: c.painelOuro !== false, coach: coachCfg(c), pessoal: !!live, platforms: PLATFORMS, elos: Object.fromEntries(Object.keys(ELOS).map((k) => [k, ELO_NOME[k]])) });

// ---------- Jogador ----------
// Quem é você: vem do cliente do LoL quando ele está aberto, ou do Riot ID digitado na tela.
// A identificação (puuid) que o cliente do LoL usa não é aceita pela API da Riot, e a da API muda conforme a chave.
// Por isso o jogador é guardado pelo Riot ID (Nome#TAG), e o puuid da API é pedido à Riot quando a chave muda.
const ownerOf = (p) => (p ? `${p.gameName}#${p.tagLine}`.toLowerCase() : null);
const keyTag = (key) => createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
async function setPlayer(p) {
  const cfg = await getConfig();
  const same = ownerOf(cfg.player) === ownerOf(p);
  if (same && !p.puuid && cfg.player.profileIconId === p.profileIconId && cfg.player.summonerLevel === p.summonerLevel) return;
  // Mesma conta: mantém o puuid da API já descoberto, a não ser que venha um novo
  cfg.player = { gameName: p.gameName, tagLine: p.tagLine, profileIconId: p.profileIconId, summonerLevel: p.summonerLevel, source: p.source,
    ...(p.puuid ? { puuid: p.puuid, puuidKey: p.puuidKey } : same ? { puuid: cfg.player.puuid, puuidKey: cfg.player.puuidKey } : {}) };
  await writeJSON(CONFIG, cfg);
}
lcu.on('me', (me) => { if (me.gameName && me.tagLine) setPlayer({ gameName: me.gameName, tagLine: me.tagLine, profileIconId: me.profileIconId, summonerLevel: me.summonerLevel, source: 'cliente' }).catch((err) => logError('salvar jogador', err)); });
// puuid da API para a chave atual (pede à Riot pelo Riot ID quando ainda não tem)
async function apiPuuid(cfg, api, force = false) {
  const p = cfg.player;
  if (!force && p.puuid && p.puuidKey === keyTag(cfg.riotKey)) return p.puuid;
  const acc = await api.urgent('region', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(p.gameName)}/${encodeURIComponent(p.tagLine)}`);
  if (!acc?.puuid) throw new Error(`a Riot não encontrou ${p.gameName}#${p.tagLine} neste servidor`);
  const fresh = await getConfig();
  fresh.player = { ...fresh.player, puuid: acc.puuid, puuidKey: keyTag(cfg.riotKey) };
  await writeJSON(CONFIG, fresh);
  return acc.puuid;
}
// Só números inteiros saem daqui: a tela monta endereços de imagem e textos com estes dois campos.
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : undefined);
const playerView = (p) => (p ? { gameName: String(p.gameName ?? ''), tagLine: String(p.tagLine ?? ''), profileIconId: int(p.profileIconId), summonerLevel: int(p.summonerLevel), source: p.source === 'cliente' ? 'cliente' : 'manual' } : null);
const apiFor = (cfg) => new RiotApi({ key: cfg.riotKey, platform: cfg.platform, base: process.env.RIOT_BASE || null }); // RIOT_BASE: só para testes
const friendly = (err) => (err instanceof KeyError ? err.message : 'Não consegui falar com a Riot: ' + err.message);

// Busca partidas novas. Se a Riot recusar o puuid guardado (outra chave), pede outro e tenta mais uma vez.
async function refreshHistory(cfg, count = 30) {
  const api = apiFor(cfg), owner = ownerOf(cfg.player);
  try { return await history.refresh(api, await apiPuuid(cfg, api), owner, count); }
  catch (err) {
    if (!/ 400 /.test(err.message)) throw err;
    return history.refresh(api, await apiPuuid(cfg, api, true), owner, count);
  }
}

// ---------- Histórico automático ----------
// Quando uma partida termina no cliente, o app busca o histórico sozinho. A Riot leva de alguns segundos
// a alguns minutos para publicar a partida, então tenta de novo algumas vezes até ela aparecer.
export const events = new EventEmitter();

// Painel de ouro ao segurar Tab (aplicativo instalado): ligado por padrão; dá para ocultar no Draft Lab ou no ícone.
export const painelOuro = async () => (await getConfig()).painelOuro !== false;
export async function setPainelOuro(on) {
  const cfg = await getConfig();
  cfg.painelOuro = !!on;
  await writeJSON(CONFIG, cfg);
  events.emit('painel', cfg.painelOuro);
  return cfg.painelOuro;
}
events.setMaxListeners(50);
const END = ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'];
let lastFlow = '', autoTimers = [];
async function autoRefresh() {
  const cfg = await getConfig();
  if (!cfg.riotKey || !cfg.player?.gameName) return true; // nada a fazer
  try {
    const added = await refreshHistory(cfg, 10);
    if (added) { events.emit('partidas', { added }); return true; }
  } catch (err) { logError('histórico automático', err); }
  return false;
}
// ---------- Partida em andamento (painel do Tab, recurso pessoal) ----------
// O painel fica na pasta pessoal/, que só existe no computador do Enzo (não vai para o GitHub nem para a
// versão pública). Sem ela, nada da partida em andamento é lido.
const PESSOAL = join(ROOT, 'pessoal');
export const live = existsSync(join(PESSOAL, 'live-game.js'))
  ? new (await import(pathToFileURL(join(PESSOAL, 'live-game.js')).href)).LiveGame({ prices: async () => getItemPrices((await champions()).version) })
  : null;
if (live) {
  // Liga quando o cliente diz que a partida começou; lê o jogo a cada segundo e soma o valor dos itens.
  const LIVE_ALWAYS = process.env.LIVE_ALWAYS === '1'; // testes: lê o jogo mesmo sem o cliente
  if (LIVE_ALWAYS) live.setActive(true);
  lcu.on('update', (s) => { if (!LIVE_ALWAYS) live.setActive(s.flow === 'InProgress'); });
}

lcu.on('update', (s) => {
  const flow = s.flow || '';
  if (flow === lastFlow) return;
  if (END.includes(flow) && !END.includes(lastFlow)) {
    for (const t of autoTimers) clearTimeout(t);
    autoTimers = [];
    let done = false;
    for (const sec of [30, 90, 180, 360]) autoTimers.push(setTimeout(async () => { if (!done) done = await autoRefresh(); }, sec * 1000));
  }
  lastFlow = flow;
});

// Médias das suas partidas comparadas com as partidas do elo coletadas, por rota.
async function performance({ role, queue, n }) {
  const cfg = await getConfig();
  if (!cfg.player?.gameName) return { error: 'player' };
  await soloqData(); // garante que as estatísticas estão carregadas
  const all = (await history.list({ owner: ownerOf(cfg.player), queue, limit: 300 })).filter((m) => !m.remake && m.me.pos);
  const count = {};
  for (const m of all) count[m.me.pos] = (count[m.me.pos] || 0) + 1;
  const rota = role || Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const games = all.filter((m) => m.me.pos === rota).slice(0, n);
  const samples = collector.samples()[rota] || {};
  const metrics = METRICS.map((m) => {
    const vals = games.map((g) => g.me.metrics?.[m.id]).filter((v) => typeof v === 'number');
    const mine = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const s = samples[m.id]?.v || [];
    return { ...m, mine, elo: median(s), pct: percentile(s, mine, m.lower), samples: s.length };
  });
  const groups = GROUPS.map((g) => {
    const ps = metrics.filter((m) => m.group === g.id && m.pct != null).map((m) => m.pct);
    return { ...g, pct: ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null };
  });
  return { role: rota, roles: count, games: games.length, elo: ELO_NOME[cfg.elo], eloSamples: samples.csm?.v?.length || 0, metrics, groups };
}

// ---------- Coach pós-partida ----------
// Baixa a partida e a linha do tempo uma vez, tira os fatos e guarda em data/coach/. O texto sai na hora, no tom pedido.
const COACH_DIR = join(DATA, 'coach');
const erroCoach = (msg) => Object.assign(new Error(msg), { coach: true });
async function coachDe(cfg, id) {
  const arq = join(COACH_DIR, `${id}.json`);
  const owner = ownerOf(cfg.player);
  const salvo = await readJSON(arq);
  if (salvo?.v === 1 && salvo.owner === owner) return salvo;
  if (!cfg.riotKey) throw erroCoach('Cole a sua chave da Riot em Configurações para o coach analisar a partida.');
  const api = apiFor(cfg);
  const puuid = await apiPuuid(cfg, api);
  const [match, timeline] = await Promise.all([
    api.urgent('region', `/lol/match/v5/matches/${id}`),
    api.urgent('region', `/lol/match/v5/matches/${id}/timeline`).catch(() => null),
  ]);
  if (!match?.info) throw erroCoach('A Riot não encontrou essa partida.');
  const eu = match.info.participants?.find((x) => x.puuid === puuid);
  if (!eu) throw erroCoach('Essa partida não é da conta configurada.');
  await soloqData(); // amostras do elo carregadas
  const rota = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' }[eu.teamPosition];
  const f = fatosCoach({ match, timeline, puuid, samples: (rota && collector.samples()[rota]) || {}, nome: await nameOfKey() });
  f.owner = owner;
  await writeJSON(arq, f, true);
  return f;
}

// ---------- Campeões ----------
let champCache = null, lastTry = 0;
async function champions(force = false) {
  const retry = champCache && champCache.source !== 'riot' && Date.now() - lastTry > 60000;
  if (!champCache || force || retry) { lastTry = Date.now(); champCache = await getChampions({ force: force || retry }); }
  return champCache;
}
async function nameOfKey() {
  const c = await champions();
  const map = Object.fromEntries(c.champions.filter((x) => x.key).map((x) => [String(x.key), x.name]));
  return (k) => map[String(k)] || null;
}

// ---------- Build de um campeão ----------
// id: id do Data Dragon (por exemplo "MonkeyKing"). rota: T, J, M, A, S (sem rota: a mais jogada).
async function buildOf(id, rota) {
  const c = await champions();
  const champ = c.champions.find((x) => x.id === id);
  if (!champ) return { erro: 'Campeão não encontrado.' };
  await soloqData(); // garante o livro carregado
  const roles = collector.buildRoles(champ.key);
  const role = ['T', 'J', 'M', 'A', 'S'].includes(rota) ? rota : roles[0]?.role || null;
  const build = role ? collector.build(champ.key, role) : null;
  const [assets, items] = await Promise.all([getAssets(c.version), getItemData(c.version)]);
  // Nomes do que aparece na tela (itens, runas, feitiços), para a dica ao passar o mouse
  const nomes = { itens: {}, runas: {}, feiticos: {} };
  const addItem = (id) => { if (id && items[id]) nomes.itens[id] = { n: items[id].n }; };
  const addRune = (id) => { if (id) nomes.runas[id] = assets.runes?.[id]?.name || SHARDS[id]?.[0] || String(id); };
  const addSpell = (id) => { if (id) nomes.feiticos[id] = assets.spells?.[id]?.name || String(id); };
  let arvore = null;
  if (build) {
    const b = build;
    [...(b.iniciais?.ids || []), b.bota?.id, ...(b.core?.ids || []), ...(b.quarto || []).map((x) => x.id), ...(b.quinto || []).map((x) => x.id), ...(b.itens || []).map((x) => x.id)].forEach(addItem);
    (b.feiticos?.ids || []).forEach(addSpell);
    for (const g of b.historico) { g.items.forEach(addItem); g.spells.forEach(addSpell); g.runes.forEach(addRune); }
    for (const [slot, rows] of Object.entries(b.wpa || {})) for (const x of rows) (slot === 'key' ? addRune : slot === 'spell' ? addSpell : addItem)(x.id);
    for (const map of Object.values(b.explorador?.itens || {})) Object.keys(map).forEach(addItem);
    for (const t of assets.tree || []) { addRune(t.id); t.slots.flat().forEach(addRune); }
    if (b.runas) {
      const tree = assets.tree || [];
      const pri = tree.find((t) => t.id === b.runas.pri), sub = tree.find((t) => t.id === b.runas.sub);
      arvore = { pri: pri || null, sub: sub || null, shards: SHARD_ROWS };
      for (const t of [pri, sub]) if (t) { addRune(t.id); t.slots.flat().forEach(addRune); }
      SHARD_ROWS.flat().forEach(addRune);
    }
  }
  const view = soloqView;
  return {
    campeao: { id: champ.id, key: champ.key, name: champ.name },
    rotas: roles, rota: role, build, arvore, arvores: build?.explorador ? assets.tree || [] : [], nomes,
    coleta: { rodando: collector.running, elo: collector.cfg?.elo || null, eloNome: ELO_NOME[collector.cfg?.elo] || '', partidas: collector.builds?.matches || 0, comLinha: collector.builds?.timelines || 0, patch: view?.patch || null },
  };
}

// ---------- Coleta de soloQ ----------
async function startCollector() {
  const cfg = await getConfig();
  const { version } = await champions();
  if (!version) { collector.error = 'Sem conexão com a Riot: a coleta começa quando a internet voltar.'; collector.changed(); return; }
  await collector.start({ key: cfg.riotKey, platform: cfg.platform, elo: cfg.elo, patch: patchOf(version), items: await getItemData(version) });
}
let soloqView = null, soloqViewAt = 0;
async function soloqData() {
  // Montar a tabela custa um pouco: no máximo uma vez a cada 15 segundos.
  if (!soloqView || Date.now() - soloqViewAt > 15000) {
    if (!collector.book) {
      const cfg = await getConfig();
      const { version } = await champions();
      if (version) await collector.load({ key: cfg.riotKey, platform: cfg.platform, elo: cfg.elo, patch: patchOf(version), items: await getItemData(version) });
    }
    soloqView = collector.data(await nameOfKey());
    soloqViewAt = Date.now();
  }
  return soloqView;
}

// ---------- Segurança ----------
// O servidor só escuta em 127.0.0.1, então nada de fora da sua máquina chega nele direto. Mas qualquer site
// aberto no seu navegador consegue mandar pedidos para um endereço local, e é por aí que alguém tentaria
// ler o seu Riot ID, o seu histórico e o champ select. Três barreiras fecham esse caminho:
//
// 1. Host: só atende quando o endereço pedido é este computador, na porta do app. Barra o "DNS rebinding",
//    em que um site aponta o próprio domínio para 127.0.0.1 e passa a ler as respostas como se fosse o app.
// 2. Origem: pedidos que partem de outra página (outro site, ou outro programa web em outra porta) são
//    recusados. Só passa a própria tela do Draft Lab, ou um pedido sem navegador (testes, linha de comando).
// 3. Cabeçalhos em toda resposta: a página só roda os scripts do próprio app (nada embutido nem de fora),
//    não pode ser colocada dentro de outra página e as respostas não podem ser lidas por outros sites.
// 4. Chave de sessão: os dados (/api) só saem para quem manda a chave sorteada quando o app ligou. Ela vai
//    para a tela no endereço que o próprio app abre (depois do #, que nunca é enviado pela rede) e não fica
//    em arquivo nenhum. Outro programa ou outra conta do Windows neste computador, sem a chave, recebe 401.
//    Os arquivos da tela e as imagens dos campeões não levam chave: são públicos, não têm dado seu.
export const accessKey = randomBytes(32).toString('hex');
const digest = (s) => createHash('sha256').update(String(s ?? '')).digest();
const KEY_DIGEST = digest(accessKey);
const hasKey = (given) => timingSafeEqual(digest(given), KEY_DIGEST);
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy': '',
};
// A aba InHouse mostra a sala do servidor InHouse num quadro: só esse endereço pode aparecer em quadros.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
function permitirQuadro(origem) { SECURITY['Content-Security-Policy'] = origem ? `${CSP}; frame-src ${origem}` : CSP; }
permitirQuadro(normalizarUrl(process.env.INHOUSE_URL) || null);
getConfig().then((c) => permitirQuadro(urlDe(c) || null)).catch(() => {});
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/;
const MAX_STREAMS = 40; // telas abertas ao mesmo tempo no canal ao vivo
let streams = 0;

// Devolve o motivo da recusa, ou null quando o pedido pode seguir.
function refusal(req, pathname) {
  const host = String(req.headers.host || '').toLowerCase();
  const h = host.match(LOCAL_HOST);
  if (!h || Number(h[2] || 80) !== server.address()?.port) return 'endereço';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return 'origem';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    // Vindo de outro site, só vale abrir a tela (um link ou favorito). Dados e imagens, nunca.
    const opening = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'
      && !pathname.startsWith('/api/') && !pathname.startsWith('/img/');
    if (!opening) return 'origem';
  }
  return null;
}

// ---------- Utilidades HTTP ----------
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const fail = (res, status, message) => send(res, status, { error: message });
async function body(req, limit = 1e6) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Conteúdo grande demais.'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  let json;
  try { json = JSON.parse(raw); } catch { throw new HttpError(400, 'Conteúdo inválido.'); }
  return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
}

// O que a tela recebe da partida em andamento: sem o nome nem o Riot ID dos dez jogadores.
// O painel só usa campeão, ouro e placar, então os nomes dos outros jogadores não saem do servidor.
const livePlayer = (p) => { if (!p) return p; const { name, riotId, ...rest } = p; return rest; };
const liveView = (s) => (s?.lanes ? { ...s, lanes: s.lanes.map((x) => ({ ...x, mine: livePlayer(x.mine), theirs: livePlayer(x.theirs) })) } : s);

async function serveImage(res, kind, id) {
  if (!/^[A-Za-z0-9]+$/.test(id)) return fail(res, 400, 'id inválido');
  const ext = kind === 'icon' ? '.png' : '.jpg';
  const file = join(CACHE, 'img', kind, id + ext);
  try { return send(res, 200, await readFile(file), TYPES[ext], { 'Cache-Control': 'public, max-age=604800' }); } catch { /* ainda não baixada */ }
  const { version } = await champions();
  if (!version) return fail(res, 404, 'sem conexão com a Riot');
  const url = kind === 'icon' ? imageUrl.icon(version, id) : imageUrl[kind](id);
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) { const plano = { tile: 'icon', centered: 'splash', loading: 'tile' }[kind]; return plano ? serveImage(res, plano, id) : fail(res, 404, 'imagem não encontrada'); }
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(join(CACHE, 'img', kind), { recursive: true });
    await writeFile(file, buf);
    send(res, 200, buf, TYPES[ext], { 'Cache-Control': 'public, max-age=604800' });
  } catch { fail(res, 502, 'falha ao baixar imagem'); }
}

async function serveAsset(res, kind, id) {
  const file = join(CACHE, 'img', kind, id + '.png');
  try { return send(res, 200, await readFile(file), TYPES['.png'], { 'Cache-Control': 'public, max-age=604800' }); } catch { /* ainda não baixada */ }
  const { version } = await champions();
  const url = version && (await assetUrl(kind, id, version));
  if (!url) return fail(res, 404, 'imagem não encontrada');
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return fail(res, 404, 'imagem não encontrada');
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(join(CACHE, 'img', kind), { recursive: true });
    await writeFile(file, buf);
    send(res, 200, buf, TYPES['.png'], { 'Cache-Control': 'public, max-age=604800' });
  } catch { fail(res, 502, 'falha ao baixar imagem'); }
}

// Logos dos times e das ligas (lolesports), com cache local. Só códigos que o próprio servidor criou.
const LOGO_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/svg+xml': '.svg', 'image/webp': '.webp' };
async function serveLogo(res, code) {
  const dir = join(CACHE, 'img', 'time');
  for (const ext of Object.values(LOGO_EXT)) {
    try { return send(res, 200, await readFile(join(dir, code + ext)), TYPES[ext], { 'Cache-Control': 'public, max-age=604800' }); } catch { /* tenta o próximo */ }
  }
  const url = imageUrlOf(code);
  if (!url) return fail(res, 404, 'imagem não encontrada');
  try {
    const r = await fetchWithTimeout(url, {}, 12000);
    const ext = LOGO_EXT[String(r.headers.get('content-type') || '').split(';')[0].trim()];
    if (!r.ok || !ext) return fail(res, 404, 'imagem não encontrada');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 * 1024 * 1024) return fail(res, 404, 'imagem grande demais');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, code + ext), buf);
    send(res, 200, buf, TYPES[ext], { 'Cache-Control': 'public, max-age=604800' });
  } catch { fail(res, 502, 'falha ao baixar imagem'); }
}

// Ícones de habilidades e passivas (Data Dragon), com cache local
async function serveAbility(res, kind, file) {
  const local = join(CACHE, 'img', kind, file);
  try { return send(res, 200, await readFile(local), TYPES['.png'], { 'Cache-Control': 'public, max-age=604800' }); } catch { /* ainda não baixada */ }
  const { version } = await champions();
  if (!version) return fail(res, 404, 'sem conexão com a Riot');
  try {
    const r = await fetchWithTimeout(abilityImageUrl(kind, file, version));
    if (!r.ok) return fail(res, 404, 'imagem não encontrada');
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(join(CACHE, 'img', kind), { recursive: true });
    await writeFile(local, buf);
    send(res, 200, buf, TYPES['.png'], { 'Cache-Control': 'public, max-age=604800' });
  } catch { fail(res, 502, 'falha ao baixar imagem'); }
}

async function serveStatic(res, pathname) {
  // Recursos pessoais (painel do Tab): só com a pasta pessoal/. Sem ela, /pessoal.js vem vazio.
  if (pathname === '/pessoal.js') {
    let js = '';
    if (live) { try { js = await readFile(join(PESSOAL, 'config-ui.js')); } catch { /* sem configuração */ } }
    return send(res, 200, js, TYPES['.js'], { 'Cache-Control': 'no-cache' });
  }
  if (live && (pathname === '/painel.html' || pathname === '/painel.js')) {
    try { return send(res, 200, await readFile(join(PESSOAL, pathname.slice(1))), TYPES[extname(pathname)], { 'Cache-Control': 'no-cache' }); }
    catch { return fail(res, 404, 'não encontrado'); }
  }
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[\/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return fail(res, 403, 'proibido'); // nada fora da pasta public
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    send(res, 200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch { fail(res, 404, 'não encontrado'); }
}

// ---------- Rotas ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname, m = req.method;

  // Segurança: recusa o que não vem da própria tela do app (veja "Segurança" acima).
  const why = refusal(req, p);
  if (why) return fail(res, 403, `Pedido recusado (${why}): o Draft Lab só atende a própria tela, neste computador.`);
  // Quem altera algo precisa mandar JSON: outro site não consegue enviar esse tipo de conteúdo às escondidas.
  if (m !== 'GET' && m !== 'HEAD' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return fail(res, 415, 'Conteúdo inválido.');
  // Dados só com a chave de sessão. O canal ao vivo manda a chave no endereço, porque o navegador não deixa pôr cabeçalho nele.
  if (p.startsWith('/api/') && !hasKey(req.headers['x-draft-lab-key'] || (p === '/api/stream' ? url.searchParams.get('chave') : ''))) {
    return fail(res, 401, 'Esta tela não foi aberta pelo Draft Lab. Feche e abra de novo pelo Iniciar.bat ou pelo aplicativo.');
  }

  // Canal ao vivo: champ select (evento "lcu") e coleta de estatísticas (evento "soloq").
  if (p === '/api/stream' && m === 'GET') {
    if (streams >= MAX_STREAMS) return fail(res, 503, 'Muitas telas abertas ao mesmo tempo.');
    streams++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', ...SECURITY });
    const pushLcu = (s) => res.write(`event: lcu\ndata: ${JSON.stringify(s)}\n\n`);
    const pushSolo = (s) => res.write(`event: soloq\ndata: ${JSON.stringify(s)}\n\n`);
    const pushHist = (x) => res.write(`event: partidas\ndata: ${JSON.stringify(x)}\n\n`);
    const pushLive = (x) => res.write(`event: aovivo\ndata: ${JSON.stringify(liveView(x))}\n\n`);
    pushLcu(lcu.snapshot()); pushSolo(collector.status()); if (live) pushLive(live.snapshot());
    lcu.on('update', pushLcu); collector.on('update', pushSolo); events.on('partidas', pushHist); live?.on('update', pushLive);
    const keep = setInterval(() => res.write(': ok\n\n'), 20000);
    req.on('close', () => { streams--; clearInterval(keep); lcu.off('update', pushLcu); collector.off('update', pushSolo); events.off('partidas', pushHist); live?.off('update', pushLive); });
    return;
  }

  if (p === '/api/ao-vivo' && m === 'GET') return live ? send(res, 200, liveView(live.snapshot())) : fail(res, 404, 'não encontrado');

  if (p === '/api/champions' && m === 'GET') {
    const c = await champions();
    const profiles = await loadProfiles(c.champions);
    const resolve = makeResolver(c.champions);
    const roles = {};
    for (const [k, v] of Object.entries(await readJSON(join(DATA, 'roles.json'), {}))) { const n = !k.startsWith('_') && resolve(k); if (n) roles[n] = v; }
    // Counterpicks de ADC: classe de cada ADC; os Mage Bots também valem como opção de ADC.
    // Suporte: classe de cada suporte; todos valem como opção de suporte.
    const { classOf, ...adc } = await loadAdc(c.champions);
    const { classOf: supOf, ...sup } = await loadSup(c.champions);
    const { classOf: topOf, ...top } = await loadTop(c.champions);
    const { classOf: midOf, ...mid } = await loadMid(c.champions);
    const { classOf: jgOf, ...jg } = await loadJg(c.champions);
    const rolesOf = (x) => {
      let r = roles[x.name] || x.roles || '';
      if (classOf[x.name] && !r.includes('A')) r += 'A';
      if (supOf[x.name] && !r.includes('S')) r += 'S';
      if (topOf[x.name] && !r.includes('T')) r += 'T';
      if (midOf[x.name] && !r.includes('M')) r += 'M';
      if (jgOf[x.name] && !r.includes('J')) r += 'J';
      return r;
    };
    return send(res, 200, {
      version: c.version, source: c.source, adc, sup, top, mid, jg,
      champions: c.champions.map((x) => ({ ...x, roles: rolesOf(x), adc: classOf[x.name] || null, sup: supOf[x.name] || null, top: topOf[x.name] || null, mid: midOf[x.name] || null, jg: jgOf[x.name] || null, icon: `/img/icon/${x.id}`, tile: `/img/tile/${x.id}`, profile: profiles[x.name] || null })),
    });
  }
  const img = p.match(/^\/img\/(icon|splash|tile|centered|loading)\/([A-Za-z0-9]+)$/);
  if (img && m === 'GET') return serveImage(res, img[1], img[2]);
  const asset = p.match(/^\/img\/(item|spell|rune|profile)\/(\d+)$/);
  if (asset && m === 'GET') return serveAsset(res, asset[1], asset[2]);
  const hab = p.match(/^\/img\/(habilidade|passiva)\/([A-Za-z0-9_.-]+\.png)$/);
  if (hab && m === 'GET') return serveAbility(res, hab[1], hab[2]);

  const logo = p.match(/^\/img\/time\/([0-9a-f]{20})$/);
  if (logo && m === 'GET') return serveLogo(res, logo[1]);

  // --- Partidas profissionais (Fearless ao vivo) ---
  if (p === '/api/pro/agenda' && m === 'GET') {
    try { return send(res, 200, await agenda({ fresh: url.searchParams.get('atualizar') === '1' })); }
    catch (err) { return fail(res, 502, 'Não consegui falar com a API do lolesports: ' + err.message); }
  }
  if (p === '/api/pro/prioridade' && m === 'GET') {
    try {
      const c = await champions();
      const r = await prioridade(c.champions, { fresh: url.searchParams.get('atualizar') === '1' });
      const campeoes = {};
      for (const [n, x] of Object.entries(r.champions)) campeoes[n] = { pr: x.pr, wr: x.wr, tier: tierOf(x.pr) };
      return send(res, 200, { temporada: r.temporada, atualizado: r.atualizado, jogos: r.jogos, antigo: !!r.antigo, campeoes });
    } catch (err) { return fail(res, 502, err.message); }
  }
  const pro = p.match(/^\/api\/pro\/partida\/(\d{1,25})$/);
  if (pro && m === 'GET') {
    try { return send(res, 200, await partida(pro[1])); }
    catch (err) { return fail(res, 502, /inválido|não encontrada/.test(err.message) ? err.message : 'Não consegui falar com a API do lolesports: ' + err.message); }
  }

  // --- InHouse (salas de draft para partidas personalizadas) ---
  if (p === '/api/inhouse' && m === 'GET') return send(res, 200, { url: urlDe(await getConfig()) });
  if (p === '/api/inhouse' && m === 'PUT') {
    const b = await body(req);
    const u = normalizarUrl(b.url);
    if (u === null) return fail(res, 400, 'Use o endereço do servidor que começa com https://, sem nada depois do domínio.');
    const cfg = await getConfig();
    cfg.inhouse = u;
    await writeJSON(CONFIG, cfg);
    permitirQuadro(urlDe(cfg) || null);
    return send(res, 200, { url: urlDe(cfg) });
  }
  if (p === '/api/inhouse/criar' && m === 'POST') {
    try { return send(res, 201, await criarSala(urlDe(await getConfig()), await body(req))); }
    catch (err) { return fail(res, 502, err.message); }
  }
  if (p === '/api/inhouse/abrir' && m === 'POST') {
    const base = urlDe(await getConfig());
    const link = linkDeSala(base, (await body(req)).link);
    if (!link) return fail(res, 400, base ? `Cole um link de sala do servidor ${base}.` : 'Configure o endereço do servidor InHouse primeiro.');
    return send(res, 200, { link });
  }

  // --- Configs LoL ---
  if (p === '/api/lolconfig' && m === 'GET') {
    return send(res, 200, { cliente: lcu.status === 'conectado', emPartida: lcu.flow === 'InProgress', backup: await temBackup(), windows: process.platform === 'win32' });
  }
  if ((p === '/api/lolconfig/fps' || p === '/api/lolconfig/restaurar') && m === 'POST') {
    try { return send(res, 200, await (p.endsWith('fps') ? aplicarFps(lcu) : restaurar(lcu))); }
    catch (err) { logError(p, err); return fail(res, 400, err.message); }
  }

  // --- Campeões, leaderboard e busca de jogadores ---
  // --- Build, confrontos e partidas de alto elo de um campeão ---
  const bld = p.match(/^\/api\/build\/([A-Za-z0-9]+)$/);
  if (bld && m === 'GET') {
    const r = await buildOf(bld[1], url.searchParams.get('rota'));
    return r.erro ? fail(res, 404, r.erro) : send(res, 200, r);
  }
  if (p === '/api/build/importar' && m === 'POST') {
    const b = await body(req);
    const r = await buildOf(String(b.campeao || ''), b.rota);
    if (r.erro) return fail(res, 404, r.erro);
    if (lcu.status !== 'conectado') return fail(res, 400, 'Abra o cliente do LoL para importar.');
    const passos = [];
    const champ = r.campeao;
    const itemName = (id) => r.nomes.itens[id]?.n || id;
    const step = async (nome, fn) => {
      try { const d = await fn(); if (d) passos.push({ nome, ok: true, detalhe: d }); }
      catch (err) { passos.push({ nome, ok: false, detalhe: err.message, ...(err instanceof PaginasCheias ? { paginas: err.paginas } : {}) }); }
    };
    const apagar = b.apagarPagina != null && /^\d{1,15}$/.test(String(b.apagarPagina)) ? String(b.apagarPagina) : null;
    if (b.runas !== false) await step('Runas', () => (r.build.runas ? importRunes(lcu, champ.name, r.rota, r.build.runas, { apagar }) : Promise.reject(new Error('Ainda não há runas deste campeão na coleta.'))));
    if (b.itens !== false) await step('Itens', () => importItemSet(lcu, champ, r.rota, r.build, itemName));
    if (b.feiticos !== false && r.build.feiticos) await step('Feitiços', () => importSpells(lcu, r.build.feiticos.ids));
    return send(res, 200, { passos });
  }

  const camp = p.match(/^\/api\/campeao\/([A-Za-z0-9]+)$/);
  if (camp && m === 'GET') {
    const d = await campeaoDetalhe(camp[1], (await champions()).version);
    return d ? send(res, 200, d) : fail(res, 404, 'Não consegui carregar os detalhes deste campeão (sem conexão com a Riot?).');
  }
  if (p === '/api/mundo' && m === 'GET') {
    return send(res, 200, { regioes: Object.fromEntries(Object.entries(REGIOES).map(([k, v]) => [k, v.nome])), leaderboard: LB_REGIOES, filas: FILAS, padrao: (await getConfig()).platform });
  }
  if ((p === '/api/leaderboard' || p === '/api/busca') && m === 'GET') {
    const cfg = await getConfig();
    if (!cfg.riotKey) return fail(res, 400, 'Para usar o leaderboard e a busca, cole a chave da Riot em Configurações.');
    const apiOf = (platform) => new RiotApi({ key: cfg.riotKey, platform, base: process.env.RIOT_BASE || null });
    const q = url.searchParams;
    try {
      if (p === '/api/leaderboard') {
        const regiao = LB_REGIOES.includes(q.get('regiao')) ? q.get('regiao') : 'br1';
        const fila = FILAS[q.get('fila')] ? q.get('fila') : 'RANKED_SOLO_5x5';
        const pagina = Math.min(Math.max(Math.trunc(Number(q.get('pagina'))) || 1, 1), 1000);
        return send(res, 200, await leaderboard(apiOf(regiao), fila, { pagina }));
      }
      if (String(q.get('q') || '').length > 40) return fail(res, 400, 'Digite o Riot ID do jogador, por exemplo Nome#BR1.');
      const r = await buscarJogador(apiOf, q.get('q'), REGIOES[q.get('regiao')] ? q.get('regiao') : cfg.platform);
      return r.erro ? fail(res, 404, r.erro) : send(res, 200, r);
    } catch (err) {
      if (!(err instanceof KeyError)) logError(p, err);
      return fail(res, err instanceof KeyError ? 401 : 502, err instanceof KeyError ? err.message : 'Não consegui falar com a Riot: ' + err.message);
    }
  }

  // --- Você: jogador, histórico e desempenho ---
  if (p === '/api/jogador' && m === 'GET') return send(res, 200, { player: playerView((await getConfig()).player) });
  if (p === '/api/jogador' && m === 'PUT') {
    const cfg = await getConfig();
    const [name, tag] = String((await body(req)).riotId || '').split('#').map((x) => x.trim());
    if (!name || !tag || name.length > 40 || tag.length > 10) return fail(res, 400, 'Escreva o Riot ID com a tag, por exemplo Nome#BR1.');
    if (!cfg.riotKey) return fail(res, 400, 'Cole a sua chave da Riot em Configurações antes.');
    try {
      const api = apiFor(cfg);
      const acc = await api.urgent('region', `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
      if (!acc?.puuid) return fail(res, 404, `Não encontrei ${name}#${tag}. Confira o nome, a tag e o servidor em Configurações.`);
      const sum = await api.urgent('platform', `/lol/summoner/v4/summoners/by-puuid/${acc.puuid}`);
      await setPlayer({ puuid: acc.puuid, puuidKey: keyTag(cfg.riotKey), gameName: acc.gameName, tagLine: acc.tagLine, profileIconId: sum?.profileIconId, summonerLevel: sum?.summonerLevel, source: 'manual' });
      return send(res, 200, { player: playerView((await getConfig()).player) });
    } catch (err) { return fail(res, 502, friendly(err)); }
  }
  if (p === '/api/partidas' && m === 'GET') {
    const cfg = await getConfig();
    const queue = url.searchParams.get('fila') || null;
    const out = { player: playerView(cfg.player), queues: QUEUES, matches: [], error: null };
    if (!cfg.player?.gameName) { out.error = 'player'; return send(res, 200, out); }
    if (url.searchParams.get('atualizar') && cfg.riotKey) {
      try { await refreshHistory(cfg, 30); } catch (err) { out.error = friendly(err); }
    } else if (url.searchParams.get('atualizar')) out.error = 'Cole a sua chave da Riot em Configurações para buscar partidas novas.';
    out.matches = await history.list({ owner: ownerOf(cfg.player), queue, limit: 50 });
    const { version } = await champions();
    const a = await getAssets(version);
    out.names = { spells: Object.fromEntries(Object.entries(a.spells).map(([k, v]) => [k, v.name])), runes: Object.fromEntries(Object.entries(a.runes).map(([k, v]) => [k, v.name])) };
    return send(res, 200, out);
  }
  // --- Bans pela sua conta (draft ao vivo) ---
  if (p === '/api/bans' && m === 'GET') {
    const cfg = await getConfig();
    if (!cfg.player?.gameName) return send(res, 200, { erro: 'player', lista: [] });
    const all = (await history.list({ owner: ownerOf(cfg.player), limit: 300 })).filter((x) => !x.remake);
    const pedida = url.searchParams.get('rota');
    const rota = /^[TJMAS]$/.test(pedida || '') ? pedida : rotaMaisJogada(all);
    const roles = Object.fromEntries((await champions()).champions.filter((c) => c.key).map((c) => [String(c.key), c.roles || '']));
    const lista = bansSugeridos(all, { rota, rolesOf: (id) => roles[String(id)] });
    return send(res, 200, { rota, rotaDoCliente: rota === pedida, partidas: all.length, min: MIN_JOGOS, lista });
  }
  // --- Coach pós-partida ---
  const mc = p.match(/^\/api\/coach\/([A-Z0-9]{2,5}_\d{3,15})$/);
  if (mc && m === 'GET') {
    const cfg = await getConfig();
    if (!cfg.player?.gameName) return fail(res, 400, 'Configure o seu Riot ID primeiro.');
    const tom = TONS[url.searchParams.get('tom')] ? url.searchParams.get('tom') : coachCfg(cfg).tom;
    try {
      const f = await coachDe(cfg, mc[1]);
      return send(res, 200, { fatos: f, texto: textoCoach(f, tom) });
    } catch (err) {
      if (err.coach || err instanceof KeyError) return fail(res, err instanceof KeyError ? 401 : 400, err.message);
      logError(p, err);
      return fail(res, 502, friendly(err));
    }
  }
  if (p === '/api/desempenho' && m === 'GET') {
    const n = Math.min(100, Math.max(5, Number(url.searchParams.get('n')) || 20));
    const rota = url.searchParams.get('rota');
    return send(res, 200, await performance({ role: ['T', 'J', 'M', 'A', 'S'].includes(rota) ? rota : null, queue: url.searchParams.get('fila') || null, n }));
  }

  // --- Configuração (a chave nunca volta para a tela, só se existe) ---
  if (p === '/api/config' && m === 'GET') return send(res, 200, publicConfig(await getConfig()));
  if (p === '/api/config' && m === 'PUT') {
    const b = await body(req), cfg = await getConfig(), before = { ...cfg };
    if (typeof b.key === 'string') {
      const key = b.key.trim();
      // A chave vai num cabeçalho dos pedidos à Riot: só letras, números e sinais comuns, sem espaços nem quebras de linha.
      if (key && !/^[\x21-\x7e]{1,200}$/.test(key)) return fail(res, 400, 'Isso não parece uma chave da Riot. Copie de novo em developer.riotgames.com.');
      cfg.riotKey = key;
    }
    if (b.platform && PLATFORMS[b.platform]) cfg.platform = b.platform;
    if (b.elo && ELOS[b.elo]) cfg.elo = b.elo;
    if (typeof b.coleta === 'boolean') cfg.coleta = b.coleta;
    if (typeof b.painelOuro === 'boolean' && b.painelOuro !== (cfg.painelOuro !== false)) { cfg.painelOuro = b.painelOuro; events.emit('painel', b.painelOuro); }
    if (b.coach && typeof b.coach === 'object') {
      const c = { ...coachCfg(cfg) };
      if (TONS[b.coach.tom]) c.tom = b.coach.tom;
      cfg.coach = c;
    }
    await writeJSON(CONFIG, cfg);
    const changed = ['riotKey', 'platform', 'elo'].some((k) => cfg[k] !== before[k]);
    if (cfg.coleta && cfg.riotKey && (changed || !collector.running)) { soloqView = null; startCollector().catch((err) => logError('iniciar coleta', err)); }
    if (!cfg.coleta && collector.running) await collector.stop();
    if (changed && !cfg.coleta) { soloqView = null; collector.book = null; }
    return send(res, 200, publicConfig(cfg));
  }

  // --- Estatísticas de soloQ ---
  if (p === '/api/soloq' && m === 'GET') return send(res, 200, (await soloqData()) || {});
  if (p === '/api/soloq/estado' && m === 'GET') return send(res, 200, collector.status());

  // --- Cliente do LoL ---
  if (p === '/api/lcu/gravacoes' && m === 'GET') return send(res, 200, await listRecordings());
  if (p === '/api/lcu/replay' && m === 'POST') {
    const b = await body(req);
    try { await lcu.startReplay(b.arquivo, b.velocidade); return send(res, 200, lcu.snapshot()); } catch (err) { return fail(res, 400, err.message); }
  }
  if (p === '/api/lcu/replay/parar' && m === 'POST') { lcu.stopReplay(); return send(res, 200, lcu.snapshot()); }
  if (p === '/api/lcu/gravar' && m === 'POST') { lcu.setRecord((await body(req)).ligado); return send(res, 200, lcu.snapshot()); }

  if (m === 'GET') return serveStatic(res, p);
  fail(res, 404, 'rota não encontrada');
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err instanceof HttpError) { if (!res.headersSent) fail(res, err.status, err.message); return; }
    logError(`${req.method} ${String(req.url).split('?')[0]}`, err); // sem a parte depois do ?, que pode levar a chave de sessão
    if (!res.headersSent) fail(res, 500, 'Erro interno: ' + err.message);
  });
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// Liga o servidor e devolve a porta. O app instalado (electron/main.js) chama isto; o Iniciar.bat roda o arquivo direto.
export function start({ quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < START_PORT + 10) { if (!quiet) console.log(`Porta ${port} ocupada, tentando ${port + 1}…`); tryPort(port + 1); }
        else reject(err);
      });
      server.listen(port, '127.0.0.1', async () => {
        resolve(port);
        if (!process.env.NO_LCU) lcu.start();
        try {
          await champions();
          const cfg = await getConfig();
          if (cfg.coleta && cfg.riotKey && !process.env.NO_COLETA) await startCollector();
        } catch (err) { logError('início', err); }
      });
    };
    tryPort(START_PORT);
  });
}

// Rodando direto (node server.js / Iniciar.bat): liga e abre o navegador
if (!process.env.DRAFTLAB_EMBEDDED) {
  start().then((port) => {
    // O endereço leva a chave de sessão depois do #: é ela que libera os dados para esta tela.
    const url = `http://localhost:${port}/#chave=${accessKey}`;
    console.log(`\n  Draft Lab rodando em ${url}\n  (o endereço muda cada vez que o app liga; para abrir em outro navegador, copie o endereço inteiro)\n  Para parar: Ctrl + C\n`);
    if (!process.env.NO_OPEN) openBrowser(url);
  }).catch((err) => { console.error(err); process.exit(1); });
}
