import {heroui} from '@heroui/theme';
import type { Config } from 'tailwindcss'

export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {},
  },
  darkMode: "class",
  plugins: [heroui({
    themes: {
      dark: {
        colors: {
          background: "#141514",
          foreground: "#D9D9D9",
          default: {
            50: "#1a1a1a",
            100: "#2a2a2a",
            200: "#3a3a3a",
            300: "#4a4a4a",
            400: "#5a5a5a",
            500: "#6a6a6a",
            600: "#7a7a7a",
            700: "#8a8a8a",
            800: "#9a9a9a",
            900: "#aaaaaa",
            DEFAULT: "#5a5a5a",
            foreground: "#D9D9D9",
          },
        },
      },
    },
  })],
} satisfies Config