import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Runs before any test module is imported, so `db.ts` can never capture a
    // real connection string from the ambient environment. See the file header.
    setupFiles: ["./vitest.setup.ts"],
  },
});
