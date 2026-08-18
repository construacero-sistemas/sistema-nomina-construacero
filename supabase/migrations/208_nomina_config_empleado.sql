-- supabase/migrations/208_nomina_config_empleado.sql
-- Configuración de nómina por empleado (sprint 0).
-- Un empleado (clientes.tipo_cliente = 'personal') puede no tener config todavía;
-- solo aparece en nómina cuando se le asigne una fila aquí.

CREATE TABLE IF NOT EXISTS public.nomina_config_empleado (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id     UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  cargo           TEXT,
  fecha_ingreso   DATE,
  salario_dia_usd NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (salario_dia_usd >= 0),
  horas_jornada   NUMERIC(4,2)  NOT NULL DEFAULT 8.00 CHECK (horas_jornada > 0),
  hora_inicio     TIME NOT NULL DEFAULT '08:00',
  hora_fin        TIME NOT NULL DEFAULT '17:00',
  activo          BOOLEAN NOT NULL DEFAULT true,
  cuenta_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(empleado_id)
);

CREATE INDEX IF NOT EXISTS idx_nomina_config_cuenta
  ON public.nomina_config_empleado(cuenta_id, activo);

ALTER TABLE public.nomina_config_empleado ENABLE ROW LEVEL SECURITY;
