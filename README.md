# Nómina Construacero

Aplicación independiente para gestionar nómina, asistencia y pagos de Construacero. El paquete no monta cotizaciones, inventario, clientes, despachos ni la ficha de Personal del POS.

## Alcance entregado

- Empleados personales sincronizados por cuenta, sin duplicar el módulo Personal.
- Configuración de salario diario, cargo, jornada y horarios.
- Asistencia manual y masiva con bloqueo de períodos cerrados.
- Marcaje de entrada/salida para logística con hora del servidor e idempotencia.
- Feriados y horarios selectivos/rotativos por cuenta.
- Períodos semanales, quincenales y mensuales.
- Cálculo de horas normales, extras, sábados, feriados, bonos y deducciones.
- Cierre, reapertura controlada, pago parcial/total y reversión auditada.
- Recibos y planilla PDF.
- Conceptos, reglas legales versionadas y snapshots de tasas.
- RLS, guardrails de tenant, límites de body, CORS explícito y headers de seguridad.

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

`npm run dev` levanta Vite y el Worker local. La aplicación usa `/api/*` same-origin; `VITE_WORKER_ORIGIN` solo es necesario cuando el Worker vive en otro dominio.

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
- `ENABLE_DEVELOPER_ACCESS=false`

Las plantillas no contienen credenciales. El guardrail `npm run check:project` comprueba que no haya secretos conocidos, imports fuera del paquete ni migraciones ausentes.

## Supabase nuevo: orden obligatorio

Este paquete debe instalarse en un proyecto Supabase independiente del POS. Aplicar las migraciones en orden:

1. `001_nomina_base_contract.sql`
2. `208` a `219` en orden numérico
3. `220_nomina_integrity_guardrails.sql`

El lote crea operadores, configuración de cuenta, empleados sincronizados, nómina, asistencia, calendarios, conceptos, reglas legales, tasas, auditoría y RLS. La bandera `nomina_v2_enabled` permanece apagada por defecto.

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

El Worker usa service role para operaciones de negocio, pero cada handler exige un operador activo, resuelve `cuenta_id`, filtra todas las consultas y registra auditoría. La migración 220 agrega FKs y triggers que rechazan enlaces entre cuentas. RLS es una segunda barrera, no un reemplazo del filtro del Worker.

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

No ejecutar `supabase db push`, `wrangler deploy` ni configurar secretos de producción sin la aprobación del propietario del proyecto. Ver `docs/OPERACIONES.md`, `docs/PLAN_MAESTRO.md` y `docs/AUDITORIA_FINAL.md`.
