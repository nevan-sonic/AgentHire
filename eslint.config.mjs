import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**"] },
  ...tseslint.configs.recommended,
);
