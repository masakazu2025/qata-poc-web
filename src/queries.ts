// server から読んだものを置く入れ物（TanStack Query）の名前と設定、画面の URL。
import { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  testcases: ["testcases"] as const,
  testcase: (testcaseId: string) => ["testcases", testcaseId] as const,
  runs: (testcaseId: string) => ["runs", { testcaseId }] as const,
};

export function createQueryClient() {
  return new QueryClient({
    // 前と同じく、失敗したら読み直さずにすぐ伝える（読み直すのは画面の「読み直す」と、一覧の間隔だけ）。
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** 一覧の読み直しの間隔。0 なら読み直さない。画面が見えていないときは読み直さない（TanStack Query の既定）。 */
export const pollInterval = (pollMs: number) => (pollMs > 0 ? pollMs : false);

// 画面の URL：一覧は /、テストケース一つは /testcases/:testcaseId、実行の結果一つは その下の /runs/:runId。
export const testcasePath = (testcaseId: string) => `/testcases/${encodeURIComponent(testcaseId)}`;
export const runPath = (testcaseId: string, runId: string) =>
  `${testcasePath(testcaseId)}/runs/${encodeURIComponent(runId)}`;
