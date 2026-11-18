// Auto-recovery: si un SW obsoleto cacheó un index.html que apunta a
// assets con hashes viejos, el módulo principal falla al cargar.
// Este script detecta el fallo y destruye caches + SW automáticamente,
// sin que el usuario tenga que borrar nada manualmente.
//
// Protección contra bucles: como máximo un intento cada 2 minutos (registro en
// sessionStorage compartido con compat/lib/actualizacionApp.js). Si vuelve a
// fallar y la app no llegó a mostrarse, se muestra una pantalla con «Reintentar».
(function(){
  var CLAVE = 'recuperacion-version';
  var VENTANA_MS = 2 * 60 * 1000;
  var recovering = false;

  function puedeIntentar() {
    try {
      var previo = Number(sessionStorage.getItem(CLAVE));
      return !previo || Date.now() - previo > VENTANA_MS;
    } catch (e) {
      return false; // sin almacenamiento no se pueden limitar los intentos
    }
  }

  function marcarIntento() {
    try { sessionStorage.setItem(CLAVE, String(Date.now())); } catch (e) { /* sin registro */ }
  }

  function limpiarTodo() {
    var p = [];
    if ('caches' in window) p.push(caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); }));
    if ('serviceWorker' in navigator) p.push(navigator.serviceWorker.getRegistrations().then(function(rs){ return Promise.all(rs.map(function(r){ return r.unregister(); })); }));
    return Promise.all(p);
  }

  function mostrarPantallaReintento() {
    var root = document.getElementById('root');
    // Si la app ya está en pantalla, no taparla: el fallo fue de una parte.
    if (!root || root.childElementCount > 0 || document.getElementById('recuperacion-version')) return;
    var caja = document.createElement('div');
    caja.id = 'recuperacion-version';
    caja.setAttribute('role', 'alert');
    caja.style.cssText = 'min-height:100dvh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;padding-bottom:calc(24px + env(safe-area-inset-bottom));background:#0a1628;color:#fff;font-family:system-ui,-apple-system,sans-serif;text-align:center';
    var titulo = document.createElement('p');
    titulo.textContent = 'No se pudo cargar el sistema';
    titulo.style.cssText = 'margin:0;font-size:18px;font-weight:700';
    var texto = document.createElement('p');
    texto.textContent = 'Revisa tu conexión a internet y vuelve a intentarlo.';
    texto.style.cssText = 'margin:0;font-size:15px;opacity:.75;max-width:320px';
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Reintentar';
    boton.style.cssText = 'min-height:44px;padding:0 24px;border:0;border-radius:12px;background:#0ea5e9;color:#0a1628;font-size:16px;font-weight:700;cursor:pointer';
    boton.addEventListener('click', function(){
      boton.disabled = true;
      marcarIntento();
      limpiarTodo().then(function(){ location.reload(); }, function(){ location.reload(); });
    });
    caja.appendChild(titulo);
    caja.appendChild(texto);
    caja.appendChild(boton);
    root.appendChild(caja);
  }

  function hardRecover() {
    if (recovering) return;
    if (!puedeIntentar()) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mostrarPantallaReintento, { once: true });
      else mostrarPantallaReintento();
      return;
    }
    recovering = true;
    marcarIntento();
    limpiarTodo().then(function(){ location.reload(); }, function(){ location.reload(); });
  }

  window.addEventListener('unhandledrejection', function(e) {
    var msg = e.reason && (e.reason.message || String(e.reason)) || '';
    if (/Failed to fetch dynamically imported module|Loading module.*failed|Importing a module script failed/i.test(msg)) hardRecover();
  });
  // Capturar errores de carga de scripts/estilos (MIME type, 404 de hash viejo)
  window.addEventListener('error', function(e) {
    var t = e.target || e.srcElement;
    if (t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK') && /\/assets\//.test(t.src || t.href || '')) hardRecover();
  }, true);
})();
