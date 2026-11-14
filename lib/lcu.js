// Conexão ao vivo com o cliente do LoL (LCU API), gravação e modo replay.
//
// Como funciona:
// 1. Descobre a porta e a senha da API local (pela linha de comando do cliente ou pelo arquivo lockfile).
// 2. Abre o WebSocket e se inscreve no evento do champ select. O cliente avisa cada hover, ban,
//    pick e troca no momento em que acontecem, sem o app precisar perguntar de tempos em tempos.
// 3. Cada mudança vira um estado simples (lib/lcu-draft.js) e é avisada para quem estiver ouvindo.
//
// A LCU não é uma API oficial: a Riot permite ferramentas com ela, mas pode mudar algo num patch.
// Por isso tudo o que depende dela fica neste arquivo e em lib/lcu-ws.js.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, basename } from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA, readJSON, logError } from './util.js';
import { LcuSocket, lcuGet, lcuRequest } from './lcu-ws.js';
import { parseHistory, topChampions } from './scout.js';
import { normalizeSession, sanitize } from './lcu-draft.js';

const SESSION_URI = '/lol-champ-select/v1/session';
const SESSION_EVENT = 'OnJsonApiEvent_lol-champ-select_v1_session';
const PHASE_URI = '/lol-gameflow/v1/gameflow-phase';
const PHASE_EVENT = 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase';
export const REC_DIR = join(DATA, 'lcu-gravacoes');
const RETRY_MS = 3000;

// ---------- Descobrir porta e senha ----------

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out)));
  });
}

export function parseCommandLine(text) {
  const port = text.match(/--app-port=["']?(\d+)/)?.[1];
  const password = text.match(/--remoting-auth-token=["']?([\w-]+)/)?.[1];
  const dir = text.match(/--install-directory=["']?([^"'\r\n]+?)["']?(?=\s--|\s*$)/m)?.[1];
  return port && password ? { port: Number(port), password, dir: dir || null, via: 'processo' } : null;
}

export function parseLockfile(text) {
  // Formato: LeagueClient:pid:porta:senha:https
  const parts = String(text).trim().split(':');
  if (parts.length < 5) return null;
  const port = Number(parts[2]), password = parts[3];
  // A porta e a senha entram direto num pedido ao cliente: porta válida e senha sem espaços nem quebras de linha.
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[\x21-\x7e]+$/.test(password)) return null;
  return { port, password, via: 'lockfile' };
}

async function fromProcess() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"]);
    return parseCommandLine(out);
  }
  if (process.platform === 'darwin') return parseCommandLine(await run('ps', ['-A', '-o', 'args']));
  return null;
}

async function lockfilePaths() {
  const cfg = await readJSON(join(DATA, 'config.json'), {});
  const list = [];
  if (cfg.lcuPath) list.push(join(cfg.lcuPath, 'lockfile'));
  if (process.platform === 'darwin') list.push('/Applications/League of Legends.app/Contents/LoL/lockfile');
  else for (const d of ['C', 'D', 'E', 'F']) list.push(`${d}:\\Riot Games\\League of Legends\\lockfile`);
  return list;
}

// O lockfile só existe enquanto o cliente está aberto, e lê-lo é instantâneo: vem primeiro.
// Consultar os processos do Windows é mais pesado, então acontece no máximo a cada 15 segundos.
let lastProcessCheck = 0;
export async function findClient() {
  for (const file of await lockfilePaths()) {
    try { const r = parseLockfile(await readFile(file, 'utf8')); if (r) return r; } catch { /* não está aqui */ }
  }
  if (Date.now() - lastProcessCheck < 15000) return null;
  lastProcessCheck = Date.now();
  return fromProcess();
}

// ---------- Gravação ----------
// Cada champ select vira um arquivo .jsonl em data/lcu-gravacoes, sem nomes nem ids de conta.

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

async function writeText(file, text) {
  // O OneDrive às vezes trava o arquivo por um instante enquanto sincroniza.
  for (let i = 0; ; i++) {
    try { return await writeFile(file, text); }
    catch (err) {
      if (i >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

class Recorder {
  constructor() { this.lines = null; this.file = null; this.start = 0; this.flushTimer = null; }
  get active() { return !!this.lines; }
  begin() {
    this.start = Date.now();
    this.file = join(REC_DIR, `draft_${stamp()}.jsonl`);
    this.lines = [];
  }
  add(eventType, data) {
    if (!this.lines) return;
    this.lines.push(JSON.stringify({ t: Date.now() - this.start, eventType, data: data ? sanitize(data) : null }));
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 2000);
  }
  async flush() {
    if (!this.lines?.length) return;
    try { await mkdir(REC_DIR, { recursive: true }); await writeText(this.file, this.lines.join('\n') + '\n'); }
    catch (err) { logError('gravar draft do cliente', err); }
  }
  async end() {
    if (!this.lines) return null;
    clearTimeout(this.flushTimer);
    const file = this.lines.length > 1 ? this.file : null; // gravação vazia não fica
    if (file) await this.flush();
    this.lines = null;
    return file ? basename(file) : null;
  }
}

export async function listRecordings() {
  try {
    const files = (await readdir(REC_DIR)).filter((f) => f.endsWith('.jsonl'));
    return files.sort().reverse();
  } catch { return []; }
}

// ---------- Conector ----------

class LcuConnector extends EventEmitter {
  constructor() {
    super();
    this.status = 'parado';  // parado | procurando | conectado
    this.client = null;      // { port, via }
    this.flow = '';          // fase do cliente: Lobby, ChampSelect, InProgress…
    this.raw = null;         // sessão crua do cliente
    this.session = null;     // sessão normalizada que a tela recebe
    this.source = 'cliente'; // cliente | replay
    this.replay = null;      // { file, speed, timers, startedAt }
    this.record = true;
    this.recorder = new Recorder();
    this.lastSaved = null;
    this.owned = null;       // { pick: [ids], ban: [ids] }
    this.me = null;          // conta logada no cliente
    this.ownedPhase = null;
    this.updatedAt = null;
    this.scout = new Map();  // puuid → { status, games } dos aliados com nome visível
    this.sock = null;
    this.loop = null;
  }

  snapshot() {
    return {
      status: this.status,
      flow: this.flow,
      source: this.source,
      client: this.client ? { port: this.client.port, via: this.client.via } : null,
      replay: this.replay ? { file: this.replay.file, speed: this.replay.speed, finished: !!this.replay.finished } : null,
      recording: this.recorder.active,
      record: this.record,
      lastSaved: this.lastSaved,
      updatedAt: this.updatedAt,
      session: this.session,
      me: this.me ? { gameName: this.me.gameName, tagLine: this.me.tagLine } : null,
      // Campeões que você pode escolher e banir (posse + rotação grátis). No replay não existe.
      owned: this.source === 'cliente' ? this.owned : null,
      // Mais jogados de cada aliado com nome visível, por vaga (cellId). O puuid fica só aqui dentro.
      scout: this.source === 'cliente' ? this.scoutSummary() : null,
    };
  }

  // Busca o histórico de cada aliado com nome visível (uma vez por champ select).
  scoutAllies(data) {
    const c = this.client;
    if (!c || !data) return;
    for (const m of data.myTeam || []) {
      const visible = m.cellId === data.localPlayerCellId || m.nameVisibilityType === 'VISIBLE';
      if (!visible || !m.puuid || this.scout.has(m.puuid)) continue;
      this.scout.set(m.puuid, { status: 'carregando' });
      lcuGet(c.port, c.password, `/lol-match-history/v1/products/lol/${encodeURIComponent(m.puuid)}/matches?begIndex=0&endIndex=40`, 8000)
        .then((r) => {
          const games = r.status === 200 ? parseHistory(r.json, m.puuid) : null;
          this.scout.set(m.puuid, games ? { status: games.length ? 'ok' : 'vazio', games } : { status: 'erro' });
        })
        .catch(() => this.scout.set(m.puuid, { status: 'erro' }))
        .finally(() => { if (this.raw) this.changed(); });
    }
  }
  scoutSummary() {
    if (!this.raw || !this.session) return null;
    const roleOf = new Map([...this.session.players.B, ...this.session.players.R].map((p) => [p.cellId, p.role]));
    const out = {};
    for (const m of this.raw.myTeam || []) {
      const s = m.puuid && this.scout.get(m.puuid);
      if (!s) continue;
      out[m.cellId] = s.status === 'ok' ? { status: 'ok', ...topChampions(s.games, roleOf.get(m.cellId) || '') } : { status: s.status };
    }
    return out;
  }

  changed() {
    this.updatedAt = Date.now();
    this.emit('update', this.snapshot());
  }

  start() {
    if (this.loop) return;
    this.status = 'procurando';
    const tick = async () => {
      if (this.status !== 'conectado') {
        try { await this.connect(); } catch (err) { this.disconnected(); if (!/ECONNREFUSED|recusou|tempo/.test(err.message)) logError('conectar ao cliente do LoL', err); }
      }
      this.loop = setTimeout(tick, RETRY_MS);
    };
    tick();
  }

  async connect() {
    let found = await findClient();
    if (!found) return;
    let sock = new LcuSocket(found.port, found.password);
    try { await sock.connect(); }
    catch (err) {
      // Lockfile velho (o cliente fechou de repente): confere o processo antes de desistir.
      const proc = found.via === 'lockfile' ? await fromProcess() : null;
      if (!proc || proc.port === found.port) throw err;
      found = proc;
      sock = new LcuSocket(found.port, found.password);
      await sock.connect();
    }
    this.sock = sock;
    this.client = found;
    this.status = 'conectado';
    sock.on('message', (text) => this.onMessage(text));
    sock.on('close', () => this.disconnected());
    sock.on('error', () => {});
    sock.send([5, SESSION_EVENT]); // 5 = inscrever (protocolo WAMP usado pelo cliente)
    sock.send([5, PHASE_EVENT]);
    // Estado atual: o app pode ter aberto no meio de um champ select.
    const [phase, sess, me] = await Promise.all([
      lcuGet(found.port, found.password, PHASE_URI).catch(() => null),
      lcuGet(found.port, found.password, SESSION_URI).catch(() => null),
      lcuGet(found.port, found.password, '/lol-summoner/v1/current-summoner').catch(() => null),
    ]);
    // Quem está logado no cliente: usado no histórico de partidas
    if (me?.status === 200 && me.json?.puuid) {
      const j = me.json;
      this.me = { puuid: j.puuid, gameName: j.gameName || j.displayName || '', tagLine: j.tagLine || '', profileIconId: j.profileIconId, summonerLevel: j.summonerLevel };
      this.emit('me', this.me);
    }
    if (phase?.status === 200) this.flow = phase.json || '';
    if (sess?.status === 200 && sess.json) this.onSession('Create', sess.json);
    this.changed();
  }

  disconnected() {
    const was = this.status;
    this.sock = null; this.client = null; this.flow = '';
    this.status = 'procurando';
    if (this.raw) this.onSession('Delete', null);
    if (was === 'conectado') this.changed();
  }

  onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!Array.isArray(msg) || msg[0] !== 8 || !msg[2]) return; // 8 = evento
    const { uri, eventType, data } = msg[2];
    if (uri === SESSION_URI) this.onSession(eventType, data);
    else if (uri === PHASE_URI) { this.flow = data || ''; if (this.source === 'cliente') this.changed(); }
  }

  // Chamado a cada evento do champ select (do cliente ou do replay).
  onSession(eventType, data, fromReplay = false) {
    if (!fromReplay) {
      const ended = eventType === 'Delete' || !data;
      if (!ended && !this.recorder.active && this.record) this.recorder.begin();
      if (this.recorder.active) this.recorder.add(ended ? 'Delete' : eventType, ended ? null : data);
      if (ended && this.recorder.active) this.recorder.end().then((f) => { if (f) { this.lastSaved = f; this.changed(); } });
      const started = !ended && !this.raw;
      const phase = data?.timer?.phase;
      if (ended) { this.owned = null; this.ownedPhase = null; this.scout.clear(); }
      else if (started || (phase === 'BAN_PICK' && this.ownedPhase !== 'BAN_PICK')) { this.ownedPhase = phase; this.loadOwned(); }
      this.raw = ended ? null : data;
      if (!ended) this.scoutAllies(data);
      if (this.source === 'replay') {
        if (!this.replay?.finished || ended) return; // o replay está na tela; o cliente fica gravando por trás
        this.stopReplay(false);                       // replay já terminou: volta para o cliente
      }
    }
    if (fromReplay && (eventType === 'Delete' || !data)) return; // no fim do replay, o draft final fica na tela
    this.session = eventType === 'Delete' || !data ? null : normalizeSession(data, Date.now(), fromReplay ? this.replay?.speed || 1 : 1);
    this.changed();
  }

  // Pedido avulso ao cliente aberto (Configs LoL). Sem cliente, avisa.
  async request(method, path, body) {
    const c = this.client;
    if (!c || this.status !== 'conectado') throw new Error('Abra o cliente do LoL: as configurações do jogo são mudadas por ele.');
    const r = await lcuRequest(c.port, c.password, method, path, body);
    if (r.status >= 400) throw new Error(`O cliente do LoL recusou o pedido (${r.status}).`);
    return r.json;
  }

  async loadOwned() {
    const c = this.client;
    if (!c) return;
    const get = (path) => lcuGet(c.port, c.password, path).then((r) => (r.status === 200 && Array.isArray(r.json) ? r.json : null)).catch(() => null);
    const [pick, ban] = await Promise.all([get('/lol-champ-select/v1/pickable-champion-ids'), get('/lol-champ-select/v1/bannable-champion-ids')]);
    if (!this.raw) return;
    this.owned = { pick, ban };
    this.changed();
  }

  setRecord(on) { this.record = !!on; this.changed(); }

  // ---------- Replay ----------
  async startReplay(file, speed = 1) {
    const name = basename(String(file));
    if (!/^[\w.-]+\.jsonl$/.test(name)) throw new Error('Arquivo de gravação inválido.');
    let text;
    try { text = await readFile(join(REC_DIR, name), 'utf8'); } catch { throw new Error('Gravação não encontrada.'); }
    const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!events.length) throw new Error('A gravação está vazia.');
    this.stopReplay(false);
    const sp = Math.min(16, Math.max(0.25, Number(speed) || 1));
    this.source = 'replay';
    this.replay = { file: name, speed: sp, timers: [] };
    for (const ev of events) {
      this.replay.timers.push(setTimeout(() => this.onSession(ev.eventType, ev.data, true), ev.t / sp));
    }
    const last = events[events.length - 1].t / sp;
    this.replay.timers.push(setTimeout(() => { if (this.replay) { this.replay.finished = true; this.changed(); } }, last + 500));
    this.session = null;
    this.changed();
  }

  stopReplay(notify = true) {
    if (!this.replay) return;
    for (const t of this.replay.timers) clearTimeout(t);
    this.replay = null;
    this.source = 'cliente';
    this.session = this.raw ? normalizeSession(this.raw) : null;
    if (notify) this.changed();
  }
}

export const lcu = new LcuConnector();
lcu.setMaxListeners(50); // uma por aba aberta
