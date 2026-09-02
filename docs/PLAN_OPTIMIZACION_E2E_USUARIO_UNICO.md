# Auditoría E2E y plan de optimización — acceso de usuario único

**Fecha:** 29 de agosto de 2026  
**Objetivo:** eliminar la zona de selección/login repetitiva y conservar un acceso inicial por correo y contraseña, priorizando velocidad sin sacrificar exactitud financiera.

## 1. Hallazgos de la auditoría

### Estado actual

El sistema ya tiene una cuenta de negocio persistente en Supabase, sesión persistente y renovación automática del token. Sin embargo, después del login todavía existe un segundo flujo de selección de operador:

```text
Correo + contraseña → seleccionar usuario → establecer app_metadata → refrescar JWT → entrar
```

Ese segundo paso ya no aporta valor si habrá una sola cuenta y un solo usuario administrativo.

### Evidencia revisada

- `compat/modules/auth/LoginPage.jsx`: mantiene `GateStep` y `UserSelectStep`; carga usuarios mediante RPC/cache y llama a `/api/auth/select-operator`.
- `compat/store/useAuthStore.js`: mantiene selección/cambio de operador, cache de operadores, `operator_id` en metadata y limpieza específica del operador.
- `src/NominaApp.jsx`: protege las rutas exigiendo `perfil.rol === 'administracion'` y ofrece “Cambiar usuario” en sidebar, drawer y navegación móvil.
- `server/handlers/auth-operators.js`: mantiene endpoints de selección, cambio y limpieza, además de aceptar PIN en la ruta histórica.
- `worker.js`: expone las cuatro rutas de operadores.
- `compat/services/supabase/client.js`: ya tiene `persistSession: true` y `autoRefreshToken: true`.
- Pruebas existentes: cubren auth, handlers, Worker, Finanzas y Nómina; no hay navegador E2E real, por lo que la aceptación visual/operativa aún debe hacerse manualmente.

### Riesgos actuales

1. **Fricción:** la selección de usuario añade una pantalla, una consulta, una mutación de metadata y un refresh de sesión.
2. **Complejidad:** existen rutas y estados para cambio de operador que ya no representan el negocio.
3. **Riesgo de inconsistencia:** el usuario visible, `perfil` y `app_metadata` pueden quedar desincronizados durante cortes de red.
4. **Cache duplicado:** operadores y perfil se cachean por separado aunque solo existe una identidad operativa.
5. **Logout ambiguo:** el botón “Cambiar usuario” realmente limpia el operador y no cierra la cuenta; con usuario único debe llamarse “Cerrar sesión”.
6. **E2E incompleto:** las pruebas automatizadas no validan un navegador real, persistencia tras recarga, expiración/refresh, ni los recorridos financieros con interacción visual.

## 2. Arquitectura objetivo

```text
Primera visita:
  correo + contraseña → Supabase signInWithPassword → cargar perfil único → aplicación

Visitas siguientes:
  sesión persistida → refresh automático si corresponde → cargar perfil único → aplicación

Sesión inválida o logout:
  volver al formulario inicial
```

La autorización continúa siendo server-side: cada endpoint sensible debe validar el JWT, resolver la cuenta y exigir el único rol permitido (`administracion`). “Un solo usuario” simplifica la UX, pero no debe convertir el frontend en una autoridad.

## 3. Alcance recomendado

### P0 — Eliminar la selección de usuario

- Convertir el login en una sola pantalla y una sola acción.
- Tras `signInWithPassword`, resolver automáticamente el único usuario administrativo de la cuenta.
- Cargar `perfil` desde una ruta server-side de identidad o desde una consulta explícita protegida; no confiar en `localStorage` ni en `app_metadata` escrito por el cliente.
- Redirigir directamente a `/nomina` o a la última sección válida.
- Quitar `UserSelectStep`, `selectOperator`, `switchOperator`, `switchOut` y el cache de operadores cuando ya no tengan consumidores.
- Sustituir “Cambiar usuario” por “Cerrar sesión”.

### P1 — Sesión persistente y arranque rápido

- Mantener `persistSession: true` y `autoRefreshToken: true`.
- No mostrar login mientras se restaura una sesión válida; usar un splash breve y determinista.
- Resolver el perfil único en paralelo con la hidratación de React Query cuando sea posible.
- Evitar refresh manual duplicado: Supabase ya renueva el token automáticamente; solo reintentar una petición una vez ante `401`.
- Mantener cache de consultas de lectura, pero invalidar movimientos financieros y nómina después de cada mutación.
- No persistir contraseñas, tokens manuales ni importes sin necesidad.

### P1 — Exactitud financiera

- Conservar cálculo server-side de `monto_ves`, tasas, totales y balances.
- Mantener idempotencia para crear movimientos, pagos y marcajes.
- Mantener anulación auditada; nunca borrar movimientos financieros confirmados.
- Mostrar confirmación con subtotal, tasa aplicada, total convertido y estado guardado.
- Probar reintentos, doble clic, pérdida de red y refresh del navegador sin duplicar operaciones.

### P2 — Simplificación visual

- Un único CTA: “Acceder”.
- En sesión activa, mostrar únicamente nombre/correo de la cuenta y “Cerrar sesión”.
- Retirar badges y textos de operador si no aportan información.
- Mantener mensajes concretos: “Sesión guardada en este dispositivo”, “Tu sesión venció”, “Guardado correctamente”.
- Priorizar las tareas: marcar asistencia, preparar/pagar nómina y registrar movimiento financiero.

## 4. Contrato funcional propuesto

### Cuenta

- Una cuenta Supabase representa el negocio.
- Un usuario administrativo activo representa al único operador.
- El correo y la contraseña se solicitan únicamente cuando no existe una sesión válida.
- La sesión se conserva en el dispositivo hasta logout, revocación o expiración no recuperable.

### Reglas de fallback

- Si existe sesión válida pero el perfil único no se puede cargar: mostrar error con reintento, no una pantalla de selección.
- Si no existe usuario administrativo configurado: mostrar “Configura el usuario administrador” y bloquear operaciones.
- Si el token expira: renovar automáticamente; si falla, informar que debe iniciar sesión de nuevo.
- Si no hay red: permitir únicamente vistas/cache explícitamente aprobadas; no confirmar escrituras financieras que no llegaron al servidor.

## 5. Plan de implementación por fases

### Fase A — Refactor de auth

1. Crear una función única `loadCurrentProfile` en el store.
2. Reemplazar el flujo de selección por carga automática del perfil único.
3. Simplificar `Protected` y `Public` para depender de `user + perfil` sin estados de operador.
4. Eliminar el botón y las rutas de cambio de usuario del frontend.
5. Conservar `logout` como única salida manual.

### Fase B — API y datos

1. Añadir una ruta de identidad actual, por ejemplo `GET /api/auth/me`, que devuelva solo el perfil administrativo mínimo.
2. Validar en el Worker que la cuenta tenga exactamente un usuario administrativo activo.
3. Mantener compatibilidad temporal con las rutas antiguas solo durante una migración controlada; después retirarlas.
4. Revisar RPC, políticas y migraciones para eliminar dependencias de selección/app_metadata.
5. No modificar datos históricos de nómina o Finanzas.

### Fase C — Rendimiento

1. Medir tiempo desde carga hasta dashboard operativo.
2. Paralelizar identidad, configuración y tasas no críticas.
3. Reducir llamadas duplicadas de auth y evitar `refreshSession()` después de cada acceso.
4. Mantener cache de catálogos/configuración y TTL corto para movimientos/resúmenes.
5. Añadir métricas de errores de red, 401, latencia y operaciones repetidas sin registrar secretos.

### Fase D — E2E real

#### Acceso

- Primera visita: correo correcto y contraseña correcta entra en un paso.
- Credenciales incorrectas muestran error claro sin bloquear permanentemente.
- Recarga conserva la sesión.
- Cierre de sesión elimina el acceso local y devuelve al login.
- Token próximo a vencer se renueva sin expulsar al usuario.
- Token inválido obliga a volver al login.

#### Nómina

- Abrir Nómina desde sesión restaurada.
- Registrar entrada/salida una vez.
- Reintentar el mismo marcaje sin duplicar.
- Crear período, calcular, revisar, cerrar y pagar.
- Revertir pago y verificar auditoría.
- Confirmar que los montos permanecen iguales después de recarga.

#### Finanzas

- Crear ingreso y egreso.
- Validar moneda, tasa y conversión server-side.
- Reintentar creación con la misma idempotency key sin duplicar.
- Consultar resumen y balance.
- Anular movimiento y comprobar que el historial conserva el registro.
- Verificar que el balance excluye anulados según el contrato.

#### Red y dispositivos

- Recarga durante una lectura.
- Pérdida de red antes y después de guardar.
- Móvil 360/390 px, escritorio 1366 px, teclado y zoom 200 %.
- Dos pestañas con la misma cuenta y logout en una de ellas.

## 6. Criterios de aceptación

- El usuario entra con correo y contraseña en un único formulario.
- No existe pantalla, modal ni botón de selección/cambio de usuario.
- Una recarga normal no solicita credenciales nuevamente.
- Logout sí solicita credenciales en la siguiente entrada.
- Ningún cálculo financiero depende del cliente para su resultado final.
- Doble clic y reintentos no generan duplicados.
- `npm run verify` permanece en verde.
- La aceptación manual completa los recorridos de acceso, Nómina y Finanzas sin instrucciones adicionales.
- Las rutas antiguas de operador quedan eliminadas o claramente deshabilitadas tras confirmar que no hay clientes activos que las usen.

## 7. Orden recomendado de ejecución

1. Implementar `/api/auth/me` y pruebas de cuenta/rol único.
2. Cambiar store y `LoginPage` a login directo.
3. Cambiar navegación y logout.
4. Actualizar pruebas de auth y Worker.
5. Ejecutar verify y prueba manual con sesión persistente.
6. Retirar endpoints y código muerto de operadores.
7. Medir tiempos y optimizar consultas restantes.

## 8. Decisiones que requieren confirmación operativa

- Si habrá un único dispositivo o varios dispositivos con la misma cuenta.
- Si el logout debe estar disponible en todos los dispositivos o solo cerrar el dispositivo actual.
- Si se acepta operar sin red solo para consultas cacheadas, nunca para confirmar movimientos financieros.
- Quién puede recuperar la cuenta si se pierde el acceso al correo.

## Conclusión

El cambio correcto no es quitar la autenticación, sino convertirla en **un acceso inicial único con sesión persistente**. Se elimina la selección de operador, se conserva la validación server-side y se concentra la optimización en menos round-trips, menos estados de UI y controles financieros intactos.
