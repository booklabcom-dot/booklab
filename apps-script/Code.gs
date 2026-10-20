/**
 * ============================================================
 *  BOOK LAB — Motor de reservas (Google Apps Script)
 * ============================================================
 *  Qué hace:
 *   - GET  ?action=slots&date=AAAA-MM-DD&service=ID&barber=ID|any
 *          → {"slots": ["10:00", "10:30", …]}
 *   - GET  ?action=cita&b=BARBERO&e=EVENTO&t=FIRMA → datos de una cita (para cita.html)
 *   - POST (cuerpo JSON en text/plain):
 *          · reservar (por defecto) → crea la cita en el calendario del barbero
 *          · action "cancelar"      → borra la cita del calendario (hueco libre)
 *          · action "cambiar"       → mueve la cita a otro día u hora
 *          · action "panel"         → números para el panel del jefe (pide la clave)
 *          · action "novino"        → marca o desmarca "No vino" (pide la clave)
 *          · action "mostrador"     → el barbero apunta a un cliente que llega sin cita (apuntar.html, enlace firmado)
 *   - sendReminders(): con un activador cada 15 minutos. Recordatorios de 24 h
 *          y 3 h, y correo de reseña 1 h después del corte.
 *
 *  Antes de desplegar:
 *   1. Sustituye los PEGAR_ID_CALENDARIO_… por los IDs reales (en el editor, no en GitHub).
 *   2. Pon URL_WEB con la dirección de la web (para el enlace "Gestionar mi cita").
 *   3. Configuración del proyecto → Zona horaria: (GMT+01:00) Madrid.
 *   4. Servicios (+) → "Google Calendar API" (v3, identificador "Calendar") → Añadir.
 *   5. Ejecuta probarConfiguracion() una vez para dar permisos.
 *   6. Ejecuta configurarPanel() para crear la clave del panel del jefe.
 *
 *  Usa la API de Google Calendar (servicio avanzado) en vez de CalendarApp:
 *  en cuentas de Gmail nuevas CalendarApp a veces falla con
 *  "Google Calendar no está habilitado para el usuario".
 *
 *  Todo lo de abajo (servicios, barberos, horario) debe coincidir con
 *  config.js de la web. Los "id" tienen que ser exactamente iguales.
 * ============================================================
 */

// ---------- Datos del negocio ----------
var NOMBRE_BARBERIA = 'Nombre de tu barbería';
var DIRECCION = 'Calle Ejemplo 1, Madrid';
var TELEFONO_BARBERIA = '600 000 000';
var ZONA_HORARIA = 'Europe/Madrid';
// Dirección pública de la web, con / al final (para el enlace "Gestionar mi cita" de los correos).
// Por ejemplo 'https://tubarberia.com/'. Vacío = los correos no llevan el enlace.
var URL_WEB = 'https://getbooklab.com/';
// Enlace a las reseñas de Google de la barbería (para el correo de después del corte).
// Vacío = busca el nombre + dirección en Google Maps.
var ENLACE_RESENAS = '';
var MINUTOS_PARA_RESENA = 60; // cuánto después de acabar la cita se pide la reseña

// ---------- Servicios (duración en minutos, precio en euros) ----------
var SERVICIOS = {
  'corte-clasico': { nombre: 'Corte clásico', duracion: 30, precio: 16 },
  'corte-barba':   { nombre: 'Corte + barba', duracion: 30, precio: 20 },
  'degradado':     { nombre: 'Degradado',     duracion: 30, precio: 17 },
  'barba':         { nombre: 'Arreglo de barba', duracion: 30, precio: 12 }
};

// ---------- Barberos y sus calendarios ----------
// El orden importa: con "Cualquiera" se asigna el primero que esté libre.
var BARBEROS = {
  'marcos': { nombre: 'Marcos', calendario: 'PEGAR_ID_CALENDARIO_MARCOS' },
  'lucia':  { nombre: 'Lucía',  calendario: 'PEGAR_ID_CALENDARIO_LUCIA' },
  'diego':  { nombre: 'Diego',  calendario: 'PEGAR_ID_CALENDARIO_DIEGO' }
};

// ---------- Horario (1 = lunes … 7 = domingo; [] = cerrado) ----------
var HORARIO = {
  1: [],
  2: [['09:00', '22:00']],
  3: [['09:00', '22:00']],
  4: [['09:00', '22:00']],
  5: [['09:00', '22:00']],
  6: [['09:00', '14:00']],
  7: []
};

// ---------- Reglas ----------
var INTERVALO_MINUTOS = 30;
var ANTELACION_MINUTOS = 60;
var DIAS_MAXIMOS = 60;
var EVITAR_HUECOS_SUELTOS = true;
var CANCELACION_HORAS = 2;   // hasta cuántas horas antes se puede cancelar o cambiar online
var MAX_CAMBIOS = 2;         // cuántas veces se puede cambiar una misma cita
// Lo que ve un cliente bloqueado (desde el panel) si intenta reservar o cambiar su cita
var MENSAJE_BLOQUEO = 'Tu reserva online está bloqueada porque faltaste a una cita sin avisar. Si quieres regularizarlo y pagar esa cita, ponte en contacto con la barbería en el ' + TELEFONO_BARBERIA + ' y te desbloqueamos.';

// ============================================================
//  A partir de aquí no hace falta tocar nada.
// ============================================================

var DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- Prueba (va la primera para que salga elegida en el desplegable del editor) ----------

/** Ejecútala desde el editor: pide permisos y comprueba los calendarios. */
function probarConfiguracion() {
  console.log('Comprobando la configuración de Book Lab…');
  var zona = Session.getScriptTimeZone();
  console.log((zona === ZONA_HORARIA ? '✔' : '✘') + ' Zona horaria del proyecto: ' + zona + (zona === ZONA_HORARIA ? '' : ' (cámbiala a Madrid en ⚙ Configuración del proyecto)'));
  if (typeof Calendar === 'undefined') {
    console.log('✘ Falta añadir el servicio: Servicios (+) → Google Calendar API → Añadir.');
  } else {
    Object.keys(BARBEROS).forEach(function (id) {
      try { console.log('✔ ' + BARBEROS[id].nombre + ': ' + Calendar.Calendars.get(calendario_(id)).summary); }
      catch (e) { console.log('✘ ' + BARBEROS[id].nombre + ': ' + (e.paraCliente ? e.message : 'no encontramos su calendario. Revisa el ID. (' + e.message + ')')); }
    });
  }
  console.log((URL_WEB ? '✔ Web: ' + URL_WEB : '✘ Falta URL_WEB: los correos no llevarán el enlace "Gestionar mi cita".'));
  console.log((PropertiesService.getScriptProperties().getProperty('CLAVE_PANEL') ? '✔' : '✘') + ' Clave del panel ' + (PropertiesService.getScriptProperties().getProperty('CLAVE_PANEL') ? 'creada' : 'sin crear: ejecuta configurarPanel()'));
  console.log('Correos que aún puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  console.log('Prueba terminada.');
}

/**
 * Crea (o cambia) la clave del panel del jefe y escribe en el registro el enlace para entrar.
 * Si la vuelves a ejecutar, la clave anterior deja de funcionar.
 */
function configurarPanel() {
  var clave = Utilities.base64EncodeWebSafe(Utilities.getUuid() + Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  PropertiesService.getScriptProperties().setProperty('CLAVE_PANEL', clave);
  console.log('✔ Clave del panel creada: ' + clave);
  console.log(URL_WEB
    ? 'Enlace del panel (guárdalo y no lo compartas): ' + URL_WEB + 'panel.html#clave=' + clave
    : 'Entra en TU-WEB/panel.html y escribe la clave.');
}

// ---------- Entradas web ----------

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'slots') {
      validarFecha_(p.date);
      var servicio = servicio_(p.service);
      var barbero = p.barber || 'any';
      if (barbero !== 'any') barbero_(barbero);
      // Al cambiar una cita, su propio hueco cuenta como libre
      var excluir = '';
      if (p.e && p.t && barbero !== 'any') { citaSegura_(barbero, p.e, p.t); excluir = p.e; }
      return json_({ slots: horasLibres_(p.date, servicio, barbero, excluir) });
    }
    if (p.action === 'cita') {
      var ev = citaSegura_(p.b, p.e, p.t);
      return json_(datosCita_(p.b, ev));
    }
    if (p.action === 'mostrador') return json_(mostradorInfo_(p));
    return json_({ ok: true, mensaje: 'Book Lab funcionando. Usa ?action=slots para consultar horas.' });
  } catch (err) {
    return error_(err);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var tengoLock = false;
  try {
    var d;
    try { d = JSON.parse(e.postData.contents); } catch (x) { throw aviso_('No hemos entendido la petición. Recarga la página e inténtalo de nuevo.'); }

    if (d.action === 'cancelar') return json_(cancelar_(d));
    if (d.action === 'cambiar') return json_(cambiar_(d));
    if (d.action === 'panel') return json_(panel_(d));
    if (d.action === 'novino') return json_(noVino_(d));
    if (d.action === 'pagado') return json_(pagado_(d));
    if (d.action === 'bloquear') return json_(bloquear_(d));
    if (d.action === 'desbloquear') return json_(desbloquear_(d));
    if (d.action === 'mostrador') return json_(mostrador_(d, lock));
    if (d.action === 'mostradorDeshacer') return json_(mostradorDeshacer_(d));

    // ----- Reservar -----
    // Campo trampa: solo lo rellenan los bots
    if (d.web) throw aviso_('No se ha podido completar la reserva.');

    var servicio = servicio_(d.service);
    var barberoPedido = d.barber || 'any';
    if (barberoPedido !== 'any') barbero_(barberoPedido);
    validarFecha_(d.date);
    if (!/^\d{2}:\d{2}$/.test(d.time || '')) throw aviso_('La hora elegida no es válida.');
    if (!(HORARIO[diaSemana_(d.date)] || []).length) throw aviso_('Ese día estamos cerrados. Elige otro día, por favor.');
    var nombre = limpiar_(d.name, 60), apellidos = limpiar_(d.surname, 80);
    var email = limpiar_(d.email, 120).toLowerCase(), telefono = limpiar_(d.phone, 20);
    if (!nombre) throw aviso_('Escribe tu nombre.');
    if (!apellidos) throw aviso_('Escribe tus apellidos.');
    if (!EMAIL_RE.test(email)) throw aviso_('Revisa el correo: debe tener la forma nombre@ejemplo.com.');
    if (telefono.replace(/\D/g, '').length < 9) throw aviso_('Revisa el teléfono: debe tener al menos 9 cifras.');
    if (d.consent !== true) throw aviso_('Para reservar tienes que aceptar la política de cancelación.');
    if (estaBloqueado_(email, telefono)) throw aviso_(MENSAJE_BLOQUEO, 'BLOQUEADO');

    // Bloqueo para que dos personas no reserven la misma hora a la vez
    tengoLock = lock.tryLock(25000);
    if (!tengoLock) throw aviso_('Hay mucha gente reservando ahora mismo. Espera unos segundos e inténtalo de nuevo.');

    // Volver a comprobar que el hueco sigue libre (y asignar barbero si es "Cualquiera")
    var candidatos = barberoPedido === 'any' ? Object.keys(BARBEROS) : [barberoPedido];
    var asignado = null;
    for (var i = 0; i < candidatos.length && !asignado; i++) {
      if (horasLibres_(d.date, servicio, candidatos[i]).indexOf(d.time) !== -1) asignado = candidatos[i];
    }
    if (!asignado) throw aviso_('Vaya, alguien acaba de reservar esa hora. Elige otra, por favor.', 'SLOT_TAKEN');

    var b = BARBEROS[asignado];
    var inicio = fechaHora_(d.date, d.time);
    var fin = new Date(inicio.getTime() + servicio.duracion * 60000);
    var minutosHasta = (inicio.getTime() - Date.now()) / 60000;

    var creado = Calendar.Events.insert({
      summary: servicio.nombre + ' · ' + nombre + ' ' + apellidos,
      start: { dateTime: inicio.toISOString(), timeZone: ZONA_HORARIA },
      end: { dateTime: fin.toISOString(), timeZone: ZONA_HORARIA },
      description:
        'Cliente: ' + nombre + ' ' + apellidos + '\n' +
        'Teléfono: ' + telefono + '\n' +
        'Correo: ' + email + '\n' +
        'Servicio: ' + servicio.nombre + ' (' + servicio.duracion + ' min, ' + servicio.precio + ' €)\n' +
        'Barbero: ' + b.nombre + '\n\n' +
        'Ha aceptado la política de cancelación (aviso mínimo de ' + CANCELACION_HORAS + ' h; si no acude sin avisar, se cobra el servicio en la próxima visita).\n' +
        'Reserva hecha desde la web (Book Lab).',
      location: DIRECCION,
      attendees: [{ email: email, displayName: nombre + ' ' + apellidos }],
      // Etiquetas para recordatorios, gestión de la cita y panel
      extendedProperties: {
        private: {
          booklab: '1', email: email, nombre: nombre, apellidos: apellidos, telefono: telefono,
          servicio: d.service, precio: String(servicio.precio), barbero: asignado, cambios: '0',
          r24: minutosHasta > 24 * 60 ? 'pendiente' : 'no',
          r3: minutosHasta > 3 * 60 ? 'pendiente' : 'no',
          resena: 'pendiente'
        }
      }
    }, calendario_(asignado), { sendUpdates: 'all' }); // sendUpdates: envía la invitación al cliente

    lock.releaseLock();
    tengoLock = false;

    var cuando = cuandoTexto_(d.date, d.time);
    var gestionar = enlaceCita_(asignado, creado.id);
    try {
      enviarCorreo_(email, 'Cita confirmada · ' + NOMBRE_BARBERIA,
        '¡Cita confirmada!',
        'Hola ' + nombre + ', te esperamos.',
        servicio, b.nombre, cuando, { gestionar: gestionar });
    } catch (mailErr) {
      console.error('No se pudo enviar la confirmación: ' + mailErr);
    }

    return json_({ ok: true, barber: b.nombre, barberId: asignado, when: cuando, gestionar: gestionar });
  } catch (err) {
    return error_(err);
  } finally {
    if (tengoLock) lock.releaseLock();
  }
}

// ---------- Gestionar mi cita (cancelar / cambiar) ----------

/** Firma de la cita: sin ella nadie puede tocar la cita de otro cambiando la dirección. */
function firma_(barbero, eventoId) {
  var props = PropertiesService.getScriptProperties();
  var secreto = props.getProperty('SECRETO');
  if (!secreto) { secreto = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SECRETO', secreto); }
  var bytes = Utilities.computeHmacSha256Signature(barbero + '|' + eventoId, secreto);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 32);
}

function enlaceCita_(barbero, eventoId) {
  if (!URL_WEB || !eventoId) return '';
  var base = URL_WEB.charAt(URL_WEB.length - 1) === '/' ? URL_WEB : URL_WEB + '/';
  return base + 'cita.html?b=' + encodeURIComponent(barbero) + '&e=' + encodeURIComponent(eventoId) + '&t=' + firma_(barbero, eventoId);
}

/** Comprueba la firma y devuelve el evento de la cita. */
function citaSegura_(barbero, eventoId, firma) {
  if (!BARBEROS[barbero] || !eventoId || !firma || firma !== firma_(barbero, eventoId)) {
    throw aviso_('Este enlace no es válido. Abre el último correo de tu cita o llámanos.', 'ENLACE');
  }
  var ev;
  try { ev = Calendar.Events.get(calendario_(barbero), eventoId); } catch (x) { ev = null; }
  if (!ev || ev.status === 'cancelled') throw aviso_('Esta cita ya no existe: puede que esté cancelada.', 'NO_EXISTE');
  return ev;
}

function datosCita_(barbero, ev) {
  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  var inicio = new Date(ev.start.dateTime);
  var fecha = Utilities.formatDate(inicio, ZONA_HORARIA, 'yyyy-MM-dd');
  var hora = Utilities.formatDate(inicio, ZONA_HORARIA, 'HH:mm');
  var servicio = SERVICIOS[tags.servicio] || { nombre: (ev.summary || '').split(' · ')[0], duracion: 30, precio: '' };
  var minutos = (inicio.getTime() - Date.now()) / 60000;
  var cambios = Number(tags.cambios || 0);
  var enPlazo = minutos >= CANCELACION_HORAS * 60;
  return {
    ok: true,
    barbero: BARBEROS[barbero].nombre, barberId: barbero,
    servicio: servicio.nombre, servicioId: tags.servicio || '', precio: servicio.precio, duracion: servicio.duracion,
    fecha: fecha, hora: hora, cuando: cuandoTexto_(fecha, hora), nombre: tags.nombre || '',
    pasada: minutos <= 0,
    puedeCancelar: enPlazo,
    puedeCambiar: enPlazo && cambios < MAX_CAMBIOS,
    cambios: cambios, maxCambios: MAX_CAMBIOS, limiteHoras: CANCELACION_HORAS,
    telefono: TELEFONO_BARBERIA
  };
}

function cancelar_(d) {
  var ev = citaSegura_(d.b, d.e, d.t);
  var info = datosCita_(d.b, ev);
  if (info.pasada) throw aviso_('Esta cita ya ha pasado.');
  if (!info.puedeCancelar) throw aviso_('Faltan menos de ' + CANCELACION_HORAS + ' horas para tu cita. Para cancelarla, llámanos al ' + TELEFONO_BARBERIA + '.', 'FUERA_DE_PLAZO');

  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  // Borrar la cita del calendario del barbero: el hueco queda libre al momento
  Calendar.Events.remove(calendario_(d.b), d.e, { sendUpdates: 'all' });
  sumarEstadistica_(info.fecha, d.b, 'cancelaciones');

  try {
    enviarCorreo_(tags.email, 'Cita cancelada · ' + NOMBRE_BARBERIA,
      'Cita cancelada',
      'Hola ' + (tags.nombre || '') + ', hemos cancelado tu cita. ¡Esperamos verte pronto!',
      SERVICIOS[tags.servicio] || { nombre: info.servicio, precio: '' }, info.barbero, info.cuando,
      { sinPolitica: true, boton: URL_WEB ? { texto: 'Reservar otra cita', url: URL_WEB.replace(/\/?$/, '/') + 'reservar.html' } : null });
  } catch (mailErr) {
    console.error('No se pudo enviar el aviso de cancelación: ' + mailErr);
  }
  return { ok: true };
}

function cambiar_(d) {
  var ev = citaSegura_(d.b, d.e, d.t);
  var info = datosCita_(d.b, ev);
  if (info.pasada) throw aviso_('Esta cita ya ha pasado.');
  if (!info.puedeCancelar) throw aviso_('Faltan menos de ' + CANCELACION_HORAS + ' horas para tu cita. Para cambiarla, llámanos al ' + TELEFONO_BARBERIA + '.', 'FUERA_DE_PLAZO');
  if (info.cambios >= MAX_CAMBIOS) throw aviso_('Esta cita ya se ha cambiado ' + MAX_CAMBIOS + ' veces. Para otro cambio, llámanos al ' + TELEFONO_BARBERIA + '.', 'MAX_CAMBIOS');
  validarFecha_(d.date);
  if (!/^\d{2}:\d{2}$/.test(d.time || '')) throw aviso_('La hora elegida no es válida.');

  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  if (estaBloqueado_(tags.email, tags.telefono)) throw aviso_(MENSAJE_BLOQUEO, 'BLOQUEADO');
  var servicio = SERVICIOS[tags.servicio] || servicio_(info.servicioId);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw aviso_('Hay mucha gente reservando ahora mismo. Espera unos segundos e inténtalo de nuevo.');
  try {
    if (horasLibres_(d.date, servicio, d.b, d.e).indexOf(d.time) === -1) {
      throw aviso_('Vaya, esa hora ya no está libre. Elige otra, por favor.', 'SLOT_TAKEN');
    }
    var inicio = fechaHora_(d.date, d.time);
    var fin = new Date(inicio.getTime() + servicio.duracion * 60000);
    var minutosHasta = (inicio.getTime() - Date.now()) / 60000;
    tags.cambios = String(info.cambios + 1);
    tags.r24 = minutosHasta > 24 * 60 ? 'pendiente' : 'no';
    tags.r3 = minutosHasta > 3 * 60 ? 'pendiente' : 'no';
    tags.resena = 'pendiente';
    // Mover la cita en el calendario del barbero: el hueco antiguo queda libre
    Calendar.Events.patch({
      start: { dateTime: inicio.toISOString(), timeZone: ZONA_HORARIA },
      end: { dateTime: fin.toISOString(), timeZone: ZONA_HORARIA },
      extendedProperties: { private: tags }
    }, calendario_(d.b), d.e, { sendUpdates: 'all' });
  } finally {
    lock.releaseLock();
  }
  sumarEstadistica_(d.date, d.b, 'cambios');

  var cuando = cuandoTexto_(d.date, d.time);
  try {
    enviarCorreo_(tags.email, 'Cita cambiada · ' + NOMBRE_BARBERIA,
      'Tu cita ha cambiado',
      'Hola ' + (tags.nombre || '') + ', esta es tu nueva cita.',
      servicio, info.barbero, cuando, { gestionar: enlaceCita_(d.b, d.e) });
  } catch (mailErr) {
    console.error('No se pudo enviar el aviso de cambio: ' + mailErr);
  }
  return { ok: true, when: cuando, fecha: d.date, hora: d.time, cambios: info.cambios + 1, maxCambios: MAX_CAMBIOS };
}

/** Cuenta cancelaciones y cambios por mes y barbero (las citas canceladas ya no están en el calendario). */
function sumarEstadistica_(fecha, barbero, tipo) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var stats = JSON.parse(props.getProperty('ESTADISTICAS') || '{}');
    var mes = fecha.slice(0, 7);
    stats[mes] = stats[mes] || {};
    stats[mes][barbero] = stats[mes][barbero] || {};
    stats[mes][barbero][tipo] = (stats[mes][barbero][tipo] || 0) + 1;
    props.setProperty('ESTADISTICAS', JSON.stringify(stats));
  } finally {
    lock.releaseLock();
  }
}

// ---------- Panel del jefe ----------

function comprobarClave_(clave) {
  var cache = CacheService.getScriptCache();
  var fallos = Number(cache.get('panel_fallos') || 0);
  if (fallos >= 10) throw aviso_('Demasiados intentos con una clave incorrecta. Espera 15 minutos.', 'BLOQUEADO');
  var buena = PropertiesService.getScriptProperties().getProperty('CLAVE_PANEL');
  if (!buena) throw aviso_('El panel aún no está activado: ejecuta configurarPanel() en Apps Script.', 'SIN_CLAVE');
  if (!clave || String(clave) !== buena) {
    cache.put('panel_fallos', String(fallos + 1), 900);
    throw aviso_('Clave incorrecta.', 'CLAVE');
  }
}

/** Devuelve las citas de los últimos meses y la configuración, para que el panel calcule los números. */
function panel_(d) {
  comprobarClave_(d.clave);
  var meses = Math.min(Math.max(Number(d.meses) || 6, 1), 24);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var p = hoy.split('-');
  var primerMes = new Date(Number(p[0]), Number(p[1]) - 1 - (meses - 1), 1);
  var desde = fechaHora_(Utilities.formatDate(primerMes, ZONA_HORARIA, 'yyyy-MM') + '-01', '00:00');
  var hasta = fechaHora_(sumarDias_(hoy, DIAS_MAXIMOS + 1), '00:00');

  var citas = [];
  Object.keys(BARBEROS).forEach(function (id) {
    var calId = calendario_(id), token = null;
    do {
      var lista = Calendar.Events.list(calId, {
        timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true,
        privateExtendedProperty: 'booklab=1', maxResults: 2500, pageToken: token || undefined
      });
      (lista.items || []).forEach(function (ev) {
        if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime) return;
        var t = (ev.extendedProperties && ev.extendedProperties.private) || {};
        var s = SERVICIOS[t.servicio] || {};
        var ini = new Date(ev.start.dateTime), fin = new Date(ev.end.dateTime);
        citas.push({
          id: ev.id, b: id, s: t.servicio || '', sn: s.nombre || (ev.summary || '').split(' · ')[0],
          precio: t.precio ? Number(t.precio) : (s.precio || 0),
          dur: Math.round((fin - ini) / 60000),
          f: Utilities.formatDate(ini, ZONA_HORARIA, 'yyyy-MM-dd'), h: Utilities.formatDate(ini, ZONA_HORARIA, 'HH:mm'),
          cliente: ((t.nombre || '') + ' ' + (t.apellidos || '')).trim(), email: t.email || '', tel: t.telefono || '',
          novino: t.novino === '1', pagado: t.novinoPagado === '1', cambios: Number(t.cambios || 0),
          origen: t.origen === 'mostrador' ? 'mostrador' : 'web'
        });
      });
      token = lista.nextPageToken;
    } while (token);
  });

  return {
    ok: true, negocio: NOMBRE_BARBERIA, hoy: hoy, ahora: Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm'),
    barberos: Object.keys(BARBEROS).map(function (id) { return { id: id, nombre: BARBEROS[id].nombre }; }),
    servicios: SERVICIOS, horario: HORARIO,
    estadisticas: JSON.parse(PropertiesService.getScriptProperties().getProperty('ESTADISTICAS') || '{}'),
    bloqueados: bloqueados_(),
    citas: citas
  };
}

/** Marca o desmarca "No vino" en una cita (desde el panel). */
function noVino_(d) {
  comprobarClave_(d.clave);
  barbero_(d.b);
  var calId = calendario_(d.b);
  var ev = Calendar.Events.get(calId, d.e);
  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  if (tags.booklab !== '1') throw aviso_('Esa cita no se hizo desde la web.');
  tags.novino = d.valor ? '1' : '';
  if (!d.valor) tags.novinoPagado = '';
  if (d.valor) {
    Calendar.Events.patch({ extendedProperties: { private: tags }, colorId: '11' }, calId, d.e, { sendUpdates: 'none' }); // rojo
  } else {
    try { Calendar.Events.patch({ extendedProperties: { private: tags }, colorId: null }, calId, d.e, { sendUpdates: 'none' }); } // color normal
    catch (x) { Calendar.Events.patch({ extendedProperties: { private: tags } }, calId, d.e, { sendUpdates: 'none' }); }
  }
  return { ok: true, novino: !!d.valor };
}

/** Marca o desmarca que el cliente ya ha pagado su "No vino" (desde el panel). */
function pagado_(d) {
  comprobarClave_(d.clave);
  barbero_(d.b);
  var calId = calendario_(d.b);
  var ev = Calendar.Events.get(calId, d.e);
  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  if (tags.novino !== '1') throw aviso_('Primero marca la cita como "No vino".');
  tags.novinoPagado = d.valor ? '1' : '';
  Calendar.Events.patch({ extendedProperties: { private: tags } }, calId, d.e, { sendUpdates: 'none' });
  return { ok: true, pagado: !!d.valor };
}

// ---------- Clientes bloqueados (no pueden reservar online) ----------

function bloqueados_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('BLOQUEADOS') || '[]');
}

function guardarBloqueados_(lista) {
  PropertiesService.getScriptProperties().setProperty('BLOQUEADOS', JSON.stringify(lista));
}

/** Teléfono comparable: solo las 9 últimas cifras (quita +34, espacios, guiones…). */
function telNormal_(t) { var d = String(t || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; }

function estaBloqueado_(email, telefono) {
  var e = String(email || '').trim().toLowerCase(), t = telNormal_(telefono);
  return bloqueados_().some(function (x) { return (e && x.email && x.email === e) || (t && x.tel && x.tel === t); });
}

function bloquear_(d) {
  comprobarClave_(d.clave);
  var email = limpiar_(d.email, 120).toLowerCase(), tel = telNormal_(d.tel);
  if (!email && !tel) throw aviso_('Escribe el correo o el teléfono del cliente.');
  if (email && !EMAIL_RE.test(email)) throw aviso_('Ese correo no parece válido.');
  var lista = bloqueados_();
  if (lista.some(function (x) { return (email && x.email === email) || (tel && x.tel === tel); })) throw aviso_('Ese cliente ya está bloqueado.');
  lista.push({
    id: Utilities.getUuid().slice(0, 8), email: email, tel: tel,
    nombre: limpiar_(d.nombre, 80), motivo: limpiar_(d.motivo, 120),
    fecha: Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd')
  });
  guardarBloqueados_(lista);
  return { ok: true, bloqueados: lista };
}

function desbloquear_(d) {
  comprobarClave_(d.clave);
  var lista = bloqueados_().filter(function (x) { return x.id !== d.id; });
  guardarBloqueados_(lista);
  return { ok: true, bloqueados: lista };
}

// ---------- Mostrador: el barbero apunta a los clientes que llegan sin cita (apuntar.html) ----------
// Cada barbero tiene su enlace, sin contraseña y sin publicar en la web: TU-WEB/panel-agenda-marcos.
// Lo escribe enlacesMostrador().

function comprobarMostrador_(barbero) {
  if (!BARBEROS[barbero]) throw aviso_('Este enlace no es válido. Pide el tuyo al dueño de la barbería.', 'ENLACE');
}

/** GET: comprueba el enlace y, si se pide, devuelve las horas libres de un día (sin antelación mínima). */
function mostradorInfo_(p) {
  comprobarMostrador_(p.b);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var r = { ok: true, barbero: BARBEROS[p.b].nombre, hoy: hoy, ahora: Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm') };
  if (p.date && p.service) {
    validarFecha_(p.date);
    r.slots = horasLibres_(p.date, servicio_(p.service), p.b, '', true);
  }
  return r;
}

/** POST: apunta una cita de mostrador. time = 'ahora' o HH:MM. Nombre obligatorio; teléfono y correo opcionales
 *  (con correo, el cliente recibe la confirmación, los recordatorios y el enlace para gestionar su cita). */
function mostrador_(d, lock) {
  comprobarMostrador_(d.b);
  var servicio = servicio_(d.service);
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, ZONA_HORARIA, 'yyyy-MM-dd');
  var fecha, hora;
  if (d.time === 'ahora') {
    var m = aMin_(Utilities.formatDate(ahora, ZONA_HORARIA, 'HH:mm'));
    fecha = hoy; hora = aHHMM_(m - m % 5);                     // redondeado a 5 minutos
  } else {
    validarFecha_(d.date);
    if (!/^\d{2}:\d{2}$/.test(d.time || '')) throw aviso_('Elige una hora.');
    fecha = d.date; hora = d.time;
  }
  var nombre = limpiar_(d.name, 60), telefono = limpiar_(d.phone, 20), email = limpiar_(d.email, 120).toLowerCase();
  if (!nombre) throw aviso_('Escribe el nombre del cliente.');
  if (email && !EMAIL_RE.test(email)) throw aviso_('Revisa el correo (o déjalo vacío).');
  var minutosHasta = (fechaHora_(fecha, hora).getTime() - ahora.getTime()) / 60000;

  var tengo = lock.tryLock(25000);
  if (!tengo) throw aviso_('Hay mucha gente reservando ahora mismo. Inténtalo en unos segundos.');
  try {
    // ¿Choca con otra cita? Se avisa y el barbero decide (forzar)
    var ini = aMin_(hora), fin = ini + servicio.duracion;
    var choque = ocupado_(d.b, fecha).filter(function (o) { return ini < o[1] && fin > o[0]; })[0];
    if (choque && !d.forzar) {
      throw aviso_('Ya tienes otra cita de ' + aHHMM_(choque[0]) + ' a ' + aHHMM_(choque[1]) + '.', 'SOLAPA');
    }
    var inicio = fechaHora_(fecha, hora);
    var creado = Calendar.Events.insert({
      summary: servicio.nombre + ' · ' + nombre,
      start: { dateTime: inicio.toISOString(), timeZone: ZONA_HORARIA },
      end: { dateTime: new Date(inicio.getTime() + servicio.duracion * 60000).toISOString(), timeZone: ZONA_HORARIA },
      description:
        'Cliente: ' + nombre + '\n' +
        (telefono ? 'Teléfono: ' + telefono + '\n' : '') +
        (email ? 'Correo: ' + email + '\n' : '') +
        'Servicio: ' + servicio.nombre + ' (' + servicio.duracion + ' min, ' + servicio.precio + ' €)\n' +
        'Barbero: ' + BARBEROS[d.b].nombre + '\n\n' +
        'Apuntada en el mostrador (Book Lab).',
      location: DIRECCION,
      extendedProperties: {
        private: {
          booklab: '1', origen: 'mostrador', email: email, nombre: nombre, apellidos: '', telefono: telefono,
          servicio: d.service, precio: String(servicio.precio), barbero: d.b, cambios: '0',
          // Con correo: recordatorios y reseña como en la web. Sin correo: nada que enviar.
          r24: email && minutosHasta > 24 * 60 ? 'pendiente' : 'no',
          r3: email && minutosHasta > 3 * 60 ? 'pendiente' : 'no',
          resena: email ? 'pendiente' : 'no'
        }
      }
    }, calendario_(d.b), { sendUpdates: 'none' });
  } finally {
    lock.releaseLock();
  }

  var cuando = cuandoTexto_(fecha, hora);
  if (email && minutosHasta > 0) {
    try {
      enviarCorreo_(email, 'Cita confirmada · ' + NOMBRE_BARBERIA, '¡Cita confirmada!', 'Hola ' + nombre + ', te esperamos.',
        servicio, BARBEROS[d.b].nombre, cuando, { gestionar: enlaceCita_(d.b, creado.id) });
    } catch (mailErr) { console.error('No se pudo enviar la confirmación: ' + mailErr); }
  }
  return { ok: true, id: creado.id, fecha: fecha, hora: hora, cuando: cuando, servicio: servicio.nombre, precio: servicio.precio };
}

/** POST: borra una cita recién apuntada en el mostrador (botón "Deshacer"). Solo citas de mostrador. */
function mostradorDeshacer_(d) {
  comprobarMostrador_(d.b);
  var calId = calendario_(d.b);
  var ev;
  try { ev = Calendar.Events.get(calId, d.e); } catch (x) { ev = null; }
  var tags = (ev && ev.extendedProperties && ev.extendedProperties.private) || {};
  if (!ev || tags.origen !== 'mostrador') throw aviso_('No se puede deshacer esa cita.');
  Calendar.Events.remove(calId, d.e, { sendUpdates: 'none' });
  return { ok: true };
}

/** Ejecútala desde el editor: escribe en el registro el enlace de "Apuntar cliente" de cada barbero. */
function enlacesMostrador() {
  var base = URL_WEB ? (URL_WEB.charAt(URL_WEB.length - 1) === '/' ? URL_WEB : URL_WEB + '/') : 'TU-WEB/';
  Object.keys(BARBEROS).forEach(function (id) {
    console.log(BARBEROS[id].nombre + ': ' + base + 'panel-agenda-' + id);
  });
  console.log('Pásale a cada barbero SOLO su enlace. Que lo abra en su móvil y lo añada a la pantalla de inicio.');
}

// ---------- Recordatorios (activador cada 15 minutos) ----------

function sendReminders() {
  var ahora = new Date();
  var desde = new Date(ahora.getTime() - 12 * 3600 * 1000); // citas de las últimas horas (para la reseña)
  var hasta = new Date(ahora.getTime() + 25 * 3600 * 1000);
  Object.keys(BARBEROS).forEach(function (id) {
    var calId;
    try { calId = calendario_(id); } catch (e) { console.warn(e.message); return; }
    var lista = Calendar.Events.list(calId, {
      timeMin: desde.toISOString(), timeMax: hasta.toISOString(),
      singleEvents: true, privateExtendedProperty: 'booklab=1', maxResults: 250
    });
    (lista.items || []).forEach(function (ev) {
      if (ev.status === 'cancelled' || !ev.start || !ev.start.dateTime) return;
      var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
      var email = tags.email;
      var inicio = new Date(ev.start.dateTime);
      var minutos = (inicio.getTime() - ahora.getTime()) / 60000;
      if (!email) return;

      // Si el cliente ha rechazado la invitación, no le molestamos
      var rechazada = (ev.attendees || []).some(function (a) {
        return (a.email || '').toLowerCase() === email && a.responseStatus === 'declined';
      });
      if (rechazada) return;

      // Cita ya empezada: pedir reseña 1 h después de acabar (una sola vez; no si no vino)
      if (minutos <= 0) {
        var fin = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : inicio;
        var desdeFin = (ahora.getTime() - fin.getTime()) / 60000;
        if (tags.resena === 'pendiente' && tags.novino !== '1' && desdeFin >= MINUTOS_PARA_RESENA) {
          enviarResena_(email, tags.nombre || '', BARBEROS[id].nombre);
          tags.resena = 'enviado';
          Calendar.Events.patch({ extendedProperties: { private: tags } }, calId, ev.id, { sendUpdates: 'none' });
        }
        return;
      }

      var servicio = SERVICIOS[tags.servicio] || { nombre: (ev.summary || '').split(' · ')[0], duracion: 0, precio: '' };
      var fecha = Utilities.formatDate(inicio, ZONA_HORARIA, 'yyyy-MM-dd');
      var hora = Utilities.formatDate(inicio, ZONA_HORARIA, 'HH:mm');
      var cuando = cuandoTexto_(fecha, hora);
      var nombre = tags.nombre || '';
      var gestionar = enlaceCita_(id, ev.id);
      var cambio = null;

      if (minutos <= 3 * 60 && tags.r3 === 'pendiente') {
        enviarCorreo_(email, 'Hoy a las ' + hora + ' · ' + NOMBRE_BARBERIA,
          'Tu cita es en unas horas',
          'Hola ' + nombre + ', te recordamos que hoy tienes cita.',
          servicio, BARBEROS[id].nombre, cuando, { gestionar: gestionar });
        cambio = { r3: 'enviado' };
        if (tags.r24 === 'pendiente') cambio.r24 = 'no';
      } else if (minutos <= 24 * 60 && tags.r24 === 'pendiente') {
        enviarCorreo_(email, 'Recordatorio: mañana tienes cita · ' + NOMBRE_BARBERIA,
          'Mañana te esperamos',
          'Hola ' + nombre + ', te recordamos tu cita.',
          servicio, BARBEROS[id].nombre, cuando, { gestionar: gestionar });
        cambio = { r24: 'enviado' };
      }

      if (cambio) {
        Object.keys(cambio).forEach(function (k) { tags[k] = cambio[k]; });
        Calendar.Events.patch({ extendedProperties: { private: tags } }, calId, ev.id, { sendUpdates: 'none' });
      }
    });
  });
}

/** Correo de después del corte: ¿qué tal? + botón para dejar reseña en Google. */
function enviarResena_(para, nombre, barbero) {
  var enlace = ENLACE_RESENAS || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(NOMBRE_BARBERIA + ' ' + DIRECCION);
  var asunto = (nombre ? nombre + ', ¿' : '¿') + 'qué tal ese corte? ✂️';
  var lineas = [
    'Esperamos que hayas salido de ' + NOMBRE_BARBERIA + ' como querías: fresco, limpio y listo para todo.',
    'Somos una barbería pequeña y cada reseña en Google nos ayuda muchísimo a seguir creciendo. Te lleva 30 segundos y a ' + barbero + ' le alegra el día.'
  ];
  var html =
    '<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0a0a0b;padding:24px 28px;color:#ffffff;font-weight:800;font-size:18px">' + esc_(NOMBRE_BARBERIA) +
    '<div style="height:3px;width:40px;background:#f5c518;margin-top:12px"></div></div>' +
    '<div style="padding:28px">' +
    '<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#0a0a0b">' + esc_((nombre ? nombre + ', ¿' : '¿') + 'qué tal ese corte?') + '</h1>' +
    lineas.map(function (l) { return '<p style="margin:0 0 14px;color:#3f3f46;font-size:16px;line-height:1.5">' + esc_(l) + '</p>'; }).join('') +
    '<p style="margin:24px 0 8px;font-size:28px;letter-spacing:4px;color:#f5c518;text-align:center">★★★★★</p>' +
    '<p style="text-align:center;margin:0 0 8px"><a href="' + esc_(enlace) + '" style="display:inline-block;background:#f5c518;color:#0a0a0b;font-weight:800;font-size:16px;text-decoration:none;padding:16px 28px;border-radius:999px">Dejar mi reseña en Google</a></p>' +
    '<p style="margin:20px 0 0;color:#71717a;font-size:14px;line-height:1.5">¿Algo no fue perfecto? Responde a este correo y cuéntanoslo. Lo leemos todo y queremos que la próxima sea mejor.</p>' +
    '</div></div>' +
    '<p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px">Gracias por confiar en nosotros · ' + esc_(NOMBRE_BARBERIA) + '</p></div>';
  var texto = asunto + '\n\n' + lineas.join('\n\n') + '\n\nDeja tu reseña aquí: ' + enlace +
    '\n\n¿Algo no fue perfecto? Responde a este correo y cuéntanoslo.';
  MailApp.sendEmail({ to: para, subject: asunto, body: texto, htmlBody: html, name: NOMBRE_BARBERIA });
}

// ---------- Utilidades para el dueño ----------

/** Alternativa al menú Activadores: crea el activador de sendReminders cada 15 min. */
function instalarRecordatorios() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyMinutes(15).create();
  Logger.log('✔ Activador de recordatorios creado (cada 15 minutos).');
}

// ---------- Cálculo de horas libres ----------

/**
 * excluirId: al cambiar una cita, su propio evento no cuenta como ocupado.
 * sinAntelacion: el barbero (página de mostrador) puede apuntar para dentro de un rato, sin la antelación mínima de la web.
 */
function horasLibres_(fecha, servicio, barbero, excluirId, sinAntelacion) {
  var ventanas = (HORARIO[diaSemana_(fecha)] || []).map(function (v) { return [aMin_(v[0]), aMin_(v[1])]; });
  if (!ventanas.length) return [];

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var minimo = -1;
  if (fecha === hoy) minimo = aMin_(Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm')) + (sinAntelacion ? 0 : ANTELACION_MINUTOS);

  var minHueco = Math.min.apply(null, Object.keys(SERVICIOS).map(function (k) { return SERVICIOS[k].duracion; }));
  var ids = barbero === 'any' ? Object.keys(BARBEROS) : [barbero];
  var libres = {};
  ids.forEach(function (id) {
    inicioslibres_(ventanas, ocupado_(id, fecha, excluirId), servicio.duracion, INTERVALO_MINUTOS, minimo, EVITAR_HUECOS_SUELTOS, minHueco)
      .forEach(function (t) { libres[t] = true; });
  });
  return Object.keys(libres).map(Number).sort(function (a, b) { return a - b; }).map(aHHMM_);
}

/** Misma regla que en assets/js/booking.js (modo simulación). */
function inicioslibres_(ventanas, ocupado, dur, paso, minimo, evitarHuecos, minHueco) {
  var out = [];
  ventanas.forEach(function (w) {
    var ws = w[0], we = w[1], primero = null;
    for (var t = ws; t + dur <= we; t += paso) {
      if (t < minimo) continue;
      if (primero === null) primero = t;
      var e = t + dur;
      if (ocupado.some(function (o) { return t < o[1] && e > o[0]; })) continue;
      if (evitarHuecos) {
        var prev = ws, next = we;
        ocupado.forEach(function (o) {
          if (o[1] <= t && o[1] > prev) prev = o[1];
          if (o[0] >= e && o[0] < next) next = o[0];
        });
        prev = Math.max(prev, primero);
        var antes = t - prev, despues = next - e;
        if ((antes > 0 && antes < minHueco) || (despues > 0 && despues < minHueco)) continue;
      }
      out.push(t);
    }
  });
  return out;
}

/** Tramos ocupados del barbero ese día, en minutos desde medianoche. Los eventos de día completo bloquean el día. */
function ocupado_(id, fecha, excluirId) {
  var calId = calendario_(id);
  var desde = fechaHora_(fecha, '00:00');
  var hasta = fechaHora_(sumarDias_(fecha, 1), '00:00');
  var lista;
  try {
    lista = Calendar.Events.list(calId, { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true, maxResults: 250 });
  } catch (err) {
    console.error(err);
    throw aviso_('No encontramos el calendario de ' + BARBEROS[id].nombre + '. Avisa a la barbería, por favor.');
  }
  return (lista.items || []).filter(function (ev) { return ev.status !== 'cancelled' && ev.id !== excluirId; }).map(function (ev) {
    // dateTime = evento con hora; date = evento de día completo
    var s = ev.start.dateTime ? new Date(ev.start.dateTime) : fechaHora_(ev.start.date, '00:00');
    var e = ev.end.dateTime ? new Date(ev.end.dateTime) : fechaHora_(ev.end.date, '00:00');
    return [
      s <= desde ? 0 : aMin_(Utilities.formatDate(s, ZONA_HORARIA, 'HH:mm')),
      e >= hasta ? 24 * 60 : aMin_(Utilities.formatDate(e, ZONA_HORARIA, 'HH:mm'))
    ];
  });
}

// ---------- Correo ----------

/**
 * opciones: { gestionar: enlace "Gestionar mi cita", sinPolitica: true, boton: { texto, url } }
 */
function enviarCorreo_(para, asunto, titulo, saludo, servicio, barbero, cuando, opciones) {
  opciones = opciones || {};
  var filas = [['Servicio', servicio.nombre], ['Barbero', barbero], ['Cuándo', cuando], ['Dónde', DIRECCION]];
  if (servicio.precio !== '' && servicio.precio !== undefined) filas.push(['Precio', servicio.precio + ' €']);
  var politica = opciones.sinPolitica ? '' : 'Si no puedes venir, avísanos con al menos ' + CANCELACION_HORAS + ' horas de antelación' +
    (TELEFONO_BARBERIA ? ' o llama al ' + TELEFONO_BARBERIA : '') + '. Si no acudes sin avisar, se cobrará el servicio íntegro en tu próxima visita.';
  var boton = opciones.gestionar ? { texto: 'Gestionar mi cita', url: opciones.gestionar } : opciones.boton;
  var notaBoton = opciones.gestionar ? 'Desde ahí puedes cancelar o cambiar tu cita hasta ' + CANCELACION_HORAS + ' horas antes.' : '';

  var html =
    '<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0a0a0b;padding:24px 28px;color:#ffffff;font-weight:800;font-size:18px">' + esc_(NOMBRE_BARBERIA) +
    '<div style="height:3px;width:40px;background:#f5c518;margin-top:12px"></div></div>' +
    '<div style="padding:28px">' +
    '<h1 style="margin:0 0 8px;font-size:24px;color:#0a0a0b">' + esc_(titulo) + '</h1>' +
    '<p style="margin:0 0 20px;color:#3f3f46;font-size:16px">' + esc_(saludo) + '</p>' +
    '<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">' +
    filas.map(function (f) {
      return '<tr><td style="padding:10px 0;border-top:1px solid #e4e4e7;color:#71717a">' + esc_(f[0]) +
        '</td><td style="padding:10px 0;border-top:1px solid #e4e4e7;text-align:right;font-weight:700;color:#0a0a0b">' + esc_(f[1]) + '</td></tr>';
    }).join('') +
    '</table>' +
    (boton ? '<p style="text-align:center;margin:24px 0 6px"><a href="' + esc_(boton.url) + '" style="display:inline-block;background:#0a0a0b;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 24px;border-radius:999px">' + esc_(boton.texto) + '</a></p>' : '') +
    (notaBoton ? '<p style="margin:0;text-align:center;color:#71717a;font-size:13px">' + esc_(notaBoton) + '</p>' : '') +
    (politica ? '<p style="margin:20px 0 0;color:#52525b;font-size:14px;line-height:1.5">' + esc_(politica) + '</p>' : '') +
    '</div></div>' +
    '<p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px">Reserva gestionada con Book Lab</p></div>';

  var texto = titulo + '\n\n' + saludo + '\n\n' +
    filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') +
    (boton ? '\n\n' + boton.texto + ': ' + boton.url : '') +
    (notaBoton ? '\n' + notaBoton : '') +
    (politica ? '\n\n' + politica : '');

  MailApp.sendEmail({ to: para, subject: asunto, body: texto, htmlBody: html, name: NOMBRE_BARBERIA });
}

// ---------- Ayudantes ----------

function servicio_(id) {
  var s = SERVICIOS[id];
  if (!s) throw aviso_('Ese servicio no existe. Recarga la página y elige otro.');
  return s;
}

function barbero_(id) {
  if (!BARBEROS[id]) throw aviso_('Ese barbero no existe. Recarga la página y elige otro.');
  return BARBEROS[id];
}

function calendario_(id) {
  var b = BARBEROS[id];
  if (!b.calendario || b.calendario.indexOf('PEGAR_') === 0) {
    throw aviso_('Falta configurar el calendario de ' + b.nombre + '. Avisa a la barbería, por favor.');
  }
  if (typeof Calendar === 'undefined') {
    throw aviso_('El sistema de reservas no está bien configurado (falta la API de Google Calendar). Avisa a la barbería, por favor.');
  }
  return b.calendario.trim(); // trim: por si se pegó el ID con espacios
}

function validarFecha_(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) throw aviso_('La fecha no es válida.');
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (fecha < hoy) throw aviso_('Esa fecha ya ha pasado. Elige otro día.');
  if (fecha > sumarDias_(hoy, DIAS_MAXIMOS)) throw aviso_('Solo se puede reservar con ' + DIAS_MAXIMOS + ' días de antelación como máximo.');
}

function fechaHora_(fecha, hora) {
  return Utilities.parseDate(fecha + ' ' + hora, ZONA_HORARIA, 'yyyy-MM-dd HH:mm');
}

function sumarDias_(fecha, n) {
  var d = Utilities.parseDate(fecha + ' 12:00', ZONA_HORARIA, 'yyyy-MM-dd HH:mm');
  return Utilities.formatDate(new Date(d.getTime() + n * 86400000), ZONA_HORARIA, 'yyyy-MM-dd');
}

function diaSemana_(fecha) {
  return Number(Utilities.formatDate(fechaHora_(fecha, '12:00'), ZONA_HORARIA, 'u')); // 1 = lunes … 7 = domingo
}

function cuandoTexto_(fecha, hora) {
  var p = fecha.split('-');
  var dia = DIAS[diaSemana_(fecha)];
  return dia.charAt(0).toUpperCase() + dia.slice(1) + ' ' + Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1] + ' a las ' + hora;
}

function aMin_(hhmm) { var p = hhmm.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function aHHMM_(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function limpiar_(v, max) { return String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function esc_(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function aviso_(mensaje, codigo) {
  var e = new Error(mensaje);
  e.paraCliente = true;
  e.codigo = codigo || '';
  return e;
}

function error_(err) {
  if (err && err.paraCliente) return json_({ error: err.message, code: err.codigo || undefined });
  console.error(err && err.stack ? err.stack : err);
  return json_({ error: 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos minutos o llama a la barbería.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
