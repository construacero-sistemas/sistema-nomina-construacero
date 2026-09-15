# Plan de aceptación en iPhone físico — Nómina y Finanzas Construacero

**Fecha:** 15/09/2026 · **Origen:** hallazgos de la auditoría E2E del 12/09 (`outputs/audit-2026-09-12/`) y cierre local (`outputs/cierre-local-i0umv8qi/`).
**Alcance:** validación en **iPhone físico** con Safari iOS y PWA instalada. Todo lo que Chromium no puede probar está marcado ⚠️.
**Distribuidor objetivo:** la app se entrega vía Vercel (`nomina-construacero.vercel.app`); probar con build de producción, no con dev server.

---

## 0. Preparación del dispositivo (una vez)

| # | Paso | Referencia |
|---|---|---|
| 0.1 | iPhone con iOS actual; Safari; brillo normal; **Ajustes → Safari → "Desactivar experimentos"** | — |
| 0.2 | Desactivar Bloqueador de contenido; activar JavaScript (por defecto) | — |
| 0.3 | Acceso guiado/VoiceOver: Ajustes → Accesibilidad → VoiceOver (para sección 6) | — |
| 0.4 | Conexión real (no localhost): `https://nomina-construacero.vercel.app` | DEP-01 |

---

## 1. Instalación y arranque como PWA (hallazgos PWA-01, PERF-01)

| # | Prueba | Criterio de aceptación | Hallazgo | ⚠️ solo físico |
|---|---|---|---|---|
| 1.1 | Compartir → "Añadir a pantalla de inicio" | Aparece icono **Construacero** (no captura de página) | PWA | ⚠️ |
| 1.2 | Abrir desde el icono | Arranca **standalone** (sin barra de Safari), pantalla de login legible | PWA | ⚠️ |
| 1.3 | Estado de red avión → abrir app | Se muestra **estado offline** o mensaje claro; no pantalla en blanco | PWA-01 | ⚠️ |
| 1.4 | Publicar un despliegue nuevo → abrir la PWA dos veces | El service worker toma la versión nueva tras cerrar/reabrir; **sin** acumulación de cachés viejas (nombre de caché con `__BUILD_ID__`) | PWA-01 | ⚠️ |
| 1.5 | Después de 1.4: comprobar en Ajustes → Almacenamiento que no crece sin límite | Las cachés `nomina-shell-<id>` antiguas se depuran en `activate` | PWA-01 | ⚠️ |
| 1.6 | Cronometrar apertura en frío (avión→datos) | El **PDF/jsPDF no bloquea el arranque** (chunk separado, `index` ≈ 208 KiB gzip) | PERF-01 | parcial |

**Qué NO cubre Chromium:** instalación real (banner/icono), standalone, ciclo de vida del SW con despliegues sucesivos, caché en frío del dispositivo.

---

## 2. Safe areas y layout (hallazgo MOB-03, viewport `black-translucent`)

Con `black-translucent` el contenido pasa por debajo de la barra de estado: **el riesgo de solape es real**, no cosmético.

| # | Prueba | Criterio | ⚠️ solo físico |
|---|---|---|---|
| 2.1 | Login con notch: texto superior y campos | Nada queda bajo la muesca ni el island dinámico | ⚠️ |
| 2.2 | App instalada: cabecera y primer botón en todas las pestañas | Respetan `env(safe-area-inset-top)` | ⚠️ |
| 2.3 | Scroll al fondo en Movimientos/Nómina | El último botón no queda bajo el **home indicator** (`safe-area-inset-bottom`) | ⚠️ |
| 2.4 | Selector a pantalla completa (CustomSelect) | La primera opción no empieza en `top:0` desnudo; hay padding de safe area superior | MOB-03 ⚠️ |
| 2.5 | Orientación horizontal (si se usa) | Header/footers siguen legibles | ⚠️ |

---

## 3. Teclado virtual (hallazgos MOB-02, MOB-03)

| # | Prueba | Criterio | ⚠️ |
|---|---|---|---|
| 3.1 | Enfocar email/contraseña en login | **No hay zoom involuntario** (inputs ≥16 px) — mirar con la regla de accesibilidad iOS si hay duda | MOB-02 ⚠️ |
| 3.2 | Enfocar búsqueda de empleados y concepto de movimiento | Igual: sin zoom; el campo sigue visible | MOB-02 ⚠️ |
| 3.3 | Abrir selector y enfocar su filtro con teclado abierto | El teclado **no tapa** la opción seleccionada (`100dvh` coordina con teclado) | MOB-03 ⚠️ |
| 3.4 | Formulario de movimiento con teclado abierto → tap fuera / botón cerrar | Cierra solo el formulario; **no** descarta a la mitad del guardado | MOB-07 |
| 3.5 | Teclado decimal en **monto** (es-VE: coma) | Acepta coma y punto; el importe no se multiplica ×1000 | fix previo ⚠️ |
| 3.6 | Pagar nómina: completar campos con teclado | La **tasa elegida y el método** se reflejan en el resumen antes de guardar | PAY-01 |

---

## 4. Gestos y overlays (hallazgos MOB-03, MOB-04, MOB-07)

| # | Prueba | Criterio | ⚠️ |
|---|---|---|---|
| 4.1 | Pinzar para hacer zoom en un listado | **El zoom voluntario funciona** (leer importes pequeños) | MOB-04 ⚠️ |
| 4.2 | Doble tap sobre un importe | No dispara zoom accidental que rompa el layout (equilibrio con 4.1) | MOB-04 ⚠️ |
| 4.3 | Abrir modal → arrastrar desde el tirador (grabber) hacia abajo | El **bottom sheet se cierra con el gesto** | ⚠️ |
| 4.4 | Bottom sheet con guardado en curso → arrastrar hacia abajo | **No** se cierra mientras guarda (consistencia de vías de cierre) | MOB-07 |
| 4.5 | Selector abierto dentro de un formulario → botón "volver"/cierre del selector | Vuelve al formulario **sin cerrarlo** ni perder datos | MOB-03 |
| 4.6 | Swipe del borde (gesto atrás de iOS) en una PWA standalone | No provoca estado roto ni navegación inesperada | ⚠️ |
| 4.7 | Scroll horizontal de tablas anchas (movimientos) con indicador | Se desplaza suave con inercia iOS; indicador visible | ⚠️ |

---

## 5. Flujos financieros end-to-end en Safari y PWA

Cada prueba debe ejecutarse **dos veces**: en Safari y desde la PWA instalada.

| # | Prueba | Criterio | Hallazgo |
|---|---|---|---|
| 5.1 | Crear ingreso y egreso con cuenta asignada | Quedan registrados con motivo, categoría y cuenta; contravalor USD con la **tasa activa del sistema** | FIN/PAY |
| 5.2 | Pagar nómina de un recibo (cerrado, no pagado) | Se marca pagado, se crea el asiento con **tasa y método**; la UI espera confirmación real (nada de "éxito" con 500) | PAY-01/02 |
| 5.3 | Revertir el pago del recibo | Recibo vuelve a "no pagado" y el asiento queda anulado con motivo | PAY-03 |
| 5.4 | Traspaso entre dos cuentas (misma moneda) | Dos asientos pareja; el origen no queda debitado sin destino (operación atómica) | FIN-03 |
| 5.5 | Traspaso con libro no conciliado | Mensaje claro pidiendo conciliación (PT422), no error genérico | 240 |
| 5.6 | Reintento tras corte de red a mitad de pago | Con la misma clave de idempotencia **no duplica** el asiento; muestra el estado de la operación | 238 |
| 5.7 | Historial con >50 movimientos | La paginación avanza (siguiente página RPC), el saldo de Tesorería **no depende de la página** | FIN-01/02 |
| 5.8 | Exportar PDF (Safari y PWA), caché fría y caliente | Impresión/descarga funcionan; si Safari bloquea la ventana hay mensaje visible, no silencio | IOS-01 ⚠️ |

---

## 6. VoiceOver y accesibilidad (hallazgos MOB-05, A11Y-01)

| # | Prueba | Criterio | ⚠️ |
|---|---|---|---|
| 6.1 | Navegar login con VoiceOver | Todos los campos y botones se anuncian con etiqueta y estado | ⚠️ |
| 6.2 | Drawer cerrado | **No** es alcanzable por VoiceOver ni foco (inert/oculto semánticamente) | MOB-05 ⚠️ |
| 6.3 | Modal abierto: barrido de VoiceOver | El foco queda dentro del modal; Escape/cierre devuelve el foco al disparador | MOB-03/07 |
| 6.4 | Subtítulos y placeholders marcados en axe (2.34:1) | Legibles en pantalla; contraste corregido o aceptado explícitamente | A11Y-01 |
| 6.5 | Texto dinámico iOS al **200 %** | La app sigue operable sin controles perdidos | MOB-04 ⚠️ |
| 6.6 | Días del calendario con VoiceOver | Cada día anuncia nombre completo (no "D", "L") y estado (habilitado/deshabilitado) | DATE-01 |

---

## 7. Estados de red y de error (hallazgo UX-01, AUTH-02)

| # | Prueba | Criterio | ⚠️ |
|---|---|---|---|
| 7.1 | Forzar fallo de perfil (credencial revocada) | Pantalla de acceso con **mensaje de error real**, no en blanco | AUTH-02 |
| 7.2 | Forzar HTTP 500 en movimientos (proxy o cuenta sin datos) | Se muestra error de lectura; **no** se presenta como "sin datos" | UX-01 |
| 7.3 | Modo avión → recuperar red | La app se reconecta y recarga datos; sin caché enmascarando error | UX-01 ⚠️ |
| 7.4 | Cerrar sesión desde PWA | No quedan pantallas administrativas cacheadas; siguiente arranque pide login | AUTH-03 ⚠️ |

---

## 8. Dispositivos y condiciones mínimas

- **iPhone SE (375 px)** — el más pequeño soportado; es donde MOB-06 se manifestó.
- **iPhone con Dynamic Island (14/15/16 Pro)** — safe areas.
- Safari iOS actual + una versión anterior razonable si es posible.
- Probar con **batería baja** y **tamaño de texto máx.** al menos una vez.
- Cada ítem: registrar ✅ / ❌ + captura de pantalla y versión de iOS.

## 9. Qué no puede automatizar Chromium (resumen honesto)

1. Instalación real de la PWA y modo standalone (1.x).
2. Ciclo de vida del service worker entre despliegues y depuración de cachés (1.4–1.5).
3. Zoom involuntario del teclado — es comportamiento de Safari, no de un emulador (3.1–3.2).
4. Safe areas reales: notch, island y home indicator (2.x).
5. Gestos del sistema iOS: swipe atrás, grabber con inercia táctil real,gesturestart del sistema (4.2, 4.6, 4.3).
6. VoiceOver: orden de foco real, anuncios y barrido (sección 6) — axe no sustituye esto.
7. window.open/impresión en el motor real de Safari y en PWA (IOS-01).
8. Comportamiento de `interactive-widget=resizes-content` con teclado real (3.3).
9. Rendimiento térmico/red del dispositivo (5.8 en frío, arranque en frío 1.6).

## 10. Criterio de salida

- **Bloqueantes (impiden liberar a usuarios):** todo ❌ en secciones 2, 3.1, 4.1, 5.1–5.6, 6.2, 7.1.
- Los ❌ de secciones 1 y 5.7–5.8 y 6.x restantes pueden liberarse con plan de mitigación documentado, previa decisión del responsable.
