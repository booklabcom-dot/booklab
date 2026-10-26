/*
 * César Fernández Hair Studio — portada (demo Book Lab).
 * Pinta servicios y horario desde config.js y coordina el movimiento:
 * entrada de la portada, revelados al bajar, cambio carbón/marfil, parallax y pasos del método.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG || {}, N = C.negocio || {};
  var root = document.documentElement;
  var $ = function (s, ctx) { return (ctx || document).querySelector(s); };
  var $$ = function (s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); };
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- Servicios (config.js → servicios) ----------
  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  var menu = $('#menu');
  (C.servicios || []).forEach(function (s, i) {
    var li = el('li');
    li.setAttribute('data-rise', '');
    li.appendChild(el('span', 'm-n', String(i + 1).padStart(2, '0')));
    li.appendChild(el('h3', null, s.nombre));
    li.appendChild(el('p', 'm-desc', s.descripcion));
    var meta = el('p', 'm-meta', s.duracion + ' min');
    if (s.destacado) meta.appendChild(el('b', null, 'El más pedido'));
    li.appendChild(meta);
    li.appendChild(el('span', 'm-price', money.format(s.precio)));
    menu.appendChild(li);
  });

  // ---------- Horario (config.js → horarioWeb u horario) ----------
  var DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var H = C.horarioWeb || C.horario || {};
  var today = (function () {
    var wd = new Intl.DateTimeFormat('en-GB', { timeZone: N.zonaHoraria || 'Europe/Madrid', weekday: 'short' }).format(new Date());
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd) + 1;
  })();
  for (var d = 1; d <= 7; d++) {
    var t = H[d] || [];
    var row = el('div', (d === today ? 'is-today ' : '') + (t.length ? '' : 'is-closed'));
    row.appendChild(el('dt', null, DAYS[d]));
    row.appendChild(el('dd', null, t.length ? t.map(function (x) { return x[0] + '–' + x[1]; }).join(' · ') : 'Cerrado'));
    $('#hours').appendChild(row);
  }

  // ---------- Retrasos escalonados (líneas de titulares y bloques hermanos) ----------
  $$('.ln').forEach(function (ln) {
    var i = Array.prototype.indexOf.call(ln.parentNode.children, ln);
    ln.firstElementChild.style.setProperty('--i', i);
  });
  $$('.steps, .menu, .studio-cols, .intro').forEach(function (group) {
    $$('[data-rise]', group).forEach(function (n, i) { n.style.setProperty('--i', i % 4); });
  });

  // ---------- Entrada de la portada ----------
  function start() { requestAnimationFrame(function () { root.classList.add('is-in'); }); }
  if (calm) start();
  else {
    var started = false, go = function () { if (!started) { started = true; start(); } };
    var img = $('.hero-media img');
    Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      img && !img.complete ? new Promise(function (r) { img.onload = img.onerror = r; }) : Promise.resolve()
    ]).then(go);
    setTimeout(go, 1200);
  }

  // ---------- Revelados al bajar ----------
  var targets = $$('[data-lines], [data-rise], [data-mask]');
  if (calm || !('IntersectionObserver' in window)) {
    targets.forEach(function (n) { n.classList.add('is-visible'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    targets.forEach(function (n) { io.observe(n); });
  }

  // ---------- Cambio de escena: carbón ↔ marfil ----------
  var themeMeta = $('meta[name="theme-color"]');
  if ('IntersectionObserver' in window) {
    var toneIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var tone = e.target.getAttribute('data-tone');
        if (root.getAttribute('data-tone') !== tone) {
          root.setAttribute('data-tone', tone);
          if (themeMeta) themeMeta.setAttribute('content', tone === 'light' ? '#F0EDE6' : '#171717');
        }
      });
    }, { rootMargin: '-50% 0px -50% 0px' });
    $$('main > [data-tone], footer[data-tone]').forEach(function (s) { toneIO.observe(s); });
  }

  // ---------- Pasos del método: el que está en el centro se ilumina ----------
  var steps = $$('.step');
  if ('IntersectionObserver' in window && steps.length) {
    var stepIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          steps.forEach(function (s) { s.classList.toggle('is-active', s === e.target); });
        }
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { stepIO.observe(s); });
    steps[0].classList.add('is-active');
  }

  // ---------- Menú: sólido al bajar, se esconde al bajar y vuelve al subir ----------
  var nav = $('#nav'), hero = $('.hero'), lastY = window.scrollY, ticking = false;
  var dock = $('.dock'), finalSec = $('.final'), finalTop = 0;
  function measure() { finalTop = finalSec.getBoundingClientRect().top + window.scrollY; }
  measure();
  window.addEventListener('load', measure);
  var plx = calm ? [] : $$('[data-parallax]');

  function onScroll() {
    var y = window.scrollY, vh = window.innerHeight;
    var past = y > 40;
    nav.classList.toggle('is-solid', past);
    nav.classList.toggle('is-hidden', y > vh * 0.9 && y > lastY + 2);
    if (y < lastY - 2 || y < vh * 0.9) nav.classList.remove('is-hidden');
    // El botón fijo sobra en la portada y en el cierre, que ya tienen el suyo
    dock.classList.toggle('is-visible', y > hero.offsetHeight * 0.75 && y + vh < finalTop + vh * 0.35);
    lastY = y;

    // Parallax discreto: la foto se desplaza un poco respecto a su marco
    plx.forEach(function (img) {
      var r = img.parentNode.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      var k = parseFloat(img.getAttribute('data-parallax')) || 0.06;
      var off = (r.top + r.height / 2 - vh / 2) * -k;
      img.style.translate = '0 ' + off.toFixed(1) + 'px';
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
  onScroll();
})();
