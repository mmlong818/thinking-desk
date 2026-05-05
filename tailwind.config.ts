import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        paper: 'var(--paper)',
        panel: 'var(--panel)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
          5: 'var(--ink-5)',
        },
        rule: { DEFAULT: 'var(--rule)', 2: 'var(--rule-2)' },
        accent: {
          DEFAULT: 'var(--accent)',
          2: 'var(--accent-2)',
          soft: 'var(--accent-soft)',
          tint: 'var(--accent-tint)',
        },
        ai: { DEFAULT: 'var(--ai)', soft: 'var(--ai-soft)', tint: 'var(--ai-tint)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        danger: 'var(--danger)',
        ok: 'var(--ok)',
      },
      fontFamily: {
        serif: 'var(--serif)',
        sans: 'var(--sans)',
        mono: 'var(--mono)',
      },
    },
  },
  plugins: [],
};

export default config;
