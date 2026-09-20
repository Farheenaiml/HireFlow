/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Deep navy-ink canvas text
        ink: { DEFAULT: "#0B1220", 700: "#1B2A44", 500: "#4A5C7A", 300: "#8695B0" },
        paper: { DEFAULT: "#F5F7FC", deep: "#E9EDF7" },
        // Primary: electric indigo
        teal: { DEFAULT: "#4338CA", dark: "#312C9E", light: "#E8E7FD" },
        // Accents
        plum: { DEFAULT: "#7C3AED", light: "#F1E9FF" },
        forest: { DEFAULT: "#047857", light: "#D3F5E5" },
        ochre: { DEFAULT: "#B45309", light: "#FCEFD6" },
        brick: { DEFAULT: "#BE123C", light: "#FFE3EA" },
        slate2: { DEFAULT: "#475569", light: "#E6EAF2" },
        cyanx: { DEFAULT: "#06B6D4", light: "#D4F5FB" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["Fraunces", "Newsreader", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(11,18,32,.05), 0 10px 30px -18px rgba(11,18,32,.35)",
        lift: "0 2px 4px rgba(11,18,32,.06), 0 24px 48px -24px rgba(67,56,202,.45)",
        drawer: "-18px 0 60px -28px rgba(11,18,32,.55)",
        glow: "0 0 0 1px rgba(67,56,202,.18), 0 12px 40px -16px rgba(67,56,202,.55)",
      },
      backgroundImage: {
        aurora:
          "radial-gradient(1000px 420px at 8% -8%, rgba(124,58,237,.20), transparent 60%), radial-gradient(900px 400px at 92% 0%, rgba(6,182,212,.18), transparent 58%), radial-gradient(700px 360px at 50% 110%, rgba(67,56,202,.14), transparent 60%)",
        "ink-deep":
          "linear-gradient(168deg, #0B1220 0%, #13203A 45%, #1A1740 100%)",
        sheen:
          "linear-gradient(110deg, transparent 20%, rgba(255,255,255,.55) 50%, transparent 80%)",
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(10px)" }, "100%": { opacity: "1", transform: "none" } },
        fade: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        shimmer: { "0%": { backgroundPosition: "-500px 0" }, "100%": { backgroundPosition: "500px 0" } },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(67,56,202,.45)" },
          "70%": { boxShadow: "0 0 0 12px rgba(67,56,202,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(67,56,202,0)" },
        },
        drift: {
          "0%,100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-8px,0)" },
        },
      },
      animation: {
        rise: "rise .45s cubic-bezier(.22,.9,.3,1) both",
        fade: "fade .4s ease both",
        shimmer: "shimmer 1.6s linear infinite",
        pulseRing: "pulseRing 2s ease-out infinite",
        drift: "drift 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
