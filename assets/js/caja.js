/*
 * OLYMPO · Caja de cobros (caja.html), para el iPad del mostrador.
 * Barbero → cliente de hoy (o «Cobrar sin cita») → servicio (+ extras / productos) → forma de pago
 * (en efectivo, «¿cuánto te da?» y el cambio) → Guardar.
 * Panel del jefe (con PIN): cobros de hoy, semana y mes, efectivo en caja, reparto, productos,
 * previsto frente a cobrado, y corregir o anular cobros (nunca se borran: queda el historial).
 * Solo control interno: no emite tickets ni facturas.
 * Enlace del iPad: caja.html#c=CLAVE (lo escribe configurarCaja() en Apps Script). Sin motor,
 * o con ?demo=1 en local, modo simulación (PIN del jefe: 1234).
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG;
  var K = C.caja;
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  var SIN_MOTOR = !/^https:\/\//.test(URL_MOTOR) || URL_MOTOR.indexOf('PEGAR_') !== -1;
  var Q = new URLSearchParams(location.search);
  // ?demo=1: modo prueba (datos inventados, no se guarda nada). Vale también en la web real para probar en el iPad.
  var DEMO = SIN_MOTOR || Q.get('demo') === '1';
  var TIMEOUT_MS = 25000;
  var LS_CLAVE = 'olympo_caja', LS_BARBERO = 'olympo_caja_b';
  var JEFE_INACTIVO_MS = 5 * 60000;   // el panel del jefe se cierra solo a los 5 min sin tocarlo

  // ---------- Utilidades ----------
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  var eur0 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function e(n) { var x = Math.round((Number(n) || 0) * 100) / 100; return (x % 1 ? eur2 : eur0).format(x); }   // 16 € · 789,20 €
  function r2(n) { return Math.round(n * 100) / 100; }
  function num(v) { var x = parseFloat(String(v || '').replace(',', '.')); return isFinite(x) ? x : NaN; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utc(f) { return new Date(f + 'T12:00:00Z'); }
  function addDays(f, n) { var d = utc(f); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function ahoraMadrid() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return { fecha: p.year + '-' + p.month + '-' + p.day, hora: pad(+p.hour % 24) + ':' + p.minute };
  }
  var fCorta = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  var fMes = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  var fLarga = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function nombreB(id) { var b = C.barberos.filter(function (x) { return x.id === id; })[0]; return b ? b.nombre : id; }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (x) { return ''; } }
  function lsSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (x) { /* sin almacenamiento */ } }
  var PAGOS = [{ id: 'efectivo', nombre: 'Efectivo', ico: '💶' }, { id: 'tarjeta', nombre: 'Tarjeta', ico: '💳' }, { id: 'bizum', nombre: 'Bizum', ico: '📱' }];
  function nombrePago(id) { var p = PAGOS.filter(function (x) { return x.id === id; })[0]; return p ? p.nombre : id; }
  function cargando(si, txt) { $('#cargando').hidden = !si; if (si) $('#cargando span').textContent = txt || 'Guardando…'; }

  // ---------- Red ----------
  function pedir(datos) {
    if (DEMO) return demoApi(datos);
    if (!navigator.onLine) return Promise.reject(new Error('Sin conexión a internet. Revisa el wifi.'));
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(URL_MOTOR, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(datos), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); return r.text(); }, function (err) {
        clearTimeout(timer);
        throw new Error(err && err.name === 'AbortError' ? 'El sistema está tardando demasiado. Inténtalo de nuevo.' : 'No hemos podido conectar. Revisa la conexión.');
      })
      .then(function (txt) {
        var d; try { d = JSON.parse(txt); } catch (x) { throw new Error('Respuesta inesperada. Inténtalo de nuevo.'); }
        if (d && d.error) { var er = new Error(d.error); er.code = d.code; throw er; }
        return d;
      });
  }

  // ---------- Clave del iPad ----------
  var CLAVE = '';
  (function () {
    // La clave se queda en la dirección: así el icono de la pantalla de inicio del iPad (que no comparte
    // los datos con Safari) la lleva dentro. Si no hay clave, se entra con el código de la caja.
    var m = location.hash.match(/(?:^#|&)c=([A-Za-z0-9]+)/) || location.search.match(/[?&]c=([A-Za-z0-9]+)/);
    if (m) lsSet(LS_CLAVE, m[1]);
    CLAVE = DEMO ? 'demo' : (m ? m[1] : lsGet(LS_CLAVE));
  })();

  // =====================================================================
  //  CAJA
  // =====================================================================
  var B = lsGet(LS_BARBERO);
  if (K.barberos.indexOf(B) === -1) B = K.barberos[0];
  var HOY = ahoraMadrid().fecha;
  var DATOS = { citas: [], cobros: [] };
  var T = null;   // el cobro en marcha
  var ultimo = null, hechoTimer = null, pidiendo = 0;

  function nuevoTicket(cita, soloProd) {
    T = { cita: cita || null, servicio: '', otro: false, m12: false, extras: {}, productos: {}, soloProd: !!soloProd };
    if (cita) {
      var s = K.servicios.filter(function (x) { return x.id === cita.s; })[0];
      if (s) T.servicio = s.id;
      (cita.extras || []).forEach(function (id) { if (extrasDe(B).some(function (x) { return x.id === id; })) T.extras[id] = true; });
    }
  }
  function extrasDe(b) { return (K.extras || []).filter(function (x) { return !x.barberos || x.barberos.indexOf(b) !== -1; }); }
  function factor() { return T && T.cita && T.cita.extra ? 2 : 1; }   // cita fuera de horario: precio x2

  /** Lo marcado, en líneas para el motor. */
  function lineas() {
    var out = [], f = factor();
    if (T.m12) out.push({ tipo: 'm12', id: 'm12', nombre: K.m12.nombre + ' (' + K.m12.precio + ')', precio: K.m12.precio, n: 1 });
    else if (T.otro) {
      var p = num($('#t-otro-precio').value), concepto = $('#t-otro-concepto').value.trim();
      if (p > 0) out.push({ tipo: 'otro', id: 'otro', nombre: concepto || 'Otro servicio', precio: r2(p), n: 1 });
    } else if (T.servicio) {
      var s = K.servicios.filter(function (x) { return x.id === T.servicio; })[0];
      out.push({ tipo: 'servicio', id: s.id, nombre: s.nombre + (f > 1 ? ' (fuera de horario)' : ''), precio: s.precio * f, n: 1 });
    }
    extrasDe(B).forEach(function (x) { if (T.extras[x.id]) out.push({ tipo: 'extra', id: x.id, nombre: '+ ' + x.nombre, precio: x.precio * f, n: 1 }); });
    K.productos.forEach(function (p) { if (T.productos[p.id]) out.push({ tipo: 'producto', id: p.id, nombre: p.nombre, precio: p.precio, n: T.productos[p.id] }); });
    return out;
  }
  function total() { return r2(lineas().reduce(function (s, l) { return s + l.precio * l.n; }, 0)); }

  // ---------- Pintar ----------
  function pintarBarberos() {
    var box = vaciar($('#barberos'));
    K.barberos.forEach(function (id) {
      box.appendChild(el('button', { type: 'button', class: 'cj-barbero', role: 'tab', 'aria-selected': id === B ? 'true' : 'false', text: nombreB(id),
        onclick: function () {
          if (id === B) return;
          B = id; lsSet(LS_BARBERO, id); T = null;
          DATOS = DE[id] || { citas: [], cobros: [] };   // nunca las citas del barbero anterior
          pintarBarberos(); pintarTicket(); pintarCitas(); cargarHoy();
        } }));
    });
  }

  function pintarCitas() {
    var box = vaciar($('#citas')), ahora = ahoraMadrid().hora;
    var pend = DATOS.citas.filter(function (c) { return !c.cobrado; });   // lo cobrado va en «Cobrado hoy»
    $('#citas-titulo').textContent = 'Por cobrar · ' + nombreB(B);
    $('#sincita').classList.toggle('is-on', !!T && !T.cita && !T.soloProd);
    $('#soloprod').classList.toggle('is-on', !!T && T.soloProd);
    var sum = DATOS.cobros.reduce(function (s, c) { return s + c.total; }, 0);
    $('#ver-hoy').textContent = 'Cobrado hoy · ' + DATOS.cobros.length + ' · ' + e(sum);
    if (pidiendo && !DE[B]) { box.appendChild(el('p', { class: 'cj-vacia', text: 'Cargando citas de ' + nombreB(B) + '…' })); return; }
    if (!pend.length) box.appendChild(el('p', { class: 'cj-vacia', text: DATOS.citas.length ? 'No queda nadie por cobrar ✓' : 'Hoy no tiene citas en la agenda.' }));
    pend.forEach(function (c) {
      var chip = c.novino ? el('span', { class: 'cj-chip cj-chip-no', text: 'No vino' }) : c.extra ? el('span', { class: 'cj-chip cj-chip-x2', text: '×2' }) : null;
      box.appendChild(el('button', {
        type: 'button', class: 'cj-cita' + (c.h <= ahora ? ' is-pasada' : '') + (T && T.cita && T.cita.id === c.id ? ' is-sel' : ''),
        onclick: function () { nuevoTicket(c); pintarCitas(); pintarTicket(); }
      }, [el('span', { class: 'cj-cita-h', text: c.h }), el('span', { class: 'cj-cita-c' }, [el('b', { text: c.cliente || 'Cliente' }), el('small', { text: c.sn + (c.origen === 'mostrador' ? ' · mostrador' : '') })]), chip]));
    });
  }

  // «Cobrado hoy»: botoncito arriba, se abre en una ventana
  $('#ver-hoy').addEventListener('click', function () {
    var box = vaciar($('#hoy-lista')), sum = 0;
    $('#hoy-titulo').textContent = 'Cobrado hoy · ' + nombreB(B);
    DATOS.cobros.slice().reverse().forEach(function (c) {
      sum += c.total;
      box.appendChild(el('div', { class: 'cj-hoy-fila' }, [el('span', { text: c.h }), el('span', { text: c.cliente + ' · ' + c.concepto }), el('span', { text: nombrePago(c.pago) }), el('b', { text: e(c.total) })]));
    });
    if (!DATOS.cobros.length) box.appendChild(el('p', { class: 'cj-vacia', text: 'Todavía no hay cobros hoy.' }));
    $('#hoy-total').textContent = e(sum);
    $('#v-hoy').hidden = false;
  });
  $('#hoy-cerrar').addEventListener('click', function () { $('#v-hoy').hidden = true; });

  var avisoTimer = null;
  function aviso(txt) {
    var t = $('#aviso') || document.body.appendChild(el('p', { id: 'aviso', class: 'cj-aviso', role: 'status' }));
    t.textContent = txt; t.hidden = false;
    clearTimeout(avisoTimer); avisoTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function pintarTicket() {
    $('#t-error').hidden = true;
    $('#t-vacio').hidden = !!T; $('#t-form').hidden = !T;
    $('#sincita').classList.toggle('is-on', !!T && !T.cita && !T.soloProd);
    $('#soloprod').classList.toggle('is-on', !!T && T.soloProd);
    if (!T) return;
    var f = factor();

    // Cliente
    var cab = vaciar($('#t-cliente-cita'));
    $('#t-cliente').hidden = !!T.cita;
    if (T.cita) {
      cab.appendChild(el('p', { class: 'cj-cliente-nombre', text: T.cita.cliente || 'Cliente' }));
      cab.appendChild(el('p', { class: 'cj-cliente-sub', text: T.cita.h + ' · cita: ' + T.cita.sn + (T.cita.precio !== '' ? ' (' + e(T.cita.precio) + ')' : '') + (f > 1 ? ' · fuera de horario ×2' : '') }));
    } else {
      cab.appendChild(el('p', { class: 'cj-cliente-sub', text: T.soloProd ? 'Venta de producto · lo vende ' + nombreB(B) + ' · 100 % empresa' : 'Sin cita · ' + nombreB(B) }));
    }

    // Solo producto: los productos en grande, sin servicios
    var sv = vaciar($('#t-servicios'));
    $('#t-serv-label').textContent = T.soloProd ? 'Producto' : 'Servicio';
    $('#t-prod-fila').hidden = T.soloProd;
    $('#t-cliente').hidden = !!T.cita || T.soloProd;
    $('#t-otro').hidden = true;
    if (T.soloProd) {
      K.productos.forEach(function (p) {
        var n = T.productos[p.id] || 0;
        sv.appendChild(el('button', { type: 'button', class: 'cj-serv', 'aria-pressed': n ? 'true' : 'false',
          onclick: function () { T.productos[p.id] = Math.min(20, n + 1); pintarTicket(); } },
          [el('b', { text: (n ? n + '× ' : '') + p.nombre }), el('span', { text: e(p.precio) })]));
      });
      if (Object.keys(T.productos).some(function (k) { return T.productos[k]; })) {
        sv.appendChild(el('button', { type: 'button', class: 'cj-serv cj-serv-otro', onclick: function () { T.productos = {}; pintarTicket(); } },
          [el('b', { text: 'Quitar todo' }), el('span', { text: 'Para empezar de nuevo' })]));
      }
      pintarPagos();
      return;
    }

    // Servicios
    K.servicios.forEach(function (s) {
      sv.appendChild(el('button', { type: 'button', class: 'cj-serv', 'aria-pressed': !T.otro && !T.m12 && T.servicio === s.id ? 'true' : 'false',
        onclick: function () { T.servicio = T.servicio === s.id && !T.otro && !T.m12 ? '' : s.id; T.otro = false; T.m12 = false; pintarTicket(); } },
        [el('b', { text: s.nombre }), el('span', { text: e(s.precio * f) })]));
    });
    sv.appendChild(el('button', { type: 'button', class: 'cj-serv cj-serv-otro', 'aria-pressed': T.otro ? 'true' : 'false',
      onclick: function () { T.otro = !T.otro; T.m12 = false; pintarTicket(); if (T.otro) $('#t-otro-concepto').focus(); } },
      [el('b', { text: 'Otro servicio' }), el('span', { text: 'Escribe concepto y precio' })]));
    $('#t-otro').hidden = !T.otro;
    $('#t-cliente').hidden = !!T.cita;

    // Especiales del barbero, en el mismo cuadro: «+ Cejas» (Ruth, se suma) y «Cliente de Miguel (12)»
    extrasDe(B).forEach(function (x) {
      sv.appendChild(el('button', { type: 'button', class: 'cj-serv cj-serv-esp', 'aria-pressed': T.extras[x.id] ? 'true' : 'false',
        onclick: function () { T.extras[x.id] = !T.extras[x.id]; pintarTicket(); } }, [el('b', { text: '+ ' + x.nombre + ' (se suma)' }), el('span', { text: '+' + e(x.precio * f) })]));
    });
    if (K.m12 && K.m12.barbero === B) {
      sv.appendChild(el('button', { type: 'button', class: 'cj-serv cj-serv-esp', 'aria-pressed': T.m12 ? 'true' : 'false',
        onclick: function () { T.m12 = !T.m12; T.otro = false; pintarTicket(); } },
        [el('b', { text: K.m12.nombre + ' (' + K.m12.precio + ')' }), el('span', { text: e(K.m12.precio) })]));
    }

    // Productos (pequeños)
    var pr = vaciar($('#t-productos'));
    K.productos.forEach(function (p) {
      var n = T.productos[p.id] || 0;
      pr.appendChild(el('span', { class: 'cj-prod' + (n ? ' is-on' : '') }, [
        el('button', { type: 'button', class: 'cj-prod-mas', onclick: function () { T.productos[p.id] = Math.min(20, n + 1); pintarTicket(); } },
          [(n ? n + '× ' : '') + p.nombre, el('small', { text: e(p.precio) })]),
        n ? el('button', { type: 'button', class: 'cj-prod-menos', 'aria-label': 'Quitar un ' + p.nombre, text: '−',
          onclick: function () { T.productos[p.id] = n - 1; pintarTicket(); } }) : null
      ]));
    });

    pintarPagos();
  }

  // Pago: los tres botones de abajo. Tarjeta y Bizum guardan ya; Efectivo abre su pantalla.
  function pintarPagos() {
    var pg = vaciar($('#t-pagos'));
    PAGOS.forEach(function (p) {
      pg.appendChild(el('button', { type: 'button', class: 'cj-pago', 'data-pago': p.id, disabled: T.m12 && p.id !== 'efectivo',
        onclick: function () { if (p.id === 'efectivo') abrirEfectivo(); else guardar(p.id, ''); } }, [el('span', { text: p.ico }), p.nombre]));
    });
    var nota = $('#t-pago-nota');
    nota.hidden = !T.m12;
    nota.textContent = T.m12 ? 'Siempre en efectivo. ' + nombreB(B) + ' se queda ' + e(K.m12.paraBarbero) + ' y deja ' + e(K.m12.precio - K.m12.paraBarbero) + ' en la caja.' : '';
    actualizarTotal();
  }

  function listo() { return total() > 0 && !(T.otro && !(num($('#t-otro-precio').value) > 0)); }
  function actualizarTotal() {
    $('#t-total').textContent = e(total());
    var ok = listo();
    Array.prototype.forEach.call($('#t-pagos').children, function (b) { b.disabled = !ok || (T.m12 && b.getAttribute('data-pago') !== 'efectivo'); });
  }

  $('#t-otro-precio').addEventListener('input', function () { if (T) actualizarTotal(); });
  $('#t-otro-concepto').addEventListener('input', function () { if (T) actualizarTotal(); });

  $('#sincita').addEventListener('click', function () { nuevoTicket(null); $('#t-cliente').value = ''; $('#t-otro-concepto').value = ''; $('#t-otro-precio').value = ''; pintarCitas(); pintarTicket(); });
  $('#soloprod').addEventListener('click', function () { nuevoTicket(null, true); pintarCitas(); pintarTicket(); });
  $('#t-cerrar').addEventListener('click', function () { T = null; pintarCitas(); pintarTicket(); });

  // ---------- Efectivo: pantalla aparte. Se tocan los billetes que da (se suman) y sale el cambio ----------
  var DA = 0;
  function abrirEfectivo() {
    if (!listo()) return;
    DA = 0;
    var bi = vaciar($('#ef-billetes'));
    K.billetes.forEach(function (v) {
      bi.appendChild(el('button', { type: 'button', class: 'cj-ef-b' + (v < 5 ? ' is-moneda' : ''), text: v + ' €', onclick: function () { DA = r2(DA + v); pintarEfectivo(); } }));
    });
    $('#v-efectivo').hidden = false;
    pintarEfectivo();
  }
  function pintarEfectivo() {
    var tot = total(), cambio = r2(DA - tot);
    $('#ef-total').textContent = e(tot);
    $('#ef-da').textContent = DA ? e(DA) : '—';
    $('#ef-cliente').textContent = (T.cita ? T.cita.cliente || 'Cliente' : T.soloProd ? 'Venta de producto' : $('#t-cliente').value.trim() || 'Cliente de mostrador') + ' · ' + nombreB(B);
    var caja = $('#ef-cambio-caja');
    caja.classList.toggle('is-falta', DA > 0 && cambio < 0);
    $('#ef-cambio-t').textContent = !DA ? 'Toca lo que te da' : cambio < 0 ? 'Faltan' : cambio === 0 ? 'Justo, sin cambio' : 'Devuélvele';
    $('#ef-cambio').textContent = !DA ? '' : cambio < 0 ? e(-cambio) : cambio === 0 ? '✓' : e(cambio);
    $('#ef-guardar').disabled = DA > 0 && cambio < 0;
    $('#ef-guardar').textContent = DA ? 'Guardar' : 'Justo · Guardar';
  }
  $('#ef-borrar').addEventListener('click', function () { DA = 0; pintarEfectivo(); });
  $('#ef-volver').addEventListener('click', function () { $('#v-efectivo').hidden = true; });
  $('#ef-guardar').addEventListener('click', function () { guardar('efectivo', DA || total()); });

  // ---------- Guardar ----------
  function guardar(pago, ent) {
    if (!T || !listo()) return;
    var datos = { action: 'cobrar', c: CLAVE, b: B, e: T.cita ? T.cita.id : '', cliente: T.cita ? T.cita.cliente : T.soloProd ? 'Venta de producto' : $('#t-cliente').value.trim(),
      lineas: lineas(), pago: pago, entregado: ent === '' || ent === null ? '' : ent };
    cargando(true);
    pedir(datos).then(function (r) {
      cargando(false);
      $('#v-efectivo').hidden = true;
      ultimo = r.cobro;
      $('#h-linea').textContent = nombreB(B) + ' · ' + r.cobro.cliente + ' · ' + e(r.cobro.total) + ' · ' + nombrePago(r.cobro.pago);
      var cambio = r.cobro.cambio;
      $('#h-cambio').hidden = !(cambio > 0);
      $('#h-cambio-n').textContent = e(cambio);
      $('#h-deshacer').disabled = false; $('#h-deshacer').textContent = 'Deshacer';
      $('#v-hecho').hidden = false;
      clearTimeout(hechoTimer); hechoTimer = setTimeout(cerrarHecho, 3500);   // vuelve sola a la caja
      T = null; pintarTicket(); cargarHoy();
    }, function (err) {
      cargando(false);
      $('#v-efectivo').hidden = true;
      var p = $('#t-error'); p.textContent = err.message; p.hidden = false;
      if (err.code === 'YA_COBRADA') { T = null; pintarTicket(); cargarHoy(); aviso(err.message); }
      if (err.code === 'CLAVE' || err.code === 'SIN_CLAVE') sinEnlace();
    });
  }
  function cerrarHecho() { clearTimeout(hechoTimer); $('#v-hecho').hidden = true; }
  $('#h-ok').addEventListener('click', cerrarHecho);
  $('#h-deshacer').addEventListener('click', function () {
    if (!ultimo) return;
    var btn = this; btn.disabled = true; clearTimeout(hechoTimer);
    pedir({ action: 'cobroEditar', c: CLAVE, id: ultimo.id, anular: true, motivo: 'Deshecho en la caja nada más guardarlo' }).then(function () {
      btn.textContent = 'Deshecho ✓'; ultimo = null; cargarHoy(); setTimeout(cerrarHecho, 1200);
    }, function (err) { btn.disabled = false; $('#h-linea').textContent = err.message; });
  });

  // ---------- Cargar ----------
  // Citas de hoy de cada barbero, guardadas: al cambiar de barbero salen al momento (y se refrescan detrás)
  var DE = {}, pidiendoDe = {};
  function cargarHoy() {
    var b = B;
    return cargarDe(b).then(function () {
      K.barberos.forEach(function (o) { if (o !== b && !DE[o] && !pidiendoDe[o]) cargarDe(o).catch(function () { /* se reintenta al elegirlo */ }); });
    }, function () { /* el error ya se enseña */ });
  }
  function cargarDe(b) {
    pidiendoDe[b] = (pidiendoDe[b] || 0) + 1;
    if (b === B) { pidiendo = 1; pintarCitas(); }
    return pedir({ action: 'cajaHoy', c: CLAVE, b: b }).then(function (r) {
      pidiendoDe[b]--;
      DE[b] = { citas: r.citas || [], cobros: r.cobros || [] };
      HOY = r.hoy;
      if (b !== B) return;
      pidiendo = 0;
      DATOS = DE[b];
      if (T && T.cita) { var aun = DATOS.citas.filter(function (c) { return c.id === T.cita.id && !c.cobrado; })[0]; if (!aun) T = null; }
      pintarCitas(); pintarTicket();
    }, function (err) {
      pidiendoDe[b]--;
      if (b !== B) throw err;
      pidiendo = 0;
      if (err.code === 'CLAVE' || err.code === 'SIN_CLAVE') { sinEnlace(); throw err; }
      vaciar($('#citas')).appendChild(el('p', { class: 'cj-error', text: err.message + ' ' }, [el('button', { type: 'button', class: 'cj-link', text: 'Reintentar', onclick: cargarHoy })]));
      throw err;
    });
  }
  function sinEnlace() { lsSet(LS_CLAVE, ''); CLAVE = ''; $('#v-caja').hidden = true; pedirCodigo(); }

  // ---------- Entrar con código (sin enlace): el código de la caja o el PIN del jefe ----------
  var codigoTecleado = '';
  function pedirCodigo() {
    $('#v-enlace').hidden = false; codigoTecleado = ''; $('#cod-error').hidden = true;
    var puntos = function () { Array.prototype.forEach.call($('#cod-puntos').children, function (i, n) { i.classList.toggle('is-on', n < codigoTecleado.length); }); };
    puntos();
    var t = vaciar($('#cod-teclado'));
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      t.appendChild(el('button', { type: 'button', class: 'cj-tecla' + (k ? '' : ' cj-tecla-vacia'), text: k, 'aria-label': k === '⌫' ? 'Borrar' : k,
        onclick: function () {
          if (k === '⌫') codigoTecleado = codigoTecleado.slice(0, -1); else if (codigoTecleado.length < 4) codigoTecleado += k;
          puntos();
          if (codigoTecleado.length < 4) return;
          var cod = codigoTecleado; cargando(true);
          pedir({ action: 'cajaEntrar', codigo: cod }).then(function (r) {
            cargando(false); CLAVE = r.c; lsSet(LS_CLAVE, r.c);
            history.replaceState(null, '', location.pathname + location.search + '#c=' + r.c);
            $('#v-enlace').hidden = true; arrancar();
          }, function (err) {
            cargando(false); codigoTecleado = ''; puntos();
            $('#cod-error').textContent = err.message; $('#cod-error').hidden = false;
          });
        } }));
    });
  }

  function reloj() {
    var a = ahoraMadrid();
    $('#reloj').textContent = fLarga.format(utc(a.fecha)).replace(',', '') + ' · ' + a.hora;
    if (a.fecha !== HOY && !$('#v-caja').hidden && !T) { HOY = a.fecha; cargarHoy(); }   // a medianoche, el día nuevo
  }

  // =====================================================================
  //  PANEL DEL JEFE
  // =====================================================================
  var CLAVE_PANEL = '', PIN = '', pinTecleado = '', J = null, periodo = 'hoy', mesSel = '', filtroB = '', inactivo = null, verN = 40;

  $('#abrir-jefe').addEventListener('click', function () { $('#v-jefe').hidden = false; pedirPin(); tocarJefe(); });
  $('#cerrar-jefe').addEventListener('click', function () { if (CLAVE_PANEL) location.href = 'panel.html'; else cerrarJefe(); });
  function cerrarJefe() { PIN = ''; J = null; clearTimeout(inactivo); $('#v-jefe').hidden = true; $('#v-editar').hidden = true; $('#v-detalle').hidden = true; cargarHoy(); }
  // Desde el panel de la barbería («Caja y ventas») se entra con la clave del panel, sin PIN
  function jefeAuth(o) { if (CLAVE_PANEL) { o.clave = CLAVE_PANEL; delete o.pin; } else if (!o.pin) o.pin = PIN; return o; }
  function tocarJefe() { if (CLAVE_PANEL) return; clearTimeout(inactivo); inactivo = setTimeout(function () { if (!$('#v-jefe').hidden) cerrarJefe(); }, JEFE_INACTIVO_MS); }
  $('#v-jefe').addEventListener('pointerdown', tocarJefe);
  $('#v-editar').addEventListener('pointerdown', tocarJefe);
  $('#v-detalle').addEventListener('pointerdown', tocarJefe);
  $('#det-cerrar').addEventListener('click', function () { $('#v-detalle').hidden = true; });

  function pedirPin() {
    pinTecleado = ''; $('#j-pin').hidden = false; $('#j-datos').hidden = true; $('#pin-error').hidden = true; $('#periodos').hidden = true;
    pintarPuntos();
    var t = vaciar($('#pin-teclado'));
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].forEach(function (k) {
      t.appendChild(el('button', { type: 'button', class: 'cj-tecla' + (k ? '' : ' cj-tecla-vacia'), text: k, 'aria-label': k === '⌫' ? 'Borrar' : k,
        onclick: function () {
          if (k === '⌫') pinTecleado = pinTecleado.slice(0, -1);
          else if (pinTecleado.length < 4) pinTecleado += k;
          pintarPuntos();
          if (pinTecleado.length === 4) entrarJefe(pinTecleado);
        } }));
    });
    if (DEMO) { $('#pin-error').hidden = false; $('#pin-error').textContent = 'Modo simulación: el PIN es 1234.'; }
  }
  function pintarPuntos() { Array.prototype.forEach.call($('#pin-puntos').children, function (i, n) { i.classList.toggle('is-on', n < pinTecleado.length); }); }

  function rango() {
    var hoy = HOY, dow = utc(hoy).getUTCDay() || 7, lunes = addDays(hoy, 1 - dow);
    if (!mesSel) mesSel = hoy.slice(0, 7);
    var iniMes = mesSel + '-01', finMes = addDays(addDays(iniMes, 32).slice(0, 8) + '01', -1);
    if (finMes > hoy) finMes = hoy;
    // También la semana y el mes pasados (para el resumen de cada barbero)
    var lunesPasado = addDays(lunes, -7), iniMesActual = hoy.slice(0, 8) + '01', iniMesPasado = addDays(iniMesActual, -1).slice(0, 8) + '01';
    var desde = [lunesPasado, iniMesPasado, iniMes].sort()[0];
    return { hoy: hoy, lunes: lunes, iniMes: iniMes, finMes: finMes, lunesPasado: lunesPasado, iniMesActual: iniMesActual, iniMesPasado: iniMesPasado,
      desde: desde, hasta: hoy > finMes ? hoy : finMes };
  }

  function entrarJefe(pin) {
    var R = rango();
    $('#pin-error').hidden = true;
    cargando(true, 'Cargando…');
    pedir(jefeAuth({ action: 'cajaJefe', desde: R.desde, hasta: R.hasta, pin: pin })).then(function (r) {
      cargando(false); PIN = pin; J = r; HOY = r.hoy;
      $('#j-pin').hidden = true; $('#j-datos').hidden = false; $('#periodos').hidden = false;
      pintarJefe();
    }, function (err) {
      cargando(false);
      if (CLAVE_PANEL) { $('#j-cargando').hidden = false; $('#j-cargando').textContent = err.message + ' Vuelve al panel y entra otra vez.'; return; }
      pinTecleado = ''; pintarPuntos();
      if (PIN) { PIN = ''; pedirPin(); }
      $('#pin-error').textContent = err.message; $('#pin-error').hidden = false;
    });
  }
  function recargarJefe() { if (PIN || CLAVE_PANEL) entrarJefe(PIN); }

  /** Suma los cobros (no anulados) entre dos días. Todo el reparto sale de aquí. */
  var APARTE = (K.aparte && K.aparte.productos) || [];
  // «Cliente de Miguel (12)» solo si esa barbería lo usa (en la demo de Book Lab no hay)
  var HAY_M12 = !!(K.m12 && K.barberos.indexOf(K.m12.barbero) !== -1);
  function esAparte(id) { return APARTE.indexOf(id) !== -1; }
  function calcular(desde, hasta) {
    var x = { n: 0, total: 0, porPago: { efectivo: 0, tarjeta: 0, bizum: 0 }, barberos: {}, m12: 0, productos: {}, prodTotal: 0, caja: 0, aparte: { n: 0, importe: 0 } };
    K.barberos.forEach(function (b) { x.barberos[b] = { serv: 0, total: 0, n: 0, parte: 0 }; });
    K.productos.forEach(function (p) { x.productos[p.id] = { n: 0, importe: 0, nombre: p.nombre }; });
    J.cobros.forEach(function (c) {
      if (c.estado === 'anulado' || c.f < desde || c.f > hasta) return;
      var bx = x.barberos[c.b] || (x.barberos[c.b] = { serv: 0, total: 0, n: 0, parte: 0 });
      x.n++; x.total += c.total; bx.total += c.total; bx.n++;
      x.porPago[c.pago] = (x.porPago[c.pago] || 0) + c.total;
      if (c.pago === 'efectivo') x.caja += c.total - (c.m12 ? K.m12.paraBarbero : 0);   // los 10 € de Miguel no entran en la caja
      (c.lineas || []).forEach(function (l) {
        var imp = l.precio * l.n;
        if (l.tipo === 'producto') {
          var p = x.productos[l.id] || (x.productos[l.id] = { n: 0, importe: 0, nombre: l.nombre });
          p.n += l.n; p.importe += imp;
          if (esAparte(l.id)) { x.aparte.n += l.n; x.aparte.importe += imp; } else x.prodTotal += imp;   // la hucha no es de la empresa
        } else if (l.tipo === 'm12') x.m12++;
        else bx.serv += imp;
      });
    });
    var m12Empresa = K.m12.precio - K.m12.paraBarbero;
    x.empresa = { propios: 0, deBarberos: 0, m12: x.m12 * m12Empresa, productos: x.prodTotal };
    Object.keys(x.barberos).forEach(function (b) {
      var bx = x.barberos[b], pct = K.reparto[b] !== undefined ? K.reparto[b] : 0;
      bx.parte = r2(bx.serv * pct);
      if (b === K.jefe) x.empresa.propios += bx.serv - bx.parte; else x.empresa.deBarberos += bx.serv - bx.parte;
    });
    x.empresa.total = r2(x.empresa.propios + x.empresa.deBarberos + x.empresa.m12 + x.empresa.productos);
    return x;
  }

  function periodoActual() {
    var R = rango();
    if (periodo === 'hoy') return { desde: R.hoy, hasta: R.hoy, titulo: 'Hoy', largo: 'hoy' };
    if (periodo === 'semana') return { desde: R.lunes, hasta: R.hoy, titulo: 'Esta semana', largo: 'esta semana' };
    var nombreMes = fMes.format(utc(R.iniMes)); nombreMes = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
    return { desde: R.iniMes, hasta: R.finMes, titulo: nombreMes, largo: 'en ' + nombreMes.split(' ')[0].toLowerCase() };
  }

  // ---------- Detalle: cada cuadrado y cada fila del panel se puede tocar ----------
  function toque(node, fn) {
    node.classList.add('is-toque'); node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0');
    node.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    node.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); fn(); } });
    return node;
  }
  function servDe(c) { return (c.lineas || []).reduce(function (s, l) { return s + (l.tipo === 'producto' || l.tipo === 'm12' ? 0 : l.precio * l.n); }, 0); }
  function prodDe(c, id) { return (c.lineas || []).reduce(function (s, l) { return s + (l.tipo === 'producto' && (!id || l.id === id) ? l.precio * l.n : 0); }, 0); }
  function udsDe(c, id) { return (c.lineas || []).reduce(function (s, l) { return s + (l.tipo === 'producto' && l.id === id ? l.n : 0); }, 0); }
  function pctDe(b) { return K.reparto[b] !== undefined ? K.reparto[b] : 0; }
  function aparteDe(c) { return (c.lineas || []).reduce(function (s, l) { return s + (l.tipo === 'producto' && esAparte(l.id) ? l.precio * l.n : 0); }, 0); }
  function prodEmpresaDe(c) { return prodDe(c) - aparteDe(c); }
  function empresaDe(c) { return servDe(c) * (1 - pctDe(c.b)) + (c.m12 ? K.m12.precio - K.m12.paraBarbero : 0) + prodEmpresaDe(c); }
  function cobrosDe(desde, hasta, filtro) {
    return J.cobros.filter(function (c) { return c.estado !== 'anulado' && c.f >= desde && c.f <= hasta && (!filtro || filtro(c)); })
      .sort(function (a, b) { return (b.f + b.h).localeCompare(a.f + a.h); });
  }
  /** Ventana con la lista de cobros que forman un número. importe(c) = lo que cuenta de cada cobro. */
  function detalle(titulo, lista, importe, nota) {
    var box = vaciar($('#det-lista')), total = 0;
    $('#det-titulo').textContent = titulo;
    lista.forEach(function (c) {
      var imp = r2(importe(c)); total += imp;
      box.appendChild(el('button', { type: 'button', class: 'cj-cobro', onclick: function () { $('#v-detalle').hidden = true; editar(c); } }, [
        el('span', { class: 'cj-cobro-f', text: (c.f === HOY ? 'Hoy' : fCorta.format(utc(c.f))) + ' ' + c.h }),
        el('span', { class: 'cj-cobro-b', text: nombreB(c.b) }),
        el('span', { class: 'cj-cobro-c' }, [el('b', { text: c.cliente }), el('small', { text: c.concepto + (imp !== c.total ? ' · cobro de ' + e(c.total) : '') })]),
        el('span', { class: 'cj-chip cj-chip-gris', text: nombrePago(c.pago) }),
        el('span', { class: 'cj-cobro-t', text: e(imp) })
      ]));
    });
    if (!lista.length) box.appendChild(el('p', { class: 'cj-vacia', text: 'No hay nada en este periodo.' }));
    $('#det-nota').textContent = (lista.length ? lista.length + (lista.length === 1 ? ' cobro' : ' cobros') + ' · toca uno para verlo o corregirlo. ' : '') + (nota || '');
    $('#det-total').textContent = e(total);
    $('#v-detalle').hidden = false;
  }
  /** Lo mismo con las citas de la agenda (previsto). */
  function detalleCitas(titulo, citas) {
    var box = vaciar($('#det-lista')), total = 0;
    $('#det-titulo').textContent = titulo;
    citas.slice().sort(function (a, b) { return (b.f + b.h).localeCompare(a.f + a.h); }).forEach(function (c) {
      if (!c.novino) total += Number(c.precio) || 0;
      box.appendChild(el('div', { class: 'cj-cobro' }, [
        el('span', { class: 'cj-cobro-f', text: (c.f === HOY ? 'Hoy' : fCorta.format(utc(c.f))) + ' ' + c.h }),
        el('span', { class: 'cj-cobro-b', text: nombreB(c.b) }),
        el('span', { class: 'cj-cobro-c' }, [el('b', { text: c.cliente || 'Cliente' }), el('small', { text: c.sn })]),
        c.novino ? el('span', { class: 'cj-chip cj-chip-no', text: 'No vino' }) : c.cobrado ? el('span', { class: 'cj-chip cj-chip-ok', text: 'Cobrada' }) : el('span', { class: 'cj-chip cj-chip-x2', text: 'Sin cobrar' }),
        el('span', { class: 'cj-cobro-t', text: e(c.precio) })
      ]));
    });
    if (!citas.length) box.appendChild(el('p', { class: 'cj-vacia', text: 'No hay citas en este periodo.' }));
    $('#det-nota').textContent = citas.length + ' citas de la agenda. El total no cuenta los «No vino».';
    $('#det-total').textContent = e(total);
    $('#v-detalle').hidden = false;
  }

  function pintarJefe() {
    if (pintarJefe.ultimo !== periodo + mesSel + filtroB) { verN = 40; pintarJefe.ultimo = periodo + mesSel + filtroB; }
    var per = $('#periodos'); vaciar(per);
    [['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes']].forEach(function (p) {
      per.appendChild(el('button', { type: 'button', class: 'cj-periodo', role: 'tab', 'aria-selected': periodo === p[0] ? 'true' : 'false', text: p[1],
        onclick: function () { periodo = p[0]; if (p[0] !== 'mes' && mesSel !== HOY.slice(0, 7)) { mesSel = HOY.slice(0, 7); recargarJefe(); } else pintarJefe(); } }));
    });
    var P = periodoActual(), X = calcular(P.desde, P.hasta), H = calcular(HOY, HOY);
    var box = vaciar($('#j-contenido'));
    $('#j-cargando').hidden = true;

    // Cabecera del periodo (con el selector de mes)
    if (periodo === 'mes') {
      var esteMes = HOY.slice(0, 7);
      box.appendChild(el('div', { class: 'cj-mes' }, [
        el('button', { type: 'button', 'aria-label': 'Mes anterior', text: '‹', onclick: function () { mesSel = addDays(mesSel + '-01', -1).slice(0, 7); recargarJefe(); } }),
        el('h2', { text: P.titulo }),
        el('button', { type: 'button', 'aria-label': 'Mes siguiente', text: '›', disabled: mesSel >= esteMes,
          onclick: function () { mesSel = addDays(mesSel + '-01', 32).slice(0, 7); recargarJefe(); } })
      ]));
    } else {
      box.appendChild(el('div', { class: 'cj-mes' }, [el('h2', { text: P.titulo + (periodo === 'hoy' ? ' · ' + fLarga.format(utc(HOY)) : ' · desde el ' + fCorta.format(utc(P.desde))) })]));
    }

    // 1 · Caja de hoy (siempre hoy)
    var fondo = Number(J.fondo) || 0, enCaja = r2(fondo + H.caja), m12Caja = K.m12.precio - K.m12.paraBarbero;
    var efeHoy = function () { detalle('Efectivo de hoy (sin el fondo)', cobrosDe(HOY, HOY, function (c) { return c.pago === 'efectivo'; }),
      function (c) { return c.total - (c.m12 ? K.m12.paraBarbero : 0); }, (HAY_M12 ? 'De los clientes de ' + nombreB(K.m12.barbero) + ' (' + K.m12.precio + ') solo cuentan los ' + e(m12Caja) + ' que quedan en caja. ' : '') + 'Más el fondo: ' + e(fondo) + '.'); };
    var deP = function (f) { return cobrosDe(P.desde, P.hasta, f); };
    box.appendChild(el('section', { class: 'cj-grid' }, [
      toque(el('div', { class: 'cj-card cj-card-caja' }, [
        el('h4', { text: 'Efectivo que tiene que haber en caja hoy' }),
        el('p', { class: 'cj-card-n', text: e(enCaja) }),
        el('ul', { class: 'cj-card-filas' }, [
          el('li', {}, [el('span', { text: 'Fondo de caja' }), el('b', {}, [e(fondo) + ' ', el('button', { type: 'button', class: 'cj-link', text: 'cambiar', onclick: function (ev) { ev.stopPropagation(); cambiarFondo(); } })])]),
          toque(el('li', {}, [el('span', { text: 'Efectivo cobrado hoy' }), el('b', { text: e(H.caja - H.m12 * m12Caja) })]),
            function () { detalle('Efectivo cobrado hoy', cobrosDe(HOY, HOY, function (c) { return c.pago === 'efectivo' && !c.m12; }), function (c) { return c.total; }); }),
          H.m12 ? toque(el('li', {}, [el('span', { text: K.m12.nombre + ' · ' + H.m12 + ' × ' + e(m12Caja) }), el('b', { text: e(H.m12 * m12Caja) })]),
            function () { detalle(K.m12.nombre + ' · hoy (lo que queda en caja)', cobrosDe(HOY, HOY, function (c) { return c.m12; }), function () { return m12Caja; }); }) : null
        ])
      ]), efeHoy),
      toque(el('div', { class: 'cj-card' }, [
        el('h4', { text: 'Cobrado ' + P.largo }),
        el('p', { class: 'cj-card-n', text: e(X.total) }),
        el('p', { class: 'cj-card-sub', text: X.n + (X.n === 1 ? ' cobro' : ' cobros') }),
        el('ul', { class: 'cj-card-filas' }, PAGOS.map(function (p) {
          return toque(el('li', {}, [el('span', { text: p.ico + ' ' + p.nombre }), el('b', { text: e(X.porPago[p.id] || 0) })]),
            function () { detalle(p.nombre + ' · ' + P.titulo, deP(function (c) { return c.pago === p.id; }), function (c) { return c.total; }); });
        }))
      ]), function () { detalle('Cobrado · ' + P.titulo, deP(), function (c) { return c.total; }); })
    ]));

    // 2 · Reparto
    var otros = K.barberos.filter(function (b) { return b !== K.jefe; });
    var conPct = otros.filter(function (b) { return K.reparto[b] < 1; }), enteros = otros.filter(function (b) { return K.reparto[b] >= 1; });
    var tarjetas = [];
    var R0 = rango(), MES = periodo === 'mes' ? X : calcular(R0.iniMes, R0.finMes);
    conPct.forEach(function (b) {
      var bx = X.barberos[b], pct = Math.round(K.reparto[b] * 100);
      tarjetas.push(toque(el('div', { class: 'cj-card cj-pagar' }, [
        el('h4', { text: 'Le pagas a ' + nombreB(b) + ' · ' + P.largo }),
        el('p', { class: 'cj-card-n', text: e(bx.parte) }),
        el('p', { class: 'cj-card-sub', text: 'El ' + pct + ' % de sus servicios (' + e(bx.serv) + '). ' + (HAY_M12 ? 'Sin contar sus clientes de ' + K.m12.precio + ' € ni productos.' : 'Sin contar productos.') }),
        periodo !== 'mes' ? el('p', { class: 'cj-pagar-mes' }, ['A final de mes (llevas): ', el('b', { text: e(MES.barberos[b].parte) })]) : null
      ]), function () {
        detalle('Servicios de ' + nombreB(b) + ' · ' + P.titulo + ' · el ' + pct + ' % para él', deP(function (c) { return c.b === b && servDe(c) > 0; }),
          function (c) { return servDe(c) * K.reparto[b]; }, 'Cada fila es su ' + pct + ' % del servicio. ' + (HAY_M12 ? 'Sin sus clientes de ' + K.m12.precio + ' € ni productos.' : 'Sin productos.'));
      }));
    });
    enteros.forEach(function (b) {
      var bx = X.barberos[b];
      tarjetas.push(toque(el('div', { class: 'cj-card' }, [
        el('h4', { text: 'Para ' + nombreB(b) + ' · 100 %' }),
        el('p', { class: 'cj-card-n', text: e(bx.parte) }),
        el('p', { class: 'cj-card-sub', text: 'Todo lo de sus servicios.' })
      ]), function () { detalle('Servicios de ' + nombreB(b) + ' · ' + P.titulo, deP(function (c) { return c.b === b && servDe(c) > 0; }), function (c) { return servDe(c) * pctDe(b); }); }));
    });
    var E = X.empresa, m12E = K.m12.precio - K.m12.paraBarbero;
    tarjetas.push(toque(el('div', { class: 'cj-card cj-empresa' }, [
      el('h4', { text: 'Para ti (empresa)' }),
      el('p', { class: 'cj-card-n', text: e(E.total) }),
      el('ul', { class: 'cj-card-filas' }, [
        toque(el('li', {}, [el('span', { text: 'Tus servicios' }), el('b', { text: e(E.propios) })]),
          function () { detalle('Tus servicios · ' + P.titulo, deP(function (c) { return c.b === K.jefe && servDe(c) > 0; }), servDe); }),
      ].concat(conPct.map(function (b) {
        var pe = Math.round((1 - K.reparto[b]) * 100);
        return toque(el('li', {}, [el('span', { text: pe + ' % de ' + nombreB(b) }), el('b', { text: e(X.barberos[b].serv - X.barberos[b].parte) })]),
          function () { detalle('El ' + pe + ' % de ' + nombreB(b) + ' para ti · ' + P.titulo, deP(function (c) { return c.b === b && servDe(c) > 0; }), function (c) { return servDe(c) * (1 - K.reparto[b]); }); });
      }), [
        HAY_M12 ? toque(el('li', {}, [el('span', { text: K.m12.nombre + ' · ' + X.m12 + ' × ' + e(m12E) }), el('b', { text: e(E.m12) })]),
          function () { detalle(K.m12.nombre + ' · ' + P.titulo + ' · ' + e(m12E) + ' para ti', deP(function (c) { return c.m12; }), function () { return m12E; }); }) : null,
        toque(el('li', {}, [el('span', { text: APARTE.length ? 'Productos (sin la hucha)' : 'Productos' }), el('b', { text: e(E.productos) })]),
          function () { detalle('Productos para la empresa · ' + P.titulo, deP(function (c) { return prodEmpresaDe(c) > 0; }), prodEmpresaDe); })
      ]))
    ]), function () { detalle('Para ti (empresa) · ' + P.titulo, deP(function (c) { return empresaDe(c) > 0; }), empresaDe, 'Cada fila es la parte de la empresa de ese cobro.'); }));
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Reparto · ' + P.titulo }),
      el('div', { class: 'cj-reparto' }, tarjetas),
      !HAY_M12 ? null : toque(el('div', { class: 'cj-info' }, [
        el('span', {}, [el('b', { text: K.m12.nombre + ' (' + K.m12.precio + ')' }), ' · solo informativo, no se suma a lo que le pagas']),
        el('span', {}, [X.m12 + (X.m12 === 1 ? ' cliente' : ' clientes') + ' × ' + e(K.m12.paraBarbero) + ' = ', el('b', { text: e(X.m12 * K.m12.paraBarbero) }), ' que ya se ha llevado en mano'])
      ]), function () { detalle(K.m12.nombre + ' · ' + P.titulo + ' · en mano', deP(function (c) { return c.m12; }), function () { return K.m12.paraBarbero; }, 'Solo informativo: no se suma a lo que le pagas.'); })
    ]));

    // 2b · Resumen de cada barbero a porcentaje (Miguel): su sueldo y lo de la empresa, por semanas y meses
    conPct.forEach(function (b) {
      var pct = K.reparto[b], p100 = Math.round(pct * 100), RR = rango();
      var tramos = [
        ['Esta semana', RR.lunes, RR.hoy], ['Semana pasada', RR.lunesPasado, addDays(RR.lunes, -1)],
        ['Este mes', RR.iniMesActual, RR.hoy], ['Mes pasado', RR.iniMesPasado, addDays(RR.iniMesActual, -1)]
      ];
      var filasB = [['Servicios hechos', function (Y) { return Y.barberos[b].serv; }, function (c) { return servDe(c); }, function (c) { return c.b === b && servDe(c) > 0; }],
        ['Su sueldo (' + p100 + ' %)', function (Y) { return Y.barberos[b].parte; }, function (c) { return servDe(c) * pct; }, function (c) { return c.b === b && servDe(c) > 0; }, 'sueldo'],
        ['Para la empresa (' + (100 - p100) + ' %)', function (Y) { return Y.barberos[b].serv - Y.barberos[b].parte; }, function (c) { return servDe(c) * (1 - pct); }, function (c) { return c.b === b && servDe(c) > 0; }, 'empresa']];
      if (b === K.m12.barbero) {
        filasB.push(['Sus clientes de ' + K.m12.precio + ' € (en mano ' + e(K.m12.paraBarbero) + ' c/u)', function (Y) { return Y.m12 * K.m12.paraBarbero; }, function () { return K.m12.paraBarbero; }, function (c) { return c.m12; }]);
        filasB.push(['Empresa de sus clientes de ' + K.m12.precio + ' €', function (Y) { return Y.m12 * (K.m12.precio - K.m12.paraBarbero); }, function () { return K.m12.precio - K.m12.paraBarbero; }, function (c) { return c.m12; }, 'empresa']);
        filasB.push(['Total para la empresa', function (Y) { return Y.barberos[b].serv - Y.barberos[b].parte + Y.m12 * (K.m12.precio - K.m12.paraBarbero); },
          function (c) { return servDe(c) * (1 - pct) + (c.m12 ? K.m12.precio - K.m12.paraBarbero : 0); }, function (c) { return c.b === b && (servDe(c) > 0 || c.m12); }, 'total']);
      }
      var calc = tramos.map(function (t) { return calcular(t[1], t[2]); });
      box.appendChild(el('section', { class: 'cj-sec' }, [
        el('h3', { text: '💈 ' + nombreB(b) + ' · su sueldo y lo de la empresa' }),
        el('div', { class: 'cj-card cj-barbero-res' }, [
          el('table', { class: 'cj-tabla' }, [
            el('thead', {}, [el('tr', {}, [el('th', { text: '' })].concat(tramos.map(function (t) { return el('th', { text: t[0] }); })))]),
            el('tbody', {}, filasB.map(function (fb) {
              return el('tr', { class: fb[4] ? 'is-' + fb[4] : '' }, [el('td', { text: fb[0] })].concat(tramos.map(function (t, i) {
                return toque(el('td', { text: e(fb[1](calc[i])) }), function () {
                  detalle(nombreB(b) + ' · ' + fb[0] + ' · ' + t[0].toLowerCase(), cobrosDe(t[1], t[2], fb[3]), fb[2]);
                });
              })));
            }))
          ]),
          el('p', { class: 'cj-card-sub', text: 'Toca cualquier cifra para ver los cobros. «Su sueldo» es lo que le pagas' + (HAY_M12 && b === K.m12.barbero ? '; lo de sus clientes de ' + K.m12.precio + ' € ya se lo lleva en mano y no se suma.' : '.') })
        ])
      ]));
    });

    // 3 · Previsto y cobrado
    var filas = [], tp = 0, tc = 0;
    K.barberos.forEach(function (b) {
      var citas = J.citas.filter(function (c) { return c.b === b && !c.novino && c.f >= P.desde && c.f <= P.hasta; });
      var prev = citas.reduce(function (s, c) { return s + (Number(c.precio) || 0); }, 0);
      var cob = X.barberos[b] ? X.barberos[b].serv + (b === K.m12.barbero ? X.m12 * K.m12.precio : 0) : 0;
      tp += prev; tc += cob;
      filas.push(toque(el('tr', {}, [el('td', { text: nombreB(b) + ' ›' }), el('td', { text: citas.length }), el('td', { text: e(prev) }), el('td', { text: e(cob) }), difCelda(cob - prev)]),
        function () { detalleCitas('Agenda de ' + nombreB(b) + ' · ' + P.titulo, J.citas.filter(function (c) { return c.b === b && c.f >= P.desde && c.f <= P.hasta; })); }));
    });
    filas.push(el('tr', { class: 'is-total' }, [el('td', { text: 'Total' }), el('td', { text: '' }), el('td', { text: e(tp) }), el('td', { text: e(tc) }), difCelda(tc - tp)]));
    var pendientes = J.citas.filter(function (c) { return c.f === HOY && !c.novino && !c.cobrado && c.h <= J.ahora; });
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Previsto (agenda) y cobrado de verdad · servicios' }),
      el('div', { class: 'cj-card' }, [
        el('table', { class: 'cj-tabla' }, [el('thead', {}, [el('tr', {}, ['Barbero', 'Citas', 'Previsto', 'Cobrado', 'Diferencia'].map(function (t) { return el('th', { text: t }); }))]), el('tbody', {}, filas)]),
        el('p', { class: 'cj-card-sub', text: 'Previsto: citas de la agenda (sin los «No vino»). Cobrado: lo guardado en la caja, sin productos.' +
          (pendientes.length ? ' Hoy quedan ' + pendientes.length + ' citas ya pasadas sin cobrar: ' + pendientes.map(function (c) { return c.h + ' ' + (c.cliente || '') + ' (' + nombreB(c.b) + ')'; }).join(', ') + '.' : '') })
      ])
    ]));

    // 3b · Hucha de viajes (aparte: no suma en la empresa)
    if (APARTE.length) {
      var A = J.aparte || { anio: HOY.slice(0, 4), n: 0, importe: 0, meses: {} };
      var nomA = K.aparte.icono + ' ' + K.aparte.nombre;
      var mesesA = Object.keys(A.meses || {}).sort().reverse();
      var fMesCorto = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' });
      box.appendChild(el('section', { class: 'cj-sec' }, [
        el('h3', { text: K.aparte.nombre + ' · aparte, no suma en lo tuyo' }),
        el('div', { class: 'cj-grid' }, [
          toque(el('div', { class: 'cj-card cj-hucha' }, [
            el('h4', { text: nomA + ' · ' + P.titulo }),
            el('p', { class: 'cj-card-n', text: e(X.aparte.importe) }),
            el('p', { class: 'cj-card-sub', text: X.aparte.n + (X.aparte.n === 1 ? ' vendido' : ' vendidos') + ' (' + APARTE.map(function (id) { return (K.productos.filter(function (p) { return p.id === id; })[0] || {}).nombre || id; }).join(', ') + ')' })
          ]), function () { detalle(nomA + ' · ' + P.titulo, deP(function (c) { return aparteDe(c) > 0; }), aparteDe, 'Este dinero no cuenta en lo de la empresa.'); }),
          el('div', { class: 'cj-card cj-hucha' }, [
            el('h4', { text: nomA + ' · queda en ' + A.anio }),
            el('p', { class: 'cj-card-n', text: e((A.importe || 0) - (A.sacado || 0)) }),
            el('ul', { class: 'cj-card-filas' }, [
              el('li', {}, [el('span', { text: 'Vendido en el año · ' + A.n }), el('b', { text: e(A.importe) })]),
              el('li', {}, [el('span', { text: 'Sacado (pedidos)' }), el('b', { text: '− ' + e(A.sacado || 0) })])
            ].concat((A.salidas || []).slice().sort(function (a, b) { return b.f.localeCompare(a.f); }).map(function (s) {
              return toque(el('li', { class: 'cj-salida' }, [el('span', { text: fCorta.format(utc(s.f)) + ' · ' + s.concepto }), el('b', { text: '− ' + e(s.importe) })]), function () { quitarSalida(s); });
            })).concat(mesesA.map(function (m) {
              var mm = A.meses[m], nom = fMesCorto.format(utc(m + '-15'));
              return el('li', {}, [el('span', { text: 'Vendido en ' + nom + ' · ' + mm.n }), el('b', { text: e(mm.importe) })]);
            }))),
            el('button', { type: 'button', class: 'cj-btn cj-btn-borde cj-hucha-btn', text: '➖ Sacar de la hucha', onclick: sacarHucha })
          ])
        ])
      ]));
    }

    // 4 · Productos
    var prods = Object.keys(X.productos).map(function (id) { return X.productos[id]; });
    var maxN = Math.max.apply(null, prods.map(function (p) { return p.n; }).concat([1]));
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Ventas de productos · ' + P.titulo + ' · ' + e(X.prodTotal + X.aparte.importe) + (APARTE.length ? ' (con la hucha)' : '') }),
      el('div', { class: 'cj-card' }, [el('div', { class: 'cj-barras' }, prods.sort(function (a, b) { return b.n - a.n; }).map(function (p) {
        var pid = Object.keys(X.productos).filter(function (k) { return X.productos[k] === p; })[0];
        return toque(el('div', { class: 'cj-barra' }, [el('span', { text: p.nombre + (esAparte(pid) ? ' ✈️' : '') }), el('span', { class: 'cj-barra-fondo' }, [el('i', { style: 'width:' + Math.round(p.n / maxN * 100) + '%' })]),
          el('b', {}, [p.n + ' ', el('small', { text: '· ' + e(p.importe) })])]),
          function () { detalle(p.nombre + ' · ' + P.titulo + ' · ' + p.n + ' vendidos', deP(function (c) { return udsDe(c, pid) > 0; }), function (c) { return prodDe(c, pid); }); });
      })), (function () {
        // Quién vende más productos
        var porB = K.barberos.map(function (b) {
          var cs = deP(function (c) { return c.b === b && prodDe(c) > 0; });
          return { b: b, n: cs.reduce(function (s, c) { return s + (c.lineas || []).reduce(function (t, l) { return t + (l.tipo === 'producto' ? l.n : 0); }, 0); }, 0), cs: cs };
        }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n; });
        return porB.length ? el('p', { class: 'cj-card-sub cj-quien' }, ['Quién vende más: '].concat(porB.map(function (x, i) {
          return toque(el('span', { class: 'cj-quien-b', text: (i ? ' · ' : '') + nombreB(x.b) + ' ' + x.n }), function () { detalle('Productos que ha vendido ' + nombreB(x.b) + ' · ' + P.titulo, x.cs, prodDe); });
        }))) : null;
      })()])
    ]));

    // 4b · Servicios más vendidos
    var serv = {};
    deP().forEach(function (c) {
      (c.lineas || []).forEach(function (l) {
        if (l.tipo === 'producto') return;
        var k = l.tipo === 'otro' ? 'otro:' + l.nombre.toLowerCase() : l.tipo === 'm12' ? 'm12' : l.id;
        var s = serv[k] || (serv[k] = { nombre: l.tipo === 'm12' ? K.m12.nombre + ' (' + K.m12.precio + ')' : l.nombre.replace(' (fuera de horario)', ''), n: 0, importe: 0, k: k });
        s.n += l.n; s.importe += l.precio * l.n;
      });
    });
    var servs = Object.keys(serv).map(function (k) { return serv[k]; }).sort(function (a, b) { return b.n - a.n || b.importe - a.importe; });
    var maxS = Math.max.apply(null, servs.map(function (s) { return s.n; }).concat([1]));
    var tieneServ = function (k) { return function (c) { return (c.lineas || []).some(function (l) { return l.tipo !== 'producto' && (l.tipo === 'otro' ? 'otro:' + l.nombre.toLowerCase() : l.tipo === 'm12' ? 'm12' : l.id) === k; }); }; };
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Servicios más vendidos · ' + P.titulo }),
      el('div', { class: 'cj-card' }, [servs.length ? el('div', { class: 'cj-barras' }, servs.map(function (s) {
        return toque(el('div', { class: 'cj-barra' }, [el('span', { text: s.nombre }), el('span', { class: 'cj-barra-fondo' }, [el('i', { style: 'width:' + Math.round(s.n / maxS * 100) + '%' })]),
          el('b', {}, [s.n + ' ', el('small', { text: '· ' + e(s.importe) })])]),
          function () { detalle(s.nombre + ' · ' + P.titulo + ' · ' + s.n, deP(tieneServ(s.k)), function (c) { return (c.lineas || []).reduce(function (t, l) { return t + (tieneServ(s.k)({ lineas: [l] }) ? l.precio * l.n : 0); }, 0); }); });
      })) : el('p', { class: 'cj-vacia', text: 'Aún no hay servicios cobrados en este periodo.' })])
    ]));

    // 5 · Lista de cobros
    var lista = J.cobros.filter(function (c) { return c.f >= P.desde && c.f <= P.hasta && (!filtroB || c.b === filtroB); })
      .sort(function (a, b) { return (b.f + b.h).localeCompare(a.f + a.h); });
    var filtros = el('div', { class: 'cj-filtros' }, [['', 'Todos']].concat(K.barberos.map(function (b) { return [b, nombreB(b)]; })).map(function (f) {
      return el('button', { type: 'button', class: 'cj-filtro', 'aria-pressed': filtroB === f[0] ? 'true' : 'false', text: f[1], onclick: function () { filtroB = f[0]; pintarJefe(); } });
    }));
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Cobros · ' + P.titulo + ' · toca uno para corregirlo' }), filtros,
      lista.length ? el('div', { class: 'cj-lista' }, lista.slice(0, verN).map(function (c) {
        return el('button', { type: 'button', class: 'cj-cobro' + (c.estado === 'anulado' ? ' is-anulado' : ''), onclick: function () { editar(c); } }, [
          el('span', { class: 'cj-cobro-f', text: (c.f === HOY ? 'Hoy' : fCorta.format(utc(c.f))) + ' ' + c.h }),
          el('span', { class: 'cj-cobro-b', text: nombreB(c.b) }),
          el('span', { class: 'cj-cobro-c' }, [el('b', { text: c.cliente }), el('small', { text: c.concepto })]),
          c.estado !== 'ok' ? el('span', { class: 'cj-chip ' + (c.estado === 'anulado' ? 'cj-chip-no' : 'cj-chip-x2'), text: c.estado === 'anulado' ? 'Anulado' : 'Corregido' })
            : el('span', { class: 'cj-chip cj-chip-gris', text: nombrePago(c.pago) }),
          el('span', { class: 'cj-cobro-t', text: e(c.total) })
        ]);
      })) : el('p', { class: 'cj-vacia', text: 'No hay cobros en este periodo.' }),
      lista.length > verN ? el('button', { type: 'button', class: 'cj-filtro cj-mas', text: 'Ver más (' + (lista.length - verN) + ')', onclick: function () { verN += 80; pintarJefe(); } }) : null
    ]));

    box.appendChild(el('p', { class: 'cj-pie' }, ['Solo control interno: no son tickets ni facturas. Nada se borra: lo corregido o anulado queda en el historial. ',
      J.hoja ? el('a', { href: J.hoja, target: '_blank', rel: 'noopener', text: 'Abrir la hoja de Google (pestaña «Cobros»)' }) : null, ' · ',
      J.conta ? el('a', { href: J.conta, target: '_blank', rel: 'noopener', text: 'Abrir la contabilidad' }) : null]));
    box.appendChild(el('section', { class: 'cj-sec' }, [
      el('h3', { text: 'Entrar en la caja' }),
      el('div', { class: 'cj-card' }, [
        el('h4', { text: 'Código de la caja para los barberos' }),
        el('p', { class: 'cj-card-sub', text: (J.tieneCodigo ? 'Ya hay un código puesto.' : 'Aún no hay código.') + ' Se pide solo si el iPad pierde la caja. Tu PIN de jefe también vale para entrar.' }),
        el('button', { type: 'button', class: 'cj-btn cj-btn-borde', style: 'margin-top:12px', text: J.tieneCodigo ? 'Cambiar el código' : 'Poner el código', onclick: cambiarCodigo })
      ]),
      el('div', { class: 'cj-card', style: 'margin-top:14px' }, [
        el('h4', { text: 'Tu PIN de jefe' }),
        el('p', { class: 'cj-card-sub', text: '4 cifras. Solo para ti: abre este panel.' }),
        el('button', { type: 'button', class: 'cj-btn cj-btn-borde', style: 'margin-top:12px', text: 'Cambiar mi PIN', onclick: cambiarPin })
      ])
    ]));
  }
  function difCelda(d) { d = r2(d); return el('td', { class: d < 0 ? 'cj-neg' : d > 0 ? 'cj-pos' : '', text: (d > 0 ? '+' : '') + e(d) }); }

  function sacarHucha() {
    var v = prompt('¿Cuánto sacas de la hucha? (€)', '');
    if (v === null) return;
    var n = num(v);
    if (!(n > 0)) { alert('Escribe un importe válido.'); return; }
    var concepto = prompt('¿Para qué? (concepto)', 'Pedido de vapers');
    if (concepto === null) return;
    cargando(true);
    pedir(jefeAuth({ action: 'huchaSacar', importe: n, concepto: concepto })).then(function (r) { cargando(false); J.aparte = r.aparte; pintarJefe(); aviso('Apuntado: −' + e(n) + ' de la hucha.'); },
      function (err) { cargando(false); alert(err.message); });
  }
  function quitarSalida(s) {
    if (!confirm('¿Quitar esta salida de la hucha?\n' + s.concepto + ' · ' + e(s.importe))) return;
    cargando(true);
    pedir(jefeAuth({ action: 'huchaQuitar', id: s.id })).then(function (r) { cargando(false); J.aparte = r.aparte; pintarJefe(); },
      function (err) { cargando(false); alert(err.message); });
  }

  function cambiarPin() {
    var v = prompt('Tu PIN nuevo de jefe (4 cifras):', '');
    if (v === null) return;
    v = v.trim();
    if (!/^\d{4}$/.test(v)) { alert('Tienen que ser 4 cifras.'); return; }
    if (prompt('Repite el PIN nuevo:', '') !== v) { alert('No coinciden. No se ha cambiado.'); return; }
    cargando(true);
    pedir(jefeAuth({ action: 'cajaPin', nuevo: v })).then(function () { cargando(false); PIN = v; aviso('PIN cambiado.'); },
      function (err) { cargando(false); alert(err.message); });
  }

  function cambiarCodigo() {
    var v = prompt('Código de la caja (4 cifras) para los barberos:', '');
    if (v === null) return;
    v = v.trim();
    if (!/^\d{4}$/.test(v)) { alert('Tienen que ser 4 cifras.'); return; }
    cargando(true);
    pedir(jefeAuth({ action: 'cajaCodigo', codigo: v })).then(function () { cargando(false); J.tieneCodigo = true; pintarJefe(); aviso('Código de la caja guardado.'); },
      function (err) { cargando(false); alert(err.message); });
  }

  function cambiarFondo() {
    var v = prompt('Fondo de caja de hoy (€):', String(J.fondo));
    if (v === null) return;
    var n = num(v);
    if (!(n >= 0)) { alert('Escribe un importe válido.'); return; }
    cargando(true);
    pedir(jefeAuth({ action: 'cajaFondo', importe: n })).then(function (r) { cargando(false); J.fondo = r.fondo; pintarJefe(); }, function (err) { cargando(false); alert(err.message); });
  }

  // ---------- Corregir o anular un cobro ----------
  function editar(c) {
    var E = { b: c.b, pago: c.pago, cliente: c.cliente, lineas: JSON.parse(JSON.stringify(c.lineas || [])) };
    var cuerpo = vaciar($('#e-cuerpo'));
    $('#e-titulo').textContent = (c.estado === 'anulado' ? 'Cobro anulado' : 'Corregir cobro') + ' · ' + (c.f === HOY ? 'hoy' : fCorta.format(utc(c.f))) + ' ' + c.h;
    $('#v-editar').hidden = false;
    var soloVer = c.estado === 'anulado';

    function selectB() {
      var s = el('select', { class: 'cj-select', 'aria-label': 'Barbero', disabled: soloVer }, K.barberos.map(function (b) { return el('option', { value: b, text: nombreB(b), selected: b === E.b }); }));
      s.addEventListener('change', function () { E.b = s.value; });
      return s;
    }
    function selectPago() {
      var s = el('select', { class: 'cj-select', 'aria-label': 'Forma de pago', disabled: soloVer }, PAGOS.map(function (p) { return el('option', { value: p.id, text: p.nombre, selected: p.id === E.pago }); }));
      s.addEventListener('change', function () { E.pago = s.value; });
      return s;
    }
    var lineasBox = el('div');
    function pintarLineas() {
      vaciar(lineasBox);
      E.lineas.forEach(function (l, i) {
        var nIn = el('input', { class: 'cj-input cj-input-num cj-e-n', type: 'text', inputmode: 'numeric', value: l.n, 'aria-label': 'Cantidad', disabled: soloVer || l.tipo === 'm12' });
        var pIn = el('input', { class: 'cj-input cj-input-num', type: 'text', inputmode: 'decimal', value: l.precio, 'aria-label': 'Precio', disabled: soloVer || l.tipo === 'm12' });
        nIn.addEventListener('input', function () { l.n = Math.max(1, parseInt(nIn.value, 10) || 1); totalE(); });
        pIn.addEventListener('input', function () { l.precio = num(pIn.value); totalE(); });
        lineasBox.appendChild(el('div', { class: 'cj-e-fila' }, [el('span', { text: l.nombre }), nIn, pIn,
          soloVer ? null : el('button', { type: 'button', class: 'cj-e-quitar', 'aria-label': 'Quitar', text: '✕', onclick: function () { E.lineas.splice(i, 1); pintarLineas(); } })]));
      });
      if (!soloVer) {
        var add = el('select', { class: 'cj-select', 'aria-label': 'Añadir' }, [el('option', { value: '', text: '＋ Añadir servicio o producto…' })]
          .concat(K.servicios.map(function (s) { return el('option', { value: 's:' + s.id, text: s.nombre + ' · ' + e(s.precio) }); }))
          .concat(K.extras.map(function (x) { return el('option', { value: 'x:' + x.id, text: '+ ' + x.nombre + ' · ' + e(x.precio) }); }))
          .concat(K.productos.map(function (p) { return el('option', { value: 'p:' + p.id, text: p.nombre + ' · ' + e(p.precio) }); })));
        add.addEventListener('change', function () {
          var v = add.value.split(':'), it;
          if (v[0] === 's') { it = K.servicios.filter(function (s) { return s.id === v[1]; })[0]; E.lineas.push({ tipo: 'servicio', id: it.id, nombre: it.nombre, precio: it.precio, n: 1 }); }
          if (v[0] === 'x') { it = K.extras.filter(function (s) { return s.id === v[1]; })[0]; E.lineas.push({ tipo: 'extra', id: it.id, nombre: '+ ' + it.nombre, precio: it.precio, n: 1 }); }
          if (v[0] === 'p') { it = K.productos.filter(function (s) { return s.id === v[1]; })[0]; E.lineas.push({ tipo: 'producto', id: it.id, nombre: it.nombre, precio: it.precio, n: 1 }); }
          pintarLineas();
        });
        lineasBox.appendChild(el('div', { class: 'cj-e-fila' }, [add]));
      }
      totalE();
    }
    var totalTxt = el('strong');
    function totalE() { totalTxt.textContent = e(E.lineas.reduce(function (s, l) { return s + (Number(l.precio) || 0) * l.n; }, 0)); }
    var cliIn = el('input', { class: 'cj-input', type: 'text', value: c.cliente, 'aria-label': 'Cliente', disabled: soloVer });
    cliIn.addEventListener('input', function () { E.cliente = cliIn.value; });
    var motivo = el('input', { class: 'cj-input', type: 'text', placeholder: 'Motivo (obligatorio): p. ej. «se le cobró Full Combo»', maxlength: '200' });
    var err = el('p', { class: 'cj-error', role: 'alert', hidden: true });

    cuerpo.appendChild(el('div', { class: 'cj-e-fila' }, [cliIn]));
    cuerpo.appendChild(el('div', { class: 'cj-e-fila' }, [selectB(), selectPago()]));
    cuerpo.appendChild(lineasBox);
    cuerpo.appendChild(el('div', { class: 'cj-e-fila' }, [el('span', { text: 'Total' }), totalTxt]));
    if (c.pago === 'efectivo' && c.entregado !== null) cuerpo.appendChild(el('p', { class: 'cj-card-sub', text: 'Entregó ' + e(c.entregado) + (c.cambio !== null ? ' · cambio ' + e(c.cambio) : '') }));
    if (!soloVer) cuerpo.appendChild(el('div', { class: 'cj-e-fila' }, [motivo]));
    cuerpo.appendChild(err);
    if (c.historial) cuerpo.appendChild(el('p', { class: 'cj-historial', text: c.historial }));

    function enviar(anular) {
      if (!motivo.value.trim()) { err.textContent = 'Escribe el motivo del cambio.'; err.hidden = false; motivo.focus(); return; }
      if (anular && !confirm('¿Anular este cobro? Quedará tachado en el historial.')) return;
      var d = jefeAuth({ action: 'cobroEditar', id: c.id, motivo: motivo.value.trim() });
      if (anular) d.anular = true;
      else {
        if (E.lineas.some(function (l) { return !(l.precio >= 0); })) { err.textContent = 'Hay un precio que no es válido.'; err.hidden = false; return; }
        d.b = E.b; d.pago = E.pago; d.cliente = E.cliente; d.lineas = E.lineas;
      }
      cargando(true);
      pedir(d).then(function () { cargando(false); $('#v-editar').hidden = true; recargarJefe(); }, function (x) { cargando(false); err.textContent = x.message; err.hidden = false; });
    }
    cuerpo.appendChild(el('div', { class: 'cj-e-btns' }, soloVer ? [el('button', { type: 'button', class: 'cj-btn cj-btn-amarillo', text: 'Cerrar', onclick: cerrarEditar })] : [
      el('button', { type: 'button', class: 'cj-btn cj-btn-borde', text: 'Cancelar', onclick: cerrarEditar }),
      el('button', { type: 'button', class: 'cj-btn cj-btn-rojo', text: 'Anular', onclick: function () { enviar(true); } }),
      el('button', { type: 'button', class: 'cj-btn cj-btn-amarillo', text: 'Guardar', onclick: function () { enviar(false); } })
    ]));
    pintarLineas();
  }
  function cerrarEditar() { $('#v-editar').hidden = true; }

  // =====================================================================
  //  MODO SIMULACIÓN (sin motor): datos de ejemplo en memoria
  // =====================================================================
  var SIM = null;
  function sim() {
    if (SIM) return SIM;
    var hoy = ahoraMadrid().fecha, nombres = ['Álex M.', 'Dani R.', 'Hugo P.', 'Iker S.', 'Marc V.', 'Pablo G.', 'Sergio L.', 'Adrián T.', 'Óscar F.', 'Rubén C.'];
    var horas = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'];
    var cs = K.servicios, citas = [], cobros = [], k = 0;
    function rnd(n) { k = (k * 9301 + 49297) % 233280; return Math.floor(k / 233280 * n); }
    function cobro(f, h, b, cliente, ls, pago, e2) {
      var t = ls.reduce(function (s, l) { return s + l.precio * l.n; }, 0);
      return { id: 'sim' + (cobros.length + 1), guardado: new Date().toISOString(), f: f, h: h, b: b, cliente: cliente,
        concepto: ls.map(function (l) { return (l.n > 1 ? l.n + '× ' : '') + l.nombre; }).join(' + '),
        serv: ls.filter(function (l) { return l.tipo !== 'producto'; }).reduce(function (s, l) { return s + l.precio * l.n; }, 0),
        prod: ls.filter(function (l) { return l.tipo === 'producto'; }).reduce(function (s, l) { return s + l.precio * l.n; }, 0),
        total: t, pago: pago, entregado: e2 || null, cambio: e2 ? e2 - t : null, estado: 'ok', historial: '', e: '', lineas: ls, m12: ls.some(function (l) { return l.tipo === 'm12'; }) };
    }
    var d0 = hoy.slice(0, 8) + '01', ahora = ahoraMadrid().hora;
    for (var f = addDays(d0, -45); f <= hoy; f = addDays(f, 1)) {   // mes y medio de ejemplo (semana y mes pasados con datos)
      var dow = utc(f).getUTCDay();
      if (dow === 0 || dow === 1) continue;
      K.barberos.forEach(function (b) {
        horas.forEach(function (h) {
          if (rnd(10) < 4) return;
          var s = cs[rnd(cs.length)], cliente = nombres[rnd(nombres.length)];
          var cita = { id: 'ev' + citas.length, b: b, f: f, h: h, cliente: cliente, s: s.id, sn: s.nombre, extras: [], precio: s.precio, extra: false, novino: false, origen: 'web', cobrado: false };
          var esM12 = b === K.m12.barbero && rnd(6) === 0;
          if (b === 'ruth' && rnd(3) === 0) { cita.extras = ['cejas']; cita.sn += ' + Cejas'; cita.precio += 6; }
          citas.push(cita);
          if (f === hoy && h > ahora) return;
          if (rnd(25) === 0) { cita.novino = true; return; }
          var ls = esM12 ? [{ tipo: 'm12', id: 'm12', nombre: K.m12.nombre + ' (12)', precio: 12, n: 1 }] : [{ tipo: 'servicio', id: s.id, nombre: s.nombre, precio: s.precio, n: 1 }];
          if (cita.extras.length) ls.push({ tipo: 'extra', id: 'cejas', nombre: '+ Cejas', precio: 6, n: 1 });
          if (rnd(8) === 0) { var p = K.productos[rnd(K.productos.length)]; ls.push({ tipo: 'producto', id: p.id, nombre: p.nombre, precio: p.precio, n: 1 }); }
          var pago = esM12 ? 'efectivo' : ['efectivo', 'tarjeta', 'tarjeta', 'bizum'][rnd(4)];
          var tt = ls.reduce(function (s, l) { return s + l.precio * l.n; }, 0);
          var c = cobro(f, h, b, cliente, ls, pago, pago === 'efectivo' ? Math.ceil(tt / 10) * 10 : null);
          c.e = cita.id; cita.cobrado = true; cobros.push(c);
        });
      });
    }
    // Hoy: que queden citas pasadas sin cobrar para probar
    citas.filter(function (c) { return c.f === hoy && c.cobrado; }).slice(-3).forEach(function (c) {
      c.cobrado = false; cobros = cobros.filter(function (x) { return x.e !== c.id; });
    });
    SIM = { hoy: hoy, citas: citas, cobros: cobros, fondo: 100 };
    return SIM;
  }
  function demoApi(d) {
    var S = sim(), hoy = S.hoy, ahora = ahoraMadrid().hora;
    function ok(x) { return new Promise(function (res) { setTimeout(function () { res(x); }, 250); }); }
    function mal(m, code) { var er = new Error(m); er.code = code; return new Promise(function (res, rej) { setTimeout(function () { rej(er); }, 250); }); }
    if (d.action === 'cajaHoy') {
      return ok({ ok: true, hoy: hoy, ahora: ahora,
        citas: S.citas.filter(function (c) { return c.b === d.b && c.f === hoy; }).sort(function (a, b) { return a.h.localeCompare(b.h); }),
        cobros: S.cobros.filter(function (c) { return c.b === d.b && c.f === hoy && c.estado !== 'anulado'; }) });
    }
    if (d.action === 'cobrar') {
      if (d.e && S.cobros.some(function (c) { return c.e === d.e && c.estado !== 'anulado'; })) return mal('Esta cita ya está cobrada.', 'YA_COBRADA');
      var c = { id: 'sim' + Date.now(), guardado: new Date().toISOString(), f: hoy, h: ahora, b: d.b, cliente: d.cliente || 'Cliente de mostrador',
        lineas: d.lineas, pago: d.pago, estado: 'ok', historial: '', e: d.e || '' };
      c.total = d.lineas.reduce(function (s, l) { return s + l.precio * l.n; }, 0);
      c.serv = d.lineas.filter(function (l) { return l.tipo !== 'producto'; }).reduce(function (s, l) { return s + l.precio * l.n; }, 0);
      c.prod = c.total - c.serv; c.m12 = d.lineas.some(function (l) { return l.tipo === 'm12'; });
      c.concepto = d.lineas.map(function (l) { return (l.n > 1 ? l.n + '× ' : '') + l.nombre; }).join(' + ');
      c.entregado = d.entregado === '' ? null : d.entregado; c.cambio = c.entregado !== null && c.entregado >= c.total ? r2(c.entregado - c.total) : null;
      S.cobros.push(c);
      var cita = S.citas.filter(function (x) { return x.id === d.e; })[0];
      if (cita) cita.cobrado = true;
      else if (c.serv > 0) S.citas.push({ id: 'ev' + Date.now(), b: d.b, f: hoy, h: ahora, cliente: c.cliente, s: '', sn: c.concepto, extras: [], precio: c.serv, extra: false, novino: false, origen: 'mostrador', cobrado: true });
      return ok({ ok: true, cobro: c });
    }
    if (d.action === 'cobroEditar') {
      if (!d.c && !d.clave && d.pin !== '1234') return mal('PIN incorrecto.', 'PIN');
      var x = S.cobros.filter(function (c) { return c.id === d.id; })[0];
      if (!x) return mal('Ese cobro no existe.');
      var nota = ahoraMadrid().hora + ' · ' + (d.anular ? 'ANULADO' : 'Corregido') + ' (antes: ' + x.concepto + ', ' + x.total + ' €, ' + nombrePago(x.pago) + ') · ' + d.motivo;
      x.historial = x.historial ? x.historial + '\n' + nota : nota;
      if (d.anular) { x.estado = 'anulado'; S.citas.forEach(function (ct) { if (ct.id === x.e) ct.cobrado = false; }); }
      else {
        x.estado = 'corregido'; x.b = d.b; x.pago = d.pago; x.cliente = d.cliente; x.lineas = d.lineas;
        x.total = d.lineas.reduce(function (s, l) { return s + l.precio * l.n; }, 0);
        x.concepto = d.lineas.map(function (l) { return (l.n > 1 ? l.n + '× ' : '') + l.nombre; }).join(' + ');
        x.m12 = d.lineas.some(function (l) { return l.tipo === 'm12'; });
      }
      return ok({ ok: true, cobro: x });
    }
    if (d.action === 'cajaJefe') {
      if (d.pin !== '1234' && !d.clave) return mal('PIN incorrecto.', 'PIN');
      var ap = { anio: hoy.slice(0, 4), n: 0, importe: 0, meses: {} };
      S.cobros.forEach(function (c) { if (c.estado === 'anulado' || c.f.slice(0, 4) !== ap.anio) return; (c.lineas || []).forEach(function (l) {
        if (l.tipo !== 'producto' || !esAparte(l.id)) return; var m = c.f.slice(0, 7); ap.meses[m] = ap.meses[m] || { n: 0, importe: 0 };
        ap.n += l.n; ap.importe += l.precio * l.n; ap.meses[m].n += l.n; ap.meses[m].importe += l.precio * l.n; }); });
      ap.salidas = S.salidas || []; ap.sacado = ap.salidas.reduce(function (t, x) { return t + x.importe; }, 0); SIM.ultimaAparte = ap;
      return ok({ ok: true, hoy: hoy, ahora: ahora, desde: d.desde, hasta: d.hasta, fondo: S.fondo, hoja: '', aparte: ap,
        cobros: S.cobros.filter(function (c) { return c.f >= d.desde && c.f <= d.hasta; }), citas: S.citas.filter(function (c) { return c.f >= d.desde && c.f <= d.hasta; }) });
    }
    if (d.action === 'cajaFondo') { S.fondo = d.importe; return ok({ ok: true, fondo: d.importe }); }
    if (d.action === 'cajaEntrar') return d.codigo === '1234' || d.codigo === S.codigo ? ok({ ok: true, c: 'demo' }) : mal('Código incorrecto.', 'CODIGO');
    if (d.action === 'cajaCodigo') { S.codigo = d.codigo; return ok({ ok: true }); }
    if (d.action === 'cajaPin') return ok({ ok: true });
    if (d.action === 'huchaSacar' || d.action === 'huchaQuitar') {
      S.salidas = S.salidas || [];
      if (d.action === 'huchaSacar') S.salidas.push({ id: 's' + Date.now(), f: hoy, importe: d.importe, concepto: d.concepto || 'Pedido de vapers' });
      else S.salidas = S.salidas.filter(function (x) { return x.id !== d.id; });
      var ap2 = JSON.parse(JSON.stringify(SIM.ultimaAparte || { anio: hoy.slice(0, 4), n: 0, importe: 0, meses: {} }));
      ap2.salidas = S.salidas; ap2.sacado = S.salidas.reduce(function (t, x) { return t + x.importe; }, 0);
      return ok({ ok: true, aparte: ap2 });
    }
    return mal('Acción desconocida.');
  }

  // ---------- Arranque ----------
  var arrancada = false;
  function arrancar() {
    $('#v-caja').hidden = false;
    if (DEMO) $('#v-caja .cj-brand span').textContent = 'Caja · prueba';
    pintarBarberos(); pintarTicket(); reloj();
    if (!arrancada) { arrancada = true; setInterval(reloj, 20000); }
    cargarHoy();
  }
  if (Q.get('jefe') === '1') {
    try { CLAVE_PANEL = sessionStorage.getItem('olympo_jefe_clave') || localStorage.getItem('booklab_panel_clave') || ''; } catch (x) { CLAVE_PANEL = ''; }
    if (DEMO && !CLAVE_PANEL) CLAVE_PANEL = 'demo';
  }
  if (CLAVE_PANEL) {
    document.title = 'Caja y ventas';
    $('#v-jefe').hidden = false; $('#cerrar-jefe').textContent = '← Panel';
    $('#v-jefe .cj-brand span').textContent = 'Caja y ventas';
    $('#j-pin').hidden = true; $('#j-datos').hidden = false;
    entrarJefe('');
  } else if (!CLAVE) pedirCodigo(); else arrancar();
  // Al volver al iPad (o cada 2 min), refrescar las citas por si han reservado online
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !T && $('#v-jefe').hidden) cargarHoy(); });
  setInterval(function () { if (!T && $('#v-jefe').hidden && !document.hidden) cargarHoy(); }, 120000);
})();
