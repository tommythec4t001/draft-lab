// Roda todos os testes (test/*.test.js) e, se existir, os da pasta pessoal/.
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['lcu', 'soloq', 'engine', 'history', 'scout', 'mundo', 'pro', 'builds'];
const files = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.js'))
  .sort((a, b) => (ORDER.indexOf(a.split('.')[0]) + 1 || 99) - (ORDER.indexOf(b.split('.')[0]) + 1 || 99))
  .map((f) => join(ROOT, 'test', f));
const pessoal = join(ROOT, 'pessoal');
if (existsSync(pessoal)) files.push(...readdirSync(pessoal).filter((f) => f.endsWith('.test.js')).map((f) => join(pessoal, f)));
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) { console.error(`\nFalhou: ${f}`); process.exit(r.status || 1); }
}
