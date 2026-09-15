// Frontend component test setup: jest-dom matchers + cleanup between tests.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom does not implement scrolling; preserve CustomSelect keyboard behavior.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

afterEach(() => {
  cleanup()
})
