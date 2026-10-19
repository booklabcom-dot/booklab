/*
 * ============================================================
 *  CONFIGURACIÓN DE LA BARBERÍA
 * ============================================================
 *  Este es el ÚNICO archivo que hay que cambiar para adaptar la
 *  web (demo.html) y la reserva (reservar.html) a otra barbería.
 *
 *  IMPORTANTE: si cambias servicios, barberos, horario o el
 *  intervalo aquí, cambia lo mismo al principio de
 *  apps-script/Code.gs (los "id" tienen que coincidir exactamente).
 *
 *  La URL de Apps Script NO va aquí: va al principio de
 *  reservar.html (constante ENDPOINT).
 * ============================================================
 */
window.BOOKLAB_CONFIG = {
  // ---------- Datos del negocio ----------
  negocio: {
    nombre: 'Nombre de tu barbería',
    // true = el nombre sale entre comillas con estilo de "marcador" (solo para la demo).
    // Pon false cuando escribas el nombre real.
    esMarcador: true,
    eslogan: 'Cortes clásicos, degradados y barbas. Sin esperas: reserva en un minuto.',
    direccion: 'Calle Ejemplo 1, 28001 Madrid',
    // Enlace de Google Maps. Si lo dejas vacío, se busca la dirección automáticamente.
    mapa: '',
    telefono: '600 000 000',
    instagram: 'tubarberia',          // sin la @. Vacío = no se muestra
    zonaHoraria: 'Europe/Madrid'
  },

  // ---------- Página de la barbería (demo.html) ----------
  web: {
    // Fotos: pon la ruta de cada imagen (por ejemplo 'assets/img/local.webp').
    // Si una ruta está vacía, se muestra un hueco que dice "Tu foto aquí".
    // Fotos de ejemplo de Unsplash (licencia libre): Barney Goodman, Zachary Lancaster (local);
    // Ahmad Ebadi, GN Group, Peter Vimalis, Salah Regouane (cortes). Cámbialas por las reales.
    portada: 'assets/img/barberia.webp',
    fotosLocal: ['assets/img/local-1.webp', 'assets/img/local-2.webp'],
    galeria: ['assets/img/corte-1.webp', 'assets/img/corte-2.webp', 'assets/img/corte-3.webp', 'assets/img/corte-4.webp'],
    tituloNosotros: 'Menos ruido. Mejores cortes.',
    quienesSomos: [
      'Una barbería pequeña, con las cosas claras: buen oficio, buen trato y cero prisas.',
      'Cada corte empieza con una conversación y termina cuando te miras al espejo y sonríes.'
    ],
    valores: ['Puntualidad', 'Producto profesional', 'Toalla caliente']
  },

  // ---------- Reseñas de Google ----------
  resenas: {
    nota: 4.9,          // nota media en Google
    total: 128,         // número de reseñas
    // Enlace a las reseñas de Google de la barbería. Vacío = busca el nombre + dirección en Google Maps.
    // (El mismo enlace va en Code.gs → ENLACE_RESENAS, para el correo de después del corte.)
    enlace: '',
    // true = muestra la etiqueta "Reseñas de ejemplo" (solo para la demo)
    ejemplo: true,
    lista: [
      { nombre: 'Álex M.', estrellas: 5, cuando: 'hace 1 semana', texto: 'El mejor degradado que me han hecho. Puntuales, buen rollo y reservar es facilísimo.' },
      { nombre: 'Javier R.', estrellas: 5, cuando: 'hace 3 semanas', texto: 'Vas, te sientas y sales nuevo. Marcos es un crack con la navaja.' },
      { nombre: 'Sergio P.', estrellas: 5, cuando: 'hace 1 mes', texto: 'Ambiente top y ni un minuto de espera. Ya no voy a otro sitio.' }
    ]
  },

  // ---------- Servicios ----------
  // id: sin espacios ni tildes. duracion en minutos. precio en euros.
  servicios: [
    { id: 'corte-clasico', nombre: 'Corte clásico', descripcion: 'Tijera y máquina, lavado y peinado.', duracion: 30, precio: 16 },
    { id: 'corte-barba', nombre: 'Corte + barba', descripcion: 'Corte completo y arreglo de barba con toalla caliente.', duracion: 30, precio: 20 },
    { id: 'degradado', nombre: 'Degradado', descripcion: 'Fade a tu medida, del cero al largo que quieras.', duracion: 30, precio: 17 },
    { id: 'barba', nombre: 'Arreglo de barba', descripcion: 'Perfilado, rebaje y acabado con navaja.', duracion: 30, precio: 12 }
  ],

  // ---------- Barberos ----------
  // El primero con id "any" es la opción "Cualquiera": no lo borres.
  // foto: ruta de la foto del barbero (opcional). Vacía = círculo con la inicial.
  barberos: [
    { id: 'any', nombre: 'Cualquiera', frase: 'El primero que tenga hueco.' },
    { id: 'marcos', nombre: 'Marcos', frase: 'Clásicos y navaja. 12 años de oficio.', foto: '' },
    { id: 'lucia', nombre: 'Lucía', frase: 'Degradados limpios y diseño.', foto: '' },
    { id: 'diego', nombre: 'Diego', frase: 'Barbas y cortes texturizados.', foto: '' }
  ],

  // ---------- Horario ----------
  // Claves: 1 = lunes … 7 = domingo. [] = cerrado. Se admiten varios tramos: [['09:00','14:00'], ['16:00','20:00']]
  horario: {
    1: [],
    2: [['09:00', '22:00']],
    3: [['09:00', '22:00']],
    4: [['09:00', '22:00']],
    5: [['09:00', '22:00']],
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
    subtitulo: 'DEMO · así verían tus clientes tu web',
    subtituloReserva: 'Reserva tu cita en 4 pasos',
    botonCita: 'Aparta tu cita',

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
