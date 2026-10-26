/*
 * Plantilla Book Lab — aviso legal, política de privacidad y cookies (legal.html).
 * Todo sale de config.js (negocio y legal). Los datos que falten se muestran
 * como [marcadores] en amarillo para que se vean antes de publicar.
 *
 * Es un texto base pensado para una barbería en España (LSSI-CE, RGPD y LOPDGDD).
 * Conviene que lo revise un asesor antes de publicarlo.
 */
(function () {
  'use strict';

  var C = window.BOOKLAB_CONFIG, N = C.negocio, L = C.legal || {};
  var $ = function (sel) { return document.querySelector(sel); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // Dato del config o, si falta, un marcador visible
  function dato(valor, marcador) {
    return valor ? el('strong', { text: valor }) : el('mark', { class: 'legal-ph', text: '[' + marcador + ']' });
  }
  function p() { return el('p', null, Array.prototype.slice.call(arguments)); }
  function h3(t) { return el('h3', { text: t }); }
  function ul(items) { return el('ul', null, items.filter(Boolean).map(function (i) { return el('li', null, Array.isArray(i) ? i : [i]); })); }

  // legal.ocultarVacios: true → sin NIF (ni marcador) y con la dirección de la barbería como domicilio.
  var SIN_NIF = !!L.ocultarVacios && !L.nif;
  var titular = dato(L.titular, 'Nombre del titular o razón social');
  var nif = function () { return dato(L.nif, 'NIF / CIF'); };
  var domicilio = function () { return dato(L.domicilio || N.direccion, 'Domicilio fiscal'); };
  var email = function () { return dato(L.email, 'Correo de contacto'); };
  var tit = function () { return dato(L.titular, 'Nombre del titular o razón social'); };
  var negocio = function () { return dato(N.nombre, 'Nombre de la barbería'); };

  document.title = 'Aviso legal y privacidad · ' + N.nombre;
  $('#footer-name').textContent = '© ' + new Date().getFullYear() + ' ' + N.nombre;
  if (L.actualizado) $('#legal-updated').textContent = 'Última actualización: ' + L.actualizado;

  // ---------- Aviso legal (LSSI-CE, art. 10) ----------
  [
    p('En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI-CE), te informamos de los datos del titular de esta web:'),
    ul([
      ['Titular: ', titular],
      SIN_NIF ? null : ['NIF / CIF: ', nif()],
      ['Domicilio: ', domicilio()],
      ['Correo electrónico: ', email()],
      ['Teléfono: ', dato(N.telefono, 'Teléfono')],
      ['Actividad: servicios de barbería y peluquería masculina (', negocio(), ').']
    ]),
    h3('Uso de la web'),
    p('Esta web informa sobre los servicios de la barbería y permite reservar cita online. Al usarla te comprometes a hacerlo de buena fe, a dar datos reales al reservar y a no usarla para fines ilícitos.'),
    h3('Propiedad intelectual'),
    p('Los textos, fotos, logotipos y el diseño de esta web pertenecen a su titular o se usan con licencia. No se pueden copiar ni reutilizar sin permiso.'),
    h3('Responsabilidad'),
    p('Intentamos que la información (precios, horarios, servicios) esté siempre actualizada, pero puede contener errores puntuales. Los enlaces a webs de terceros, como Google Maps o Instagram, se ofrecen por comodidad; no somos responsables de su contenido.'),
    h3('Legislación aplicable'),
    p('Esta web se rige por la legislación española.')
  ].forEach(function (n) { $('#aviso-body').appendChild(n); });

  // ---------- Política de privacidad (RGPD y LOPDGDD) ----------
  [
    h3('¿Quién es el responsable de tus datos?'),
    SIN_NIF
      ? p(tit(), ', con domicilio en ', domicilio(), '. Puedes escribirnos a ', email(), '.')
      : p(tit(), ' (', negocio(), '), con NIF ', nif(), ' y domicilio en ', domicilio(), '. Puedes escribirnos a ', email(), '.'),

    h3('¿Qué datos tratamos?'),
    p('Cuando reservas una cita nos facilitas tu nombre, apellidos, correo electrónico y teléfono, además del servicio, el barbero, el día y la hora elegidos. Si pides cita en persona, solo tu nombre y, si quieres, tu teléfono y tu correo. Si te apuntas a la lista de espera, tu nombre, teléfono y correo y el día y la franja que te interesan. No pedimos datos de pago ni datos sensibles.'),

    h3('¿Para qué los usamos?'),
    ul([
      'Gestionar tu reserva y añadir la cita a nuestra agenda.',
      'Enviarte la confirmación de la cita y recordatorios por correo antes de la cita.',
      'Si te apuntas a la lista de espera, avisarte por correo cuando se libere una hora que te encaje. Sales de la lista cuando reservas o cuando pasa ese día.',
      'Si tenemos que cancelar tu cita, avisarte por correo con el motivo.',
      'Después de tu visita, enviarte un único correo para preguntarte qué tal tu experiencia e invitarte a dejar una reseña, si quieres.',
      'Aplicar nuestra política de cancelación, que aceptas al reservar.'
    ]),
    p('No usamos tus datos para enviarte publicidad ni tomamos decisiones automatizadas sobre ti.'),

    h3('¿Por qué podemos usarlos? (base legal)'),
    ul([
      'La gestión de la cita, la confirmación y los recordatorios son necesarios para prestarte el servicio que solicitas (art. 6.1.b del RGPD).',
      'El correo de opinión tras tu visita se basa en nuestro interés legítimo en mejorar el servicio (art. 6.1.f del RGPD). Puedes oponerte respondiendo a cualquiera de nuestros correos.'
    ]),

    h3('¿Cuánto tiempo los guardamos?'),
    p('Conservamos los datos de tus citas ', dato(L.conservacion, 'plazo de conservación'), '. Después los borramos, salvo que una ley nos obligue a guardarlos más tiempo.'),

    h3('¿Quién más puede acceder a ellos?'),
    p('No cedemos tus datos a terceros salvo obligación legal. Para que el sistema de reservas funcione usamos proveedores que actúan como encargados del tratamiento, con contrato y garantías:'),
    ul([
      'Google (Google Calendar, Gmail y Google Apps Script): guarda las citas y envía los correos. Puede tratar datos fuera del Espacio Económico Europeo con las garantías del Marco de Privacidad de Datos UE-EE. UU. y cláusulas contractuales tipo.',
      'Cloudflare (Cloudflare Pages): aloja esta web. No recibe los datos de tus reservas, pero, como cualquier servidor web, puede registrar datos técnicos de la visita (como la dirección IP).',
      'Book Lab: diseña y mantiene la web y el sistema de reservas por encargo de la barbería.'
    ]),

    h3('¿Qué derechos tienes?'),
    p('Puedes pedir acceso a tus datos, rectificarlos o suprimirlos, oponerte a su tratamiento, limitarlo o solicitar su portabilidad. Escríbenos a ', email(), ' indicando qué derecho quieres ejercer. Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (', el('a', { href: 'https://www.aepd.es', target: '_blank', rel: 'noopener', text: 'www.aepd.es' }), ').'),

    h3('¿Y si eres menor?'),
    p('Si tienes menos de 14 años, pide a tu padre, madre o tutor que haga la reserva por ti.')
  ].forEach(function (n) { $('#priv-body').appendChild(n); });

  // ---------- Cookies ----------
  [
    p('Esta web no usa cookies propias ni de terceros para analítica, publicidad ni seguimiento, por eso no te mostramos ningún aviso de cookies.'),
    p('Al consultar horas libres y reservar, tu navegador se conecta con los servidores de Google que gestionan la agenda; esa conexión solo sirve para que funcione la reserva. Si sigues un enlace externo (Google Maps, Instagram, Google Calendar), esas webs tienen sus propias políticas de cookies.')
  ].forEach(function (n) { $('#cookies-body').appendChild(n); });
})();
