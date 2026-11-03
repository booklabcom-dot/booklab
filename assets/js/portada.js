/*
 * Demo de Book Lab · portada de «Navaja Barber Club» (demo.html).
 * Pinta con los datos de config.js: precios, extras, galería, quiénes somos, equipo, reseñas, horario y contacto.
 * Sin librerías. Si algo falta en config.js, esa parte simplemente no sale.
 */
(function () {
  'use strict';
  var C = window.BOOKLAB_CONFIG || {};
  var $ = function (s) { return document.getElementById(s); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  var eur = function (n) { return (Number(n) % 1 ? Number(n).toFixed(2).replace('.', ',') : String(n)) + ' €'; };
  var nota = String((C.resenas && C.resenas.nota) || '').replace('.', ',');

  // Nota de Google
  if (C.resenas) {
    $('nota').textContent = nota;
    $('n-resenas').textContent = C.resenas.total;
    $('nota-grande').textContent = '★ ' + nota;
  }

  // Precios (pizarra)
  (C.servicios || []).forEach(function (s) {
    var li = el('li');
    var fila = el('div', 'pizarra-fila');
    fila.appendChild(el('span', 'pizarra-nombre', s.nombre));
    fila.appendChild(el('span', 'pizarra-puntos'));
    fila.appendChild(el('span', 'pizarra-precio', eur(s.precio)));
    li.appendChild(fila);
    if (s.descripcion) li.appendChild(el('p', 'pizarra-desc', s.descripcion));
    $('pizarra').appendChild(li);
  });
  var extras = (C.extras || []).map(function (x) { return x.nombre + ' +' + eur(x.precio); });
  if (extras.length) $('extra-cejas').textContent = 'Extras: ' + extras.join(' · ') + '.';

  // Galería
  var fotos = (C.web && C.web.galeria) || [];
  fotos.forEach(function (src, i) {
    var f = el('figure', 'galeria-foto' + (i === 0 ? ' is-grande' : ''));
    var img = el('img'); img.src = src; img.alt = 'Corte hecho en la barbería'; img.loading = 'lazy'; img.width = 700; img.height = 700;
    f.appendChild(img); $('galeria').appendChild(f);
  });

  // Quiénes somos y valores
  ((C.web && C.web.quienesSomos) || []).forEach(function (t) { $('nosotros').appendChild(el('p', '', t)); });
  ((C.web && C.web.valores) || []).forEach(function (t) { $('valores').appendChild(el('li', '', t)); });

  // Equipo (sin fotos: nombre grande y su especialidad)
  (C.barberos || []).filter(function (b) { return b.id !== 'any'; }).forEach(function (b) {
    var li = el('li');
    li.appendChild(el('b', '', b.nombre));
    if (b.frase) li.appendChild(el('span', '', b.frase));
    $('barberos').appendChild(li);
  });

  // Reseñas
  ((C.resenas && C.resenas.lista) || []).forEach(function (r) {
    var q = el('blockquote', 'cita');
    q.appendChild(el('p', '', '«' + r.texto + '»'));
    q.appendChild(el('footer', '', r.nombre + ' · ' + r.cuando));
    $('citas').appendChild(q);
  });

  // Visítanos
  var N = C.negocio || {};
  $('direccion').textContent = N.direccion || '';
  if (N.telefono) $('telefono').textContent = 'Tel. ' + N.telefono;
  var dias = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var H = C.horarioWeb || C.horario || {};
  for (var d = 1; d <= 7; d++) {
    var tramos = H[d] || [];
    $('horario').appendChild(el('dt', '', dias[d]));
    $('horario').appendChild(el('dd', tramos.length ? '' : 'is-cerrado', tramos.length ? tramos.map(function (t) { return t[0] + '–' + t[1]; }).join(' · ') : 'Cerrado'));
  }

  // Bienvenida de la demo: una vez por visita (sessionStorage); si no hay almacenamiento, sale igual
  var bv = $('bienvenida'), visto = false;
  try { visto = sessionStorage.getItem('demo_bienvenida') === '1'; } catch (x) { visto = false; }
  if (bv && !visto) {
    bv.hidden = false;
    var cerrar = function () { bv.hidden = true; try { sessionStorage.setItem('demo_bienvenida', '1'); } catch (x) { /* nada */ } };
    $('bienvenida-cerrar').addEventListener('click', cerrar);
    bv.addEventListener('click', function (ev) { if (ev.target === bv) cerrar(); });
    bv.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', cerrar); });
  }

  // Cabecera con fondo al bajar
  var nav = $('nav');
  var alBajar = function () { nav.classList.toggle('is-fondo', window.scrollY > 40); };
  window.addEventListener('scroll', alBajar, { passive: true }); alBajar();

  // Aparición suave al entrar en pantalla (sin JS o con movimiento reducido, todo visible desde el principio)
  if ('IntersectionObserver' in window && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    document.documentElement.classList.add('anim');
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.sec .wrap > *').forEach(function (n) { io.observe(n); });
  }
})();
