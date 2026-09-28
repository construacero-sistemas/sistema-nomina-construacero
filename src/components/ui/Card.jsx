// Kit UI compartido — Tarjeta con tokens del sistema de diseño.
export default function Card({ className = '', children, ...props }) {
  return (
    <section className={`bg-surface-light border border-border-subtle rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${className}`} {...props}>
      {children}
    </section>
  )
}

export function CardTitle({ className = '', children }) {
  return <h2 className={`text-sm font-black text-content-main ${className}`}>{children}</h2>
}

export function CardDescription({ className = '', children }) {
  return <p className={`mt-1 text-xs text-content-secondary ${className}`}>{children}</p>
}
