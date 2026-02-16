import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "SF Pro", "-apple-system", "sans-serif"],
        mono: ["Geist Mono", "SF Mono", "monospace"],
      },
      colors: {
        // ═══ Player Theme (Light + Orange) ═══
        brand: {
          DEFAULT: "#e8611c",
          light: "#f4a574",
          dark: "#c44e12",
          50: "#fef3ec",
          100: "#fde3d0",
          500: "#e8611c",
          600: "#c44e12",
          700: "#a03d0e",
        },
        // ═══ Admin Theme (Dark + Gold) ═══
        admin: {
          bg: "#08070f",
          surface: "#0e0d1a",
          surface2: "#161527",
          surface3: "#1e1d32",
          border: "#232244",
          border2: "#342f60",
          sidebar: "#0a0914",
          sidebarActive: "#1a1830",
        },
        gold: {
          DEFAULT: "#f0b429",
          light: "#fcd34d",
          dark: "#d4a017",
        },
        // ═══ Semantic ═══
        success: "#10b981",
        danger: "#ef4444",
        warning: "#f97316",
        info: "#3b82f6",
        // ═══ Text (admin) ═══
        txt: {
          DEFAULT: "#e8e6ff",
          secondary: "#a09cc0",
          tertiary: "#645fa0",
        },
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
      keyframes: {
        pulse2: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.3" },
        },
        slideIn: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        pulse2: "pulse2 1.5s infinite",
        slideIn: "slideIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
