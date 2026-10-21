/* Book Lab — movimiento de la landing.
   Marca con .is-in los bloques al entrar en pantalla (una sola vez) y numera los grupos escalonados.
   Todo es progresivo: si esto no se ejecuta, la clase .anim se retira y el contenido se ve tal cual. */
(function () {
  'use strict';
  window.__ed = 1;
  var root = document.documentElement;

  // Línea bajo la cabecera al hacer scroll (antes iba en línea en index.html)
  var h = document.querySelector('.header');
  if (h) {
    var on = function () { h.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', on, { passive: true }); on();
  }

  if (!root.classList.contains('anim')) return;

  // Índice de cada hijo para el escalonado (--i)
  document.querySelectorAll('[data-stagger]').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (el, i) { el.style.setProperty('--i', Math.min(i, 8)); });
  });

  var targets = document.querySelectorAll('[data-reveal], [data-stagger], .ed-h, .intro-statement, .proceso-line, .cta');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });

  targets.forEach(function (el) { io.observe(el); });

  // Red de seguridad: si se salta con un ancla (p. ej. #contacto) o se imprime, que nada quede oculto
  window.addEventListener('beforeprint', function () { targets.forEach(function (el) { el.classList.add('is-in'); }); });
})();
