// Voz do coach: usa as vozes instaladas no Windows (as de português, como Maria e Daniel), pelo próprio navegador do app.
// Nada sai do computador. window.DLVoz.falar(texto, { voz, velocidade }) lê em voz alta; parar() interrompe.
(() => {
  const S = window.speechSynthesis;
  let lista = [];
  const carregar = () => {
    if (!S) return [];
    lista = S.getVoices().filter((v) => /^pt/i.test(v.lang));
    // Português do Brasil primeiro
    lista.sort((a, b) => (b.lang === 'pt-BR') - (a.lang === 'pt-BR') || a.name.localeCompare(b.name));
    return lista;
  };
  if (S) { carregar(); S.addEventListener?.('voiceschanged', carregar); }

  // As vozes chegam um pouco depois de a página abrir: espera até 2 s.
  async function vozes() {
    if (!S) return [];
    for (let i = 0; i < 20 && !carregar().length; i++) await new Promise((r) => setTimeout(r, 100));
    return lista.map((v) => ({ nome: v.name, lingua: v.lang }));
  }

  function escolher(nome) {
    return lista.find((v) => v.name === nome) || lista.find((v) => v.lang === 'pt-BR') || lista[0] || null;
  }

  // Lê em voz alta; frases longas são quebradas para o Windows não cortar a fala no meio.
  function falar(texto, { voz = '', velocidade = 1, fila = false } = {}) {
    if (!S || !texto) return false;
    if (!fila) S.cancel();
    const v = escolher(voz);
    const partes = String(texto).match(/[^.!?]+[.!?]*/g) || [texto];
    for (const p of partes) {
      const u = new SpeechSynthesisUtterance(p.trim());
      if (v) u.voice = v;
      u.lang = v?.lang || 'pt-BR';
      u.rate = velocidade;
      S.speak(u);
    }
    return true;
  }

  window.DLVoz = { falar, parar: () => S?.cancel(), vozes, falando: () => !!S?.speaking, disponivel: !!S };
})();
