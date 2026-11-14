// Cliente da API oficial da Riot com controle de limite de pedidos.
// A chave de desenvolvimento aceita 20 pedidos por segundo e 100 a cada 2 minutos, somando tudo o que o app pede.
// Por isso o limite é compartilhado: a coleta de estatísticas e o seu histórico de partidas dividem a mesma conta,
// e os pedidos que você está esperando na tela (prioridade alta) passam na frente da coleta.
import { fetchWithTimeout } from './util.js';

export class KeyError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Estado do limite, compartilhado por todos os clientes que usam a mesma chave
const shared = new Map();
const limiterFor = (key) => {
  if (!shared.has(key)) shared.set(key, { sent: [], pauseUntil: 0, urgent: 0 });
  return shared.get(key);
};

export class RiotApi {
  constructor({ key, platform = 'br1', limits = [[18, 1000], [95, 120000]], fetchFn = fetchWithTimeout, base = null }) {
    this.key = key;
    this.platform = platform;
    this.limits = limits;   // [pedidos, janela em ms]
    this.fetch = fetchFn;
    this.base = base;       // só para testes: troca o endereço da Riot
    this.lim = limiterFor(key + '|' + JSON.stringify(limits));
    this.requests = 0;
    this.queue = Promise.resolve();
  }

  get region() {
    const p = this.platform;
    return ['euw1', 'eun1', 'tr1', 'ru', 'me1'].includes(p) ? 'europe' : ['kr', 'jp1'].includes(p) ? 'asia' : ['oc1', 'sg2', 'tw2', 'vn2'].includes(p) ? 'sea' : 'americas';
  }

  // Espera a vez respeitando as janelas. Pedidos normais também esperam enquanto houver pedidos urgentes.
  async slot(urgent) {
    const L = this.lim;
    for (;;) {
      const now = Date.now();
      if (now < L.pauseUntil) { await sleep(L.pauseUntil - now); continue; }
      if (!urgent && L.urgent > 0) { await sleep(100); continue; }
      let wait = 0;
      for (const [n, win] of this.limits) {
        const recent = L.sent.filter((t) => now - t < win);
        if (recent.length >= n) wait = Math.max(wait, win - (now - recent[recent.length - n]) + 5);
      }
      if (!wait) break;
      await sleep(Math.min(wait, urgent ? wait : 1000)); // pedidos normais reavaliam a cada segundo
    }
    const now = Date.now();
    L.sent.push(now);
    const longest = Math.max(...this.limits.map((l) => l[1]));
    while (L.sent.length && now - L.sent[0] > longest) L.sent.shift();
  }

  // host: 'platform' (br1…) ou 'region' (americas…). Pedidos normais saem um de cada vez, em fila.
  get(host, path) {
    const run = this.queue.then(() => this.request(host, path, false));
    this.queue = run.catch(() => {});
    return run;
  }

  // Pedido que alguém está esperando na tela: passa na frente da coleta.
  async urgent(host, path) {
    this.lim.urgent++;
    try { return await this.request(host, path, true); } finally { this.lim.urgent--; }
  }

  async request(host, path, urgent) {
    const origin = this.base || `https://${host === 'region' ? this.region : this.platform}.api.riotgames.com`;
    for (let attempt = 0; ; attempt++) {
      await this.slot(urgent);
      this.requests++;
      let r;
      try { r = await this.fetch(origin + path, { headers: { 'X-Riot-Token': this.key } }, 15000); }
      catch (err) { if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; } throw err; }
      if (r.status === 200) return r.json();
      if (r.status === 404) return null;
      if (r.status === 401 || r.status === 403) throw new KeyError('A chave da Riot é inválida ou expirou. Chaves de desenvolvimento valem 24 horas: gere outra em developer.riotgames.com.');
      if (r.status === 429) {
        const after = Number(r.headers.get('retry-after')) || 10;
        this.lim.pauseUntil = Date.now() + after * 1000;
        continue;
      }
      if (r.status >= 500 && attempt < 3) { await sleep(3000 * (attempt + 1)); continue; }
      throw new Error(`A Riot respondeu ${r.status} em ${path.split('?')[0]}`);
    }
  }
}
