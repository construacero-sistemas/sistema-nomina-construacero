// Kit UI compartido — superficie única de importación.
// Todo componente nuevo debe importar desde aquí para que el sistema conserve
// un solo dialecto de estilos (tokens del sistema de diseño). Los primitivos
// heredados de compat/ se reexportan para migrar sin romper imports existentes.
export { default as Button } from './Button.jsx'
export { default as Card, CardTitle, CardDescription } from './Card.jsx'
export { default as Switch } from './Switch.jsx'
export { Modal } from '../../../compat/components/ui/Modal.jsx'
export { default as CustomSelect } from '../../../compat/components/ui/CustomSelect.jsx'
export { showToast } from '../../../compat/components/ui/toastBus.js'
