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

  var state = { step: 1, service: null, barber: null, date: '', time: '', result: null, extras: {}, extra: false };
  var MULT_EXTRA = 2;          // horas extra (fuera de horario): precio x2 (el motor dice el número)
  var pedidoURL = null;        // ?service=&barber=&date=&time= (enlace del correo de la lista de espera)
  var preBarbero = '';         // ?fh=1 (aviso de la portada): tras elegir servicio, directo al barbero de fuera de horario
  var fueraCache = {};         // servicio → { dias: [{ f, horas }], nombre, barbero, multiplicador }
  var slotsRequest = 0;
  var dayCache = {};          // 'servicio|barbero' → { 'AAAA-MM-DD': { libres, total } }
  var autoPickTime = false;   // tras «Primera hora libre», elegir sola la primera hora del día

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
    if (!LIVE) return new Promise(function (res) {
      // Simulación: mañana hay horas extra abiertas (si la barbería tiene horas extra)
      var hx = C.horasExtra && (barberId === 'any' || barberId === C.horasExtra.barbero) && ymd === addDays(today(), 1) ? ['18:00', '18:30', '19:00'] : [];
      var normales = simulatedSlots(ymd, serviceId, barberId);
      hx = hx.filter(function (h) { return normales.indexOf(h) === -1; });
      setTimeout(function () { res({ slots: normales, extra: hx, extraBarbero: C.horasExtra && C.horasExtra.barbero, multiplicador: 2 }); }, 450);
    });
    var q = '?action=slots&date=' + encodeURIComponent(ymd) + '&service=' + encodeURIComponent(serviceId) + '&barber=' + encodeURIComponent(barberId);
    return request(URL_BACKEND + q);
  }
  // Horas libres de varios días seguidos (para los colores y «Primera hora libre»)
  function getDays(from, n, serviceId, barberId) {
    if (!LIVE) {
      var out = {}, svc = serviceById(serviceId);
      for (var i = 0; i < n; i++) {
        var ymd = addDays(from, i);
        if (ymd > lastDay()) break;
        if (!isOpen(ymd)) { out[ymd] = { libres: 0, total: 0, cerrado: true }; continue; }
        var windows = (C.horario[isoWeekday(ymd)] || []).map(function (w) { return [toMin(w[0]), toMin(w[1])]; });
        var now = nowInShop(), earliest = ymd === now.date ? now.minutes + R.antelacionMinutos : -1;
        out[ymd] = {
          libres: simulatedSlots(ymd, serviceId, barberId).length,
          total: freeStarts(windows, [], svc.duracion, R.intervaloMinutos, earliest, R.evitarHuecosSueltos, MIN_GAP).length
        };
      }
      return Promise.resolve({ dias: out });
    }
    var q = '?action=dias&from=' + encodeURIComponent(from) + '&n=' + n + '&service=' + encodeURIComponent(serviceId) + '&barber=' + encodeURIComponent(barberId);
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
    if (state.date && state.time && state.step > 3) chips.push(capitalize(shortDate(state.date)) + ' · ' + state.time + (state.extra ? ' · Fuera de horario ×' + MULT_EXTRA : ''));
    chips.forEach(function (c) { box.appendChild(el('span', { class: 'chip', text: c })); });
  }

  function go(n, opts) {
    opts = opts || {};
    state.step = n;
    document.querySelectorAll('.step').forEach(function (s) { s.hidden = +s.getAttribute('data-step') !== n; });
    renderProgress();
    renderSummary();
    if (n === 2 && preBarbero && state.service && barberById(preBarbero)) { var pb = preBarbero; preBarbero = ''; pick('barber', pb, '#barbers'); go(3); return; }
    if (n === 3) enterDateStep();
    if (n === 4) pintarNotaExtra();
    if (n === 4) renderExtras();
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
        el('span', { class: 'option-name', text: (s.destacado ? '★ ' : '') + s.nombre }),
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
      }, [avatar, el('span', { class: 'option-name', text: b.nombre }), b.frase ? el('span', { class: 'option-desc', text: b.frase }) : null]));
    });
  }

  // ---------- Extras opcionales (config.js → extras) ----------
  // Ej.: { id: 'cejas', nombre: 'Cejas', pregunta: '¿Añadir cejas?', precio: 6, barberos: ['lucia'] }
  // barberos / servicios: si se ponen, el extra solo se ofrece con esos. No suma tiempo a la cita.
  function extrasDisponibles(servicio, barbero) {
    return (C.extras || []).filter(function (x) {
      return (!x.barberos || x.barberos.indexOf(barbero) !== -1) && (!x.servicios || x.servicios.indexOf(servicio) !== -1);
    });
  }
  function extrasElegidos(p) {
    var ids = (p && p.extras) || [];
    return (C.extras || []).filter(function (x) { return ids.indexOf(x.id) !== -1; });
  }
  function nombreConExtras(svc, extras) { return svc.nombre + extras.map(function (x) { return ' + ' + x.nombre; }).join(''); }
  function precioConExtras(svc, extras, esExtra) { return (svc.precio + extras.reduce(function (s, x) { return s + x.precio; }, 0)) * (esExtra ? MULT_EXTRA : 1); }

  function renderExtras() {
    var box = $('#extras');
    if (!box) return;
    var lista = extrasDisponibles(state.service, state.barber);
    Object.keys(state.extras).forEach(function (id) { if (!lista.some(function (x) { return x.id === id; })) delete state.extras[id]; });
    box.textContent = '';
    box.hidden = !lista.length;
    lista.forEach(function (x) {
      var si = state.extras[x.id] === true, no = state.extras[x.id] === false;
      var grupo = el('div', { class: 'extra-opts', role: 'group', 'aria-label': x.pregunta || ('¿Añadir ' + x.nombre + '?') }, [
        el('button', { type: 'button', class: 'extra-opt', 'aria-pressed': String(si), onclick: function () { state.extras[x.id] = true; renderExtras(); } }, ['Sí, añadir (+' + money.format(x.precio) + ')']),
        el('button', { type: 'button', class: 'extra-opt', 'aria-pressed': String(no), onclick: function () { state.extras[x.id] = false; renderExtras(); } }, ['No, gracias'])
      ]);
      box.appendChild(el('div', { class: 'extra' }, [
        el('p', { class: 'extra-q' }, [el('b', { text: x.pregunta || ('¿Añadir ' + x.nombre + '?') }), el('span', { class: 'extra-opc', text: ' Opcional' })]),
        x.descripcion ? el('p', { class: 'extra-desc', text: x.descripcion }) : null,
        grupo
      ]));
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
    for (var i = 0; i <= R.diasMaximos && count < 14; i++) {
      var ymd = addDays(d, i);
      if (!isOpen(ymd)) continue;
      count++;
      var u = ymdToUTC(ymd), wd = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : fmtWd.format(u).replace('.', '');
      box.appendChild(el('button', {
        type: 'button', class: 'day', 'aria-pressed': String(state.date === ymd), 'data-date': ymd,
        'aria-label': capitalize(longDate(ymd)),
        onclick: (function (v) { return function () { setDate(v); }; })(ymd)
      }, [el('small', { text: wd }), el('b', { text: String(u.getUTCDate()) }), el('span', { text: fmtMon.format(u).replace('.', '') }), el('i', { class: 'lvl', 'aria-hidden': 'true' })]));
    }
    paintDays();
  }

  // ---------- Colores de los días y «Primera hora libre» ----------
  function dayKey() { return state.service + '|' + state.barber; }
  function dayLevel(info) {
    if (!info || info.cerrado || !info.total) return '';
    if (!info.libres) return 'rojo';
    if (info.libres <= 3 || info.libres / info.total <= 0.25) return 'amarillo';
    return 'verde';
  }
  function paintDays() {
    var cache = dayCache[dayKey()] || {};
    document.querySelectorAll('#quick-days .day').forEach(function (b) {
      var ymd = b.getAttribute('data-date'), info = cache[ymd], lvl = dayLevel(info);
      b.classList.remove('lvl-verde', 'lvl-amarillo', 'lvl-rojo');
      if (lvl) b.classList.add('lvl-' + lvl);
      b.classList.toggle('has-extra', !!((info && info.extra) || fueraDia(ymd)));
      var txt = !info ? '' : !info.libres ? ' · completo' : ' · ' + info.libres + (info.libres === 1 ? ' hora libre' : ' horas libres');
      b.setAttribute('aria-label', capitalize(longDate(ymd)) + txt);
      b.title = txt.replace(' · ', '');
    });
  }
  // Pide el resumen de los próximos días (una vez por servicio y barbero) y pinta los colores
  function loadDays() {
    var key = dayKey();
    if (dayCache[key]) { paintDays(); return Promise.resolve(dayCache[key]); }
    return getDays(today(), 21, state.service, state.barber).then(function (data) {
      dayCache[key] = (data && data.dias) || {};
      if (key === dayKey()) paintDays();
      return dayCache[key];
    }).catch(function () { return {}; });   // sin colores no pasa nada: se puede seguir eligiendo día
  }
  function firstFreeIn(cache, from) {
    return Object.keys(cache).filter(function (d) { return d >= from && cache[d] && cache[d].libres > 0; }).sort()[0] || '';
  }
  // Busca el primer día con hueco (los próximos 21 y, si hace falta, más allá) y lo selecciona con su primera hora
  function goFirstFree() {
    var btn = $('#first-free'), key = dayKey();
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = 'Buscando…';
    var done = function (ymd) {
      btn.disabled = false; btn.textContent = old;
      if (!ymd) { setStatus('No quedan horas libres en los próximos ' + R.diasMaximos + ' días' + (state.barber !== 'any' ? ' con ' + barberById(state.barber).nombre + '. Prueba con «Cualquiera».' : '.'), true); return; }
      autoPickTime = true;
      setDate(ymd);
    };
    loadDays().then(function (cache) {
      var hit = firstFreeIn(cache, today());
      if (hit) return done(hit);
      // Más allá de los 21 días: de 21 en 21 hasta el máximo de reserva
      var from = addDays(today(), 21);
      (function next() {
        if (from > lastDay()) return done('');
        getDays(from, 21, state.service, state.barber).then(function (data) {
          var extra = (data && data.dias) || {};
          Object.keys(extra).forEach(function (d) { (dayCache[key] = dayCache[key] || {})[d] = extra[d]; });
          var h = firstFreeIn(extra, from);
          if (h) return done(h);
          from = addDays(from, 21); next();
        }).catch(function () { done(''); });
      })();
    });
  }

  function enterDateStep() {
    var input = $('#date');
    input.min = today();
    input.max = lastDay();
    renderQuickDays();
    var key = dayKey();
    $('#fh-banner').hidden = true; $('#first-extra').hidden = true;
    Promise.all([loadDays(), loadFuera()]).then(function () { if (key === dayKey()) pintarFuera(); });
    loadDays().then(function (cache) {
      // Si el día elegido está completo (o aún no hay día), salta al primer día con hueco
      if (key !== dayKey()) return;
      var cur = state.date && cache[state.date];
      if (!pedidoURL && !state.time && (!state.date || (cur && !cur.libres))) {
        var hit = firstFreeIn(cache, today());
        if (hit && hit !== state.date) setDate(hit);
      }
    });
    if (!state.date) {
      // Mientras llegan los colores, el primer día abierto para que el cliente vea horas al momento
      var first = document.querySelector('#quick-days .day');
      if (first) { setDate(first.getAttribute('data-date')); return; }
    }
    if (state.date) loadSlots();
    updateContinue();
  }

  function setDate(ymd) {
    state.date = ymd;
    state.time = '';
    state.extra = false;
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

    $('#espera-link').hidden = true;
    getSlots(ymd, state.service, state.barber).then(function (data) {
      if (id !== slotsRequest) return;
      box.textContent = '';
      var slots = (data && data.slots) || [];
      var extra = (data && data.extra) || [];
      if (data && data.multiplicador) MULT_EXTRA = data.multiplicador;
      $('#espera-link').hidden = false;
      if (!slots.length && !extra.length) {
        autoPickTime = false;
        setStatus(['Ese día está completo' + (state.barber !== 'any' ? ' con ' + barberById(state.barber).nombre : '') + '. ',
          el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '⚡ Ir a la primera hora libre', onclick: goFirstFree }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm espera-btn', text: 'Apuntarme a la lista de espera', onclick: abrirEspera })]);
        $('#espera-link').hidden = true;
        return;
      }
      setStatus(slots.length
        ? slots.length + (slots.length === 1 ? ' hora libre' : ' horas libres') + ' el ' + longDate(ymd) + '.'
        : null);
      if (!slots.length) setStatus([el('span', { class: 'fh-status', text: '★ ' + (barberById(data.extraBarbero || (C.horasExtra && C.horasExtra.barbero)) || { nombre: 'El barbero' }).nombre + ' ha abierto citas fuera de horario este día (precio ×' + MULT_EXTRA + ').' })]);
      var groups = [['Mañana', slots.filter(function (t) { return t < '14:00'; })], ['Tarde', slots.filter(function (t) { return t >= '14:00'; })]];
      groups.forEach(function (g) {
        if (!g[1].length) return;
        var grid = el('div', { class: 'slot-grid', role: 'group', 'aria-label': g[0] });
        g[1].forEach(function (t) {
          grid.appendChild(el('button', {
            type: 'button', class: 'slot', 'aria-pressed': String(state.time === t && !state.extra), 'data-time': t,
            onclick: function () { selectTime(t, false); }
          }, [t]));
        });
        box.appendChild(el('div', { class: 'slot-group' }, [el('h3', { text: g[0] }), grid]));
      });
      // Citas fuera de horario (precio x2): solo si el barbero las ha abierto
      if (extra.length) {
        var gx = el('div', { class: 'slot-grid', role: 'group', 'aria-label': 'Fuera de horario' });
        extra.forEach(function (t) {
          gx.appendChild(el('button', {
            type: 'button', class: 'slot slot-extra', 'aria-pressed': String(state.time === t && state.extra), 'data-time': t, 'data-extra': '1',
            'aria-label': t + ', fuera de horario, precio por ' + MULT_EXTRA,
            onclick: function () { selectTime(t, true); }
          }, [t]));
        });
        var quien = barberById(data.extraBarbero || (C.horasExtra && C.horasExtra.barbero));
        box.appendChild(el('div', { class: 'slot-group slot-group-extra' }, [
          el('h3', null, ['★ Fuera de horario', el('small', { text: (quien ? 'Con ' + quien.nombre + ' · ' : '') + 'precio ×' + MULT_EXTRA })]), gx]));
      }
      if (pedidoURL && pedidoURL.date === ymd) {
        var quiere = pedidoURL;
        pedidoURL = null;
        if ((quiere.extra ? extra : slots).indexOf(quiere.time) !== -1) { autoPickTime = false; selectTime(quiere.time, quiere.extra); }
        else setStatus('Esa hora ya la ha cogido otra persona. Mira las que quedan libres.', true);
      }
      if (autoPickTime) {
        autoPickTime = false;
        if (slots.length) selectTime(slots[0], false); else selectTime(extra[0], true);
        var sel = box.querySelector('.slot[aria-pressed="true"]');
        if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }).catch(function (err) {
      if (id !== slotsRequest) return;
      box.textContent = '';
      setStatus([err.message, el('br'), el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Reintentar', onclick: loadSlots })], true);
    });
  }

  function selectTime(t, esExtra) {
    state.time = t;
    state.extra = !!esExtra;
    document.querySelectorAll('#slots .slot').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-time') === t && (b.getAttribute('data-extra') === '1') === state.extra));
    });
    updateContinue();
  }

  // ---------- Citas fuera de horario: aviso arriba, días en dorado y «O antes, fuera de horario» ----------
  function getFuera(serviceId) {
    if (!C.horasExtra) return Promise.resolve({ dias: [] });
    if (!LIVE) return Promise.resolve({ barbero: C.horasExtra.barbero, nombre: (barberById(C.horasExtra.barbero) || {}).nombre, multiplicador: 2,
      dias: [{ f: addDays(today(), 1), horas: ['18:00', '18:30', '19:00'].filter(function (h) { return simulatedSlots(addDays(today(), 1), serviceId, 'any').indexOf(h) === -1; }) }] });
    return request(URL_BACKEND + '?action=fueraHorario&service=' + encodeURIComponent(serviceId));
  }
  function loadFuera() {
    var k = state.service;
    if (fueraCache[k]) return Promise.resolve(fueraCache[k]);
    return getFuera(k).then(function (r) { fueraCache[k] = r || { dias: [] }; return fueraCache[k]; }, function () { return { dias: [] }; });
  }
  // Solo cuenta si el barbero elegido es el de fuera de horario o «Cualquiera»
  function fueraActual() {
    var r = fueraCache[state.service];
    if (!r || !r.dias || !r.dias.length) return null;
    if (state.barber !== 'any' && state.barber !== r.barbero) return null;
    return r;
  }
  function fueraDia(ymd) { var r = fueraActual(); return !!(r && r.dias.some(function (d) { return d.f === ymd; })); }
  function cuandoCorto(ymd) {
    return ymd === today() ? 'hoy' : ymd === addDays(today(), 1) ? 'mañana' : 'el ' + longDate(ymd).replace(/ de [a-záéíóúñ]+$/i, '');
  }
  function irAFuera(f, h) {
    pedidoURL = { date: f, time: h, extra: true };
    setDate(f);
    var b = document.querySelector('#quick-days .day[data-date="' + f + '"]');
    if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
  function pintarFuera() {
    var r = fueraActual(), ban = $('#fh-banner'), btn = $('#first-extra');
    document.querySelectorAll('.fh-leyenda').forEach(function (x) { x.hidden = !r; });
    paintDays();
    if (!r) { ban.hidden = true; btn.hidden = true; return; }
    var primero = r.dias[0];
    ban.textContent = '';
    ban.appendChild(el('div', { class: 'fh-txt' }, [
      el('strong', { text: '★ Fuera de horario' }),
      el('span', { text: r.nombre + ' abre citas ' + r.dias.slice(0, 3).map(function (d) { return cuandoCorto(d.f) + ' (' + d.horas.slice(0, 4).join(' · ') + (d.horas.length > 4 ? '…' : '') + ')'; }).join(', ') + '. Precio ×' + r.multiplicador + '.' })
    ]));
    ban.appendChild(el('button', { type: 'button', class: 'btn btn-sm fh-ver', text: 'Ver horas', onclick: function () { irAFuera(primero.f, primero.horas[0]); } }));
    ban.hidden = false;
    // «O antes, fuera de horario»: si llega antes que la primera hora normal libre
    var normal = firstFreeIn(dayCache[dayKey()] || {}, today());
    var antes = !normal || primero.f <= normal;
    btn.hidden = !antes;
    if (antes) {
      btn.textContent = '★ Fuera de horario: ' + cuandoCorto(primero.f) + ' ' + primero.horas[0];
      btn.onclick = function () { irAFuera(primero.f, primero.horas[0]); };
    }
  }

  // Aviso en «Tus datos» cuando la hora elegida es fuera de horario
  function pintarNotaExtra() {
    var n = $('#extra-note');
    n.textContent = '';
    n.hidden = !state.extra;
    if (!state.extra) return;
    var svc = serviceById(state.service), ex = extrasElegidos({ service: state.service, barber: state.barber, extras: elegidosIds() });
    n.appendChild(el('strong', { text: '★ Cita fuera de horario. ' }));
    n.appendChild(document.createTextNode('El precio es el doble: ' + money.format(precioConExtras(svc, ex, true)) + '. Estas citas no se pueden cambiar online y, si no vienes, se cobra entera.'));
  }
  function elegidosIds() { return extrasDisponibles(state.service, state.barber).filter(function (x) { return state.extras[x.id] === true; }).map(function (x) { return x.id; }); }

  // ---------- Lista de espera ----------
  var FRANJAS = [['manana', 'Mañana'], ['tarde', 'Tarde'], ['todo', 'Me da igual']];
  function abrirEspera() {
    var dlg = $('#espera-modal');
    if (!dlg || !state.date) return;
    dlg.textContent = '';
    var franja = 'todo';
    var chips = el('div', { class: 'espera-franjas', role: 'group', 'aria-label': 'Franja' }, FRANJAS.map(function (f) {
      return el('button', { type: 'button', class: 'chip-opt', 'data-f': f[0], 'aria-pressed': String(f[0] === franja), onclick: function () {
        franja = f[0];
        chips.querySelectorAll('.chip-opt').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-f') === franja)); });
      } }, [f[1]]);
    }));
    var campo = function (id, label, type, extra) {
      var inp = el('input', Object.assign({ id: id, type: type, autocomplete: 'on', maxlength: '120' }, extra || {}));
      return [el('div', { class: 'field' }, [el('label', { for: id, text: label }), inp]), inp];
    };
    var fN = campo('esp-nombre', 'Nombre', 'text', { autocomplete: 'given-name' });
    var fT = campo('esp-tel', 'Teléfono', 'tel', { inputmode: 'tel', autocomplete: 'tel' });
    var fE = campo('esp-email', 'Correo', 'email', { inputmode: 'email', autocomplete: 'email', autocapitalize: 'off' });
    // Si ya ha escrito sus datos en el paso 4, se aprovechan
    if ($('#name').value) fN[1].value = ($('#name').value + ' ' + $('#surname').value).trim();
    if ($('#phone').value) fT[1].value = $('#phone').value;
    if ($('#email').value) fE[1].value = $('#email').value;
    var err = el('div', { class: 'alert', role: 'alert', hidden: '' });
    var btn = el('button', { type: 'submit', class: 'btn btn-primary btn-block', text: 'Apuntarme' });
    var quien = state.barber === 'any' ? 'cualquier barbero' : barberById(state.barber).nombre;
    var form = el('form', { novalidate: '' }, [
      el('h2', { id: 't-espera', text: 'Lista de espera' }),
      el('p', { class: 'espera-sub', text: capitalize(longDate(state.date)) + ' · ' + serviceById(state.service).nombre + ' · con ' + quien }),
      el('span', { class: 'espera-label', text: '¿Qué franja te va bien?' }), chips,
      fN[0], fT[0], fE[0],
      el('p', { class: 'espera-sub espera-privacidad' }, ['Usaremos tus datos solo para avisarte si se libera una hora. Más información en la ',
        el('a', { href: 'legal.html#privacidad', target: '_blank', text: 'política de privacidad' }), '.']),
      err,
      el('div', { class: 'espera-botones' }, [btn, el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Volver', onclick: function () { dlg.close(); } })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      var nombre = fN[1].value.trim(), tel = fT[1].value.trim(), email = fE[1].value.trim();
      var msg = !nombre ? 'Escribe tu nombre.' : tel.replace(/\D/g, '').length < 9 ? 'Escribe tu teléfono (9 cifras).' : !EMAIL_RE.test(email) ? 'Revisa el correo: debe tener la forma nombre@ejemplo.com.' : '';
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Apuntando…';
      var payload = { action: 'esperaApuntar', date: state.date, barber: state.barber, service: state.service, franja: franja, name: nombre, phone: tel, email: email, web: $('#web').value };
      var envio = LIVE ? request(URL_BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
        : new Promise(function (res) { setTimeout(function () { res({ ok: true }); }, 500); });
      envio.then(function () {
        dlg.textContent = '';
        dlg.appendChild(el('form', { method: 'dialog', class: 'espera-hecho' }, [
          el('div', { class: 'done-icon', 'aria-hidden': 'true', text: '✓' }),
          el('h2', { id: 't-espera', text: '¡Te hemos apuntado!' }),
          el('p', { text: 'Ya estás en la lista de espera del ' + longDate(state.date) + '. Nos ha llegado y lo tendremos en cuenta.' }),
          el('p', { text: 'Si se libera un hueco te avisaremos al momento: estate pendiente de tu correo y de tu WhatsApp. El primero que reserva se lo queda.' }),
          el('button', { type: 'submit', class: 'btn btn-primary btn-block', text: 'Entendido' })
        ]));
      }).catch(function (x) {
        err.textContent = x.message; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Apuntarme';
      });
    });
    dlg.appendChild(form);
    dlg.showModal();
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
      consent: $('#consent').checked, web: $('#web').value,
      extras: extrasDisponibles(state.service, state.barber).filter(function (x) { return state.extras[x.id] === true; }).map(function (x) { return x.id; }),
      extra: state.extra
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
    var p = state.result.payload, svc = serviceById(p.service), ex = extrasElegidos(p);
    var values = {
      barberia: C.negocio.nombre, servicio: nombreConExtras(svc, ex) + (p.extra ? ' (fuera de horario)' : ''), precio: money.format(precioConExtras(svc, ex, p.extra)),
      barbero: state.result.barber, fecha: longDate(p.date), hora: p.time, direccion: C.negocio.direccion
    };
    return C.textos.resumen.replace(/\{(\w+)\}/g, function (m, k) { return k in values ? values[k] : m; });
  }

  function renderDone() {
    var p = state.result.payload, svc = serviceById(p.service), ex = extrasElegidos(p);
    var rows = [
      ['Servicio', nombreConExtras(svc, ex)], ['Barbero', state.result.barber], ['Día', capitalize(longDate(p.date))],
      ['Hora', p.time + (p.extra ? ' · fuera de horario' : '')], ['Duración', svc.duracion + ' min'], ['Precio', money.format(precioConExtras(svc, ex, p.extra)) + (p.extra ? ' (×' + MULT_EXTRA + ')' : '')]
    ];
    var dl = $('#recap');
    dl.textContent = '';
    rows.forEach(function (r) { dl.appendChild(el('div', null, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])); });

    $('#done-note').textContent = LIVE
      ? C.textos.confirmacion + ' Revisa también la carpeta de spam.'
      : 'Modo simulación: no se ha creado ninguna cita ni se ha enviado ningún correo. Con la demo conectada, el cliente recibe un correo de confirmación y recordatorios 24 h y 3 h antes.';

    var start = toMin(p.time);
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(nombreConExtras(svc, ex) + ' · ' + C.negocio.nombre) +
      '&dates=' + gcalDate(p.date, start) + '/' + gcalDate(p.date, start + svc.duracion) +
      '&ctz=' + encodeURIComponent(TZ) +
      '&details=' + encodeURIComponent('Con ' + state.result.barber + '. ' + money.format(precioConExtras(svc, ex, p.extra)) + '.\nSi no puedes venir, avisa con al menos ' + R.cancelacionHoras + ' horas de antelación.') +
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
    state = { step: 1, service: null, barber: null, date: '', time: '', result: null, extras: {}, extra: false };
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
    $('#first-free').addEventListener('click', goFirstFree);
    $('#espera-abrir').addEventListener('click', abrirEspera);
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

    // Enlace del correo «Se ha quedado un hueco libre»: entra directo al día con la hora marcada
    var q = new URLSearchParams(location.search);
    if (q.get('fh') === '1' && C.horasExtra) preBarbero = C.horasExtra.barbero;
    var qs = q.get('service'), qb = q.get('barber'), qd = q.get('date');
    if (qs && serviceById(qs) && qb && barberById(qb) && /^\d{4}-\d{2}-\d{2}$/.test(qd || '') && qd >= today()) {
      pick('service', qs, '#services');
      pick('barber', qb, '#barbers');
      pedidoURL = { date: qd, time: q.get('time') || '', extra: q.get('extra') === '1' };
      state.date = qd;
      go(2);
      go(3);
      $('#date').value = qd;
    }
  }

  init();
})();
