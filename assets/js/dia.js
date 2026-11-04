/*
 * OLYMPO · Panel «Hoy» (dia.html): los clientes del día de todos los barberos y dos botones rápidos.
 *  - 💬 Recordar a todos: los que aún no han venido.
 *  - ⭐ Reseñas en Google: el mensaje para los que han venido hoy.
 * Cada botón abre WhatsApp (la aplicación del Mac o del móvil) con el mensaje ya escrito, uno detrás de otro:
 * se pulsa Enter en WhatsApp y al volver ya está el siguiente. No se envía nada solo (así WhatsApp no bloquea el número).
 * Entra con la clave del panel (la guarda panel.html o se escribe aquí una vez). Sin motor o con ?demo=1, datos de ejemplo.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG;
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  var Q = new URLSearchParams(location.search);
  var DEMO = !/^https:\/\//.test(URL_MOTOR) || Q.get('demo') === '1';
  var LS_CLAVE = 'booklab_panel_clave', LS_RECORDADOS = 'booklab_recordados', LS_RESENAS = 'olympo_resenas_pedidas';
  var RESENA = (C.resenas && C.resenas.enlace ? C.resenas.enlace.replace(/\/review$/, '') + '/review' : '');

  var $ = function (s) { return document.querySelector(s); };
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (x) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (x) { /* sin almacenamiento */ } }
  function lsJson(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (x) { return {}; } }
  function nombreB(id) { var b = C.barberos.filter(function (x) { return x.id === id; })[0]; return b ? b.nombre : id; }
  function ahoraMadrid() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { fecha: p.year + '-' + p.month + '-' + p.day, hora: ('0' + (+p.hour % 24)).slice(-2) + ':' + p.minute };
  }
  var fLarga = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function telWa(t) { var d = String(t || '').replace(/\D/g, ''); if (d.length === 9) d = '34' + d; return d.length >= 11 ? d : ''; }

  // ---------- Mensajes ----------
  function mensajeRecordatorio(c) {
    return [
      '🤖 *Book Lab · Asistente de ' + C.negocio.nombre + '*',
      '_Recordatorio automático_',
      '',
      'Hola, ' + (String(c.cliente || '').split(' ')[0] || 'cliente') + ':',
      'Te recordamos que hoy tienes cita con nosotros:',
      '',
      '📅 Hoy, ' + fLarga.format(new Date(HOY + 'T12:00:00Z')).replace(',', '') + ' a las ' + c.h,
      '✂️ ' + c.sn + ' con ' + nombreB(c.b),
      C.negocio.direccion ? '📍 ' + C.negocio.direccion : null,
      '',
      'Si no puedes venir, avísanos respondiendo a este mensaje para poder ofrecer tu hueco a otro cliente.',
      '',
      '¡Te esperamos! 💈'
    ].filter(function (l) { return l !== null; }).join('\n');
  }
  // El texto de Johan (29/10) para pedir la reseña. Otra barbería puede poner el suyo en config.js → textos.resenaWhatsapp
  // (una línea por elemento; {resena} = enlace de Google).
  function mensajeResena() {
    var propio = C.textos && C.textos.resenaWhatsapp;
    if (propio && propio.length) return propio.join('\n').replace('{resena}', RESENA);
    return [
      '🤖 *Book Lab · Asistente de ' + C.negocio.nombre + '*',
      '_Recordatorio automático_',
      '',
      '¡Gracias por elegir Olympo! ✂️💈',
      '',
      'Ha sido un placer atenderte hoy.',
      '',
      'Si has quedado contento con tu experiencia, nos ayudaría muchísimo que nos dejaras una reseña en Google. Tu valoración nos ayuda a seguir mejorando y creciendo cada día. ⭐⭐⭐⭐⭐',
      '',
      '👉 ' + RESENA,
      '',
      'Gracias por confiar en nosotros y por formar parte de la Olympo Family. ⚜️'
    ].join('\n');
  }
  function enlaceWa(c, texto) { return 'whatsapp://send?phone=' + telWa(c.tel) + '&text=' + encodeURIComponent(texto); }

  // ---------- Marcas (en este dispositivo; las de «Recordar» son las mismas que en el panel) ----------
  function marcado(k, c) { return !!lsJson(k)[c.b + ':' + c.id]; }
  function marcar(k, c) {
    var r = lsJson(k), limite = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    Object.keys(r).forEach(function (x) { if (r[x] < limite) delete r[x]; });
    r[c.b + ':' + c.id] = HOY;
    try { localStorage.setItem(k, JSON.stringify(r)); } catch (x) { /* sin almacenamiento */ }
  }

  // ---------- Red ----------
  var CLAVE = '';
  function pedir(datos) {
    if (DEMO) return new Promise(function (res) { setTimeout(function () { res(demo()); }, 300); });
    return fetch(URL_MOTOR, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(datos) })
      .then(function (r) { return r.text(); }, function () { throw new Error('No hemos podido conectar. Revisa la conexión.'); })
      .then(function (t) {
        var d; try { d = JSON.parse(t); } catch (x) { throw new Error('Respuesta inesperada. Inténtalo de nuevo.'); }
        if (d.error) { var er = new Error(d.error); er.code = d.code; throw er; }
        return d;
      });
  }

  // ---------- Estado ----------
  var HOY = ahoraMadrid().fecha, CITAS = [], filtro = '';
  function pendientesRecordar() {
    var ahora = ahoraMadrid().hora;
    return CITAS.filter(function (c) { return !c.novino && !c.cobrado && c.h > ahora && telWa(c.tel) && !marcado(LS_RECORDADOS, c) && (!filtro || c.b === filtro); });
  }
  function pendientesResena() {
    var ahora = ahoraMadrid().hora;
    return CITAS.filter(function (c) { return !c.novino && (c.cobrado || c.h <= ahora) && telWa(c.tel) && !marcado(LS_RESENAS, c) && (!filtro || c.b === filtro); });
  }

  function pintar() {
    $('#fecha').textContent = cap(fLarga.format(new Date(HOY + 'T12:00:00Z')));
    var r = pendientesRecordar(), s = pendientesResena(), ahora = ahoraMadrid().hora;
    $('#n-recordar').textContent = r.length ? r.length + (r.length === 1 ? ' por recordar' : ' por recordar') : 'Nadie pendiente ✓';
    $('#n-resena').textContent = s.length ? s.length + (s.length === 1 ? ' lista para enviar' : ' listas para enviar') : 'Todas enviadas ✓';
    $('#btn-recordar').disabled = !r.length; $('#btn-resena').disabled = !s.length;

    var fb = vaciar($('#filtro'));
    [['', 'Todos']].concat(((C.caja && C.caja.barberos) || []).map(function (b) { return [b, nombreB(b)]; })).forEach(function (f) {
      fb.appendChild(el('button', { type: 'button', class: 'cj-filtro', 'aria-pressed': filtro === f[0] ? 'true' : 'false', text: f[1], onclick: function () { filtro = f[0]; pintar(); } }));
    });

    var box = vaciar($('#lista')), lista = CITAS.filter(function (c) { return !filtro || c.b === filtro; });
    lista.forEach(function (c) {
      var rec = marcado(LS_RECORDADOS, c), res = marcado(LS_RESENAS, c), vino = !c.novino && (c.cobrado || c.h <= ahora), tel = telWa(c.tel);
      var chips = [];
      if (c.novino) chips.push(el('span', { class: 'cj-chip cj-chip-no', text: 'No vino' }));
      else if (c.cobrado) chips.push(el('span', { class: 'cj-chip cj-chip-ok', text: 'Cobrado' }));
      if (!tel) chips.push(el('span', { class: 'cj-chip cj-chip-gris', text: 'Sin teléfono' }));
      box.appendChild(el('div', { class: 'cj-cobro dia-fila' + (c.h <= ahora ? ' is-pasada' : '') }, [
        el('span', { class: 'cj-cobro-f dia-hora', text: c.h }),
        el('span', { class: 'cj-cobro-b', text: nombreB(c.b) }),
        el('span', { class: 'cj-cobro-c' }, [el('b', { text: c.cliente || 'Cliente' }), el('small', { text: c.sn })]),
        el('span', { class: 'dia-chips' }, chips),
        el('span', { class: 'dia-botones' }, tel && !c.novino ? [
          !vino ? el('a', { class: 'dia-mini' + (rec ? ' is-hecho' : ''), href: enlaceWa(c, mensajeRecordatorio(c)), title: 'Recordar por WhatsApp',
            onclick: function () { marcar(LS_RECORDADOS, c); setTimeout(pintar, 400); }, text: rec ? '💬 ✓' : '💬' }) : null,
          vino ? el('a', { class: 'dia-mini' + (res ? ' is-hecho' : ''), href: enlaceWa(c, mensajeResena()), title: 'Enviar el mensaje de reseña por WhatsApp',
            onclick: function () { marcar(LS_RESENAS, c); setTimeout(pintar, 400); }, text: res ? '⭐ ✓' : '⭐' }) : null
        ] : [])
      ]));
    });
    if (!lista.length) box.appendChild(el('p', { class: 'cj-vacia', text: 'Hoy no hay citas en la agenda.' }));
    $('#pie').textContent = 'Lo marcado (✓) se recuerda en este dispositivo. Los que reservan por la web también reciben el correo de recordatorio y el de la reseña.';
  }

  // ---------- Cola: uno detrás de otro ----------
  var COLA = null;
  function empezar(tipo) {
    var lista = tipo === 'resena' ? pendientesResena() : pendientesRecordar();
    if (!lista.length) return;
    COLA = { tipo: tipo, lista: lista, i: 0, total: lista.length };
    pintarCola(); $('#v-cola').hidden = false;
  }
  function pintarCola() {
    if (!COLA || COLA.i >= COLA.lista.length) { terminar(); return; }
    var c = COLA.lista[COLA.i], esResena = COLA.tipo === 'resena';
    $('#cola-paso').textContent = (esResena ? '⭐ Reseña' : '💬 Recordatorio') + ' · ' + (COLA.i + 1) + ' de ' + COLA.total;
    $('#cola-titulo').textContent = c.cliente || 'Cliente';
    $('#cola-sub').textContent = c.h + ' · ' + c.sn + ' · ' + nombreB(c.b);
    var a = $('#cola-abrir');
    a.href = enlaceWa(c, esResena ? mensajeResena() : mensajeRecordatorio(c));
    a.textContent = 'Abrir WhatsApp de ' + (String(c.cliente || 'cliente').split(' ')[0]);
  }
  $('#cola-abrir').addEventListener('click', function () {
    if (!COLA) return;
    var c = COLA.lista[COLA.i];
    marcar(COLA.tipo === 'resena' ? LS_RESENAS : LS_RECORDADOS, c);
    setTimeout(function () { if (COLA) { COLA.i++; pintarCola(); } }, 700);   // al volver de WhatsApp ya está el siguiente
  });
  $('#cola-saltar').addEventListener('click', function () { if (COLA) { COLA.i++; pintarCola(); } });
  $('#cola-fin').addEventListener('click', terminar);
  function terminar() { COLA = null; $('#v-cola').hidden = true; pintar(); }
  $('#btn-recordar').addEventListener('click', function () { empezar('recordar'); });
  $('#btn-resena').addEventListener('click', function () { empezar('resena'); });

  // ---------- Cargar ----------
  function cargar() {
    $('#v-login').hidden = true; $('#v-dia').hidden = false; $('#cargando-dia').hidden = false;
    HOY = ahoraMadrid().fecha;
    pedir({ action: 'cajaJefe', clave: CLAVE, desde: HOY, hasta: HOY }).then(function (r) {
      HOY = r.hoy || HOY;
      CITAS = (r.citas || []).filter(function (c) { return c.f === HOY; }).sort(function (a, b) { return a.h.localeCompare(b.h); });
      $('#cargando-dia').hidden = true;
      pintar();
    }, function (err) {
      $('#cargando-dia').hidden = true;
      if (err.code === 'CLAVE' || err.code === 'SIN_CLAVE') { lsSet(LS_CLAVE, ''); entrar(err.message); return; }
      $('#cargando-dia').hidden = false; $('#cargando-dia').textContent = err.message;
    });
  }
  function entrar(msg) {
    $('#v-dia').hidden = true; $('#v-login').hidden = false;
    $('#login-error').hidden = !msg; $('#login-error').textContent = msg || '';
  }
  $('#login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = $('#clave').value.trim(); if (!v) return;
    CLAVE = v; lsSet(LS_CLAVE, v); cargar();
  });
  $('#ir-caja').addEventListener('click', function () { try { sessionStorage.setItem('olympo_jefe_clave', CLAVE); } catch (x) { /* sin almacenamiento */ } });

  // Al volver a la página (de WhatsApp o de otra app), refrescar; cada 5 min, recargar las citas
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !COLA && CLAVE) pintar(); });
  setInterval(function () { if (!COLA && CLAVE && !document.hidden) cargar(); }, 300000);

  // ---------- Ejemplo ----------
  function demo() {
    var hoy = ahoraMadrid().fecha, n = ['Hugo P.', 'Iker S.', 'Marc V.', 'Pablo G.', 'Sergio L.', 'Óscar F.', 'Rubén C.', 'Álex M.'], hs = ['10:00', '11:30', '12:30', '13:00', '16:30', '17:00', '18:30', '19:30'];
    return { ok: true, hoy: hoy, citas: hs.map(function (h, i) {
      var bs = (C.caja && C.caja.barberos) || ['johan', 'miguel', 'ruth'], ss = ((C.caja && C.caja.servicios) || C.servicios || []).map(function (s) { return s.nombre; });
      return { id: 'd' + i, b: bs[i % bs.length], f: hoy, h: h, cliente: n[i], sn: ss[i % ss.length] || 'Corte', precio: 17, tel: i === 3 ? '' : '600000' + (100 + i), cobrado: h < '13:00', novino: i === 2 };
    }) };
  }

  // ---------- Arranque ----------
  try { CLAVE = sessionStorage.getItem('olympo_jefe_clave') || lsGet(LS_CLAVE); } catch (x) { CLAVE = lsGet(LS_CLAVE); }
  if (DEMO) CLAVE = CLAVE || 'demo';
  if (CLAVE) cargar(); else entrar('');
})();
