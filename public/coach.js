// Draft Lab — coach pós-partida (aba Partidas) e o tom do coach (Configurações).
// O servidor tira os fatos da partida (lib/coach.js) e escreve o texto no tom escolhido (lib/coach-falas.js).
(() => {
  const $ = (id) => document.getElementById(id);
  const { api, esc } = window.DL;
  const TONS = { serio: 'Sério', divertido: 'Divertido' };
  let CFG = { tom: 'serio' };
  const cache = new Map(); // `${id}:${tom}` -> resposta

  const pronto = api('/api/config').then((c) => { if (c.coach) CFG = { ...CFG, ...c.coach }; preencherOpcoes(); }).catch(() => {});

  async function salvar(parcial) {
    CFG = { ...CFG, ...parcial };
    try { const c = await api('/api/config', { method: 'PUT', body: JSON.stringify({ coach: parcial }) }); if (c.coach) CFG = { ...CFG, ...c.coach }; return true; }
    catch (err) { return err; }
  }

  // ---------- cartão do coach numa partida ----------
  function cartao(r, id) {
    const f = r.fatos, t = r.texto;
    const letra = f.nota?.letra || '–';
    const mortes = (f.mortes || []).slice(0, 8).map((d) => `<li><b class="num">${esc(d.quando)}</b> ${esc(d.por)}${d.ajudantes ? ` <small>+${d.ajudantes}</small>` : ''}${d.gank ? ' <span class="tag-gank">gank</span>' : ''}</li>`).join('');
    const base = f.aprox
      ? 'Comparado com valores de referência de Esmeralda+ (ainda não há partidas do seu elo coletadas para essa rota).'
      : 'Comparado com as partidas do seu elo coletadas pelo Draft Lab, na mesma rota.';
    return `<section class="coach" aria-label="Análise do coach">
      <div class="coach-cab">
        <div class="coach-nota n-${esc(letra)}" title="Nota da sua atuação${f.nota?.pct != null ? `: ${f.nota.pct} de 100` : ''}">${esc(letra)}</div>
        <div class="coach-tit"><small>Coach do Draft Lab</small><h4>${esc(t.titulo)}</h4></div>
        <div class="coach-acoes">
          <div class="seg" role="group" aria-label="Tom do coach">${Object.entries(TONS).map(([k, n]) => `<button class="chip" data-tom="${k}" aria-pressed="${t.tom === k}">${n}</button>`).join('')}</div>
        </div>
      </div>
      <ul class="coach-blocos">${t.blocos.map((b) => `<li class="${esc(b.tipo)}">${esc(b.texto)}</li>`).join('')}</ul>
      <p class="coach-foco"><b>Foco para a próxima</b>${esc(t.foco)}</p>
      ${mortes ? `<div class="coach-mortes"><span>Suas mortes</span><ul>${mortes}</ul></div>` : ''}
      <p class="fine">${base}${f.temLinhaDoTempo ? '' : ' Sem a linha do tempo da partida, a fase de rotas e as mortes ficam de fora.'}</p>
    </section>`;
  }

  async function montar(el, id, tom = CFG.tom) {
    await pronto;
    const chave = `${id}:${tom}`;
    if (!cache.has(chave)) {
      el.innerHTML = '<section class="coach carregando"><p class="note">O coach está analisando a partida…</p></section>';
      try { cache.set(chave, await api(`/api/coach/${encodeURIComponent(id)}?tom=${tom}`)); }
      catch (err) { el.innerHTML = `<section class="coach"><p class="note err">${esc(err.message)}</p></section>`; return; }
    }
    if (!el.isConnected) return;
    const r = cache.get(chave);
    el.innerHTML = cartao(r, id);
    for (const b of el.querySelectorAll('[data-tom]')) b.onclick = (e) => {
      e.stopPropagation();
      if (b.dataset.tom === r.texto.tom) return;
      salvar({ tom: b.dataset.tom });
      montar(el, id, b.dataset.tom);
    };
  }

  // ---------- Configurações > Coach ----------
  function preencherOpcoes() {
    for (const b of document.querySelectorAll('[data-coach-tom]')) b.setAttribute('aria-pressed', String(b.dataset.coachTom === CFG.tom));
  }
  const msg = (t, k = 'ok') => { const m = $('coachMsg'); if (m) { m.className = 'note ' + k; m.textContent = t; } };
  for (const b of document.querySelectorAll('[data-coach-tom]')) b.onclick = async () => {
    for (const x of document.querySelectorAll('[data-coach-tom]')) x.setAttribute('aria-pressed', String(x === b));
    const r = await salvar({ tom: b.dataset.coachTom });
    msg(r === true ? `Tom ${TONS[b.dataset.coachTom].toLowerCase()}.` : r.message, r === true ? 'ok' : 'err');
  };

  window.DLCoach = { montar, get cfg() { return CFG; } };
})();
