import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#F6F1E7",
        paper: "#2E2A22",
        flag: "#C1573D",
        accept: "#7C9473",
      },
      fontFamily: {
        serif: ["'Poppins'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
