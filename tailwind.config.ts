import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: '#e4e4e7',
        input: '#e4e4e7',
        ring: '#18181b',
        background: '#ffffff',
        foreground: '#18181b',
        muted: { DEFAULT: '#f4f4f5', foreground: '#71717a' },
        primary: { DEFAULT: '#18181b', foreground: '#ffffff' },
        destructive: { DEFAULT: '#dc2626', foreground: '#ffffff' },
        success: { DEFAULT: '#16a34a', foreground: '#ffffff' },
      },
      borderRadius: { xl: '0.625rem', '2xl': '0.875rem' },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Consolas', 'Courier New', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in 0.2s ease-out both' },
    },
  },
  plugins: [],
};

export default config;