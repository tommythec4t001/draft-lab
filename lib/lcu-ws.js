// Cliente WebSocket mínimo para a API local do cliente do LoL (LCU).
// O projeto não usa bibliotecas externas, e o WebSocket embutido no Node não aceita
// o certificado próprio que o cliente usa em 127.0.0.1. Por isso a conexão é feita aqui,
// direto sobre TLS, seguindo a RFC 6455 (só o que a LCU precisa).
import tls from 'node:tls';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';

const HOST = '127.0.0.1';
const basic = (password) => 'Basic ' + Buffer.from(`riot:${password}`).toString('base64');

// O certificado do cliente é emitido pela própria Riot, não por uma autoridade conhecida.
// A conexão é sempre com 127.0.0.1 (o seu próprio computador), então não verificamos o certificado.
const TLS_OPTS = { host: HOST, rejectUnauthorized: false };

// ---------- Quadros (frames) ----------

// Monta um quadro do cliente para o servidor. O protocolo exige máscara nesse sentido.
export function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const frame = Buffer.alloc(head + 4 + len);
  frame[0] = 0x80 | opcode; // FIN + tipo
  if (len < 126) frame[1] = 0x80 | len;
  else if (len < 65536) { frame[1] = 0x80 | 126; frame.writeUInt16BE(len, 2); }
  else { frame[1] = 0x80 | 127; frame.writeBigUInt64BE(BigInt(len), 2); }
  const mask = randomBytes(4);
  mask.copy(frame, head);
  for (let i = 0; i < len; i++) frame[head + 4 + i] = data[i] ^ mask[i & 3];
  return frame;
}

// Lê quadros de um buffer acumulado. Devolve os quadros completos e o que sobrou.
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length - p < 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length - p < 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const masked = (b1 & 0x80) !== 0;
    let mask = null;
    if (masked) { if (buf.length - p < 4) break; mask = buf.subarray(p, p + 4); p += 4; }
    if (buf.length - p < len) break;
    let data = buf.subarray(p, p + len);
    if (mask) { data = Buffer.from(data); for (let i = 0; i < len; i++) data[i] ^= mask[i & 3]; }
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, data });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// ---------- Conexão ----------

export class LcuSocket extends EventEmitter {
  constructor(port, password) {
    super();
    this.port = port;
    this.password = password;
    this.sock = null;
    this.open = false;
  }

  connect(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const key = randomBytes(16).toString('base64');
      const sock = tls.connect({ ...TLS_OPTS, port: this.port });
      this.sock = sock;
      let buf = Buffer.alloc(0), upgraded = false, parts = [], partOp = 0;
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('O cliente do LoL não respondeu a tempo.')); }, timeoutMs);

      sock.once('secureConnect', () => {
        sock.write([
          'GET / HTTP/1.1',
          `Host: ${HOST}:${this.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          `Authorization: ${basic(this.password)}`,
          '', '',
        ].join('\r\n'));
      });

      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!upgraded) {
          const end = buf.indexOf('\r\n\r\n');
          if (end < 0) return;
          const status = buf.subarray(0, end).toString('latin1').split('\r\n')[0];
          if (!/^HTTP\/1\.1 101/.test(status)) {
            clearTimeout(timer); sock.destroy();
            return reject(new Error(`O cliente recusou a conexão (${status || 'sem resposta'}).`));
          }
          upgraded = true; this.open = true; clearTimeout(timer);
          buf = buf.subarray(end + 4);
          resolve(this);
        }
        const { frames, rest } = decodeFrames(buf);
        buf = Buffer.from(rest);
        for (const f of frames) {
          if (f.opcode === 8) { sock.end(); continue; }                                  // fechar
          if (f.opcode === 9) { sock.write(encodeFrame(f.data, 10)); continue; }          // ping -> pong
          if (f.opcode === 10) continue;                                                  // pong
          if (f.opcode === 1 || f.opcode === 2) { parts = [f.data]; partOp = f.opcode; }  // começo de mensagem
          else if (f.opcode === 0) parts.push(f.data);                                    // continuação
          if (f.fin && parts.length) {
            const text = Buffer.concat(parts).toString('utf8');
            parts = [];
            if (partOp === 1) this.emit('message', text);
          }
        }
      });

      const done = () => { clearTimeout(timer); if (this.open) { this.open = false; this.emit('close'); } };
      sock.on('error', (err) => { if (!upgraded) { clearTimeout(timer); reject(err); } else this.emit('error', err); });
      sock.on('close', done);
    });
  }

  send(obj) {
    if (this.open) this.sock.write(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }

  close() {
    if (!this.sock) return;
    try { if (this.open) this.sock.write(encodeFrame(Buffer.alloc(0), 8)); } catch { /* já fechado */ }
    this.sock.destroy();
  }
}

// Pedido REST comum para a mesma API (por exemplo, o estado atual do champ select).
export function lcuGet(port, password, path, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = https.get({ ...TLS_OPTS, port, path, headers: { Authorization: basic(password), Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

// Pedido com método e corpo (PATCH, POST, PUT). Usado pelas Configs LoL.
export function lcuRequest(port, password, method, path, body = undefined, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Authorization: basic(password), Accept: 'application/json' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    const req = https.request({ ...TLS_OPTS, port, path, method, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
