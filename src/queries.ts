// server から読んだものを置く入れ物（TanStack Query）の名前と設定、画面の URL。
import { QueryClient } from "@tanstack/react-query";
import type { TestcaseRecord } from "./api";

export const queryKeys = {
  /** テストケースのもの全部（一覧も一つずつも）の頭。 */
  testcases: ["testcases"] as const,
  /** 一覧。タグで絞り込んだものは、タグの組ごとに別に持つ。 */
  testcaseList: (tags: readonly string[]) => ["testcases", { tags }] as const,
  testcase: (testcaseId: string) => ["testcases", testcaseId] as const,
  runs: (testcaseId: string) => ["runs", { testcaseId }] as const,
};

/** 読んだ一覧（絞り込んだものも全部）を直す。一つずつのもの（["testcases", id]）には触らない。 */
export function updateTestcaseLists(
  queryClient: QueryClient,
  update: (list: TestcaseRecord[]) => TestcaseRecord[],
) {
  queryClient.setQueriesData<unknown>({ queryKey: queryKeys.testcases }, (data: unknown) =>
    Array.isArray(data) ? update(data as TestcaseRecord[]) : data,
  );
}

/** 読んだ一覧のどれかにあれば、そのテストケース。 */
export function findInTestcaseLists(queryClient: QueryClient, testcaseId: string) {
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: queryKeys.testcases })) {
    const found = Array.isArray(data)
      ? (data as TestcaseRecord[]).find((t) => t.id === testcaseId)
      : undefined;
    if (found) return found;
  }
  return undefined;
}

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

/** URL の ?tag=… で選んだタグ。重なりを除き、並びをそろえる（同じ組なら同じ入れ物を使うように）。 */
export function selectedTags(search: URLSearchParams): string[] {
  // 空のタグは契約にないので、選んでいないものとする（?tag= だけのとき）。
  return [...new Set(search.getAll("tag").filter(Boolean))].sort();
}

/** 選んだタグを、URL の ?tag=… にする（REST の一覧と同じ書き方）。なければ空の文字。 */
export function tagSearch(tags: readonly string[]): string {
  const search = new URLSearchParams(tags.map((tag) => ["tag", tag]));
  return tags.length ? `?${search.toString()}` : "";
}
