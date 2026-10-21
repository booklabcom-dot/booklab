/* Book Lab — capa editorial de la demo (demo.html). Se ejecuta después de shop.js.
   Solo añade detalles visuales a partir de config.js; no cambia datos ni la reserva.
   Todo es progresivo: sin este archivo, o con «movimiento reducido», la página se ve completa. */
(function () {
  'use strict';
  window.__dx = 1;
  var C = window.BOOKLAB_CONFIG || {}, N = C.negocio || {}, W = C.web || {};
  var root = document.documentElement;
  var $ = function (s) { return document.querySelector(s); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var anim = root.classList.contains('anim');
  var tz = N.zonaHoraria || 'Europe/Madrid';

  /* ---------- Datos de la fila técnica del hero ---------- */
  // Ciudad: lo que va detrás del código postal en la dirección («Calle Ejemplo 1, 28001 Madrid» → Madrid)
  var city = (String(N.direccion || '').split(',').pop() || '').replace(/\d{5}/, '').trim();
  if (city && $('#dx-city')) $('#dx-city').textContent = 'Barbería · ' + city;

  function ahora() {
    var p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return { dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(o.weekday) + 1, hm: o.hour + ':' + o.minute };
  }
  function pintarHora() {
    var a = ahora(), clock = $('#dx-clock'), open = $('#dx-open');
    if (clock) clock.textContent = a.hm;
    if (!open || !C.horario) return;
    var tramos = C.horario[a.dia] || [], abierto = null;
    tramos.forEach(function (t) { if (a.hm >= t[0] && a.hm < t[1]) abierto = t; });
    open.classList.toggle('is-open', !!abierto);
    open.querySelector('em').textContent = abierto ? 'Abierto hasta las ' + abierto[1] : (tramos.length && a.hm < tramos[0][0] ? 'Abre hoy a las ' + tramos[0][0] : 'Cerrado ahora');
  }
  pintarHora(); setInterval(pintarHora, 30000);

  /* ---------- Segunda foto del hero y contadores ---------- */
  var gal = W.galeria || [];
  var picB = $('#dx-hero-pic-b');
  if (picB) {
    if (gal[0]) {
      var im = document.createElement('img');
      im.src = gal[0]; im.alt = ''; im.decoding = 'async'; im.width = 700; im.height = 700;
      picB.insertBefore(im, picB.firstChild);
    } else picB.hidden = true;
  }
  var nServ = (C.servicios || []).length, nFotos = gal.length;
  if ($('#dx-count-serv') && nServ) $('#dx-count-serv').textContent = '(' + pad(nServ) + ')';
  if ($('#dx-count-fotos') && nFotos) $('#dx-count-fotos').textContent = '(+' + pad(nFotos) + ')';

  // Cifras grandes de la sección de reseñas: solo datos que ya están en config.js
  var R = C.resenas, stats = $('#dx-stats');
  if (stats && R) {
    var nBarberos = (C.barberos || []).filter(function (b) { return b.id !== 'any'; }).length;
    [
      { n: R.nota, dec: 1, suf: '★', t: 'Nota en Google' },
      { n: R.total, dec: 0, suf: '+', t: 'Reseñas' },
      { n: nBarberos, dec: 0, suf: '', t: nBarberos === 1 ? 'Barbero' : 'Barberos' }
    ].forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'dx-stat';
      d.innerHTML = '<small>(' + pad(i + 1) + ')</small><b><span data-count="' + s.n + '" data-dec="' + s.dec + '">' + fmt(s.n, s.dec) + '</span><em>' + s.suf + '</em></b><span>' + s.t + '</span>';
      stats.appendChild(d);
    });
    if (R.ejemplo) { var ej = document.createElement('p'); ej.className = 'dx-stats-note'; ej.textContent = 'Datos de ejemplo de la demo'; stats.appendChild(ej); }
  }
  function fmt(n, dec) { return Number(n).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }

  // El título de «Quiénes somos» llega de config.js: se parte en líneas para el revelado
  var nt = $('#nosotros-title');
  if (nt && nt.textContent && !nt.querySelector('.dx-line')) {
    var frases = nt.textContent.replace(/\.\s+/g, '.|').split('|');
    nt.textContent = '';
    frases.forEach(function (f, i) {
      var l = document.createElement('span'); l.className = 'dx-line';
      var inn = document.createElement('span'); inn.className = 'dx-line-in' + (i === frases.length - 1 && frases.length > 1 ? ' dx-y-ink' : '');
      inn.textContent = f; l.appendChild(inn); nt.appendChild(l); nt.appendChild(document.createTextNode(' '));
    });
  }

  if (!anim) return;

  /* ---------- Revelados al entrar en pantalla ---------- */
  document.querySelectorAll('[data-stagger]').forEach(function (g) {
    Array.prototype.forEach.call(g.children, function (el, i) { el.style.setProperty('--i', Math.min(i, 8)); });
  });
  var targets = document.querySelectorAll('[data-reveal], [data-stagger], .dx-h, .dx-final .cta, .dx-stats');
  var countDone = false;
  function contar() {
    if (countDone) return; countDone = true;
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var fin = parseFloat(el.getAttribute('data-count')), dec = +el.getAttribute('data-dec'), t0 = null, dur = 1400;
      function paso(t) {
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        el.textContent = fmt(fin * e, dec);
        if (k < 1) requestAnimationFrame(paso);
      }
      requestAnimationFrame(paso);
    });
  }
  if (!('IntersectionObserver' in window)) { targets.forEach(function (el) { el.classList.add('is-in'); }); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      if (e.target.id === 'dx-stats') contar();
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
  targets.forEach(function (el) { io.observe(el); });
  window.addEventListener('beforeprint', function () { targets.forEach(function (el) { el.classList.add('is-in'); }); });

  /* ---------- Solo escritorio con ratón: cursor y vista previa de servicios ---------- */
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  var cur = $('#dx-cursor'), prev = $('#dx-preview');
  var x = -100, y = -100, cx = -100, cy = -100, raf = 0;
  function loop() {
    cx += (x - cx) * 0.22; cy += (y - cy) * 0.22;
    if (cur) cur.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)';
    if (prev && prev.classList.contains('is-on')) prev.style.transform = 'translate3d(' + (cx + 28) + 'px,' + (cy - 90) + 'px,0)';
    raf = (Math.abs(x - cx) + Math.abs(y - cy) > 0.3) ? requestAnimationFrame(loop) : 0;
  }
  document.addEventListener('pointermove', function (e) {
    x = e.clientX; y = e.clientY;
    if (cur) {
      cur.classList.add('is-on');
      var t = e.target.closest ? e.target.closest('a, button, .dx-pic, input, select, textarea, label') : null;
      cur.classList.toggle('is-link', !!t && !/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
      cur.classList.toggle('is-hidden', !!t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
    }
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  document.addEventListener('pointerleave', function () { if (cur) cur.classList.remove('is-on'); });

  // Vista previa: al pasar por cada servicio aparece una foto de la galería
  var rows = document.querySelectorAll('#price-list li');
  if (prev && gal.length) {
    rows.forEach(function (li, i) {
      li.addEventListener('pointerenter', function () {
        prev.style.backgroundImage = 'url("' + gal[i % gal.length] + '")';
        prev.classList.add('is-on');
      });
      li.addEventListener('pointerleave', function () { prev.classList.remove('is-on'); });
    });
  }
})();
