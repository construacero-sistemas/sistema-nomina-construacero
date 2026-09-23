// compat/components/ui/3d-card.jsx
// Puerto del componente 3d-card del sistema de referencia
// (listo-pos-cotizaciones): inclinación 3D que sigue al mouse (perspective
// 600px) y capas con translateZ que sobresalen al inclinar la tarjeta.
import React, { createContext, useState, useContext, useRef, useEffect } from 'react'

const MouseEnterContext = createContext(undefined)

export const CardContainer = ({ children, className, containerClassName }) => {
  const containerRef = useRef(null)
  const [isMouseEntered, setIsMouseEntered] = useState(false)

  const handleMouseMove = (e) => {
    if (!containerRef.current) return
    const { left, top, width, height } = containerRef.current.getBoundingClientRect()
    const x = (e.clientX - left - width / 2) / 10
    const y = (e.clientY - top - height / 2) / 10
    containerRef.current.style.transform = `rotateY(${x}deg) rotateX(${y}deg)`
  }

  const handleMouseEnter = () => setIsMouseEntered(true)

  const handleMouseLeave = () => {
    if (!containerRef.current) return
    setIsMouseEntered(false)
    containerRef.current.style.transform = 'rotateY(0deg) rotateX(0deg)'
  }

  return (
    <MouseEnterContext.Provider value={[isMouseEntered, setIsMouseEntered]}>
      <div
        className={`py-5 flex items-center justify-center ${containerClassName || ''}`}
        style={{ perspective: '600px' }}
      >
        <div
          ref={containerRef}
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={`flex items-center justify-center relative transition-all duration-200 ease-linear ${className || ''}`}
          style={{ transformStyle: 'preserve-3d' }}
        >
          {children}
        </div>
      </div>
    </MouseEnterContext.Provider>
  )
}

export const CardBody = ({ children, className }) => (
  <div className={`[transform-style:preserve-3d] [&>*]:[transform-style:preserve-3d] ${className || ''}`}>
    {children}
  </div>
)

export const CardItem = ({
  as: Tag = 'div',
  children,
  className,
  translateX = 0,
  translateY = 0,
  translateZ = 0,
  rotateX = 0,
  rotateY = 0,
  rotateZ = 0,
  ...rest
}) => {
  const ref = useRef(null)
  const [isMouseEntered] = useMouseEnter()

  useEffect(() => {
    if (!ref.current) return
    if (isMouseEntered) {
      ref.current.style.transform = `translateX(${translateX}px) translateY(${translateY}px) translateZ(${translateZ}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`
    } else {
      ref.current.style.transform = 'translateX(0px) translateY(0px) translateZ(0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)'
    }
  }, [isMouseEntered, translateX, translateY, translateZ, rotateX, rotateY, rotateZ])

  return (
    <Tag ref={ref} className={`w-fit transition-transform duration-200 ease-linear ${className || ''}`} {...rest}>
      {children}
    </Tag>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMouseEnter = () => {
  const context = useContext(MouseEnterContext)
  // Fuera de un CardContainer no hay tilt: degradar en vez de lanzar para que
  // las tarjetas puedan renderizarse solas (p. ej. en pruebas o estados raros).
  return context ?? [false, () => {}]
}
