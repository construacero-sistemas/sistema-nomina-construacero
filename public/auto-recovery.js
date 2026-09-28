// Auto-recovery: si un SW obsoleto cacheó un index.html que apunta a
// assets con hashes viejos, el módulo principal falla al cargar.
// Este script detecta el fallo y destruye caches + SW automáticamente,
// sin que el usuario tenga que borrar nada manualmente.
(function(){
  var recovering = false;
  function hardRecover() {
    if (recovering) return;
    recovering = true;
    var p = [];
    if ('caches' in window) p.push(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); }));
    if ('serviceWorker' in navigator) p.push(navigator.serviceWorker.getRegistrations().then(function(rs){ return Promise.all(rs.map(function(r){ return r.unregister(); })); }));
    Promise.all(p).then(function(){ location.reload(); }).catch(function(){ location.reload(); });
  }
  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason && (e.reason.message || String(e.reason)) || '';
    if (/Failed to fetch dynamically imported module|Loading module.*failed/i.test(msg)) hardRecover();
  });
  // Capturar errores de carga de scripts/estilos (MIME type, 404 de hash viejo)
  window.addEventListener('error', function(e) {
    var t = e.target || e.srcElement;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK') && /\/assets\//.test(t.src || t.href || '')) hardRecover();
  }, true);
})();
