/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Team 6036 Peninsula Robotics
        peninsula: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdbff', 300: '#8ec4ff',
          400: '#59a3ff', 500: '#337dff', 600: '#1b5cf5', 700: '#1447e1',
          800: '#173bb6', 900: '#19378f', 950: '#142357',
        },
        surface: {
          0: '#0b0f1a', 1: '#111726', 2: '#18203353', 3: '#1c2436',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
