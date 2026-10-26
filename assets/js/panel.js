/*
 * Book Lab — Panel del jefe (panel.html).
 * Pide los datos al motor (Apps Script) con la clave del panel y calcula aquí los números:
 * facturación por barbero y por mes, ocupación, ticket medio, cancelaciones, cambios,
 * "No vino", servicios, días y horas punta, agenda de hoy/mañana y clientes.
 * Sin motor configurado, o con ?demo=1, enseña un panel de ejemplo con datos inventados.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG;
  var URL_MOTOR = ((C.motor && C.motor.url) || '').trim();
  // El panel de ejemplo (?demo=1) solo se permite si config.js lo activa (getbooklab.com). En las webs de clientes, no.
  var EJEMPLO_PERMITIDO = !!(C.panel && C.panel.ejemplo);
  var SIN_MOTOR = !/^https:\/\//.test(URL_MOTOR) || URL_MOTOR.indexOf('PEGAR_') !== -1;
  var DEMO = SIN_MOTOR || (EJEMPLO_PERMITIDO && new URLSearchParams(location.search).get('demo') === '1');
  var CLAVE_LS = 'booklab_panel_clave';
  var MESES_A_CARGAR = 12;

  var D = null;                 // datos del motor
  var S = { mes: '', filtro: 'todos', dia: '' };   // dia: fecha de la agenda (AAAA-MM-DD)
  var clave = '';
  var primeraVisita = {};       // email → primera fecha
  var ultimaVisita = {};        // email → última fecha pasada

  // ---------- Utilidades ----------
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.setAttribute('style', attrs[k]);
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
  var num = new Intl.NumberFormat('es-ES');
  var MES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIA_CORTO = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var DIA_LARGO = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
  function utc(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function addDays(ymd, n) { var d = utc(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function wd(ymd) { return utc(ymd).getUTCDay() || 7; }
  function toMin(h) { var p = h.split(':'); return +p[0] * 60 + +p[1]; }
  function mesTexto(m) { var p = m.split('-'); return MES_NOMBRE[+p[1] - 1] + ' ' + p[0]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function mesAnterior(m) { var p = m.split('-').map(Number); return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + ('0' + (p[1] - 1)).slice(-2); }
  function mesSiguiente(m) { var p = m.split('-').map(Number); return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + ('0' + (p[1] + 1)).slice(-2); }
  function diasDelMes(m) { var p = m.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function nombreBarbero(id) { var b = D.barberos.filter(function (x) { return x.id === id; })[0]; return b ? b.nombre : id; }
  function telHref(t) { return 'tel:' + String(t || '').replace(/[^\d+]/g, ''); }
  function waHref(t) { var d = String(t || '').replace(/\D/g, ''); if (d.length === 9) d = '34' + d; return 'https://wa.me/' + d; }
  function guardar(v) { try { if (v) localStorage.setItem(CLAVE_LS, v); else localStorage.removeItem(CLAVE_LS); } catch (e) { /* sin almacenamiento */ } }
  function leer() { try { return localStorage.getItem(CLAVE_LS) || ''; } catch (e) { return ''; } }

  function pasada(c) { return c.f < D.hoy || (c.f === D.hoy && c.h <= D.ahora); }
  function enFiltro(c) { return S.filtro === 'todos' || c.b === S.filtro; }
  function delMes(m) { return D.citas.filter(function (c) { return c.f.slice(0, 7) === m && enFiltro(c); }); }

  function show(id) {
    ['#v-login', '#v-cargando', '#v-panel'].forEach(function (v) { $(v).hidden = v !== id; });
    $('#salir').hidden = id !== '#v-panel' || DEMO;
  }

  // ---------- Datos de ejemplo ----------
  function semilla(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  }
  function datosDemo() {
    var rnd = semilla('booklab'), p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: (C.negocio.zonaHoraria || 'Europe/Madrid'), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var hoy = p.year + '-' + p.month + '-' + p.day, ahora = (('0' + (+p.hour % 24)).slice(-2)) + ':' + p.minute;
    var barberos = C.barberos.filter(function (b) { return b.id !== 'any'; }).map(function (b) { return { id: b.id, nombre: b.nombre }; });
    var servicios = {};
    C.servicios.forEach(function (s) { servicios[s.id] = { nombre: s.nombre, precio: s.precio, duracion: s.duracion }; });
    var nombres = ['Álex', 'Javier', 'Sergio', 'Pablo', 'Dani', 'Hugo', 'Mario', 'Adrián', 'Iván', 'Rubén', 'Óscar', 'Raúl', 'Marc', 'Jorge', 'David', 'Luis', 'Carlos', 'Miguel', 'Hamza', 'Nico'];
    var apellidos = ['García', 'Martín', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Ruiz', 'Díaz', 'Moreno', 'Romero', 'Navarro', 'Torres'];
    var clientes = [];
    for (var i = 0; i < 160; i++) {
      var n = nombres[i % nombres.length], a = apellidos[Math.floor(rnd() * apellidos.length)];
      clientes.push({ cliente: n + ' ' + a, email: (n + '.' + a + i).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@ejemplo.com', tel: '6' + String(10000000 + Math.floor(rnd() * 89999999)) });
    }
    var ids = Object.keys(servicios), pesos = [0.35, 0.3, 0.25, 0.1];
    var inicio = (function () { var m = hoy.slice(0, 7); for (var k = 0; k < 5; k++) m = mesAnterior(m); return m + '-01'; })();
    var fin = addDays(hoy, 14), citas = [], ritmo = [0.62, 0.5, 0.4];
    for (var f = inicio; f <= fin; f = addDays(f, 1)) {
      var tramos = C.horario[wd(f)] || [];
      barberos.forEach(function (b, bi) {
        tramos.forEach(function (t) {
          for (var m = toMin(t[0]); m + 30 <= toMin(t[1]); m += 30) {
            var prob = (ritmo[bi] || 0.45) * (wd(f) === 6 ? 1.35 : wd(f) === 5 ? 1.15 : 1) * (f > hoy ? 0.55 : 1);
            if (rnd() > prob) continue;
            var r = rnd(), si = 0, acc = 0;
            for (var x = 0; x < ids.length; x++) { acc += pesos[x] || 0.1; if (r <= acc) { si = x; break; } }
            // La cartera de clientes crece con el tiempo: cada mes aparecen clientes nuevos
            var dias = Math.round((utc(f) - utc(inicio)) / 86400000);
            var cartera = Math.min(clientes.length, 50 + Math.floor(dias * 0.6));
            var cl = clientes[cartera - 1 - Math.floor(Math.pow(rnd(), 1.4) * cartera)], s = servicios[ids[si]];
            var h = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
            citas.push({ id: 'demo' + citas.length, b: b.id, s: ids[si], sn: s.nombre, precio: s.precio, dur: s.duracion, f: f, h: h,
              cliente: cl.cliente, email: cl.email, tel: cl.tel, novino: false, pagado: false, cambios: rnd() < 0.08 ? 1 : 0,
              origen: f <= hoy && citas.length % 6 === 0 ? 'mostrador' : 'web' });
            var ult = citas[citas.length - 1];
            if (f < hoy && rnd() < 0.04) { ult.novino = true; ult.pagado = rnd() < 0.5; }
          }
        });
      });
    }
    var est = {}, mm = inicio.slice(0, 7);
    while (mm <= hoy.slice(0, 7)) {
      est[mm] = {};
      barberos.forEach(function (b) { est[mm][b.id] = { cancelaciones: 2 + Math.floor(rnd() * 6), cambios: 3 + Math.floor(rnd() * 8) }; });
      mm = mesSiguiente(mm);
    }
    // Datos de ejemplo: barberos de config.js; el de fuera de horario, el de config.js → horasExtra (o el primero)
    var b1 = (barberos[0] || {}).id || 'any', b2 = (barberos[1] || barberos[0] || {}).id || 'any';
    var bExtra = (C.horasExtra && C.horasExtra.barbero) || b1;
    var espera = [['Hugo Martín', 1, b1, 'tarde'], ['Pablo Ruiz', 1, 'any', 'todo'], ['Iván Torres', 2, b2, 'manana'], ['Dani López', 3, 'any', 'tarde']].map(function (x, i) {
      return { id: 'e' + i, apuntado: new Date().toISOString(), f: addDays(hoy, x[1]), b: x[2], franja: x[3], s: ids[i % ids.length], nombre: x[0], tel: '6' + (12345670 + i * 1111), email: x[0].split(' ')[0].toLowerCase() + '@ejemplo.com', avisado: i === 1 };
    });
    citas.filter(function (c) { return C.horasExtra && c.b === bExtra && c.h >= '18:00'; }).slice(-3).forEach(function (c) { c.extra = true; c.precio = c.precio * 2; });
    return { ok: true, negocio: C.negocio.nombre, hoy: hoy, ahora: ahora, barberos: barberos, servicios: servicios, horario: C.horario, estadisticas: est, bloqueados: [], correos: { restantes: 77, limite: 100 }, espera: espera, citas: citas };
  }

  // ---------- Carga ----------
  function pedir(cuerpo) {
    return fetch(URL_MOTOR, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) })
      .then(function (r) { return r.text(); }, function () { throw new Error('No hemos podido conectar. Revisa tu conexión e inténtalo de nuevo.'); })
      .then(function (t) {
        var d; try { d = JSON.parse(t); } catch (e) { throw new Error('Respuesta inesperada del motor. Inténtalo de nuevo.'); }
        if (d.error) { var er = new Error(d.error); er.code = d.code; throw er; }
        return d;
      });
  }

  function cargar() {
    show('#v-cargando');
    var prom = DEMO ? new Promise(function (res) { setTimeout(function () { res(datosDemo()); }, 300); }) : pedir({ action: 'panel', clave: clave, meses: MESES_A_CARGAR });
    prom.then(function (datos) {
      D = datos;
      preparar();
      show('#v-panel');
      pintar();
      cargarHuecos();
      A.items = null;
      cargarActividad();
    }).catch(function (err) {
      if (err.code === 'CLAVE' || err.code === 'SIN_CLAVE' || err.code === 'BLOQUEADO') guardar('');
      $('#login-error').textContent = err.message;
      $('#login-error').hidden = false;
      show('#v-login');
    });
  }

  function preparar() {
    primeraVisita = {}; ultimaVisita = {};
    D.citas.sort(function (a, b) { return (a.f + a.h).localeCompare(b.f + b.h); });
    D.citas.forEach(function (c) {
      if (!c.email) return;
      if (!primeraVisita[c.email]) primeraVisita[c.email] = c.f;
      if (pasada(c) && !c.novino) ultimaVisita[c.email] = c.f;
    });
    // Meses disponibles: desde el primero cargado hasta el de la última cita (o el actual)
    var meses = [], m = (D.citas[0] ? D.citas[0].f : D.hoy).slice(0, 7), ultimo = D.hoy.slice(0, 7);
    if (D.citas.length && D.citas[D.citas.length - 1].f.slice(0, 7) > ultimo) ultimo = D.citas[D.citas.length - 1].f.slice(0, 7);
    while (m <= ultimo) { meses.push(m); m = mesSiguiente(m); }
    var sel = $('#mes'); sel.textContent = '';
    meses.forEach(function (x) { sel.appendChild(el('option', { value: x, text: cap(mesTexto(x)) })); });
    if (!S.mes || meses.indexOf(S.mes) === -1) S.mes = D.hoy.slice(0, 7);
    if (!S.dia) S.dia = D.hoy;
    D.bloqueados = D.bloqueados || [];
    D.espera = D.espera || [];
    sel.value = S.mes;
    $('#p-name').textContent = D.negocio;
    document.title = 'Panel · ' + D.negocio;
  }

  // ---------- Cálculos ----------
  function minutosDisponibles(m, nBarberos) {
    var total = 0, dias = diasDelMes(m);
    for (var d = 1; d <= dias; d++) {
      (D.horario[wd(m + '-' + ('0' + d).slice(-2))] || []).forEach(function (t) { total += toMin(t[1]) - toMin(t[0]); });
    }
    return total * nBarberos;
  }

  function resumen(m, cortarEnDia) {
    var cs = delMes(m);
    if (cortarEnDia) cs = cs.filter(function (c) { return Number(c.f.slice(8, 10)) <= cortarEnDia; });
    var hechas = cs.filter(function (c) { return pasada(c) && !c.novino; });
    var futuras = cs.filter(function (c) { return !pasada(c); });
    var novino = cs.filter(function (c) { return c.novino; });
    var novinoPagado = novino.filter(function (c) { return c.pagado; });
    var cobradoNoVino = novinoPagado.reduce(function (s, c) { return s + c.precio; }, 0);
    var pendienteNoVino = novino.filter(function (c) { return !c.pagado; }).reduce(function (s, c) { return s + c.precio; }, 0);
    // Facturación automática: toda cita pasada cuenta como cobrada, salvo "No vino"; un "No vino" pagado vuelve a sumar
    var facturado = hechas.reduce(function (s, c) { return s + c.precio; }, 0) + cobradoNoVino;
    var previsto = futuras.reduce(function (s, c) { return s + c.precio; }, 0);
    var ocupado = cs.reduce(function (s, c) { return s + c.dur; }, 0);
    var nB = S.filtro === 'todos' ? D.barberos.length : 1;
    var est = D.estadisticas[m] || {}, cancel = 0, cancelB = 0, cambios = 0;
    Object.keys(est).forEach(function (b) { if (S.filtro === 'todos' || b === S.filtro) { cancel += est[b].cancelaciones || 0; cancelB += est[b].cancelacionesBarberia || 0; cambios += est[b].cambios || 0; } });
    var nuevos = {};
    cs.forEach(function (c) { if (c.email && primeraVisita[c.email] && primeraVisita[c.email].slice(0, 7) === m) nuevos[c.email] = 1; });
    return {
      citas: cs.length, hechas: hechas.length, futuras: futuras.length, novino: novino.length,
      mostrador: cs.filter(function (c) { return c.origen === 'mostrador'; }).length,
      cobradoNoVino: cobradoNoVino, pendienteNoVino: pendienteNoVino,
      facturado: facturado, previsto: previsto, ticket: hechas.length ? facturado / hechas.length : 0,
      ocupacion: pct(ocupado, minutosDisponibles(m, nB)), cancelaciones: cancel, cancelBarberia: cancelB, cambios: cambios, nuevos: Object.keys(nuevos).length
    };
  }

  // ---------- Pintar ----------
  function pintar() {
    pintarFiltro();
    pintarKpis();
    pintarBarberos();
    pintarEvolucion();
    pintarAgenda();
    pintarNoVino();
    pintarServicios();
    pintarPunta();
    pintarClientes();
    pintarBloqueados();
    pintarCorreos();
    $('#mes-ant').disabled = $('#mes').selectedIndex <= 0;
    $('#mes-sig').disabled = $('#mes').selectedIndex >= $('#mes').options.length - 1;
  }

  function pintarFiltro() {
    var box = $('#filtro'); box.textContent = '';
    [{ id: 'todos', nombre: 'Todos' }].concat(D.barberos).forEach(function (b) {
      box.appendChild(el('button', { type: 'button', class: 'p-chip', 'aria-pressed': String(S.filtro === b.id), onclick: function () { S.filtro = b.id; pintar(); } }, [b.nombre]));
    });
  }

  function delta(actual, antes) {
    if (!antes) return null;
    var v = Math.round((actual - antes) / antes * 100);
    return el('span', { class: 'p-delta ' + (v >= 0 ? 'up' : 'down') }, [(v >= 0 ? '▲ ' : '▼ ') + Math.abs(v) + ' %']);
  }

  // Cada cuadrado se pulsa y abre su detalle
  function kpi(titulo, valor, sub, extra, abrir) {
    var hijos = [el('span', { class: 'p-kpi-t', text: titulo }), el('b', { text: valor }), extra || null, sub ? el('small', { text: sub }) : null];
    if (!abrir) return el('div', { class: 'p-kpi' }, hijos);
    hijos.push(el('span', { class: 'p-kpi-mas', 'aria-hidden': 'true', text: 'Ver detalle ›' }));
    return el('button', { type: 'button', class: 'p-kpi is-btn', 'aria-label': titulo + ': ' + valor + '. Ver detalle', onclick: abrir }, hijos);
  }

  function pintarKpis() {
    var esActual = S.mes === D.hoy.slice(0, 7);
    var r = resumen(S.mes), antes = resumen(mesAnterior(S.mes), esActual ? Number(D.hoy.slice(8, 10)) : 0);
    var box = $('#kpis'); box.textContent = '';
    box.appendChild(kpi('Facturado', eur.format(r.facturado), r.previsto ? '+ ' + eur.format(r.previsto) + ' previstos este mes' : (esActual ? 'Hasta hoy' : ''), delta(r.facturado, antes.facturado), detFacturado));
    box.appendChild(kpi('Citas', num.format(r.citas), r.hechas + ' hechas · ' + r.futuras + ' pendientes' + (r.mostrador ? ' · ' + r.mostrador + ' de mostrador' : ''), delta(r.citas, antes.citas), detCitas));
    box.appendChild(kpi('Ticket medio', eur2.format(Math.round(r.ticket * 100) / 100), 'Por cita realizada', null, detTicket));
    box.appendChild(kpi('Ocupación', r.ocupacion + ' %', 'Horas reservadas sobre horas abiertas', null, detOcupacion));
    box.appendChild(kpi('Clientes nuevos', num.format(r.nuevos), 'Primera reserva este mes', null, detNuevos));
    box.appendChild(kpi('No vinieron', num.format(r.novino), r.novino ? eur.format(r.pendienteNoVino) + ' por cobrar · ' + pct(r.novino, r.hechas + r.novino) + ' % de las citas' : 'Ninguno este mes', null, detNoVino));
    box.appendChild(kpi('Cancelaciones', num.format(r.cancelaciones), 'Del cliente, desde la web' + (r.cancelBarberia ? ' · + ' + r.cancelBarberia + ' de la barbería' : ''), null, function () { detRegistro('cancelacion', 'Cancelaciones'); }));
    box.appendChild(kpi('Cambios de cita', num.format(r.cambios), 'Desde la web', null, function () { detRegistro('cambio', 'Cambios de cita'); }));
    var esp = esperaFiltrada();
    box.appendChild(kpi('Lista de espera', num.format(esp.length), esp.length ? 'Esperando hueco · ' + esp.filter(function (x) { return x.avisado; }).length + ' ya avisados' : 'Nadie esperando', null, detEspera));
    var nota = esActual ? 'La flecha compara con el mismo periodo del mes pasado.' : 'La flecha compara con el mes anterior.';
    box.appendChild(el('p', { class: 'g-note p-kpi-note', text: nota }));
  }

  function pintarBarberos() {
    var t = $('#tabla-barberos'); t.textContent = '';
    t.appendChild(el('thead', null, [el('tr', null, ['Barbero', 'Facturado', 'Citas', 'Ticket medio', 'Ocupación', 'No vino', 'Cancel.'].map(function (h, i) { return el('th', { scope: 'col', class: i ? 'num' : '' }, [h]); }))]));
    var filtroAntes = S.filtro, filas = [], max = 0;
    D.barberos.forEach(function (b) { S.filtro = b.id; var r = resumen(S.mes); filas.push([b, r]); if (r.facturado > max) max = r.facturado; });
    S.filtro = filtroAntes;
    var tb = el('tbody');
    filas.forEach(function (f) {
      var b = f[0], r = f[1];
      var barra = el('span', { class: 'p-mini', style: 'width:' + (max ? Math.round(r.facturado / max * 100) : 0) + '%' });
      tb.appendChild(el('tr', { class: S.filtro === b.id ? 'is-sel' : '' }, [
        el('th', { scope: 'row' }, [el('button', { type: 'button', class: 'p-link', onclick: function () { S.filtro = S.filtro === b.id ? 'todos' : b.id; pintar(); } }, [b.nombre])]),
        el('td', { class: 'num' }, [el('b', { text: eur.format(r.facturado) }), barra]),
        el('td', { class: 'num', text: num.format(r.citas) }),
        el('td', { class: 'num', text: eur2.format(Math.round(r.ticket * 100) / 100) }),
        el('td', { class: 'num', text: r.ocupacion + ' %' }),
        el('td', { class: 'num', text: num.format(r.novino) }),
        el('td', { class: 'num', text: num.format(r.cancelaciones) })
      ]));
    });
    t.appendChild(tb);
  }

  function pintarEvolucion() {
    var box = $('#evolucion'); box.textContent = '';
    var meses = [], m = S.mes;
    for (var i = 0; i < 6; i++) { meses.unshift(m); m = mesAnterior(m); }
    var datos = meses.map(function (x) { var r = resumen(x); return { m: x, f: r.facturado, p: r.previsto }; });
    var max = Math.max.apply(null, datos.map(function (d) { return d.f + d.p; })) || 1;
    datos.forEach(function (d) {
      var col = el('div', { class: 'p-col' + (d.m === S.mes ? ' is-sel' : '') }, [
        el('span', { class: 'p-col-v', text: eur.format(d.f + d.p) }),
        el('div', { class: 'p-col-bar' }, [
          d.p ? el('span', { class: 'p-col-prev', style: 'height:' + (d.p / max * 100) + '%', title: eur.format(d.p) + ' previstos' }) : null,
          el('span', { class: 'p-col-fill', style: 'height:' + (d.f / max * 100) + '%' })
        ]),
        el('span', { class: 'p-col-l', text: cap(MES_NOMBRE[+d.m.slice(5) - 1].slice(0, 3)) })
      ]);
      box.appendChild(col);
    });
  }

  function barras(box, items, fmt) {
    box.textContent = '';
    if (!items.length) { box.appendChild(el('p', { class: 'g-note', text: 'Sin datos este mes.' })); return; }
    var max = Math.max.apply(null, items.map(function (i) { return i.v; })) || 1;
    items.forEach(function (i) {
      var hijos = [
        el('span', { class: 'p-bar-l', text: i.l }),
        el('span', { class: 'p-bar-t' }, [el('span', { class: 'p-bar-f', style: 'width:' + Math.max(2, i.v / max * 100) + '%' })]),
        el('span', { class: 'p-bar-v', text: fmt(i) })
      ];
      box.appendChild(i.abrir
        ? el('button', { type: 'button', class: 'p-bar is-btn', 'aria-label': i.l + ': ' + fmt(i) + '. Ver citas', onclick: i.abrir }, hijos)
        : el('div', { class: 'p-bar' }, hijos));
    });
  }

  function pintarServicios() {
    var acc = {};
    delMes(S.mes).filter(function (c) { return !c.novino; }).forEach(function (c) {
      acc[c.sn] = acc[c.sn] || { l: c.sn, v: 0, e: 0, abrir: function () { detListaCitas('Servicio · ' + c.sn, function (x) { return x.sn === c.sn && !x.novino; }); } };
      acc[c.sn].v++; acc[c.sn].e += c.precio;
    });
    barras($('#servicios'), Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) { return b.v - a.v; }),
      function (i) { return i.v + ' · ' + eur.format(i.e); });
  }

  function pintarPunta() {
    var cs = delMes(S.mes).filter(function (c) { return !c.novino; }), dias = {}, horas = {};
    cs.forEach(function (c) { var d = wd(c.f); dias[d] = (dias[d] || 0) + 1; var h = c.h.slice(0, 2); horas[h] = (horas[h] || 0) + 1; });
    var d = [];
    for (var i = 1; i <= 7; i++) if ((D.horario[i] || []).length) d.push({ l: DIA_CORTO[i], v: dias[i] || 0, abrir: (function (n) { return function () { detListaCitas('Citas de los ' + DIA_LARGO[n], function (x) { return wd(x.f) === n && !x.novino; }); }; })(i) });
    barras($('#dias'), d, function (x) { return String(x.v); });
    barras($('#horas'), Object.keys(horas).sort().map(function (h) {
      return { l: h + ':00', v: horas[h], abrir: function () { detListaCitas('Citas de ' + h + ':00 a ' + h + ':59', function (x) { return x.h.slice(0, 2) === h && !x.novino; }); } };
    }), function (x) { return String(x.v); });
  }

  // ---------- Clientes ----------
  function claveCliente(c) { return c.email || telNorm(c.tel); }
  function telNorm(t) { var d = String(t || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; }
  function bloqueado(c) {
    var e = String(c.email || '').toLowerCase(), t = telNorm(c.tel);
    return D.bloqueados.some(function (x) { return (e && x.email === e) || (t && x.tel === t); });
  }
  // Mensaje del "asistente Book Lab": se nota que es automático para que al jefe no le dé apuro enviarlo.
  var fechaLarga = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  function mensajeNoVino(c) {
    var negocio = C.negocio.nombre || 'la barbería';
    return [
      '🤖 *Book Lab · Asistente de ' + negocio + '*',
      '_Mensaje automático_',
      '',
      'Hola, ' + (String(c.cliente || '').split(' ')[0] || 'cliente') + ':',
      'Te informamos de que no acudiste a tu cita y no recibimos ningún aviso de cancelación.',
      '',
      '📅 ' + cap(fechaLarga.format(utc(c.f)).replace(',', '')) + ' a las ' + c.h,
      '✂️ ' + c.sn + ' con ' + nombreBarbero(c.b),
      '💶 Importe: *' + eur2.format(c.precio) + '*',
      '',
      'Según nuestra política de cancelaciones, las citas no anuladas con antelación se abonan, ya que ese tiempo queda reservado exclusivamente para ti.',
      '',
      'Para regularizar el pago, responde a este mensaje y te indicamos cómo hacerlo.',
      '',
      'Gracias por tu comprensión.'
    ].join('\n');
  }
  function waAviso(c) { return waHref(c.tel) + '?text=' + encodeURIComponent(mensajeNoVino(c)); }

  // Recordatorio semiautomático por WhatsApp para las citas que aún no han llegado
  function mensajeRecordatorio(c) {
    var negocio = C.negocio.nombre || 'la barbería';
    var fecha = cap(fechaLarga.format(utc(c.f)).replace(',', ''));
    var cuando = c.f === D.hoy ? 'hoy' : c.f === addDays(D.hoy, 1) ? 'mañana' : 'el ' + fechaLarga.format(utc(c.f)).replace(',', '');
    return [
      '🤖 *Book Lab · Asistente de ' + negocio + '*',
      '_Recordatorio automático_',
      '',
      'Hola, ' + (String(c.cliente || '').split(' ')[0] || 'cliente') + ':',
      'Te recordamos que ' + cuando + ' tienes cita con nosotros:',
      '',
      '📅 ' + (c.f === D.hoy ? 'Hoy, ' + fechaLarga.format(utc(c.f)).replace(',', '') : fecha) + ' a las ' + c.h,
      '✂️ ' + c.sn + ' con ' + nombreBarbero(c.b),
      C.negocio.direccion ? '📍 ' + C.negocio.direccion : null,
      '',
      'Si no puedes venir, avísanos respondiendo a este mensaje para poder ofrecer tu hueco a otro cliente.',
      '',
      '¡Te esperamos! 💈'
    ].filter(function (l) { return l !== null; }).join('\n');
  }
  var RECORDADOS_LS = 'booklab_recordados';
  function recordados() { try { return JSON.parse(localStorage.getItem(RECORDADOS_LS) || '{}'); } catch (e) { return {}; } }
  function marcarRecordado(c) {
    try {
      var r = recordados(), limite = addDays(D.hoy, -7);
      Object.keys(r).forEach(function (k) { if (r[k] < limite) delete r[k]; });   // no acumular basura
      r[c.b + ':' + c.id] = c.f;
      localStorage.setItem(RECORDADOS_LS, JSON.stringify(r));
    } catch (e) { /* sin almacenamiento */ }
  }
  function botonRecordar(c) {
    var hecho = !!recordados()[c.b + ':' + c.id];
    return el('a', {
      href: waHref(c.tel) + '?text=' + encodeURIComponent(mensajeRecordatorio(c)), target: '_blank', rel: 'noopener',
      class: 'p-wa p-recordar' + (hecho ? ' is-hecho' : ''),
      'aria-label': 'Enviar recordatorio por WhatsApp a ' + (c.cliente || 'el cliente') + ' (' + c.h + ')',
      onclick: function (ev) { marcarRecordado(c); var a = ev.currentTarget; a.classList.add('is-hecho'); a.lastChild.textContent = 'Recordado ✓'; }
    }, [el('span', { 'aria-hidden': 'true', text: '💬' }), el('span', { text: hecho ? 'Recordado ✓' : 'Recordar' })]);
  }

  function noShowsDe(c) {
    var k = claveCliente(c);
    return D.citas.filter(function (x) { return x.novino && claveCliente(x) === k; }).length;
  }

  // ---------- Agenda de un día (para marcar "No vino") ----------
  function pintarAgenda() {
    document.querySelectorAll('.p-tabs [data-dia]').forEach(function (b) {
      b.setAttribute('aria-selected', String(addDays(D.hoy, +b.getAttribute('data-dia')) === S.dia));
    });
    $('#agenda-fecha').value = S.dia;
    var box = $('#agenda'); box.textContent = '';
    var cs = D.citas.filter(function (c) { return c.f === S.dia && enFiltro(c); });
    if (!cs.length) {
      var cerrado = !(D.horario[wd(S.dia)] || []).length;
      box.appendChild(el('p', { class: 'g-note', text: cerrado ? 'Ese día la barbería está cerrada. Elige otro día en «Otro día».' : 'No hay citas reservadas por la web ese día.' }));
      return;
    }
    // Resumen del día: lo que ya ha pasado cuenta como venido y pagado, salvo los "No vino"
    var vinieron = 0, cobrado = 0, fallos = 0, pendientes = 0, perdido = 0;
    cs.forEach(function (c) {
      if (!pasada(c)) pendientes++;
      else if (c.novino) { fallos++; if (c.pagado) cobrado += c.precio; else perdido += c.precio; }
      else { vinieron++; cobrado += c.precio; }
    });
    var res = el('div', { class: 'p-dia-res' }, [
      el('div', null, [el('b', { text: String(vinieron) }), el('small', { text: vinieron === 1 ? 'vino' : 'vinieron' })]),
      el('div', null, [el('b', { text: eur.format(cobrado) }), el('small', { text: 'cobrado' })]),
      el('div', { class: fallos ? 'is-mal' : '' }, [el('b', { text: String(fallos) }), el('small', { text: fallos ? 'no vino · ' + eur.format(perdido) : 'no vino' })]),
      el('div', null, [el('b', { text: String(pendientes) }), el('small', { text: pendientes === 1 ? 'pendiente' : 'pendientes' })])
    ]);
    box.appendChild(res);
    var ul = el('ul', { class: 'p-agenda' });
    cs.forEach(function (c) {
      var ya = pasada(c);
      // Por defecto: vino y pagó. Solo se toca si alguien falla («No show»).
      var estado = !ya ? el('span', { class: 'p-estado', text: 'Pendiente' })
        : c.novino ? el('span', { class: 'p-estado is-mal', text: c.pagado ? 'No vino · pagado' : 'No vino' })
        : el('span', { class: 'p-estado is-ok', text: 'Vino · pagado ✓' });
      ul.appendChild(el('li', { class: c.novino ? 'is-novino' : '' }, [
        el('span', { class: 'p-ag-h', text: c.h }),
        el('div', { class: 'p-ag-d' }, [
          el('b', { text: (c.cliente || 'Cliente') + (bloqueado(c) ? ' · bloqueado' : '') }),
          el('small', null, [c.origen === 'mostrador' ? el('span', { class: 'p-mostrador', text: 'Mostrador' }) : null,
            c.extra ? el('span', { class: 'p-mostrador p-extra', text: '★ Fuera de horario' }) : null,
            c.sn + ' · ' + eur.format(c.precio) + (S.filtro === 'todos' ? ' · ' + nombreBarbero(c.b) : '')]),
          c.tel ? el('span', { class: 'p-ag-telrow' }, [
            el('a', { href: telHref(c.tel), class: 'p-ag-tel', text: c.tel }),
            !ya ? botonRecordar(c) : null
          ]) : null
        ]),
        el('div', { class: 'p-acciones' }, [
          estado,
          el('button', { type: 'button', class: 'p-novino', 'aria-pressed': String(!!c.novino), 'aria-label': (c.novino ? 'Quitar «No vino» a ' : 'Marcar que no vino ') + (c.cliente || 'el cliente') + ' a las ' + c.h, onclick: function (ev) { marcarNoVino(c, ev.currentTarget); } }, [c.novino ? 'Sí vino' : 'No show']),
          !ya ? el('button', { type: 'button', class: 'p-novino p-cancelar', 'aria-label': 'Cancelar la cita de ' + (c.cliente || 'el cliente') + ' a las ' + c.h, onclick: function () { abrirCancelar(c); } }, ['Cancelar']) : null
        ])
      ]));
    });
    box.appendChild(ul);
  }

  function accion(cuerpo, local) {
    return DEMO ? new Promise(function (res) { setTimeout(function () { res(local ? local() : { ok: true }); }, 250); }) : pedir(cuerpo);
  }

  function marcarNoVino(c, btn) {
    var valor = !c.novino;
    btn.disabled = true;
    accion({ action: 'novino', clave: clave, b: c.b, e: c.id, valor: valor })
      .then(function () { c.novino = valor; if (!valor) c.pagado = false; preparar(); pintar(); })
      .catch(function (err) { btn.disabled = false; alert(err.message); });
  }

  function marcarPagado(c, btn) {
    var valor = !c.pagado;
    btn.disabled = true;
    accion({ action: 'pagado', clave: clave, b: c.b, e: c.id, valor: valor })
      .then(function () { c.pagado = valor; pintar(); })
      .catch(function (err) { btn.disabled = false; alert(err.message); });
  }

  // ---------- Cancelar una cita (la cancela la barbería, no el cliente) ----------
  var MOTIVOS = ['Barbero enfermo', 'Imprevisto en la barbería', 'Cierre del local', 'Error al apuntar la cita'];
  function urlReservar() { return location.origin + '/reservar'; }
  function mensajeCancelada(c, motivo) {
    var negocio = C.negocio.nombre || 'la barbería';
    return [
      '🤖 *Book Lab · Asistente de ' + negocio + '*',
      '_Mensaje automático_',
      '',
      'Hola, ' + (String(c.cliente || '').split(' ')[0] || 'cliente') + ':',
      'Sentimos comunicarte que hemos tenido que cancelar tu cita:',
      '',
      '📅 ' + cap(fechaLarga.format(utc(c.f)).replace(',', '')) + ' a las ' + c.h,
      '✂️ ' + c.sn + ' con ' + nombreBarbero(c.b),
      motivo ? '📝 Motivo: ' + motivo : null,
      '',
      'Puedes reservar otra cita cuando quieras aquí: ' + urlReservar(),
      '',
      'Disculpa las molestias.'
    ].filter(function (l) { return l !== null; }).join('\n');
  }

  function abrirCancelar(c) {
    var dlg = $('#cancelar-modal');
    dlg.textContent = '';
    var texto = el('textarea', { id: 'c-motivo', maxlength: '200', rows: '2', placeholder: 'O escribe otro motivo (opcional)…', 'aria-label': 'Motivo' });
    var chips = el('div', { class: 'h-motivos', role: 'group', 'aria-label': 'Motivos rápidos' }, MOTIVOS.map(function (m) {
      return el('button', { type: 'button', class: 'p-chip', 'aria-pressed': 'false', onclick: function () { texto.value = texto.value.trim() === m ? '' : m; marcarChips(); } }, [m]);
    }));
    function marcarChips() { chips.querySelectorAll('.p-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(b.textContent === texto.value.trim())); }); }
    texto.addEventListener('input', marcarChips);
    var avisar = el('input', { type: 'checkbox', id: 'c-avisar' });
    if (c.email) avisar.checked = true; else avisar.disabled = true;
    var err = el('div', { class: 'alert', role: 'alert', hidden: '' });
    var btn = el('button', { type: 'submit', class: 'btn btn-block g-danger-solid', text: 'Cancelar la cita' });
    var form = el('form', { novalidate: '' }, [
      el('h2', { id: 't-cancelar', text: 'Cancelar cita' }),
      el('div', { class: 'h-cita' }, [
        el('b', { text: c.cliente || 'Cliente' }),
        el('small', { text: cap(fechaLarga.format(utc(c.f)).replace(',', '')) + ' · ' + c.h + ' · ' + c.sn + ' · ' + nombreBarbero(c.b) })
      ]),
      el('span', { class: 'h-label', text: 'Motivo' }), chips, texto,
      el('label', { class: 'h-check' + (c.email ? '' : ' is-off') }, [avisar, el('span', {
        text: c.email ? 'Avisar al cliente por correo (' + c.email + ') con el motivo y un botón para reservar otra cita' : 'Este cliente no dejó correo: avísale por WhatsApp'
      })]),
      err,
      el('div', { class: 'h-botones' }, [btn, el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Volver', onclick: function () { dlg.close(); } })])
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var motivo = texto.value.trim();
      btn.disabled = true; btn.textContent = 'Cancelando…'; err.hidden = true;
      accion({ action: 'cancelarBarberia', clave: clave, b: c.b, e: c.id, motivo: motivo, avisar: avisar.checked }, function () { return { ok: true, avisado: avisar.checked }; })
        .then(function (r) {
          D.citas = D.citas.filter(function (x) { return !(x.id === c.id && x.b === c.b); });
          preparar(); pintar(); cargarHuecos(); cargarActividad();
          hechoCancelar(dlg, c, motivo, r);
        })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Cancelar la cita'; });
    });
    dlg.appendChild(form);
    dlg.showModal();
  }

  function hechoCancelar(dlg, c, motivo, r) {
    dlg.textContent = '';
    dlg.appendChild(el('form', { method: 'dialog', class: 'h-hecho' }, [
      el('h2', { id: 't-cancelar', text: 'Cita cancelada ✓' }),
      el('p', { class: 'g-text', text: (c.cliente || 'El cliente') + ' · ' + c.h + '. El hueco ya vuelve a estar libre en la web.' + (r.avisado ? ' Le hemos enviado un correo con el motivo.' : '') }),
      c.tel ? el('a', { href: waHref(c.tel) + '?text=' + encodeURIComponent(mensajeCancelada(c, motivo)), target: '_blank', rel: 'noopener', class: 'p-wa' },
        [el('span', { 'aria-hidden': 'true', text: '💬' }), el('span', { text: 'Avisar también por WhatsApp' })]) : null,
      el('button', { type: 'submit', class: 'btn btn-ghost btn-block', text: 'Cerrar' })
    ]));
  }

  // ---------- Huecos libres de hoy y mañana (texto para Instagram / WhatsApp) ----------
  var H = { datos: null, dia: 0 };
  function cargarHuecos() {
    $('#huecos-texto').value = 'Buscando huecos…';
    accion({ action: 'huecos', clave: clave }, huecosDemo)
      .then(function (r) { H.datos = r; pintarHuecos(); })
      .catch(function (err) { $('#huecos-texto').value = err.message; });
  }
  function huecosDemo() {
    var out = { ok: true, hoy: D.hoy, manana: addDays(D.hoy, 1), dias: {} };
    [out.hoy, out.manana].forEach(function (f) {
      out.dias[f] = {};
      D.barberos.forEach(function (b) {
        var ocupado = {}, libres = [];
        D.citas.forEach(function (c) { if (c.f === f && c.b === b.id) ocupado[c.h] = 1; });
        (D.horario[wd(f)] || []).forEach(function (t) {
          for (var m = toMin(t[0]); m + 30 <= toMin(t[1]); m += 30) {
            var h = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
            if (!ocupado[h] && (f !== D.hoy || h > D.ahora)) libres.push(h);
          }
        });
        out.dias[f][b.id] = libres;
      });
    });
    out.extra = {}; out.extra[out.hoy] = []; out.extra[out.manana] = C.horasExtra ? ['18:00', '18:30', '19:00'] : []; out.extraBarbero = C.horasExtra ? C.horasExtra.barbero : '';
    return out;
  }
  function textoHuecos() {
    var r = H.datos, f = H.dia ? r.manana : r.hoy, dias = r.dias[f] || {};
    var negocio = C.negocio.nombre || 'la barbería', web = location.host + '/reservar';
    var lineas = D.barberos.filter(function (b) { return (dias[b.id] || []).length; }).map(function (b) { return '✂️ ' + b.nombre + ': ' + dias[b.id].join(' · '); });
    var cuando = (H.dia ? 'mañana' : 'hoy');
    var hx = (r.extra && r.extra[f]) || [];
    if (hx.length) lineas.push('★ Fuera de horario con ' + nombreBarbero(r.extraBarbero) + ': ' + hx.join(' · '));
    if (!lineas.length) {
      return (D.horario[wd(f)] || []).length
        ? '💈 ' + negocio + '\n\n' + cap(cuando) + ' estamos completos. ¡Gracias! 🙌\n\n📲 Reserva para otro día en ' + web
        : '💈 ' + negocio + '\n\n' + cap(cuando) + ' estamos cerrados.\n\n📲 Reserva tu cita en ' + web;
    }
    return ['💈 ' + negocio + ' · Huecos libres ' + cuando + ', ' + fechaLarga.format(utc(f)).replace(',', ''), '']
      .concat(lineas).concat(['', '📲 Reserva en ' + web]).join('\n');
  }
  function pintarHuecos() {
    document.querySelectorAll('[data-huecos]').forEach(function (b) { b.setAttribute('aria-selected', String(+b.getAttribute('data-huecos') === H.dia)); });
    if (!H.datos) return;
    $('#huecos-texto').value = textoHuecos();
    enlaceHuecos();
  }
  function enlaceHuecos() { $('#huecos-wa').href = 'https://wa.me/?text=' + encodeURIComponent($('#huecos-texto').value); }
  function copiarHuecos() {
    var t = $('#huecos-texto'), b = $('#huecos-copiar');
    var ok = function () { b.textContent = 'Copiado ✓'; setTimeout(function () { b.textContent = 'Copiar texto'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(ok, function () { t.select(); document.execCommand('copy'); ok(); });
    else { t.select(); document.execCommand('copy'); ok(); }
  }

  // ---------- Detalle de cada cuadrado (ventana) ----------
  function abrirDetalle(titulo, sub, cuerpo) {
    var dlg = $('#detalle-modal');
    dlg.textContent = '';
    dlg.appendChild(el('form', { method: 'dialog' }, [
      el('div', { class: 'h-det-cab' }, [
        el('div', null, [el('h2', { id: 't-detalle', text: titulo }), sub ? el('p', { class: 'h-det-sub', text: sub }) : null]),
        el('button', { type: 'submit', class: 'h-cerrar', 'aria-label': 'Cerrar', text: '✕' })
      ]),
      el('div', { class: 'h-det-cuerpo' }, cuerpo)
    ]));
    dlg.showModal();
  }
  function subMes() { return cap(mesTexto(S.mes)) + (S.filtro === 'todos' ? ' · todos los barberos' : ' · ' + nombreBarbero(S.filtro)); }
  function fechaCorta(f) { return f.slice(8, 10) + '/' + f.slice(5, 7); }
  function estadoCita(c) { return c.novino ? (c.pagado ? 'No vino · pagado' : 'No vino') : pasada(c) ? 'Hecha' : 'Pendiente'; }
  function filaCita(c) {
    return el('li', { class: c.novino ? 'is-novino' : '' }, [
      el('span', { class: 'p-ag-h', text: fechaCorta(c.f) }),
      el('div', { class: 'p-ag-d' }, [
        el('b', { text: c.h + ' · ' + (c.cliente || 'Cliente') }),
        el('small', { text: [c.sn, eur.format(c.precio), S.filtro === 'todos' ? nombreBarbero(c.b) : '', c.origen === 'mostrador' ? 'Mostrador' : '', c.extra ? '★ Fuera de horario' : ''].filter(Boolean).join(' · ') }),
        c.tel ? el('small', { text: c.tel }) : null
      ]),
      el('span', { class: 'p-estado' + (c.novino ? ' is-mal' : pasada(c) ? ' is-ok' : ''), text: estadoCita(c) })
    ]);
  }
  // Lista con buscador (se pinta de 100 en 100)
  function listaBuscable(items, fila, vacio, textoDe) {
    var ul = el('ul', { class: 'p-agenda h-det-lista' }), mas = el('div', { class: 'h-mas' }), max = 100;
    var buscar = el('input', { type: 'search', class: 'h-det-buscar', placeholder: 'Buscar…', 'aria-label': 'Buscar', autocomplete: 'off' });
    function pintar() {
      var q = normal(buscar.value).trim();
      var lista = q ? items.filter(function (x) { return normal(textoDe(x)).indexOf(q) !== -1; }) : items;
      ul.textContent = ''; mas.textContent = '';
      if (!lista.length) ul.appendChild(el('li', { class: 'g-note', text: items.length ? 'Nada con esa búsqueda.' : vacio }));
      lista.slice(0, max).forEach(function (x) { ul.appendChild(fila(x)); });
      if (lista.length > max) mas.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Ver más (' + (lista.length - max) + ')', onclick: function () { max += 100; pintar(); } }));
    }
    buscar.addEventListener('input', function () { max = 100; pintar(); });
    pintar();
    return items.length > 8 ? [buscar, ul, mas] : [ul, mas];
  }
  function textoCita(c) { return [c.cliente, c.tel, c.email, c.sn, nombreBarbero(c.b), c.f, c.h].join(' '); }
  function detListaCitas(titulo, filtro) {
    var cs = delMes(S.mes).filter(filtro).reverse();
    var total = cs.filter(function (c) { return !c.novino || c.pagado; }).reduce(function (a, c) { return a + c.precio; }, 0);
    abrirDetalle(titulo, subMes() + ' · ' + cs.length + (cs.length === 1 ? ' cita' : ' citas') + ' · ' + eur.format(total), listaBuscable(cs, filaCita, 'No hay citas.', textoCita));
  }
  function tablaSimple(cab, filas) {
    return el('div', { class: 'p-table-wrap' }, [el('table', { class: 'p-table h-det-tabla' }, [
      el('thead', null, [el('tr', null, cab.map(function (h, i) { return el('th', { scope: 'col', class: i ? 'num' : '' }, [h]); }))]),
      el('tbody', null, filas.map(function (f) { return el('tr', null, f.map(function (v, i) { return el(i ? 'td' : 'th', i ? { class: 'num' } : { scope: 'row' }, [String(v)]); })); }))
    ])]);
  }
  function detFacturado() {
    var cs = delMes(S.mes), dias = {};
    cs.forEach(function (c) {
      var d = dias[c.f] = dias[c.f] || { n: 0, fact: 0, prev: 0 };
      if (!pasada(c)) { d.prev += c.precio; return; }
      if (!c.novino || c.pagado) { d.n++; d.fact += c.precio; }
    });
    var filas = Object.keys(dias).sort().reverse().map(function (f) {
      var d = dias[f]; return [cap(DIA_CORTO[wd(f)]) + ' ' + fechaCorta(f), d.n || '—', d.fact ? eur.format(d.fact) : '—', d.prev ? eur.format(d.prev) : '—'];
    });
    var cuerpo = [];
    if (S.filtro === 'todos') {
      var porB = D.barberos.map(function (b) {
        var f = 0, pv = 0;
        cs.filter(function (c) { return c.b === b.id; }).forEach(function (c) { if (!pasada(c)) pv += c.precio; else if (!c.novino || c.pagado) f += c.precio; });
        return [b.nombre, eur.format(f), eur.format(pv)];
      });
      cuerpo.push(el('h3', { class: 'h-det-h', text: 'Por barbero' }), tablaSimple(['Barbero', 'Facturado', 'Previsto'], porB));
    }
    cuerpo.push(el('h3', { class: 'h-det-h', text: 'Día a día' }), tablaSimple(['Día', 'Citas', 'Facturado', 'Previsto'], filas));
    var r = resumen(S.mes);
    abrirDetalle('Facturado', subMes() + ' · ' + eur.format(r.facturado) + (r.previsto ? ' + ' + eur.format(r.previsto) + ' previstos' : ''), cuerpo);
  }
  function detCitas() { detListaCitas('Citas', function () { return true; }); }
  function detTicket() {
    var hechas = delMes(S.mes).filter(function (c) { return pasada(c) && (!c.novino || c.pagado); });
    function agrupar(clave) {
      var acc = {};
      hechas.forEach(function (c) { var k = clave(c); acc[k] = acc[k] || { n: 0, e: 0 }; acc[k].n++; acc[k].e += c.precio; });
      return Object.keys(acc).map(function (k) { return [k, acc[k].n, eur.format(acc[k].e), eur2.format(Math.round(acc[k].e / acc[k].n * 100) / 100)]; })
        .sort(function (a, b) { return b[1] - a[1]; });
    }
    var cuerpo = [];
    if (S.filtro === 'todos') cuerpo.push(el('h3', { class: 'h-det-h', text: 'Por barbero' }), tablaSimple(['Barbero', 'Citas', 'Total', 'Ticket'], agrupar(function (c) { return nombreBarbero(c.b); })));
    cuerpo.push(el('h3', { class: 'h-det-h', text: 'Por servicio' }), tablaSimple(['Servicio', 'Citas', 'Total', 'Precio medio'], agrupar(function (c) { return c.sn; })));
    abrirDetalle('Ticket medio', subMes() + ' · citas ya hechas', cuerpo);
  }
  function detOcupacion() {
    var nB = S.filtro === 'todos' ? D.barberos.length : 1, cs = delMes(S.mes), out = [];
    for (var d = 1; d <= diasDelMes(S.mes); d++) {
      var f = S.mes + '-' + ('0' + d).slice(-2), abierto = 0;
      (D.horario[wd(f)] || []).forEach(function (t) { abierto += toMin(t[1]) - toMin(t[0]); });
      if (!abierto) continue;
      var ocup = cs.filter(function (c) { return c.f === f; }).reduce(function (a, c) { return a + c.dur; }, 0);
      out.push({ l: DIA_CORTO[wd(f)] + ' ' + fechaCorta(f), v: Math.min(100, pct(ocup, abierto * nB)), abrir: (function (ff) { return function () { detListaCitas('Citas del ' + fechaCorta(ff), function (x) { return x.f === ff; }); }; })(f) });
    }
    var box = el('div', { class: 'p-bars h-det-barras' });
    barras(box, out, function (x) { return x.v + ' %'; });
    abrirDetalle('Ocupación por día', subMes() + ' · pulsa un día para ver sus citas', [box]);
  }
  function detNuevos() {
    var vistos = {}, lista = [];
    delMes(S.mes).forEach(function (c) {
      var k = c.email;
      if (!k || vistos[k] || primeraVisita[k] !== c.f) return;
      vistos[k] = 1;
      var visitas = D.citas.filter(function (x) { return x.email === k && pasada(x) && !x.novino; }).length;
      lista.push({ c: c, visitas: visitas });
    });
    abrirDetalle('Clientes nuevos', subMes() + ' · ' + lista.length + ' con su primera reserva este mes', listaBuscable(lista.reverse(), function (x) {
      return el('li', null, [
        el('span', { class: 'p-ag-h', text: fechaCorta(x.c.f) }),
        el('div', { class: 'p-ag-d' }, [el('b', { text: x.c.cliente || 'Cliente' }), el('small', { text: [x.c.sn, nombreBarbero(x.c.b), x.c.tel].filter(Boolean).join(' · ') })]),
        el('span', { class: 'p-estado' + (x.visitas > 1 ? ' is-ok' : ''), text: x.visitas > 1 ? 'Ha vuelto (' + x.visitas + ')' : x.visitas ? '1 visita' : 'Aún no ha venido' })
      ]);
    }, 'Ningún cliente nuevo este mes.', function (x) { return textoCita(x.c); }));
  }
  function detNoVino() {
    var cs = delMes(S.mes).filter(function (c) { return c.novino; }).reverse();
    abrirDetalle('No vinieron', subMes(), listaBuscable(cs, function (c) {
      var li = filaCita(c);
      if (c.tel && !c.pagado) li.querySelector('.p-ag-d').appendChild(el('a', { href: waAviso(c), target: '_blank', rel: 'noopener', class: 'p-wa' }, ['🤖 Enviar aviso del bot']));
      return li;
    }, 'Nadie ha fallado este mes. ¡Bien!', textoCita));
  }
  // Cancelaciones y cambios: salen del registro (el detalle existe desde que se activó, el 21/10/2026)
  function detRegistro(tipo, titulo) {
    var mostrar = function () {
      var lista = filtrarActividad(A.items || [], S.filtro === 'todos' ? '' : S.filtro, tipo, '').filter(function (x) { return (x.f || x.t.slice(0, 10)).slice(0, 7) === S.mes || x.t.slice(0, 7) === S.mes; });
      abrirDetalle(titulo, subMes() + ' · ' + lista.length + (lista.length === 1 ? ' registro' : ' registros'), [
        el('p', { class: 'g-note', style: 'margin-top:0', text: 'El detalle (quién y cuándo) se guarda desde el 21 de octubre de 2026. Antes solo se contaba cuántas hubo.' })
      ].concat(listaBuscable(lista, function (x) {
        var cuando = fHoraMadrid.format(new Date(x.t)).split(', ');
        return el('li', null, [
          el('span', { class: 'p-ag-h', text: cuando[0] }),
          el('div', { class: 'p-ag-d' }, [
            el('b', { text: x.cliente || 'Cliente' }),
            el('small', { text: [TIPO_TXT[x.tipo] || x.tipo, x.servicio, x.f ? 'cita ' + fechaCorta(x.f) + (x.h ? ' ' + x.h : '') : '', x.barbero].filter(Boolean).join(' · ') }),
            x.detalle ? el('small', { text: x.detalle }) : null,
            x.tel ? el('small', { text: x.tel }) : null
          ])
        ]);
      }, 'Aún no hay ninguna registrada este mes.', function (x) { return [x.cliente, x.tel, x.email, x.servicio, x.detalle].join(' '); })));
    };
    if (A.items) mostrar(); else accion({ action: 'actividad', clave: clave, dias: A.dias }, actividadDemo).then(function (r) { A.items = r.items || []; mostrar(); }, function (err) { alert(err.message); });
  }

  // ---------- Lista de espera ----------
  var FRANJA_TXT = { manana: 'Mañana', tarde: 'Tarde', todo: 'Cualquier hora' };
  function esperaFiltrada() {
    return (D.espera || []).filter(function (x) { return S.filtro === 'todos' || x.b === S.filtro || x.b === 'any'; })
      .sort(function (a, b) { return (a.f + a.apuntado).localeCompare(b.f + b.apuntado); });
  }
  function mensajeEspera(x) {
    var url = location.origin + '/reservar?service=' + encodeURIComponent(x.s) + '&barber=' + encodeURIComponent(x.b) + '&date=' + x.f;
    return [
      'Hola, ' + (String(x.nombre || '').split(' ')[0] || 'cliente') + ':',
      'Te escribimos de ' + (C.negocio.nombre || 'la barbería') + '. Estás en nuestra lista de espera para el ' + fechaLarga.format(utc(x.f)).replace(',', '') + ' (' + FRANJA_TXT[x.franja].toLowerCase() + ').',
      '',
      '¡Se nos ha quedado un hueco libre! Resérvalo aquí antes de que vuele:',
      url
    ].join('\n');
  }
  function detEspera() {
    var lista = esperaFiltrada();
    abrirDetalle('Lista de espera', lista.length + (lista.length === 1 ? ' persona esperando hueco' : ' personas esperando hueco') + (S.filtro === 'todos' ? '' : ' · ' + nombreBarbero(S.filtro)), [
      el('p', { class: 'g-note', style: 'margin-top:0', text: 'Cuando se libera un hueco que les encaja, les llega un correo automático. Con «Enviar WhatsApp» les escribes tú con el mensaje ya preparado.' })
    ].concat(listaBuscable(lista, function (x) {
      var li = el('li', null, [
        el('span', { class: 'p-ag-h', text: fechaCorta(x.f) }),
        el('div', { class: 'p-ag-d' }, [
          el('b', { text: x.nombre }),
          el('small', { text: [cap(fechaLarga.format(utc(x.f)).replace(',', '')), FRANJA_TXT[x.franja] || x.franja, x.b === 'any' ? 'Cualquier barbero' : nombreBarbero(x.b), (D.servicios[x.s] || {}).nombre].filter(Boolean).join(' · ') }),
          el('small', { text: x.tel + (x.avisado ? ' · ya avisado por correo' : '') }),
          x.tel ? el('a', { href: waHref(x.tel) + '?text=' + encodeURIComponent(mensajeEspera(x)), target: '_blank', rel: 'noopener', class: 'p-wa' }, [el('span', { 'aria-hidden': 'true', text: '💬' }), el('span', { text: 'Enviar WhatsApp' })]) : null
        ]),
        el('button', { type: 'button', class: 'p-novino', text: 'Quitar', onclick: function (ev) { quitarEspera(x, ev.currentTarget); } })
      ]);
      return li;
    }, 'Nadie en la lista de espera.', function (x) { return [x.nombre, x.tel, x.email].join(' '); })));
  }
  function quitarEspera(x, btn) {
    if (!confirm('¿Quitar a ' + x.nombre + ' de la lista de espera?')) return;
    btn.disabled = true;
    accion({ action: 'esperaQuitar', clave: clave, id: x.id }, function () { return { ok: true, espera: D.espera.filter(function (y) { return y.id !== x.id; }) }; })
      .then(function (r) { D.espera = r.espera || []; pintarKpis(); detEspera(); })
      .catch(function (err) { btn.disabled = false; alert(err.message); });
  }

  // ---------- Correos enviados hoy (Google: unos 100 al día con una cuenta gratuita) ----------
  function pintarCorreos() {
    var s = $('#p-correos'), k = D.correos;
    if (!k || k.restantes === undefined || k.restantes === null) { s.hidden = true; return; }
    var limite = k.limite || 100, usados = Math.max(0, limite - k.restantes);
    s.textContent = '';
    s.appendChild(el('span', { class: 'p-correos-t', text: 'Correos hoy: ' }));
    s.appendChild(document.createTextNode('✉ ' + usados + ' / ' + limite));
    s.className = 'p-correos' + (usados >= 95 ? ' is-mal' : usados >= 80 ? ' is-aviso' : '');
    s.hidden = false;
  }

  // ---------- Actividad (registro de todo lo que pasa con las citas) ----------
  var A = { items: null, dias: 60, max: 40 };
  var TIPO_TXT = {
    reserva: 'Reserva', cambio: 'Cambio', cancelacion_cliente: 'Cancelada por el cliente', cancelacion_barberia: 'Cancelada por la barbería',
    mostrador: 'Mostrador', deshecha: 'Deshecha', no_show: 'No vino', no_show_quitado: 'Quitado «No vino»', pagado: 'Pagado'
  };
  var fHoraMadrid = new Intl.DateTimeFormat('es-ES', { timeZone: C.negocio.zonaHoraria || 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function cargarActividad() {
    var ul = $('#actividad');
    if (!A.items) { ul.textContent = ''; ul.appendChild(el('li', { class: 'g-note', text: 'Cargando la actividad…' })); }
    accion({ action: 'actividad', clave: clave, dias: A.dias }, actividadDemo)
      .then(function (r) { A.items = r.items || []; A.dias = r.dias || A.dias; pintarActividad(); })
      .catch(function (err) { ul.textContent = ''; ul.appendChild(el('li', { class: 'alert', text: err.message })); });
  }
  function actividadDemo() {
    var items = [], ahora = Date.now();
    D.citas.filter(function (c) { return c.f >= addDays(D.hoy, -10) && c.f <= addDays(D.hoy, 6); }).forEach(function (c, i) {
      var t = utc(c.f).getTime() - (i % 5 + 1) * 86400000 + (i % 9) * 3600000;
      items.push({ t: new Date(Math.min(t, ahora - i * 60000)).toISOString(), tipo: c.origen === 'mostrador' ? 'mostrador' : 'reserva', b: c.b, barbero: nombreBarbero(c.b),
        cliente: c.cliente, tel: c.tel, email: c.email, servicio: c.sn, precio: c.precio, f: c.f, h: c.h, origen: c.origen === 'mostrador' ? 'Agenda de ' + nombreBarbero(c.b) : 'Web', detalle: '' });
      if (c.novino) items.push({ t: new Date(utc(c.f).getTime() + 3600000 * 8).toISOString(), tipo: 'no_show', b: c.b, barbero: nombreBarbero(c.b), cliente: c.cliente, tel: c.tel, email: c.email, servicio: c.sn, precio: c.precio, f: c.f, h: c.h, origen: 'Panel', detalle: '' });
      if (i % 11 === 3) items.push({ t: new Date(t + 7200000).toISOString(), tipo: 'cambio', b: c.b, barbero: nombreBarbero(c.b), cliente: c.cliente, tel: c.tel, email: c.email, servicio: c.sn, precio: c.precio, f: c.f, h: c.h, origen: 'Web (el cliente)', detalle: 'Antes: ' + c.f.split('-').reverse().slice(0, 2).join('/') + ' a las 10:00' });
      if (i % 13 === 5) items.push({ t: new Date(t + 3600000).toISOString(), tipo: 'cancelacion_cliente', b: c.b, barbero: nombreBarbero(c.b), cliente: c.cliente, tel: c.tel, email: c.email, servicio: c.sn, precio: c.precio, f: c.f, h: '11:30', origen: 'Web (el cliente)', detalle: '' });
    });
    items.sort(function (a, b) { return b.t.localeCompare(a.t); });
    return { ok: true, items: items.filter(function (x) { return x.t <= new Date().toISOString(); }), dias: A.dias };
  }
  function normal(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function filtrarActividad(items, b, tipo, q) {
    q = normal(q).trim();
    return items.filter(function (x) {
      if (b && x.b !== b) return false;
      if (tipo && String(x.tipo).indexOf(tipo) !== 0) return false;
      return !q || normal([x.cliente, x.tel, x.email, x.servicio, x.barbero, x.detalle].join(' ')).indexOf(q) !== -1;
    });
  }
  function pintarActividad() {
    var sel = $('#act-barbero');
    if (sel.options.length === 1) D.barberos.forEach(function (b) { sel.appendChild(el('option', { value: b.id, text: b.nombre })); });
    var ul = $('#actividad'), mas = $('#act-mas'); ul.textContent = ''; mas.textContent = '';
    if (!A.items) return;
    var lista = filtrarActividad(A.items, sel.value, $('#act-tipo').value, $('#act-buscar').value);
    if (!lista.length) ul.appendChild(el('li', { class: 'g-note', text: A.items.length ? 'Nada con esos filtros.' : 'Aún no hay actividad. Se irá llenando con cada reserva, cambio o cancelación.' }));
    lista.slice(0, A.max).forEach(function (x) {
      var cuando = fHoraMadrid.format(new Date(x.t)).split(', ');
      var cita = x.f ? x.f.split('-').reverse().slice(0, 2).join('/') + (x.h ? ' ' + x.h : '') : '';
      ul.appendChild(el('li', null, [
        el('time', { datetime: x.t }, [el('b', { text: cuando[0] }), cuando[1] || '']),
        el('div', { class: 'h-d' }, [
          el('span', null, [el('span', { class: 'h-tipo t-' + x.tipo, text: TIPO_TXT[x.tipo] || x.tipo }), el('b', { text: x.cliente || 'Cliente' })]),
          el('small', { text: [x.servicio, cita ? 'cita ' + cita : '', x.barbero, x.precio !== '' && x.precio !== undefined ? eur2.format(x.precio) : ''].filter(Boolean).join(' · ') }),
          el('small', { text: [x.tel, x.email].filter(Boolean).join(' · ') }),
          x.origen || x.detalle ? el('small', { text: [x.origen, x.detalle].filter(Boolean).join(' · ') }) : null
        ])
      ]));
    });
    mas.appendChild(el('span', { class: 'g-note', style: 'margin:0', text: lista.length + (lista.length === 1 ? ' movimiento' : ' movimientos') + ' en los últimos ' + A.dias + ' días' }));
    if (lista.length > A.max) mas.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Ver más', onclick: function () { A.max += 60; pintarActividad(); } }));
    if (A.dias < 730) mas.appendChild(el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: A.dias < 365 ? 'Ver hasta 1 año atrás' : 'Ver hasta 2 años atrás', onclick: function () { A.dias = A.dias < 365 ? 365 : 730; cargarActividad(); } }));
  }

  // ---------- No vinieron (mes elegido) ----------
  function pintarNoVino() {
    var r = resumen(S.mes), box = $('#novino-lista'); box.textContent = '';
    $('#novino-resumen').textContent = r.novino
      ? r.novino + (r.novino === 1 ? ' cliente no vino' : ' clientes no vinieron') + ' · ' + eur.format(r.pendienteNoVino) + ' por cobrar · ' + eur.format(r.cobradoNoVino) + ' cobrados'
      : 'Nadie ha fallado este mes. ¡Bien!';
    var cs = delMes(S.mes).filter(function (c) { return c.novino; }).reverse();
    if (!cs.length) return;
    var ul = el('ul', { class: 'p-agenda p-novinos' });
    cs.forEach(function (c) {
      var veces = noShowsDe(c), bloq = bloqueado(c);
      ul.appendChild(el('li', null, [
        el('span', { class: 'p-ag-h', text: c.f.slice(8, 10) + '/' + c.f.slice(5, 7) }),
        el('div', { class: 'p-ag-d' }, [
          el('b', { text: (c.cliente || 'Cliente') }),
          el('small', { text: c.h + ' · ' + c.sn + ' · ' + eur.format(c.precio) + ' · ' + nombreBarbero(c.b) }),
          el('small', { class: veces >= 2 ? 'p-alerta' : '', text: veces === 1 ? 'Primera vez que falla' : 'Ha fallado ' + veces + ' veces' }),
          c.tel && !c.pagado ? el('a', { href: waAviso(c), target: '_blank', rel: 'noopener', class: 'p-wa', title: 'Abre WhatsApp con un mensaje automático del asistente Book Lab' }, ['🤖 Enviar aviso del bot']) : null
        ]),
        el('div', { class: 'p-acciones' }, [
          el('button', { type: 'button', class: 'p-novino p-pagado', 'aria-pressed': String(!!c.pagado), onclick: function (ev) { marcarPagado(c, ev.currentTarget); } }, [c.pagado ? 'Pagado ✓' : 'Marcar pagado']),
          bloq
            ? el('span', { class: 'p-ag-pend', text: 'Bloqueado' })
            : el('button', { type: 'button', class: 'p-novino', onclick: function (ev) { bloquearCliente(c, ev.currentTarget); } }, ['Bloquear'])
        ])
      ]));
    });
    box.appendChild(ul);
  }

  // ---------- Bloqueados ----------
  function bloquear(datos, btn) {
    if (btn) btn.disabled = true;
    return accion({ action: 'bloquear', clave: clave, email: datos.email, tel: datos.tel, nombre: datos.nombre, motivo: datos.motivo }, function () {
      var lista = D.bloqueados.concat([{ id: 'demo' + Date.now(), email: String(datos.email || '').toLowerCase(), tel: telNorm(datos.tel), nombre: datos.nombre || '', motivo: datos.motivo || '', fecha: D.hoy }]);
      return { ok: true, bloqueados: lista };
    }).then(function (r) { D.bloqueados = r.bloqueados; pintar(); })
      .catch(function (err) { if (btn) btn.disabled = false; throw err; });
  }

  function bloquearCliente(c, btn) {
    var veces = noShowsDe(c);
    if (!confirm('¿Bloquear a ' + (c.cliente || 'este cliente') + '? No podrá reservar online (ha fallado ' + veces + (veces === 1 ? ' vez' : ' veces') + ').')) return;
    bloquear({ email: c.email, tel: c.tel, nombre: c.cliente, motivo: 'No vino ' + veces + (veces === 1 ? ' vez' : ' veces') }, btn).catch(function (err) { alert(err.message); });
  }

  function pintarBloqueados() {
    var ul = $('#bloqueados'); ul.textContent = '';
    if (!D.bloqueados.length) { ul.appendChild(el('li', { class: 'g-note', text: 'No hay nadie bloqueado.' })); return; }
    D.bloqueados.forEach(function (x) {
      ul.appendChild(el('li', { class: 'p-bloq' }, [
        el('div', null, [
          el('b', { text: x.nombre || x.email || x.tel }),
          el('small', { text: [x.email, x.tel].filter(Boolean).join(' · ') }),
          el('small', { text: (x.motivo ? x.motivo + ' · ' : '') + 'Desde el ' + x.fecha.split('-').reverse().join('/') })
        ]),
        el('button', { type: 'button', class: 'p-novino', onclick: function (ev) { desbloquear(x, ev.currentTarget); } }, ['Desbloquear'])
      ]));
    });
  }

  function desbloquear(x, btn) {
    if (!confirm('¿Desbloquear a ' + (x.nombre || x.email || x.tel) + '? Podrá volver a reservar online.')) return;
    btn.disabled = true;
    accion({ action: 'desbloquear', clave: clave, id: x.id }, function () {
      return { ok: true, bloqueados: D.bloqueados.filter(function (y) { return y.id !== x.id; }) };
    }).then(function (r) { D.bloqueados = r.bloqueados; pintar(); })
      .catch(function (err) { btn.disabled = false; alert(err.message); });
  }

  function pintarClientes() {
    var visitas = {};
    D.citas.filter(function (c) { return pasada(c) && !c.novino && c.email && enFiltro(c); }).forEach(function (c) {
      var v = visitas[c.email] = visitas[c.email] || { n: 0, e: 0, nombre: c.cliente, tel: c.tel };
      v.n++; v.e += c.precio;
    });
    var top = Object.keys(visitas).map(function (k) { return visitas[k]; }).sort(function (a, b) { return b.n - a.n || b.e - a.e; }).slice(0, 5);
    var ol = $('#top'); ol.textContent = '';
    if (!top.length) ol.appendChild(el('li', { class: 'g-note', text: 'Aún no hay visitas.' }));
    top.forEach(function (v) { ol.appendChild(el('li', null, [el('b', { text: v.nombre }), el('small', { text: v.n + ' visitas · ' + eur.format(v.e) })])); });

    var limite = addDays(D.hoy, -45), futuras = {};
    D.citas.forEach(function (c) { if (!pasada(c)) futuras[c.email] = 1; });
    var perdidos = Object.keys(ultimaVisita).filter(function (e) { return ultimaVisita[e] < limite && !futuras[e] && visitas[e]; })
      .sort(function (a, b) { return ultimaVisita[b].localeCompare(ultimaVisita[a]); }).slice(0, 8);
    var ul = $('#perdidos'); ul.textContent = '';
    if (!perdidos.length) ul.appendChild(el('li', { class: 'g-note', text: 'Nadie por ahora. ¡Bien!' }));
    perdidos.forEach(function (e) {
      var v = visitas[e], dias = Math.round((utc(D.hoy) - utc(ultimaVisita[e])) / 86400000);
      ul.appendChild(el('li', null, [
        el('b', { text: v.nombre }), el('small', { text: 'Última visita hace ' + dias + ' días' }),
        v.tel ? el('a', { href: waHref(v.tel), target: '_blank', rel: 'noopener', class: 'p-ag-tel', text: 'Escribir por WhatsApp' }) : null
      ]));
    });
  }

  function exportar() {
    var filas = [['Fecha', 'Hora', 'Barbero', 'Servicio', 'Precio', 'Cliente', 'Correo', 'Teléfono', 'Estado']];
    delMes(S.mes).forEach(function (c) {
      filas.push([c.f, c.h, nombreBarbero(c.b), c.sn, String(c.precio).replace('.', ','), c.cliente, c.email, c.tel, c.novino ? 'No vino' : (pasada(c) ? 'Hecha' : 'Pendiente')]);
    });
    var csv = '﻿' + filas.map(function (f) { return f.map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    var a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'citas-' + S.mes + (S.filtro !== 'todos' ? '-' + S.filtro : '') + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- Inicio ----------
  $('#p-name').textContent = C.negocio.nombre;
  $('#mes').addEventListener('change', function () { S.mes = this.value; pintar(); });
  $('#mes-ant').addEventListener('click', function () { var s = $('#mes'); if (s.selectedIndex > 0) { s.selectedIndex--; S.mes = s.value; pintar(); } });
  $('#mes-sig').addEventListener('click', function () { var s = $('#mes'); if (s.selectedIndex < s.options.length - 1) { s.selectedIndex++; S.mes = s.value; pintar(); } });
  document.querySelectorAll('.p-tabs [data-dia]').forEach(function (b) { b.addEventListener('click', function () { S.dia = addDays(D.hoy, +b.getAttribute('data-dia')); pintarAgenda(); }); });
  $('#agenda-fecha').addEventListener('change', function () { if (this.value) { S.dia = this.value; pintarAgenda(); } });
  $('#form-bloquear').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#b-error'); err.hidden = true;
    var datos = { nombre: $('#b-nombre').value.trim(), email: $('#b-email').value.trim(), tel: $('#b-tel').value.trim(), motivo: $('#b-motivo').value.trim() };
    if (!datos.email && telNorm(datos.tel).length < 9) { err.textContent = 'Escribe el correo o el teléfono (9 cifras) del cliente.'; err.hidden = false; return; }
    var btn = this.querySelector('button[type="submit"]');
    bloquear(datos, btn).then(function () {
      ['#b-nombre', '#b-email', '#b-tel', '#b-motivo'].forEach(function (s) { $(s).value = ''; });
      btn.disabled = false;
    }).catch(function (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; });
  });
  document.querySelectorAll('[data-huecos]').forEach(function (b) { b.addEventListener('click', function () { H.dia = +b.getAttribute('data-huecos'); pintarHuecos(); }); });
  $('#huecos-texto').addEventListener('input', enlaceHuecos);
  $('#huecos-copiar').addEventListener('click', copiarHuecos);
  $('#huecos-actualizar').addEventListener('click', cargarHuecos);
  ['#act-barbero', '#act-tipo'].forEach(function (s) { $(s).addEventListener('change', function () { A.max = 40; pintarActividad(); }); });
  $('#act-buscar').addEventListener('input', function () { A.max = 40; pintarActividad(); });
  $('#exportar').addEventListener('click', exportar);
  $('#recargar').addEventListener('click', cargar);
  // "Volver a la web": a la página de la que vienes (si es de esta web); si no, a la portada
  try {
    var ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.origin === location.origin && ref.pathname !== location.pathname) $('#volver').href = ref.pathname + ref.search;
  } catch (e) { /* sin referrer */ }

  $('#salir').addEventListener('click', function () { guardar(''); clave = ''; D = null; $('#clave').value = ''; show('#v-login'); });
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    clave = $('#clave').value.trim();
    $('#login-error').hidden = true;
    if (!clave) { $('#login-error').textContent = 'Escribe la clave.'; $('#login-error').hidden = false; return; }
    if ($('#recordar').checked) guardar(clave);
    cargar();
  });

  if (DEMO) {
    var n = $('#p-demo');
    n.className = 'notice p-privado';
    n.appendChild(el('span', { class: 'p-privado-ico', 'aria-hidden': 'true', text: '🔒' }));
    n.appendChild(el('span', null, [
      el('strong', { text: 'Panel de ejemplo · Privado. ' }),
      'Los números son inventados para que veas cómo funciona. En tu web, este panel es privado: solo entra el dueño con su clave personal y tus clientes no lo ven.'
    ]));
    n.hidden = false;
    cargar();
  } else {
    // La clave puede venir en el enlace (#clave=...) o estar guardada en este dispositivo
    var m = location.hash.match(/clave=([^&]+)/);
    if (m) { clave = decodeURIComponent(m[1]); guardar(clave); history.replaceState(null, '', location.pathname + location.search); }
    else clave = leer();
    var enlaceEjemplo = document.querySelector('#ver-ejemplo');
    if (enlaceEjemplo) enlaceEjemplo.hidden = !EJEMPLO_PERMITIDO;
    if (clave) cargar(); else show('#v-login');
  }
})();
