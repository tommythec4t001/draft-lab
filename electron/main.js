// Draft Lab — aplicativo para Windows (Electron)
// Liga o mesmo servidor do Iniciar.bat por dentro do app e mostra a tela numa janela própria.
// Fechar a janela só esconde o app: ele continua perto do relógio, coletando estatísticas e esperando o champ select.
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, screen, session } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, cpSync, copyFileSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const APP = app.getAppPath();
const DATA = join(app.getPath('userData'), 'data');
const SETTINGS = join(app.getPath('userData'), 'app.json');
const ICON = join(APP, 'electron', 'icon.png');
const HIDDEN = process.argv.includes('--hidden'); // aberto junto com o Windows: começa escondido

// Só um Draft Lab aberto por vez: abrir de novo traz a janela que já existe.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

// ---------- Preferências do app ----------
const DEFAULTS = { abrirNoChampSelect: true, iniciarComWindows: false, avisouBandeja: false };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, 'utf8')) }; } catch { /* primeira vez */ }
const saveSettings = () => { try { writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); } catch { /* sem problema */ } };

// ---------- Dados ----------
// Primeira vez: traz os dados da pasta antiga (Documentos\Draft Lab\data), se existir,
// e copia as fichas, rotas e a gravação de exemplo que vêm com o app.
function prepareData() {
  mkdirSync(DATA, { recursive: true });
  if (!existsSync(join(DATA, 'config.json'))) {
    for (const old of [join(app.getPath('documents'), 'Draft Lab', 'data'), join(app.getPath('documents'), 'draft-lab', 'data')]) {
      if (existsSync(join(old, 'config.json'))) { try { cpSync(old, DATA, { recursive: true, force: false }); } catch { /* segue sem */ } break; }
    }
  }
  for (const f of ['profiles.json', 'roles.json', 'adc.json', 'suporte.json', 'topo.json', 'meio.json', 'selva.json', join('lcu-gravacoes', 'exemplo_torneio.jsonl')]) {
    const dst = join(DATA, f);
    if (!existsSync(dst)) { mkdirSync(join(dst, '..'), { recursive: true }); try { copyFileSync(join(APP, 'data', f), dst); } catch { /* segue sem */ } }
  }
}

// ---------- Segurança ----------
// Só endereços da web abrem no navegador. Arquivos do computador e outros protocolos (file:, ms-…:, etc.)
// nunca: um link assim poderia abrir um programa em vez de uma página.
function openExternal(target) {
  try {
    const u = new URL(target);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href);
  } catch { /* endereço inválido: não abre nada */ }
}
// Nenhuma janela do app embute outra página dentro dela.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

// ---------- Janela ----------
let win = null, tray = null, url = null, quitting = false;

function createWindow(show) {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'Draft Lab', icon: ICON, backgroundColor: '#161A17', show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(url + '#chave=' + server.accessKey); // a chave de sessão libera os dados para esta janela (public/chave.js)
  win.once('ready-to-show', () => { if (show) win.show(); });
  // Links externos (como o site da Riot) abrem no navegador
  win.webContents.setWindowOpenHandler(({ url: target }) => { openExternal(target); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(url)) { e.preventDefault(); openExternal(target); } });
  // Fechar esconde: o app continua coletando e esperando o champ select
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!settings.avisouBandeja && tray) {
      tray.displayBalloon?.({ title: 'O Draft Lab continua aberto', content: 'Ele fica aqui perto do relógio, coletando estatísticas e esperando o próximo champ select. Para fechar de vez, use Sair neste ícone.', iconType: 'info' });
      settings.avisouBandeja = true; saveSettings();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- Recursos pessoais ----------
// A pasta pessoal/ (painel de ouro do Tab) só existe no computador do Enzo: não vai para o GitHub nem para a
// versão pública. Sem ela, o app funciona igual, só sem o painel.
let server = null; // módulo do servidor (server.js), carregado ao ligar
let painel = null;

// ---------- Ícone perto do relógio ----------
function buildTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Draft Lab');
  tray.on('click', showWindow);
  refreshTrayMenu();
}
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Draft Lab', click: showWindow },
    { type: 'separator' },
    { label: 'Abrir sozinho no champ select', type: 'checkbox', checked: settings.abrirNoChampSelect,
      click: (i) => { settings.abrirNoChampSelect = i.checked; saveSettings(); } },
    ...(painel ? [{ label: 'Painel de ouro ao segurar Tab na partida', type: 'checkbox', checked: painel.ligado,
      click: (i) => { painel.set(i.checked).catch(() => {}); } }] : []),
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: settings.iniciarComWindows,
      click: (i) => { settings.iniciarComWindows = i.checked; saveSettings(); applyLogin(); } },
    { type: 'separator' },
    { label: 'Abrir a pasta de dados', click: () => shell.openPath(DATA) },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}
function applyLogin() {
  if (!app.isPackaged) return; // em desenvolvimento não mexe no Windows
  app.setLoginItemSettings({ openAtLogin: settings.iniciarComWindows, args: ['--hidden'] });
}

// ---------- Início ----------
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* continua na bandeja */ });

app.whenReady().then(async () => {
  if (!firstInstance) return;
  app.setAppUserModelId('com.draftlab.app');
  // O app não usa câmera, microfone, localização nem notificações da página: qualquer pedido desses é negado.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  prepareData();
  process.env.DRAFTLAB_DATA = DATA;
  process.env.DRAFTLAB_EMBEDDED = '1';
  let port;
  try {
    server = await import(pathToFileURL(join(APP, 'server.js')).href);
    port = await server.start({ quiet: true });
  } catch (err) {
    dialog.showErrorBox('Draft Lab', 'O Draft Lab não conseguiu ligar: ' + (err?.message || err));
    app.exit(1);
    return;
  }
  url = `http://127.0.0.1:${port}/`;
  // Painel do Tab (só com a pasta pessoal/) antes do ícone, mas sem nunca impedir a janela de abrir.
  const pessoal = join(APP, 'pessoal', 'overlay.js');
  if (existsSync(pessoal) && server.live) {
    try {
      const { iniciarPainel } = await import(pathToFileURL(pessoal).href);
      painel = await iniciarPainel({ app, BrowserWindow, screen, server, url, DATA, onChange: () => refreshTrayMenu() });
    } catch (err) {
      try { appendFileSync(join(DATA, 'painel.log'), `${new Date().toISOString()} painel do Tab desligado: ${err?.message || err}\n`); } catch { /* sem registro */ }
    }
  }
  buildTray();
  applyLogin();
  createWindow(!HIDDEN);

  // Abrir sozinho quando um champ select começa no cliente do LoL
  const { lcu } = await import(pathToFileURL(join(APP, 'lib', 'lcu.js')).href);
  let had = false;
  lcu.on('update', (s) => {
    const has = !!s.session && s.source === 'cliente';
    if (has && !had && settings.abrirNoChampSelect) showWindow();
    had = has;
  });
});
