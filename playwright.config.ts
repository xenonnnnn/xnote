import { defineConfig } from "@playwright/test";
const webURL = `http://127.0.0.1:${process.env.XNOTE_WEB_PORT || 5173}`;
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: webURL,
    headless: true,
    channel: process.env.XNOTE_BROWSER_CHANNEL,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: webURL,
    reuseExistingServer: false,
    env: { XNOTE_HOME: process.env.XNOTE_HOME || "/tmp/xnote-e2e" },
    timeout: 60000,
  },
});
