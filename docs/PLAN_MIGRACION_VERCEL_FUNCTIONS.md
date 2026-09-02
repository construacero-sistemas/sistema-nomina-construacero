# Plan de migración — Cloudflare Workers a Vercel Functions

**Proyecto:** Nómina y Finanzas Construacero Carabobo  
**Objetivo:** simplificar el despliegue manteniendo Vercel para frontend/API y Supabase exclusivo de Nómina.

## 1. Decisión

Migrar el runtime de producción a:

```text
Vercel (Vite + API Function) → Supabase de Nómina
```

El POS continúa independiente:

```text
Vercel/Cloudflare POS → Supabase oyfyuszgjwcepjpngclv
Nómina → Supabase wlxcclidnwketrghqaxs
```

No se comparte Worker, proyecto Vercel, variables, service keys, migraciones ni dominio.

## 2. Situación actual

El proyecto ya tiene una base compatible con Vercel:

- `api/index.js` adapta una petición Node a `worker.fetch()`.
- `vercel.json` reescribe `/api/*` hacia `api/index.js`.
- Los handlers de negocio están separados en `server/handlers`.
- `npm run build` genera `dist` correctamente.

Dependencias y elementos todavía ligados a Cloudflare:

- `wrangler` en `devDependencies`.
- `wrangler.toml`.
- `npm run dev` y `npm run dev:api` levantan Wrangler.
- `worker.js` contiene el router y fallback de assets `env.ASSETS`.
- Documentación de operación habla de Worker como runtime principal.
- `compat/api/lib/auth.js` contiene comentarios y decisiones históricas del runtime edge.

## 3. Fases de ejecución

### Fase 0 — Congelación y respaldo

1. Crear una rama de migración.
2. No ejecutar migraciones SQL durante el cambio de runtime.
3. Respaldar configuración actual de Vercel y secretos de Nómina.
4. Registrar una línea base de:
   - `/api/ping`
   - login y `/api/auth/me`
   - lectura de empleados
   - creación/listado/resumen/anulación financiera
   - ciclo de Nómina
5. Confirmar que el POS sigue usando su propio Supabase y Worker.

### Fase 1 — Adaptador Vercel robusto

1. Mantener `api/index.js` como único entrypoint de API.
2. Extraer el router común de `worker.js` a un módulo runtime-neutral.
3. Mantener temporalmente `worker.js` como adaptador de compatibilidad local.
4. Confirmar que las respuestas preservan:
   - status
   - headers CORS
   - headers de seguridad
   - JSON y cuerpos binarios si aparecieran
   - errores 4xx/5xx
5. Prohibir que la API dependa de `env.ASSETS`; los assets deben ser servidos por Vercel desde `dist`.
6. Revisar límites de body y timeout de Vercel frente a `maxDuration: 60`.

### Fase 2 — Variables y despliegue

Configurar exclusivamente en el proyecto Vercel de Nómina:

```text
VITE_SUPABASE_URL=https://wlxcclidnwketrghqaxs.supabase.co
VITE_SUPABASE_ANON_KEY=<anon de Nómina>
SUPABASE_URL=https://wlxcclidnwketrghqaxs.supabase.co
SUPABASE_ANON_KEY=<anon de Nómina>
SUPABASE_SERVICE_KEY=<service key de Nómina>
NOMINA_TIMEZONE=America/Caracas
NOMINA_ALLOWED_ORIGINS=https://<dominio-nomina>
BCV_GOOGLE_SCRIPT_URL=<opcional>
```

No copiar ninguna variable del POS. El POS usa `oyfyuszgjwcepjpngclv.supabase.co`.

### Fase 3 — Desarrollo local simple

Objetivo:

```text
npm run dev → Vite + API Node local
```

Opciones, en orden recomendado:

1. Crear un servidor Node local pequeño que invoque el router común y escuche en `8788`.
2. Mantener Vite en `5173` con proxy a `8788`.
3. Mantener `npm run dev:vite` para ejecutar solo frontend.
4. Retirar Wrangler del camino normal.

Durante la transición se puede conservar `npm run dev:worker` como compatibilidad, pero no debe ser requisito de onboarding.

### Fase 4 — Pruebas de equivalencia

Ejecutar contra preview de Vercel:

#### Infraestructura

- `/api/ping` responde 200.
- `/api/no-existe` responde 404.
- OPTIONS/CORS funciona solo para el dominio de Nómina.
- Headers de seguridad permanecen presentes.
- Payload sobre el límite devuelve 413.

#### Autenticación

- Login con correo/contraseña.
- Sesión persistente tras recarga.
- `/api/auth/me` devuelve el único perfil administrativo.
- Sin sesión, rutas sensibles devuelven 401.
- Cuenta con más de un administrador activo es rechazada según contrato.

#### Exactitud financiera

- Crear ingreso y egreso.
- Confirmar `monto_ves` calculado en backend.
- Repetir una mutación con la misma idempotency key sin duplicar.
- Consultar resumen.
- Anular sin borrar.
- Verificar auditoría y balance.

#### Nómina

- Empleados.
- Asistencia.
- Marcaje.
- Período.
- Cálculo.
- Cierre.
- Pago y reversión.
- Tasas y snapshots.

### Fase 5 — Corte y limpieza

Después de aprobar preview y producción:

1. Cambiar el proyecto Vercel al despliegue oficial.
2. Apuntar el dominio exclusivo de Nómina al proyecto Vercel correcto.
3. Desactivar el despliegue Cloudflare de Nómina, sin tocar el POS.
4. Cambiar scripts y README para que Vercel sea el camino principal.
5. Eliminar `wrangler` de `package.json` y actualizar `package-lock.json`.
6. Archivar o eliminar `wrangler.toml` solo cuando no existan consumidores.
7. Mantener `worker.js` únicamente si se decide conservar una ruta de rollback; eliminarlo en una fase posterior.
8. Retirar documentación de deploy Cloudflare.

## 4. Rollback

Durante la transición:

- No cambiar Supabase ni migraciones.
- Mantener el despliegue anterior disponible.
- Si Vercel falla, restaurar el alias/dominio al despliegue anterior aprobado.
- Comparar respuestas de `/api/ping`, auth y Finanzas antes de reintentar.
- No duplicar operaciones manualmente durante la ventana de corte.
- Preservar auditoría y revisar cualquier mutación con estado incierto.

## 5. Criterios de terminado

- Vercel sirve frontend y API de Nómina sin Wrangler.
- `npm run dev` no requiere Cloudflare para una instalación nueva.
- `npm run verify` en verde.
- Preview y producción usan `wlxcclidnwketrghqaxs`.
- Ninguna petición de Nómina llega a `oyfyuszgjwcepjpngclv`.
- El POS permanece sin cambios y sigue usando su Worker/puerto/Supabase.
- Variables y secretos están separados por proyecto.
- Login de un paso y sesión persistente funcionan.
- Finanzas mantiene precisión, idempotencia y auditoría.
- Documentación de despliegue no presenta Cloudflare como requisito.

## 6. Riesgos y decisiones

- `api/index.js` depende actualmente de la interfaz `fetch()` del módulo `worker.js`; conviene extraer un router común antes de retirar `worker.js`.
- Los tests actuales invocan `worker.fetch()`; deben añadirse pruebas del adaptador Vercel o del router común.
- Los caches en memoria son efímeros en Vercel y no deben considerarse almacenamiento permanente.
- Las tareas programadas no son parte del alcance actual de Nómina; si se agregan, usar Vercel Cron o una función separada, no mezclar con el POS.
- La misma cadena `/api/*` es segura porque cada aplicación se sirve en su propio dominio y proyecto; nunca deben apuntar al mismo dominio.

## 7. Orden recomendado

1. Extraer router/runtime-neutral.
2. Añadir servidor local Node.
3. Cubrir adapter con tests.
4. Validar preview Vercel.
5. Ejecutar E2E completo.
6. Cambiar producción.
7. Observar durante 24–48 horas.
8. Retirar Wrangler y archivos Cloudflare.

## Conclusión

La migración es viable sin reescribir Nómina ni Finanzas. El trabajo principal es desacoplar el router de la interfaz Cloudflare, hacer que Vercel sea el camino local y productivo, y validar equivalencia antes de retirar Wrangler. El POS queda fuera del cambio y mantiene su propio proyecto, Worker, repositorio y Supabase.
