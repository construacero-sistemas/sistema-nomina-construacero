// src/components/nomina/HolidayCalendarModal.jsx
// Modal a pantalla completa / amplia para explorar y gestionar el calendario laboral de feriados.
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import HolidayManager from './HolidayManager.jsx'

export default function HolidayCalendarModal({ feriados, onClose }) {
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Calendario Laboral y Feriados Oficiales"
      className="max-w-6xl w-full"
    >
      <div className="pt-1">
        <HolidayManager feriados={feriados} isEmbedded={true} />
      </div>
    </Modal>
  )
}
