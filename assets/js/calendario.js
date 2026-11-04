/* Calendario propio que SIEMPRE empieza en lunes.
   El selector de fecha del móvil depende de los ajustes de cada teléfono (a veces empieza en domingo):
   este script lo sustituye en todos los <input type="date"> de la página sin cambiar nada más.
   El input sigue teniendo el valor AAAA-MM-DD y lanza «change» al elegir, como antes. */
(function () {
  'use strict';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  var abierto = null;

  var css = '.bl-cal{position:absolute;z-index:1000;width:300px;max-width:calc(100vw - 24px);background:var(--surface,#fff);color:var(--text,#111);'
    + 'border:1px solid var(--line,#ddd);border-radius:var(--radius,16px);padding:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);font-family:var(--font,system-ui)}'
    + '.bl-cal-cab{display:grid;grid-template-columns:40px 1fr 40px;align-items:center;text-align:center;margin-bottom:8px;font-weight:700;text-transform:capitalize}'
    + '.bl-cal button{font:inherit;border:0;cursor:pointer;background:none;color:inherit;border-radius:10px}'
    + '.bl-cal-fl{width:40px;height:40px;font-size:1.3rem;background:var(--accent-soft,#eee)!important}'
    + '.bl-cal-fl:disabled{opacity:.3;cursor:default}'
    + '.bl-cal-rej{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}'
    + '.bl-cal-dia-sem{text-align:center;font-size:.75rem;font-weight:700;color:var(--muted,#888);padding:4px 0}'
    + '.bl-cal-d{height:38px;font-weight:600}'
    + '.bl-cal-d.hoy{box-shadow:inset 0 0 0 1.5px var(--accent,#111)}'
    + '.bl-cal-d.sel{background:var(--accent,#111)!important;color:var(--accent-ink,#fff)}'
    + '.bl-cal-d:disabled{opacity:.28;cursor:default}';
  var estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  function dos(n) { return (n < 10 ? '0' : '') + n; }
  function texto(y, m, d) { return y + '-' + dos(m + 1) + '-' + dos(d); }
  function hoy() { var d = new Date(); return texto(d.getFullYear(), d.getMonth(), d.getDate()); }

  function cerrar() { if (abierto) { abierto.caja.remove(); abierto = null; } }

  function pintar(estado) {
    var input = estado.input, y = estado.y, m = estado.m;
    var min = input.min || '', max = input.max || '', valor = input.value, h = hoy();
    var primero = (new Date(y, m, 1).getDay() + 6) % 7, dias = new Date(y, m + 1, 0).getDate();
    var html = '<div class="bl-cal-cab"><button type="button" class="bl-cal-fl" data-mover="-1" aria-label="Mes anterior"'
      + (min && texto(y, m, 1) <= min ? ' disabled' : '') + '>‹</button><span>' + MESES[m] + ' ' + y + '</span>'
      + '<button type="button" class="bl-cal-fl" data-mover="1" aria-label="Mes siguiente"' + (max && texto(y, m, dias) >= max ? ' disabled' : '') + '>›</button></div>'
      + '<div class="bl-cal-rej">';
    SEMANA.forEach(function (s) { html += '<span class="bl-cal-dia-sem">' + s + '</span>'; });
    for (var i = 0; i < primero; i++) html += '<span></span>';
    for (var d = 1; d <= dias; d++) {
      var f = texto(y, m, d), fuera = (min && f < min) || (max && f > max);
      html += '<button type="button" class="bl-cal-d' + (f === h ? ' hoy' : '') + (f === valor ? ' sel' : '') + '" data-f="' + f + '"'
        + (fuera ? ' disabled' : '') + ' aria-label="' + d + ' de ' + MESES[m] + '">' + d + '</button>';
    }
    estado.caja.innerHTML = html + '</div>';
  }

  function abrir(input) {
    cerrar();
    var base = input.value || input.min || hoy();
    var caja = document.createElement('div');
    caja.className = 'bl-cal';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-label', 'Elegir día');
    var estado = { input: input, caja: caja, y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 };
    pintar(estado);
    document.body.appendChild(caja);
    var r = input.getBoundingClientRect();
    caja.style.top = (window.scrollY + r.bottom + 6) + 'px';
    caja.style.left = Math.max(12, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - caja.offsetWidth - 12)) + 'px';
    caja.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      e.stopPropagation();
      if (b.dataset.mover) {
        var n = new Date(estado.y, estado.m + Number(b.dataset.mover), 1);
        estado.y = n.getFullYear(); estado.m = n.getMonth();
        pintar(estado);
      } else if (b.dataset.f) {
        input.value = b.dataset.f;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        cerrar();
      }
    });
    abierto = estado;
  }

  function preparar(input) {
    if (input.dataset.blCal) return;
    input.dataset.blCal = '1';
    // Sin el selector del sistema: se abre el nuestro
    input.addEventListener('click', function (e) { e.preventDefault(); abrir(input); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); abrir(input); }
      else if (e.key === 'Escape') cerrar();
      else if (e.key !== 'Tab') e.preventDefault();
    });
    input.addEventListener('touchend', function (e) { e.preventDefault(); abrir(input); });
    input.setAttribute('inputmode', 'none');
  }

  function todos() { Array.prototype.forEach.call(document.querySelectorAll('input[type="date"]'), preparar); }
  document.addEventListener('click', function (e) { if (abierto && !abierto.caja.contains(e.target) && e.target !== abierto.input) cerrar(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
  window.addEventListener('resize', cerrar);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', todos); else todos();
  new MutationObserver(todos).observe(document.documentElement, { childList: true, subtree: true });
})();
