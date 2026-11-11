import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["policy/src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2024",
  conditions: ["workerd", "worker", "browser"],
  plugins: [
    {
      name: "nodejs-compat",
      setup(build) {
        build.onResolve({ filter: /^node:/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
  outfile: "dist/policy/index.js",
  sourcemap: false,
  logLevel: "info",
});
