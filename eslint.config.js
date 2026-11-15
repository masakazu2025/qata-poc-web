// 関門の一つ（README の「関門」）。型と書式では止まらない誤り（hooks の呼び方・依存の配列・待ち忘れの Promise など）を止める。
// 書式は prettier に任せるので、ここでは書式の規則を入れない。
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  // 生成物と出力は見ない（生成物は契約との一致をテストで確かめる）。
  {
    ignores: ["dist/", "playwright-report/", "test-results/", "src/contracts/", "src/demo/data/"],
  },
  js.configs.recommended,
  // 画面の文言では、全角の空白を区切りに使う。
  { rules: { "no-irregular-whitespace": ["error", { skipJSXText: true }] } },
  // TypeScript は型の情報を使って調べる（tsconfig.json に入っているもの）。
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  // scripts と設定のファイルは Node で動く。
  {
    files: ["scripts/**/*.{js,mjs}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
