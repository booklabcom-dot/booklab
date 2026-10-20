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
  var S = { mes: '', filtro: 'todos', dia: 0 };
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
              cliente: cl.cliente, email: cl.email, tel: cl.tel, novino: (f < hoy && rnd() < 0.04), cambios: rnd() < 0.08 ? 1 : 0 });
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
    return { ok: true, negocio: C.negocio.nombre, hoy: hoy, ahora: ahora, barberos: barberos, servicios: servicios, horario: C.horario, estadisticas: est, citas: citas };
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
    var facturado = hechas.reduce(function (s, c) { return s + c.precio; }, 0);
    var previsto = futuras.reduce(function (s, c) { return s + c.precio; }, 0);
    var ocupado = cs.reduce(function (s, c) { return s + c.dur; }, 0);
    var nB = S.filtro === 'todos' ? D.barberos.length : 1;
    var est = D.estadisticas[m] || {}, cancel = 0, cambios = 0;
    Object.keys(est).forEach(function (b) { if (S.filtro === 'todos' || b === S.filtro) { cancel += est[b].cancelaciones || 0; cambios += est[b].cambios || 0; } });
    var nuevos = {};
    cs.forEach(function (c) { if (c.email && primeraVisita[c.email] && primeraVisita[c.email].slice(0, 7) === m) nuevos[c.email] = 1; });
    return {
      citas: cs.length, hechas: hechas.length, futuras: futuras.length, novino: novino.length,
      facturado: facturado, previsto: previsto, ticket: hechas.length ? facturado / hechas.length : 0,
      ocupacion: pct(ocupado, minutosDisponibles(m, nB)), cancelaciones: cancel, cambios: cambios, nuevos: Object.keys(nuevos).length
    };
  }

  // ---------- Pintar ----------
  function pintar() {
    pintarFiltro();
    pintarKpis();
    pintarBarberos();
    pintarEvolucion();
    pintarAgenda();
    pintarServicios();
    pintarPunta();
    pintarClientes();
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

  function kpi(titulo, valor, sub, extra) {
    return el('div', { class: 'p-kpi' }, [el('span', { class: 'p-kpi-t', text: titulo }), el('b', { text: valor }), extra || null, sub ? el('small', { text: sub }) : null]);
  }

  function pintarKpis() {
    var esActual = S.mes === D.hoy.slice(0, 7);
    var r = resumen(S.mes), antes = resumen(mesAnterior(S.mes), esActual ? Number(D.hoy.slice(8, 10)) : 0);
    var box = $('#kpis'); box.textContent = '';
    box.appendChild(kpi('Facturado', eur.format(r.facturado), r.previsto ? '+ ' + eur.format(r.previsto) + ' previstos este mes' : (esActual ? 'Hasta hoy' : ''), delta(r.facturado, antes.facturado)));
    box.appendChild(kpi('Citas', num.format(r.citas), r.hechas + ' hechas · ' + r.futuras + ' pendientes', delta(r.citas, antes.citas)));
    box.appendChild(kpi('Ticket medio', eur2.format(Math.round(r.ticket * 100) / 100), 'Por cita realizada'));
    box.appendChild(kpi('Ocupación', r.ocupacion + ' %', 'Horas reservadas sobre horas abiertas'));
    box.appendChild(kpi('Clientes nuevos', num.format(r.nuevos), 'Primera reserva este mes'));
    box.appendChild(kpi('No vinieron', num.format(r.novino), r.hechas + r.novino ? pct(r.novino, r.hechas + r.novino) + ' % de las citas pasadas' : ''));
    box.appendChild(kpi('Cancelaciones', num.format(r.cancelaciones), 'Desde la web'));
    box.appendChild(kpi('Cambios de cita', num.format(r.cambios), 'Desde la web'));
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
      box.appendChild(el('div', { class: 'p-bar' }, [
        el('span', { class: 'p-bar-l', text: i.l }),
        el('span', { class: 'p-bar-t' }, [el('span', { class: 'p-bar-f', style: 'width:' + Math.max(2, i.v / max * 100) + '%' })]),
        el('span', { class: 'p-bar-v', text: fmt(i) })
      ]));
    });
  }

  function pintarServicios() {
    var acc = {};
    delMes(S.mes).filter(function (c) { return !c.novino; }).forEach(function (c) {
      acc[c.sn] = acc[c.sn] || { l: c.sn, v: 0, e: 0 }; acc[c.sn].v++; acc[c.sn].e += c.precio;
    });
    barras($('#servicios'), Object.keys(acc).map(function (k) { return acc[k]; }).sort(function (a, b) { return b.v - a.v; }),
      function (i) { return i.v + ' · ' + eur.format(i.e); });
  }

  function pintarPunta() {
    var cs = delMes(S.mes).filter(function (c) { return !c.novino; }), dias = {}, horas = {};
    cs.forEach(function (c) { var d = wd(c.f); dias[d] = (dias[d] || 0) + 1; var h = c.h.slice(0, 2); horas[h] = (horas[h] || 0) + 1; });
    var d = [];
    for (var i = 1; i <= 7; i++) if ((D.horario[i] || []).length) d.push({ l: DIA_CORTO[i], v: dias[i] || 0 });
    barras($('#dias'), d, function (x) { return String(x.v); });
    barras($('#horas'), Object.keys(horas).sort().map(function (h) { return { l: h + ':00', v: horas[h] }; }), function (x) { return String(x.v); });
  }

  function pintarAgenda() {
    document.querySelectorAll('.p-tabs [data-dia]').forEach(function (b) { b.setAttribute('aria-selected', String(+b.getAttribute('data-dia') === S.dia)); });
    var dia = addDays(D.hoy, S.dia), box = $('#agenda'); box.textContent = '';
    var cs = D.citas.filter(function (c) { return c.f === dia && enFiltro(c); });
    if (!cs.length) { box.appendChild(el('p', { class: 'g-note', text: 'No hay citas reservadas por la web.' })); return; }
    var ul = el('ul', { class: 'p-agenda' });
    cs.forEach(function (c) {
      var puedeMarcar = pasada(c);
      ul.appendChild(el('li', { class: c.novino ? 'is-novino' : '' }, [
        el('span', { class: 'p-ag-h', text: c.h }),
        el('div', { class: 'p-ag-d' }, [
          el('b', { text: c.cliente || 'Cliente' }),
          el('small', { text: c.sn + ' · ' + eur.format(c.precio) + (S.filtro === 'todos' ? ' · ' + nombreBarbero(c.b) : '') }),
          c.tel ? el('a', { href: telHref(c.tel), class: 'p-ag-tel', text: c.tel }) : null
        ]),
        puedeMarcar ? el('button', { type: 'button', class: 'p-novino', 'aria-pressed': String(!!c.novino), onclick: function (ev) { marcarNoVino(c, ev.currentTarget); } }, [c.novino ? 'No vino ✓' : 'No vino']) : null
      ]));
    });
    box.appendChild(ul);
  }

  function marcarNoVino(c, btn) {
    var valor = !c.novino;
    btn.disabled = true;
    var prom = DEMO ? Promise.resolve({ ok: true }) : pedir({ action: 'novino', clave: clave, b: c.b, e: c.id, valor: valor });
    prom.then(function () { c.novino = valor; preparar(); pintar(); }).catch(function (err) { btn.disabled = false; alert(err.message); });
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
  document.querySelectorAll('.p-tabs [data-dia]').forEach(function (b) { b.addEventListener('click', function () { S.dia = +b.getAttribute('data-dia'); pintarAgenda(); }); });
  $('#exportar').addEventListener('click', exportar);
  $('#recargar').addEventListener('click', cargar);
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
    n.appendChild(el('strong', { text: 'Panel de ejemplo. ' }));
    n.appendChild(document.createTextNode('Los números son inventados para que veas cómo funciona.'));
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
