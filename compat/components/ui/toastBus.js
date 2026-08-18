let toastListener = null

export function setToastListener(listener) {
  toastListener = listener
  return () => {
    if (toastListener === listener) toastListener = null
  }
}

export function showToast(message, type = 'info', duration = 3500) {
  setTimeout(() => toastListener?.(message, type, duration), 0)
}

showToast.success = (message, duration) => showToast(message, 'success', duration)
showToast.error = (message, duration) => showToast(message, 'error', duration)
showToast.warning = (message, duration) => showToast(message, 'warning', duration)
showToast.info = (message, duration) => showToast(message, 'info', duration)
