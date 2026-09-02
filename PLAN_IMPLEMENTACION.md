# Plan de entrega — Nómina y Finanzas Construacero Carabobo

## Objetivo

Entregar una aplicación independiente de nómina, visualmente coherente con Listo POS Cotizaciones, lista para conectarse a un proyecto Supabase nuevo y publicarse en un repositorio propio. El módulo de Personal permanece en el POS y no se migra.

## Requerimientos del documento y cobertura

| Requerimiento | Cobertura del sistema | Criterio de aceptación |
|---|---|---|
| Marcaje de entrada/salida | Panel de marcaje operativo con hora del servidor, tarjetas/interfaz equivalente e idempotencia | Una entrada y una salida por empleado/día, sin duplicados por reintentos |
| Horas extras | Cálculo por jornada configurada y desglose por período | Horas normales y extras visibles y reproducibles |
| Sábados selectivos/rotativos | Calendario laboral con horarios por día, ciclo y grupo de rotación | Un sábado puede ser laborable para unos empleados y no laborable para otros |
| Feriados | Calendario por cuenta, tipo y condición laborable | El feriado queda congelado en la asistencia y aplica su factor al calcular |
| Sueldos fijos | Configuración individual por empleado con snapshot en la liquidación | Un cambio futuro de salario no altera períodos ya calculados |
| Nómina fiscal | Catálogo de conceptos, reglas legales versionadas y aprobación explícita | Ninguna regla nueva se aplica sin fuente, versión y aprobación |
| Otros pagos | Conceptos de ingreso y aportes patronales, más bonos manuales | Cada adicional aparece con nombre, tipo, base, moneda y monto |
| Bonos opcionales | Bonos por línea con nota y ajuste manual | El bono puede habilitarse por recibo sin alterar la base calculada |
| Descuentos | Deducciones, anticipos, faltas, retenciones y préstamos | El neto concilia: ingresos menos deducciones |
| Multimoneda | USD, VES, EUR y USDT; snapshots y tasa manual | Cada conversión conserva valor, fuente, fecha y aprobación |
| Tasas BCV/Euro/USDT | Adaptador de fuentes externas pendiente de enlazar al proveedor aprobado | La liquidación usa snapshot del período, nunca la tasa actual |
| Auditoría | Registro de acciones sensibles de nómina | Crear, corregir, cerrar, pagar, revertir y aprobar dejan trazabilidad |

## Estado actual del código

- [x] Ruta, navegación, botón desde Personal y configuración de nómina retirados del POS.
- [x] Personal permanece sin cambios funcionales.
- [x] Frontend de nómina separado en un shell independiente con nombre **Nómina y Finanzas Construacero Carabobo**.
- [x] Worker de nómina separado del Worker del POS.
- [x] Migraciones de nómina separadas del directorio de migraciones del POS.
- [x] Validación de tenant y permisos para el único rol administración.
- [x] Cálculo de asistencia, extras, sábado, feriado, bonos, deducciones, cierre y pagos.
- [x] PDFs de planilla y recibo.
- [x] El paquete no contiene imports hacia `../src`, `../api` ni `../supabase`; el endpoint de empleados es interno y el contrato está documentado.
- [x] Definir el contrato mínimo de empleados sincronizados desde Personal (`/api/nomina/empleados`).
- [ ] Conectar proveedores BCV, Euro y USDT aprobados por el negocio.
- [x] Pantalla administrativa responsive de calendario, tasas, conceptos y reglas legales; las reglas nuevas quedan pendientes de aprobación.
- [x] Agregar guardrails de CI, scanner de estructura/secretos y migración 220 de integridad por tenant.

## Fases para dejarlo listo para usar

### Fase 1 — Repositorio

1. Crear el repositorio `nomina-construacero`.
2. Copiar el contenido de `nomina-construacero/` como raíz del repositorio.
3. Copiar dentro de esa raíz los componentes, hooks, cliente Supabase, autenticación y utilidades visuales que hoy están marcados como puente temporal.
4. Cambiar imports relativos al POS por imports internos del nuevo repositorio.
5. Instalar dependencias y ejecutar build, lint y pruebas.
6. Configurar Vercel/Cloudflare con el nombre y dominios definitivos.

### Fase 2 — Supabase

1. Crear un proyecto Supabase independiente.
2. Ejecutar `001_nomina_base_contract.sql` y luego las migraciones `208` a `222` en orden dentro de ese proyecto, nunca en el Supabase del POS.
3. Crear la tabla/contrato de operadores y perfiles del nuevo sistema.
4. Reemplazar la referencia histórica a `clientes` por una tabla o vista de empleados sincronizados:
   - `id_externo`
   - `nombre`
   - `documento` opcional
   - `activo`
   - `cuenta_id`
5. Crear la sincronización unidireccional POS Personal → Nómina. Nómina no debe crear ni editar fichas de Personal.
6. Revisar RLS con una cuenta de prueba por tenant y roles separados.
7. Configurar Realtime únicamente para asistencia, períodos, líneas y pagos.

### Fase 3 — Tasas y legal

1. Confirmar fuente y frecuencia de BCV, Euro y USDT.
2. Implementar el adaptador de consulta y guardar cada resultado como snapshot.
3. Permitir tasa manual con fuente, observación y aprobación.
4. Cargar reglas fiscales con fecha de vigencia, versión y fuente.
5. Probar reglas nuevas inactivas hasta aprobación.
6. Validar con contabilidad los casos de sueldo fijo, horas extras, feriados, bonos, anticipos, préstamos y retenciones.

### Fase 4 — QA operativo

- Entrada duplicada, salida duplicada y reintento de red.
- Cambio de día por zona horaria `America/Caracas`.
- Jornada nocturna y salida posterior a medianoche.
- Sábado laborable selectivo y rotativo.
- Feriado laborable y no laborable.
- Período abierto, cerrado, pagado y reabierto.
- Recalcular sin modificar líneas ya pagadas.
- Pago parcial, pago total y reversión.
- Conversión con BCV, Euro, USDT y tasa manual congelada.
- Pérdida de conexión en grilla de asistencia.
- Aislamiento entre dos cuentas.
- Rechazo de cualquier operador con rol heredado.
- PDFs en móvil y escritorio.

## Datos que debe entregar el negocio antes del deploy

- URL y anon key del Supabase nuevo.
- Service role key como secreto del Worker, nunca en frontend.
- Repositorio y rama destino.
- Dominio del frontend y Worker.
- Operador(es) con rol `administracion`; el PIN está deshabilitado temporalmente y debe reactivarse o sustituirse antes de usar dispositivos compartidos.
- Fuente aprobada de BCV, Euro y USDT.
- Reglas fiscales vigentes y su fuente legal.
- Jornada estándar, política de sábado, feriados y redondeo.
- Contrato o método de sincronización de empleados desde Personal.

## Definición de “listo para conectar”

El proyecto se considera listo cuando los únicos cambios de ambiente sean las variables de Supabase/Worker, el repositorio destino y los datos legales/operativos aprobados; no debe requerir reescribir la lógica de cálculo ni modificar el POS.
