// Configs LoL: muda as configurações do jogo pelo próprio cliente do LoL (API local, a mesma que a tela de
// configurações do cliente usa) e alguns ajustes do Windows que não pedem permissão de administrador.
//
// +FPS: abaixa o que mais pesa na placa de vídeo, liga o modo de baixo desempenho do cliente, põe o Windows
//       no plano de energia de alto desempenho e manda o LoL usar a placa de vídeo dedicada.
//
// Antes de mudar qualquer coisa, o valor antigo vai para data/lol-config-backup.json, e o botão Restaurar
// devolve tudo como estava.
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { DATA, readJSON, writeJSON } from './util.js';

const BACKUP = join(DATA, 'lol-config-backup.json');
const IS_WIN = process.platform === 'win32';

// Comandos do Windows. Os testes trocam por um falso.
let run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});
let windows = IS_WIN;
export function _setRunner(fn, isWindows = true) { run = fn; windows = isWindows; }

// ---------- +FPS ----------
// [chave, valor, o que é]. Só entra o que existe nas configurações atuais, no mesmo tipo (número ou sim/não).
// Nas qualidades (0 = muito baixa), o app só abaixa: se você já usa algo mais baixo, fica como está.
export const FPS_JOGO = [
  ['ShadowQuality', 0, 'Sombras desligadas'],
  ['ShadowsEnabled', false, 'Sombras desligadas'],
  ['EnvironmentQuality', 0, 'Ambiente em muito baixo'],
  ['EffectsQuality', 1, 'Efeitos em baixo'],
  ['CharacterQuality', 1, 'Personagens em baixo'],
  ['EnableFXAA', false, 'Anti-serrilhado desligado'],
  ['CharacterInking', false, 'Contorno dos personagens desligado'],
  ['PerPixelPointLighting', false, 'Iluminação por pixel desligada'],
  ['EnableGrassSwaying', false, 'Grama parada'],
  ['EnableHUDAnimations', false, 'Animações da interface desligadas'],
  ['EnableParticleOptimizations', true, 'Otimização de partículas ligada'],
  ['AutoPerformanceSettings', false, 'Ajuste automático do jogo desligado'],
  ['WaitForVerticalSync', false, 'V-Sync desligado'],
  ['HideEyeCandy', true, 'Enfeites do mapa escondidos'],
  ['EnableScreenShake', false, 'Tremor da tela desligado'],
];
const QUALIDADES = new Set(['ShadowQuality', 'EnvironmentQuality', 'EffectsQuality', 'CharacterQuality']);
export const FPS_CLIENTE = [
  ['potatoModeEnabled', true, 'Modo de baixo desempenho do cliente'],
  ['closeLeagueClientDuringGame', true, 'Fechar o cliente durante a partida'],
  ['unloadUxInGameEnabled', true, 'Descarregar o cliente durante a partida'],
];
const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'; // plano "Alto desempenho" do Windows
const GPU_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';

function coerce(current, value) {
  if (typeof current === 'boolean') return Boolean(value);
  if (typeof current === 'number') return Number(value);
  if (typeof current === 'string') return typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  return undefined;
}

// Calcula o que muda nas configurações do jogo: { seção: { chave: novo } }, a lista do que mudou e os antigos.
export function planoJogo(settings) {
  const patch = {}, old = {}, feito = [];
  for (const [key, value, label] of FPS_JOGO) {
    for (const [sec, obj] of Object.entries(settings || {})) {
      if (!obj || typeof obj !== 'object' || !(key in obj)) continue;
      const cur = obj[key];
      let v = coerce(cur, value);
      if (v === undefined) continue;
      if (QUALIDADES.has(key) && Number(cur) <= Number(v)) continue; // já está igual ou mais baixo
      if (v === cur) continue;
      (patch[sec] ||= {})[key] = v;
      (old[sec] ||= {})[key] = cur;
      if (!feito.includes(label)) feito.push(label);
    }
  }
  return { patch, old, feito };
}

export function planoCliente(data) {
  const patch = {}, old = {}, feito = [];
  for (const [key, value, label] of FPS_CLIENTE) {
    if (!data || !(key in data) || data[key] === value) continue;
    patch[key] = value; old[key] = data[key]; feito.push(label);
  }
  return { patch, old, feito };
}

// Guarda só o primeiro valor de cada chave: aplicar duas vezes não apaga o original.
function mergeOld(into, from) {
  for (const [sec, obj] of Object.entries(from || {})) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      into[sec] ||= {};
      for (const [k, v] of Object.entries(obj)) if (!(k in into[sec])) into[sec][k] = v;
    } else if (!(sec in into)) into[sec] = obj;
  }
  return into;
}

const UX = '/lol-settings/v1/local/lol-user-experience';

async function powerScheme() {
  const out = await run('powercfg', ['/getactivescheme']);
  return out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || null;
}
async function gpuValue(exe) {
  try {
    const out = await run('reg', ['query', GPU_KEY, '/v', exe]);
    return out.match(/REG_SZ\s+(.*)$/m)?.[1]?.trim() ?? null;
  } catch { return null; } // a chave ainda não existe
}
async function gameExe(lcu) {
  let dir = await lcu.request('GET', '/data-store/v1/install-dir').catch(() => null);
  if (typeof dir !== 'string' || !dir) return null;
  dir = dir.replace(/\//g, '\\').replace(/\\+$/, '');
  return `${dir}\\Game\\League of Legends.exe`;
}

export async function aplicarFps(lcu) {
  if (lcu.flow === 'InProgress') throw new Error('Termine a partida antes: o jogo grava as configurações dele quando fecha e desfaria a mudança.');
  const passos = [];
  const backup = (await readJSON(BACKUP, null)) || { jogo: {}, cliente: {} };
  backup.quando ||= Date.now();

  // 1. Configurações do jogo (as mesmas da tela de vídeo dentro da partida)
  const settings = await lcu.request('GET', '/lol-game-settings/v1/game-settings');
  const jogo = planoJogo(settings);
  if (Object.keys(jogo.patch).length) {
    mergeOld(backup.jogo, jogo.old);
    await writeJSON(BACKUP, backup); // o backup vai para o disco antes de mudar
    await lcu.request('PATCH', '/lol-game-settings/v1/game-settings', jogo.patch);
    await lcu.request('POST', '/lol-game-settings/v1/save').catch(() => null);
    passos.push({ nome: 'Vídeo do jogo', ok: true, detalhe: jogo.feito.join(', ') + '.' });
  } else passos.push({ nome: 'Vídeo do jogo', ok: true, detalhe: 'Já estava no mais leve.' });

  // 2. Cliente do LoL
  try {
    const ux = await lcu.request('GET', UX);
    const cli = planoCliente(ux?.data);
    if (Object.keys(cli.patch).length) {
      mergeOld(backup.cliente, cli.old);
      await writeJSON(BACKUP, backup);
      await lcu.request('PATCH', UX, { schemaVersion: ux?.schemaVersion ?? 2, data: { ...ux.data, ...cli.patch } });
      passos.push({ nome: 'Cliente do LoL', ok: true, detalhe: cli.feito.join(', ') + '.' });
    } else passos.push({ nome: 'Cliente do LoL', ok: true, detalhe: 'Já estava no modo leve.' });
  } catch (err) { passos.push({ nome: 'Cliente do LoL', ok: false, detalhe: err.message }); }

  if (!windows) { passos.push({ nome: 'Windows', ok: false, detalhe: 'Ajustes do Windows só no Windows.' }); return { passos, backup: true }; }

  // 3. Plano de energia
  try {
    const atual = await powerScheme();
    if (atual === HIGH_PERF) passos.push({ nome: 'Energia do Windows', ok: true, detalhe: 'Já estava em Alto desempenho.' });
    else {
      await run('powercfg', ['/setactive', HIGH_PERF]);
      if (atual && !backup.energia) backup.energia = atual;
      await writeJSON(BACKUP, backup);
      passos.push({ nome: 'Energia do Windows', ok: true, detalhe: 'Plano Alto desempenho: o processador não reduz a velocidade no meio da partida.' });
    }
  } catch { passos.push({ nome: 'Energia do Windows', ok: false, detalhe: 'Este Windows não tem o plano Alto desempenho disponível.' }); }

  // 4. Placa de vídeo dedicada para o LoL (faz diferença em notebooks com duas placas)
  try {
    const exe = await gameExe(lcu);
    if (!exe) throw new Error('pasta do LoL não encontrada');
    const atual = await gpuValue(exe);
    if (atual === 'GpuPreference=2;') passos.push({ nome: 'Placa de vídeo', ok: true, detalhe: 'O LoL já usava a placa de alto desempenho.' });
    else {
      if (!backup.gpu) backup.gpu = { exe, valor: atual };
      await writeJSON(BACKUP, backup);
      await run('reg', ['add', GPU_KEY, '/v', exe, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f']);
      passos.push({ nome: 'Placa de vídeo', ok: true, detalhe: 'O LoL passa a usar a placa de vídeo de alto desempenho.' });
    }
  } catch (err) { passos.push({ nome: 'Placa de vídeo', ok: false, detalhe: 'Não deu para ajustar: ' + err.message + '.' }); }

  return { passos, backup: true };
}

export async function restaurar(lcu) {
  const b = await readJSON(BACKUP, null);
  if (!b) throw new Error('Não há nada para restaurar: o Draft Lab ainda não mudou as suas configurações.');
  if (lcu.flow === 'InProgress') throw new Error('Termine a partida antes de restaurar.');
  const passos = [];
  let falhou = false;
  if (Object.keys(b.jogo || {}).length) {
    try {
      await lcu.request('PATCH', '/lol-game-settings/v1/game-settings', b.jogo);
      await lcu.request('POST', '/lol-game-settings/v1/save').catch(() => null);
      passos.push({ nome: 'Vídeo do jogo', ok: true, detalhe: 'Voltou como estava.' });
    } catch (err) { falhou = true; passos.push({ nome: 'Vídeo do jogo', ok: false, detalhe: err.message }); }
  }
  if (Object.keys(b.cliente || {}).length) {
    try {
      const ux = await lcu.request('GET', UX);
      await lcu.request('PATCH', UX, { schemaVersion: ux?.schemaVersion ?? 2, data: { ...ux?.data, ...b.cliente } });
      passos.push({ nome: 'Cliente do LoL', ok: true, detalhe: 'Voltou como estava.' });
    } catch (err) { falhou = true; passos.push({ nome: 'Cliente do LoL', ok: false, detalhe: err.message }); }
  }
  if (b.energia && windows) {
    try { await run('powercfg', ['/setactive', b.energia]); passos.push({ nome: 'Energia do Windows', ok: true, detalhe: 'Plano de energia anterior de volta.' }); }
    catch { falhou = true; passos.push({ nome: 'Energia do Windows', ok: false, detalhe: 'Não consegui voltar o plano anterior.' }); }
  }
  if (b.gpu && windows) {
    try {
      if (b.gpu.valor) await run('reg', ['add', GPU_KEY, '/v', b.gpu.exe, '/t', 'REG_SZ', '/d', b.gpu.valor, '/f']);
      else await run('reg', ['delete', GPU_KEY, '/v', b.gpu.exe, '/f']);
      passos.push({ nome: 'Placa de vídeo', ok: true, detalhe: 'Escolha da placa de vídeo de volta ao padrão.' });
    } catch { falhou = true; passos.push({ nome: 'Placa de vídeo', ok: false, detalhe: 'Não consegui desfazer a escolha da placa.' }); }
  }
  if (!falhou) await unlink(BACKUP).catch(() => {});
  return { passos, backup: falhou };
}

export async function temBackup() {
  const b = await readJSON(BACKUP, null);
  return b ? { quando: b.quando || null } : null;
}
