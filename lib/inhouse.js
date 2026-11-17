// Salas InHouse: ponte entre o Draft Lab e o servidor de salas (pasta inhouse/, publicado na Cloudflare).
// O app cria a sala pelo servidor local (assim a tela não precisa falar com outro site) e mostra a sala
// num quadro dentro da aba InHouse, com o painel de análise do Draft Lab ao lado.

// Endereço do servidor publicado. Depois de publicar com "Publicar servidor InHouse.bat", coloque aqui
// o endereço que a Cloudflare mostrar (ex.: https://draft-lab-inhouse.SEU-NOME.workers.dev).
export const INHOUSE_PADRAO = '';

// Aceita https://qualquer-site e, para testes, http://localhost ou http://127.0.0.1.
export function normalizarUrl(txt) {
  const s = String(txt ?? '').trim().replace(/\/+$/, '');
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { return null; }
  const local = u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  if (u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return null;
  return u.origin;
}

export const urlDe = (cfg) => normalizarUrl(process.env.INHOUSE_URL) || normalizarUrl(cfg?.inhouse) || normalizarUrl(INHOUSE_PADRAO) || '';

// Link de sala colado pelo usuário: precisa ser do servidor configurado.
export function linkDeSala(base, link) {
  if (!base) return null;
  let u;
  try { u = new URL(String(link ?? '').trim()); } catch { return null; }
  if (u.origin !== base) return null;
  const m = u.pathname.match(/^\/sala\/([A-Za-z0-9]{8})\/?$/);
  if (!m) return null;
  const time = u.searchParams.get('time');
  const t = u.searchParams.get('t');
  const out = new URL(`${base}/sala/${m[1]}`);
  if ((time === 'A' || time === 'B') && t && /^[A-Za-z0-9]{6,40}$/.test(t)) { out.searchParams.set('time', time); out.searchParams.set('t', t); }
  return out.href;
}

export async function criarSala(base, dados, { fetchImpl = fetch } = {}) {
  if (!base) throw new Error('Configure o endereço do servidor InHouse primeiro.');
  const corpo = {
    timeA: String(dados?.timeA ?? '').slice(0, 24),
    timeB: String(dados?.timeB ?? '').slice(0, 24),
    serie: Number(dados?.serie) || 1,
    fearless: dados?.fearless !== false,
    tempo: Number(dados?.tempo) || 30,
    titulo: String(dados?.titulo ?? '').slice(0, 60),
    webhook: String(dados?.webhook ?? '').slice(0, 200),
  };
  let r;
  try {
    r = await fetchImpl(`${base}/api/salas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Não consegui falar com o servidor InHouse. Confira a internet e o endereço do servidor.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `O servidor InHouse respondeu ${r.status}.`);
  return j;
}
