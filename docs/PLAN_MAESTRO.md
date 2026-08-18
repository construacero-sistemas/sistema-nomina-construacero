# Plan maestro — Nómina Construacero

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
| Supabase real | Crear proyecto, aplicar migraciones, cargar operadores y probar RLS | ⏳ Requiere credenciales |
| Legal/proveedores | Aprobar reglas fiscales y fuentes BCV/Euro/USDT | ⏳ Requiere decisión del negocio |
| Deploy | Configurar dominio, secretos y publicar Worker/frontend | ⏳ Requiere repositorio y aprobación |

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

**Destino informado por el propietario:** `https://wlxcclidnwketrghqaxs.supabase.co` (ref. `wlxcclidnwketrghqaxs`). La URL ya queda en las plantillas públicas; las claves no se escriben en el repositorio.

1. Crear un proyecto nuevo y activar Auth según la política del negocio.
2. Aplicar `001` y luego `208`–`220` con Supabase CLI en staging.
3. Crear una cuenta de negocio en `auth.users`.
4. Crear al menos dos operadores de prueba por cuenta con PIN PBKDF2 generado por un procedimiento controlado; no insertar PIN en claro.
5. Sincronizar empleados mínimos desde Personal.
6. Probar con dos cuentas: lecturas cruzadas deben devolver vacío/404/403.
7. Verificar RLS con roles administración, jefe, desarrollador y logística.
8. Ejecutar un período completo de prueba, conciliación contable y respaldo/restauración.
9. Solo entonces habilitar `nomina_v2_enabled` para esa cuenta.

## Handoff de repositorio

**Repositorio destino informado:** `https://github.com/construacero-sistemas/sistema-nomina-construacero`.

El checkout actual sigue apuntando al repositorio histórico del POS y contiene trabajo local no comiteado; no se cambia ese remoto ni se sube código automáticamente para no alterar el repositorio propietario equivocado. Para cerrar el handoff se requiere una sesión autenticada con permiso de escritura y la aprobación explícita del propietario para inicializar, comitear y publicar el contenido de esta carpeta en el repositorio destino.

## Fuera del alcance local

No se inventan ni se activan automáticamente:

- credenciales de Supabase;
- sincronización POS → Nómina en producción;
- proveedores externos de tasas;
- fórmulas fiscales no aprobadas;
- deploy, DNS, dominios o secretos;
- creación de un repositorio remoto.

Esas tareas requieren acceso y decisiones que no deben quedar hardcodeadas en el código.
