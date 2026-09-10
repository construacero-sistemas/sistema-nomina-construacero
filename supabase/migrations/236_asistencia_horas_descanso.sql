-- supabase/migrations/236_asistencia_horas_descanso.sql
-- Permite registrar horas de descanso específicas por jornada en registro_asistencia.
-- Si es NULL, se asume la configuración general de nómina (nomina_horas_descanso).

ALTER TABLE public.registro_asistencia
  ADD COLUMN IF NOT EXISTS horas_descanso NUMERIC(4,2) DEFAULT NULL;

COMMENT ON COLUMN public.registro_asistencia.horas_descanso IS
  'Horas de descanso o almuerzo aplicadas a la jornada. Si es NULL, se adopta nomina_horas_descanso de configuracion_negocio.';
