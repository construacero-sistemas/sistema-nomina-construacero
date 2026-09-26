-- supabase/migrations/246_nomina_control_asistencia.sql
-- Control de asistencia por empleado: separa dos preguntas que antes estaban
-- pegadas en una sola columna.
--   activo             → ¿está en nómina (recibe períodos)?
--   controla_asistencia→ ¿se le registra asistencia (marcaje y horas)?
-- Los perfiles que cobran por comisión no marcan asistencia; hasta ahora la única
-- forma de sacarlos de la zona de Asistencia era darles de baja, lo que también
-- los excluía de nómina. Con este flag la lista diaria, la matriz semanal, el
-- conteo de pendientes, la carga masiva y el marcaje real solo muestran a quien
-- realmente se le controla la asistencia.
--
-- DEFAULT true: al aplicar la migración nadie cambia de comportamiento; el
-- apagado es explícito por empleado desde su ficha.

ALTER TABLE public.nomina_config_empleado
  ADD COLUMN IF NOT EXISTS controla_asistencia BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.nomina_config_empleado.controla_asistencia IS
  'false = el empleado no aparece en la zona de Asistencia y su pago no depende de días registrados.';
