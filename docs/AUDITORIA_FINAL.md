# Auditoría final — Nómina y Finanzas Construacero Carabobo

**Corte:** 2026-08-18

**Alcance:** auditoría E2E determinista de frontend React/Vite, Worker, API/Vercel, autenticación, tenant/RLS, motores de cálculo, Finanzas, migraciones Supabase, PDFs, configuración y pruebas.

## Hallazgos reproducibles y correcciones

| Hallazgo | Evidencia | Corrección |
|---|---|---|
| Una edición salarial negativa dejaba la respuesta sin fila y rompía la expectativa del flujo | Test de validaciones fallaba con `Cannot read properties of null` | La edición normaliza valores numéricos negativos a `0`; valores no numéricos siguen rechazados |
| La UI de empleados llamaba `/api/clientes`, ruta que no existe en el Worker independiente | La configuración nueva no podía listar personal | Se añadió `/api/nomina/empleados`, filtrado por cuenta y tipo personal; la UI usa ese contrato |
| La auditoría se insertaba sin `cuenta_id` | La tabla de contrato permite el campo y los handlers ya conocían el tenant | `registrarAuditoria` y sus llamadas ahora persisten la cuenta |
| El caché de operador se indexaba solo por UUID | Un isolate podía reutilizar contexto si el mismo operador cambiaba de cuenta | La clave incluye `cuenta_id`; la invalidación cubre claves compuestas |
| Errores upstream podían exponerse al cliente | `validateOperator` devolvía status y texto de Supabase | Se registra detalle solo en logs y se responde mensaje genérico |
| Configuración devolvía cualquier columna futura | El endpoint copiaba la fila completa y borraba solo hashes conocidos | Proyección explícita por rol y segunda allowlist para logística |
| La lista de empleados transportaba RIF y teléfono sin necesidad operativa | El selector solo necesita UUID, nombre y tipo | La proyección se redujo a identidad mínima |
| Límite de body dependía de `Content-Length` | Requests chunked podían eludirlo | Se inspecciona el clone del stream hasta 256 KiB |
| Un lote de pago podía omitir UUIDs no visibles y reportar pagos parciales | El PATCH se ejecutaba aunque PostgREST devolviera menos filas | Se exige cardinalidad completa y actualización condicionada a `pagado=false` |
| RLS permisivo de roles heredados exponía filas salariales por acceso directo | Las políticas `SELECT` daban columnas completas de configuración/líneas | El único rol válido es administración; roles heredados se desactivan y reciben 403 |
| `get_rol_actual()` confiaba primero en `operator_rol` del JWT | Metadata antigua podía mantener permisos tras desactivar el operador | El rol se resuelve desde `usuarios` dentro de la cuenta; solo `administracion` es válido y no existe bypass virtual |
| La plantilla `.env` mezclaba variables privadas del Worker | Podía inducir a copiar la service key al entorno de Vite | `.env.example` solo contiene `VITE_*`; secretos quedan en `.dev.vars.example` |
| Un marcaje podía perder el feriado configurado | Entrada operativa fijaba `es_feriado=false` | El Worker consulta el calendario del tenant y congela el flag |
| Una asistencia podía declarar un feriado inexistente | El cliente controlaba el booleano | El Worker exige que el feriado exista en calendario cuando se marca manualmente |
| Referencias SQL de tenant quedaban a cargo exclusivo del código | Service role omite RLS | Migración 220 añade FKs, checks y triggers de consistencia entre cuenta, empleado, período, línea, concepto y tasa |
| El autoenvío del PIN podía emitir dos POST en el mismo tick | React actualiza `working` de forma asíncrona y el efecto usa un temporizador | `LoginPinModal` usa un lock síncrono por intento; solo el primer envío llega al Worker |
| Un 401 local podía confundirse con PIN incorrecto | El Worker de Wrangler sin `.dev.vars` no puede validar el JWT | El store distingue errores de sesión local y muestra el comando/configuración accionable; nunca valida el PIN en el navegador |
| El modal de nómina permitía llegar a un formulario sin empleado seleccionable | `clientes` no tenía fichas activas con `tipo_cliente=personal` o todos ya tenían configuración | El modal mantiene Guardar bloqueado, explica el contrato de Personal y permite actualizar la lista; no crea fichas duplicadas |
| Plantilla de entorno contenía marcadores duplicados | `.env.example` tenía dos líneas `[TEMPLATE]` | Plantilla única, sin secretos reales |
| Finanzas no tenía contrato funcional | No existían movimientos, resumen ni anulación server-side | Se añadieron ingresos/egresos con tasa congelada, categorías, paginación, RPC agregado filtrable, idempotencia, anulación auditada y CSV de la página descargada |
| El rol único podía relajarse con una bandera de compatibilidad | `validateOperator` aceptaba `NOMINA_SINGLE_ADMIN_ONLY=false` | Se eliminó el bypass: API y UI solo aceptan `administracion`; migraciones 222–223 bloquean nuevas altas/cambios de otros roles y alinean los filtros del resumen |
| El handler de Nómina superaba el límite de mantenibilidad | `server/handlers/nomina.js` tenía 1.645 líneas | Se convirtió en barrel público y se separó en seis módulos de dominio, todos por debajo de 600 líneas |
| El guardrail no comprobaba el límite de tamaño | El escáner revisaba secretos/estructura pero no líneas | `check:project` rechaza fuentes JS/JSX/CSS/SQL mayores de 600 líneas y mantiene el lockfile generado fuera del alcance |

## Auditoría UI/UX y responsive

Se comparó el login, splash, navegación y componentes de nómina con `construacero-staging`.

- El login conserva la composición dark premium, logo, tarjetas por operador, flujo email/contraseña → operador → PIN y modal numérico táctil.
- El splash usa el logo corporativo y el loader cuadrado animado del proyecto de referencia.
- El shell incorpora barra superior, logo móvil, drawer lateral móvil, sidebar desktop colapsable, perfil administrativo, navegación inferior táctil y acceso a Finanzas solo para administración.
- El historial pagado usa tabla completa en escritorio y tarjetas accionables en móvil para evitar columnas comprimidas.
- La grilla semanal mantiene scroll horizontal controlado porque sus siete días requieren ancho mínimo; el nombre del empleado queda fijo al desplazarse.
- El modal PIN usa una única tarjeta autocontenida, overlay real, teclado numérico centrado, input físico invisible, cierre con Escape, foco accesible, scroll vertical interno sin scroll horizontal y límite de altura; ya no puede descomponerse en elementos sueltos de pantalla completa.
- Tailwind ahora escanea `compat/`, activa modo oscuro por clase y genera `scrollbar-hide`, evitando estilos visuales faltantes en componentes puente.
- El login limita el contenido a una composición central de máximo 1120 px; el branding y el panel de acceso dejan de estirarse por toda la pantalla en monitores grandes.
- El estado sin operadores muestra una tarjeta de configuración pendiente con CTA visible de actualización, explicación de la sesión y contraste suficiente; el error de carga tiene una acción de reintento equivalente.
- La zona de operadores usa tarjetas acotadas por cantidad: un operador queda centrado, dos se distribuyen en dos columnas y varios usan una grilla adaptable; el avatar mantiene tamaño mínimo, el nombre tiene jerarquía legible, el rol usa una insignia equilibrada y el foco de teclado es visible.
- El modal de configuración de nómina explica que la ficha debe existir previamente en Personal, diferencia lista vacía de error de red, ofrece reintento y conserva Guardar bloqueado hasta tener un empleado elegible.
- El acceso por correo y contraseña usa campos identificados, altura táctil de 50 px, iconos separados del texto mediante padding explícito, placeholders legibles, estados de foco visibles, botón de contraseña accesible, validación propia sin tooltip nativo del navegador y un botón de acceso legible incluso cuando está deshabilitado.
- El logout pasa por el store, limpia cache aunque Supabase no responda y usa alcance local para no convertir refresh tokens vencidos en errores 403; los diagnósticos de auth quedan desactivados salvo `VITE_AUTH_DEBUG=true` en desarrollo.
- El cliente identifica un Worker local sin `.dev.vars` y muestra una instrucción accionable en vez de tratarlo como PIN incorrecto.
- Finanzas usa formulario responsive, estados de carga/vacío/error, filtros por rango/tipo/categoría/moneda, KPI de ingresos-egresos-balance, anulación confirmada y exportación CSV limitada a la página ya consultada.
- Nómina incorpora Configuración administrativa para feriados laborables/no laborables, horarios selectivos/rotativos, snapshots manuales de USD/EUR/USDT y alta controlada de conceptos/reglas legales pendientes de aprobación.
- El modal PIN bloquea de forma síncrona el autoenvío mientras la petición está en curso, evitando POST duplicados aun bajo re-render/StrictMode.
- Se agregaron etiquetas ARIA para navegación, tabs, loader, drawer, paneles, estado vacío, campos y acciones móviles.

Pendiente de validación manual en dispositivos físicos: Safari iOS, Chrome Android y una pantalla desktop de 1366 px. La suite automatizada valida el contrato estructural y el build, pero no sustituye una prueba visual con datos reales.

## Guardrails entregados

- `npm run check:project`: estructura, archivos críticos, variables, migraciones, `.gitignore`, imports fuera del paquete y patrones de secretos.
- `.github/workflows/ci.yml`: guardrail, lint, suite y build en push/PR.
- CORS por allowlist exacta y `Vary: Origin`.
- `X-Content-Type-Options`, `X-Frame-Options`, CSP, Referrer-Policy, Permissions-Policy y HSTS en HTTPS.
- Auth de operador con PIN PBKDF2 en Worker; hashes y salts no se envían al navegador.
- Rol único `administracion` en selección, UI, Worker, RLS y trigger SQL; roles heredados se desactivan y reciben 403. La restricción SQL se instala `NOT VALID` para no fallar por históricos, pero bloquea nuevas altas/cambios no administrativos.
- Caché de egress acotado por fingerprint de sesión/operador/origen, con expiración y limpieza global tras mutaciones.
- Proyecciones SQL explícitas, límites de 500 filas y prohibición automatizada de `select=*`/límite 1000.
- React Query persistido, sin refetch por foco ni retries automáticos; PDFs generados localmente.
- Tests de body inválido, UUID, fechas, tenant, permisos, idempotencia, calendario, tasas, reglas, conciliación, ciclo de pagos, auth de operadores, Finanzas (crear/listar/resumir/anular), SQL y smoke E2E del Worker.
- Guardrail de tamaño: 143 archivos de código/configuración inspeccionados; ninguna fuente JS/JSX/CSS/SQL supera 600 líneas.

## Evidencia ejecutada

```text
npm run check:project  -> OK (17 migraciones; 143 archivos inspeccionados)
npm run lint           -> OK
npm test               -> 24 archivos, 340 tests deterministas aprobados
npm run build          -> OK (solo warning informativo de chunks PDF grandes)
git diff --check       -> OK
Supabase               -> `db push` directo aplicado; `migration list` coincide en 001, 208–223 y consulta de contrato confirma tablas con RLS, RPC y trigger
Vercel producción      -> deployment histórico Ready; esta revisión local aún requiere publicación autorizada
```

El build mantiene un warning informativo de chunks PDF grandes; no es un fallo funcional. Los PDFs se cargan con `import()` al abrir el detalle para no bloquear el shell inicial.

## Riesgos residuales explícitos

1. Las migraciones 221–223 ya fueron aplicadas directamente al proyecto indicado y validadas a nivel de esquema; aún debe ejecutarse la conciliación funcional con datos de negocio antes de habilitar operaciones reales.
2. Las fuentes BCV, Euro y USDT y las reglas legales requieren proveedor/aprobación del negocio antes de activar cierres automáticos.
3. El contrato de sincronización de Personal debe tener un proceso real y un responsable de reconciliación.
4. El lockfile local fue generado para este paquete y el CI usa `npm ci`; si el repositorio destino cambia de package manager debe conservar un lockfile equivalente y actualizar el workflow.
5. Vercel contiene el deployment histórico; esta revisión local aún requiere publicación autorizada en GitHub/Vercel.
6. Las credenciales usadas para el despliegue viven fuera del repositorio y deben rotarse si fueron compartidas fuera del gestor seguro.
7. El plan Free tiene una cuota de egress finita: Usage debe revisarse diariamente y el objetivo interno es 100 MB/día y 3 GB/mes; el caché en memoria no persiste entre reinicios o escalado.

## Decisión de salida

El checkout y el esquema Supabase quedan listos para publicación: el código compila, los flujos deterministas pasan, los guardrails están activos y 221–223 ya fueron aplicadas directamente. Esta operación no despliega Vercel; antes de habilitar usuarios reales aún deben completarse conciliación funcional, aprobación contable y revisión de Usage/egress.
