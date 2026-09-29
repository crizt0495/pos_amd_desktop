import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#d8e0ec',
        input: '#cdd8e6',
        ring: '#1b5fa8',
        background: '#ffffff',
        foreground: '#22374b',
        muted: { DEFAULT: '#f1f5fa', foreground: '#5b6b80' },
        primary: { DEFAULT: '#1b5fa8', foreground: '#ffffff' },
        destructive: { DEFAULT: '#e03131', foreground: '#ffffff' },
        success: { DEFAULT: '#2f9e44', foreground: '#ffffff' },
        /* Palet iPOS */
        ipos: {
          50: '#f2f7fd',
          100: '#e8f1fa',
          200: '#cfe2f5',
          300: '#a8ccec',
          400: '#74aede',
          500: '#3b8ad0',
          600: '#2470c0',
          700: '#1b5fa8',
          800: '#134a85',
          900: '#0f3a69',
        },
        /* Aksen total belanja */
        accent: {
          400: '#ffa94d',
          500: '#ff922b',
          600: '#e8590c',
        },
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.875rem' },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        flash: {
          '0%': { backgroundColor: '#fff3bf' },
          '100%': { backgroundColor: '#ffffff' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out both',
        'pop-in': 'pop-in 0.18s ease-out both',
        'sheet-up': 'sheet-up 0.22s cubic-bezier(0.32, 0.72, 0, 1) both',
        flash: 'flash 0.8s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
