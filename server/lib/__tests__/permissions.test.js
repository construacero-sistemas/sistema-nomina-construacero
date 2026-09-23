// server/lib/__tests__/permissions.test.js
// Suite de la matriz de capacidades (única fuente de verdad de autorización).
// Estos tests son el guardrail del plan de roles: cualquier cambio en la matriz
// que rompa las reglas del negocio falla aquí antes de llegar a producción.
import { describe, expect, it } from 'vitest'
import {
  capacidadesDe, tieneCapacidad, requireCapacidad, isAdminOperator,
  requireAdmin, assertAdminRole, ROLES_VALIDOS, ADMIN_ROLE,
  CAPACIDADES, rolesConCapacidad, ROLES_OPERATIVOS, ROLES_ASIGNABLES,
  tieneAccesoOperativo, accesoUI, etiquetaRol, rutaParaRol,
  ROLES_CREABLES, longitudPin,
} from '../permissions.js'
// Espejo del frontend: debe ser el MISMO módulo, no una copia paralela.
import * as espejoFrontend from '../../../src/config/accesoModulos.js'

const CLAVES = ['verNomina', 'administrarNomina', 'verFinanzas', 'operarFinanzas', 'verSaldos', 'gestionarUsuarios', 'administrarSistema']

describe('matriz de capacidades — reglas del negocio', () => {
  it('jefe / desarrollador tienen TODO; administracion ya no es operativo', () => {
    for (const rol of ['jefe', 'desarrollador']) {
      const caps = capacidadesDe({ rol })
      for (const clave of CLAVES) expect(caps[clave], `${rol}.${clave}`).toBe(true)
    }
  })

  it('rol finanzas: opera el libro pero NUNCA ve saldos ni nómina ni usuarios', () => {
    const caps = capacidadesDe({ rol: 'finanzas' })
    expect(caps.verFinanzas).toBe(true)
    expect(caps.operarFinanzas).toBe(true)
    expect(caps.verSaldos).toBe(false)
    expect(caps.verNomina).toBe(false)
    expect(caps.administrarNomina).toBe(false)
    expect(caps.gestionarUsuarios).toBe(false)
    expect(caps.administrarSistema).toBe(false)
  })

  it('rol nomina: módulo nómina completo, finanzas invisible', () => {
    const caps = capacidadesDe({ rol: 'nomina' })
    expect(caps.verNomina).toBe(true)
    expect(caps.administrarNomina).toBe(true)
    expect(caps.verFinanzas).toBe(false)
    expect(caps.operarFinanzas).toBe(false)
    expect(caps.verSaldos).toBe(false)
    expect(caps.gestionarUsuarios).toBe(false)
  })

  it('roles sin entrada en la matriz (vendedor, supervisor, logistica, desconocido) no tienen nada', () => {
    for (const rol of ['vendedor', 'supervisor', 'logistica', 'vendedor_sin_comision', 'inventado', undefined]) {
      const caps = capacidadesDe({ rol })
      for (const clave of CLAVES) expect(caps[clave], `${rol ?? 'undefined'}.${clave}`).toBe(false)
    }
    // Sin operador (null/undefined) tampoco explota.
    for (const clave of CLAVES) expect(capacidadesDe(null)[clave]).toBe(false)
  })

  it('ROLES_VALIDOS incluye los 3 roles operativos nuevos y coincide con la migración 242', () => {
    for (const rol of ['jefe', 'finanzas', 'nomina', 'desarrollador']) {
      expect(ROLES_VALIDOS).toContain(rol)
    }
    expect(ROLES_VALIDOS).not.toContain('administracion')
    expect(ADMIN_ROLE).toBe('jefe')
  })
})

describe('helpers de autorización', () => {
  it('tieneCapacidad responde exactamente como la matriz', () => {
    expect(tieneCapacidad({ rol: 'finanzas' }, 'operarFinanzas')).toBe(true)
    expect(tieneCapacidad({ rol: 'finanzas' }, 'verSaldos')).toBe(false)
    expect(tieneCapacidad({ rol: 'nomina' }, 'administrarNomina')).toBe(true)
    expect(tieneCapacidad({ rol: 'nomina' }, 'verFinanzas')).toBe(false)
    expect(tieneCapacidad({ rol: 'jefe' }, 'gestionarUsuarios')).toBe(true)
  })

  it('requireCapacidad devuelve null si autoriza y Response 403 si no', async () => {
    const ok = requireCapacidad({ rol: 'finanzas' }, 'operarFinanzas')
    expect(ok).toBeNull()

    const denied = requireCapacidad({ rol: 'nomina' }, 'operarFinanzas')
    expect(denied).toBeTruthy()
    expect(denied.status).toBe(403)
    const body = await denied.json()
    expect(body.error).toMatch(/Acceso denegado/i)
  })

  it('isAdminOperator solo para quien gestiona usuarios', () => {
    expect(isAdminOperator({ rol: 'jefe' })).toBe(true)
    expect(isAdminOperator({ rol: 'desarrollador' })).toBe(true)
    expect(isAdminOperator({ rol: 'finanzas' })).toBe(false)
    expect(isAdminOperator({ rol: 'nomina' })).toBe(false)
  })

  it('requireAdmin bloquea a finanzas/nomina (crear categorías ya NO usa requireAdmin, pero sí gestión de cuentas)', async () => {
    expect(requireAdmin({ rol: 'jefe' })).toBeNull()
    const denied = requireAdmin({ rol: 'finanzas' })
    expect(denied.status).toBe(403)
  })

  it('assertAdminRole refleja la matriz sin tocar BD', () => {
    expect(assertAdminRole('jefe')).toBe(true)
    expect(assertAdminRole('finanzas')).toBe(false)
    expect(assertAdminRole('nomina')).toBe(false)
  })
})

describe('compuertas derivadas — ninguna lista de roles escrita a mano', () => {
  it('CAPACIDADES enumera exactamente las claves de la matriz', () => {
    expect([...CAPACIDADES].sort()).toEqual([...CLAVES].sort())
    for (const rol of ROLES_VALIDOS) {
      expect(Object.keys(capacidadesDe({ rol })).sort()).toEqual([...CAPACIDADES].sort())
    }
  })

  it('rolesConCapacidad coincide con la matriz en cada capacidad', () => {
    expect(rolesConCapacidad('verNomina')).toEqual(['desarrollador', 'jefe', 'nomina'])
    expect(rolesConCapacidad('administrarNomina')).toEqual(['desarrollador', 'jefe', 'nomina'])
    expect(rolesConCapacidad('verFinanzas')).toEqual(['desarrollador', 'jefe', 'finanzas'])
    expect(rolesConCapacidad('operarFinanzas')).toEqual(['desarrollador', 'jefe', 'finanzas'])
    // El secreto del negocio: finanzas opera pero NUNCA aparece en saldos.
    expect(rolesConCapacidad('verSaldos')).toEqual(['desarrollador', 'jefe'])
    expect(rolesConCapacidad('verSaldos')).not.toContain('finanzas')
    expect(rolesConCapacidad('gestionarUsuarios')).toEqual(['desarrollador', 'jefe'])
  })

  it('ROLES_OPERATIVOS excluye los roles heredados y ROLES_ASIGNABLES la cuenta técnica', () => {
    expect(ROLES_OPERATIVOS).toEqual(['desarrollador', 'jefe', 'finanzas', 'nomina'])
    for (const heredado of ['supervisor', 'vendedor', 'vendedor_sin_comision', 'logistica', 'inventado', undefined]) {
      expect(tieneAccesoOperativo({ rol: heredado })).toBe(false)
      expect(ROLES_OPERATIVOS).not.toContain(heredado)
    }
    expect(ROLES_ASIGNABLES).toEqual(['jefe', 'finanzas', 'nomina'])
    expect(ROLES_ASIGNABLES).not.toContain('desarrollador')
  })

  it('accesoUI es el espejo exacto de la matriz para todos los roles', () => {
    for (const rol of [...ROLES_VALIDOS, 'inventado', undefined]) {
      const capacidades = capacidadesDe({ rol })
      expect(accesoUI(rol), String(rol)).toEqual({
        nomina: capacidades.verNomina,
        finanzas: capacidades.verFinanzas,
        sistema: capacidades.administrarSistema,
      })
    }
    // El rol nomina nunca ve finanzas; finanzas nunca ve nómina.
    expect(accesoUI('nomina')).toEqual({ nomina: true, finanzas: false, sistema: false })
    expect(accesoUI('finanzas')).toEqual({ nomina: false, finanzas: true, sistema: false })
  })

  it('etiquetaRol y rutaParaRol no inventan roles', () => {
    expect(etiquetaRol('jefe')).toBe('Jefe')
    expect(etiquetaRol('finanzas')).toBe('Finanzas')
    expect(etiquetaRol('nomina')).toBe('Nómina')
    expect(etiquetaRol(null)).toBe('—')
    expect(etiquetaRol('desconocido')).toBe('desconocido')
    expect(rutaParaRol('finanzas')).toBe('/finanzas')
    expect(rutaParaRol('nomina')).toBe('/nomina')
    expect(rutaParaRol('jefe')).toBe('/finanzas')
  })

  it('el espejo del frontend es el mismo módulo (sin listas paralelas)', () => {
    expect(espejoFrontend.ROLES_VALIDOS).toBe(ROLES_VALIDOS)
    expect(espejoFrontend.ROLES_OPERATIVOS).toBe(ROLES_OPERATIVOS)
    expect(espejoFrontend.ROLES_ASIGNABLES).toBe(ROLES_ASIGNABLES)
    expect(espejoFrontend.ROLES_CREABLES).toBe(ROLES_CREABLES)
    expect(espejoFrontend.longitudPin).toBe(longitudPin)
    expect(espejoFrontend.accesoUI).toBe(accesoUI)
    expect(espejoFrontend.tieneCapacidad({ rol: 'finanzas' }, 'verSaldos')).toBe(false)
    expect(espejoFrontend.tieneCapacidad({ rol: 'jefe' }, 'verSaldos')).toBe(true)
  })
})

describe('política de PIN y roles creables (requisito del negocio)', () => {
  it('finanzas y nomina usan PIN de 4 dígitos; el resto, 6', () => {
    expect(longitudPin('finanzas')).toBe(4)
    expect(longitudPin('nomina')).toBe(4)
    for (const rol of ['jefe', 'desarrollador']) {
      expect(longitudPin(rol)).toBe(6)
    }
    // Roles heredados o desconocidos jamás quedan sin largo definido.
    for (const rol of ['vendedor', 'logistica', 'supervisor', 'desconocido', undefined, null]) {
      expect(longitudPin(rol)).toBe(6)
    }
  })

  it('ROLES_CREABLES ofrece jefe/finanzas/nomina y oculta administracion y la cuenta técnica', () => {
    expect([...ROLES_CREABLES]).toEqual(['jefe', 'finanzas', 'nomina'])
    expect(ROLES_CREABLES).not.toContain('administracion')
    expect(ROLES_CREABLES).not.toContain('desarrollador')
    expect(ROLES_ASIGNABLES).not.toContain('administracion')
  })
})
