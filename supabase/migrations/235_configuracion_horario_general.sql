-- 235_configuracion_horario_general.sql
-- Columnas para configuración del horario laboral general y jornada estándar de la empresa en configuracion_negocio.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_hora_inicio TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS nomina_hora_fin TEXT NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS nomina_horas_jornada NUMERIC(4,2) NOT NULL DEFAULT 8.00,
  ADD COLUMN IF NOT EXISTS nomina_horas_descanso NUMERIC(4,2) NOT NULL DEFAULT 1.00;
