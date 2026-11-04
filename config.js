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
  // ---------- Motor de reservas (Google Apps Script) ----------
  motor: {
    // Vacío a propósito: la demo funciona en modo simulación (datos de ejemplo, sin correos ni citas reales).
    // Las herramientas funcionales de verdad están en la plantilla (plantilla/), de donde sale cada cliente.
    url: ''
  },

  // ---------- Panel del jefe (panel.html) ----------
  // ejemplo: true permite ver panel.html?demo=1 con datos inventados (solo para la web de Book Lab).
  // En las webs de clientes déjalo en false: el panel solo lo ve el jefe, con su clave.
  panel: {
    ejemplo: true
  },

  // ---------- Colores (tema.js los aplica en reservar, panel, cita y agenda) ----------
  // Solo el color de la marca: el amarillo de Book Lab, con texto negro encima (la demo va a juego con getbooklab.com).
  colores: {
    acento: '#FEDA12',
    textoSobreAcento: '#111111'
  },

  // ---------- Datos del negocio ----------
  negocio: {
    // Barbería inventada para la demo (03/11/2026): con nombre y personalidad vende más que «Nombre de tu barbería».
    nombre: 'Norte Barber Club',
    // true = el nombre sale entre comillas con estilo de "marcador". Con nombre de verdad, false.
    esMarcador: false,
    eslogan: 'Fades que hablan solos. Reserva en un minuto y llega a tu hora.',
    direccion: 'Calle del Norte 14, Malasaña · Madrid',
    // Enlace de Google Maps. Si lo dejas vacío, se busca la dirección automáticamente.
    mapa: '',
    telefono: '600 000 000',
    instagram: '',                    // sin la @. Vacío = no se muestra (la demo no enlaza a ninguna cuenta real)
    zonaHoraria: 'Europe/Madrid'
  },

  // ---------- Responsable de los datos de la demo (nota RGPD de la reserva) ----------
  // En la demo de getbooklab.com el responsable es Book Lab (ver legal.html).
  legal: {
    titular: 'Book Lab',
    email: 'booklab.com@gmail.com'
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
    fotoCorte: 'assets/img/corte-portada.webp',   // segunda foto de la portada (si falta, se usa la primera de la galería)
    tituloNosotros: 'Sales nuevo. Cada vez.',
    quienesSomos: [
      'Somos tres barberos de Malasaña obsesionados con los degradados limpios y las barbas bien perfiladas.',
      'Reservas en un minuto, llegas a tu hora y te vas con el corte que tenías en la cabeza. Sin esperas, sin llamadas.'
    ],
    valores: ['Fades al milímetro', 'Barba con toalla caliente', 'Cero esperas', 'Buena música']
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
      { nombre: 'Javier R.', estrellas: 5, cuando: 'hace 3 semanas', texto: 'Vas, te sientas y sales nuevo. Álex es un crack con los degradados.' },
      { nombre: 'Sergio P.', estrellas: 5, cuando: 'hace 1 mes', texto: 'Ambiente top y ni un minuto de espera. Ya no voy a otro sitio.' }
    ]
  },

  // ---------- Servicios ----------
  // id: sin espacios ni tildes. duracion en minutos. precio en euros.
  servicios: [
    { id: 'corte-clasico', nombre: 'Corte', descripcion: 'Tijera y máquina, lavado y peinado.', duracion: 30, precio: 16 },
    { id: 'corte-barba', nombre: 'Corte + barba', descripcion: 'Corte completo y arreglo de barba con toalla caliente.', duracion: 30, precio: 20 },
    { id: 'degradado', nombre: 'Skinfade', descripcion: 'Degradado a piel, del cero al largo que quieras.', duracion: 30, precio: 17 },
    { id: 'barba', nombre: 'Arreglo de barba', descripcion: 'Perfilado, rebaje y acabado con navaja.', duracion: 30, precio: 12 }
  ],

  // ---------- Citas fuera de horario (precio x2) ----------
  // Álex las abre desde su agenda (pestaña «Fuera horario»). Debe coincidir con Code.gs → HORAS_EXTRA.
  horasExtra: { barbero: 'marcos' },

  // ---------- Caja de cobros (caja.html), «Caja y ventas» y panel «Hoy» (dia.html) ----------
  // En la demo todo va en modo simulación, con cobros inventados. Mismo código que Olympo.
  caja: {
    barberos: ['marcos', 'lucia', 'diego'],
    servicios: [
      { id: 'corte-clasico', nombre: 'Corte', precio: 16 },
      { id: 'degradado', nombre: 'Skinfade', precio: 17 },
      { id: 'corte-barba', nombre: 'Corte + barba', precio: 20 },
      { id: 'barba', nombre: 'Arreglo de barba', precio: 12 }
    ],
    extras: [],
    m12: { barbero: '', nombre: '', precio: 0, paraBarbero: 0 },   // sin «cliente de precio especial» en la demo
    productos: [
      { id: 'cera-mate', nombre: 'Cera mate', precio: 12 },
      { id: 'cera-brillo', nombre: 'Cera brillo', precio: 12 },
      { id: 'aceite', nombre: 'Aceite de barba', precio: 15 },
      { id: 'polvos', nombre: 'Polvos', precio: 15 }
    ],
    billetes: [50, 20, 10, 5, 2, 1],
    reparto: { marcos: 0, lucia: 0.4, diego: 0.5 },   // Álex es el dueño; Dani al 40 %, Sara al 50 %
    jefe: 'marcos'
  },

  // ---------- Barberos ----------
  // El primero con id "any" es la opción "Cualquiera": no lo borres.
  // foto: ruta de la foto del barbero (opcional). Vacía = círculo con la inicial.
  barberos: [
    { id: 'any', nombre: 'Cualquiera', frase: 'El primero que tenga hueco.' },
    { id: 'marcos', nombre: 'Álex', frase: 'El dueño. Clásicos y degradados, 12 años de oficio.', foto: '' },
    { id: 'lucia', nombre: 'Dani', frase: 'Skinfades limpios y diseños.', foto: '' },
    { id: 'diego', nombre: 'Sara', frase: 'Barbas y cortes texturizados.', foto: '' }
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
    // Mensaje de WhatsApp para pedir la reseña (panel «Hoy»)
    resenaWhatsapp: [
      '¡Gracias por venir a Norte Barber Club! 💈',
      '',
      'Si te ha gustado el corte, nos ayudas muchísimo dejándonos una reseña en Google. Son 30 segundos. ⭐⭐⭐⭐⭐',
      '',
      '👉 (aquí va el enlace a tu ficha de Google)',
      '',
      '¡Nos vemos en la próxima!'
    ],
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
