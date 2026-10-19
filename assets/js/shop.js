/*
 * Book Lab — página de la barbería (demo.html).
 * Pinta todo a partir de config.js (window.BOOKLAB_CONFIG).
 * No hace falta tocar este archivo para adaptar la web a otra barbería.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG, N = C.negocio, W = C.web || {};
  var DAYS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // Foto o, si no hay ruta, un hueco que dice "Tu foto aquí"
  function photo(src, alt, opts) {
    opts = opts || {};
    if (src) return el('img', { src: src, alt: alt || '', loading: opts.eager ? 'eager' : 'lazy', decoding: 'async' });
    return el('div', { class: 'ph-photo', role: 'img', 'aria-label': 'Hueco para foto' }, [el('span', { text: opts.label || 'Tu foto aquí' })]);
  }

  function shopName() {
    return N.esMarcador ? el('span', { class: 'ph', text: '“' + N.nombre + '”' }) : document.createTextNode(N.nombre);
  }

  // Nombre, textos y botones
  $('#shop-name').appendChild(shopName());
  $('#nav-name').textContent = N.nombre;
  $('#footer-name').textContent = '© ' + new Date().getFullYear() + ' ' + N.nombre;
  $('#shop-sub').textContent = C.textos.subtitulo;
  $('#tagline').textContent = N.eslogan || '';
  $('#hero-address').textContent = N.direccion;
  document.title = N.nombre + ' · Reserva tu cita';
  document.querySelectorAll('[data-cta]').forEach(function (a) { a.textContent = C.textos.botonCita; });

  // Portada
  var hero = $('#hero-media');
  hero.appendChild(photo(W.portada, '', { eager: true, label: 'Foto de portada' }));
  var heroImg = hero.querySelector('img');
  if (heroImg) heroImg.setAttribute('fetchpriority', 'high');

  // Precios
  var list = $('#price-list');
  C.servicios.forEach(function (s) {
    list.appendChild(el('li', null, [
      el('div', null, [
        el('h3', { text: s.nombre }),
        el('p', { text: s.descripcion }),
        el('small', { text: s.duracion + ' min' })
      ]),
      el('span', { class: 'price', text: money.format(s.precio) })
    ]));
  });

  // Reseñas de Google
  var R = C.resenas;
  if (R) {
    var gUrl = R.enlace || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(N.nombre + ' ' + N.direccion);
    var nota = String(R.nota).replace('.', ',');
    var stars = function (n) { return '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n)); };
    var ratingLabel = 'Valoración ' + nota + ' de 5 en Google, ' + R.total + ' reseñas. Ver reseñas';

    var hr = $('#hero-rating');
    hr.href = gUrl;
    hr.setAttribute('aria-label', ratingLabel);
    hr.appendChild(el('span', { class: 'stars', 'aria-hidden': 'true', text: stars(R.nota) }));
    hr.appendChild(el('b', { text: nota }));
    hr.appendChild(el('span', { text: '· ' + R.total + ' reseñas en Google' }));

    var gs = $('#g-summary');
    gs.href = gUrl;
    gs.setAttribute('aria-label', ratingLabel);
    gs.appendChild(el('b', { class: 'g-score', text: nota }));
    gs.appendChild(el('span', null, [
      el('span', { class: 'stars', 'aria-hidden': 'true', text: stars(R.nota) }),
      el('small', { text: R.total + ' reseñas en Google · Ver todas →' })
    ]));

    R.lista.forEach(function (r) {
      $('#reviews').appendChild(el('li', null, [
        el('span', { class: 'stars', role: 'img', 'aria-label': r.estrellas + ' de 5 estrellas', text: stars(r.estrellas) }),
        el('blockquote', { text: '«' + r.texto + '»' }),
        el('p', { class: 'review-by', text: r.nombre + ' · ' + r.cuando })
      ]));
    });
    if (R.ejemplo) $('#reviews-note').textContent = 'Reseñas de ejemplo para la demo.';
  } else {
    $('#resenas').hidden = true;
  }

  // Quiénes somos
  $('#nosotros-title').textContent = W.tituloNosotros || 'Quiénes somos';
  (W.quienesSomos || []).forEach(function (p) { $('#about-text').appendChild(el('p', { text: p })); });
  (W.valores || []).forEach(function (v) { $('#values').appendChild(el('li', { text: v })); });
  var fotosLocal = W.fotosLocal || [W.fotoLocal || ''];
  fotosLocal.forEach(function (src, i) {
    $('#about-photo').appendChild(photo(src, 'El local de ' + N.nombre + (fotosLocal.length > 1 ? ' (' + (i + 1) + ')' : ''), { label: 'Foto del local' }));
  });

  // Equipo
  C.barberos.filter(function (b) { return b.id !== 'any'; }).forEach(function (b) {
    var avatar = b.foto
      ? el('img', { class: 'team-photo', src: b.foto, alt: b.nombre, loading: 'lazy' })
      : el('span', { class: 'team-initial', 'aria-hidden': 'true', text: b.nombre.charAt(0) });
    $('#team').appendChild(el('li', null, [avatar, el('div', null, [el('h3', { text: b.nombre }), el('p', { text: b.frase })])]));
  });

  // Galería
  (W.galeria || []).forEach(function (src, i) {
    $('#gallery').appendChild(photo(src, 'Trabajo de ' + N.nombre + ' (' + (i + 1) + ')'));
  });

  // Instagram
  var igUrl = N.instagram ? 'https://www.instagram.com/' + encodeURIComponent(N.instagram) + '/' : '';
  if (igUrl) {
    $('#ig-line').appendChild(document.createTextNode('Más en Instagram: '));
    $('#ig-line').appendChild(el('a', { href: igUrl, target: '_blank', rel: 'noopener', text: '@' + N.instagram }));
  }

  // Horario (resalta hoy)
  var todayIso = (function () {
    var wd = new Intl.DateTimeFormat('en-GB', { timeZone: N.zonaHoraria || 'Europe/Madrid', weekday: 'short' }).format(new Date());
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd) + 1;
  })();
  for (var d = 1; d <= 7; d++) {
    var tramos = C.horario[d] || [];
    var txt = tramos.length ? tramos.map(function (t) { return t[0] + ' – ' + t[1]; }).join(' · ') : 'Cerrado';
    var row = el('div', { class: (d === todayIso ? 'is-today ' : '') + (tramos.length ? '' : 'is-closed') }, [
      el('dt', { text: DAYS[d] + (d === todayIso ? ' (hoy)' : '') }), el('dd', { text: txt })
    ]);
    $('#hours').appendChild(row);
  }

  // Ubicación y contacto
  $('#visit-address').textContent = N.direccion;
  var mapUrl = N.mapa || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(N.direccion);
  var links = $('#visit-links');
  links.appendChild(el('a', { class: 'btn btn-ghost', href: mapUrl, target: '_blank', rel: 'noopener', text: 'Cómo llegar' }));
  if (N.telefono) links.appendChild(el('a', { class: 'btn btn-ghost', href: 'tel:' + N.telefono.replace(/[^\d+]/g, ''), text: 'Llamar · ' + N.telefono }));
  if (igUrl) links.appendChild(el('a', { class: 'btn btn-ghost', href: igUrl, target: '_blank', rel: 'noopener', text: 'Instagram · @' + N.instagram }));

  // Botón fijo de abajo: aparece cuando el de la portada ya no se ve
  var bar = $('.book-bar'), heroCta = $('.s-hero [data-cta]');
  if ('IntersectionObserver' in window && heroCta) {
    new IntersectionObserver(function (entries) {
      bar.classList.toggle('is-visible', !entries[0].isIntersecting);
    }).observe(heroCta);
  } else {
    bar.classList.add('is-visible');
  }
})();
