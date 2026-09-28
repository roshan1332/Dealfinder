import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0b0f14", soft: "#3b4250", muted: "#6b7280" },
        deal: { 50: "#ecfdf3", 100: "#d1fadf", 500: "#12b76a", 600: "#039855", 700: "#027a48" },
        line: "#e7e9ee",
        canvas: "#f7f8fa",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)",
        lift: "0 2px 4px rgba(16,24,40,.06), 0 12px 32px rgba(16,24,40,.10)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
} satisfies Config;
