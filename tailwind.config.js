/** @type {import('tailwindcss').Config} */
// ─────────────────────────────────────────────────────────────────────────────
// 🎨 CONSTRUACERO CARABOBO — SISTEMA DE DISEÑO COMPARTIDO
// Navy Institucional + Dorado Bronce. Esta paleta es idéntica a la del sistema
// POS Cotizaciones (mismos valores hex): los dos sistemas son hermanos y este
// archivo es la fuente única de verdad visual de Nómina.
// ─────────────────────────────────────────────────────────────────────────────
export default {
  content: ['./index.html', './src/**/*.{js,jsx}', './compat/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '400px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      // Tipografía: Inter (auto-hospedada vía @fontsource/inter en main.jsx).
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // 1. PRIMARIO — Navy Institucional (botones, nav, foco)
        primary: {
          DEFAULT: '#1B365D', // Navy profundo — botón principal
          hover: '#142A4A', // hover más oscuro
          light: '#EDF2F7', // fondo suave (badges, highlights)
          focus: '#90B4D2', // anillo de foco en inputs
          dark: '#0E1F38', // pressed / active state
        },

        // 2. ACENTO — Dorado Bronce (énfasis, precios, CTA secundarios)
        accent: {
          DEFAULT: '#B8860B', // Dorado bronce
          hover: '#9A7209', // hover bronce oscuro
          light: '#FBF5E6', // fondo dorado muy suave
          focus: '#E8D5A3', // anillo dorado suave
          dark: '#7A5A07', // bronce profundo
        },

        // 3. FONDOS DE PANTALLA
        app: {
          light: '#F7F8FA', // Gris cálido — fondo general
          dark: '#0E1A2E', // Navy profundo — modo oscuro
        },

        // 4. FONDOS DE TARJETAS / MODALES
        surface: {
          light: '#FFFFFF',
          dark: '#152238', // Navy panel
        },

        // 5. TEXTOS
        content: {
          main: '#1A2332', // Navy oscuro — títulos (alta legibilidad)
          secondary: '#5A6B7F', // Gris azulado — subtítulos
          inverse: '#F7F8FA', // Texto claro sobre fondos oscuros
        },

        // 6. ESTADOS SEMÁNTICOS (éxito / peligro / advertencia)
        status: {
          success: '#0D9668',
          successBg: '#D1FAE5',
          danger: '#DC2626',
          dangerBg: '#FEE2E2',
          warning: '#D97706',
          warningBg: '#FEF3C7',
        },

        // 7. BORDES Y SEPARADORES
        border: {
          subtle: '#E2E6EC',
          focus: '#1B365D', // Navy — borde activo en inputs
        },

        // ───────────────────────────────────────────────────────────────────
        // 🔄 ALIASES — Compatibilidad con código existente
        // ───────────────────────────────────────────────────────────────────
        brand: {
          light: '#EDF2F7',
          DEFAULT: '#1B365D',
          dark: '#0E1F38',
        },

        background: {
          light: '#F7F8FA',
          dark: '#0E1A2E',
        },

        // Las paletas por defecto de Tailwind (blue/indigo/sky) se remapean a la
        // escala Navy institucional: todo color que escriba un desarrollador
        // queda automáticamente de marca (misma técnica que el POS Cotizaciones).
        blue: {
          50: '#EDF2F7', 100: '#D4DEE9', 200: '#A8BDD4', 300: '#7D9CBE', 400: '#517BA9',
          500: '#1B365D', 600: '#142A4A', 700: '#0E1F38', 800: '#091525', 900: '#050B13', 950: '#02060A',
        },
        indigo: {
          50: '#EDF2F7', 100: '#D4DEE9', 200: '#A8BDD4', 300: '#7D9CBE', 400: '#517BA9',
          500: '#1B365D', 600: '#142A4A', 700: '#0E1F38', 800: '#091525', 900: '#050B13', 950: '#02060A',
        },
        sky: {
          50: '#EDF2F7', 100: '#D4DEE9', 200: '#A8BDD4', 300: '#7D9CBE', 400: '#517BA9',
          500: '#1B365D', 600: '#142A4A', 700: '#0E1F38', 800: '#091525', 900: '#050B13', 950: '#02060A',
        },
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      })
    },
  ],
}
