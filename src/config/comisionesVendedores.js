// src/config/comisionesVendedores.js
// Los vendedores NO van en la nómina (decisión del negocio, 2026-11-15). Con la
// bandera en false se ocultan: importar comisiones del POS al recibo, la
// modalidad «Por Comisión (Vendedor)» de la ficha y el pago de comisiones desde
// Empleados. El código se conserva; reactivar = poner esta bandera en true.
export const VENDEDORES_EN_NOMINA = false
