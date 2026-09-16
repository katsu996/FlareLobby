import { defineConfig } from "playwright/test";

const origin = process.env["HOSTED_DEMO_ORIGIN"] ?? "http://localhost:8787";

export default defineConfig({
  testDir: ".",
  testMatch: ["two-browsers.spec.ts"],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: origin,
    headless: true,
  },
});
