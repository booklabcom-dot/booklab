/**
 * ============================================================
 *  BOOK LAB — Backend de reservas (Google Apps Script)
 * ============================================================
 *  Qué hace:
 *   - GET  ?action=slots&date=AAAA-MM-DD&service=ID&barber=ID|any
 *          → {"slots": ["10:00", "10:15", …]}
 *   - POST (cuerpo JSON en text/plain) → crea la cita en el Google
 *          Calendar del barbero, invita al cliente y le manda un correo.
 *          → {"ok": true, "barber": "Marcos", "when": "…"} o {"error": "…"}
 *   - sendReminders(): ejecútala con un activador cada 15 minutos.
 *          Envía el recordatorio de 24 h y el de 3 h (una sola vez cada uno).
 *
 *  Antes de desplegar:
 *   1. Sustituye los PEGAR_ID_CALENDARIO_… por los IDs reales.
 *   2. Configuración del proyecto → Zona horaria: (GMT+01:00) Madrid.
 *   3. Servicios (+) → "Google Calendar API" (v3, identificador "Calendar") → Añadir.
 *   4. Ejecuta probarConfiguracion() una vez para dar permisos.
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
var CANCELACION_HORAS = 2;

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
  console.log('Correos que aún puedes enviar hoy: ' + MailApp.getRemainingDailyQuota());
  console.log('Prueba terminada.');
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
      return json_({ slots: horasLibres_(p.date, servicio, barbero) });
    }
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
    try { d = JSON.parse(e.postData.contents); } catch (x) { throw aviso_('No hemos entendido la reserva. Recarga la página e inténtalo de nuevo.'); }

    // Campo trampa: solo lo rellenan los bots
    if (d.web) throw aviso_('No se ha podido completar la reserva.');

    // Validación de datos
    var servicio = servicio_(d.service);
    var barberoPedido = d.barber || 'any';
    if (barberoPedido !== 'any') barbero_(barberoPedido);
    validarFecha_(d.date);
    if (!/^\d{2}:\d{2}$/.test(d.time || '')) throw aviso_('La hora elegida no es válida.');
    var nombre = limpiar_(d.name, 60), apellidos = limpiar_(d.surname, 80);
    var email = limpiar_(d.email, 120).toLowerCase(), telefono = limpiar_(d.phone, 20);
    if (!nombre) throw aviso_('Escribe tu nombre.');
    if (!apellidos) throw aviso_('Escribe tus apellidos.');
    if (!EMAIL_RE.test(email)) throw aviso_('Revisa el correo: debe tener la forma nombre@ejemplo.com.');
    if (telefono.replace(/\D/g, '').length < 9) throw aviso_('Revisa el teléfono: debe tener al menos 9 cifras.');
    if (d.consent !== true) throw aviso_('Para reservar tienes que aceptar la política de cancelación.');

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

    Calendar.Events.insert({
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
      // Etiquetas para los recordatorios
      extendedProperties: {
        private: {
          booklab: '1', email: email, nombre: nombre, servicio: d.service, barbero: asignado,
          r24: minutosHasta > 24 * 60 ? 'pendiente' : 'no',
          r3: minutosHasta > 3 * 60 ? 'pendiente' : 'no',
          resena: 'pendiente'
        }
      }
    }, calendario_(asignado), { sendUpdates: 'all' }); // sendUpdates: envía la invitación al cliente

    lock.releaseLock();
    tengoLock = false;

    var cuando = cuandoTexto_(d.date, d.time);
    try {
      enviarCorreo_(email, 'Cita confirmada · ' + NOMBRE_BARBERIA,
        '¡Cita confirmada!',
        'Hola ' + nombre + ', te esperamos.',
        servicio, b.nombre, cuando);
    } catch (mailErr) {
      console.error('No se pudo enviar la confirmación: ' + mailErr);
    }

    return json_({ ok: true, barber: b.nombre, barberId: asignado, when: cuando });
  } catch (err) {
    return error_(err);
  } finally {
    if (tengoLock) lock.releaseLock();
  }
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

      // Cita ya empezada: pedir reseña 1 h después de acabar (una sola vez)
      if (minutos <= 0) {
        var fin = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : inicio;
        var desdeFin = (ahora.getTime() - fin.getTime()) / 60000;
        if (tags.resena === 'pendiente' && desdeFin >= MINUTOS_PARA_RESENA) {
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
      var cambio = null;

      if (minutos <= 3 * 60 && tags.r3 === 'pendiente') {
        enviarCorreo_(email, 'Hoy a las ' + hora + ' · ' + NOMBRE_BARBERIA,
          'Tu cita es en unas horas',
          'Hola ' + nombre + ', te recordamos que hoy tienes cita.',
          servicio, BARBEROS[id].nombre, cuando);
        cambio = { r3: 'enviado' };
        if (tags.r24 === 'pendiente') cambio.r24 = 'no';
      } else if (minutos <= 24 * 60 && tags.r24 === 'pendiente') {
        enviarCorreo_(email, 'Recordatorio: mañana tienes cita · ' + NOMBRE_BARBERIA,
          'Mañana te esperamos',
          'Hola ' + nombre + ', te recordamos tu cita.',
          servicio, BARBEROS[id].nombre, cuando);
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

function horasLibres_(fecha, servicio, barbero) {
  var ventanas = (HORARIO[diaSemana_(fecha)] || []).map(function (v) { return [aMin_(v[0]), aMin_(v[1])]; });
  if (!ventanas.length) return [];

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var minimo = -1;
  if (fecha === hoy) minimo = aMin_(Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm')) + ANTELACION_MINUTOS;

  var minHueco = Math.min.apply(null, Object.keys(SERVICIOS).map(function (k) { return SERVICIOS[k].duracion; }));
  var ids = barbero === 'any' ? Object.keys(BARBEROS) : [barbero];
  var libres = {};
  ids.forEach(function (id) {
    inicioslibres_(ventanas, ocupado_(id, fecha), servicio.duracion, INTERVALO_MINUTOS, minimo, EVITAR_HUECOS_SUELTOS, minHueco)
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
function ocupado_(id, fecha) {
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
  return (lista.items || []).filter(function (ev) { return ev.status !== 'cancelled'; }).map(function (ev) {
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

function enviarCorreo_(para, asunto, titulo, saludo, servicio, barbero, cuando) {
  var filas = [['Servicio', servicio.nombre], ['Barbero', barbero], ['Cuándo', cuando], ['Dónde', DIRECCION]];
  if (servicio.precio !== '') filas.push(['Precio', servicio.precio + ' €']);
  var politica = 'Si no puedes venir, avísanos con al menos ' + CANCELACION_HORAS + ' horas de antelación' +
    (TELEFONO_BARBERIA ? ' llamando al ' + TELEFONO_BARBERIA : '') + '. Si no acudes sin avisar, se cobrará el servicio íntegro en tu próxima visita.';

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
    '<p style="margin:20px 0 0;color:#52525b;font-size:14px;line-height:1.5">' + esc_(politica) + '</p>' +
    '</div></div>' +
    '<p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px">Reserva gestionada con Book Lab</p></div>';

  var texto = titulo + '\n\n' + saludo + '\n\n' +
    filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') + '\n\n' + politica;

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
