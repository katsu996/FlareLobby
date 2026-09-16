import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(demoRoot, "../..");

const config = {
  endpoint: process.env["VITE_FLARE_LOBBY_ENDPOINT"] ?? "",
  supabaseUrl: process.env["VITE_SUPABASE_URL"] ?? "",
  supabasePublishableKey: process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
  turnstileSiteKey: process.env["VITE_TURNSTILE_SITEKEY"] ?? "",
};

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
  define: {
    __HOSTED_DEMO_CONFIG__: JSON.stringify(config),
  },
  alias: {
    "@flarelobby/client": resolve(
      workspaceRoot,
      "packages/client/src/index.ts",
    ),
    "@flarelobby/core": resolve(workspaceRoot, "packages/core/src/index.ts"),
  },
});
