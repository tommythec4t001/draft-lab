// Servidor local que imita a Cloudflare (Workers + Durable Objects) para testar as salas no PC.
//   node dev.js            -> http://localhost:8787
// Usa o mesmo worker.js e draft.js da Cloudflare. O SQLite do arquivo fica em memória.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUBLICO = join(AQUI, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- imitação do armazenamento e do contexto dos Durable Objects ----------

function sqlEmMemoria() {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    exec(q, ...b) {
      const st = db.prepare(q);
      const linhas = /^\s*SELECT/i.test(q) ? st.all(...b).map((r) => ({ ...r })) : (st.run(...b), []);
      return { toArray: () => linhas, one: () => linhas[0] };
    },
  };
}

function contexto(obj) {
  const mapa = new Map();
  const sockets = new Set();
  let timer = null;
  const storage = {
    async get(k) { return mapa.has(k) ? structuredClone(mapa.get(k)) : undefined; },
    async put(k, v) { mapa.set(k, structuredClone(v)); },
    async deleteAll() { mapa.clear(); clearTimeout(timer); },
    async setAlarm(t) {
      clearTimeout(timer);
      timer = setTimeout(() => obj().alarm().catch((e) => console.error('alarm', e)), Math.max(0, t - Date.now()));
      timer.unref?.();
    },
  };
  return {
    storage,
    sockets,
    acceptWebSocket(ws) { sockets.add(ws); },
    getWebSockets() { return [...sockets]; },
  };
}

function namespace(Classe, env) {
  const objetos = new Map();
  const pegar = (id) => {
    if (!objetos.has(id)) {
      let inst;
      const ctx = contexto(() => inst);
      if (Classe.name === 'Arquivo') ctx.storage.sql = sqlEmMemoria();
      inst = new Classe(ctx, env);
      objetos.set(id, inst);
    }
    return objetos.get(id);
  };
  return {
    pegar,
    idFromName: (n) => n,
    get: (id) => ({ fetch: (u, init) => pegar(id).fetch(u instanceof Request ? u : new Request(u, init)) }),
  };
}

// ---------- WebSocket mínimo (só o que as salas usam: texto, ping, close) ----------

function aceitarWebSocket(req, socket) {
  const chave = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(chave + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  let anexo = null;
  let aberto = true;
  const quadro = (op, dados) => {
    const p = Buffer.from(dados);
    const cab = p.length < 126 ? Buffer.from([0x80 | op, p.length])
      : p.length < 65536 ? Buffer.from([0x80 | op, 126, p.length >> 8, p.length & 255])
        : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(p.length)); return b; })()]);
    return Buffer.concat([cab, p]);
  };
  const ws = {
    onmessage: null,
    onclose: null,
    send(txt) { if (aberto) socket.write(quadro(1, txt)); },
    close(code = 1000) { if (!aberto) return; aberto = false; const b = Buffer.alloc(2); b.writeUInt16BE(code); socket.end(quadro(8, b)); },
    serializeAttachment(o) { anexo = structuredClone(o); },
    deserializeAttachment() { return anexo; },
  };
  let buf = Buffer.alloc(0);
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let pos = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); pos = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); pos = 10; }
      const mascarado = buf[1] & 128;
      const fim = pos + (mascarado ? 4 : 0) + len;
      if (buf.length < fim) return;
      let dados = buf.subarray(pos + (mascarado ? 4 : 0), fim);
      if (mascarado) { const m = buf.subarray(pos, pos + 4); dados = Buffer.from(dados.map((x, i) => x ^ m[i % 4])); }
      buf = buf.subarray(fim);
      if (op === 1) ws.onmessage?.(dados.toString('utf8'));
      else if (op === 8) { const code = dados.length >= 2 ? dados.readUInt16BE(0) : 1005; ws.close(1000); ws.onclose?.(code); }
      else if (op === 9) socket.write(quadro(10, dados));
    }
  });
  const fechou = () => { if (aberto) { aberto = false; ws.onclose?.(1006); } };
  socket.on('close', fechou);
  socket.on('error', fechou);
  return ws;
}

// ---------- servidor ----------

export async function iniciar({ porta = 8787, ddFixture = null, quieto = false, vars = {} } = {}) {
  const worker = await import(pathToFileURL(join(AQUI, 'src', 'worker.js')).href);
  const env = { NOME_PARTIDA: 'DraftLab {n}', PARTIDA_INICIAL: '1', ...vars };
  const assets = {
    async fetch(req) {
      const u = new URL(req.url);
      const arq = join(PUBLICO, decodeURIComponent(u.pathname).replace(/\.\.+/g, ''));
      try { return new Response(await readFile(arq), { headers: { 'content-type': TIPOS[extname(arq)] || 'application/octet-stream' } }); } catch { return new Response('Não encontrado', { status: 404 }); }
    },
  };
  env.ASSETS = assets;
  env.SALAS = namespace(worker.Sala, env);
  env.ARQUIVO = namespace(worker.Arquivo, env);

  // Data Dragon de mentira (para testar sem internet): /__dd/...
  const dd = ddFixture ? JSON.parse(await readFile(ddFixture, 'utf8')) : null;
  const svg = (txt) => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="hsl(${[...txt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360},35%,32%)"/><text x="60" y="68" font-size="22" fill="#eee" text-anchor="middle" font-family="sans-serif">${txt.slice(0, 4)}</text></svg>`;

  const servidor = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${req.headers.host}`);
      if (dd && u.pathname.startsWith('/__dd/')) {
        res.setHeader('access-control-allow-origin', '*');
        if (u.pathname === '/__dd/api/versions.json') return res.end(JSON.stringify([dd.version]));
        if (u.pathname.endsWith('/champion.json')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(dd)); }
        const nome = u.pathname.split('/').pop().replace(/(_\d+)?\.(png|jpg)$/, '');
        res.setHeader('content-type', 'image/svg+xml');
        return res.end(svg(nome));
      }
      const corpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise((ok) => { const b = []; req.on('data', (d) => b.push(d)); req.on('end', () => ok(Buffer.concat(b))); });
      const r = await worker.default.fetch(new Request(u, { method: req.method, headers: req.headers, body: corpo }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end('erro');
    }
  });

  servidor.on('upgrade', async (req, socket) => {
    const m = new URL(req.url, 'http://x').pathname.match(/^\/sala\/([A-Za-z0-9]{8})\/ws$/);
    const inst = m && env.SALAS.pegar(m[1]);
    if (!inst || !(await inst.carregar())) { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    const ws = aceitarWebSocket(req, socket);
    inst.aceitar(ws);
    ws.onmessage = (txt) => inst.webSocketMessage(ws, txt).catch((e) => console.error('mensagem', e));
    ws.onclose = (code) => { inst.ctx.sockets.delete(ws); inst.webSocketClose(ws, code).catch(() => {}); };
  });

  await new Promise((ok) => servidor.listen(porta, '127.0.0.1', ok));
  const url = `http://localhost:${servidor.address().port}`;
  if (dd) env.DDRAGON = `${url}/__dd`;
  if (!quieto) console.log(`Salas InHouse rodando em ${url}`);
  return { url, servidor, env, fechar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(ok); }) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--dd');
  iniciar({ porta: Number(process.env.PORT) || 8787, ddFixture: i > 0 ? process.argv[i + 1] : null });
}
