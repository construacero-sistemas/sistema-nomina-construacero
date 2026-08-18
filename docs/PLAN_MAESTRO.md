# Plan maestro — Nómina y Finanzas Construacero Carabobo

**Fecha de corte:** 2026-08-17  
**Objetivo:** dejar el módulo de nómina autocontenido y verificable, pendiente únicamente de conectar el Supabase nuevo, los secretos y el repositorio de destino.

## Fases y estado

| Fase | Resultado | Estado |
|---|---|---|
| Auditoría | Revisión de frontend, Worker, API, migraciones, auth, RLS, PDFs y pruebas | ✅ Ejecutada |
| Extracción | Shell de nómina, rutas API y migraciones separadas del POS | ✅ Ejecutada |
| Seguridad | Tenant explícito, roles, ocultamiento salarial, PIN server-side, CORS, CSP, límites y guardrails SQL | ✅ Ejecutada |
| Dominio | Asistencia, extras, feriados, rotaciones, períodos, cálculo, ajustes, pagos y reversión | ✅ Ejecutada |
| QA automatizado | Suite de handlers y motores de cálculo sin red real | ✅ Ejecutada |
| Handoff | README, operación, CI, variables de entorno y contrato de integración | ✅ Ejecutada |
| Egress Free | Caché acotado, proyecciones explícitas, límites, persistencia local y presupuesto operativo | ✅ Ejecutada |
| Supabase real | Proyecto enlazado; migraciones 001 y 208–220 aplicadas y verificadas local=remoto | ✅ Ejecutada; falta la validación funcional con usuarios reales |
| Legal/proveedores | Aprobar reglas fiscales y fuentes BCV/Euro/USDT | ⏳ Requiere decisión del negocio |
| Deploy | Frontend y función API publicados en Vercel producción | ✅ Ejecutada; el push a GitHub sigue bloqueado por permisos |

## Arquitectura objetivo

```text
Frontend React/Vite
        │ same-origin /api/* o VITE_WORKER_ORIGIN
        ▼
Worker Nómina
  ├─ autentica JWT Supabase
  ├─ valida operador/PIN y rol
  ├─ exige cuenta_id en cada handler
  ├─ consulta REST con service role
  └─ registra auditoría
        ▼
Supabase independiente
  ├─ auth.users = cuenta de negocio
  ├─ usuarios = operadores
  ├─ clientes = contrato mínimo de empleados sincronizados
  ├─ tablas nomina_*
  ├─ RLS por auth.uid()
  └─ triggers de consistencia de tenant
```

## Criterios de aceptación

### Seguridad

- Un operador sin `cuenta_id` es rechazado antes de consultar datos.
- Un operador no puede leer ni mutar otra cuenta aunque conozca un UUID.
- Logística puede marcar y consultar asistencia, pero nunca recibe salario, líneas ni períodos salariales.
- `pin_hash`, `pin_salt` y service role nunca aparecen en respuestas del frontend.
- CORS solo admite orígenes exactos configurados.
- Bodies mayores de 256 KiB son rechazados aun sin `Content-Length`.
- El worker no filtra mensajes crudos de Supabase al cliente.

### Cálculo y ciclo de vida

- Entrada y salida usan hora del servidor, y los reintentos con la misma idempotency key son seguros.
- Horas nocturnas no producen valores negativos.
- Feriados deben existir en el calendario para poder fijarse en una asistencia manual; el marcaje operativo los congela automáticamente.
- Cambiar el salario no altera snapshots de períodos ya calculados.
- No se edita asistencia de períodos cerrados/pagados.
- No se recalculan líneas pagadas ni se reabre un período con recibos pagados.
- Un período solo se paga cerrado y pasa a pagado cuando no quedan líneas pendientes.
- El neto nunca es negativo y los ajustes negativos se normalizan a cero.

### Integración

- Personal solo entrega identidad mínima de empleados con `tipo_cliente = 'personal'`.
- Nómina no crea ni modifica fichas del módulo Personal.
- Las tasas guardan moneda, valor, fuente, fecha y aprobación.
- Las reglas legales guardan fuente, versión, vigencia y aprobación; nacen inactivas.
- La bandera de rollout no es autorización y permanece apagada hasta la conciliación.

## Handoff Supabase

**Destino informado por el propietario:** `https://wlxcclidnwketrghqaxs.supabase.co` (ref. `wlxcclidnwketrghqaxs`). Las migraciones `001` y `208`–`220` ya fueron aplicadas; `supabase migration list` confirmó que todas las versiones locales coinciden con remoto. Las claves no se escriben en el repositorio.

1. Mantener Auth según la política del negocio.
2. Para cambios futuros, aplicar nuevas migraciones con Supabase CLI en staging.
3. Crear una cuenta de negocio en `auth.users`.
4. Crear al menos dos operadores de prueba por cuenta con PIN PBKDF2 generado por un procedimiento controlado; no insertar PIN en claro.
5. Sincronizar empleados mínimos desde Personal.
6. Probar con dos cuentas: lecturas cruzadas deben devolver vacío/404/403.
7. Verificar RLS con roles administración, jefe, desarrollador y logística.
8. Ejecutar un período completo de prueba, conciliación contable y respaldo/restauración.
9. Solo entonces habilitar `nomina_v2_enabled` para esa cuenta.

## Handoff de repositorio

**Repositorio destino informado:** `https://github.com/construacero-sistemas/sistema-nomina-construacero`.

El commit local base `25e1876` quedó preparado y el remoto destino está configurado, pero GitHub rechazó el push con HTTP 403 para `luiggiberaldi`. El despliegue de producción sí quedó publicado en `https://nomina-construacero.vercel.app`; para cerrar el handoff del repositorio aún hace falta autenticar una cuenta con permiso de escritura y publicar los cambios posteriores de la extracción.

## Fuera del alcance local

No se inventan ni se activan automáticamente:

- credenciales de Supabase;
- sincronización POS → Nómina en producción;
- proveedores externos de tasas;
- fórmulas fiscales no aprobadas;
- DNS, dominios adicionales o rotación de secretos;
- creación de un repositorio remoto.

Esas tareas requieren acceso y decisiones que no deben quedar hardcodeadas en el código.
