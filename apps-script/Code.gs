/**
 * ============================================================
 *  BOOK LAB — Motor de reservas (Google Apps Script)
 * ============================================================
 *  Qué hace:
 *   - GET  ?action=slots&date=AAAA-MM-DD&service=ID&barber=ID|any
 *          → {"slots": ["10:00", "10:30", …]}
 *   - GET  ?action=cita&b=BARBERO&e=EVENTO&t=FIRMA → datos de una cita (para cita.html)
 *   - GET  ?action=dias&from=AAAA-MM-DD&n=14&service=ID&barber=ID|any → horas libres por día (colores y «Primera hora libre»)
 *   - GET  ?action=fueraHorario → días con citas fuera de horario abiertas (franja de la portada)
 *   - POST (cuerpo JSON en text/plain):
 *          · reservar (por defecto) → crea la cita en el calendario del barbero
 *          · action "cancelar"      → borra la cita del calendario (hueco libre)
 *          · action "cambiar"       → mueve la cita a otro día u hora
 *          · action "panel"         → números para el panel del jefe (pide la clave)
 *          · action "novino"        → marca o desmarca "No vino" (pide la clave)
 *          · action "mostrador"     → el barbero apunta a un cliente que llega sin cita (apuntar.html, enlace firmado)
 *          · action "actividad" / "misCitas" / "cancelarBarberia" / "huecos" / "pin" → registro, agenda y panel
 *          · action "esperaApuntar" / "esperaQuitar" → lista de espera; "horasExtra" / "horasExtraGuardar" → fuera de horario
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
var RECORDATORIO_3H = true;    // true = recordatorio 24 h y 3 h antes; false = solo el de 24 h

// ---------- Servicios (duración en minutos, precio en euros) ----------
var SERVICIOS = {
  'corte-clasico': { nombre: 'Corte clásico', duracion: 30, precio: 16 },
  'corte-barba':   { nombre: 'Corte + barba', duracion: 30, precio: 20 },
  'degradado':     { nombre: 'Degradado',     duracion: 30, precio: 17 },
  'barba':         { nombre: 'Arreglo de barba', duracion: 30, precio: 12 }
};

// ---------- Barberos y sus calendarios ----------
// El orden importa: con "Cualquiera" se asigna el primero que esté libre.
// bloquean (opcional): otros calendarios cuyas horas ocupadas también se quitan de la web, por ejemplo el Gmail
// de siempre del barbero con las citas que ya tenía. Él lo comparte con esta cuenta como «solo disponible/ocupado».
// Ejemplo: 'marcos': { nombre: 'Marcos', calendario: 'PEGAR_…', bloquean: ['marcos.personal@gmail.com'] },
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
// Extras opcionales que el cliente puede añadir a su servicio (deben coincidir con config.js → extras).
// barberos: con quién se ofrece (vacío = con todos). No suman tiempo a la cita, solo precio.
// Ejemplo: var EXTRAS = { 'cejas': { nombre: 'Cejas', precio: 6, barberos: ['lucia'] } };
var EXTRAS = {};
// Citas fuera de horario (precio x2): solo UN barbero, cerradas por defecto. Las abre él desde su agenda
// (pestaña «Fuera horario»). Se pueden reservar hasta 30 min antes. barbero: '' = desactivado.
// Debe ser el mismo barbero que config.js → horasExtra. avisar: correo al que llega cada cita (vacío = ninguno).
// Ojo: dentro de estas franjas, si están abiertas, NO se miran los calendarios de «bloquean».
var HORAS_EXTRA = {
  barbero: 'marcos',
  franjas: [['09:00', '10:00'], ['14:00', '16:00'], ['18:00', '21:00']],
  multiplicador: 2,
  antelacionMinutos: 30,
  diasVista: 7,
  avisar: ''
};
// Correo de reseña (después del corte). {barberia} = NOMBRE_BARBERIA. LEMA: frase pequeña bajo la firma (vacío = nada).
var RESENA_TEXTO = [
  'Esperamos que hayas salido de {barberia} con el resultado que buscabas.',
  'Si te ha gustado la experiencia, nos encantaría conocer tu opinión. Tu reseña en Google ayuda a otros a descubrirnos y a nosotros a seguir mejorando cada día.',
  '¿Nos dejas tu valoración? Te llevará menos de un minuto.'
];
var LEMA = '';
// Protección de datos: las citas (con los datos del cliente) y el registro se borran solos pasados estos meses.
// Debe coincidir con lo que dice el aviso legal (config.js → legal.conservacion).
var CONSERVAR_MESES = 24;
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
      var r = { slots: horasLibres_(p.date, servicio, barbero, excluir) };
      // Horas extra abiertas (no al cambiar una cita: esas no se pueden mover a horas extra)
      if (!excluir && (barbero === 'any' || barbero === HORAS_EXTRA.barbero)) {
        var extra = extraLibres_(p.date, servicio);
        if (extra.length) { r.extra = extra; r.extraBarbero = HORAS_EXTRA.barbero; r.multiplicador = HORAS_EXTRA.multiplicador; }
      }
      return json_(r);
    }
    if (p.action === 'cita') {
      var ev = citaSegura_(p.b, p.e, p.t);
      return json_(datosCita_(p.b, ev));
    }
    if (p.action === 'mostrador') return json_(mostradorInfo_(p));
    if (p.action === 'dias') return json_(diasLibres_(p));
    if (p.action === 'fueraHorario') return json_(fueraHorario_(p));
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
    if (d.action === 'actividad') return json_(actividad_(d));
    if (d.action === 'cancelarBarberia') return json_(cancelarBarberia_(d));
    if (d.action === 'misCitas') return json_(misCitas_(d));
    if (d.action === 'pin') return json_(pinOk_(d));
    if (d.action === 'huecos') return json_(huecos_(d));
    if (d.action === 'esperaApuntar') return json_(esperaApuntar_(d));
    if (d.action === 'esperaQuitar') return json_(esperaQuitar_(d));
    if (d.action === 'horasExtra') return json_(horasExtra_(d));
    if (d.action === 'horasExtraGuardar') return json_(horasExtraGuardar_(d, lock));

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
    var esExtra = d.extra === true;
    var asignado = null;
    if (esExtra) {
      // Hora extra: solo si el barbero de horas extra la ha abierto y sigue libre
      if (barberoPedido !== 'any' && barberoPedido !== HORAS_EXTRA.barbero) throw aviso_('Esa hora fuera de horario no es de ese barbero.', 'SLOT_TAKEN');
      if (extraLibres_(d.date, servicio).indexOf(d.time) !== -1) asignado = HORAS_EXTRA.barbero;
    } else {
      var candidatos = barberoPedido === 'any' ? Object.keys(BARBEROS) : [barberoPedido];
      for (var i = 0; i < candidatos.length && !asignado; i++) {
        if (horasLibres_(d.date, servicio, candidatos[i]).indexOf(d.time) !== -1) asignado = candidatos[i];
      }
    }
    if (!asignado) throw aviso_('Vaya, alguien acaba de reservar esa hora. Elige otra, por favor.', 'SLOT_TAKEN');

    var b = BARBEROS[asignado];
    // Extras pedidos que de verdad ofrece ese barbero (los demás se ignoran)
    var extras = (Array.isArray(d.extras) ? d.extras : []).filter(function (id, i, a) {
      var x = EXTRAS[id]; return x && a.indexOf(id) === i && (!x.barberos || !x.barberos.length || x.barberos.indexOf(asignado) !== -1);
    });
    var total = servicio.precio + extras.reduce(function (s, id) { return s + EXTRAS[id].precio; }, 0);
    if (esExtra) total = total * HORAS_EXTRA.multiplicador;
    var nombreServicio = servicio.nombre + extras.map(function (id) { return ' + ' + EXTRAS[id].nombre; }).join('');
    var inicio = fechaHora_(d.date, d.time);
    var fin = new Date(inicio.getTime() + servicio.duracion * 60000);
    var minutosHasta = (inicio.getTime() - Date.now()) / 60000;

    var creado = Calendar.Events.insert({
      summary: (esExtra ? '★ FUERA DE HORARIO · ' : '') + nombreServicio + ' · ' + nombre + ' ' + apellidos,
      start: { dateTime: inicio.toISOString(), timeZone: ZONA_HORARIA },
      end: { dateTime: fin.toISOString(), timeZone: ZONA_HORARIA },
      description:
        (esExtra ? 'CITA FUERA DE HORARIO (precio x' + HORAS_EXTRA.multiplicador + ').\n' : '') +
        'Cliente: ' + nombre + ' ' + apellidos + '\n' +
        'Teléfono: ' + telefono + '\n' +
        'Correo: ' + email + '\n' +
        'Servicio: ' + nombreServicio + ' (' + servicio.duracion + ' min, ' + total + ' €)\n' +
        'Barbero: ' + b.nombre + '\n\n' +
        'Ha aceptado la política de cancelación (aviso mínimo de ' + CANCELACION_HORAS + ' h; si no acude sin avisar, se cobra el servicio en la próxima visita).\n' +
        'Reserva hecha desde la web (Book Lab).',
      location: DIRECCION,
      attendees: [{ email: email, displayName: nombre + ' ' + apellidos }],
      // Etiquetas para recordatorios, gestión de la cita y panel
      extendedProperties: {
        private: {
          booklab: '1', email: email, nombre: nombre, apellidos: apellidos, telefono: telefono,
          servicio: d.service, precio: String(total), barbero: asignado, cambios: '0', extras: extras.join(','), horaExtra: esExtra ? '1' : '',
          r24: minutosHasta > 24 * 60 ? 'pendiente' : 'no',
          r3: RECORDATORIO_3H && minutosHasta > 3 * 60 ? 'pendiente' : 'no',
          resena: 'pendiente'
        }
      }
    }, calendario_(asignado), { sendUpdates: 'all' }); // sendUpdates: envía la invitación al cliente

    lock.releaseLock();
    tengoLock = false;
    registrar_('reserva', { barbero: asignado, cliente: nombre + ' ' + apellidos, telefono: telefono, email: email,
      servicio: nombreServicio, precio: total, fecha: d.date, hora: d.time, origen: esExtra ? 'Web · fuera de horario' : 'Web', evento: creado.id });
    quitarDeEsperaAlReservar_(d.date, email, telefono);
    if (esExtra) borrarCacheFuera_();

    var cuando = cuandoTexto_(d.date, d.time);
    var gestionar = enlaceCita_(asignado, creado.id);
    try {
      enviarCorreo_(email, 'Cita confirmada · ' + NOMBRE_BARBERIA,
        '¡Cita confirmada!',
        'Hola ' + nombre + ', te esperamos.',
        { nombre: nombreServicio, duracion: servicio.duracion, precio: total }, b.nombre, cuando,
        { gestionar: gestionar, soloCancelar: esExtra, nota: esExtra ? 'Cita fuera de horario: precio x' + HORAS_EXTRA.multiplicador + '. Si no vienes, se cobra entera.' : '' });
    } catch (mailErr) {
      console.error('No se pudo enviar la confirmación: ' + mailErr);
    }
    if (esExtra && HORAS_EXTRA.avisar) {
      try {
        MailApp.sendEmail({ to: HORAS_EXTRA.avisar, name: NOMBRE_BARBERIA,
          subject: '★ Cita fuera de horario · ' + cuando + ' · ' + nombre + ' ' + apellidos,
          body: 'Nueva cita fuera de horario.\n\nCliente: ' + nombre + ' ' + apellidos + '\nTeléfono: ' + telefono + '\nCorreo: ' + email +
            '\nServicio: ' + nombreServicio + '\nCuándo: ' + cuando + '\nPrecio: ' + total + ' € (x' + HORAS_EXTRA.multiplicador + ')\n\nYa está en tu calendario.' });
      } catch (x) { console.error('No se pudo avisar de la cita fuera de horario: ' + x); }
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
  var servicio = servicioDeCita_(tags, ev, 30);
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
    puedeCambiar: enPlazo && cambios < MAX_CAMBIOS && tags.horaExtra !== '1',
    horaExtra: tags.horaExtra === '1',
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
  avisarEsperaSeguro_([info.fecha]);
  registrar_('cancelacion_cliente', { barbero: d.b, cliente: ((tags.nombre || '') + ' ' + (tags.apellidos || '')).trim(), telefono: tags.telefono,
    email: tags.email, servicio: info.servicio, precio: info.precio, fecha: info.fecha, hora: info.hora, origen: 'Web (el cliente)', evento: d.e });

  try {
    enviarCorreo_(tags.email, 'Cita cancelada · ' + NOMBRE_BARBERIA,
      'Cita cancelada',
      'Hola ' + (tags.nombre || '') + ', hemos cancelado tu cita. ¡Esperamos verte pronto!',
      { nombre: info.servicio, precio: info.precio }, info.barbero, info.cuando,
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
  if (tags.horaExtra === '1') throw aviso_('Las citas fuera de horario no se pueden cambiar online. Llámanos al ' + TELEFONO_BARBERIA + '.', 'HORA_EXTRA');
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
    tags.r3 = RECORDATORIO_3H && minutosHasta > 3 * 60 ? 'pendiente' : 'no';
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
  avisarEsperaSeguro_([info.fecha]);
  registrar_('cambio', { barbero: d.b, cliente: ((tags.nombre || '') + ' ' + (tags.apellidos || '')).trim(), telefono: tags.telefono,
    email: tags.email, servicio: info.servicio, precio: info.precio, fecha: d.date, hora: d.time, origen: 'Web (el cliente)',
    detalle: 'Antes: ' + info.cuando, evento: d.e });

  var cuando = cuandoTexto_(d.date, d.time);
  try {
    enviarCorreo_(tags.email, 'Cita cambiada · ' + NOMBRE_BARBERIA,
      'Tu cita ha cambiado',
      'Hola ' + (tags.nombre || '') + ', esta es tu nueva cita.',
      { nombre: info.servicio, precio: info.precio }, info.barbero, cuando, { gestionar: enlaceCita_(d.b, d.e) });
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
  } catch (e) {
    console.error('Estadística no guardada: ' + e);   // nunca debe impedir cancelar o cambiar una cita
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
          id: ev.id, b: id, s: t.servicio || '', sn: servicioDeCita_(t, ev, 0).nombre,
          precio: t.precio ? Number(t.precio) : (s.precio || 0),
          dur: Math.round((fin - ini) / 60000),
          f: Utilities.formatDate(ini, ZONA_HORARIA, 'yyyy-MM-dd'), h: Utilities.formatDate(ini, ZONA_HORARIA, 'HH:mm'),
          cliente: ((t.nombre || '') + ' ' + (t.apellidos || '')).trim(), email: t.email || '', tel: t.telefono || '',
          novino: t.novino === '1', pagado: t.novinoPagado === '1', cambios: Number(t.cambios || 0),
          origen: t.origen === 'mostrador' ? 'mostrador' : 'web', extra: t.horaExtra === '1'
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
    correos: { restantes: MailApp.getRemainingDailyQuota(), limite: LIMITE_CORREOS_DIA },
    espera: esperaPublica_(true),
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
  registrar_(d.valor ? 'no_show' : 'no_show_quitado', datosRegistro_(d.b, ev, tags, 'Panel'));
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
  if (d.valor) registrar_('pagado', datosRegistro_(d.b, ev, tags, 'Panel'));
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
          r3: RECORDATORIO_3H && email && minutosHasta > 3 * 60 ? 'pendiente' : 'no',
          resena: email ? 'pendiente' : 'no'
        }
      }
    }, calendario_(d.b), { sendUpdates: 'none' });
  } finally {
    lock.releaseLock();
  }

  registrar_('mostrador', { barbero: d.b, cliente: nombre, telefono: telefono, email: email, servicio: servicio.nombre,
    precio: servicio.precio, fecha: fecha, hora: hora, origen: 'Agenda de ' + BARBEROS[d.b].nombre, evento: creado.id });
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
  var ini0 = new Date(ev.start.dateTime);
  registrar_('deshecha', { barbero: d.b, cliente: tags.nombre, telefono: tags.telefono, email: tags.email, servicio: servicioDeCita_(tags, ev, 0).nombre,
    precio: tags.precio, fecha: Utilities.formatDate(ini0, ZONA_HORARIA, 'yyyy-MM-dd'), hora: Utilities.formatDate(ini0, ZONA_HORARIA, 'HH:mm'),
    origen: 'Agenda de ' + BARBEROS[d.b].nombre, evento: d.e });
  avisarEsperaSeguro_([Utilities.formatDate(ini0, ZONA_HORARIA, 'yyyy-MM-dd')]);
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

// ---------- Registro de actividad (hoja de Google «Registro · …» en esta cuenta) ----------
// Cada reserva, cambio, cancelación, cita de mostrador, no show y pago queda en una fila.
// Lo de más de CONSERVAR_MESES (24 = 2 años) se borra solo (una vez al día, desde sendReminders).

var LIMITE_CORREOS_DIA = 100;   // Gmail gratis. Con Google Workspace, pon 1500
var REGISTRO_TIPOS = {
  reserva: 'Reserva', cambio: 'Cambio', cancelacion_cliente: 'Cancelada por el cliente',
  cancelacion_barberia: 'Cancelada por la barbería', mostrador: 'Apuntada en mostrador', deshecha: 'Deshecha',
  no_show: 'No vino', no_show_quitado: 'Quitado «No vino»', pagado: 'Pagado (no vino)',
  espera: 'Apuntado a la lista de espera', espera_aviso: 'Avisado de un hueco (lista de espera)', espera_quitado: 'Quitado de la lista de espera',
  horas_extra: 'Fuera de horario: abiertas o cerradas'
};
var REGISTRO_COLUMNAS = ['Cuándo', 'Qué', 'Barbero', 'Cliente', 'Teléfono', 'Correo', 'Servicio', 'Precio', 'Día de la cita', 'Hora', 'Origen', 'Detalle', 'tipo', 'barberoId', 'eventoId'];

/** Ejecútala una vez desde el editor: crea la hoja del registro y pide el permiso de Google Sheets. */
function prepararRegistro() {
  var h = hojaRegistro_();
  console.log('✔ Registro listo: ' + h.getParent().getUrl());
}

function hojaRegistro_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('REGISTRO_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Registro · ' + NOMBRE_BARBERIA);
    props.setProperty('REGISTRO_ID', ss.getId());
    var h0 = ss.getSheets()[0];
    h0.setName('Actividad');
    h0.appendRow(REGISTRO_COLUMNAS);
    h0.setFrozenRows(1);
    h0.getRange(1, 1, 1, REGISTRO_COLUMNAS.length).setFontWeight('bold');
    h0.hideColumns(13, 3);   // columnas técnicas (tipo, barberoId, eventoId)
  }
  return ss.getSheetByName('Actividad') || ss.getSheets()[0];
}

/** Apunta una fila. Nunca rompe la acción principal: si falla, solo se anota en el registro de errores. */
function registrar_(tipo, x) {
  try {
    hojaRegistro_().appendRow([
      new Date(), REGISTRO_TIPOS[tipo] || tipo, x.barbero ? (BARBEROS[x.barbero] || {}).nombre || x.barbero : '',
      x.cliente || '', x.telefono ? "'" + x.telefono : '', x.email || '', x.servicio || '',
      x.precio === '' || x.precio === undefined || x.precio === null ? '' : Number(x.precio),
      x.fecha || '', x.hora || '', x.origen || '', x.detalle || '', tipo, x.barbero || '', x.evento || ''
    ]);
  } catch (e) { console.error('Registro: ' + e); }
}

function datosRegistro_(barbero, ev, tags, origen) {
  var ini = new Date(ev.start.dateTime);
  return { barbero: barbero, cliente: ((tags.nombre || '') + ' ' + (tags.apellidos || '')).trim(), telefono: tags.telefono, email: tags.email,
    servicio: servicioDeCita_(tags, ev, 0).nombre, precio: tags.precio, fecha: Utilities.formatDate(ini, ZONA_HORARIA, 'yyyy-MM-dd'),
    hora: Utilities.formatDate(ini, ZONA_HORARIA, 'HH:mm'), origen: origen, evento: ev.id };
}

/**
 * Protección de datos (RGPD): una vez al día borra del calendario las citas hechas con Book Lab (web, mostrador)
 * de hace más de CONSERVAR_MESES, y quita de las estadísticas los meses más antiguos.
 * Solo toca eventos marcados por Book Lab (booklab=1): lo que el barbero apunte a mano no se borra.
 * Los correos que envía el motor (carpeta «Enviados») se borran aparte: ver la guía (README, paso de entrega).
 */
function borrarDatosAntiguos_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
    if (props.getProperty('DATOS_LIMPIOS') === hoy) return;
    props.setProperty('DATOS_LIMPIOS', hoy);
    var p = hoy.split('-');
    var limite = new Date(Number(p[0]), Number(p[1]) - 1 - CONSERVAR_MESES, Number(p[2]));
    var desde = new Date(limite.getTime() - 400 * 86400000);   // revisa el año anterior al límite (por si un día no se ejecutó)
    var borradas = 0;
    Object.keys(BARBEROS).forEach(function (id) {
      var calId = calendario_(id), token = null;
      do {
        var lista = Calendar.Events.list(calId, { timeMin: desde.toISOString(), timeMax: limite.toISOString(), singleEvents: true,
          privateExtendedProperty: 'booklab=1', maxResults: 250, pageToken: token || undefined });
        (lista.items || []).forEach(function (ev) {
          if (ev.status === 'cancelled') return;
          try { Calendar.Events.remove(calId, ev.id, { sendUpdates: 'none' }); borradas++; } catch (e) { console.warn('No se pudo borrar ' + ev.id + ': ' + e); }
        });
        token = lista.nextPageToken;
      } while (token && borradas < 500);   // como mucho 500 al día: el resto, mañana
    });
    // Estadísticas (cancelaciones y cambios por mes): fuera los meses de antes del límite
    var mesLimite = Utilities.formatDate(limite, ZONA_HORARIA, 'yyyy-MM');
    var stats = JSON.parse(props.getProperty('ESTADISTICAS') || '{}'), antes = Object.keys(stats).length;
    Object.keys(stats).forEach(function (m) { if (m < mesLimite) delete stats[m]; });
    if (Object.keys(stats).length !== antes) props.setProperty('ESTADISTICAS', JSON.stringify(stats));
    if (borradas) console.log('Protección de datos: ' + borradas + ' citas de hace más de ' + CONSERVAR_MESES + ' meses borradas.');
  } catch (e) { console.error('Borrado de datos antiguos: ' + e); }
}

function limpiarRegistroDiario_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
    if (props.getProperty('REGISTRO_LIMPIO') === hoy || !props.getProperty('REGISTRO_ID')) return;
    props.setProperty('REGISTRO_LIMPIO', hoy);
    var h = hojaRegistro_(), n = h.getLastRow() - 1;
    if (n < 1) return;
    var limite = new Date(Date.now() - CONSERVAR_MESES * 30.44 * 86400000), fechas = h.getRange(2, 1, n, 1).getValues(), viejas = 0;
    while (viejas < fechas.length && fechas[viejas][0] instanceof Date && fechas[viejas][0] < limite) viejas++;
    if (viejas) h.deleteRows(2, viejas);
  } catch (e) { console.error('Limpieza del registro: ' + e); }
}

/**
 * Actividad para el panel (con la clave: todo) o para la agenda de un barbero (con su PIN: solo lo suyo, sin precios).
 * d.dias: cuántos días hacia atrás (60 por defecto, hasta 730).
 */
function actividad_(d) {
  var deBarbero = !d.clave;
  if (deBarbero) { comprobarMostrador_(d.b); comprobarPin_(d.b, d.pin); } else comprobarClave_(d.clave);
  var dias = Math.min(Math.max(Number(d.dias) || 60, 1), 730);
  var limite = new Date(Date.now() - dias * 86400000);
  var id = PropertiesService.getScriptProperties().getProperty('REGISTRO_ID');
  if (!id) return { ok: true, items: [], dias: dias };
  var h = hojaRegistro_(), n = h.getLastRow() - 1;
  if (n < 1) return { ok: true, items: [], dias: dias };
  var desde = Math.max(2, h.getLastRow() - 4000 + 1);   // como mucho las últimas 4000 filas
  var filas = h.getRange(desde, 1, h.getLastRow() - desde + 1, REGISTRO_COLUMNAS.length).getValues();
  var items = [];
  for (var i = filas.length - 1; i >= 0; i--) {
    var f = filas[i];
    if (!(f[0] instanceof Date) || f[0] < limite) break;
    if (deBarbero && f[13] !== d.b) continue;
    var fechaCita = f[8] instanceof Date ? Utilities.formatDate(f[8], ZONA_HORARIA, 'yyyy-MM-dd') : String(f[8] || '');
    var horaCita = f[9] instanceof Date ? Utilities.formatDate(f[9], ZONA_HORARIA, 'HH:mm') : String(f[9] || '');
    var it = { t: f[0].toISOString(), tipo: f[12], b: f[13], barbero: f[2], cliente: f[3], tel: String(f[4] || ''), email: f[5],
      servicio: f[6], f: fechaCita, h: horaCita, origen: f[10], detalle: f[11] };
    if (!deBarbero) it.precio = f[7] === '' ? '' : Number(f[7]);
    items.push(it);
  }
  return { ok: true, items: items, dias: dias };
}

// ---------- PIN de la agenda de cada barbero ----------

/** Ejecútala desde el editor: crea (o cambia) el PIN de 4 cifras de cada barbero y lo escribe en el registro. */
function configurarPines() {
  var pines = {};
  Object.keys(BARBEROS).forEach(function (id) {
    pines[id] = String(1000 + Math.floor(Math.random() * 9000));
    console.log(BARBEROS[id].nombre + ': PIN ' + pines[id]);
  });
  PropertiesService.getScriptProperties().setProperty('PINES', JSON.stringify(pines));
  console.log('Pásale a cada barbero SOLO su PIN. Si vuelves a ejecutar esta función, los PIN cambian.');
}

function comprobarPin_(barbero, pin) {
  var cache = CacheService.getScriptCache(), k = 'pin_fallos_' + barbero;
  var fallos = Number(cache.get(k) || 0);
  if (fallos >= 8) throw aviso_('Demasiados intentos con un PIN incorrecto. Espera 15 minutos.', 'BLOQUEADO');
  var pines = JSON.parse(PropertiesService.getScriptProperties().getProperty('PINES') || '{}');
  if (!pines[barbero]) throw aviso_('Tu PIN aún no está creado. Pídeselo al dueño de la barbería.', 'SIN_PIN');
  if (!pin || String(pin) !== pines[barbero]) {
    cache.put(k, String(fallos + 1), 900);
    throw aviso_('PIN incorrecto.', 'PIN');
  }
}

function pinOk_(d) { comprobarMostrador_(d.b); comprobarPin_(d.b, d.pin); return { ok: true }; }

/** Próximas citas del barbero (hoy y los siguientes días), con los datos del cliente y sin precios. */
function misCitas_(d) {
  comprobarMostrador_(d.b); comprobarPin_(d.b, d.pin);
  var dias = Math.min(Math.max(Number(d.dias) || 8, 1), 31);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var desde = fechaHora_(hoy, '00:00'), hasta = fechaHora_(sumarDias_(hoy, dias), '00:00');
  var lista = Calendar.Events.list(calendario_(d.b), { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true,
    privateExtendedProperty: 'booklab=1', maxResults: 500, orderBy: 'startTime' });
  var ahora = Date.now();
  var citas = (lista.items || []).filter(function (ev) { return ev.status !== 'cancelled' && ev.start && ev.start.dateTime; }).map(function (ev) {
    var t = (ev.extendedProperties && ev.extendedProperties.private) || {}, ini = new Date(ev.start.dateTime);
    return { id: ev.id, f: Utilities.formatDate(ini, ZONA_HORARIA, 'yyyy-MM-dd'), h: Utilities.formatDate(ini, ZONA_HORARIA, 'HH:mm'),
      cliente: ((t.nombre || '') + ' ' + (t.apellidos || '')).trim(), tel: t.telefono || '', email: t.email || '',
      servicio: servicioDeCita_(t, ev, 0).nombre, origen: t.origen === 'mostrador' ? 'mostrador' : 'web', pasada: ini.getTime() <= ahora,
      novino: t.novino === '1', extra: t.horaExtra === '1' };
  });
  // Cuánta gente espera hueco cada día con este barbero (o con «Cualquiera»), sin sus datos
  var espera = {};
  esperaPublica_(false).forEach(function (x) { if (x.b === d.b || x.b === 'any') espera[x.f] = (espera[x.f] || 0) + 1; });
  return { ok: true, hoy: hoy, ahora: Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm'), citas: citas, espera: espera };
}

/**
 * La barbería cancela una cita (desde el panel con la clave, o desde la agenda del barbero con su PIN):
 * se borra del calendario, el hueco queda libre y, si avisar = true, el cliente recibe un correo con el motivo.
 */
function cancelarBarberia_(d) {
  var desdePanel = !!d.clave;
  if (desdePanel) comprobarClave_(d.clave); else { comprobarMostrador_(d.b); comprobarPin_(d.b, d.pin); }
  barbero_(d.b);
  var calId = calendario_(d.b), ev;
  try { ev = Calendar.Events.get(calId, d.e); } catch (x) { ev = null; }
  if (!ev || ev.status === 'cancelled') throw aviso_('Esa cita ya no existe: puede que ya esté cancelada.', 'NO_EXISTE');
  var tags = (ev.extendedProperties && ev.extendedProperties.private) || {};
  if (tags.booklab !== '1') throw aviso_('Esa cita no se hizo desde la web ni desde la agenda.');
  var ini = new Date(ev.start.dateTime);
  if (ini.getTime() <= Date.now()) throw aviso_('Esa cita ya ha empezado o ha pasado: no se puede cancelar.');
  var motivo = limpiar_(d.motivo, 200);
  var datos = datosRegistro_(d.b, ev, tags, desdePanel ? 'Panel' : 'Agenda de ' + BARBEROS[d.b].nombre);
  datos.detalle = motivo ? 'Motivo: ' + motivo : '';
  // 'all': Google quita también la cita del calendario del cliente (si no, se le queda puesta, y si su calendario
  // es de los que «bloquean», el hueco seguiría ocupado). Además le mandamos nuestro correo con el motivo.
  Calendar.Events.remove(calId, d.e, { sendUpdates: 'all' });
  sumarEstadistica_(datos.fecha, d.b, 'cancelacionesBarberia');
  var avisado = false;
  if (d.avisar && tags.email) {
    try {
      enviarCorreo_(tags.email, 'Cita cancelada · ' + NOMBRE_BARBERIA, 'Tu cita ha sido cancelada',
        'Hola ' + (tags.nombre || '') + ', sentimos tener que cancelar tu cita. Puedes reservar otra cuando quieras.',
        { nombre: datos.servicio, precio: datos.precio }, BARBEROS[d.b].nombre, cuandoTexto_(datos.fecha, datos.hora),
        { sinPolitica: true, nota: motivo ? 'Motivo: ' + motivo : '',
          boton: URL_WEB ? { texto: 'Reservar otra cita', url: URL_WEB.replace(/\/?$/, '/') + 'reservar.html' } : null });
      avisado = true;
    } catch (mailErr) { console.error('No se pudo enviar el aviso de cancelación: ' + mailErr); }
  }
  datos.detalle = [datos.detalle, avisado ? 'Avisado por correo' : (d.avisar ? 'Sin correo del cliente' : 'Sin aviso por correo')].filter(Boolean).join(' · ');
  registrar_('cancelacion_barberia', datos);
  avisarEsperaSeguro_([datos.fecha]);
  return { ok: true, avisado: avisado, cliente: datos.cliente, tel: datos.telefono || '', fecha: datos.fecha, hora: datos.hora, servicio: datos.servicio };
}

/** Huecos libres de hoy y mañana por barbero (para el texto de Instagram / WhatsApp del panel). */
function huecos_(d) {
  comprobarClave_(d.clave);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd'), manana = sumarDias_(hoy, 1);
  var corto = Object.keys(SERVICIOS).sort(function (a, b) { return SERVICIOS[a].duracion - SERVICIOS[b].duracion; })[0];
  var out = { ok: true, hoy: hoy, manana: manana, dias: {} };
  [hoy, manana].forEach(function (f) {
    out.dias[f] = {};
    Object.keys(BARBEROS).forEach(function (id) {
      try { out.dias[f][id] = horasLibres_(f, SERVICIOS[corto], id); } catch (e) { out.dias[f][id] = []; }
    });
  });
  out.extra = {};
  [hoy, manana].forEach(function (f) { try { out.extra[f] = extraLibres_(f, SERVICIOS[corto]); } catch (e) { out.extra[f] = []; } });
  out.extraBarbero = HORAS_EXTRA.barbero;
  return out;
}

// ---------- Horas extra (fuera de horario, precio x2) ----------
// Se guardan en la propiedad HORAS_EXTRA_ABIERTAS: { 'AAAA-MM-DD': ['18:00', '18:30', …] } (inicios de media hora).

/** ¿Esta barbería tiene citas fuera de horario? (HORAS_EXTRA.barbero con un barbero que exista) */
function hayHorasExtra_() { return !!(HORAS_EXTRA && HORAS_EXTRA.barbero && BARBEROS[HORAS_EXTRA.barbero]); }

function horasExtraAbiertas_() {
  if (!hayHorasExtra_()) return {};
  var todo = JSON.parse(PropertiesService.getScriptProperties().getProperty('HORAS_EXTRA_ABIERTAS') || '{}');
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  Object.keys(todo).forEach(function (f) { if (f < hoy) delete todo[f]; });
  return todo;
}

/**
 * GET ?action=fueraHorario[&service=id]: días con citas fuera de horario libres (para el aviso de la portada,
 * la franja de la reserva y «O antes, fuera de horario»). Caché de 1 minuto: la reserva lo vuelve a comprobar.
 */
function fueraHorario_(p) {
  var servicio = SERVICIOS[p.service] || SERVICIOS[Object.keys(SERVICIOS).sort(function (a, b) { return SERVICIOS[a].duracion - SERVICIOS[b].duracion; })[0]];
  var id = SERVICIOS[p.service] ? p.service : '_';
  if (!hayHorasExtra_()) return { ok: true, dias: [] };
  var cache = CacheService.getScriptCache(), k = 'fh_' + id, guardado = cache.get(k);
  if (guardado) return JSON.parse(guardado);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd'), limite = sumarDias_(hoy, 21);
  var abiertas = horasExtraAbiertas_(), dias = [];
  Object.keys(abiertas).sort().forEach(function (f) {
    if (f > limite) return;
    var hs = extraLibres_(f, servicio);
    if (hs.length) dias.push({ f: f, horas: hs });
  });
  var out = { ok: true, hoy: hoy, barbero: HORAS_EXTRA.barbero, nombre: BARBEROS[HORAS_EXTRA.barbero].nombre, multiplicador: HORAS_EXTRA.multiplicador, dias: dias };
  cache.put(k, JSON.stringify(out), 60);
  return out;
}

/** Inicios de media hora de todas las franjas de horas extra. */
function horasExtraPosibles_() {
  var out = [];
  if (!hayHorasExtra_()) return out;
  HORAS_EXTRA.franjas.forEach(function (fr) {
    for (var t = aMin_(fr[0]); t + INTERVALO_MINUTOS <= aMin_(fr[1]); t += INTERVALO_MINUTOS) out.push(aHHMM_(t));
  });
  return out;
}

/**
 * Horas extra que se pueden reservar ese día para ese servicio: abiertas por el barbero, a partir de 30 min desde ahora,
 * sin chocar con nada de SU calendario de la barbería (citas, horas extra ya cogidas) y que no sean ya horas normales.
 * Los calendarios de «bloquean» (sus bloqueos personales) no cuentan aquí.
 */
function extraLibres_(fecha, servicio) {
  if (!hayHorasExtra_()) return [];
  var abiertas = horasExtraAbiertas_()[fecha] || [];
  if (!abiertas.length) return [];
  var id = HORAS_EXTRA.barbero;
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (fecha < hoy) return [];
  var minimo = fecha === hoy ? aMin_(Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm')) + HORAS_EXTRA.antelacionMinutos : -1;
  var ocup = ocupado_(id, fecha, '', true);
  var normales = {};
  horasLibres_(fecha, servicio, id).forEach(function (h) { normales[h] = true; });
  var set = {};
  abiertas.forEach(function (h) { set[h] = true; });
  return abiertas.filter(function (h) {
    var t = aMin_(h), e = t + servicio.duracion;
    if (t < minimo || normales[h]) return false;
    for (var x = t; x < e; x += INTERVALO_MINUTOS) if (!set[aHHMM_(x)]) return false;   // todo el servicio dentro de lo abierto
    return !ocup.some(function (o) { return t < o[1] && e > o[0]; });
  }).sort();
}

function borrarCacheFuera_() {
  try { CacheService.getScriptCache().removeAll(['fh__'].concat(Object.keys(SERVICIOS).map(function (k) { return 'fh_' + k; }))); } catch (e) { /* nada */ }
}

function comprobarJefeExtra_(d) {
  comprobarMostrador_(d.b); comprobarPin_(d.b, d.pin);
  if (!hayHorasExtra_()) throw aviso_('Esta barbería no tiene citas fuera de horario.', 'NO_EXTRA');
  if (d.b !== HORAS_EXTRA.barbero) throw aviso_('Las citas fuera de horario solo las abre ' + BARBEROS[HORAS_EXTRA.barbero].nombre + '.', 'NO_EXTRA');
}

/** La botonera de la agenda: los próximos días abiertos con cada media hora de horas extra (abierta / reservada). */
function horasExtra_(d) {
  comprobarJefeExtra_(d);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var ahoraMin = aMin_(Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm'));
  var abiertas = horasExtraAbiertas_(), posibles = horasExtraPosibles_(), dias = [];
  for (var i = 0; i < 21 && dias.length < HORAS_EXTRA.diasVista; i++) {
    var f = sumarDias_(hoy, i);
    if (!(HORARIO[diaSemana_(f)] || []).length) continue;
    var ab = abiertas[f] || [], ocup = ab.length ? ocupado_(HORAS_EXTRA.barbero, f, '', true) : [];
    dias.push({ f: f, horas: posibles.map(function (h) {
      var t = aMin_(h);
      return { h: h, abierta: ab.indexOf(h) !== -1, reservada: ab.indexOf(h) !== -1 && ocup.some(function (o) { return t < o[1] && t + INTERVALO_MINUTOS > o[0]; }),
        pasada: f === hoy && t < ahoraMin + HORAS_EXTRA.antelacionMinutos };
    }) });
  }
  return { ok: true, hoy: hoy, franjas: HORAS_EXTRA.franjas, multiplicador: HORAS_EXTRA.multiplicador, dias: dias };
}

/** Guarda lo marcado en la botonera. d.abiertas = { 'AAAA-MM-DD': ['18:00', …] }. Avisa a la lista de espera de lo nuevo. */
function horasExtraGuardar_(d, lock) {
  comprobarJefeExtra_(d);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd'), limite = sumarDias_(hoy, 21);
  var posibles = horasExtraPosibles_(), pedidas = d.abiertas || {};
  if (!lock.tryLock(25000)) throw aviso_('Hay mucha gente reservando ahora mismo. Inténtalo en unos segundos.');
  var antes, nuevo, nuevas = [];
  try {
    antes = horasExtraAbiertas_();
    nuevo = {};
    Object.keys(antes).forEach(function (f) { nuevo[f] = antes[f].slice(); });
    Object.keys(pedidas).forEach(function (f) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || f < hoy || f > limite) return;
      var lista = (Array.isArray(pedidas[f]) ? pedidas[f] : []).filter(function (h, i, a) { return posibles.indexOf(h) !== -1 && a.indexOf(h) === i; });
      // Las que ya tienen cita no se pueden cerrar
      var ocup = (antes[f] || []).length ? ocupado_(HORAS_EXTRA.barbero, f, '', true) : [];
      (antes[f] || []).forEach(function (h) {
        var t = aMin_(h);
        if (lista.indexOf(h) === -1 && ocup.some(function (o) { return t < o[1] && t + INTERVALO_MINUTOS > o[0]; })) lista.push(h);
      });
      lista.sort();
      lista.forEach(function (h) { if ((antes[f] || []).indexOf(h) === -1) nuevas.push(f + ' ' + h); });
      if (lista.length) nuevo[f] = lista; else delete nuevo[f];
    });
    PropertiesService.getScriptProperties().setProperty('HORAS_EXTRA_ABIERTAS', JSON.stringify(nuevo));
    borrarCacheFuera_();
  } finally { lock.releaseLock(); }
  registrar_('horas_extra', { barbero: HORAS_EXTRA.barbero, origen: 'Agenda de ' + BARBEROS[HORAS_EXTRA.barbero].nombre,
    detalle: Object.keys(nuevo).sort().map(function (f) { return f.slice(8, 10) + '/' + f.slice(5, 7) + ': ' + nuevo[f].join(', '); }).join(' · ') || 'Todas cerradas' });
  var fechas = nuevas.map(function (x) { return x.slice(0, 10); }).filter(function (f, i, a) { return a.indexOf(f) === i; });
  var avisados = fechas.length ? avisarEsperaSeguro_(fechas) : 0;
  return { ok: true, abiertas: nuevo, nuevas: nuevas.length, avisados: avisados };
}

// ---------- Lista de espera (hoja «Lista de espera» en la hoja del registro) ----------
// Columnas: id · apuntado · día · barbero · franja · servicio · nombre · teléfono · correo · avisados (horas ya avisadas)

var ESPERA_COLUMNAS = ['id', 'Apuntado', 'Día', 'Barbero', 'Franja', 'Servicio', 'Nombre', 'Teléfono', 'Correo', 'Avisados'];
var ESPERA_FRANJAS = { manana: 'Mañana', tarde: 'Tarde', todo: 'Cualquier hora' };

function hojaEspera_() {
  var ss = hojaRegistro_().getParent();
  var h = ss.getSheetByName('Lista de espera');
  if (!h) {
    h = ss.insertSheet('Lista de espera');
    h.appendRow(ESPERA_COLUMNAS);
    h.setFrozenRows(1);
    h.getRange(1, 1, 1, ESPERA_COLUMNAS.length).setFontWeight('bold');
  }
  return h;
}

/** Filas vivas (de hoy en adelante), con su número de fila. Borra las de días pasados. */
function leerEspera_() {
  var h = hojaEspera_(), n = h.getLastRow() - 1;
  if (n < 1) return [];
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var filas = h.getRange(2, 1, n, ESPERA_COLUMNAS.length).getValues(), out = [], viejas = [];
  filas.forEach(function (r, i) {
    var f = r[2] instanceof Date ? Utilities.formatDate(r[2], ZONA_HORARIA, 'yyyy-MM-dd') : String(r[2]);
    if (f < hoy) { viejas.push(i + 2); return; }
    out.push({ fila: i + 2, id: String(r[0]), apuntado: r[1] instanceof Date ? r[1].toISOString() : String(r[1]), f: f, b: String(r[3]),
      franja: String(r[4]), s: String(r[5]), nombre: String(r[6]), tel: String(r[7]).replace(/^'/, ''), email: String(r[8]),
      avisados: String(r[9] || '').split(',').filter(Boolean) });
  });
  viejas.reverse().forEach(function (fila) { h.deleteRow(fila); });
  if (viejas.length) out.forEach(function (x) { x.fila -= viejas.filter(function (v) { return v < x.fila; }).length; });
  return out;
}

/** Para el panel (conDatos) o para la agenda (solo día y barbero). */
function esperaPublica_(conDatos) {
  if (!PropertiesService.getScriptProperties().getProperty('REGISTRO_ID')) return [];
  try {
    return leerEspera_().map(function (x) {
      return conDatos
        ? { id: x.id, apuntado: x.apuntado, f: x.f, b: x.b, franja: x.franja, s: x.s, nombre: x.nombre, tel: x.tel, email: x.email, avisado: x.avisados.length > 0 }
        : { f: x.f, b: x.b };
    });
  } catch (e) { console.error('Lista de espera: ' + e); return []; }
}

function franjaOk_(h, franja) { return franja === 'manana' ? h < '14:00' : franja === 'tarde' ? h >= '14:00' : true; }

/** Horas libres que encajan con lo que pide alguien de la lista: { normales: [...], extra: [...] }. cache: para no repetir consultas. */
function huecosParaEspera_(x, cache) {
  var servicio = SERVICIOS[x.s] || SERVICIOS[Object.keys(SERVICIOS)[0]];
  var ids = x.b === 'any' ? Object.keys(BARBEROS) : [x.b];
  var normales = {}, extra = [];
  ids.forEach(function (id) {
    if (!BARBEROS[id]) return;
    var k = x.f + '|' + id + '|' + x.s;
    if (!(k in cache)) { try { cache[k] = horasLibres_(x.f, servicio, id); } catch (e) { cache[k] = []; } }
    cache[k].forEach(function (h) { if (franjaOk_(h, x.franja)) normales[h] = true; });
  });
  if (ids.indexOf(HORAS_EXTRA.barbero) !== -1) {
    var kx = x.f + '|extra|' + x.s;
    if (!(kx in cache)) { try { cache[kx] = extraLibres_(x.f, servicio); } catch (e) { cache[kx] = []; } }
    extra = cache[kx].filter(function (h) { return franjaOk_(h, x.franja); });
  }
  return { normales: Object.keys(normales).sort(), extra: extra };
}

function esperaApuntar_(d) {
  if (d.web) throw aviso_('No se ha podido completar.');
  validarFecha_(d.date);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (d.date < hoy || d.date > sumarDias_(hoy, DIAS_MAXIMOS)) throw aviso_('Elige un día entre hoy y los próximos ' + DIAS_MAXIMOS + ' días.');
  if (!(HORARIO[diaSemana_(d.date)] || []).length) throw aviso_('Ese día estamos cerrados.');
  var b = d.barber || 'any';
  if (b !== 'any') barbero_(b);
  servicio_(d.service);
  var franja = ESPERA_FRANJAS[d.franja] ? d.franja : 'todo';
  var nombre = limpiar_(d.name, 80), telefono = limpiar_(d.phone, 20), email = limpiar_(d.email, 120).toLowerCase();
  if (!nombre) throw aviso_('Escribe tu nombre.');
  if (telefono.replace(/\D/g, '').length < 9) throw aviso_('Escribe tu teléfono (9 cifras): te podemos avisar por WhatsApp.');
  if (!EMAIL_RE.test(email)) throw aviso_('Escribe tu correo: por ahí te avisamos al momento si se libera un hueco.');
  if (estaBloqueado_(email, telefono)) throw aviso_(MENSAJE_BLOQUEO, 'BLOQUEADO');
  var lista = leerEspera_(), tel = telNormal_(telefono);
  if (lista.some(function (x) { return x.f === d.date && (telNormal_(x.tel) === tel || x.email === email); })) {
    throw aviso_('Ya estás en la lista de espera de ese día. Te avisaremos si se libera un hueco.', 'YA_APUNTADO');
  }
  if (lista.filter(function (x) { return telNormal_(x.tel) === tel; }).length >= 5) throw aviso_('Ya estás en la lista de espera de 5 días. Espera a que se libere alguno.');
  var x = { f: d.date, b: b, franja: franja, s: d.service };
  // Lo que ya está libre ahora no se avisa (solo los huecos que se liberen a partir de ahora)
  var ya = huecosParaEspera_(x, {});
  var avisados = ya.normales.concat(ya.extra.map(function (h) { return 'x' + h; }));
  hojaEspera_().appendRow([Utilities.getUuid().slice(0, 8), new Date(), "'" + d.date, b, franja, d.service, nombre, "'" + telefono, email, avisados.join(',')]);
  registrar_('espera', { barbero: b === 'any' ? '' : b, cliente: nombre, telefono: telefono, email: email, servicio: SERVICIOS[d.service].nombre,
    fecha: d.date, origen: 'Web', detalle: (b === 'any' ? 'Cualquier barbero' : BARBEROS[b].nombre) + ' · ' + ESPERA_FRANJAS[franja] });
  return { ok: true };
}

function esperaQuitar_(d) {
  comprobarClave_(d.clave);
  var x = leerEspera_().filter(function (y) { return y.id === String(d.id); })[0];
  if (x) {
    hojaEspera_().deleteRow(x.fila);
    registrar_('espera_quitado', { barbero: x.b === 'any' ? '' : x.b, cliente: x.nombre, telefono: x.tel, email: x.email, fecha: x.f, origen: 'Panel' });
  }
  return { ok: true, espera: esperaPublica_(true) };
}

/** Si reserva alguien que estaba en la lista de ese día, sale de la lista. */
function quitarDeEsperaAlReservar_(fecha, email, telefono) {
  try {
    if (!PropertiesService.getScriptProperties().getProperty('REGISTRO_ID')) return;
    var tel = telNormal_(telefono), h = hojaEspera_();
    leerEspera_().filter(function (x) { return x.f === fecha && ((tel && telNormal_(x.tel) === tel) || (email && x.email === email)); })
      .map(function (x) { return x.fila; }).sort(function (a, b) { return b - a; }).forEach(function (fila) { h.deleteRow(fila); });
  } catch (e) { console.error('Lista de espera (al reservar): ' + e); }
}

/** Avisa por correo a quien espera hueco en esas fechas (null = todas) si hay horas nuevas que le encajan. Nunca rompe nada. */
function avisarEsperaSeguro_(fechas) {
  if (fechas) borrarCacheFuera_();   // se ha liberado algo: el aviso de «fuera de horario» se recalcula
  try {
    if (!PropertiesService.getScriptProperties().getProperty('REGISTRO_ID')) return 0;
    return avisarEspera_(fechas);
  } catch (e) { console.error('Lista de espera (avisos): ' + e); return 0; }
}

function avisarEspera_(fechas) {
  var lista = leerEspera_().filter(function (x) { return !fechas || fechas.indexOf(x.f) !== -1; });
  if (!lista.length) return 0;
  var cache = {}, h = hojaEspera_(), enviados = 0;
  var base = URL_WEB ? URL_WEB.replace(/\/?$/, '/') : '';
  lista.forEach(function (x) {
    var libres = huecosParaEspera_(x, cache);
    var nuevasN = libres.normales.filter(function (t) { return x.avisados.indexOf(t) === -1; });
    var nuevasX = libres.extra.filter(function (t) { return x.avisados.indexOf('x' + t) === -1; });
    if (!nuevasN.length && !nuevasX.length) return;
    var soloExtra = !nuevasN.length;
    var horas = soloExtra ? nuevasX : nuevasN;
    var barbero = soloExtra ? HORAS_EXTRA.barbero : x.b;
    var dia = cuandoTexto_(x.f, horas[0]).split(' a las ')[0];
    var url = base ? base + 'reservar.html?service=' + encodeURIComponent(x.s) + '&barber=' + encodeURIComponent(barbero) +
      '&date=' + x.f + '&time=' + horas[0] + (soloExtra ? '&extra=1' : '') : '';
    try {
      enviarCorreo_(x.email, (soloExtra ? '★ Fuera de horario' : '¡Hueco libre!') + ' · ' + dia + ' · ' + NOMBRE_BARBERIA,
        soloExtra ? '¡Abrimos citas fuera de horario!' : '¡Se ha quedado un hueco libre!',
        'Hola ' + x.nombre.split(' ')[0] + ', estabas en nuestra lista de espera para el ' + dia.toLowerCase() + '. ' +
          (soloExtra ? BARBEROS[HORAS_EXTRA.barbero].nombre + ' abre citas fuera de horario:' : 'Ahora hay hora libre:'),
        { nombre: (SERVICIOS[x.s] || {}).nombre || '', precio: '' },
        barbero === 'any' ? 'El primero que tenga hueco' : BARBEROS[barbero].nombre,
        dia + ': ' + horas.slice(0, 6).join(', ') + (horas.length > 6 ? '…' : ''),
        { sinPolitica: true,
          nota: (soloExtra ? 'Son citas fuera de horario: el precio es el doble del servicio. ' : '') + 'Corre: el primero que reserva se la queda.',
          boton: url ? { texto: 'Reservar ahora', url: url } : null });
      enviados++;
      registrar_('espera_aviso', { barbero: barbero === 'any' ? '' : barbero, cliente: x.nombre, telefono: x.tel, email: x.email,
        servicio: (SERVICIOS[x.s] || {}).nombre, fecha: x.f, origen: 'Automático', detalle: (soloExtra ? 'Fuera de horario: ' : 'Horas: ') + horas.join(', ') });
    } catch (mailErr) { console.error('No se pudo avisar a la lista de espera: ' + mailErr); return; }
    // Se apunta todo lo libre ahora (así no se le vuelve a avisar por lo mismo)
    var todo = x.avisados.concat(nuevasN, nuevasX.map(function (t) { return 'x' + t; }));
    h.getRange(x.fila, 10).setValue(todo.filter(function (t, i, a) { return a.indexOf(t) === i; }).join(','));
  });
  return enviados;
}

// ---------- Recordatorios (activador cada 15 minutos) ----------

function sendReminders() {
  limpiarRegistroDiario_();
  borrarDatosAntiguos_();
  avisarEsperaSeguro_(null);   // huecos nuevos (también los que se borran a mano en el calendario)
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

      var servicio = servicioDeCita_(tags, ev, 0);
      var fecha = Utilities.formatDate(inicio, ZONA_HORARIA, 'yyyy-MM-dd');
      var hora = Utilities.formatDate(inicio, ZONA_HORARIA, 'HH:mm');
      var cuando = cuandoTexto_(fecha, hora);
      var nombre = tags.nombre || '';
      var gestionar = enlaceCita_(id, ev.id);
      var cambio = null;

      if (RECORDATORIO_3H && minutos <= 3 * 60 && tags.r3 === 'pendiente') {
        enviarCorreo_(email, 'Hoy a las ' + hora + ' · ' + NOMBRE_BARBERIA,
          'Tu cita es en unas horas',
          'Hola ' + nombre + ', te recordamos que hoy tienes cita.',
          servicio, BARBEROS[id].nombre, cuando, { gestionar: gestionar, soloCancelar: tags.horaExtra === '1' });
        cambio = { r3: 'enviado' };
        if (tags.r24 === 'pendiente') cambio.r24 = 'no';
      } else if (minutos <= 24 * 60 && tags.r24 === 'pendiente') {
        enviarCorreo_(email, 'Recordatorio: mañana tienes cita · ' + NOMBRE_BARBERIA,
          'Mañana te esperamos',
          'Hola ' + nombre + ', te recordamos tu cita.',
          servicio, BARBEROS[id].nombre, cuando, { gestionar: gestionar, soloCancelar: tags.horaExtra === '1' });
        cambio = { r24: 'enviado' };
      }

      if (cambio) {
        Object.keys(cambio).forEach(function (k) { tags[k] = cambio[k]; });
        Calendar.Events.patch({ extendedProperties: { private: tags } }, calId, ev.id, { sendUpdates: 'none' });
      }
    });
  });
}

/** Correo de después del corte: ¿qué tal? + botón para dejar reseña en Google (texto en RESENA_TEXTO y LEMA). */
function enviarResena_(para, nombre, barbero) {
  var enlace = ENLACE_RESENAS || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(NOMBRE_BARBERIA + ' ' + DIRECCION);
  var asunto = (nombre ? nombre + ', ¿' : '¿') + 'qué tal ese corte? ✂️';
  var lineas = RESENA_TEXTO.map(function (l) { return l.replace(/\{barberia\}/g, NOMBRE_BARBERIA); });
  var html =
    '<div style="background:#f4f4f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">' +
    '<div style="background:#0a0a0b;padding:24px 28px;color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.04em">' + esc_(NOMBRE_BARBERIA) +
    '<div style="height:3px;width:40px;background:#f5c518;margin-top:12px"></div></div>' +
    '<div style="padding:28px">' +
    '<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#0a0a0b">' + esc_((nombre ? nombre + ', ¿' : '¿') + 'qué tal ese corte?') + '</h1>' +
    lineas.map(function (l) { return '<p style="margin:0 0 14px;color:#3f3f46;font-size:16px;line-height:1.5">' + esc_(l) + '</p>'; }).join('') +
    '<p style="margin:24px 0 8px;font-size:28px;letter-spacing:4px;color:#f5c518;text-align:center">★★★★★</p>' +
    '<p style="text-align:center;margin:0 0 8px"><a href="' + esc_(enlace) + '" style="display:inline-block;background:#f5c518;color:#0a0a0b;font-weight:800;font-size:16px;text-decoration:none;padding:16px 28px;border-radius:999px">Dejar mi reseña en Google</a></p>' +
    '<p style="margin:24px 0 0;color:#3f3f46;font-size:16px;line-height:1.5">Gracias por confiar en nosotros.</p>' +
    '<p style="margin:16px 0 0;color:#0a0a0b;font-size:14px;font-weight:800;letter-spacing:.08em">' + esc_(NOMBRE_BARBERIA) +
    (LEMA ? '<br><span style="font-weight:600;color:#71717a;letter-spacing:.04em">' + esc_(LEMA) + '</span>' : '') + '</p>' +
    '</div></div></div>';
  var texto = asunto + '\n\n' + lineas.join('\n\n') + '\n\nDeja tu reseña aquí: ' + enlace +
    '\n\nGracias por confiar en nosotros.\n\n' + NOMBRE_BARBERIA + (LEMA ? '\n' + LEMA : '');
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

/**
 * Resumen de varios días seguidos (para pintar los días en verde / amarillo / rojo y el botón
 * «Primera hora libre»): { dias: { 'AAAA-MM-DD': { libres: n, total: m } } }.
 * Lee el calendario de cada barbero UNA vez para todo el tramo (no un día cada vez).
 */
function diasLibres_(p) {
  validarFecha_(p.from);
  var servicio = servicio_(p.service);
  var barbero = p.barber || 'any';
  if (barbero !== 'any') barbero_(barbero);
  var n = Math.min(Math.max(Number(p.n) || 14, 1), 21);
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  var ultimo = sumarDias_(hoy, DIAS_MAXIMOS);
  var desde = fechaHora_(p.from, '00:00');
  var hasta = fechaHora_(sumarDias_(p.from, n), '00:00');
  var ids = barbero === 'any' ? Object.keys(BARBEROS) : [barbero];
  var ocupados = {};
  ids.forEach(function (id) { ocupados[id] = ocupadoRango_(id, desde, hasta); });
  var minHueco = Math.min.apply(null, Object.keys(SERVICIOS).map(function (k) { return SERVICIOS[k].duracion; }));
  var dias = {};
  for (var i = 0; i < n; i++) {
    var ymd = sumarDias_(p.from, i);
    if (ymd > ultimo) break;
    var ventanas = (HORARIO[diaSemana_(ymd)] || []).map(function (v) { return [aMin_(v[0]), aMin_(v[1])]; });
    if (!ventanas.length) { dias[ymd] = { libres: 0, total: 0, cerrado: true }; continue; }
    var minimo = ymd === hoy ? aMin_(Utilities.formatDate(new Date(), ZONA_HORARIA, 'HH:mm')) + ANTELACION_MINUTOS : -1;
    var ini = fechaHora_(ymd, '00:00'), fin = fechaHora_(sumarDias_(ymd, 1), '00:00');
    var libres = {};
    ids.forEach(function (id) {
      var ocup = ocupados[id].filter(function (o) { return o[0] < fin && o[1] > ini; }).map(function (o) {
        return [
          o[0] <= ini ? 0 : aMin_(Utilities.formatDate(o[0], ZONA_HORARIA, 'HH:mm')),
          o[1] >= fin ? 24 * 60 : aMin_(Utilities.formatDate(o[1], ZONA_HORARIA, 'HH:mm'))
        ];
      });
      inicioslibres_(ventanas, ocup, servicio.duracion, INTERVALO_MINUTOS, minimo, EVITAR_HUECOS_SUELTOS, minHueco)
        .forEach(function (t) { libres[t] = true; });
    });
    var total = inicioslibres_(ventanas, [], servicio.duracion, INTERVALO_MINUTOS, minimo, EVITAR_HUECOS_SUELTOS, minHueco).length;
    dias[ymd] = { libres: Object.keys(libres).length, total: total };
    if (ids.indexOf(HORAS_EXTRA.barbero) !== -1 && (horasExtraAbiertas_()[ymd] || []).length) {
      try { var ex = extraLibres_(ymd, servicio).length; if (ex) dias[ymd].extra = ex; } catch (e) { /* sin marca */ }
    }
  }
  return { dias: dias };
}

/** Tramos ocupados [inicio, fin] (fechas) del barbero entre dos momentos: su calendario + los que «bloquean». */
function ocupadoRango_(id, desde, hasta) {
  var calId = calendario_(id), out = [], token = null;
  do {
    var lista;
    try {
      lista = Calendar.Events.list(calId, { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true, maxResults: 2500, pageToken: token || undefined });
    } catch (err) {
      console.error(err);
      throw aviso_('No encontramos el calendario de ' + BARBEROS[id].nombre + '. Avisa a la barbería, por favor.');
    }
    (lista.items || []).forEach(function (ev) {
      if (ev.status === 'cancelled') return;
      var s = ev.start.dateTime ? new Date(ev.start.dateTime) : fechaHora_(ev.start.date, '00:00');
      var e = ev.end.dateTime ? new Date(ev.end.dateTime) : fechaHora_(ev.end.date, '00:00');
      out.push([s, e]);
    });
    token = lista.nextPageToken;
  } while (token);
  var otros = (BARBEROS[id].bloquean || []).filter(Boolean);
  if (otros.length) {
    try {
      var r = Calendar.Freebusy.query({ timeMin: desde.toISOString(), timeMax: hasta.toISOString(), timeZone: ZONA_HORARIA, items: otros.map(function (c) { return { id: c }; }) });
      Object.keys(r.calendars || {}).forEach(function (c) {
        var info = r.calendars[c] || {};
        if (info.errors && info.errors.length) return;
        (info.busy || []).forEach(function (b) { out.push([new Date(b.start), new Date(b.end)]); });
      });
    } catch (err) { console.warn('No se pudo consultar ocupado/libre: ' + err); }
  }
  return out;
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
function ocupado_(id, fecha, excluirId, sinOtros) {
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
  var tramo = function (s, e) {
    return [
      s <= desde ? 0 : aMin_(Utilities.formatDate(s, ZONA_HORARIA, 'HH:mm')),
      e >= hasta ? 24 * 60 : aMin_(Utilities.formatDate(e, ZONA_HORARIA, 'HH:mm'))
    ];
  };
  var ocupado = (lista.items || []).filter(function (ev) { return ev.status !== 'cancelled' && ev.id !== excluirId; }).map(function (ev) {
    // dateTime = evento con hora; date = evento de día completo
    var s = ev.start.dateTime ? new Date(ev.start.dateTime) : fechaHora_(ev.start.date, '00:00');
    var e = ev.end.dateTime ? new Date(ev.end.dateTime) : fechaHora_(ev.end.date, '00:00');
    return tramo(s, e);
  });
  return sinOtros ? ocupado : ocupado.concat(ocupadoOtros_(id, desde, hasta, tramo));
}

/**
 * Otros calendarios del barbero que también bloquean horas (BARBEROS[id].bloquean), p. ej. su Gmail personal
 * con citas que ya tenía dadas. Solo se mira «ocupado / libre» (basta con compartirlo con la cuenta de la
 * barbería como «Ver solo información de disponible/ocupado»). Si no está compartido, se ignora sin romper nada.
 */
function ocupadoOtros_(id, desde, hasta, tramo) {
  var otros = (BARBEROS[id].bloquean || []).filter(Boolean);
  if (!otros.length) return [];
  try {
    var r = Calendar.Freebusy.query({
      timeMin: desde.toISOString(), timeMax: hasta.toISOString(), timeZone: ZONA_HORARIA,
      items: otros.map(function (c) { return { id: c }; })
    });
    var out = [];
    Object.keys(r.calendars || {}).forEach(function (c) {
      var info = r.calendars[c] || {};
      if (info.errors && info.errors.length) { console.warn('Sin acceso al calendario ' + c + ': ' + JSON.stringify(info.errors)); return; }
      (info.busy || []).forEach(function (b) { out.push(tramo(new Date(b.start), new Date(b.end))); });
    });
    return out;
  } catch (err) {
    console.warn('No se pudo consultar ocupado/libre de ' + otros.join(', ') + ': ' + err);
    return [];
  }
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
  var notaBoton = opciones.gestionar ? 'Desde ahí puedes ' + (opciones.soloCancelar ? 'cancelar' : 'cancelar o cambiar') + ' tu cita hasta ' + CANCELACION_HORAS + ' horas antes.' : '';

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
    (opciones.nota ? '<p style="margin:20px 0 0;color:#1e1e1e;font-size:15px;line-height:1.5;background:#f4f4f5;border-radius:10px;padding:12px 14px">' + esc_(opciones.nota) + '</p>' : '') +
    (boton ? '<p style="text-align:center;margin:24px 0 6px"><a href="' + esc_(boton.url) + '" style="display:inline-block;background:#0a0a0b;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;padding:14px 24px;border-radius:999px">' + esc_(boton.texto) + '</a></p>' : '') +
    (notaBoton ? '<p style="margin:0;text-align:center;color:#71717a;font-size:13px">' + esc_(notaBoton) + '</p>' : '') +
    (politica ? '<p style="margin:20px 0 0;color:#52525b;font-size:14px;line-height:1.5">' + esc_(politica) + '</p>' : '') +
    '</div></div>' +
    '<p style="text-align:center;color:#a1a1aa;font-size:12px;margin-top:16px">Reserva gestionada con Book Lab</p></div>';

  var texto = titulo + '\n\n' + saludo + '\n\n' +
    filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') +
    (opciones.nota ? '\n\n' + opciones.nota : '') +
    (boton ? '\n\n' + boton.texto + ': ' + boton.url : '') +
    (notaBoton ? '\n' + notaBoton : '') +
    (politica ? '\n\n' + politica : '');

  MailApp.sendEmail({ to: para, subject: asunto, body: texto, htmlBody: html, name: NOMBRE_BARBERIA });
}

// ---------- Ayudantes ----------

/** Servicio de una cita ya creada, con sus extras en el nombre y el precio total guardado. */
function servicioDeCita_(tags, ev, duracionPorDefecto) {
  var s = SERVICIOS[tags.servicio];
  if (!s) return { nombre: (ev.summary || '').split(' · ')[0], duracion: duracionPorDefecto, precio: tags.precio ? Number(tags.precio) : '' };
  var extras = String(tags.extras || '').split(',').filter(function (id) { return EXTRAS[id]; });
  return {
    nombre: s.nombre + extras.map(function (id) { return ' + ' + EXTRAS[id].nombre; }).join(''),
    duracion: s.duracion,
    precio: tags.precio ? Number(tags.precio) : s.precio
  };
}

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
