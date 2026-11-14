// Draft Lab — Configs LoL (+FPS)
(() => {
  const $ = (id) => document.getElementById(id);
  const { api, esc } = window.DL;

  const passosHTML = (passos) => `<ul class="steps">${passos.map((p) => `<li class="${p.ok ? 'ok' : 'no'}"><b>${esc(p.nome)}</b><span>${esc(p.detalhe)}</span></li>`).join('')}</ul>`;

  async function loadState() {
    try {
      const s = await api('/api/lolconfig');
      const el = $('lolState');
      el.className = 'note' + (s.cliente && !s.emPartida ? '' : ' err');
      el.textContent = !s.cliente ? 'Abra o cliente do LoL: é por ele que o Draft Lab muda as configurações do jogo.'
        : s.emPartida ? 'Você está numa partida. Aplique depois que ela acabar: o jogo grava as configurações dele ao fechar.'
          : 'Cliente do LoL conectado. As mudanças valem a partir da próxima partida.';
      $('fpsBtn').disabled = !s.cliente || s.emPartida;
      $('restoreBtn').hidden = !s.backup;
      $('restoreBtn').disabled = !s.cliente || s.emPartida;
      if (s.backup?.quando) $('restoreBtn').title = 'Configurações guardadas em ' + new Date(s.backup.quando).toLocaleString('pt-BR');
    } catch (err) { $('lolState').className = 'note err'; $('lolState').textContent = err.message; }
  }

  async function run(btn, out, path, busy) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = busy;
    try {
      const r = await api(path, { method: 'POST', body: '{}' });
      out.innerHTML = passosHTML(r.passos);
    } catch (err) { out.innerHTML = `<p class="note err">${esc(err.message)}</p>`; }
    btn.textContent = label;
    await loadState();
  }
  $('fpsBtn').onclick = () => run($('fpsBtn'), $('fpsOut'), '/api/lolconfig/fps', 'Aplicando…');
  $('restoreBtn').onclick = () => run($('restoreBtn'), $('fpsOut'), '/api/lolconfig/restaurar', 'Restaurando…');

  document.addEventListener('dl:view', (e) => { if (e.detail === 'lolcfg') loadState(); });
  document.addEventListener('dl:lcu', () => { if (!$('view-lolcfg').hidden) loadState(); });
})();
