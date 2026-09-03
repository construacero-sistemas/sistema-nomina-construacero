# Reglas del proyecto Nómina Construacero

## Regla obligatoria de responsividad total (con prioridad absoluta en iPhone / iOS)

Toda pantalla, vista, modal, tabla, formulario, selector, navegación y componente nuevo o modificado debe ser **100% responsivo**, con **prioridad absoluta y optimización de primera clase para iPhone / iOS** (Safari WebKit, PWA y navegación móvil táctil), además de Android, tablets y escritorio:

1. **Cero desplazamiento horizontal accidental**: Toda la interfaz debe adaptarse a anchos desde 360 px sin desbordes (`overflow-x-hidden` global y scrolls horizontales encapsulados solo en tablas o carruseles específicos).
2. **Respeto a Safe Areas de Apple**: Integración estricta con el notch, dynamic island y home indicator (`env(safe-area-inset-bottom)`, `pb-safe`, `pt-safe`). Ningún botón, navegación o acción crítica puede quedar tapado.
3. **Prevención de zoom involuntario en Safari iOS**: Los campos de texto, inputs y selectores deben evitar que Safari haga zoom automático al enfocar (`text-[16px]` o escala apropiada).
4. **Área táctil mínima (Touch Targets) y Viewports Dinámicos**: Todo botón y control debe tener al menos 44 px de altura útil para pulsación táctil ergonómica, usando unidades dinámicas `100dvh` / `h-dvh`, `overscroll-contain` y `-webkit-overflow-scrolling: touch`.
5. **Modales y Bottom Sheets adaptados**: En móvil los modales deben actuar como hojas inferiores deslizables (`rounded-t-3xl`), con encabezados claros, botón de cierre cómodo con una sola mano y botones de confirmación accesibles sin ser bloqueados por el teclado virtual.
6. **Validación visual obligatoria**: Toda modificación debe validarse en resoluciones de iPhone (375x667, 390x844, 430x932) y escritorio.

## Regla obligatoria de fecha y hora

La fecha y hora visibles en la aplicación deben usar el formato amigable del sistema: día de la semana abreviado, día, mes abreviado y hora de 12 horas con minutos y segundos, por ejemplo: **Lun, 24 ago. · 1:59:30 p. m.**. Debe respetarse la zona horaria configurada del negocio.

## Registro obligatorio de reglas

Toda instrucción del usuario que se exprese como una **regla** debe documentarse en este archivo y en `docs/BITACORA_PROYECTO.md` dentro del mismo cambio. La regla debe mantenerse vigente hasta que el usuario solicite explícitamente modificarla o eliminarla.

## Regla obligatoria de moneda principal

La moneda primaria de todo el sistema es **USD ($)**. Los importes deben presentarse primero en dólares; la conversión a bolívares se muestra como equivalente usando la tasa elegida y conservando la tasa aplicada en cada registro. No se debe presentar VES como moneda principal salvo que el usuario lo solicite explícitamente.

## Bitácora obligatoria

Después de **cada cambio**, sin excepción, se debe actualizar `docs/BITACORA_PROYECTO.md` con:

- fecha;
- objetivo del cambio;
- archivos afectados;
- comportamiento añadido o corregido;
- pruebas ejecutadas y resultado;
- pendientes o validaciones externas.

No se considera terminado ningún cambio si la bitácora no fue actualizada en el mismo turno. La bitácora debe registrar también correcciones pequeñas, cambios de configuración, pruebas y documentación.

## Regla obligatoria de iconos profesionales

Todos los iconos visibles en la interfaz deben ser **iconos vectoriales limpios y profesionales** de la librería `lucide-react`. Está **estrictamente prohibido usar emojis de texto o caracteres Unicode gráficos** (como 🏢, 🇻🇪, 📍, 🏦, 📱, 💵, 🌐, 📋, 💳, ✨, 🎭, 👷, ⚔️, etc.) en botones, badges, filtros, presets, opciones de selector, tablas o modales. Todo icono debe ser un componente SVG de Lucide con tamaño adecuado, color temático y renderizado nítido.

## Regla obligatoria de dropdowns y selectores redondeados

Todos los dropdowns, selectores (`CustomSelect`), menús contextuales, popovers, desplegables de tasas y filtros flotantes deben tener **bordes redondeados modernos** (`rounded-xl` o `rounded-2xl`), sombras suaves y pulidas (`shadow-xl` o `shadow-2xl`), espaciado interno ergonómico (`p-1.5` / `p-2`) y elementos/opciones internos con esquinas redondeadas (`rounded-xl` o `rounded-lg`). **Nunca deben ser cuadrados ni rígidos** (prohibido `rounded-none`, `rounded-sm` o cajas toscas sin radio de curvatura).

## Regla obligatoria de prevención y erradicación del scroll horizontal

Queda **estrictamente prohibido el scroll horizontal innecesario o accidental** en toda la interfaz (páginas, modales, formularios, tarjetas, vistas, barras de navegación, botones, filtros, selectores y contenedores):

1. **Flex-Wrap y Grids Adaptables**: Todo conjunto de botones, pestañas, filtros rápidos y badges debe usar envoltura automática (`flex-wrap`, `grid`, `gap-1.5`, `min-w-0`, `max-w-full`), adaptándose de forma natural al ancho de cualquier teléfono móvil (iPhone / Android) sin generar barras ni deslizamientos laterales.
2. **Tablas y Matrices Extensas**: El desplazamiento horizontal (`overflow-x-auto`) queda **estrictamente restringido** única y exclusivamente al contenedor interno de tablas o matrices de datos con muchas columnas financieras que no quepan físicamente en el ancho del dispositivo (como la planilla detallada de asistencia o la tabla de movimientos contables), debiendo estar siempre encapsulado sin desplazar la pantalla.
3. **Cero Desbordes Globales**: Los contenedores deben usar `w-full`, `max-w-full`, `box-border` y `truncate`/`break-words` para textos largos, garantizando que el usuario nunca experimente desbordes horizontales involuntarios.

## Calidad y seguridad

- Ejecutar `npm run verify` después de cambios no triviales.
- No introducir secretos en el repositorio.
- Mantener la autorización server-side y el aislamiento por cuenta.
- No usar `<select>` nativo en JSX; usar el selector visual compartido (`CustomSelect`).
- Garantizar que los dropdowns y selects sean redondeados y profesionales.
- No cachear respuestas `/api/*` en el service worker.
- No hacer commit, push o deploy salvo solicitud explícita.
- Mantener los textos de la interfaz claros y sin tecnicismos innecesarios.
- Regla de notificaciones: todo toast o aviso temporal debe desaparecer automáticamente; nunca puede quedar fijado esperando que el usuario lo cierre. El cierre manual solo es una opción adicional.

## Regla obligatoria: cero diálogos nativos del navegador

Está **estrictamente prohibido** usar `window.confirm()`, `window.alert()` o `window.prompt()` en cualquier componente JSX (`src/` y `compat/`). Bloquean el hilo de la UI, no se pueden estilizar y rompen la experiencia móvil. Toda confirmación o mensaje debe usar los modales/toasts existentes del proyecto (patrón `Modal` + botones Cancelar/Confirmar, como `AnularDialog`).

**Guardrail:** la sección 9 de `npm run test:responsive` escanea todos los JSX y falla si aparece `confirm(`, `alert(` o `prompt(`.

## Regla obligatoria: touch targets ≥ 44 px

Todo botón, input, pestaña y control interactivo debe tener al menos **44 px de altura útil** (o un wrapper con padding que garantice esa caja táctil). Prohibido `h-9`/`h-10` en elementos interactivos; usar `h-11` o superior.

**Guardrail:** la sección 10 de `npm run test:responsive` detecta `h-9`/`h-10` en `<button>`/`<input>` y falla.

## Regla obligatoria: sin catch vacío en server/

Todo `try/catch` en `server/` debe hacer algo visible: registrar auditoría (`registrarAuditoria`), loguear por el logger del proyecto, o re-lanzar. Un catch que traga el error en silencio produce descuadres invisibles (ej. nómina pagada sin asiento financiero).

## Regla obligatoria: sin console.log directo en src/
El código de frontend no debe llamar `console.log` directamente; usar `logClientError` / el logger compartido (`compat/utils/errorLogger.js`). `console.error`/`console.warn` solo dentro del propio logger.

## Regla obligatoria: motivo obligatorio en todo movimiento financiero

Todo movimiento financiero (ingreso o egreso) debe registrarse **con su motivo/concepto descriptivo** — sin él no se puede saber al final de mes de dónde provienen los ingresos ni a qué corresponden los egresos. Reglas mínimas:

- El campo concepto es obligatorio en el formulario (Marcado con *, mínimo 3 caracteres, máximo 180).
- El servidor (`normalizeMovement` en `server/lib/finanzasUtils.js`) rechaza cualquier movimiento sin concepto o con menos de 3 caracteres — es la última barrera aunque el cliente falle.
- Los movimientos automáticos (nómina, POS, traspasos) generan un concepto trazable que identifica origen, período y método.

**Guardrail:** tests en `server/lib/__tests__/finanzasUtils.test.js` y `src/components/finanzas/__tests__/MovimientoForm.test.jsx`.

## Regla obligatoria: presupuesto de bundle inicial
El chunk `index-*.js` tras `vite build` no debe superar **400 kB**. Nuevas vistas pesadas deben cargarse con `React.lazy()`; las librerías grandes (jspdf, html2canvas) solo mediante `await import()` dinámico dentro de la función que las usa.

**Guardrail:** `npm run test:bundle-size` (parte de `npm run verify`) falla si se supera el presupuesto.

## Regla obligatoria: paginación en modales con listados o tablas de muchas columnas

En todo modal, diálogo o ventana emergente donde se listen, guarden, editen o consulten múltiples registros, filas o conjuntos de datos con muchas columnas de información (como detalles de recibos, asignaciones, historial de movimientos, comprobantes, etc.):

1. **Paginación obligatoria**: Debe implementarse un control de paginación claro y ergonómico (número de página, botones «Anterior» / «Siguiente», indicador de total de páginas o selector de tamaño de página) para evitar desbordar verticalmente el modal y proteger el rendimiento en dispositivos móviles.
2. **Límite de registros por vista**: Las filas deben presentarse en bloques acotados y manejables (generalmente entre 5 y 15 filas por página según la densidad de las columnas), evitando listas infinitas que fuercen scroll desmedido dentro del modal.
3. **Ergonomía táctil y diseño responsivo**: Los botones de cambio de página deben respetar el touch target de al menos 44 px de altura (`h-11`), mostrar el estado activo/deshabilitado con nitidez y adaptarse sin desbordes horizontales tanto en pantallas móviles (iPhone / Android) como en escritorio.

