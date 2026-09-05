/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Grounded in the field, not in a UI kit.
         *
         * Every FRC field is red versus blue, so those are structural colors
         * here, never decoration. The greys are anodized aluminium rather
         * than the usual blue-tinted slate; signal yellow is the colour of
         * the match timer and the caution tape around the field.
         */
        deck: {
          900: '#0E1011',  // deepest — page ground
          800: '#141719',  // panel ground
          700: '#1A1E21',  // raised panel
          600: '#232829',  // hover / inset
          500: '#31383A',  // hairlines
        },
        alliance: {
          red: '#F4364C',
          redDeep: '#B00D22',
          blue: '#3B8CFF',
          blueDeep: '#0B4FBF',
        },
        signal: {
          DEFAULT: '#FFC400',  // live, attention, in-progress
          dim: '#8A6B00',
        },
        chalk: {
          DEFAULT: '#E9E7E3',  // primary text — warm, like printed drawings
          dim: '#9AA0A4',
          faint: '#666D71',
        },
      },
      fontFamily: {
        // Barlow: drawn from California highway signage. Legible at a glance
        // in bad gym lighting, which is the actual reading condition.
        sans: ['Barlow', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Barlow', 'system-ui', 'sans-serif'],
      },
      fontWeight: {
        // Numeric weights read more like a spec sheet than semibold/bold do,
        // and Barlow ships all four.
        400: '400', 500: '500', 600: '600', 700: '700',
      },
      borderRadius: {
        // Equipment has tight corners, not pill-shaped everything.
        panel: '3px',
      },
    },
  },
  plugins: [],
}
