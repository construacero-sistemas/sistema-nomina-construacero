-- Calendario laboral por cuenta: feriados y horarios selectivos/rotativos.

CREATE TABLE IF NOT EXISTS public.nomina_feriados (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha       DATE NOT NULL,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'empresa'
              CHECK (tipo IN ('nacional','regional','empresa')),
  laborable   BOOLEAN NOT NULL DEFAULT false,  cuenta_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  creado_por  UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cuenta_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.nomina_horarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id     UUID REFERENCES public.clientes(id) ON DELETE RESTRICT,
  dia_semana      SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  semana_ciclo    SMALLINT CHECK (semana_ciclo IS NULL OR semana_ciclo BETWEEN 1 AND 5),
  grupo_rotacion  TEXT,
  fecha_desde     DATE NOT NULL,
  fecha_hasta     DATE,
  hora_inicio     TIME NOT NULL,
  hora_fin        TIME NOT NULL,
  horas_jornada   NUMERIC(4,2) NOT NULL CHECK (horas_jornada > 0),
  trabaja         BOOLEAN NOT NULL DEFAULT true,
  cuenta_id       UUID NOT NULL,
  creado_por      UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fecha_hasta IS NULL OR fecha_hasta >= fecha_desde)
);

CREATE INDEX IF NOT EXISTS idx_nomina_feriados_cuenta_fecha
  ON public.nomina_feriados(cuenta_id, fecha);
CREATE INDEX IF NOT EXISTS idx_nomina_horarios_cuenta_fecha
  ON public.nomina_horarios(cuenta_id, fecha_desde, fecha_hasta);
CREATE INDEX IF NOT EXISTS idx_nomina_horarios_empleado_dia
  ON public.nomina_horarios(cuenta_id, empleado_id, dia_semana);

ALTER TABLE public.nomina_feriados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomina_horarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nomina_feriados_tenant_restrictive ON public.nomina_feriados;
CREATE POLICY nomina_feriados_tenant_restrictive ON public.nomina_feriados
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

DROP POLICY IF EXISTS nomina_horarios_tenant_restrictive ON public.nomina_horarios;
CREATE POLICY nomina_horarios_tenant_restrictive ON public.nomina_horarios
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cuenta_id = auth.uid()) WITH CHECK (cuenta_id = auth.uid());

-- Políticas permisivas por rol; las restrictivas anteriores siguen imponiendo
-- el tenant incluso cuando una llamada directa usa el JWT del usuario.
DROP POLICY IF EXISTS nomina_feriados_admin_all ON public.nomina_feriados;
CREATE POLICY nomina_feriados_admin_all ON public.nomina_feriados
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
DROP POLICY IF EXISTS nomina_feriados_logistica_select ON public.nomina_feriados;
CREATE POLICY nomina_feriados_logistica_select ON public.nomina_feriados
  FOR SELECT TO authenticated
  USING (get_rol_actual() = 'logistica');

DROP POLICY IF EXISTS nomina_horarios_admin_all ON public.nomina_horarios;
CREATE POLICY nomina_horarios_admin_all ON public.nomina_horarios
  FOR ALL TO authenticated
  USING (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'))
  WITH CHECK (get_rol_actual() IN ('administracion', 'jefe', 'desarrollador'));
DROP POLICY IF EXISTS nomina_horarios_logistica_select ON public.nomina_horarios;
CREATE POLICY nomina_horarios_logistica_select ON public.nomina_horarios
  FOR SELECT TO authenticated
  USING (get_rol_actual() = 'logistica');
