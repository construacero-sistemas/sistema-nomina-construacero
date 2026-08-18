-- 212_nomina_config_rls.sql
-- Factores globales de nómina + políticas por rol.
-- La sintaxis DROP/CREATE se usa porque PostgreSQL no admite
-- CREATE POLICY IF NOT EXISTS.

ALTER TABLE public.configuracion_negocio
  ADD COLUMN IF NOT EXISTS nomina_factor_hora_extra      NUMERIC(4,2) NOT NULL DEFAULT 1.50
    CHECK (nomina_factor_hora_extra >= 1),
  ADD COLUMN IF NOT EXISTS nomina_factor_sabado          NUMERIC(4,2) NOT NULL DEFAULT 1.25
    CHECK (nomina_factor_sabado >= 1),
  ADD COLUMN IF NOT EXISTS nomina_factor_feriado         NUMERIC(4,2) NOT NULL DEFAULT 2.00
    CHECK (nomina_factor_feriado >= 1),
  ADD COLUMN IF NOT EXISTS nomina_tipo_periodo           TEXT NOT NULL DEFAULT 'semanal'
    CHECK (nomina_tipo_periodo IN ('semanal','quincenal','mensual')),
  ADD COLUMN IF NOT EXISTS nomina_horas_extra_max_semana NUMERIC(5,2) NOT NULL DEFAULT 10.00
    CHECK (nomina_horas_extra_max_semana >= 0);

DROP POLICY IF EXISTS nomina_config_admin_all ON public.nomina_config_empleado;
CREATE POLICY nomina_config_admin_all ON public.nomina_config_empleado
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion','jefe','desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion','jefe','desarrollador'));

-- No hay lectura directa de configuración salarial para logística. El Worker
-- expone únicamente la proyección operativa sin salario_dia_usd.
DROP POLICY IF EXISTS nomina_config_logistica_select ON public.nomina_config_empleado;

DROP POLICY IF EXISTS asistencia_admin_all ON public.registro_asistencia;
CREATE POLICY asistencia_admin_all ON public.registro_asistencia
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion','jefe','desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion','jefe','desarrollador'));

DROP POLICY IF EXISTS asistencia_logistica_all ON public.registro_asistencia;
DROP POLICY IF EXISTS asistencia_logistica_select ON public.registro_asistencia;
CREATE POLICY asistencia_logistica_select ON public.registro_asistencia
  FOR SELECT TO authenticated
  USING (get_rol_actual() = 'logistica');

DROP POLICY IF EXISTS nomina_periodos_admin_all ON public.nomina_periodos;
CREATE POLICY nomina_periodos_admin_all ON public.nomina_periodos
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion','jefe','desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion','jefe','desarrollador'));

-- Períodos y líneas contienen montos salariales; logística solo los usa a
-- través del Worker y no recibe lectura directa de estas tablas.
DROP POLICY IF EXISTS nomina_periodos_logistica_select ON public.nomina_periodos;

DROP POLICY IF EXISTS nomina_lineas_admin_all ON public.nomina_lineas;
CREATE POLICY nomina_lineas_admin_all ON public.nomina_lineas
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion','jefe','desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion','jefe','desarrollador'));

DROP POLICY IF EXISTS nomina_lineas_logistica_select ON public.nomina_lineas;
