import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".taste-skill/**", ".next/**", ".next-dev/**", "out/**", "build/**", "next-env.d.ts"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", fetch: "readonly", setTimeout: "readonly" },
    },
  },
);
