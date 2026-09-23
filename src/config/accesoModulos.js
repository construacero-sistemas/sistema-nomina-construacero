// src/config/accesoModulos.js
// Compuertas de rol del frontend. Este archivo NO define roles ni capacidades:
// reexporta la matriz única del proyecto (server/lib/permissions.js) para que la
// interfaz y el Worker usen exactamente las mismas reglas. Es el mismo patrón que
// src/utils/carterasHelper.js → server/lib/carterasHelper.js.
//
// El servidor es la autoridad; la interfaz solo decide qué pestañas y consultas
// se habilitan. Si el servidor niega un endpoint, la UI ya no lo habrá mostrado.
//
// Disponible aquí: accesoUI, rutaParaRol, etiquetaRol, capacidadesDe,
// tieneCapacidad, rolesConCapacidad, ROLES_VALIDOS, ROLES_OPERATIVOS,
// ROLES_ASIGNABLES y CAPACIDADES.
export * from '../../server/lib/permissions.js'
