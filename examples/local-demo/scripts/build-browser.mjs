import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(demoRoot, "../..");

await build({
  absWorkingDir: demoRoot,
  entryPoints: ["src/browser.ts"],
  outfile: "public/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  legalComments: "none",
  alias: {
    "@flarelobby/client": resolve(workspaceRoot, "packages/client/src/index.ts"),
    "@flarelobby/core": resolve(workspaceRoot, "packages/core/src/index.ts")
  }
});
