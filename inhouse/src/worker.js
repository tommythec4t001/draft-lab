// Servidor das salas InHouse do Draft Lab (Cloudflare Workers + Durable Objects).
//
//   POST /api/salas              cria uma sala e devolve o link, o nome e a senha da partida (página e bot do Discord)
//   GET  /api/salas/{id}         estado público da sala (placar, picks e bans)
//   GET  /api/estatisticas       estatísticas por campeão de todas as InHouses registradas
//   GET  /api/jogos              últimos jogos registrados
//   GET  /sala/{id}              página da sala: um link só, cada um escolhe o time e a rota
//   GET  /sala/{id}/ws           WebSocket da sala
//
// Cada sala é um Durable Object "Sala"; os resultados vão para um único Durable Object "Arquivo" (SQLite).

import { novaSala, aplicar, tempoEsgotado, visao, resumoJogo, ErroSala } from './draft.js';

const DD_PADRAO = 'https://ddragon.leagueoflegends.com';
const LIMPEZA = 3 * 24 * 3600 * 1000; // sala parada há 3 dias é apagada
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const ID = /^[A-Za-z0-9]{8}$/;
const WEBHOOK = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,100}$/;

export const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });

export function aleatorio(n) {
  const letras = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => letras[x % letras.length]).join('');
}

// Lista de campeões do Data Dragon (cache de 6 h por instância do Worker).
let cacheCampeoes = null;
async function campeoes(env) {
  const dd = env.DDRAGON || DD_PADRAO;
  if (cacheCampeoes && cacheCampeoes.dd === dd && Date.now() - cacheCampeoes.em < 6 * 3600 * 1000) return cacheCampeoes;
  const versoes = await (await fetch(`${dd}/api/versions.json`)).json();
  const versao = versoes[0];
  const dados = await (await fetch(`${dd}/cdn/${versao}/data/pt_BR/champion.json`)).json();
  const nomes = Object.fromEntries(Object.values(dados.data).map((c) => [c.id, c.name]));
  cacheCampeoes = { dd, versao, ids: Object.keys(nomes).sort(), nomes, em: Date.now() };
  return cacheCampeoes;
}

const sala = (env, id) => env.SALAS.get(env.SALAS.idFromName(id));
const arquivo = (env) => env.ARQUIVO.get(env.ARQUIVO.idFromName('inhouse'));

// Nome da partida: o modelo vem da configuração do servidor (NOME_PARTIDA, com {n} no lugar do número).
// O número sobe 1 a cada sala criada; a senha é sorteada. Ninguém escolhe nenhum dos dois.
export function nomePartida(modelo, n) {
  const m = typeof modelo === 'string' && modelo.includes('{n}') ? modelo : 'DraftLab {n}';
  return m.replace('{n}', String(n)).slice(0, 60);
}

export function mensagemDiscord(r) {
  const { link, config, partida } = r;
  const serie = config.serie > 1 ? `MD${config.serie}${config.fearless ? ' Fearless' : ''}` : 'MD1';
  return [
    `**${config.timeA}** x **${config.timeB}** · ${serie}`,
    `Nome: \`${partida.nome}\``,
    `Senha: \`${partida.senha}\``,
    `Draft: ${link}`,
  ].join('\n');
}

async function criarSala(req, env, origem) {
  let corpo;
  try { corpo = await req.json(); } catch { return json({ erro: 'Envie os dados da sala em JSON.' }, 400); }
  corpo = corpo && typeof corpo === 'object' ? corpo : {};
  const webhook = typeof corpo.webhook === 'string' && corpo.webhook.trim() ? corpo.webhook.trim() : null;
  if (webhook && !WEBHOOK.test(webhook)) return json({ erro: 'O webhook precisa ser um link de webhook do Discord.' }, 400);
  let lista;
  try { lista = await campeoes(env); } catch { return json({ erro: 'Não consegui carregar a lista de campeões. Tente de novo.' }, 502); }
  const id = aleatorio(8);
  const { n } = await (await arquivo(env).fetch('https://arquivo/contador', { method: 'POST' })).json();
  const partida = { nome: nomePartida(env.NOME_PARTIDA, n), senha: aleatorio(4) };
  const r = await sala(env, id).fetch('https://sala/criar', {
    method: 'POST',
    body: JSON.stringify({ id, campeoes: lista.ids, nomes: lista.nomes, versao: lista.versao, dd: lista.dd, config: corpo, partida, webhook, origem }),
  });
  if (!r.ok) return json({ erro: 'Não consegui criar a sala.' }, 500);
  const { config } = await r.json();
  const out = {
    id,
    link: `${origem}/sala/${id}`,
    partida,
    config: { timeA: config.timeA, timeB: config.timeB, serie: config.serie, fearless: config.fearless, tempo: config.tempo },
  };
  out.mensagem = mensagemDiscord(out);
  return json(out, 201);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (p === '/api/salas' && req.method === 'POST') return criarSala(req, env, url.origin);
    let m = p.match(/^\/api\/salas\/([^/]+)$/);
    if (m && req.method === 'GET') return ID.test(m[1]) ? sala(env, m[1]).fetch('https://sala/estado') : json({ erro: 'Sala não encontrada.' }, 404);
    if (p === '/api/estatisticas' || p === '/api/jogos') return arquivo(env).fetch(`https://arquivo${p.slice(4)}${url.search}`);
    if (p === '/api/saude') return json({ ok: true });
    if (p === '/api/config') return json({ dd: env.DDRAGON || DD_PADRAO });
    m = p.match(/^\/sala\/([^/]+)\/ws$/);
    if (m) {
      if (!ID.test(m[1])) return json({ erro: 'Sala não encontrada.' }, 404);
      if (req.headers.get('Upgrade') !== 'websocket') return json({ erro: 'Use WebSocket.' }, 426);
      return sala(env, m[1]).fetch(req);
    }
    m = p.match(/^\/sala\/([^/]+)\/?$/);
    if (m) return env.ASSETS.fetch(new Request(new URL('/sala.html', url), req));
    if (p === '/' || p === '/criar' || p === '/estatisticas') {
      const pag = p === '/estatisticas' ? '/estatisticas.html' : '/index.html';
      return env.ASSETS.fetch(new Request(new URL(pag, url), req));
    }
    return env.ASSETS.fetch(req);
  },
};

// ---------------- Sala ----------------

export class Sala {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.s = null;
    this.extra = null; // webhook e origem: ficam fora do estado do draft
  }

  async carregar() {
    if (!this.s) {
      this.s = (await this.ctx.storage.get('s')) || null;
      this.extra = (await this.ctx.storage.get('extra')) || {};
    }
    return this.s;
  }

  async salvar() {
    await this.ctx.storage.put('s', this.s);
  }

  async agendar() {
    if (!this.s) return;
    await this.ctx.storage.setAlarm(this.s.prazo ?? this.s.ativo + LIMPEZA);
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/criar') {
      if (await this.carregar()) return json({ erro: 'Sala já existe.' }, 409);
      const d = await req.json();
      this.s = novaSala({ id: d.id, campeoes: d.campeoes, nomes: d.nomes, versao: d.versao, dd: d.dd, partida: d.partida, config: d.config });
      this.extra = { webhook: d.webhook || null, origem: d.origem || '' };
      await this.ctx.storage.put('extra', this.extra);
      await this.salvar();
      await this.agendar();
      return json({ ok: true, config: { timeA: this.s.times.A.nome, timeB: this.s.times.B.nome, ...this.s.config } });
    }
    if (!(await this.carregar())) return json({ erro: 'Sala não encontrada ou expirada.' }, 404);
    if (req.headers.get('Upgrade') === 'websocket') {
      const [cliente, servidor] = Object.values(new WebSocketPair());
      this.aceitar(servidor);
      return new Response(null, { status: 101, webSocket: cliente });
    }
    if (url.pathname === '/estado') return json(visao(this.s, null));
    return json({ erro: 'Não encontrado.' }, 404);
  }

  aceitar(ws) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ cid: null });
  }

  enviar(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* conexão caiu */ }
  }

  transmitir() {
    const agora = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const { cid } = ws.deserializeAttachment() || {};
      this.enviar(ws, { t: 'estado', estado: visao(this.s, cid, agora) });
    }
  }

  async webSocketMessage(ws, dados) {
    if (!(await this.carregar())) { this.enviar(ws, { t: 'erro', msg: 'Sala não encontrada ou expirada.' }); return; }
    let msg;
    try { msg = JSON.parse(typeof dados === 'string' ? dados : new TextDecoder().decode(dados)); } catch { return; }
    if (msg?.t === 'ola') {
      const cid = typeof msg.cid === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(msg.cid) ? msg.cid : null;
      ws.serializeAttachment({ cid });
      this.enviar(ws, { t: 'estado', estado: visao(this.s, cid) });
      return;
    }
    if (msg?.t === 'ping') { this.enviar(ws, { t: 'pong', agora: Date.now() }); return; }
    const { cid } = ws.deserializeAttachment() || {};
    let eventos;
    try {
      eventos = aplicar(this.s, cid, msg, Date.now());
    } catch (e) {
      if (e instanceof ErroSala) { this.enviar(ws, { t: 'erro', msg: e.message }); return; }
      throw e;
    }
    await this.depois(eventos);
  }

  async depois(eventos) {
    await this.salvar();
    await this.agendar();
    this.transmitir();
    for (const ev of eventos) await this.avisar(ev).catch(() => {});
  }

  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'tchau'); } catch { /* já fechado */ }
  }

  async webSocketError() { /* o navegador reconecta sozinho */ }

  async alarm() {
    if (!(await this.carregar())) return;
    const agora = Date.now();
    if (this.s.prazo && agora >= this.s.prazo) {
      await this.depois(tempoEsgotado(this.s, agora));
      return;
    }
    if (!this.s.prazo && agora - this.s.ativo >= LIMPEZA) {
      for (const ws of this.ctx.getWebSockets()) try { ws.close(1000, 'Sala expirada'); } catch { /* */ }
      await this.ctx.storage.deleteAll();
      this.s = null;
      return;
    }
    await this.agendar();
  }

  // Avisos: arquivo de estatísticas e canal do Discord. No Discord vai só uma linha por resultado:
  // os picks ficam na sala (o link mostra tudo), para não encher o chat.
  async avisar(ev) {
    if (ev.tipo !== 'resultado') return;
    const resumo = resumoJogo(this.s, ev.jogo);
    await arquivo(this.env).fetch('https://arquivo/jogo', { method: 'POST', body: JSON.stringify(resumo) });
    await this.discord(linhaResultado(this.s, ev.jogo, this.extra?.origem));
  }

  async discord(texto) {
    const url = this.extra?.webhook;
    if (!url || !texto) return;
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Draft Lab InHouse', content: texto, allowed_mentions: { parse: [] }, flags: 4 }) });
  }
}

const placar = (s) => `${s.jogos.filter((j) => j.vencedor === 'A').length} x ${s.jogos.filter((j) => j.vencedor === 'B').length}`;

// Uma linha por resultado, com o link da sala para quem quiser ver o draft.
export function linhaResultado(s, n, origem) {
  const j = s.jogos[n - 1];
  if (!j?.vencedor) return null;
  const v = s.times[j.vencedor].nome;
  const p = s.times[j.vencedor === 'A' ? 'B' : 'A'].nome;
  const link = origem ? ` · ${origem}/sala/${s.id}` : '';
  if (s.fase === 'encerrada') return `🏆 **${v}** venceu ${s.config.serie > 1 ? `a série contra **${p}** (${placar(s)})` : `contra **${p}**`}${link}`;
  return `**${v}** venceu o jogo ${n} contra **${p}** · placar ${placar(s)}${link}`;
}

// ---------------- Arquivo (estatísticas) ----------------

export class Arquivo {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS jogos (
      sala TEXT NOT NULL, jogo INTEGER NOT NULL, fim INTEGER, versao TEXT, serie INTEGER, fearless INTEGER,
      titulo TEXT, time_azul TEXT, time_vermelho TEXT, vencedor_lado TEXT, PRIMARY KEY (sala, jogo))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS escolhas (
      sala TEXT NOT NULL, jogo INTEGER NOT NULL, lado TEXT, tipo TEXT, vaga TEXT, champ TEXT, venceu INTEGER)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS escolhas_champ ON escolhas (champ)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS contador (k TEXT PRIMARY KEY, n INTEGER NOT NULL)');
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/contador' && req.method === 'POST') {
      // Número da próxima partida: sobe 1 a cada sala criada.
      const inicio = Math.max(Number(this.env.PARTIDA_INICIAL) || 1, 1);
      this.sql.exec('INSERT INTO contador (k, n) VALUES (\'partida\', ?) ON CONFLICT(k) DO UPDATE SET n = n + 1', inicio);
      return json({ n: this.sql.exec('SELECT n FROM contador WHERE k = \'partida\'').one().n });
    }
    if (url.pathname === '/jogo' && req.method === 'POST') {
      this.registrar(await req.json());
      return json({ ok: true });
    }
    const dias = Math.min(Math.max(Number(url.searchParams.get('dias')) || 30, 1), 365);
    const desde = Date.now() - dias * 86400_000;
    if (url.pathname === '/estatisticas') return json(this.estatisticas(desde, dias));
    if (url.pathname === '/jogos') return json(this.ultimos(Math.min(Number(url.searchParams.get('limite')) || 20, 100)));
    return json({ erro: 'Não encontrado.' }, 404);
  }

  registrar(r) {
    if (!r?.sala || !r.jogo || !r.vencedor) return;
    const ladoV = r.times[r.vencedor].lado;
    const azul = r.times.A.lado === 'azul' ? r.times.A : r.times.B;
    const verm = r.times.A.lado === 'azul' ? r.times.B : r.times.A;
    this.sql.exec('DELETE FROM escolhas WHERE sala = ? AND jogo = ?', r.sala, r.jogo);
    this.sql.exec(
      'INSERT OR REPLACE INTO jogos (sala, jogo, fim, versao, serie, fearless, titulo, time_azul, time_vermelho, vencedor_lado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.sala, r.jogo, r.fim || Date.now(), r.versao || null, r.serie || 1, r.fearless ? 1 : 0, r.titulo || null, azul.nome, verm.nome, ladoV,
    );
    for (const t of ['A', 'B']) {
      const T = r.times[t];
      const venceu = r.vencedor === t ? 1 : 0;
      for (const c of T.bans) if (c) this.sql.exec('INSERT INTO escolhas VALUES (?, ?, ?, ?, ?, ?, ?)', r.sala, r.jogo, T.lado, 'ban', null, c, venceu);
      for (const p of T.picks) if (p.champ) this.sql.exec('INSERT INTO escolhas VALUES (?, ?, ?, ?, ?, ?, ?)', r.sala, r.jogo, T.lado, 'pick', p.vaga, p.champ, venceu);
    }
  }

  estatisticas(desde, dias) {
    const total = this.sql.exec('SELECT COUNT(*) AS n, SUM(vencedor_lado = \'azul\') AS azul FROM jogos WHERE fim >= ?', desde).one();
    const linhas = this.sql.exec(
      `SELECT e.champ AS champ,
              SUM(e.tipo = 'pick') AS picks, SUM(e.tipo = 'pick' AND e.venceu = 1) AS vitorias, SUM(e.tipo = 'ban') AS bans
         FROM escolhas e JOIN jogos j ON j.sala = e.sala AND j.jogo = e.jogo
        WHERE j.fim >= ? GROUP BY e.champ`, desde).toArray();
    const rotas = this.sql.exec(
      `SELECT e.champ AS champ, e.vaga AS vaga, COUNT(*) AS n
         FROM escolhas e JOIN jogos j ON j.sala = e.sala AND j.jogo = e.jogo
        WHERE j.fim >= ? AND e.tipo = 'pick' GROUP BY e.champ, e.vaga`, desde).toArray();
    const porCamp = {};
    for (const r of rotas) (porCamp[r.champ] ||= {})[r.vaga] = r.n;
    const n = total.n || 0;
    return {
      dias,
      jogos: n,
      vitoriasAzul: total.azul || 0,
      campeoes: linhas.map((l) => ({
        champ: l.champ,
        picks: l.picks,
        vitorias: l.vitorias,
        bans: l.bans,
        presenca: n ? Math.round(((l.picks + l.bans) / n) * 1000) / 10 : 0,
        winrate: l.picks ? Math.round((l.vitorias / l.picks) * 1000) / 10 : null,
        rotas: porCamp[l.champ] || {},
      })).sort((a, b) => b.presenca - a.presenca || b.picks - a.picks),
    };
  }

  ultimos(limite) {
    const jogos = this.sql.exec('SELECT * FROM jogos ORDER BY fim DESC LIMIT ?', limite).toArray();
    return jogos.map((j) => {
      const esc = this.sql.exec('SELECT lado, tipo, vaga, champ FROM escolhas WHERE sala = ? AND jogo = ?', j.sala, j.jogo).toArray();
      const lado = (l) => ({
        picks: Object.fromEntries(esc.filter((e) => e.lado === l && e.tipo === 'pick').map((e) => [e.vaga, e.champ])),
        bans: esc.filter((e) => e.lado === l && e.tipo === 'ban').map((e) => e.champ),
      });
      return { sala: j.sala, jogo: j.jogo, fim: j.fim, versao: j.versao, titulo: j.titulo, azul: { nome: j.time_azul, ...lado('azul') }, vermelho: { nome: j.time_vermelho, ...lado('vermelho') }, vencedor: j.vencedor_lado };
    });
  }
}
