# Operaciones y despliegue

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

## Destinos entregados

- Repositorio: `https://github.com/construacero-sistemas/sistema-nomina-construacero`
- Supabase: `https://wlxcclidnwketrghqaxs.supabase.co`
- Ref. Supabase: `wlxcclidnwketrghqaxs`

El checkout local no se publica ni cambia de remoto automáticamente: pertenece al árbol del POS histórico. Primero se debe abrir una sesión autenticada con permiso de escritura sobre el repositorio destino y confirmar el plan de migración.

## Supabase staging

Desde el repositorio destino:

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

Después de migrar, comprobar:

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
