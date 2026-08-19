# Nómina y Finanzas Construacero Carabobo

Aplicación independiente para gestionar nómina, asistencia, pagos y finanzas de Construacero Carabobo C.A. El paquete no monta cotizaciones, inventario, clientes, despachos ni la ficha de Personal del POS.

**Estado de entrega:** frontend/API base publicados en `https://nomina-construacero.vercel.app`; esta revisión añade Finanzas y el guard de rol único. Las migraciones 221–223 fueron aplicadas directamente en el proyecto Supabase indicado y verificadas con la CLI y una consulta de contrato.

## Alcance entregado

- Empleados personales sincronizados por cuenta, sin duplicar el módulo Personal.
- Configuración de salario diario, cargo, jornada y horarios.
- Asistencia manual y masiva con bloqueo de períodos cerrados.
- Marcaje de entrada/salida administrativo con hora del servidor e idempotencia.
- Feriados y horarios selectivos/rotativos por cuenta.
- Períodos semanales, quincenales y mensuales.
- Cálculo de horas normales, extras, sábados, feriados, bonos y deducciones.
- Cierre, reapertura controlada, pago parcial/total y reversión auditada.
- Recibos y planilla PDF.
- Configuración administrativa de feriados, horarios rotativos, conceptos, reglas legales versionadas y snapshots de tasas.
- RLS, guardrails de tenant, límites de body, CORS explícito y headers de seguridad.
- UI responsive alineada con Construacero: login premium, drawer móvil, sidebar desktop, navegación táctil y tarjetas móviles para historial.
- Un único rol operativo `administracion`, con acceso integral a Nómina, marcaje y Finanzas; roles heredados quedan bloqueados server-side.
- Libro financiero con ingresos, egresos, categorías, tasas congeladas, resumen por rango, CSV de la página actual y anulación auditada sin borrado.

## Inicio local

Requisitos: Node.js 22+, un proyecto Supabase de pruebas y Wrangler si se desea ejecutar el Worker local.

```bash
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run check:project
npm run lint
npm test
npm run build
npm run dev
```

`npm run dev` levanta Vite y el Worker local. La aplicación usa `/api/*` same-origin; `VITE_WORKER_ORIGIN` solo es necesario cuando el Worker vive en otro dominio. Para Vercel, `vercel.json` compila `dist` y reescribe todas las rutas anidadas `/api/*` hacia `api/index.js`, que adapta las mismas rutas del Worker a una función serverless.

No uses `npm run dev:vite` para probar el flujo completo: ese comando solo levanta la interfaz y el proxy espera un Worker en `localhost:8788`. Si `/api/auth/switch-operator` responde 401 en local, copia `.dev.vars.example` a `.dev.vars`, configura las claves del proyecto Supabase y ejecuta `npm run dev`; ese 401 significa que el Worker no pudo validar la sesión, no que el PIN sea incorrecto. El modal bloquea los envíos duplicados mientras verifica el PIN. El logout del navegador usa alcance local y limpia el cache aunque Supabase no pueda revocar un refresh token vencido. Para activar trazas de autenticación únicamente durante diagnóstico local, define `VITE_AUTH_DEBUG=true`; permanece desactivado por defecto.

## Variables y secretos

### Frontend (`.env`)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WORKER_ORIGIN` opcional

### Worker (`.dev.vars` o secretos del proveedor)

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY` — **solo Worker; nunca frontend, repositorio ni logs**
- `NOMINA_TIMEZONE` — por defecto `America/Caracas`
- `NOMINA_ALLOWED_ORIGINS` — lista exacta separada por comas
- `ENABLE_DEV_MASTER_PIN=false`

Las plantillas no contienen credenciales. El guardrail `npm run check:project` comprueba que no haya secretos conocidos, imports fuera del paquete ni migraciones ausentes.

## Operación en Supabase Free y control de egress

La app está diseñada para el plan gratuito actual de Supabase: **5 GB de egress y 5 GB de cached egress**, con 500 MB de base de datos. Verificar siempre la cuota vigente en [Supabase Pricing](https://supabase.com/pricing).

Guardrails aplicados:

- El frontend no consulta tablas de nómina directamente; el Worker concentra las lecturas y mantiene el tenant.
- Las respuestas de lectura usan `select` explícito; el guardrail rechaza `select=*` y límites de 1000 filas.
- El Worker/Vercel mantiene un caché de respuestas acotado a 2 MB, con entradas máximas de 512 KB y TTL corto por ruta; cualquier POST lo invalida.
- React Query persiste datos en IndexedDB, no revalida al cambiar de ventana y no reintenta automáticamente las lecturas fallidas.
- No existe polling automático de marcaje; la actualización es manual o al abrir la vista.
- Los PDFs se generan en el navegador y no se almacenan en Supabase Storage.

Presupuesto operativo recomendado: mantener el consumo por debajo de **100 MB/día** y **3 GB/mes**, dejando margen para picos. Revisar Usage al menos diariamente; detener exportaciones/rangos innecesarios si el proyecto supera 4 GB mensuales.

## Supabase nuevo: orden obligatorio

Este paquete debe instalarse en un proyecto Supabase independiente del POS. Aplicar las migraciones en orden:

1. `001_nomina_base_contract.sql`
2. `208` a `219` en orden numérico
3. `220_nomina_integrity_guardrails.sql`
4. `221_finanzas_movimientos.sql`
5. `222_finanzas_admin_role_guard.sql`
6. `223_finanzas_resumen_filtros.sql`

El lote crea operadores, configuración de cuenta, empleados sincronizados, nómina, asistencia, calendarios, conceptos, reglas legales, tasas, auditoría, Finanzas y RLS. La migración 222 bloquea altas/cambios de roles distintos de `administracion`; la bandera `nomina_v2_enabled` permanece apagada por defecto.

### Contrato de empleados

Personal → Nómina debe sincronizar únicamente:

- `id_externo`
- `cuenta_id`
- `nombre`
- `documento` opcional
- `activo`
- `tipo_cliente = 'personal'`

Nómina no debe editar ni borrar la ficha de Personal. El endpoint `/api/nomina/empleados` solo devuelve la identidad mínima y nunca salarios.

### Seguridad de tenant

El Worker usa service role para operaciones de negocio, pero cada handler exige un operador activo `administracion`, resuelve `cuenta_id`, filtra todas las consultas y registra auditoría. Las migraciones 220–223 agregan FKs, triggers, RLS financiera, el guard de rol único y filtros de resumen financiero. RLS es una segunda barrera, no un reemplazo del filtro del Worker.

## CI y definición de listo

El workflow de CI ejecuta:

```bash
npm run check:project
npm run lint
npm test
npm run build
```

El paquete está **listo para conectar** cuando se entreguen únicamente:

1. URL, anon key y service role del Supabase nuevo;
2. operadores y PINs creados mediante el procedimiento seguro del entorno;
3. contrato de sincronización de Personal;
4. dominios finales para CORS y assets;
5. fuente aprobada de BCV/Euro/USDT y reglas legales vigentes;
6. repositorio destino y secretos de despliegue.

El flag `nomina_v2_enabled` permanece apagado hasta completar las pruebas funcionales directas contra el proyecto enlazado, la validación de RLS y la aprobación contable. Para operación, rollback y rotación de secretos, ver `docs/OPERACIONES.md`, `docs/PLAN_MAESTRO.md` y `docs/AUDITORIA_FINAL.md`.
