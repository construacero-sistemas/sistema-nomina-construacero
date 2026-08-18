# Operaciones y despliegue — Nómina y Finanzas Construacero Carabobo

## Desarrollo local

```bash
npm ci
cp .env.example .env
cp .dev.vars.example .dev.vars
npm run check:project
npm run verify
npm run dev
```

Vite sirve el frontend y Wrangler sirve el Worker en `http://localhost:8788`. No colocar la service role key en `.env`; debe vivir únicamente en `.dev.vars` local o en secretos del Worker.

La UI sigue el patrón responsive de Construacero: drawer lateral en móvil, sidebar colapsable en desktop, navegación inferior táctil, modales con área segura y tablas anchas con scroll controlado. El login mantiene una composición central acotada a 1120 px, separa branding y acceso en desktop y convierte el estado sin operadores en una acción clara de configuración/actualización. Validar manualmente en 360 px, 390 px, 768 px y 1366 px antes de activar cambios visuales en producción.

## Destinos entregados

- Repositorio: `https://github.com/construacero-sistemas/sistema-nomina-construacero`
- Supabase: `https://wlxcclidnwketrghqaxs.supabase.co`
- Ref. Supabase: `wlxcclidnwketrghqaxs`
- Vercel producción: `https://nomina-construacero.vercel.app`

Supabase quedó enlazado y las migraciones `001` y `208`–`220` coinciden entre local y remoto. El repositorio destino sigue pendiente de push porque la cuenta autenticada recibió HTTP 403; no reintentar con una cuenta sin permiso.

## Presupuesto Supabase Free: egress primero

La referencia vigente del plan Free indica 5 GB de egress y 5 GB de cached egress. El objetivo interno es no superar 100 MB diarios ni 3 GB mensuales, dejando margen para picos y cambios de cuota. Revisar el panel Usage diariamente; tomar acción al superar 3 GB y detener exportaciones masivas al acercarse a 4 GB.

El paquete reduce egress con:

- Proyecciones explícitas de columnas y topes de 500 filas en lecturas de nómina; no usar `select=*` ni subir límites sin revisar Usage.
- Caché de respuestas en memoria del Worker/Vercel: 2 MB totales, 512 KB por respuesta y TTL de 5–600 segundos según el recurso. El caché está aislado por fingerprint de sesión/operador/origen y los POST lo limpian.
- React Query persistido en IndexedDB, sin refetch por foco y sin reintentos automáticos.
- Sin polling de asistencia; el botón de actualización es manual.
- PDFs generados en el cliente, sin subir reportes a Storage.

Si el consumo sube: reducir rangos de asistencia, evitar recargas manuales repetidas, no abrir planillas completas innecesariamente, revisar endpoints con mayor transferencia y aplicar paginación antes de aumentar cualquier límite. La cuota puede cambiar; confirmar siempre en [Supabase Pricing](https://supabase.com/pricing).

## Supabase staging y cambios futuros

La primera aplicación ya fue ejecutada contra `wlxcclidnwketrghqaxs`. Para cambios futuros, desde el repositorio destino:

```bash
supabase login
supabase link --project-ref wlxcclidnwketrghqaxs
supabase db push
```

Antes de `db push`:

- verificar que el proyecto no sea el Supabase del POS;
- respaldar staging;
- revisar el diff SQL;
- probar dos cuentas y cuatro roles;
- confirmar que `nomina_v2_enabled` siga en `false`.

Después de migrar, comprobar también el panel Usage y establecer una línea base de egress antes de habilitar usuarios reales:

Verificar:

- `auth.users` contiene las cuentas de negocio;
- `usuarios.cuenta_id` coincide con la cuenta y ningún PIN está en claro;
- empleados tienen identidad mínima y `tipo_cliente = 'personal'`;
- RLS y triggers de la migración 220 están activos;
- Realtime solo publica las tablas aprobadas por el negocio.

## Secretos del Worker

Configurar en el proveedor, nunca en Git:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
NOMINA_ALLOWED_ORIGINS
NOMINA_TIMEZONE
```

Mantener `ENABLE_DEV_MASTER_PIN=false` y `ENABLE_DEVELOPER_ACCESS=false` en producción. Rotar la service role key ante cualquier exposición.

## Deploy Vercel

El repositorio incluye `vercel.json` y `api/[...path].js`: Vercel sirve el frontend Vite y adapta las rutas `/api/*` del Worker. Configurar en el proyecto Vercel, como variables de producción y preview según corresponda:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_KEY
NOMINA_TIMEZONE
NOMINA_ALLOWED_ORIGINS
```

El despliegue de producción ya está listo en `https://nomina-construacero.vercel.app` y la función `api/[...path]` quedó como una única función serverless. Para publicar una nueva versión:

```bash
vercel --prod
```

Nunca subir `.env`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ACCESS_TOKEN`, contraseñas de base de datos ni tokens de Vercel al repositorio. Si una credencial se comparte fuera del gestor seguro, revocarla y rotarla antes de cualquier nuevo push.

## Deploy Cloudflare Worker

```bash
npm run build
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_KEY
wrangler deploy --config wrangler.toml
```

El deploy requiere aprobación y credenciales del propietario. Validar después:

```bash
curl -i https://<dominio>/api/ping
```

Debe responder JSON `{"ok":true,"service":"nomina-construacero"}` y headers de seguridad. Probar CORS desde el dominio final, no desde un wildcard.

## Rollback

1. Desactivar `nomina_v2_enabled` para la cuenta afectada.
2. Detener el acceso operativo si hay inconsistencias.
3. No borrar migraciones ni datos de períodos pagados.
4. Restaurar Worker a la versión anterior mediante el mecanismo aprobado del proveedor.
5. Preservar auditoría, respaldo y evidencia del incidente.
6. Reconciliar manualmente antes de reactivar.

Nunca revertir SQL destructivamente en producción sin un plan de restauración verificado.
