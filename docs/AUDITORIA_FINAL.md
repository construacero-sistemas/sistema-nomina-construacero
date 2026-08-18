# Auditoría final — Nómina y Finanzas Construacero Carabobo

**Corte:** 2026-08-17  
**Alcance:** frontend React/Vite, Worker, handlers REST, autenticación, aislamiento multi-tenant, motores de cálculo, migraciones Supabase, PDFs, configuración y pruebas.

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
| RLS permisivo de logística exponía filas salariales por acceso directo | Las políticas `SELECT` daban columnas completas de configuración/líneas | Logística usa el Worker; RLS directo elimina salario, períodos y líneas salariales |
| `get_rol_actual()` confiaba primero en `operator_rol` del JWT | Metadata antigua podía mantener permisos tras desactivar el operador | El rol se resuelve desde `usuarios` dentro de la cuenta; solo el operador virtual es excepción |
| La plantilla `.env` mezclaba variables privadas del Worker | Podía inducir a copiar la service key al entorno de Vite | `.env.example` solo contiene `VITE_*`; secretos quedan en `.dev.vars.example` |
| Un marcaje podía perder el feriado configurado | Entrada operativa fijaba `es_feriado=false` | El Worker consulta el calendario del tenant y congela el flag |
| Una asistencia podía declarar un feriado inexistente | El cliente controlaba el booleano | El Worker exige que el feriado exista en calendario cuando se marca manualmente |
| Referencias SQL de tenant quedaban a cargo exclusivo del código | Service role omite RLS | Migración 220 añade FKs, checks y triggers de consistencia entre cuenta, empleado, período, línea, concepto y tasa |
| Plantilla de entorno contenía marcadores duplicados | `.env.example` tenía dos líneas `[TEMPLATE]` | Plantilla única, sin secretos reales |

## Auditoría UI/UX y responsive

Se comparó el login, splash, navegación y componentes de nómina con `construacero-staging`.

- El login conserva la composición dark premium, logo, tarjetas por operador, flujo email/contraseña → operador → PIN y modal numérico táctil.
- El splash usa el logo corporativo y el loader cuadrado animado del proyecto de referencia.
- El shell de nómina incorpora barra superior, logo móvil, drawer lateral móvil, sidebar desktop colapsable, perfil/rol y navegación inferior táctil.
- El historial pagado usa tabla completa en escritorio y tarjetas accionables en móvil para evitar columnas comprimidas.
- La grilla semanal mantiene scroll horizontal controlado porque sus siete días requieren ancho mínimo; el nombre del empleado queda fijo al desplazarse.
- Los modales conservan foco, cierre con Escape, scroll interno, límite de altura y `safe-area-inset-bottom`.
- Tailwind ahora escanea `compat/`, activa modo oscuro por clase y genera `scrollbar-hide`, evitando estilos visuales faltantes en componentes puente.
- Se agregaron etiquetas ARIA para navegación, tabs, loader, drawer, paneles y acciones móviles.

Pendiente de validación manual en dispositivos físicos: Safari iOS, Chrome Android y una pantalla desktop de 1366 px. La suite automatizada valida el contrato estructural y el build, pero no sustituye una prueba visual con datos reales.

## Guardrails entregados

- `npm run check:project`: estructura, archivos críticos, variables, migraciones, `.gitignore`, imports fuera del paquete y patrones de secretos.
- `.github/workflows/ci.yml`: guardrail, lint, suite y build en push/PR.
- CORS por allowlist exacta y `Vary: Origin`.
- `X-Content-Type-Options`, `X-Frame-Options`, CSP, Referrer-Policy, Permissions-Policy y HSTS en HTTPS.
- Auth de operador con PIN PBKDF2 en Worker; hashes y salts no se envían al navegador.
- Matriz de roles con logística sin acceso salarial.
- Caché de egress acotado por fingerprint de sesión/operador/origen, con expiración y limpieza global tras mutaciones.
- Proyecciones SQL explícitas, límites de 500 filas y prohibición automatizada de `select=*`/límite 1000.
- React Query persistido, sin refetch por foco ni retries automáticos; PDFs generados localmente.
- Tests de body inválido, UUID, fechas, tenant, permisos, idempotencia, calendario, tasas, reglas, conciliación, ciclo de pagos y caché de egress.

## Evidencia ejecutada

```text
npm run check:project  -> OK
npm run lint           -> OK (0 errores; warnings heredados no bloqueantes)
npm test               -> 19 archivos, 211 tests aprobados
npm run build          -> OK
supabase db push       -> remoto al día; 001 y 208–220 local=remoto
Vercel producción      -> Ready; https://nomina-construacero.vercel.app
```

El build mantiene un warning informativo de chunks PDF grandes; no es un fallo funcional. Los PDFs se cargan con `import()` al abrir el detalle para no bloquear el shell inicial.

## Riesgos residuales explícitos

1. El esquema remoto está migrado, pero RLS y el flujo completo todavía deben probarse contra datos reales con dos tenants y los cuatro roles.
2. Las fuentes BCV, Euro y USDT y las reglas legales requieren aprobación del negocio antes de activar cierres.
3. El contrato de sincronización de Personal debe tener un proceso real y un responsable de reconciliación.
4. El lockfile local fue generado para este paquete y el CI usa `npm ci`; si el repositorio destino cambia de package manager debe conservar un lockfile equivalente y actualizar el workflow.
5. Vercel está publicado, pero GitHub aún no contiene la extracción porque la cuenta autenticada recibió HTTP 403 al hacer push.
6. Las credenciales usadas para el despliegue viven fuera del repositorio y deben rotarse si fueron compartidas fuera del gestor seguro.
7. El plan Free tiene una cuota de egress finita: Usage debe revisarse diariamente y el objetivo interno es 100 MB/día y 3 GB/mes; el caché en memoria no persiste entre reinicios o escalado.

## Decisión de salida

El código está publicado en Vercel y el esquema remoto está al día. No debe declararse la nómina operativa como producción hasta cerrar los riesgos residuales mediante staging, respaldo/restauración, prueba de dos tenants, aprobación contable y publicación del repositorio con una cuenta autorizada.
