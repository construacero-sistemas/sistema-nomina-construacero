# Auditoría final — Nómina Construacero

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

## Guardrails entregados

- `npm run check:project`: estructura, archivos críticos, variables, migraciones, `.gitignore`, imports fuera del paquete y patrones de secretos.
- `.github/workflows/ci.yml`: guardrail, lint, suite y build en push/PR.
- CORS por allowlist exacta y `Vary: Origin`.
- `X-Content-Type-Options`, `X-Frame-Options`, CSP, Referrer-Policy, Permissions-Policy y HSTS en HTTPS.
- Auth de operador con PIN PBKDF2 en Worker; hashes y salts no se envían al navegador.
- Matriz de roles con logística sin acceso salarial.
- Tests de body inválido, UUID, fechas, tenant, permisos, idempotencia, calendario, tasas, reglas, conciliación y ciclo de pagos.

## Evidencia ejecutada

```text
npm run check:project  -> OK
npm run lint           -> OK (0 errores; warnings heredados no bloqueantes)
npm test               -> 17 archivos, 203 tests aprobados
npm run build          -> OK
```

El build mantiene un warning informativo de chunks PDF grandes; no es un fallo funcional. Los PDFs se cargan con `import()` al abrir el detalle para no bloquear el shell inicial.

## Riesgos residuales explícitos

1. No se ejecutó `supabase db push`: no hay credenciales ni aprobación para tocar un proyecto remoto.
2. No se verificó RLS contra una instancia real; los tests usan fetch mock y el SQL debe probarse en staging.
3. Las fuentes BCV, Euro y USDT y las reglas legales requieren aprobación del negocio antes de activar cierres.
4. El contrato de sincronización de Personal debe tener un proceso real y un responsable de reconciliación.
5. El lockfile local fue generado para este paquete y el CI usa `npm ci`; si el repositorio destino cambia de package manager debe conservar un lockfile equivalente y actualizar el workflow.
6. No se hizo deploy ni se crearon ramas/commits/remoto; esas acciones corresponden al propietario del repositorio.

## Decisión de salida

El código está listo para recibir variables y un Supabase nuevo. No debe declararse producción hasta cerrar los cinco riesgos residuales mediante staging, respaldo/restauración, prueba de dos tenants y aprobación contable.
