/*
 * Book Lab — lógica de la reserva (demo.html).
 * Lee todos los datos de config.js (window.BOOKLAB_CONFIG) y la URL del
 * motor de config.js → motor.url.
 * No hace falta tocar este archivo para adaptar la web a otra barbería.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG;
  var TZ = C.negocio.zonaHoraria || 'Europe/Madrid';
  var R = C.reglas;
  // URL del motor: config.js → motor.url (o la constante ENDPOINT antigua, si existe)
  var URL_BACKEND = ((C.motor && C.motor.url) || (typeof ENDPOINT === 'string' ? ENDPOINT : '')).trim();
  var LIVE = /^https:\/\//.test(URL_BACKEND) && URL_BACKEND.indexOf('PEGAR_') === -1;
  var TIMEOUT_MS = 25000;
  var MIN_GAP = Math.min.apply(null, C.servicios.map(function (s) { return s.duracion; }));

  var state = { step: 1, service: null, barber: null, date: '', time: '', result: null };
  var slotsRequest = 0;

  // ---------- Utilidades ----------
  var $ = function (sel) { return document.querySelector(sel); };
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
  function toMin(hhmm) { var p = hhmm.split(':'); return +p[0] * 60 + +p[1]; }
  function toHHMM(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function ymdToUTC(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function addDays(ymd, n) { var d = ymdToUTC(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function isoWeekday(ymd) { return ymdToUTC(ymd).getUTCDay() || 7; } // 1 = lunes … 7 = domingo
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var fmtLong = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  var fmtWd = new Intl.DateTimeFormat('es-ES', { weekday: 'short', timeZone: 'UTC' });
  var fmtMon = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
  var fmtShort = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  function longDate(ymd) { return fmtLong.format(ymdToUTC(ymd)).replace(',', ''); }
  function shortDate(ymd) { return fmtShort.format(ymdToUTC(ymd)).replace(/\./g, '').replace(',', ''); }

  // Fecha y minuto actuales en la zona horaria de la barbería (aunque el móvil esté en otra)
  function nowInShop() {
    var parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return { date: parts.year + '-' + parts.month + '-' + parts.day, minutes: (+parts.hour % 24) * 60 + +parts.minute };
  }
  function today() { return nowInShop().date; }
  function lastDay() { return addDays(today(), R.diasMaximos); }
  function isOpen(ymd) { var h = C.horario[isoWeekday(ymd)]; return !!(h && h.length); }

  function serviceById(id) { return C.servicios.filter(function (s) { return s.id === id; })[0]; }
  function barberById(id) { return C.barberos.filter(function (b) { return b.id === id; })[0]; }
  function realBarbers() { return C.barberos.filter(function (b) { return b.id !== 'any'; }); }

  /*
   * Horas de inicio libres. Misma regla que en Code.gs:
   *  - el servicio entero cabe dentro del horario y no se solapa con nada;
   *  - respeta la antelación mínima;
   *  - (opcional) no deja ratos muertos más cortos que el servicio más corto.
   */
  function freeStarts(windows, busy, dur, step, earliest, avoidGaps, minGap) {
    var out = [];
    windows.forEach(function (w) {
      var ws = w[0], we = w[1], firstValid = null;
      for (var t = ws; t + dur <= we; t += step) {
        if (t < earliest) continue;
        if (firstValid === null) firstValid = t;
        var e = t + dur;
        if (busy.some(function (b) { return t < b[1] && e > b[0]; })) continue;
        if (avoidGaps) {
          var prev = ws, next = we;
          busy.forEach(function (b) {
            if (b[1] <= t && b[1] > prev) prev = b[1];
            if (b[0] >= e && b[0] < next) next = b[0];
          });
          prev = Math.max(prev, firstValid);
          var before = t - prev, after = next - e;
          if ((before > 0 && before < minGap) || (after > 0 && after < minGap)) continue;
        }
        out.push(t);
      }
    });
    return out;
  }

  // ---------- Modo simulación (sin backend) ----------
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  function fakeBusy(ymd, barberId) {
    var rnd = seeded(ymd + barberId), busy = [];
    (C.horario[isoWeekday(ymd)] || []).forEach(function (w) {
      for (var t = toMin(w[0]); t + 30 <= toMin(w[1]); t += 30) if (rnd() < 0.38) busy.push([t, t + 30]);
    });
    return busy;
  }
  function simulatedSlots(ymd, serviceId, barberId) {
    var svc = serviceById(serviceId), windows = (C.horario[isoWeekday(ymd)] || []).map(function (w) { return [toMin(w[0]), toMin(w[1])]; });
    var now = nowInShop(), earliest = ymd === now.date ? now.minutes + R.antelacionMinutos : -1;
    var ids = barberId === 'any' ? realBarbers().map(function (b) { return b.id; }) : [barberId], set = {};
    ids.forEach(function (id) {
      freeStarts(windows, fakeBusy(ymd, id), svc.duracion, R.intervaloMinutos, earliest, R.evitarHuecosSueltos, MIN_GAP)
        .forEach(function (t) { set[t] = id; });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; }).map(toHHMM);
  }
  function simulatedBooking(p) {
    var name = barberById(p.barber).nombre;
    if (p.barber === 'any') {
      var t = toMin(p.time), svc = serviceById(p.service);
      var free = realBarbers().filter(function (b) {
        return !fakeBusy(p.date, b.id).some(function (x) { return t < x[1] && t + svc.duracion > x[0]; });
      })[0];
      name = (free || realBarbers()[0]).nombre;
    }
    return new Promise(function (res) {
      setTimeout(function () { res({ ok: true, barber: name, when: capitalize(longDate(p.date)) + ' a las ' + p.time }); }, 900);
    });
  }

  // ---------- Red ----------
  function request(url, opts) {
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a internet. Revisa los datos o el wifi e inténtalo de nuevo.'));
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    opts = opts || {};
    if (ctrl) opts.signal = ctrl.signal;
    opts.redirect = 'follow';
    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('El servidor ha respondido con un error (' + r.status + '). Inténtalo de nuevo en unos minutos.');
      return r.text();
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('El servidor está tardando demasiado. Inténtalo de nuevo en unos segundos.');
      throw new Error('No hemos podido conectar con el sistema de reservas. Revisa tu conexión e inténtalo de nuevo.');
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) { throw new Error('Respuesta inesperada del sistema de reservas. Inténtalo de nuevo.'); }
      if (data && data.error) { var er = new Error(data.error); er.code = data.code; throw er; }
      return data;
    });
  }
  function getSlots(ymd, serviceId, barberId) {
    if (!LIVE) return new Promise(function (res) { setTimeout(function () { res({ slots: simulatedSlots(ymd, serviceId, barberId) }); }, 450); });
    var q = '?action=slots&date=' + encodeURIComponent(ymd) + '&service=' + encodeURIComponent(serviceId) + '&barber=' + encodeURIComponent(barberId);
    return request(URL_BACKEND + q);
  }
  function postBooking(payload) {
    if (!LIVE) return simulatedBooking(payload);
    return request(URL_BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  }

  // ---------- Pasos ----------
  var LABELS = ['Servicio', 'Barbero', 'Día y hora', 'Datos'];

  function renderProgress() {
    var ol = $('#progress');
    ol.textContent = '';
    LABELS.forEach(function (label, i) {
      var n = i + 1, done = n < state.step || state.step === 5, current = n === state.step;
      var inner = [el('i'), el('em', { text: n + '. ' + label })];
      var item = (done && state.step !== 5)
        ? el('button', { type: 'button', class: 'is-done', 'aria-label': 'Paso ' + n + ', ' + label + ': completado. Volver a este paso', onclick: function () { go(n); } }, inner)
        : el('span', { class: done ? 'is-done' : current ? 'is-current' : '', 'aria-current': current ? 'step' : null }, inner);
      if (!current) item.removeAttribute('aria-current');
      ol.appendChild(el('li', null, [item]));
    });
  }

  function renderSummary() {
    var box = $('#summary'), chips = [];
    box.textContent = '';
    if (state.step === 5) return;
    if (state.service && state.step > 1) chips.push(serviceById(state.service).nombre + ' · ' + money.format(serviceById(state.service).precio));
    if (state.barber && state.step > 2) chips.push(state.barber === 'any' ? 'Cualquier barbero' : barberById(state.barber).nombre);
    if (state.date && state.time && state.step > 3) chips.push(capitalize(shortDate(state.date)) + ' · ' + state.time);
    chips.forEach(function (c) { box.appendChild(el('span', { class: 'chip', text: c })); });
  }

  function go(n, opts) {
    opts = opts || {};
    state.step = n;
    document.querySelectorAll('.step').forEach(function (s) { s.hidden = +s.getAttribute('data-step') !== n; });
    renderProgress();
    renderSummary();
    if (n === 3) enterDateStep();
    if (!opts.fromHistory) {
      var st = { step: n };
      if (opts.replace) history.replaceState(st, ''); else history.pushState(st, '');
    }
    if (!opts.initial) {
      var title = document.querySelector('.step[data-step="' + n + '"] .step-title');
      // Si el usuario ha bajado, vuelve al principio de la reserva
      var top = $('.booking').getBoundingClientRect().top + window.scrollY - 8;
      if (window.scrollY > top) window.scrollTo(0, top);
      title.focus({ preventScroll: true });
    }
  }

  // Paso 1
  function renderServices() {
    var box = $('#services');
    C.servicios.forEach(function (s) {
      box.appendChild(el('button', {
        type: 'button', class: 'option', 'aria-pressed': 'false', 'data-id': s.id,
        onclick: function () { pick('service', s.id, '#services'); go(2); }
      }, [
        el('span', { class: 'option-name', text: s.nombre }),
        el('span', { class: 'option-price', text: money.format(s.precio) }),
        el('span', { class: 'option-desc', text: s.descripcion }),
        el('span', { class: 'option-meta', text: s.duracion + ' min' })
      ]));
    });
  }

  // Paso 2
  var RAYS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 5l5 5M4 13h7M6 21l5-5"/><circle cx="18" cy="13" r="3"/></svg>';
  function renderBarbers() {
    var box = $('#barbers');
    C.barberos.forEach(function (b) {
      var avatar = el('span', { class: 'avatar', 'aria-hidden': 'true' });
      if (b.id === 'any') avatar.innerHTML = RAYS; else avatar.textContent = b.nombre.charAt(0);
      box.appendChild(el('button', {
        type: 'button', class: 'option barber', 'aria-pressed': 'false', 'data-id': b.id,
        onclick: function () { pick('barber', b.id, '#barbers'); state.time = ''; go(3); }
      }, [avatar, el('span', { class: 'option-name', text: b.nombre }), el('span', { class: 'option-desc', text: b.frase })]));
    });
  }

  function pick(key, id, container) {
    if (state[key] !== id && key === 'service') state.time = '';
    state[key] = id;
    document.querySelectorAll(container + ' .option').forEach(function (o) { o.setAttribute('aria-pressed', String(o.getAttribute('data-id') === id)); });
  }

  // Paso 3
  function renderQuickDays() {
    var box = $('#quick-days'), d = today(), count = 0;
    box.textContent = '';
    for (var i = 0; i <= R.diasMaximos && count < 10; i++) {
      var ymd = addDays(d, i);
      if (!isOpen(ymd)) continue;
      count++;
      var u = ymdToUTC(ymd), wd = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fmtWd.format(u).replace('.', '');
      box.appendChild(el('button', {
        type: 'button', class: 'day', 'aria-pressed': String(state.date === ymd), 'data-date': ymd,
        'aria-label': capitalize(longDate(ymd)),
        onclick: (function (v) { return function () { setDate(v); }; })(ymd)
      }, [el('small', { text: wd }), el('b', { text: String(u.getUTCDate()) }), el('span', { text: fmtMon.format(u).replace('.', '') })]));
    }
  }

  function enterDateStep() {
    var input = $('#date');
    input.min = today();
    input.max = lastDay();
    renderQuickDays();
    if (!state.date) {
      // Preselecciona el primer día abierto para que el cliente vea horas al momento
      var first = document.querySelector('#quick-days .day');
      if (first) { setDate(first.getAttribute('data-date')); return; }
    }
    if (state.date) loadSlots();
    updateContinue();
  }

  function setDate(ymd) {
    state.date = ymd;
    state.time = '';
    $('#date').value = ymd;
    document.querySelectorAll('#quick-days .day').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-date') === ymd)); });
    loadSlots();
    updateContinue();
  }

  function setStatus(content, isError) {
    var s = $('#slots-status');
    s.classList.toggle('is-error', !!isError);
    s.textContent = '';
    (Array.isArray(content) ? content : [content]).forEach(function (c) { if (c) s.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  }

  function loadSlots() {
    var box = $('#slots'), ymd = state.date, id = ++slotsRequest;
    box.textContent = '';
    if (!ymd) { setStatus(''); return; }
    if (ymd < today() || ymd > lastDay()) {
      setStatus('Elige una fecha entre hoy y el ' + longDate(lastDay()) + '.', true);
      return;
    }
    if (!isOpen(ymd)) {
      setStatus('Ese día estamos cerrados. Elige otro día, por favor.', true);
      return;
    }
    setStatus([el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Buscando horas libres…']);
    var sk = el('div', { class: 'skeleton', 'aria-hidden': 'true' });
    for (var i = 0; i < 8; i++) sk.appendChild(el('i'));
    box.appendChild(sk);

    getSlots(ymd, state.service, state.barber).then(function (data) {
      if (id !== slotsRequest) return;
      box.textContent = '';
      var slots = (data && data.slots) || [];
      if (!slots.length) {
        setStatus('No quedan horas libres ese día' + (state.barber !== 'any' ? ' con ' + barberById(state.barber).nombre : '') + '. Prueba otro día' + (state.barber !== 'any' ? ' o elige «Cualquiera».' : '.'));
        return;
      }
      setStatus(slots.length + (slots.length === 1 ? ' hora libre' : ' horas libres') + ' el ' + longDate(ymd) + '.');
      var groups = [['Mañana', slots.filter(function (t) { return t < '14:00'; })], ['Tarde', slots.filter(function (t) { return t >= '14:00'; })]];
      groups.forEach(function (g) {
        if (!g[1].length) return;
        var grid = el('div', { class: 'slot-grid', role: 'group', 'aria-label': g[0] });
        g[1].forEach(function (t) {
          grid.appendChild(el('button', {
            type: 'button', class: 'slot', 'aria-pressed': String(state.time === t), 'data-time': t,
            onclick: function () { selectTime(t); }
          }, [t]));
        });
        box.appendChild(el('div', { class: 'slot-group' }, [el('h3', { text: g[0] }), grid]));
      });
    }).catch(function (err) {
      if (id !== slotsRequest) return;
      box.textContent = '';
      setStatus([err.message, el('br'), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Reintentar', onclick: loadSlots })], true);
    });
  }

  function selectTime(t) {
    state.time = t;
    document.querySelectorAll('#slots .slot').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-time') === t)); });
    updateContinue();
  }

  function updateContinue() { $('#to-step-4').disabled = !(state.date && state.time); }

  // Paso 4
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var FIELDS = {
    name: function (v) { return v ? '' : 'Escribe tu nombre.'; },
    surname: function (v) { return v ? '' : 'Escribe tus apellidos.'; },
    email: function (v) { return !v ? 'Escribe tu correo electrónico.' : EMAIL_RE.test(v) ? '' : 'Revisa el correo: debe tener la forma nombre@ejemplo.com.'; },
    phone: function (v) { return (v.replace(/\D/g, '').length >= 9) ? '' : (v ? 'Revisa el teléfono: debe tener al menos 9 cifras.' : 'Escribe tu teléfono.'); }
  };
  var triedSubmit = false;

  function validateField(name) {
    var input = $('#' + name), msg = FIELDS[name](input.value.trim());
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    $('#' + name + '-err').textContent = msg;
    return !msg;
  }
  function validateConsent() {
    var ok = $('#consent').checked;
    $('#consent-err').textContent = ok ? '' : 'Para reservar tienes que aceptar la política de cancelación.';
    $('#consent').setAttribute('aria-invalid', ok ? 'false' : 'true');
    $('.check').classList.toggle('is-invalid', !ok);
    return ok;
  }

  function onSubmit(e) {
    e.preventDefault();
    triedSubmit = true;
    var alertBox = $('#form-error');
    alertBox.hidden = true;
    var firstBad = null;
    Object.keys(FIELDS).forEach(function (f) { if (!validateField(f) && !firstBad) firstBad = $('#' + f); });
    if (!validateConsent() && !firstBad) firstBad = $('#consent');
    if (firstBad) { firstBad.focus(); return; }

    var btn = $('#submit');
    btn.disabled = true;
    btn.textContent = '';
    btn.appendChild(el('span', { class: 'spinner', 'aria-hidden': 'true' }));
    btn.appendChild(document.createTextNode('Reservando…'));

    var payload = {
      service: state.service, barber: state.barber, date: state.date, time: state.time,
      name: $('#name').value.trim(), surname: $('#surname').value.trim(),
      email: $('#email').value.trim(), phone: $('#phone').value.trim(),
      consent: $('#consent').checked, web: $('#web').value
    };

    postBooking(payload).then(function (res) {
      state.result = { barber: res.barber || barberById(state.barber).nombre, when: res.when, payload: payload, gestionar: res.gestionar || (LIVE ? '' : 'cita.html?demo=1') };
      renderDone();
      go(5, { replace: true });
    }).catch(function (err) {
      if (err.code === 'SLOT_TAKEN') {
        state.time = '';
        go(3);
        setTimeout(function () { setStatus(err.message, true); }, 0);
        return;
      }
      alertBox.textContent = err.message;
      if (err.code === 'BLOQUEADO') {
        var tel = String(C.negocio.telefono || '').replace(/[^\d+]/g, '');
        alertBox.textContent = '';
        alertBox.appendChild(el('strong', { class: 'alert-t', text: 'Reserva online bloqueada' }));
        alertBox.appendChild(el('span', { text: err.message }));
        if (tel) alertBox.appendChild(el('a', { class: 'btn btn-ghost btn-sm alert-btn', href: 'tel:' + tel, text: 'Llamar a la barbería' }));
      }
      alertBox.hidden = false;
      alertBox.setAttribute('tabindex', '-1');
      alertBox.focus();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Confirmar reserva';
    });
  }

  // Paso 5
  function gcalDate(ymd, min) { return ymd.replace(/-/g, '') + 'T' + pad(Math.floor(min / 60)) + pad(min % 60) + '00'; }

  // Texto de "Copiar resumen de la cita" (plantilla en config.js → textos.resumen)
  function summaryText() {
    var p = state.result.payload, svc = serviceById(p.service);
    var values = {
      barberia: C.negocio.nombre, servicio: svc.nombre, precio: money.format(svc.precio),
      barbero: state.result.barber, fecha: longDate(p.date), hora: p.time, direccion: C.negocio.direccion
    };
    return C.textos.resumen.replace(/\{(\w+)\}/g, function (m, k) { return k in values ? values[k] : m; });
  }

  function renderDone() {
    var p = state.result.payload, svc = serviceById(p.service);
    var rows = [
      ['Servicio', svc.nombre], ['Barbero', state.result.barber], ['Día', capitalize(longDate(p.date))],
      ['Hora', p.time], ['Duración', svc.duracion + ' min'], ['Precio', money.format(svc.precio)]
    ];
    var dl = $('#recap');
    dl.textContent = '';
    rows.forEach(function (r) { dl.appendChild(el('div', null, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])); });

    $('#done-note').textContent = LIVE
      ? C.textos.confirmacion + ' Revisa también la carpeta de spam.'
      : 'Modo simulación: no se ha creado ninguna cita ni se ha enviado ningún correo. Con la demo conectada, el cliente recibe un correo de confirmación y recordatorios 24 h y 3 h antes.';

    var start = toMin(p.time);
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(svc.nombre + ' · ' + C.negocio.nombre) +
      '&dates=' + gcalDate(p.date, start) + '/' + gcalDate(p.date, start + svc.duracion) +
      '&ctz=' + encodeURIComponent(TZ) +
      '&details=' + encodeURIComponent('Con ' + state.result.barber + '. ' + money.format(svc.precio) + '.\nSi no puedes venir, avisa con al menos ' + R.cancelacionHoras + ' horas de antelación.') +
      '&location=' + encodeURIComponent(C.negocio.direccion || C.negocio.nombre);
    $('#gcal').href = url;
    var manage = $('#manage');
    if (manage) {
      manage.hidden = !state.result.gestionar;
      if (state.result.gestionar) manage.href = state.result.gestionar;
    }
    $('#copy-status').textContent = '';
    if ($('#summary-text')) $('#summary-text').remove();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = el('textarea', { readonly: '', style: 'position:fixed;top:0;left:0;opacity:0;font-size:16px' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* sin soporte */ }
      document.body.removeChild(ta);
      ok ? res() : rej();
    });
  }

  function reset() {
    state = { step: 1, service: null, barber: null, date: '', time: '', result: null };
    $('#form').reset();
    triedSubmit = false;
    document.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    document.querySelectorAll('.field-err').forEach(function (n) { n.textContent = ''; });
    $('.check').classList.remove('is-invalid');
    document.querySelectorAll('.option').forEach(function (o) { o.setAttribute('aria-pressed', 'false'); });
    $('#slots').textContent = '';
    setStatus('');
  }

  // ---------- Inicio ----------
  function init() {
    var nameEl = $('#shop-name');
    if (C.negocio.esMarcador) nameEl.appendChild(el('span', { class: 'ph', text: '“' + C.negocio.nombre + '”' }));
    else nameEl.textContent = C.negocio.nombre;
    $('#shop-sub').textContent = C.textos.subtituloReserva;
    document.title = 'Reserva tu cita · ' + C.negocio.nombre;

    var pol = C.textos.politica;
    $('#policy-title').textContent = pol.titulo;
    $('#policy-intro').textContent = pol.intro;
    pol.puntos.forEach(function (pt) {
      $('#policy-list').appendChild(el('li', null, [el('strong', { text: pt.titulo + ': ' }), pt.texto]));
    });
    $('#policy-close').textContent = pol.cierre;
    $('#consent-text').textContent = pol.casilla;

    // Información básica de protección de datos (RGPD, primera capa)
    var L = C.legal || {}, note = $('#legal-note');
    if (note) {
      note.appendChild(document.createTextNode(
        'Responsable: ' + (L.titular || C.negocio.nombre) + '. Usamos tus datos para gestionar tu cita y enviarte la confirmación, los recordatorios y, tras tu visita, un correo para saber qué tal te fue. ' +
        'Puedes acceder, rectificar o suprimir tus datos' + (L.email ? ' escribiendo a ' + L.email : '') + '. Más información en la '));
      note.appendChild(el('a', { href: 'legal.html#privacidad', text: 'política de privacidad' }));
      note.appendChild(document.createTextNode('.'));
    }
    $('#copy-hint').textContent = C.textos.notaResumen;

    if (!LIVE) {
      var n = $('#notice');
      n.appendChild(el('strong', { text: 'Modo simulación. ' }));
      n.appendChild(document.createTextNode('Horas de ejemplo: no se crea ninguna cita ni se envía ningún correo.'));
      n.hidden = false;
      console.info('[Book Lab] Para conectar Google Calendar, pega la URL /exec de Apps Script en config.js → motor.url.');
    }

    renderServices();
    renderBarbers();

    $('#date').addEventListener('change', function () {
      var v = this.value;
      if (!v) { state.date = ''; state.time = ''; loadSlots(); updateContinue(); return; }
      setDate(v);
    });
    $('#to-step-4').addEventListener('click', function () { if (state.date && state.time) go(4); });
    $('#form').addEventListener('submit', onSubmit);
    Object.keys(FIELDS).forEach(function (f) {
      $('#' + f).addEventListener('blur', function () { if (triedSubmit || this.value) validateField(f); });
      $('#' + f).addEventListener('input', function () { if (triedSubmit) validateField(f); });
    });
    $('#consent').addEventListener('change', function () { if (triedSubmit) validateConsent(); });
    document.querySelectorAll('[data-back]').forEach(function (b) { b.addEventListener('click', function () { history.back(); }); });

    $('#copy-summary').addEventListener('click', function () {
      copyText(summaryText()).then(function () {
        $('#copy-status').textContent = '¡Copiado! Pégalo en tus notas.';
      }, function () {
        // Sin portapapeles: se muestra el texto para copiarlo a mano
        $('#copy-status').textContent = 'No se ha podido copiar automáticamente. Mantén pulsado este texto para copiarlo:';
        var pre = $('#summary-text') || $('#copy-status').insertAdjacentElement('afterend', el('pre', { id: 'summary-text', class: 'summary-text' }));
        pre.textContent = summaryText();
      });
    });
    $('#restart').addEventListener('click', function () { reset(); go(1); });

    // Botón "atrás" del móvil = paso anterior (no salir de la página)
    window.addEventListener('popstate', function (e) {
      var target = (e.state && e.state.step) || 1;
      if (state.result && target < 5) { reset(); go(1, { replace: true }); return; }
      if (target === 5 && !state.result) target = 1;
      if (target >= 2 && !state.service) target = 1;
      if (target >= 3 && !state.barber) target = 2;
      if (target >= 4 && !(state.date && state.time)) target = 3;
      go(target, { fromHistory: true });
    });

    go(1, { replace: true, initial: true });
  }

  init();
})();
