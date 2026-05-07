// Tailwind CSS configuration for Page Pilot.
// Extends the default palette with brand colors used throughout the extension UI.

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand colors defined in PRD and CLAUDE.md
        navy: {
          DEFAULT: "#0F172A",
          light: "#1E293B",
        },
        pilot: {
          blue: "#3B82F6",
          "blue-dark": "#2563EB",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      width: {
        popup: "380px",
      },
      minHeight: {
        popup: "500px",
      },
    },
  },
  plugins: [],
};

export default config;
