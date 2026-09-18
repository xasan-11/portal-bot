/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0b0f",
          900: "#0f1117",
          800: "#161923",
          700: "#1f2330",
          600: "#2a2f3f",
        },
        accent: {
          DEFAULT: "#5b8cff",
          soft: "#3a4a7a",
        },
        success: "#22c55e",
        danger: "#ef4444",
        warning: "#eab308",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
