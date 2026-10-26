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
  function show(id) { ['#v-cargando', '#v-error', '#v-form', '#v-hecho', '#v-pin', '#v-citas', '#v-act', '#v-extra'].forEach(function (v) { $(v).hidden = v !== id; }); }
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
        if (b.action === 'pin') return b.pin === '1234' ? res({ ok: true }) : rej(Object.assign(new Error('PIN incorrecto.'), { code: 'PIN' }));
        if (b.action === 'misCitas') { var dc = demoCitas(); dc.espera = {}; dc.espera[addDays(dc.hoy, 1)] = 2; return res(dc); }
        if (b.action === 'horasExtra') return res(demoExtra());
        if (b.action === 'horasExtraGuardar') { DEMO_EXTRA = b.abiertas; return res({ ok: true, nuevas: 1, avisados: 2 }); }
        if (b.action === 'actividad') return res(demoActividad());
        if (b.action === 'cancelarBarberia') { DEMO_CITAS = DEMO_CITAS.filter(function (c) { return c.id !== b.e; }); return res({ ok: true, avisado: !!b.avisar }); }
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
        onclick: function () { S.servicio = s.id; S.hora = ''; pintarServicios(); errorFuera(); cargarHoras(); cargarColores(); }
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
      }, [el('small', { text: etiqueta }), el('b', { text: String(u.getUTCDate()) }), el('span', { text: fMon.format(u).replace('.', '') }), el('i', { class: 'lvl', 'aria-hidden': 'true' })]));
    }
    cargarColores();
  }

  // ---------- Colores de los días: verde = bastantes horas libres, amarillo = pocas, rojo = completo ----------
  var colores = {};   // servicio → { 'AAAA-MM-DD': { libres, total } }
  function nivel(info) {
    if (!info || info.cerrado || !info.total) return '';
    if (!info.libres) return 'rojo';
    if (info.libres <= 3 || info.libres / info.total <= 0.25) return 'amarillo';
    return 'verde';
  }
  function pintarColores() {
    var c = colores[S.servicio || C.servicios[0].id] || {};
    document.querySelectorAll('#dias .day').forEach(function (b) {
      var f = b.getAttribute('data-date'), info = c[f], lvl = nivel(info);
      b.classList.remove('lvl-verde', 'lvl-amarillo', 'lvl-rojo');
      if (lvl) b.classList.add('lvl-' + lvl);
      if (info) b.setAttribute('aria-label', cap(fLarga.format(utc(f))) + (info.libres ? ' · ' + info.libres + (info.libres === 1 ? ' hora libre' : ' horas libres') : ' · completo'));
      b.title = info ? (info.libres ? info.libres + (info.libres === 1 ? ' hora libre' : ' horas libres') : 'Completo') : '';
    });
  }
  function cargarColores() {
    var srv = S.servicio || C.servicios[0].id;
    if (colores[srv]) { pintarColores(); return; }
    var pedido = DEMO ? Promise.resolve({ dias: demoColores() })
      : pedir(URL_MOTOR + '?action=dias&from=' + encodeURIComponent(hoy) + '&n=16&service=' + encodeURIComponent(srv) + '&barber=' + encodeURIComponent(B));
    pedido.then(function (r) { colores[srv] = (r && r.dias) || {}; if ((S.servicio || C.servicios[0].id) === srv) pintarColores(); })
      .catch(function () { /* sin colores se puede seguir apuntando */ });
  }
  function demoColores() {
    var out = {};
    for (var i = 0; i < 16; i++) {
      var f = addDays(hoy, i);
      out[f] = abierto(f) ? { libres: [0, 2, 9, 14, 1, 11, 0, 6][i % 8], total: 24 } : { libres: 0, total: 0, cerrado: true };
    }
    return out;
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

  // ---------- Pestañas: Apuntar · Mis citas · Mi actividad ----------
  // «Mis citas» y «Mi actividad» piden el PIN de 4 cifras del barbero (una vez: queda guardado en su móvil).
  // Aquí no hay importes ni botones de llamar o WhatsApp: el barbero ve los datos, pero contacta la barbería.
  var PIN_LS = 'booklab_pin_' + B;
  var T = { tab: 'apuntar', pendiente: '', apuntar: '#v-form' };
  function leerPin() { try { return localStorage.getItem(PIN_LS) || ''; } catch (e) { return ''; } }
  function guardarPin(v) { try { if (v) localStorage.setItem(PIN_LS, v); else localStorage.removeItem(PIN_LS); } catch (e) { /* sin almacenamiento */ } }

  function irA(tab) {
    if (T.tab === 'apuntar') T.apuntar = $('#v-hecho').hidden ? '#v-form' : '#v-hecho';
    T.tab = tab;
    document.querySelectorAll('#ap-tabs [data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    if (tab === 'apuntar') { show(T.apuntar); return; }
    if (!leerPin()) { T.pendiente = tab; pedirPin(''); return; }
    if (tab === 'citas') cargarCitas(); else if (tab === 'extra') cargarExtra(); else cargarActividad();
  }
  function pedirPin(msg) {
    $('#pin').value = '';
    var e = $('#pin-error'); e.textContent = msg; e.hidden = !msg;
    show('#v-pin'); $('#pin').focus();
  }
  // Si el motor dice que el PIN no vale (o lo han cambiado), se vuelve a pedir
  function errorPin(err, box) {
    if (err.code === 'PIN') { guardarPin(''); T.pendiente = T.tab; pedirPin('Tu PIN ha cambiado o no es correcto. Escríbelo de nuevo.'); return; }
    box.textContent = '';
    box.appendChild(el('p', { class: 'alert', text: err.message }));
  }

  // ---------- Mis citas ----------
  var fDia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function cargarCitas(msg) {
    var box = $('#citas'), m = $('#citas-msg');
    m.textContent = msg || ''; m.hidden = !msg;
    show('#v-citas');
    if (!box.childNodes.length) box.appendChild(el('p', { class: 'slots-status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cargando tus citas…']));
    post({ action: 'misCitas', pin: leerPin(), dias: 8 }).then(function (r) { pintarCitas(r); }).catch(function (err) { errorPin(err, box); });
  }
  function pintarCitas(r) {
    var box = $('#citas'); box.textContent = '';
    if (!r.citas.length) { box.appendChild(el('p', { class: 'g-note', text: 'No tienes citas reservadas en los próximos 8 días.' })); return; }
    var porDia = {};
    r.citas.forEach(function (c) { (porDia[c.f] = porDia[c.f] || []).push(c); });
    Object.keys(porDia).sort().forEach(function (f) {
      var cs = porDia[f], quedan = cs.filter(function (c) { return !c.pasada; }).length;
      var titulo = f === r.hoy ? 'Hoy' : f === addDays(r.hoy, 1) ? 'Mañana' : cap(fDia.format(utc(f)).replace(',', ''));
      var esp = (r.espera || {})[f] || 0;
      box.appendChild(el('h2', { class: 'ap-dia' }, [titulo, el('small', { text: cs.length + (cs.length === 1 ? ' cita' : ' citas') + (f === r.hoy && quedan !== cs.length ? ' · quedan ' + quedan : '') }),
        esp ? el('small', { class: 'ap-espera', text: '· ' + esp + ' en lista de espera' }) : null]));
      var ul = el('ul', { class: 'p-agenda ap-citas' });
      cs.forEach(function (c) {
        ul.appendChild(el('li', { class: c.pasada ? 'is-pasada' : '' }, [
          el('span', { class: 'p-ag-h', text: c.h }),
          el('div', { class: 'p-ag-d' }, [
            el('b', { text: c.cliente || 'Cliente' }),
            el('small', null, [c.origen === 'mostrador' ? el('span', { class: 'p-mostrador', text: 'Mostrador' }) : null,
              c.extra ? el('span', { class: 'p-mostrador p-extra', text: '★ Fuera de horario' }) : null, c.servicio, c.novino ? ' · No vino' : '']),
            c.tel ? el('span', { class: 'ap-dato', text: 'Tel. ' + c.tel }) : null,
            c.email ? el('span', { class: 'ap-dato', text: c.email }) : null
          ]),
          !c.pasada ? el('button', { type: 'button', class: 'p-novino p-cancelar', 'aria-label': 'Cancelar la cita de ' + (c.cliente || 'el cliente') + ' a las ' + c.h, onclick: function () { abrirCancelar(c); } }, ['Cancelar']) : el('span')
        ]));
      });
      box.appendChild(ul);
    });
  }

  // Cancelar una cita propia: el hueco queda libre y, si se marca, el cliente recibe un correo con el motivo
  var MOTIVOS = ['Barbero enfermo', 'Imprevisto', 'Cierre del local', 'Error al apuntar la cita'];
  function abrirCancelar(c) {
    var dlg = $('#cancelar-modal');
    dlg.textContent = '';
    var texto = el('textarea', { maxlength: '200', rows: '2', placeholder: 'O escribe otro motivo (opcional)…', 'aria-label': 'Motivo' });
    var chips = el('div', { class: 'h-motivos', role: 'group', 'aria-label': 'Motivos rápidos' }, MOTIVOS.map(function (m) {
      return el('button', { type: 'button', class: 'p-chip', 'aria-pressed': 'false', onclick: function () { texto.value = texto.value.trim() === m ? '' : m; marcarChips(); } }, [m]);
    }));
    function marcarChips() { chips.querySelectorAll('.p-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === texto.value.trim())); }); }
    texto.addEventListener('input', marcarChips);
    var avisar = el('input', { type: 'checkbox' });
    if (c.email) avisar.checked = true; else avisar.disabled = true;
    var err = el('div', { class: 'alert', role: 'alert', hidden: '' });
    var btn = el('button', { type: 'submit', class: 'btn btn-block g-danger-solid', text: 'Cancelar la cita' });
    var form = el('form', { novalidate: '' }, [
      el('h2', { id: 't-cancelar', text: 'Cancelar cita' }),
      el('div', { class: 'h-cita' }, [el('b', { text: c.cliente || 'Cliente' }), el('small', { text: cuandoTexto(c.f, c.h) + ' · ' + c.servicio })]),
      el('span', { class: 'h-label', text: 'Motivo' }), chips, texto,
      el('label', { class: 'h-check' + (c.email ? '' : ' is-off') }, [avisar, el('span', {
        text: c.email ? 'Avisar al cliente por correo con el motivo y un botón para reservar otra cita' : 'Este cliente no dejó correo: avisa a la barbería para que le escriban'
      })]),
      err,
      el('div', { class: 'h-botones' }, [btn, el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Volver', onclick: function () { dlg.close(); } })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true; btn.textContent = 'Cancelando…'; err.hidden = true;
      post({ action: 'cancelarBarberia', pin: leerPin(), e: c.id, motivo: texto.value.trim(), avisar: avisar.checked }).then(function (r) {
        dlg.close();
        cargarCitas('Cita de ' + (c.cliente || 'el cliente') + ' (' + c.h + ') cancelada. El hueco ya está libre.' + (r.avisado ? ' Le hemos avisado por correo.' : ''));
      }).catch(function (x) {
        if (x.code === 'PIN') { dlg.close(); errorPin(x, $('#citas')); return; }
        err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Cancelar la cita';
      });
    });
    dlg.appendChild(form);
    dlg.showModal();
  }

  // ---------- Mi actividad (solo lo suyo y sin importes) ----------
  var A = { items: null, max: 40 };
  var TIPO_TXT = {
    reserva: 'Reserva', cambio: 'Cambio', cancelacion_cliente: 'Cancelada por el cliente', cancelacion_barberia: 'Cancelada por la barbería',
    mostrador: 'Mostrador', deshecha: 'Deshecha', no_show: 'No vino', no_show_quitado: 'Quitado «No vino»', pagado: 'Pagado'
  };
  var fHora = new Intl.DateTimeFormat('es-ES', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function cargarActividad() {
    show('#v-act');
    var ul = $('#actividad');
    if (!A.items) { ul.textContent = ''; ul.appendChild(el('li', { class: 'g-note', text: 'Cargando…' })); }
    post({ action: 'actividad', pin: leerPin(), dias: 60 }).then(function (r) { A.items = r.items || []; pintarActividad(); })
      .catch(function (err) { errorPin(err, ul); });
  }
  function normal(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function pintarActividad() {
    var ul = $('#actividad'), mas = $('#act-mas'); ul.textContent = ''; mas.textContent = '';
    if (!A.items) return;
    var tipo = $('#act-tipo').value, q = normal($('#act-buscar').value).trim();
    var lista = A.items.filter(function (x) {
      if (tipo && String(x.tipo).indexOf(tipo) !== 0) return false;
      return !q || normal([x.cliente, x.tel, x.email, x.servicio, x.detalle].join(' ')).indexOf(q) !== -1;
    });
    if (!lista.length) ul.appendChild(el('li', { class: 'g-note', text: A.items.length ? 'Nada con esos filtros.' : 'Aún no hay actividad.' }));
    lista.slice(0, A.max).forEach(function (x) {
      var cuando = fHora.format(new Date(x.t)).split(', ');
      var cita = x.f ? x.f.split('-').reverse().slice(0, 2).join('/') + (x.h ? ' ' + x.h : '') : '';
      ul.appendChild(el('li', null, [
        el('time', { datetime: x.t }, [el('b', { text: cuando[0] }), cuando[1] || '']),
        el('div', { class: 'h-d' }, [
          el('span', null, [el('span', { class: 'h-tipo t-' + x.tipo, text: TIPO_TXT[x.tipo] || x.tipo }), el('b', { text: x.cliente || 'Cliente' })]),
          el('small', { text: [x.servicio, cita ? 'cita ' + cita : ''].filter(Boolean).join(' · ') }),
          x.origen || x.detalle ? el('small', { text: [x.origen, x.detalle].filter(Boolean).join(' · ') }) : null
        ])
      ]));
    });
    mas.appendChild(el('span', { class: 'g-note', style: 'margin:0', text: lista.length + (lista.length === 1 ? ' movimiento' : ' movimientos') + ' en los últimos 60 días' }));
    if (lista.length > A.max) mas.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Ver más', onclick: function () { A.max += 60; pintarActividad(); } }));
  }

  // ---------- Horas extra (solo el barbero de config.js → horasExtra) ----------
  var EX = { dias: [], sel: {}, antes: '' };
  var fDiaX = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function cargarExtra(msg) {
    var box = $('#extra'), m = $('#extra-msg');
    m.textContent = msg || ''; m.hidden = !msg;
    show('#v-extra');
    if (!box.childNodes.length) box.appendChild(el('p', { class: 'slots-status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Cargando…']));
    post({ action: 'horasExtra', pin: leerPin() }).then(function (r) {
      EX.dias = r.dias || []; EX.franjas = r.franjas || []; EX.hoy = r.hoy;
      EX.sel = {};
      EX.dias.forEach(function (d) { EX.sel[d.f] = d.horas.filter(function (h) { return h.abierta; }).map(function (h) { return h.h; }); });
      EX.antes = JSON.stringify(EX.sel);
      pintarExtra();
    }).catch(function (err) { errorPin(err, box); });
  }
  function enFranja(h, fr) { return h >= fr[0] && h < fr[1]; }
  function pintarExtra() {
    var box = $('#extra'); box.textContent = '';
    EX.dias.forEach(function (d) {
      var sel = EX.sel[d.f] || [];
      var libres = d.horas.filter(function (h) { return !h.pasada && !h.reservada; }).map(function (h) { return h.h; });
      var todas = libres.length && libres.every(function (h) { return sel.indexOf(h) !== -1; });
      var titulo = d.f === EX.hoy ? 'Hoy' : d.f === addDays(EX.hoy, 1) ? 'Mañana' : cap(fDiaX.format(utc(d.f)).replace(',', ''));
      box.appendChild(el('div', { class: 'hx-dia' }, [el('h2', { text: titulo }),
        libres.length ? el('button', { type: 'button', class: 'hx-todo', text: todas ? 'Cerrar todas' : 'Abrir todas', onclick: function () {
          var resto = sel.filter(function (h) { return libres.indexOf(h) === -1; });
          EX.sel[d.f] = todas ? resto : resto.concat(libres);
          pintarExtra();
        } }) : null]));
      EX.franjas.forEach(function (fr) {
        var hs = d.horas.filter(function (h) { return enFranja(h.h, fr); });
        if (!hs.length) return;
        box.appendChild(el('p', { class: 'hx-franja', text: fr[0] + ' – ' + fr[1] }));
        box.appendChild(el('div', { class: 'hx-grid', role: 'group', 'aria-label': titulo + ', de ' + fr[0] + ' a ' + fr[1] }, hs.map(function (h) {
          var abierta = sel.indexOf(h.h) !== -1;
          var bt = el('button', {
            type: 'button', class: 'hx-h' + (h.reservada ? ' is-reservada' : ''), 'aria-pressed': String(abierta || h.reservada),
            'aria-label': h.h + (h.reservada ? ', reservada' : abierta ? ', abierta' : ', cerrada'),
            onclick: function () {
              var lista = EX.sel[d.f] = (EX.sel[d.f] || []).slice();
              var i = lista.indexOf(h.h);
              if (i === -1) lista.push(h.h); else lista.splice(i, 1);
              pintarExtra();
            }
          }, [h.reservada ? h.h + ' ✓' : h.h]);
          if (h.reservada || h.pasada) bt.disabled = true;
          return bt;
        })));
      });
    });
    var cambiado = JSON.stringify(EX.sel) !== EX.antes;
    $('#extra-ok').disabled = !cambiado;
  }
  function guardarExtra() {
    var btn = $('#extra-ok');
    btn.disabled = true; btn.textContent = 'Guardando…';
    post({ action: 'horasExtraGuardar', pin: leerPin(), abiertas: EX.sel }).then(function (r) {
      var n = 0; Object.keys(r.abiertas || EX.sel).forEach(function (f) { n += ((r.abiertas || EX.sel)[f] || []).length; });
      cargarExtra('Guardado. ' + (n ? n + (n === 1 ? ' cita fuera de horario abierta.' : ' citas fuera de horario abiertas.') : 'Todo cerrado: no hay citas fuera de horario.') +
        (r.avisados ? ' Hemos avisado a ' + r.avisados + (r.avisados === 1 ? ' persona' : ' personas') + ' de la lista de espera.' : ''));
    }).catch(function (err) { if (err.code === 'PIN') return errorPin(err, $('#extra')); alert(err.message); })
      .then(function () { btn.textContent = 'OK · Guardar'; });
  }
  var DEMO_EXTRA = null;
  function demoExtra() {
    var a = ahoraMadrid(), dias = [], posibles = [];
    [['09:00', '10:00'], ['14:00', '16:00'], ['18:00', '21:00']].forEach(function (fr) { for (var t = toMin(fr[0]); t < toMin(fr[1]); t += 30) posibles.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60)); });
    for (var i = 0; dias.length < 7 && i < 14; i++) {
      var f = addDays(a.fecha, i);
      if (!abierto(f)) continue;
      var ab = DEMO_EXTRA ? (DEMO_EXTRA[f] || []) : (dias.length === 1 ? ['18:00', '18:30', '19:00'] : []);
      dias.push({ f: f, horas: posibles.map(function (h) { return { h: h, abierta: ab.indexOf(h) !== -1, reservada: !DEMO_EXTRA && dias.length === 1 && h === '18:00', pasada: f === a.fecha && h <= a.hora }; }) });
    }
    return { ok: true, hoy: a.fecha, franjas: [['09:00', '10:00'], ['14:00', '16:00'], ['18:00', '21:00']], multiplicador: 2, dias: dias };
  }

  // ---------- Datos de ejemplo de «Mis citas» y «Mi actividad» ----------
  var DEMO_CITAS = null;
  function demoCitas() {
    var a = ahoraMadrid(), nombres = ['Álex García', 'Javier Ruiz', 'Sergio Martín', 'Pablo López', 'Hugo Díaz', 'Mario Torres', 'Iván Moreno', 'Marc Navarro'];
    if (!DEMO_CITAS) {
      DEMO_CITAS = [];
      for (var i = 0, n = 0; i < 4; i++) {
        var f = addDays(a.fecha, i);
        if (!abierto(f)) continue;
        ['10:00', '11:30', '17:00', '18:30', '19:00'].slice(0, 5 - i).forEach(function (h, k) {
          var nom = nombres[(n++) % nombres.length], s = C.servicios[k % C.servicios.length];
          DEMO_CITAS.push({ id: 'd' + n, f: f, h: h, cliente: nom, tel: '6' + String(12345678 + n * 1111111).slice(0, 8), email: k % 3 === 2 ? '' : nom.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@ejemplo.com',
            servicio: s.nombre, origen: k === 3 ? 'mostrador' : 'web', pasada: f === a.fecha && h <= a.hora, novino: false });
        });
      }
    }
    return { ok: true, hoy: a.fecha, ahora: a.hora, citas: DEMO_CITAS };
  }
  function demoActividad() {
    var citas = demoCitas().citas, items = [], ahora = Date.now();
    citas.forEach(function (c, i) {
      items.push({ t: new Date(ahora - (i * 5 + 1) * 3600000).toISOString(), tipo: c.origen === 'mostrador' ? 'mostrador' : 'reserva', cliente: c.cliente, servicio: c.servicio, f: c.f, h: c.h, origen: c.origen === 'mostrador' ? 'Agenda de ' + nombreBarbero(B) : 'Web', detalle: '' });
      if (i === 2) items.push({ t: new Date(ahora - 2 * 3600000).toISOString(), tipo: 'cambio', cliente: c.cliente, servicio: c.servicio, f: c.f, h: c.h, origen: 'Web (el cliente)', detalle: 'Antes: mañana a las 12:00' });
      if (i === 4) items.push({ t: new Date(ahora - 30 * 3600000).toISOString(), tipo: 'cancelacion_cliente', cliente: 'Rubén Gómez', servicio: c.servicio, f: c.f, h: '13:00', origen: 'Web (el cliente)', detalle: '' });
    });
    items.sort(function (x, y) { return y.t.localeCompare(x.t); });
    return { ok: true, items: items, dias: 60 };
  }

  // ---------- Eventos ----------
  document.querySelectorAll('#ap-tabs [data-tab]').forEach(function (b) { b.addEventListener('click', function () { irA(b.getAttribute('data-tab')); }); });
  $('#pin').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
  $('#pin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = $('#pin').value, btn = $('#pin-btn');
    if (!/^\d{4}$/.test(pin)) { pedirPin('El PIN tiene 4 cifras.'); return; }
    btn.disabled = true;
    post({ action: 'pin', pin: pin }).then(function () {
      guardarPin(pin);
      irA(T.pendiente || 'citas');
    }).catch(function (err) { pedirPin(err.message); }).then(function () { btn.disabled = false; });
  });
  $('#citas-actualizar').addEventListener('click', function () { cargarCitas(); });
  $('#extra-actualizar').addEventListener('click', function () { cargarExtra(); });
  $('#extra-ok').addEventListener('click', guardarExtra);
  $('#act-actualizar').addEventListener('click', function () { A.items = null; cargarActividad(); });
  $('#act-tipo').addEventListener('change', function () { A.max = 40; pintarActividad(); });
  $('#act-buscar').addEventListener('input', function () { A.max = 40; pintarActividad(); });
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
    // Este móvil es el de este barbero: en la web de la barbería le saldrá "Mi agenda" en el menú
    if (!DEMO) { try { localStorage.setItem('booklab_agenda', B); } catch (e) { /* sin almacenamiento */ } }
    hoy = r.hoy;
    var input = $('#fecha'); input.min = hoy; input.max = addDays(hoy, R.diasMaximos || 60);
    $('#ap-barbero').textContent = r.barbero;
    document.title = 'Agenda · ' + r.barbero;
    pintarServicios(); pintarDias();
    var primero = $('#dias .day');
    elegirFecha(abierto(hoy) ? hoy : (primero ? primero.getAttribute('data-date') : hoy));
    // Pestaña «Horas extra» solo para el barbero que las abre
    if (C.horasExtra && C.horasExtra.barbero === B) {
      var tabs = $('#ap-tabs');
      tabs.classList.add('has-4');
      tabs.querySelector('[data-tab="actividad"]').textContent = 'Actividad';
      var tx = el('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'data-tab': 'extra' }, ['Fuera horario']);
      tx.addEventListener('click', function () { irA('extra'); });
      tabs.appendChild(tx);
    }
    $('#ap-tabs').hidden = false;
    var pestana = (location.hash.match(/^#(citas|actividad|extra)$/) || [])[1];
    if (pestana) irA(pestana); else show('#v-form');
  }).catch(function (err) {
    $('#error-text').textContent = err.message;
    show('#v-error');
  });
})();
