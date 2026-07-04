import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171C",
        paper: "#ECEAE3",
        flag: "#C0392B",
        accept: "#4C9A6A",
      },
      fontFamily: {
        serif: ["'Source Serif 4'", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
