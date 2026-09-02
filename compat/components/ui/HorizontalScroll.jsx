// compat/components/ui/HorizontalScroll.jsx
// Contenedor de scroll horizontal con indicador visible para tablas anchas.
// Muestra una barra de scroll fina, atenuado (fade) en el borde con contenido
// oculto y una píldora "Desliza →" que desaparece al llegar al final.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export default function HorizontalScroll({
  children,
  className = '',
  contentClassName = '',
  fadeClass = 'from-white',
  hint = 'Desliza para ver más',
  showHint = true,
}) {
  const scrollRef = useRef(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Guardamos contra entornos sin rAF/ResizeObserver (p.ej. jsdom en tests).
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(update) : (update(), 0)
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    ro?.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      ro?.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update])

  return (
    <div className={`relative ${className}`}>
      <div
        ref={scrollRef}
        data-testid="hscroll"
        className={`overflow-x-auto overscroll-x-contain custom-scrollbar ${contentClassName}`}
      >
        {children}
      </div>

      {/* Atenuado en los bordes con contenido oculto */}
      {canLeft && (
        <div className={`pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r ${fadeClass} to-transparent z-10`} />
      )}
      {canRight && (
        <div className={`pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l ${fadeClass} to-transparent z-10`} />
      )}

      {/* Píldora "Desliza →" visible mientras hay más contenido */}
      {showHint && canRight && (
        <div className="pointer-events-none absolute right-2 -bottom-3 flex items-center gap-0.5 rounded-full bg-slate-900/85 text-white pl-2 pr-1.5 py-0.5 text-[9px] font-black shadow-sm backdrop-blur-sm">
          {hint}
          <ChevronRight size={11} className="animate-pulse" />
        </div>
      )}
    </div>
  )
}
