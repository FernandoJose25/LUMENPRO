import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Sección 18 del brief — paleta base, literal.
        bg: "#0A0A0D",
        panel: "#111116",
        panel2: "#16161C",
        border: "#23232B",
        text: {
          primary: "#F5F5F7",
          secondary: "#A1A1AA",
        },
        // Estados (sección 19): gris inactivo, verde ok, accent activo,
        // amarillo advertencia, rojo error/blackout.
        state: {
          idle: "#52525B",
          ok: "#22C55E",
          warn: "#F5B93D",
          danger: "#EF4444",
        },
        // Accent configurable (sección 18) — "UV" violeta como default,
        // con las variantes que el operador puede elegir en Settings.
        accent: {
          DEFAULT: "#A66CFF",
          blue: "#4C9AFF",
          green: "#22C55E",
          amber: "#F5B93D",
          red: "#EF4444",
        },
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "system-ui", "sans-serif"],
        // Monoespaciada para valores DMX/canal — lectura precisa de
        // números que cambian rápido (sección 27, "precisión técnica").
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        control: "6px",
        panel: "10px",
      },
    },
  },
  plugins: [],
} satisfies Config;
