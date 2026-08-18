# Supabase de Nómina y Finanzas Construacero Carabobo

Este directorio pertenece al proyecto independiente de Nómina. El destino informado es `https://wlxcclidnwketrghqaxs.supabase.co` (ref. `wlxcclidnwketrghqaxs`). **No ejecutar estas migraciones en el Supabase del POS.** El paquete actual conserva referencias de compatibilidad a `clientes`, `usuarios`, `configuracion_negocio` y las funciones de autenticación del POS; antes de producción deben sustituirse por el contrato del repositorio nuevo.

## Orden y alcance

`supabase/config.toml` fija el ref. `wlxcclidnwketrghqaxs`; después de autenticar la CLI, `supabase db push` usará ese destino. Aplicar `001_nomina_base_contract.sql` y luego las migraciones `208` a `220` en orden, usando Supabase CLI o el pipeline aprobado. El lote crea:

- configuración y snapshots del empleado;
- asistencia y marcaje operativo idempotente;
- períodos, líneas, cierres, pagos y reversión;
- calendarios de feriados y horarios rotativos;
- conceptos, reglas legales versionadas y snapshots de tasas;
- bandera `nomina_v2_enabled` apagada por defecto;
- guardrails SQL de integridad cross-tenant (migración `220_nomina_integrity_guardrails.sql`).

El Worker usa service role para operaciones de negocio, por lo que cada handler debe conservar el filtro explícito `cuenta_id` y el guard de tenant. RLS no es un sustituto de ese filtro.

## Límite de egress del plan Free

El plan Free actual incluye 5 GB de egress y 5 GB de cached egress. La aplicación mantiene un objetivo interno de 100 MB diarios y 3 GB mensuales. El Worker proyecta columnas explícitamente, limita lecturas de nómina a 500 filas, cachea respuestas de lectura en memoria acotada y limpia ese caché en cada mutación. React Query conserva datos exitosos en IndexedDB para evitar descargas repetidas.

No usar `select=*`, no subir límites sin revisar Usage y no implementar polling de asistencia. Los PDFs se generan en el navegador. Consultar la cuota vigente en [Supabase Pricing](https://supabase.com/pricing) antes de cambiar estos presupuestos.

## Contrato mínimo de integración

### Cuenta y operadores

La cuenta autenticada debe ser identificable por `cuenta_id`. Los operadores necesitan como mínimo:

- `id` UUID;
- `cuenta_id` UUID;
- `nombre` y `rol`;
- `activo`;
- hash y salt del PIN si se usa selección de operador.

El service role nunca debe estar en el frontend. `SUPABASE_SERVICE_KEY` solo se configura como secreto del Worker.

### Empleados sincronizados

Nómina no debe crear ni modificar fichas de Personal. Debe recibir una vista o tabla de sincronización con:

- `id_externo`;
- `cuenta_id`;
- `nombre`;
- `documento` opcional;
- `activo`.

La migración final debe reemplazar las FK históricas a `public.clientes` por ese contrato o por una vista estable con la misma semántica.

## Gate de migración

No activar el flag en producción hasta comprobar:

1. proyecto Supabase nuevo y URL/anon key correctos;
2. service role almacenado únicamente como secreto del Worker;
3. migraciones aplicadas y verificadas en un entorno de staging;
4. contrato de operadores y empleados sincronizados instalado;
5. dos tenants de prueba sin lecturas cruzadas;
6. roles probados: administración, jefe, desarrollador y logística;
7. respaldo y restauración verificados;
8. reglas legales con fuente, versión, vigencia y aprobación;
9. tasas con fuente, fecha, valor y aprobación;
10. conciliación contable aprobada para al menos un período cerrado.

El flag `nomina_v2_enabled` debe habilitarse por cuenta y no debe usarse como autorización. La autorización permanece en el Worker y en RLS.

## Revisión RLS obligatoria

Las políticas incluidas son una base de contrato para el proyecto nuevo. Deben revisarse contra la función real que resuelve el tenant del JWT y ejecutarse junto con los triggers de integridad de la migración 220. Verificar especialmente `USING` y `WITH CHECK` para lectura, inserción, actualización y eliminación de:

- `nomina_config_empleado`;
- `registro_asistencia`;
- `nomina_periodos`;
- `nomina_lineas`;
- `nomina_feriados`;
- `nomina_horarios`;
- `nomina_conceptos`;
- `nomina_linea_conceptos`;
- `nomina_reglas_legal`;
- `nomina_tasas_snapshot`.

## Proveedores externos y legal

No se incluyen credenciales ni proveedores implícitos para BCV, Euro o USDT. Antes de activarlos, el negocio debe aprobar fuente, frecuencia, timeout, fallback y responsable. Toda tasa manual debe conservar fuente y observación; una liquidación debe usar el snapshot del período, nunca la tasa actual.

## Estado de la instancia entregada

El proyecto `wlxcclidnwketrghqaxs` quedó enlazado y `supabase db push` confirmó que el remoto está al día. `supabase migration list` mostró coincidencia local/remota para `001` y `208`–`220`. Esto valida la aplicación del esquema, no sustituye la prueba funcional de RLS con dos tenants.

Para cambios futuros en el repositorio destino:

```bash
supabase link --project-ref wlxcclidnwketrghqaxs
supabase db push
npm ci
npm run lint
npm test
npm run build
```

Las credenciales deben inyectarse desde el gestor seguro del entorno y nunca escribirse en `.env.example`, `.dev.vars.example` ni Git.
