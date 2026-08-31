/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#f2f4ff",
          100: "#e6e9ff",
          200: "#c7cdff",
          300: "#a3adfd",
          400: "#7c81fa",
          500: "#615ef2",
          600: "#4f42dd",
          700: "#4133b8",
          800: "#352c93",
          900: "#2c2775",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f7f7fb",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(17 24 39 / 0.04), 0 1px 3px 0 rgb(17 24 39 / 0.06)",
        popover: "0 10px 15px -3px rgb(17 24 39 / 0.08), 0 4px 6px -4px rgb(17 24 39 / 0.08)",
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
