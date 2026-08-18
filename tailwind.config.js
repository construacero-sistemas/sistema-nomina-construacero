/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}', './compat/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1B365D',
          hover: '#142A4A',
          light: '#EDF2F7',
          focus: '#90B4D2',
          dark: '#0E1F38',
        },
        accent: {
          DEFAULT: '#B8860B',
          hover: '#9A7209',
          light: '#FBF5E6',
          focus: '#E8D5A3',
          dark: '#7A5A07',
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
