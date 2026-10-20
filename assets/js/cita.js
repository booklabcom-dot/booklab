/*
 * Book Lab — Gestionar mi cita (cita.html).
 * El cliente llega desde el enlace de sus correos: cita.html?b=BARBERO&e=EVENTO&t=FIRMA
 * Puede cancelar (la cita se borra del calendario del barbero) o cambiar día y hora
 * (la cita se mueve), siempre que falten más de las horas que marca la política.
 * Sin motor configurado, o con ?demo=1, funciona en modo simulación.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG, N = C.negocio, R = C.reglas;
  var TZ = N.zonaHoraria || 'Europe/Madrid';
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1' || !/^https:\/\//.test(URL_MOTOR) || URL_MOTOR.indexOf('PEGAR_') !== -1;
  var ref = { b: params.get('b') || '', e: params.get('e') || '', t: params.get('t') || '' };
  var cita = null, nuevaFecha = '', nuevaHora = '', peticion = 0;

  // ---------- Utilidades ----------
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function toHHMM(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function utc(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function addDays(ymd, n) { var d = utc(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function wd(ymd) { return utc(ymd).getUTCDay() || 7; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var fLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  var fWd = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' });
  var fMon = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  function longDate(ymd) { return fLong.format(utc(ymd)).replace(',', ''); }
  function now() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: (+p.hour % 24) * 60 + +p.minute };
  }
  function isOpen(ymd) { var h = C.horario[wd(ymd)]; return !!(h && h.length); }
  function telHref() { return 'tel:' + String(N.telefono || '').replace(/[^\d+]/g, ''); }
  function waHref() { var d = String(N.telefono || '').replace(/\D/g, ''); if (d.length === 9) d = '34' + d; return 'https://wa.me/' + d; }

  function show(id) {
    ['#v-cargando', '#v-error', '#v-info', '#v-cambiar', '#v-cancelar', '#v-hecho'].forEach(function (v) { $(v).hidden = v !== id; });
    var t = $(id + ' .step-title');
    if (t) t.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ---------- Red ----------
  function pedir(url, opts) {
    opts = opts || {};
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (r) { clearTimeout(timer); return r.text(); }, function (err) {
      clearTimeout(timer);
      throw new Error(err && err.name === 'AbortError' ? 'El servidor está tardando demasiado. Inténtalo de nuevo en unos segundos.' : 'No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.');
    }).then(function (txt) {
      var data; try { data = JSON.parse(txt); } catch (e) { throw new Error('Respuesta inesperada. Inténtalo de nuevo.'); }
      if (data && data.error) { var er = new Error(data.error); er.code = data.code; throw er; }
      return data;
    });
  }
  function postMotor(cuerpo) {
    return pedir(URL_MOTOR, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) });
  }
  function q(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }

  // ---------- Modo simulación ----------
  function citaDemo() {
    var n = now(), f = n.date, i = 0;
    do { f = addDays(f, 1); i++; } while ((!isOpen(f) || i < 3) && i < 30);
    var s = C.servicios[0], b = C.barberos.filter(function (x) { return x.id !== 'any'; })[0];
    return {
      ok: true, barbero: b.nombre, barberId: b.id, servicio: s.nombre, servicioId: s.id, precio: s.precio, duracion: s.duracion,
      fecha: f, hora: '11:00', cuando: cap(longDate(f)) + ' a las 11:00', nombre: 'Cliente',
      pasada: false, puedeCancelar: true, puedeCambiar: true, cambios: 0, maxCambios: 2, limiteHoras: R.cancelacionHoras, telefono: N.telefono
    };
  }
  function slotsDemo(ymd) {
    var out = [], n = now();
    (C.horario[wd(ymd)] || []).forEach(function (w) {
      for (var t = toMin(w[0]); t + 30 <= toMin(w[1]); t += R.intervaloMinutos) {
        if (ymd === n.date && t < n.min + R.antelacionMinutos) continue;
        if ((t / 30 + Number(ymd.slice(-2))) % 3 === 0) continue; // huecos ocupados de ejemplo
        out.push(toHHMM(t));
      }
    });
    return new Promise(function (res) { setTimeout(function () { res({ slots: out }); }, 400); });
  }
  function esperar(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 700); }); }

  // ---------- Datos de la cita ----------
  function pintarCita() {
    var dl = $('#recap');
    dl.textContent = '';
    [['Servicio', cita.servicio], ['Barbero', cita.barbero], ['Día', cap(longDate(cita.fecha))], ['Hora', cita.hora],
      ['Duración', cita.duracion + ' min'], ['Precio', cita.precio !== '' ? money.format(cita.precio) : '—']]
      .forEach(function (r) { dl.appendChild(el('div', null, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])); });

    var note = $('#info-note'), acciones = $('#info-actions'), contacto = $('#info-contact');
    $('#contact-call').href = telHref();
    $('#contact-wa').href = waHref();
    if (cita.pasada) {
      note.textContent = 'Esta cita ya ha pasado.';
      acciones.hidden = true; contacto.hidden = true;
    } else if (!cita.puedeCancelar) {
      note.textContent = 'Faltan menos de ' + cita.limiteHoras + ' horas para tu cita, así que ya no se puede cancelar ni cambiar online. Llámanos o escríbenos y lo vemos.';
      acciones.hidden = true; contacto.hidden = false;
    } else {
      acciones.hidden = false; contacto.hidden = true;
      $('#go-cambiar').hidden = !cita.puedeCambiar;
      note.textContent = cita.puedeCambiar
        ? 'Puedes cancelarla o cambiarla hasta ' + cita.limiteHoras + ' horas antes.' + (cita.cambios ? ' Cambios usados: ' + cita.cambios + ' de ' + cita.maxCambios + '.' : '')
        : 'Ya has cambiado esta cita ' + cita.maxCambios + ' veces. Aún puedes cancelarla o llamarnos.';
    }
    $('#cancelar-text').textContent = 'Vas a cancelar tu cita del ' + longDate(cita.fecha) + ' a las ' + cita.hora + ' con ' + cita.barbero +
      '. El hueco quedará libre para otro cliente. Esta acción no se puede deshacer.';
  }

  function cargar() {
    if (DEMO) {
      var n = $('#notice');
      n.textContent = '';
      n.appendChild(el('strong', { text: 'Modo simulación. ' }));
      n.appendChild(document.createTextNode('Cita de ejemplo: no se cancela ni se cambia nada de verdad.'));
      n.hidden = false;
      cita = citaDemo(); pintarCita(); show('#v-info'); return;
    }
    if (!ref.b || !ref.e || !ref.t) { mostrarError('Este enlace está incompleto. Abre el último correo de tu cita y pulsa «Gestionar mi cita».'); return; }
    pedir(URL_MOTOR + '?' + q({ action: 'cita', b: ref.b, e: ref.e, t: ref.t })).then(function (data) {
      cita = data; pintarCita(); show('#v-info');
    }).catch(function (err) { mostrarError(err.message); });
  }

  function mostrarError(msg) {
    $('#error-text').textContent = msg;
    $('#error-call').href = telHref();
    show('#v-error');
  }

  // ---------- Cambiar ----------
  function abrirCambiar() {
    nuevaFecha = ''; nuevaHora = '';
    $('#cambiar-error').hidden = true;
    $('#cambiar-note').textContent = 'Tu cita actual: ' + longDate(cita.fecha) + ' a las ' + cita.hora + ' con ' + cita.barbero + '. Se mantiene el mismo servicio y barbero.';
    var hoy = now().date, input = $('#date');
    input.min = hoy; input.max = addDays(hoy, R.diasMaximos);
    var box = $('#quick-days'); box.textContent = '';
    for (var i = 0, n = 0; i <= R.diasMaximos && n < 10; i++) {
      var f = addDays(hoy, i);
      if (!isOpen(f)) continue;
      n++;
      var u = utc(f), etiqueta = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fWd.format(u).replace('.', '');
      box.appendChild(el('button', {
        type: 'button', class: 'day', 'aria-pressed': 'false', 'data-date': f, 'aria-label': cap(longDate(f)),
        onclick: (function (v) { return function () { elegirFecha(v); }; })(f)
      }, [el('small', { text: etiqueta }), el('b', { text: String(u.getUTCDate()) }), el('span', { text: fMon.format(u).replace('.', '') })]));
    }
    $('#slots').textContent = ''; $('#slots-status').textContent = '';
    actualizarBoton();
    show('#v-cambiar');
    var primero = box.querySelector('.day');
    if (primero) elegirFecha(cita.fecha >= hoy && isOpen(cita.fecha) ? cita.fecha : primero.getAttribute('data-date'));
  }

  function elegirFecha(f) {
    nuevaFecha = f; nuevaHora = '';
    $('#date').value = f;
    document.querySelectorAll('#quick-days .day').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-date') === f)); });
    cargarHoras();
    actualizarBoton();
  }

  function cargarHoras() {
    var box = $('#slots'), st = $('#slots-status'), id = ++peticion, f = nuevaFecha;
    box.textContent = ''; st.classList.remove('is-error');
    if (!isOpen(f)) { st.textContent = 'Ese día estamos cerrados. Elige otro, por favor.'; st.classList.add('is-error'); return; }
    st.textContent = 'Buscando horas libres…';
    var prom = DEMO ? slotsDemo(f) : pedir(URL_MOTOR + '?' + q({ action: 'slots', date: f, service: cita.servicioId, barber: cita.barberId, e: ref.e, t: ref.t }));
    prom.then(function (data) {
      if (id !== peticion) return;
      var slots = (data.slots || []).filter(function (h) { return !(f === cita.fecha && h === cita.hora); });
      if (!slots.length) { st.textContent = 'No quedan horas libres con ' + cita.barbero + ' ese día. Prueba otro.'; return; }
      st.textContent = slots.length + (slots.length === 1 ? ' hora libre' : ' horas libres') + ' el ' + longDate(f) + '.';
      [['Mañana', slots.filter(function (h) { return h < '14:00'; })], ['Tarde', slots.filter(function (h) { return h >= '14:00'; })]].forEach(function (g) {
        if (!g[1].length) return;
        var grid = el('div', { class: 'slot-grid', role: 'group', 'aria-label': g[0] });
        g[1].forEach(function (h) {
          grid.appendChild(el('button', { type: 'button', class: 'slot', 'aria-pressed': 'false', 'data-time': h, onclick: function () { elegirHora(h); } }, [h]));
        });
        box.appendChild(el('div', { class: 'slot-group' }, [el('h3', { text: g[0] }), grid]));
      });
    }).catch(function (err) {
      if (id !== peticion) return;
      st.textContent = err.message; st.classList.add('is-error');
    });
  }

  function elegirHora(h) {
    nuevaHora = h;
    document.querySelectorAll('#slots .slot').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-time') === h)); });
    actualizarBoton();
  }

  function actualizarBoton() { $('#confirmar-cambio').disabled = !(nuevaFecha && nuevaHora); }

  function ocupado(btn, texto) {
    btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = '';
    btn.appendChild(el('span', { class: 'spinner', 'aria-hidden': 'true' })); btn.appendChild(document.createTextNode(texto));
  }
  function libre(btn) { btn.disabled = false; btn.textContent = btn.dataset.txt; }

  function gcalLink(fecha, hora) {
    var s = toMin(hora), e = s + (cita.duracion || 30), d = fecha.replace(/-/g, '');
    var f = function (m) { return d + 'T' + pad(Math.floor(m / 60)) + pad(m % 60) + '00'; };
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(cita.servicio + ' · ' + N.nombre) +
      '&dates=' + f(s) + '/' + f(e) + '&ctz=' + encodeURIComponent(TZ) + '&location=' + encodeURIComponent(N.direccion || N.nombre);
  }

  function confirmarCambio() {
    var btn = $('#confirmar-cambio'), errBox = $('#cambiar-error');
    errBox.hidden = true;
    ocupado(btn, 'Cambiando…');
    var prom = DEMO ? esperar({ ok: true }) : postMotor({ action: 'cambiar', b: ref.b, e: ref.e, t: ref.t, date: nuevaFecha, time: nuevaHora });
    prom.then(function () {
      cita.fecha = nuevaFecha; cita.hora = nuevaHora; cita.cambios++;
      cita.puedeCambiar = cita.cambios < cita.maxCambios;
      $('#t-hecho').textContent = '¡Cita cambiada!';
      $('#hecho-text').textContent = 'Tu nueva cita es el ' + longDate(nuevaFecha) + ' a las ' + nuevaHora + ' con ' + cita.barbero + '.' +
        (DEMO ? ' (Simulación: no se ha cambiado nada de verdad.)' : ' Te hemos enviado un correo con los nuevos datos.');
      $('#hecho-gcal').href = gcalLink(nuevaFecha, nuevaHora);
      $('#hecho-gcal').hidden = false; $('#hecho-reservar').hidden = true;
      show('#v-hecho');
    }).catch(function (err) {
      errBox.textContent = err.message; errBox.hidden = false;
      if (err.code === 'SLOT_TAKEN') cargarHoras();
    }).then(function () { libre(btn); actualizarBoton(); });
  }

  // ---------- Cancelar ----------
  function confirmarCancelar() {
    var btn = $('#confirmar-cancelar'), errBox = $('#cancelar-error');
    errBox.hidden = true;
    ocupado(btn, 'Cancelando…');
    var prom = DEMO ? esperar({ ok: true }) : postMotor({ action: 'cancelar', b: ref.b, e: ref.e, t: ref.t });
    prom.then(function () {
      $('#t-hecho').textContent = 'Cita cancelada';
      $('#hecho-text').textContent = 'Tu cita del ' + longDate(cita.fecha) + ' a las ' + cita.hora + ' está cancelada y el hueco ya está libre.' +
        (DEMO ? ' (Simulación: no se ha cancelado nada de verdad.)' : ' Te hemos enviado un correo de confirmación. ¡Esperamos verte pronto!');
      $('#hecho-gcal').hidden = true; $('#hecho-reservar').hidden = false;
      show('#v-hecho');
    }).catch(function (err) {
      errBox.textContent = err.message; errBox.hidden = false;
      libre(btn);
    });
  }

  // ---------- Inicio ----------
  var nameEl = $('#shop-name');
  if (N.esMarcador) nameEl.appendChild(el('span', { class: 'ph', text: '“' + N.nombre + '”' }));
  else nameEl.textContent = N.nombre;
  document.title = 'Gestionar mi cita · ' + N.nombre;

  $('#go-cambiar').addEventListener('click', abrirCambiar);
  $('#go-cancelar').addEventListener('click', function () { $('#cancelar-error').hidden = true; show('#v-cancelar'); });
  $('#confirmar-cambio').addEventListener('click', confirmarCambio);
  $('#confirmar-cancelar').addEventListener('click', confirmarCancelar);
  $('#date').addEventListener('change', function () { if (this.value) elegirFecha(this.value); });
  document.querySelectorAll('[data-volver]').forEach(function (b) { b.addEventListener('click', function () { pintarCita(); show('#v-info'); }); });

  cargar();
})();
