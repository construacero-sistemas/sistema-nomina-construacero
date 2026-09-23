// compat/components/auth/DarkBackground.jsx
// Fondo animado con orbes del sistema de referencia (listo-pos-cotizaciones):
// gradiente base, tres orbes difusos, retícula de puntos y dos líneas de acento.
// Compartido por el acceso de la cuenta y la selección de operador.
export default function DarkBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="absolute -top-[20%] -left-[10%] w-[700px] h-[700px] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute top-[30%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="white" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
      <div className="absolute top-0 left-[35%] w-px h-full opacity-10" style={{ background: 'linear-gradient(to bottom, transparent 0%, #B8860B 30%, #1B365D 70%, transparent 100%)' }} />
      <div className="absolute top-0 left-[65%] w-px h-full opacity-5" style={{ background: 'linear-gradient(to bottom, transparent 0%, #3b82f6 50%, transparent 100%)' }} />
    </div>
  )
}
