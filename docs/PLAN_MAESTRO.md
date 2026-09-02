# Plan maestro — Nómina y Finanzas Construacero Carabobo

**Fecha de corte:** 2026-08-24
**Objetivo:** dejar el módulo de nómina autocontenido y verificable, pendiente únicamente de conectar el Supabase nuevo, los secretos y el repositorio de destino.

## Fases y estado

| Fase | Resultado | Estado |
|---|---|---|
| Auditoría | Revisión de frontend, Worker, API, migraciones, auth, RLS, PDFs y pruebas | ✅ Ejecutada |
| Extracción | Shell de nómina, rutas API y migraciones separadas del POS | ✅ Ejecutada |
| Seguridad | Cuenta/rol/tenant server-side, ocultamiento salarial, PIN temporalmente deshabilitado, CORS, CSP, límites y guardrails SQL | ⚠️ PIN pendiente de decisión |
| Dominio | Asistencia, extras, feriados, rotaciones, períodos, cálculo, ajustes, pagos y reversión | ✅ Ejecutada |
| QA automatizado | Suite de handlers y motores de cálculo sin red real | ✅ Ejecutada |
| Handoff | README, operación, CI, variables de entorno y contrato de integración | ✅ Ejecutada |
| Egress Free | Caché acotado, proyecciones explícitas, límites, persistencia local y presupuesto operativo | ✅ Ejecutada |
| Supabase real | Proyecto enlazado; migraciones 001 y 208–223 aplicadas y verificadas directamente | ✅ Esquema aplicado; falta conciliación funcional con datos de negocio |
| Legal/proveedores | Aprobar reglas fiscales y fuentes BCV/Euro/USDT | ⏳ Requiere decisión del negocio |
| Deploy | Frontend y función API publicados en Vercel producción | ⏳ Publicar esta revisión en GitHub/Vercel cuando corresponda |

## Prioridad inmediata: operación simple y entendible

1. Mantener el acceso por correo y contraseña como única barrera activa.
2. Permitir elegir el usuario directamente, con confirmación visual y registro de auditoría.
3. Mantener toda autorización en el Worker; nunca confiar en la caché del navegador.
4. Reintroducir una barrera adicional antes de usar dispositivos compartidos o habilitar usuarios reales.
5. Sustituir términos técnicos en la interfaz: “tasa guardada” en lugar de “snapshot”, “volver a intentar” en lugar de “reintentar”, y acciones con texto visible en vez de iconos aislados.
6. Validar físicamente en 360 px, 390 px, 768 px y 1366 px; probar teclado, lector de pantalla, error de red y doble clic.

## Arquitectura objetivo

```text
Frontend React/Vite
        │ same-origin /api/* o VITE_WORKER_ORIGIN
        ▼
Worker Nómina
  ├─ autentica JWT Supabase
  ├─ valida operador y rol (PIN temporalmente deshabilitado)
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
- El único rol operativo es `administracion`; puede marcar y consultar asistencia, nómina y Finanzas sin que existan rutas para roles heredados.
- El PIN queda deshabilitado temporalmente; la cuenta por correo y contraseña sigue siendo obligatoria y la selección del usuario se valida server-side.
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

**Destino informado por el propietario:** `https://wlxcclidnwketrghqaxs.supabase.co` (ref. `wlxcclidnwketrghqaxs`). Las migraciones `001` y `208`–`220` fueron aplicadas en el ciclo anterior; las nuevas `221`, `222` y `223` fueron aplicadas directamente y verificadas con la CLI y consultas de contrato. Las claves no se escriben en el repositorio.

1. Mantener Auth según la política del negocio.
2. Para cambios futuros, aplicar nuevas migraciones con Supabase CLI directamente al proyecto enlazado, después de revisar el SQL y respaldar datos operativos.
3. Crear una cuenta de negocio en `auth.users`.
4. Crear al menos dos operadores de prueba por cuenta. Mientras el PIN esté deshabilitado, registrar quién puede seleccionar cada usuario; antes de producción compartida, reactivar el PIN o aprobar una alternativa de seguridad.
5. Sincronizar empleados mínimos desde Personal.
6. Probar con dos cuentas: lecturas cruzadas deben devolver vacío/404/403.
7. Verificar RLS con el único rol `administracion` y confirmar que cualquier rol heredado recibe 403.
8. Ejecutar un período completo de prueba, conciliación contable y respaldo/restauración.
9. Solo entonces habilitar `nomina_v2_enabled` para esa cuenta.

## Handoff de repositorio

**Repositorio destino informado:** `https://github.com/construacero-sistemas/sistema-nomina-construacero`.

El remoto destino está configurado, pero la publicación de esta auditoría requiere una cuenta con permiso de escritura; no se deben incluir secretos ni forzar cambios ajenos. El despliegue histórico de producción quedó publicado en `https://nomina-construacero.vercel.app`; las migraciones 221–223 deben validarse antes de activar Finanzas en producción.

## Plan maestro UX/UI — siguiente ciclo

### Semana 1 — Claridad

- ✅ Aplicado localmente: guía visible, lenguaje cotidiano y acciones críticas con texto.
- Revisar todos los textos de botones, formularios, errores y confirmaciones con personal no técnico.
- Renombrar términos internos y eliminar lenguaje de desarrollo de la interfaz.
- Añadir texto visible a acciones importantes; los iconos quedan como apoyo, nunca como única explicación.

### Semana 2 — Flujos principales

- ✅ Aplicado localmente: cada módulo muestra un inicio y el siguiente paso.
- Validar cinco recorridos: entrar, seleccionar usuario, registrar asistencia, cerrar nómina y registrar/anular movimiento.
- Añadir una guía corta dentro de cada pantalla: “Comienza aquí”, “Siguiente paso” y “Listo”.
- Confirmar que cada acción destructiva o contable explique consecuencias antes de ejecutarse.

### Semana 3 — Diseño consistente

- ✅ Aplicado localmente: Configuración está agrupada por objetivos y las acciones importantes muestran texto.
- Crear una guía visual única para botones, campos, tarjetas, tablas, alertas, diálogos y estados vacíos.
- Sustituir listas largas de configuración por secciones progresivas y agrupadas por objetivo.
- Revisar tamaños táctiles, contraste, foco de teclado, lector de pantalla y zoom del navegador.

### Semana 4 — Validación con usuarios

- ⏳ Pendiente externo: seguir `docs/ACEPTACION_MANUAL_E2E.md` con 3–5 personas del equipo sin explicarles cómo usar la app.
- Medir tiempo hasta completar cada tarea, errores y preguntas realizadas.
- Corregir primero lo que cause abandono, confusión o errores contables.

## Fuera del alcance local

No se inventan ni se activan automáticamente:

- credenciales de Supabase;
- sincronización POS → Nómina en producción;
- proveedores externos de tasas;
- fórmulas fiscales no aprobadas;
- DNS, dominios adicionales o rotación de secretos;
- creación de un repositorio remoto.

Esas tareas requieren acceso y decisiones que no deben quedar hardcodeadas en el código.
