# Book Lab

Web de marketing de Book Lab + demo de una barbería con reservas online.

- `index.html` → la landing de Book Lab.
- `demo.html` → la web de una barbería de ejemplo: portada, precios, quiénes somos, equipo, fotos, horario, ubicación e Instagram. Su botón **«Aparta tu cita»** lleva a la reserva.
- `reservar.html` → la reserva en 4 pasos (servicio, barbero, día y hora, datos) con política de cancelación y resumen copiable.
- `config.js` → **todos** los datos de la barbería (nombre, fotos, textos, servicios, barberos, horario, política…).
- `apps-script/Code.gs` → el "motor" que consulta y crea las citas en Google Calendar y envía los correos.
- `assets/` → logo, fotos, estilos (`css/`) y código (`js/shop.js` para la web, `js/booking.js` para la reserva).

> **Mientras no completes los pasos 1 a 6**, la reserva funciona en **modo simulación**: se puede probar todo el recorrido, pero las horas son de ejemplo, no se crea ninguna cita y no se envía ningún correo. Arriba de la página aparece un aviso amarillo que lo explica.

Todo lo de abajo se hace con la cuenta **booklab.com@gmail.com**. Antes de empezar, comprueba arriba a la derecha (en tu foto de perfil) que estás en esa cuenta y no en otra.

---

## Paso 1 · Crear los tres calendarios de la demo (5 minutos)

1. Entra en <https://calendar.google.com>.
2. En la columna de la izquierda, junto a **Otros calendarios**, pulsa el **+** y elige **Crear calendario**.
3. En **Nombre** escribe `Marcos · Demo Book Lab`. En **Zona horaria** elige **(GMT+01:00) Hora de Europa central - Madrid**. Pulsa **Crear calendario**.
4. Repite lo mismo para `Lucía · Demo Book Lab` y `Diego · Demo Book Lab`.
5. Ahora copia el ID de cada uno:
   1. En la columna izquierda, en **Mis calendarios**, pasa el ratón por encima de "Marcos · Demo Book Lab", pulsa los **tres puntos ⋮** y elige **Configuración y uso compartido**.
   2. Baja hasta la sección **Integrar el calendario**.
   3. Copia el texto de **ID del calendario** (es largo y acaba en `@group.calendar.google.com`).
   4. Pégalo en un bloc de notas junto al nombre del barbero. Haz lo mismo con Lucía y Diego.

## Paso 2 · Crear el proyecto de Apps Script y pegar el código (5 minutos)

1. Entra en <https://script.google.com> y pulsa **Nuevo proyecto**.
2. Arriba a la izquierda, pulsa en **Proyecto sin título** y cámbialo por `Book Lab · Reservas`.
3. Verás un archivo llamado **Código.gs** con unas líneas de ejemplo. Bórralas todas.
4. Abre el archivo `apps-script/Code.gs` de esta carpeta con el Bloc de notas, selecciona todo (Ctrl+A), cópialo (Ctrl+C) y pégalo en el editor (Ctrl+V).
5. Busca estas tres líneas casi al principio y sustituye cada `PEGAR_ID_CALENDARIO_…` por el ID que copiaste en el paso 1 (deja las comillas):
   ```
   'marcos': { nombre: 'Marcos', calendario: 'PEGAR_ID_CALENDARIO_MARCOS' },
   'lucia':  { nombre: 'Lucía',  calendario: 'PEGAR_ID_CALENDARIO_LUCIA' },
   'diego':  { nombre: 'Diego',  calendario: 'PEGAR_ID_CALENDARIO_DIEGO' }
   ```
   Debe quedar algo así: `calendario: 'abc123...@group.calendar.google.com'`.

   > Haz este cambio **solo en el editor de Apps Script**, no en el archivo `Code.gs` de tu carpeta. Así los IDs de tus calendarios no acaban publicados en GitHub.
6. Pulsa el icono del disquete (**Guardar proyecto**) o Ctrl+S.
7. En la columna de la izquierda, junto a **Servicios**, pulsa **+**. Busca **Google Calendar API** en la lista, déjala en la versión **v3** y pulsa **Añadir**. Debajo de "Servicios" aparecerá **Calendar**.
   > Es imprescindible: el código usa esta API porque en cuentas de Gmail nuevas el acceso "normal" a Calendar desde Apps Script da el error *"Google Calendar no está habilitado para el usuario"*.

## Paso 3 · Poner la zona horaria en Madrid y dar permisos (3 minutos)

1. En la barra de la izquierda pulsa la rueda dentada **⚙ Configuración del proyecto**.
2. En **Zona horaria** elige **(GMT+01:00) Hora de Europa central - Madrid**.
3. Vuelve al editor con el icono **< >** (**Editor**) de la barra izquierda.
4. Arriba, en el desplegable que hay junto a **Depurar**, comprueba que pone **probarConfiguracion** (si pone otra función, por ejemplo `doGet`, cámbiala) y pulsa **▶ Ejecutar**.
5. Google pedirá permiso: pulsa **Revisar permisos**, elige **booklab.com@gmail.com**.
   - Si sale "Google no ha verificado esta aplicación", es normal (la aplicación es tuya): pulsa **Configuración avanzada** y después **Ir a Book Lab · Reservas (no seguro)**.
   - Pulsa **Permitir**. (Pide acceso a Calendar y a enviar correo: es lo que necesita para crear citas y mandar confirmaciones.)
6. Abajo se abre el **Registro de ejecución**. Debes ver la zona horaria con ✔, tres líneas con ✔ (una por barbero) y al final **Prueba terminada.** Si ves ✘, revisa el ID de ese calendario.
   - Si después de dar permisos solo ves "Se ha iniciado la ejecución" y "Ejecución completada" sin ✔ ni ✘, pulsa **▶ Ejecutar** otra vez: la primera vez a veces solo concede los permisos.
   - En Google Calendar la zona de Madrid sale como **GMT+02:00** en verano y **GMT+01:00** en invierno. Es la misma zona y las dos están bien.

## Paso 4 · Desplegar como aplicación web (3 minutos)

1. Arriba a la derecha pulsa el botón azul **Implementar** → **Nueva implementación**.
2. Junto a **Seleccionar tipo**, pulsa la rueda dentada ⚙ y elige **Aplicación web**.
3. Rellena:
   - **Descripción**: `Reservas`
   - **Ejecutar como**: **Yo (booklab.com@gmail.com)**
   - **Quién tiene acceso**: **Cualquier usuario**
4. Pulsa **Implementar**. Si vuelve a pedir permisos, acéptalos como en el paso 3.
5. Copia la **URL de la aplicación web**: empieza por `https://script.google.com/macros/s/` y **acaba en `/exec`**.
6. Comprueba que funciona: pega esa URL en el navegador. Debe aparecer un texto como `{"ok":true,"mensaje":"Book Lab funcionando..."}`.

> **Si más adelante cambias algo en Code.gs**, no crees otra implementación (cambiaría la URL). Ve a **Implementar** → **Gestionar implementaciones** → icono del lápiz ✏️ → en **Versión** elige **Nueva versión** → **Implementar**. La URL sigue siendo la misma.

## Paso 5 · Crear el activador de recordatorios (2 minutos)

1. En la barra de la izquierda pulsa el reloj **⏰ Activadores**.
2. Abajo a la derecha, **+ Añadir activador**.
3. Rellena:
   - **Selecciona qué función quieres ejecutar**: `sendReminders`
   - **Selecciona qué implementación se debe ejecutar**: `Principal`
   - **Selecciona la fuente del evento**: `Basado en tiempo`
   - **Selecciona el tipo de activador basado en tiempo**: `Temporizador por minutos`
   - **Selecciona el intervalo de minutos**: `Cada 15 minutos`
4. Pulsa **Guardar**.

(Atajo: en el editor puedes elegir la función **instalarRecordatorios** y pulsar **▶ Ejecutar**; hace exactamente lo mismo.)

## Paso 6 · Pegar la URL en la web (1 minuto)

1. Abre `reservar.html` con el Bloc de notas (clic derecho → **Abrir con** → **Bloc de notas**).
2. Busca esta línea (está casi al principio):
   ```
   const ENDPOINT = 'PEGAR_URL_DE_APPS_SCRIPT';
   ```
3. Sustituye `PEGAR_URL_DE_APPS_SCRIPT` por la URL del paso 4 (deja las comillas) y guarda.
4. El aviso amarillo de "Modo simulación" desaparecerá: la demo ya reserva de verdad.

## Paso 7 · Subir a GitHub y activar GitHub Pages (10 minutos)

No hace falta instalar nada: se hace todo desde el navegador.

1. Entra en <https://github.com> con la cuenta de **booklab.com@gmail.com** (si no existe, pulsa **Sign up** y créala con ese correo).
2. Arriba a la derecha pulsa **+** → **New repository**.
   - **Repository name**: `booklab`
   - Marca **Public**.
   - Marca **Add a README file** (así el repositorio nace con la rama `main`).
   - Pulsa **Create repository**.
3. Dentro del repositorio pulsa **Add file** → **Upload files**.
4. Abre la carpeta `booklab` en tu ordenador, selecciona **todo lo que hay dentro** (Ctrl+A: `index.html`, `demo.html`, `reservar.html`, `config.js`, `README.md`, y las carpetas `assets` y `apps-script`) y arrástralo a la página de GitHub. **No arrastres la carpeta `booklab` entera**: `index.html` tiene que quedar en la raíz.
5. Abajo, en **Commit changes**, pulsa el botón verde **Commit changes**. (Te preguntará si reemplazar el README: sí.)
6. Ve a **Settings** (pestaña de arriba) → en la izquierda **Pages**.
7. En **Build and deployment** → **Source** elige **Deploy from a branch**. En **Branch** elige **main** y la carpeta **/ (root)**. Pulsa **Save**.
8. Espera 1–2 minutos y recarga. Arriba saldrá **"Your site is live at https://getbooklab.com/"**. Esa es la dirección de la web; la demo está en `https://getbooklab.com/demo.html`.

> Para actualizar la web más adelante: **Add file** → **Upload files**, arrastra los archivos cambiados y **Commit changes**. En un minuto se ve el cambio.

> **Dominio propio:** la web está en **https://getbooklab.com** (comprado en Spaceship). En Spaceship → **DNS avanzado** hay 4 registros `A` de `@` a `185.199.108.153`, `185.199.109.153`, `185.199.110.153` y `185.199.111.153`, un `CNAME` de `www` a `booklabcom-dot.github.io` y un `TXT` de verificación de GitHub. No los borres. El archivo `CNAME` del repositorio indica el dominio a GitHub Pages.

## Paso 8 · Probar la reserva desde el móvil (5 minutos)

1. Abre `https://getbooklab.com/demo.html` en el móvil (con datos, no solo wifi, si quieres probar como un cliente).
2. Pulsa **Aparta tu cita** → elige servicio → barbero → día y hora → rellena tus datos con un correo tuyo de prueba (por ejemplo, el propio booklab.com@gmail.com) → marca **He leído y acepto la política de cancelación** → **Confirmar reserva**.
3. Comprueba que:
   - Sale la pantalla **¡Cita reservada!**
   - En Google Calendar (cuenta booklab.com@gmail.com) aparece la cita en el calendario del barbero.
   - Llega el correo de confirmación y la invitación de Calendar (mira también en **Spam**).
   - Si vuelves a la demo y eliges el mismo barbero y día, **esa hora ya no aparece**.
4. Prueba los botones **Añadir a Google Calendar** y **Copiar resumen de la cita** (pégalo en Notas para ver el resumen).
5. Borra la cita de prueba en Google Calendar cuando acabes.

---

## Cómo se gestiona la agenda en el día a día

- **Bloquear un rato** (comida, médico…): crea un evento normal en el calendario del barbero. Esa franja deja de ofrecerse.
- **Bloquear un día entero** (vacaciones, festivo): crea un evento de **Todo el día**.
- **Cancelar una cita**: bórrala del calendario. La hora vuelve a quedar libre. (Avisa tú al cliente: Google no le escribe solo.)
- **Que cada barbero vea su agenda en su propio móvil**: en el calendario del barbero → **Configuración y uso compartido** → **Compartir con determinadas personas o grupos** → **Añadir personas y grupos** → su correo → permiso **Hacer cambios en eventos**.
- **Correo de reseña**: 1 hora después de acabar cada cita, el cliente recibe "¿Qué tal ese corte?" con un botón para dejar reseña en Google. Lo envía el mismo activador de los recordatorios.
- **Enlace de reseñas de Google**: busca la barbería en Google Maps → **Reseñas** → **Escribir una reseña** → copia la dirección de la página (o usa **Compartir** desde el perfil de empresa de Google). Pégala en `config.js` → `resenas.enlace` y en Code.gs → `ENLACE_RESENAS` (en el editor de Apps Script; después **Gestionar implementaciones** → **Nueva versión**). Si lo dejas vacío, se abre la búsqueda de la barbería en Google Maps.
- **Nota y reseñas de la web**: se cambian a mano en `config.js` → `resenas` (nota, número de reseñas y 2 o 3 reseñas copiadas de Google). Pon `ejemplo: false` cuando sean reales.
- **Límites de Gmail gratis**: unos 100 correos al día. Para una barbería suele sobrar; si se queda corto, se puede pasar a Google Workspace.

---

## Cómo clonar la web para otra barbería

1. Copia la carpeta `booklab` entera y ponle el nombre de la barbería (por ejemplo `barberia-paco`).
2. Abre `config.js` y cambia **solo** lo que necesites:
   - `negocio`: `nombre` real (y `esMarcador: false` para que no salga entre comillas), `eslogan`, `direccion`, `telefono`, `instagram` (sin la @) y, si quieres, el enlace exacto de Google Maps en `mapa`.
   - `web`: las fotos (`portada`, `fotosLocal`, `galeria`; ahora llevan fotos de ejemplo de Unsplash en blanco y negro) y el texto de **Quiénes somos**. Una foto vacía (`''`) sale como hueco "Tu foto aquí".
   - `servicios`: nombre, descripción, duración y precio. Cada `id` sin espacios ni tildes (ej. `corte-nino`).
   - `barberos`: deja siempre el primero (`any`, "Cualquiera") y cambia el resto. Cada uno puede llevar `foto`.
   - `horario`: 1 = lunes … 7 = domingo; `[]` = cerrado; varios tramos: `[['09:00','14:00'], ['16:00','20:30']]`.
   - `reglas`: `intervaloMinutos` (ahora 30), antelación mínima, días máximos…
   - `textos`: subtítulo (quita lo de "DEMO"), texto del botón, política de cancelación, resumen copiable…
3. Mete las fotos de la barbería en `assets/img/` y pon su ruta en `config.js` (por ejemplo `'assets/img/local.webp'`). Mejor en formato WebP y de menos de 150 KB (puedes convertirlas gratis en <https://squoosh.app>).
4. Abre `apps-script/Code.gs` y pon **lo mismo** al principio: `NOMBRE_BARBERIA`, `DIRECCION`, `TELEFONO_BARBERIA`, `SERVICIOS`, `BARBEROS` (con los IDs de sus calendarios), `HORARIO` e `INTERVALO_MINUTOS`. **Los `id` tienen que coincidir exactamente con los de `config.js`.**
5. Repite los pasos 1 a 8 con la cuenta de Google de esa barbería (sus calendarios, su proyecto de Apps Script, su repositorio).
6. Para la web de un cliente real, renombra `demo.html` a `index.html` (y borra la landing de Book Lab), y en `reservar.html` y `demo.html` quita la barra de arriba que dice "Demo".

---

## Resumen de marcadores pendientes

| Dónde | Qué buscar | Qué poner |
|---|---|---|
| `apps-script/Code.gs` | `PEGAR_ID_CALENDARIO_MARCOS` | ID del calendario de Marcos (paso 1) |
| `apps-script/Code.gs` | `PEGAR_ID_CALENDARIO_LUCIA` | ID del calendario de Lucía (paso 1) |
| `apps-script/Code.gs` | `PEGAR_ID_CALENDARIO_DIEGO` | ID del calendario de Diego (paso 1) |
| `reservar.html` | `PEGAR_URL_DE_APPS_SCRIPT` | URL `/exec` de la aplicación web (paso 4) — **ya está puesta** |
| Este README | `TU_USUARIO` | Tu nombre de usuario de GitHub (paso 7) — **ya está: booklabcom-dot** |
