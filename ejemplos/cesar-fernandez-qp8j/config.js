/*
 * ============================================================
 *  DEMO PARA CÉSAR FERNÁNDEZ HAIR STUDIO (prospecto, 26/10/2026)
 *  Modo simulación: sin motor. Servicios, precios y horario DE EJEMPLO
 *  (no los tenemos todavía). Sin reseñas: no inventamos reseñas suyas.
 * ============================================================
 *  CONFIGURACIÓN DE LA BARBERÍA  ·  Plantilla Book Lab
 * ============================================================
 *  Este es el ÚNICO archivo que hay que cambiar para adaptar toda la
 *  web a cada barbería: nombre, logo, colores, servicios, precios,
 *  barberos, horario, contacto, textos y datos legales.
 *  Guía paso a paso y ficha de datos del cliente: README.md
 *
 *  IMPORTANTE: si cambias servicios, barberos, horario o el
 *  intervalo aquí, cambia lo mismo al principio de
 *  apps-script/Code.gs (los "id" tienen que coincidir exactamente).
 *
 *  La URL del motor (Apps Script) va en "motor.url", aquí abajo.
 * ============================================================
 */
window.BOOKLAB_CONFIG = {
  // ---------- Motor de reservas (Google Apps Script) ----------
  // Pega aquí la URL de la aplicación web que acaba en /exec (README, paso 5).
  // Mientras no la pegues, la reserva, la gestión de citas y el panel funcionan en modo simulación.
  motor: {
    url: ''
  },

  // ---------- Panel del jefe (panel.html) ----------
  // ejemplo: true permite ver panel.html?demo=1 con datos inventados (solo para la web de Book Lab).
  // En las webs de clientes déjalo en false: el panel solo lo ve el jefe, con su clave.
  panel: {
    ejemplo: true
  },

  // ---------- Datos del negocio ----------
  negocio: {
    nombre: 'César Fernández Hair Studio',
    // true = el nombre sale entre comillas con estilo de "marcador" (para enseñar la plantilla).
    // Pon false cuando escribas el nombre real.
    esMarcador: false,
    eslogan: 'Técnica, precisión y atención en cada corte.',
    direccion: 'Almassora (Castellón)',
    // Enlace de Google Maps. Si lo dejas vacío, se busca la dirección automáticamente.
    mapa: '',
    telefono: '618 39 49 89',
    instagram: 'cesarf_hairstudio',          // sin la @. Vacío = no se muestra
    zonaHoraria: 'Europe/Madrid'
  },

  // ---------- Colores de la marca ----------
  // Se aplican a todas las páginas (web, reserva, gestionar cita, panel y agenda).
  // Formato: '#rrggbb'. Si borras uno, se usa el de la plantilla.
  colores: {
    fondo: '#171717',            // fondo de la web (y barra del navegador en el móvil)
    tarjetas: '#1e1e1d',         // fondo de las tarjetas
    tarjetas2: '#262624',        // fondo de botones y casillas
    lineas: '#353431',           // bordes y separadores
    texto: '#F0EDE6',            // texto principal
    textoSuave: '#a3a099',       // texto secundario
    acento: '#F0EDE6',           // color de la marca: botones, ★, enlaces
    textoSobreAcento: '#171717'  // texto encima del color de la marca (botones)
  },

  // ---------- Google ----------
  // Título y descripción de la portada en los resultados de Google (SEO local: pon barrio y ciudad).
  // Vacíos = "Nombre · Reserva tu cita" y la descripción genérica de index.html.
  seo: {
    titulo: 'César Fernández Hair Studio · Peluquería masculina en Almassora',         // ej.: 'Barbería Olympo · Barbería en Getafe · Reserva online'
    descripcion: 'Cortes, degradados y color con asesoramiento personalizado en Almassora (Castellón). Reserva tu cita online.'     // ej.: 'Cortes, degradados y barbas en Getafe. Reserva tu cita online en un minuto.'
  },

  // ---------- Datos legales (aviso legal y política de privacidad: legal.html) ----------
  // Obligatorios en España. Salen de la ficha del cliente (sección 10).
  // Mientras estén vacíos, la página legal muestra [marcadores] en amarillo.
  legal: {
    titular: '',        // nombre y apellidos del autónomo o razón social de la empresa
    nif: '',            // NIF / CIF
    domicilio: '',      // domicilio fiscal. Vacío = se usa negocio.direccion
    email: '',          // correo para ejercer derechos de privacidad
    conservacion: 'durante 2 años desde tu última cita, salvo que pidas antes su supresión',
    actualizado: ''     // fecha de la última revisión, por ejemplo '20 de octubre de 2026'
  },

  // ---------- Página de la barbería (index.html) ----------
  web: {
    // Logo: ruta de la imagen (por ejemplo 'assets/img/logo.webp'). Sale en el menú y encima del nombre.
    // Vacío = solo el nombre en texto.
    logo: 'assets/img/logo.webp',
    // Fotos: pon la ruta de cada imagen (por ejemplo 'assets/img/local.webp').
    // Si una ruta está vacía, se muestra un hueco que dice "Tu foto aquí".
    // Fotos de ejemplo de Unsplash (licencia libre): Barney Goodman, Zachary Lancaster (local);
    // Ahmad Ebadi, GN Group, Peter Vimalis, Salah Regouane (cortes). Cámbialas por las reales.
    portada: 'assets/img/cesar-hero.webp',
    fotosLocal: ['assets/img/cesar-retrato.webp'],
    galeria: ['assets/img/corte-mechas.webp', 'assets/img/corte-fade.webp'],
    tituloNosotros: 'No hay dos cabezas iguales.',
    quienesSomos: [
      'Cada corte empieza escuchando. Tu tipo de pelo, tus facciones y tu día a día deciden la forma, no la moda de la semana.',
      'Asesoramiento personalizado y técnica en cada detalle, para que el corte funcione también el día veinte, no solo el día que sales del estudio.'
    ],
    valores: ['Asesoramiento personalizado', 'Degradados', 'Color y mechas']
  },

  // ---------- Reseñas de Google ----------
  resenas: null,   // sin reseñas en la demo: no inventamos reseñas suyas

  // ---------- Servicios ----------
  // id: sin espacios ni tildes. duracion en minutos. precio en euros. destacado: true pone una ★.
  servicios: [
    { id: 'corte', nombre: 'Corte', descripcion: 'Asesoramiento, corte a tijera y máquina, lavado y peinado.', duracion: 30, precio: 15, destacado: true },
    { id: 'degradado', nombre: 'Degradado', descripcion: 'Fade a medida: del cero, bajo, medio o alto, con transición limpia.', duracion: 30, precio: 16 },
    { id: 'corte-barba', nombre: 'Corte + barba', descripcion: 'Corte completo y barba perfilada con navaja.', duracion: 45, precio: 22 },
    { id: 'barba', nombre: 'Barba', descripcion: 'Rebaje, perfilado y acabado a navaja.', duracion: 30, precio: 10 },
    { id: 'color', nombre: 'Color y mechas', descripcion: 'Decoloración, mechas o color completo. Te asesoramos antes.', duracion: 90, precio: 40 }
  ],

  // ---------- Extras opcionales (se ofrecen en "Tus datos" al reservar) ----------
  // No suman tiempo a la cita, solo precio. barberos: con quién se ofrece (quítalo = con todos).
  // Deben coincidir con EXTRAS en Code.gs. Vacío [] = no hay extras.
  // Ejemplo: { id: 'cejas', nombre: 'Cejas', pregunta: '¿Añadir cejas?', descripcion: 'Diseño y depilación.', precio: 6, barberos: ['lucia'] }
  extras: [],

  // ---------- Citas fuera de horario (precio x2) ----------
  // null = desactivado. Para activarlo, el id de UN barbero: horasExtra: { barbero: 'marcos' }
  // Ese barbero abre y cierra sus franjas desde su agenda (pestaña «Fuera horario»). Las franjas y el precio
  // se ponen en Code.gs → HORAS_EXTRA (el mismo barbero en los dos sitios).
  horasExtra: null,

  // ---------- Barberos ----------
  // El primero con id "any" es la opción "Cualquiera": no lo borres.
  // foto: ruta de la foto del barbero (opcional). Vacía = círculo con la inicial.
  barberos: [
    { id: 'any', nombre: 'Cualquiera', frase: 'El primero que tenga hueco.' },
    { id: 'cesar', nombre: 'César', frase: 'Degradados, textura y color. Asesoramiento personalizado.', foto: 'assets/img/cesar-retrato.webp' },
    // Álvaro e Iván: nombres inventados para la demo (Johan, 26/10)
    { id: 'alvaro', nombre: 'Álvaro', frase: 'Clásicos a tijera y cortes con volumen.', foto: '' },
    { id: 'ivan', nombre: 'Iván', frase: 'Barba, navaja y fades al detalle.', foto: '' }
  ],

  // ---------- Horario ----------
  // Claves: 1 = lunes … 7 = domingo. [] = cerrado. Se admiten varios tramos: [['09:00','14:00'], ['16:00','20:00']]
  // "horario" es el de las RESERVAS (debe coincidir con HORARIO en Code.gs).
  // Opcional: "horarioWeb" es el que se ENSEÑA en la web, si es distinto (por ejemplo, reservas de 9 a 21
  // sin cortes porque cada barbero bloquea sus descansos en el calendario, pero en la web se enseña el horario
  // de siempre). Si no lo pones, se enseña "horario".
  // horarioWeb: { 1: [], 2: [['10:00', '14:00'], ['16:00', '19:30']], ... },
  horario: {
    1: [],
    2: [['09:30', '13:30'], ['16:00', '20:00']],
    3: [['09:30', '13:30'], ['16:00', '20:00']],
    4: [['09:30', '13:30'], ['16:00', '20:00']],
    5: [['09:30', '13:30'], ['16:00', '20:30']],
    6: [['09:00', '14:00']],
    7: []
  },

  // ---------- Reglas de reserva ----------
  reglas: {
    intervaloMinutos: 30,      // cada cuánto se ofrece una hora de inicio
    antelacionMinutos: 60,     // no se puede reservar con menos antelación
    diasMaximos: 60,           // hasta cuántos días vista se puede reservar
    evitarHuecosSueltos: true, // no ofrece horas que dejarían ratos muertos más cortos que el servicio más corto
    cancelacionHoras: 2        // aviso mínimo para cancelar
  },

  // ---------- Textos ----------
  textos: {
    subtitulo: '',      // texto pequeño encima del nombre en la portada (vacío = no se muestra)
    subtituloReserva: 'Reserva tu cita en 4 pasos',
    botonCita: 'Reservar cita ↗',

    politica: {
      titulo: 'Política de cancelación',
      intro: 'Antes de confirmar tu cita, ten en cuenta lo siguiente:',
      puntos: [
        { titulo: 'Cancelaciones', texto: 'deberás avisar con un mínimo de 2 horas de antelación.' },
        { titulo: 'No show', texto: 'si no acudes a tu cita sin avisar, se cobrará el servicio íntegro en tu próxima visita.' }
      ],
      cierre: 'Al reservar, aceptas estas condiciones y ayudas a respetar el tiempo de todos.',
      casilla: 'He leído y acepto la política de cancelación.'
    },

    confirmacion: 'Te hemos enviado un correo con la confirmación. También te recordaremos la cita 24 horas y 3 horas antes.',
    notaResumen: 'Guarda estos datos en tus notas por si necesitas consultarlos después.',

    // Texto que se copia con "Copiar resumen de la cita".
    // Marcadores: {barberia} {servicio} {precio} {barbero} {fecha} {hora} {direccion}
    resumen: [
      '📅 CITA · {barberia}',
      '━━━━━━━━━━━━━━━━',
      'Servicio:   {servicio}',
      'Precio:     {precio}',
      'Barbero:    {barbero}',
      'Día:        {fecha}',
      'Hora:       {hora}',
      'Dirección:  {direccion}',
      '━━━━━━━━━━━━━━━━',
      '⚠️ Las citas no asistidas o canceladas con menos de 2 horas de antelación deberán abonarse en la próxima visita.'
    ].join('\n')
  }
};
