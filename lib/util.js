import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Onde ficam os seus dados. Rodando pelo Iniciar.bat: a pasta data do projeto.
// No app instalado: a pasta de dados do usuário no Windows (o app define DRAFTLAB_DATA antes de ligar o servidor).
export const DATA = process.env.DRAFTLAB_DATA || join(ROOT, 'data');
export const CACHE = join(DATA, 'cache');

// Nome normalizado: "Kai'Sa" -> "kaisa", "Nunu & Willump" -> "nunuwillump"
export const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');

export async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

// O OneDrive às vezes trava o arquivo por um instante enquanto sincroniza: tenta de novo antes de desistir.
// compact: sem espaços, para arquivos grandes que ninguém lê à mão (estatísticas).
export async function writeJSON(file, value, compact = false) {
  await mkdir(dirname(file), { recursive: true });
  const text = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  for (let i = 0; ; i++) {
    try { return await writeFile(file, text); }
    catch (err) {
      if (i >= 5 || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
}

// Registro de erros em data/erros.log, para descobrir o que aconteceu depois.
export async function logError(where, err) {
  const line = `[${new Date().toLocaleString('pt-BR')}] ${where}: ${err?.stack || err}\n`;
  console.error(line.trim());
  try { const { appendFile } = await import('node:fs/promises'); await appendFile(join(DATA, 'erros.log'), line); } catch { /* sem problema */ }
}

// Alguns sites bloqueiam pedidos sem cara de navegador.
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}
