// Estatísticas de soloQ calculadas pelo próprio app, com partidas ranqueadas da API oficial da Riot.
//
// Como funciona:
// 1. Pega jogadores do elo escolhido nas tabelas de ranqueada (league-v4).
// 2. Para cada jogador, lista as ranqueadas solo/duo recentes (match-v5) e baixa as que ainda não viu.
// 3. Só conta partidas do patch atual. De cada partida tira: pick, ban e vitória por campeão e rota,
//    quem enfrentou quem na mesma rota (matchups) e quem jogou junto (duplas).
// Tudo fica em data/soloq, e a coleta continua de onde parou quando o app abre de novo.
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA, readJSON, writeJSON, logError } from './util.js';
import { RiotApi, KeyError } from './riot-api.js';
import { metricsOf, addSamples, mergeSamples } from './metrics.js';
import { emptyBuilds, loadBuilds, saveBuilds, buildsFile, addBuildMatch, buildView, rolesOfChamp } from './builds.js';

const DIR = join(DATA, 'soloq');
const QUEUE = 420; // ranqueada solo/duo
const POS = { TOP: 'T', JUNGLE: 'J', MIDDLE: 'M', BOTTOM: 'A', UTILITY: 'S' };
export const ELOS = {
  'PLATINUM+': ['PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER'],
  'EMERALD+': ['EMERALD', 'DIAMOND', 'MASTER'],
  'DIAMOND+': ['DIAMOND', 'MASTER'],
  'MASTER+': ['MASTER'],
};
export const ELO_NOME = { 'PLATINUM+': 'Platina+', 'EMERALD+': 'Esmeralda+', 'DIAMOND+': 'Diamante+', 'MASTER+': 'Mestre+' };
const DIVS = ['I', 'II', 'III', 'IV'];
const LOOKBACK_DAYS = 14;
const SEED_EVERY = 6 * 60 * 60 * 1000;

// "16.22.1" -> "16.22"; "16.22.734.1234" -> "16.22"
export const patchOf = (v) => String(v || '').split('.').slice(0, 2).join('.');
export const newer = (a, b) => { const [x, y] = a.split('.').map(Number), [u, v] = b.split('.').map(Number); return x > u || (x === u && y > v); };

// ---------- Somar uma partida ----------
export function emptyBook(patch, elo, platform) {
  return { patch, elo, platform, matches: 0, updatedAt: null, champs: {}, lane: {}, duo: {}, metrics: {} };
}

const bump = (obj, k, win) => { const x = (obj[k] ||= { g: 0, w: 0 }); x.g++; if (win) x.w++; return x; };

// Soma uma partida (MatchDto da Riot) no livro. Devolve false se a partida não serve.
export function addMatch(book, m) {
  const info = m?.info;
  if (!info || info.queueId !== QUEUE || patchOf(info.gameVersion) !== book.patch) return false;
  if ((info.gameDuration || 0) < 300) return false; // remake
  const ps = info.participants || [];
  if (ps.length !== 10) return false;
  book.matches++;
  for (const t of info.teams || []) {
    for (const b of t.bans || []) if (b.championId > 0) { const c = (book.champs[b.championId] ||= { g: 0, w: 0, b: 0, roles: {} }); c.b++; }
  }
  for (const p of ps) {
    const c = (book.champs[p.championId] ||= { g: 0, w: 0, b: 0, roles: {} });
    c.g++; if (p.win) c.w++;
    const role = POS[p.teamPosition];
    if (role) bump(c.roles, role, p.win);
    // Amostras de desempenho por rota, para comparar o seu jogo com o elo
    if (role) addSamples((book.metrics ||= {}), role, metricsOf(p, info));
  }
  for (const p of ps) {
    const role = POS[p.teamPosition];
    // Matchup: o adversário da mesma rota
    const opp = role && ps.find((o) => o.teamId !== p.teamId && POS[o.teamPosition] === role);
    if (opp) bump((book.lane[p.championId] ||= {}), opp.championId, p.win);
    // Duplas: todos os aliados
    for (const a of ps) if (a !== p && a.teamId === p.teamId) bump((book.duo[p.championId] ||= {}), a.championId, p.win);
  }
  return true;
}

// Junta dois livros (por exemplo, patch atual + anterior quando o atual ainda tem poucos jogos).
export function mergeBooks(a, b) {
  const out = { ...emptyBook(a.patch, a.elo, a.platform), matches: a.matches + b.matches, updatedAt: a.updatedAt, metrics: mergeSamples(a.metrics, b.metrics) };
  for (const src of [a, b]) {
    for (const [k, c] of Object.entries(src.champs)) {
      const o = (out.champs[k] ||= { g: 0, w: 0, b: 0, roles: {} });
      o.g += c.g; o.w += c.w; o.b += c.b;
      for (const [r, x] of Object.entries(c.roles)) { const y = (o.roles[r] ||= { g: 0, w: 0 }); y.g += x.g; y.w += x.w; }
    }
    for (const tbl of ['lane', 'duo']) {
      for (const [k, row] of Object.entries(src[tbl])) for (const [j, x] of Object.entries(row)) {
        const y = ((out[tbl][k] ||= {})[j] ||= { g: 0, w: 0 }); y.g += x.g; y.w += x.w;
      }
    }
  }
  return out;
}

const pct = (w, g) => (g ? Math.round((w / g) * 1000) / 10 : null);

// Converte o livro (ids numéricos) para o formato que a tela usa (nomes), com porcentagens prontas.
//   nameOf(key) -> nome do campeão
export function view(book, nameOf, minPair = 1) {
  const champions = {}, lane = {}, duo = {};
  const N = book.matches || 0;
  for (const [k, c] of Object.entries(book.champs)) {
    const n = nameOf(k); if (!n) continue;
    const roles = {};
    for (const [r, x] of Object.entries(c.roles)) roles[r] = { g: x.g, wr: pct(x.w, x.g), share: c.g ? Math.round((x.g / c.g) * 100) : 0 };
    champions[n] = { g: c.g, wr: pct(c.w, c.g), pr: N ? Math.round(((c.g + c.b) / N) * 1000) / 10 : 0, pick: N ? Math.round((c.g / N) * 1000) / 10 : 0, ban: N ? Math.round((c.b / N) * 1000) / 10 : 0, roles };
  }
  for (const [tbl, out] of [['lane', lane], ['duo', duo]]) {
    for (const [k, row] of Object.entries(book[tbl])) {
      const a = nameOf(k); if (!a) continue;
      for (const [j, x] of Object.entries(row)) {
        if (x.g < minPair) continue;
        const b = nameOf(j); if (!b) continue;
        (out[a] ||= {})[b] = { g: x.g, w: x.w };
      }
    }
  }
  return { patch: book.patch, elo: book.elo, platform: book.platform, matches: N, updatedAt: book.updatedAt, champions, lane, duo };
}

// ---------- Coletor ----------
class Collector extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.error = null;
    this.book = null;
    this.prev = null;       // livro do patch anterior, se existir
    this.state = null;      // { players: [], seededAt, seen: [] }
    this.api = null;
    this.startedAt = null;
    this.matchesThisRun = 0;
    this.stopFlag = false;
    this.dirty = 0;
    this.phase = '';
  }

  file(patch) { return join(DIR, `soloq_${patch}_${this.cfg.elo}_${this.cfg.platform}.json`); }

  async load(cfg) {
    this.cfg = cfg;
    this.book = (await readJSON(this.file(cfg.patch))) || emptyBook(cfg.patch, cfg.elo, cfg.platform);
    const [maj, min] = cfg.patch.split('.').map(Number);
    this.prev = min > 1 ? await readJSON(this.file(`${maj}.${min - 1}`)) : null;
    // Builds, confrontos e histórico de alto elo (lib/builds.js)
    if (cfg.items) this.items = cfg.items;
    this.builds = await loadBuilds(cfg.patch, cfg.elo, cfg.platform);
    this.prevBuilds = min > 1 ? await readJSON(buildsFile(`${maj}.${min - 1}`, cfg.elo, cfg.platform)) : null;
    const st = await readJSON(join(DIR, `estado_${cfg.elo}_${cfg.platform}.json`));
    this.state = st && st.patch === cfg.patch ? st : { patch: cfg.patch, players: [], seededAt: 0, seen: [] };
    this.seen = new Set(this.state.seen);
  }

  async save() {
    this.book.updatedAt = new Date().toISOString();
    this.state.seen = [...this.seen];
    await writeJSON(this.file(this.cfg.patch), this.book, true);
    await writeJSON(join(DIR, `estado_${this.cfg.elo}_${this.cfg.platform}.json`), this.state, true);
    if (this.builds) await saveBuilds(this.builds);
    this.dirty = 0;
  }

  status() {
    const mins = this.startedAt ? (Date.now() - this.startedAt) / 60000 : 0;
    return {
      running: this.running,
      phase: this.phase,
      error: this.error,
      patch: this.cfg?.patch || null,
      elo: this.cfg?.elo || null,
      eloNome: ELO_NOME[this.cfg?.elo] || '',
      platform: this.cfg?.platform || null,
      matches: this.book?.matches || 0,
      prevMatches: this.prev?.matches || 0,
      playersLeft: this.state?.players.length || 0,
      perMinute: mins > 1 ? Math.round(this.matchesThisRun / mins) : null,
      requests: this.api?.requests || 0,
    };
  }

  changed() { this.emit('update', this.status()); }

  // Estatísticas para a tela. Com poucos jogos no patch atual, soma o patch anterior.
  data(nameOf) {
    if (!this.book) return null;
    const useBoth = this.prev && this.book.matches < 1500;
    const b = useBoth ? mergeBooks(this.book, this.prev) : this.book;
    const v = view(b, nameOf, 8); // pares com menos de 8 jogos não entram nas contas (veja engine.js)
    v.patches = useBoth ? [this.book.patch, this.prev.patch] : [this.book.patch];
    v.patchMatches = this.book.matches;
    return v;
  }

  // Build, confrontos e histórico de um campeão numa rota (chave numérica do campeão)
  build(key, role) {
    if (!this.builds || !this.book) return null;
    const books = this.prev && this.book.matches < 1500 ? [this.book, this.prev] : [this.book];
    const lane = {}; let g = 0, w = 0;
    for (const b of books) {
      for (const [opp, x] of Object.entries(b.lane?.[key] || {})) { const y = (lane[opp] ||= { g: 0, w: 0 }); y.g += x.g; y.w += x.w; }
      const r = b.champs?.[key]?.roles?.[role]; if (r) { g += r.g; w += r.w; }
    }
    return buildView(this.builds, this.prevBuilds, key, role, { soloLane: { [key]: lane }, roleWr: g >= 30 ? (w / g) * 100 : null });
  }
  buildRoles(key) { return this.builds ? rolesOfChamp(this.builds, this.prevBuilds, key) : []; }

  // Amostras de desempenho do elo por rota (patch atual; soma o anterior com poucas partidas).
  samples() {
    if (!this.book) return {};
    const cur = this.book.metrics || {};
    const n = Object.values(cur.T || {})[0]?.n || 0;
    return this.prev && n < 300 ? mergeSamples(cur, this.prev.metrics || {}) : cur;
  }

  async start(cfg, { fetchFn, base } = {}) {
    if (this.running) await this.stop();
    if (!cfg.key) { this.error = 'Cole a sua chave da Riot para começar a coleta.'; this.changed(); return; }
    await this.load(cfg);
    this.api = new RiotApi({ key: cfg.key, platform: cfg.platform, fetchFn, base });
    this.running = true; this.error = null; this.stopFlag = false;
    this.startedAt = Date.now(); this.matchesThisRun = 0;
    this.changed();
    this.loop().catch((err) => {
      this.error = err instanceof KeyError ? err.message : 'A coleta parou: ' + err.message;
      if (!(err instanceof KeyError)) logError('coleta soloQ', err);
    }).finally(async () => {
      this.running = false; this.phase = '';
      try { await this.save(); } catch (err) { logError('salvar soloQ', err); }
      this.changed();
    });
  }

  async stop() {
    this.stopFlag = true;
    while (this.running) await new Promise((r) => setTimeout(r, 100));
  }

  async switchPatch(patch) {
    await this.save();
    this.prev = this.book;
    this.cfg = { ...this.cfg, patch };
    this.book = emptyBook(patch, this.cfg.elo, this.cfg.platform);
    this.prevBuilds = this.builds;
    this.builds = emptyBuilds(patch, this.cfg.elo, this.cfg.platform);
    this.state = { patch, players: this.state.players, tiers: this.state.tiers, seededAt: this.state.seededAt, seen: [] };
    this.seen = new Set();
  }

  async seed() {
    this.phase = 'Buscando jogadores do elo escolhido';
    this.changed();
    const found = new Set();
    const tiers = {};
    for (const tier of ELOS[this.cfg.elo]) {
      if (this.stopFlag) return;
      if (tier === 'MASTER') {
        for (const league of ['challengerleagues', 'grandmasterleagues', 'masterleagues']) {
          const l = await this.api.get('platform', `/lol/league/v4/${league}/by-queue/RANKED_SOLO_5x5`);
          for (const e of l?.entries || []) if (e.puuid) { found.add(e.puuid); tiers[e.puuid] = l.tier || 'MASTER'; }
        }
      } else {
        for (const d of DIVS) {
          const list = await this.api.get('platform', `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${d}?page=1`);
          for (const e of list || []) if (e.puuid) { found.add(e.puuid); tiers[e.puuid] = e.tier || tier; }
        }
      }
    }
    // Ordem aleatória para não concentrar a amostra num pedaço da tabela
    const arr = [...found];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    this.state.players = arr;
    this.state.tiers = tiers;
    this.state.seededAt = Date.now();
  }

  // Falha de rede não para a coleta: espera um minuto e tenta de novo. Chave inválida para.
  async loop() {
    while (!this.stopFlag) {
      try { await this.collect(); return; }
      catch (err) {
        if (err instanceof KeyError) throw err;
        this.error = 'Sem resposta da Riot (' + err.message + '). Tentando de novo em 1 minuto.';
        this.phase = 'Esperando a conexão voltar';
        this.changed();
        for (let i = 0; i < 600 && !this.stopFlag; i++) await new Promise((r) => setTimeout(r, 100));
        this.error = null;
      }
    }
  }

  async collect() {
    while (!this.stopFlag) {
      if (!this.state.players.length || Date.now() - this.state.seededAt > SEED_EVERY) await this.seed();
      const puuid = this.state.players.shift();
      if (!puuid) { this.phase = 'Nenhum jogador encontrado'; this.changed(); break; }
      this.phase = 'Baixando partidas';
      const since = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400;
      const ids = await this.api.get('region', `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&type=ranked&startTime=${since}&count=20`) || [];
      for (const id of ids) {
        if (this.stopFlag) break;
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        const m = await this.api.get('region', `/lol/match/v5/matches/${id}`);
        if (m?.info) {
          const mp = patchOf(m.info.gameVersion);
          if (newer(mp, this.cfg.patch)) await this.switchPatch(mp); // o patch novo chegou aos servidores
          else if (mp !== this.cfg.patch) break; // patch antigo: as próximas desse jogador também são
        }
        if (addMatch(this.book, m)) {
          // Linha do tempo: ordem de compra, itens iniciais, habilidades e ouro aos 14 minutos
          let tl = null;
          try { tl = await this.api.get('region', `/lol/match/v5/matches/${id}/timeline`); }
          catch (err) { if (err instanceof KeyError) throw err; }
          // Probabilidade de vitória depois do draft: o confronto de rota na coleta, sem contar esta partida
          const draftWp = (p, opp) => {
            const x = this.book.lane?.[p.championId]?.[opp?.championId];
            if (!x) return 0.5;
            const g = x.g - 1, w = x.w - (p.win ? 1 : 0);
            return g > 0 ? (w + 15) / (g + 30) : 0.5;
          };
          addBuildMatch(this.builds, m, tl, this.items || {}, { tier: this.state.tiers?.[puuid] || null, draftWp });
          this.matchesThisRun++; this.dirty++; this.changed();
        }
        if (this.dirty >= 20) await this.save();
      }
    }
  }
}

export const collector = new Collector();
collector.setMaxListeners(50);
