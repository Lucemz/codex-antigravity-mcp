import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  banner: { js: "#!/usr/bin/env node\n" },
  outExtension: () => ({ js: ".mjs" })
});
