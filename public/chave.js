// Draft Lab — chave de sessão
// O app abre a tela com a chave no endereço, depois do # (essa parte nunca é enviada pela rede).
// Aqui ela é guardada só para este endereço e tirada da barra do navegador. Todo pedido de dados leva a chave:
// sem ela o servidor responde 401, então outro programa ou outra conta do Windows não lê os seus dados.
(() => {
  const STORE = 'dl-chave';
  const stored = () => { try { return localStorage.getItem(STORE) || ''; } catch { return ''; } };
  let key = '';
  const m = location.hash.match(/(?:^#|&)chave=([0-9a-f]{16,128})(?:&|$)/);
  if (m) {
    key = m[1];
    try { localStorage.setItem(STORE, key); } catch { /* sem armazenamento: vale só para esta aba */ }
    history.replaceState(null, '', location.pathname + location.search);
  } else key = stored();

  window.DLKey = {
    get value() { return key; },
    // Cabeçalho que acompanha os pedidos de dados
    headers: () => ({ 'X-Draft-Lab-Key': key }),
    // Endereço do canal ao vivo (o navegador não deixa pôr cabeçalho nele)
    stream: () => '/api/stream?chave=' + encodeURIComponent(key),
    // Endereço de outra página do app já com a chave, para abrir em outra aba ou no navegador
    link: (path) => path + '#chave=' + key,
    // O canal ao vivo conectou: a chave desta aba vale. Garante que é ela que está guardada.
    ok() {
      failed = false;
      if (key && stored() !== key) { try { localStorage.setItem(STORE, key); } catch { /* sem armazenamento */ } }
    },
    // O canal ao vivo caiu. Se o app foi fechado e aberto de novo com esta aba parada, outra aba já guardou
    // a chave nova: recarrega para passar a usar a nova. Devolve true se recarregou.
    renew() {
      const now = stored();
      if (!now || now === key) { failed = true; return false; }
      location.reload();
      return true;
    },
  };
  let failed = false;
  // Esta aba ficou sem conexão e outra aba acabou de guardar uma chave nova (o app religou): usa a nova.
  window.addEventListener('storage', (e) => { if (failed && e.key === STORE && e.newValue && e.newValue !== key) location.reload(); });
})();
