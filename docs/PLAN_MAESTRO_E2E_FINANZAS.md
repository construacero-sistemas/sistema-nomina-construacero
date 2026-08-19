# Plan maestro E2E — Nómina y Finanzas Construacero Carabobo

**Fecha:** 2026-08-18

**Fuente funcional:** `requerimientos_actualizacion_app.pdf` (08-08-2026)

**Objetivo:** implementar y verificar un sistema de nómina y finanzas con un único rol operativo: `administracion`.

## 1. Requisitos extraídos del PDF

### Asistencia y jornada

- Marcaje exacto de entrada y salida mediante interfaz/tarjeta/código equivalente.
- Cálculo automático y manual de horas extra.
- Sábado configurable por empleado, con asistencia selectiva y rotativa.
- Calendario de feriados laborables/no laborables con recargos y reglas salariales.

### Nómina y pagos

- Sueldo fijo individual.
- Nómina fiscal oficial parametrizable.
- Otros pagos y asignaciones extraordinarias.
- Bonificaciones opcionales.
- Deducciones generales: anticipos, faltas, retenciones y préstamos.
- Desglose reproducible y conciliado de bruto, deducciones y neto.

### Multimoneda

- Tasa oficial BCV.
- Tasa Euro.
- Tasa USDT.
- Ingreso manual de tasa personalizada.
- Cada cálculo debe conservar un snapshot de tasa, fuente, fecha y aprobación.

### Finanzas solicitadas en esta actualización

- Registro de ingresos.
- Registro de egresos/gastos.
- Categorías, conceptos, fecha, referencia, observación, moneda y tasa.
- Reportes por rango de fechas, tipo, categoría y moneda.
- Resumen de ingresos, egresos y balance.
- Anulación auditada; no se borran movimientos contables confirmados.

## 2. Auditoría inicial del código

### Cobertura existente

| Área | Estado actual | Riesgo o pendiente |
|---|---|---|
| Empleados | Contrato sincronizado desde `clientes` | Si Personal no tiene fichas activas, no se puede configurar nómina; no se debe duplicar Personal |
| Asistencia manual | Implementada con validación de fecha/hora | Faltan flujos E2E reales con dos cuentas y calendario aplicado |
| Marcaje entrada/salida | Implementado con hora del servidor e idempotencia | Ahora administración única puede registrar ambas marcas; roles heredados quedan bloqueados |
| Extras | Motor `nominaUtils` implementado | Debe probar límites, jornadas nocturnas, sábado y feriado en conjunto |
| Sábados/rotación | Migración, endpoints y pantalla administrativa | Validar con política operativa de cada empleado |
| Feriados | Migración, lectura, creación y pantalla administrativa | Completar validación manual de política laborable/no laborable por empresa |
| Sueldos fijos | Configuración individual y snapshots de línea | Falta probar cambio de salario entre períodos y conciliación fiscal |
| Bonos/deducciones | Ajuste por línea existente | Falta catálogo aplicado a líneas y comprobación de conceptos en reportes |
| Nómina fiscal | Tablas, CRUD y pantalla de conceptos/reglas versionadas | Las fórmulas legales requieren aprobación antes de activarse |
| Tasas | Snapshots, pantalla manual y fuentes etiquetadas | Los adaptadores automáticos BCV/Euro/USDT requieren proveedor aprobado |
| Finanzas | Movimientos, categorías, resumen y anulación implementados | Esquema 221–223 aplicado directamente; falta validar conciliación con datos reales |
| Auth | PIN PBKDF2 server-side | API, UI, RPC y migración aceptan únicamente `administracion` |
| Tenant/RLS | Filtros explícitos, RLS y triggers existentes | Finanzas debe repetir la misma barrera en API y SQL |
| Egress | Caché, proyecciones y límites existentes | Finanzas usará paginación, agregados server-side y sin polling |
| E2E | Suite Vitest de handlers y smoke del Worker sin navegador/red real | 340 pruebas deterministas cubren auth, rutas, Finanzas y ciclo de Nómina; la instancia Supabase ya tiene el esquema aplicado y requiere validación funcional |
| Tamaño | Los handlers y estilos críticos fueron separados | Guardrail automático: ninguna fuente JS/JSX/CSS/SQL supera 600 líneas; el lockfile generado queda fuera |

## 3. Arquitectura objetivo

```text
React/Vite
  ├─ Login único: operador administración
  ├─ Nómina: empleados, asistencia, períodos, recibos, tasas/reglas
  └─ Finanzas: movimientos, filtros, resumen y reportes
          │ same-origin /api/*
          ▼
Worker/API serverless
  ├─ auth JWT + operador administración
  ├─ validación de body, fechas, moneda y montos
  ├─ tenant explícito en cada lectura/escritura
  ├─ idempotencia para mutaciones repetibles
  ├─ reportes agregados en servidor
  └─ auditoría de acciones sensibles
          ▼
Supabase independiente
  ├─ auth.users / public.usuarios
  ├─ clientes sincronizados desde Personal
  ├─ tablas nomina_*
  ├─ finanzas_movimientos
  ├─ finanzas_categorias
  ├─ RPC de resumen acotado
  ├─ RLS tenant + rol administración
  └─ triggers de integridad y no borrado contable
```

## 4. Contrato de Finanzas

### Movimiento

```text
id: UUID
cuenta_id: UUID
fecha: YYYY-MM-DD
tipo: ingreso | egreso
categoria: texto acotado
concepto: texto requerido
monto: número positivo
moneda: USD | VES | EUR | USDT
tasa_ves: número positivo; 1 para USD solo si el reporte opera en USD
monto_ves: monto * tasa_ves, calculado server-side
referencia: texto opcional
observaciones: texto opcional
estado: activo | anulado
anulado_en / anulado_por / motivo_anulacion
creado_en / creado_por
```

Reglas:

- El cliente nunca envía `cuenta_id`, `monto_ves`, `creado_por` ni sellos de anulación confiables.
- `monto` siempre es positivo; el signo lo determina `tipo`.
- `monto_ves` se calcula y valida en API/trigger.
- No se elimina un movimiento activo; se anula con motivo y auditoría.
- El reporte excluye anulados por defecto y puede mostrarlos solo como auditoría.
- Todos los listados llevan rango de fecha, límite máximo y columnas explícitas.

### Endpoints

```text
GET  /api/finanzas/movimientos?desde&hasta&tipo&categoria&moneda&limit&offset
POST /api/finanzas/movimientos/crear
POST /api/finanzas/movimientos/anular
GET  /api/finanzas/reportes/resumen?desde&hasta&tipo&categoria&moneda=VES
GET  /api/finanzas/categorias
POST /api/finanzas/categorias/crear
```

Todos requieren sesión válida, operador activo `administracion` y tenant válido.

## 5. Plan de ejecución

### Fase A — Contratos y tamaño

1. Mantener este documento como contrato verificable.
2. Separar `server/handlers/nomina.js` por dominio sin cambiar rutas públicas.
3. Separar `compat/index.css` por hojas importadas por dominio.
4. Separar login y store de auth por responsabilidades.
5. Separar suites grandes en archivos de escenarios.
6. Añadir guardrail que rechace fuentes JavaScript/JSX/CSS/SQL mayores de 600 líneas; el lockfile generado queda fuera.

### Fase B — Supabase

1. Crear migraciones financieras numeradas posteriores a 220.
2. Crear tablas, índices, checks, RLS restrictiva, policies de administración y auditoría.
3. Crear RPC de resumen agregado por tenant con filtros de moneda, tipo y categoría.
4. Crear migración de rol único: login/API/RLS solo aceptan `administracion`.
5. Verificar idempotencia de alta/anulación y que no exista DELETE financiero; el rango/monto/tasa quedan acotados al contrato SQL.
6. Mantener migraciones idempotentes y reversibles por operación; no borrar datos.

### Fase C — Worker/API

1. Añadir validadores puros para dinero, moneda, tasa, fechas, categoría y paginación.
2. Implementar movimientos con respuesta mínima y controles de concurrencia.
3. Implementar anulación idempotente y auditoría.
4. Implementar resumen agregado server-side para reducir egress.
5. Añadir rutas al Worker y al adaptador de Vercel.
6. Rechazar `select=*`, límites inseguros y bodies grandes.

### Fase D — Frontend

1. Añadir pestaña Finanzas solo para administración.
2. Crear formulario de ingreso/egreso con validación visible.
3. Crear tabla responsive con filtros y paginación.
4. Crear tarjetas KPI: ingresos, egresos y balance.
5. Crear reporte por rango/categoría/moneda.
6. Añadir estados de carga, vacío, error, reintento, CSV de página y confirmación de anulación.
7. No almacenar movimientos ni tasas sensibles en localStorage fuera de la caché controlada.

### Fase E — E2E y seguridad

1. Flujos felices API con mocks de Supabase.
2. Flujo completo de movimiento: crear → listar → reportar → anular → reportar.
3. Dos tenants: no hay lectura ni mutación cruzada.
4. Rol heredado: recibe 403 en toda ruta nueva y en nómina; no existe bandera de compatibilidad que relaje el rol único.
5. Duplicación/reintento: no duplica una operación con idempotency key.
6. Montos, tasas, fechas, moneda y paginación inválidos.
7. Inyección en texto/categoría y payload sobredimensionado.
8. Reporte con cero filas, una fila, múltiples monedas y anulaciones.
9. Ciclo nómina: Personal → config → asistencia → extras → período → cálculo → ajustes → cierre → pago → recibo.
10. Smoke de producción: página, `/api/ping`, auth protegida y rutas financieras sin sesión.

## 6. Definición de terminado

- `npm run verify` en verde.
- Suite de tests ampliada sin red real y smoke E2E documentado.
- Ningún archivo fuente JavaScript, JSX, CSS o SQL supera 600 líneas; el lockfile generado no se considera fuente.
- Un solo rol operativo: `administracion`.
- Finanzas crea, lista, reporta por rango/tipo/categoría/moneda y anula movimientos sin pérdida de precisión.
- Nómina cubre todos los puntos del PDF o marca explícitamente la decisión de negocio pendiente.
- Tasas manuales funcionan; fuentes automáticas solo se activan con proveedor aprobado.
- RLS, tenant, auditoría y guardrails de egress comprobados.
- Migraciones locales/remotas sincronizadas después de aprobación.
- README, OPERACIONES y auditoría actualizados.
- GitHub `main` y Vercel producción reflejan el mismo commit.

## 7. Decisiones que no se deben improvisar

- Porcentajes/fórmulas fiscales: requieren fuente legal y aprobación contable.
- Credenciales de proveedores BCV/Euro/USDT: deben vivir como secretos del Worker.
- Empleados: Nómina no duplica ni edita Personal; se requiere sincronización o alta en el sistema origen.
- Anulación financiera: no se elimina el movimiento confirmado.
- Datos reales: no se usarán PIN, passwords o service keys en tests ni documentación.
