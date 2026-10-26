/*
 * Book Lab — aviso de «Fuera de horario» en la portada (index.html).
 * Si el barbero de config.js → horasExtra ha abierto citas fuera de horario, sale una franja dorada arriba
 * que lleva a la reserva con ese barbero. Si no hay nada abierto (o no hay motor), no sale nada.
 */
(function () {
  'use strict';
  var C = window.BOOKLAB_CONFIG;
  if (!C || !C.horasExtra) return;
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  if (!/^https:\/\//.test(URL_MOTOR) || URL_MOTOR.indexOf('PEGAR_') !== -1) return;

  var fmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
  function hoyMadrid() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function sumar(f, n) { var d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function cuando(f) { var h = hoyMadrid(); return f === h ? 'Hoy' : f === sumar(h, 1) ? 'Mañana' : fmt.format(new Date(f + 'T12:00:00Z')).replace(/^./, function (c) { return c.toUpperCase(); }); }

  fetch(URL_MOTOR + '?action=fueraHorario').then(function (r) { return r.json(); }).then(function (r) {
    if (!r || !r.dias || !r.dias.length) return;
    var d = r.dias[0];
    var a = document.createElement('a');
    a.className = 'fh-strip';
    a.href = 'reservar.html?fh=1';
    a.innerHTML = '<span class="fh-star" aria-hidden="true">★</span><b>Fuera de horario</b><span class="fh-sep" aria-hidden="true">·</span>' +
      '<span>' + cuando(d.f) + ' ' + r.nombre + ' abre a las ' + d.horas[0] + '</span><span class="fh-go">Reservar ›</span>';
    var css = document.createElement('style');
    css.textContent =
      '.fh-strip{position:fixed;top:0;left:0;right:0;z-index:90;display:flex;align-items:center;justify-content:center;gap:8px;min-height:36px;' +
      'padding:6px 14px calc(6px);padding-top:max(6px,env(safe-area-inset-top));background:linear-gradient(90deg,#d4a017,#ffd60a,#d4a017);background-size:200% 100%;' +
      'animation:fhBrillo 4s linear infinite;color:#111;font:600 13px/1.2 inherit;letter-spacing:.02em;text-decoration:none;text-align:center}' +
      '.fh-strip b{text-transform:uppercase;letter-spacing:.12em;font-size:11px}.fh-go{font-weight:800;text-decoration:underline;text-underline-offset:3px}' +
      '.fh-star{font-size:14px}@media(max-width:420px){.fh-sep{display:none}.fh-strip{flex-wrap:wrap;gap:2px 8px}}' +
      '@media(prefers-reduced-motion:reduce){.fh-strip{animation:none}}' +
      '@keyframes fhBrillo{0%{background-position:0 0}100%{background-position:200% 0}}';
    document.head.appendChild(css);
    document.body.insertBefore(a, document.body.firstChild);
    document.body.classList.add('has-fh');
    // El menú de arriba baja lo que mida la franja (en el móvil puede ocupar dos líneas)
    var nav = document.getElementById('nav');
    var colocar = function () { var h = a.offsetHeight + 'px'; if (nav) nav.style.top = h; document.body.style.paddingTop = h; };
    colocar();
    window.addEventListener('resize', colocar);
  }).catch(function () { /* sin aviso */ });
})();
