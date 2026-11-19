/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// web は /api を qata-server に中継する（server に CORS の設定を足さずに済むように）。
const serverUrl = process.env.QATA_SERVER_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: serverUrl,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    // e2e/ は Playwright で別に回す（npm run e2e）
    include: ["tests/**/*.test.{ts,tsx}"],
    server: { deps: { inline: [] } },
    projects: [
      { extends: true, test: { name: "default" } },
      // 画面のテストを、偽の server の応答を遅らせてもう一度回す（tests/fakeServer.ts の fakeDelayMs）。
      // すぐに応答する偽物だけだと、待つつもりで待っていないテストもたまたま通るため。
      {
        extends: true,
        test: {
          name: "slow-server",
          // include は元の設定と合わさるので、画面でないテストを外して、画面のテストだけにする。
          exclude: ["tests/contracts.test.ts", "tests/sync-contracts.test.ts"],
          env: { QATA_FAKE_DELAY_MS: "20" },
        },
      },
    ],
  },
});
