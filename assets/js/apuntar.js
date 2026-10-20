/*
 * Book Lab — Apuntar cliente (apuntar.html).
 * El barbero apunta a quien pide cita en persona: servicio, día y hora libre (o "Ahora"), y nombre
 * (teléfono y correo opcionales). La cita va a su Google Calendar y cuenta en el panel como "Mostrador".
 * Enlace de cada barbero, sin contraseña y sin publicar en la web: TU-WEB/panel-agenda-marcos.
 * También vale apuntar.html?b=marcos. Sin motor, o con ?demo=1 en getbooklab.com, modo simulación.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG;
  var R = C.reglas || {};
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  var EJEMPLO_PERMITIDO = !!(C.panel && C.panel.ejemplo);
  var SIN_MOTOR = !/^https:\/\//.test(URL_MOTOR) || URL_MOTOR.indexOf('PEGAR_') !== -1;
  var Q = new URLSearchParams(location.search);
  var DEMO = SIN_MOTOR || (EJEMPLO_PERMITIDO && Q.get('demo') === '1');
  var TIMEOUT_MS = 25000;

  var reales = C.barberos.filter(function (b) { return b.id !== 'any'; });
  // Barbero: de la dirección bonita (/panel-agenda-marcos) o de ?b=
  var B = Q.get('b') || '';
  var ruta = decodeURIComponent(location.pathname.split('/').pop() || '').match(/^panel-agenda-(.+)$/i);
  if (ruta) B = ruta[1].toLowerCase();
  if (!B && DEMO && reales[0]) B = reales[0].id;

  var S = { servicio: '', fecha: '', hora: '', ultima: null };   // hora: 'ahora' o HH:MM
  var hoy = '';

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
    (children || []).forEach(function (c) { if (c !== null && c !== undefined) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  var fWd = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' });
  var fMon = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
  var fLarga = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utc(f) { return new Date(f + 'T12:00:00Z'); }
  function addDays(f, n) { var d = utc(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function abierto(f) { return ((C.horario || {})[utc(f).getUTCDay() || 7] || []).length > 0; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function ahoraMadrid() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { fecha: p.year + '-' + p.month + '-' + p.day, hora: pad(+p.hour % 24) + ':' + p.minute };
  }
  function toMin(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function servicio(id) { return C.servicios.filter(function (s) { return s.id === id; })[0]; }
  function nombreBarbero(id) { var b = reales.filter(function (x) { return x.id === id; })[0]; return b ? b.nombre : ''; }
  function show(id) { ['#v-cargando', '#v-error', '#v-form', '#v-hecho'].forEach(function (v) { $(v).hidden = v !== id; }); }
  function cuandoTexto(fecha, hora) { return (fecha === hoy ? 'Hoy' : cap(fLarga.format(utc(fecha)).replace(',', ''))) + ' a las ' + hora; }

  // ---------- Red ----------
  function pedir(url, opts) {
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a internet. Revisa los datos o el wifi.'));
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    opts = opts || {};
    if (ctrl) opts.signal = ctrl.signal;
    opts.redirect = 'follow';
    return fetch(url, opts).then(function (r) { clearTimeout(timer); return r.text(); }, function (err) {
      clearTimeout(timer);
      throw new Error(err && err.name === 'AbortError' ? 'El sistema está tardando demasiado. Inténtalo de nuevo.' : 'No hemos podido conectar. Revisa tu conexión.');
    }).then(function (txt) {
      var d; try { d = JSON.parse(txt); } catch (e) { throw new Error('Respuesta inesperada. Inténtalo de nuevo.'); }
      if (d && d.error) { var er = new Error(d.error); er.code = d.code; throw er; }
      return d;
    });
  }
  function getInfo(extra) {
    if (DEMO) return demoInfo(extra);
    var q = '?action=mostrador&b=' + encodeURIComponent(B);
    if (extra) q += '&date=' + encodeURIComponent(extra.date) + '&service=' + encodeURIComponent(extra.service);
    return pedir(URL_MOTOR + q);
  }
  function post(body) {
    if (DEMO) return demoPost(body);
    body.b = B;
    return pedir(URL_MOTOR, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  }

  // ---------- Modo simulación ----------
  function demoInfo(extra) {
    var a = ahoraMadrid();
    var r = { ok: true, barbero: nombreBarbero(B), hoy: a.fecha, ahora: a.hora };
    if (extra) {
      var dia = utc(extra.date).getUTCDay() || 7, dur = servicio(extra.service).duracion, paso = R.intervaloMinutos || 30, out = [];
      (C.horario[dia] || []).forEach(function (w) {
        for (var t = toMin(w[0]); t + dur <= toMin(w[1]); t += paso) {
          if (extra.date === a.fecha && t < toMin(a.hora)) continue;
          if ((t * 7 + dia * 13) % 5 === 0) continue;                    // algunas horas "ocupadas"
          out.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60));
        }
      });
      r.slots = out;
    }
    return new Promise(function (res) { setTimeout(function () { res(r); }, 300); });
  }
  function demoPost(b) {
    return new Promise(function (res, rej) {
      setTimeout(function () {
        if (b.action === 'mostradorDeshacer') return res({ ok: true });
        var a = ahoraMadrid(), s = servicio(b.service);
        var fecha = b.time === 'ahora' ? a.fecha : b.date;
        var hora = b.time === 'ahora' ? (function (m) { m -= m % 5; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); })(toMin(a.hora)) : b.time;
        if (b.time === 'ahora' && !b.forzar && toMin(hora) % 60 < 30) {
          var er = new Error('Ya tienes otra cita de ' + hora.slice(0, 2) + ':00 a ' + hora.slice(0, 2) + ':30.'); er.code = 'SOLAPA'; return rej(er);
        }
        res({ ok: true, id: 'demo' + Date.now(), fecha: fecha, hora: hora, cuando: cuandoTexto(fecha, hora), servicio: s.nombre, precio: s.precio });
      }, 400);
    });
  }

  // ---------- Pintar ----------
  function pintarServicios() {
    var box = $('#servicios'); box.textContent = '';
    C.servicios.forEach(function (s) {
      box.appendChild(el('button', {
        type: 'button', class: 'ap-serv', 'aria-pressed': String(S.servicio === s.id),
        onclick: function () { S.servicio = s.id; S.hora = ''; pintarServicios(); errorFuera(); cargarHoras(); }
      }, [el('b', { text: s.nombre }), el('span', { text: eur.format(s.precio) })]));
    });
  }

  function pintarDias() {
    var box = $('#dias'); box.textContent = '';
    for (var i = 0, n = 0; i <= (R.diasMaximos || 60) && n < 10; i++) {
      var f = addDays(hoy, i);
      if (!abierto(f)) continue;
      n++;
      var u = utc(f), etiqueta = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fWd.format(u).replace('.', '');
      box.appendChild(el('button', {
        type: 'button', class: 'day', 'aria-pressed': String(S.fecha === f), 'data-date': f, 'aria-label': cap(fLarga.format(u)),
        onclick: (function (v) { return function () { elegirFecha(v); }; })(f)
      }, [el('small', { text: etiqueta }), el('b', { text: String(u.getUTCDate()) }), el('span', { text: fMon.format(u).replace('.', '') })]));
    }
  }

  function elegirFecha(f) {
    S.fecha = f; S.hora = '';
    $('#fecha').value = f;
    document.querySelectorAll('#dias .day').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-date') === f)); });
    errorFuera();
    cargarHoras();
  }

  var pedidoHoras = 0;
  function cargarHoras() {
    var box = $('#slots'), st = $('#slots-status');
    box.textContent = ''; st.classList.remove('is-error');
    if (!S.servicio) { st.textContent = 'Elige el servicio para ver las horas libres.'; return; }
    if (!S.fecha) { st.textContent = 'Elige el día.'; return; }
    st.textContent = 'Buscando horas libres…';
    var n = ++pedidoHoras;
    getInfo({ date: S.fecha, service: S.servicio }).then(function (r) {
      if (n !== pedidoHoras) return;
      var slots = r.slots || [];
      // Hoy: primera opción "Ahora" (para el que se sienta en el sillón en este momento)
      if (S.fecha === hoy) {
        box.appendChild(el('button', { type: 'button', class: 'slot ap-ahora', 'data-h': 'ahora', 'aria-pressed': String(S.hora === 'ahora'), onclick: function () { S.hora = 'ahora'; marcarHora(); } }, ['Ahora']));
      }
      slots.forEach(function (h) {
        box.appendChild(el('button', { type: 'button', class: 'slot', 'data-h': h, 'aria-pressed': String(S.hora === h), onclick: function () { S.hora = h; marcarHora(); } }, [h]));
      });
      st.textContent = slots.length ? '' : (S.fecha === hoy ? 'No quedan más horas libres hoy.' : 'No quedan horas libres ese día.');
    }).catch(function (err) { if (n === pedidoHoras) { st.textContent = err.message; st.classList.add('is-error'); } });
  }
  function marcarHora() { errorFuera(); document.querySelectorAll('#slots .slot').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-h') === S.hora)); }); }

  function errorFuera() { $('#ap-error').hidden = true; }
  function error(msg, foco) { var a = $('#ap-error'); a.textContent = msg; a.hidden = false; (foco || a).scrollIntoView({ block: 'center' }); if (foco) foco.focus(); }

  // ---------- Apuntar ----------
  function apuntar(forzar) {
    errorFuera(); $('#ap-msg').hidden = true;
    var nombre = $('#nombre').value.trim(), tel = $('#tel').value.trim(), email = $('#email').value.trim();
    if (!S.servicio) return error('Elige el servicio.', $('#servicios'));
    if (!S.hora) return error('Elige el día y la hora.', $('#dias'));
    if (!nombre) return error('Escribe el nombre del cliente.', $('#nombre'));
    if (tel && tel.replace(/\D/g, '').length < 9) return error('Revisa el teléfono: debe tener 9 cifras (o déjalo vacío).', $('#tel'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return error('Revisa el correo (o déjalo vacío).', $('#email'));
    var btn = $('#apuntar-btn');
    btn.disabled = true; btn.textContent = 'Apuntando…';
    post({
      action: 'mostrador', service: S.servicio, time: S.hora, date: S.hora === 'ahora' ? '' : S.fecha,
      name: nombre, phone: tel, email: email, forzar: !!forzar
    }).then(function (r) {
      S.ultima = r.id;
      $('#hecho-text').textContent = r.cuando + ' · ' + r.servicio + ' · ' + eur.format(r.precio) + ' · ' + nombre;
      $('#hecho-nota').textContent = 'Ya está en tu calendario y cuenta en la facturación.' + (email ? ' Le hemos mandado la confirmación a ' + email + '.' : '');
      show('#v-hecho'); $('#t-hecho').focus();
    }).catch(function (err) {
      if (err.code === 'SOLAPA') {
        if (confirm(err.message + '\n\n¿Apuntar igualmente?')) { btn.disabled = false; btn.textContent = 'Apuntar'; return apuntar(true); }
        return;
      }
      error(err.message);
    }).then(function () { btn.disabled = false; btn.textContent = 'Apuntar'; });
  }

  function reiniciar(mensaje) {
    S.servicio = ''; S.hora = ''; S.ultima = null;
    $('#nombre').value = ''; $('#tel').value = ''; $('#email').value = '';
    pintarServicios(); elegirFecha(S.fecha || hoy); errorFuera();
    var m = $('#ap-msg'); m.textContent = mensaje || ''; m.hidden = !mensaje;
    show('#v-form'); window.scrollTo(0, 0);
  }

  // ---------- Eventos ----------
  $('#fecha').addEventListener('change', function () { if (this.value) elegirFecha(this.value); });
  $('#apuntar-btn').addEventListener('click', function () { apuntar(false); });
  $('#otro').addEventListener('click', function () { reiniciar(''); });
  $('#deshacer').addEventListener('click', function () {
    var b = this;
    if (!S.ultima || !confirm('¿Borrar la cita que acabas de apuntar?')) return;
    b.disabled = true;
    post({ action: 'mostradorDeshacer', e: S.ultima })
      .then(function () { reiniciar('Cita borrada. Puedes apuntarla de nuevo.'); })
      .catch(function (err) { alert(err.message); })
      .then(function () { b.disabled = false; });
  });

  // ---------- Arranque ----------
  $('#ap-negocio').textContent = C.negocio.nombre;
  if (DEMO) {
    var n = $('#ap-demo');
    n.appendChild(el('strong', { text: 'Ejemplo. ' }));
    n.appendChild(document.createTextNode('Así apunta cada barbero a los clientes que piden cita en persona. En tu web, cada barbero tiene su enlace privado en la pantalla de inicio del móvil. '));
    // Para no quedarse atrapado en la demo: volver a la página de la que se viene
    var volver = './';
    try { var ref = document.referrer ? new URL(document.referrer) : null; if (ref && ref.origin === location.origin) volver = ref.pathname + ref.search; } catch (e) { /* sin referrer */ }
    n.appendChild(el('a', { href: volver, class: 'ap-volver', text: '← Volver' }));
    n.hidden = false;
  }
  if (!B) {
    $('#error-text').textContent = 'Falta el nombre del barbero en el enlace. Pide el tuyo al dueño de la barbería.';
    show('#v-error');
    return;
  }
  getInfo().then(function (r) {
    hoy = r.hoy;
    var input = $('#fecha'); input.min = hoy; input.max = addDays(hoy, R.diasMaximos || 60);
    $('#ap-barbero').textContent = r.barbero;
    document.title = 'Agenda · ' + r.barbero;
    pintarServicios(); pintarDias();
    var primero = $('#dias .day');
    elegirFecha(abierto(hoy) ? hoy : (primero ? primero.getAttribute('data-date') : hoy));
    show('#v-form');
  }).catch(function (err) {
    $('#error-text').textContent = err.message;
    show('#v-error');
  });
})();
