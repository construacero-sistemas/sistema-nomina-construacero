// Frontend component test setup: jest-dom matchers + cleanup between tests.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom no implementa scrollIntoView (jsdom#1699); CustomSelect lo usa para
// mantener visible la opción activa al navegar con flechas.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

afterEach(() => {
  cleanup()
})
