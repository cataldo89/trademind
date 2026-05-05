/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        // Custom trading-specific palette
        bull: '#34d399',    // Emerald 400 — bullish
        bear: '#f87171',    // Red 400 — bearish
        neutral: '#9ca3af', // Gray 400
      },
      animation: {
        'ticker': 'ticker 40s linear infinite',
        'flash-green': 'flash-green 0.6s ease',
        'flash-red': 'flash-red 0.6s ease',
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'flash-green': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(52, 211, 153, 0.2)' },
        },
        'flash-red': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '50%': { backgroundColor: 'rgba(248, 113, 113, 0.2)' },
        },
      },
    },
  },
  plugins: [],
  safelist: [
    'text-emerald-400', 'text-red-400', 'text-yellow-400', 'text-cyan-400', 'text-violet-400',
    'bg-emerald-500/10', 'bg-red-500/10', 'bg-yellow-500/10', 'bg-cyan-500/10', 'bg-violet-500/10',
  ],
}

# bumped: 2026-05-05T04:21:00