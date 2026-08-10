const entryPoints = [
  new URL("../packages/core/dist/index.js", import.meta.url),
  new URL("../packages/cloudflare/dist/index.js", import.meta.url),
  new URL("../packages/client/dist/index.js", import.meta.url),
  new URL("../packages/testing/dist/index.js", import.meta.url),
];

await Promise.all(entryPoints.map((entryPoint) => import(entryPoint.href)));
