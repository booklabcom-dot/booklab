/* Plantilla Book Lab — aplica la marca de config.js (colores y textos para Google) antes de pintar la página.
   Se carga en el <head>, justo después de config.js. */
(function () {
  var C = window.BOOKLAB_CONFIG || {}, K = C.colores || {}, S = C.seo || {};
  var raiz = document.documentElement;

  // ---------- Colores (config.js → colores) ----------
  var variables = {
    fondo: '--bg', tarjetas: '--surface', tarjetas2: '--surface-2', lineas: '--line',
    texto: '--text', textoSuave: '--muted', acento: '--accent', textoSobreAcento: '--accent-ink'
  };
  Object.keys(variables).forEach(function (k) {
    if (K[k]) raiz.style.setProperty(variables[k], K[k]);
  });
  // Color de la barra del navegador en el móvil
  var barra = document.querySelector('meta[name="theme-color"]');
  if (barra && K.fondo) barra.setAttribute('content', K.fondo);

  // ---------- Google (config.js → seo.descripcion). Solo en la portada; el título lo pone shop.js ----------
  if (raiz.hasAttribute('data-portada')) {
    var desc = document.querySelector('meta[name="description"]');
    if (desc && S.descripcion) desc.setAttribute('content', S.descripcion);
  }
})();
