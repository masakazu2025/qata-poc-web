import { useState } from "react";
import { keepPreviousData, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, Route, Routes, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Api } from "./api";
import { TagList } from "./Tags";
import { TestcasePage } from "./TestcaseDetail";
import { formatTime, reviewLabel, reviewTone } from "./labels";
import {
  createQueryClient,
  pollInterval,
  queryKeys,
  selectedTags,
  tagSearch,
  testcasePath,
} from "./queries";

type Props = {
  api: Api;
  /** 一覧を読み直す間隔（ミリ秒）。AI が MCP で登録したものが、開いたままの画面に出るように。0 なら読み直さない。 */
  pollMs?: number;
};

/** 画面の全体。URL は外から渡す router（本物は BrowserRouter、テストは MemoryRouter）が持つ。 */
export function App({ api, pollMs = 0 }: Props) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route element={<Layout api={api} pollMs={pollMs} />}>
          <Route index element={<Empty>左の一覧からテストケースを選んでください。</Empty>} />
          <Route
            path="testcases/:testcaseId"
            element={<TestcasePage api={api} pollMs={pollMs} />}
          />
          <Route
            path="testcases/:testcaseId/runs/:runId"
            element={<TestcasePage api={api} pollMs={pollMs} />}
          />
          <Route path="*" element={<Empty>この画面はありません。</Empty>} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="mt-10 text-center text-muted-foreground">{children}</p>;
}

function Layout({ api, pollMs }: Required<Props>) {
  const [search, setSearch] = useSearchParams();
  const tags = selectedTags(search);
  const testcases = useQuery({
    queryKey: queryKeys.testcaseList(tags),
    queryFn: () => api.listTestcases(tags),
    // タグを選び直したら、読み終えるまで前の一覧とタグを出しておく（続けて押すタグが消えないように）。
    placeholderData: keepPreviousData,
    refetchInterval: pollInterval(pollMs),
  });
  // 選べるタグは、いま一覧に出ているものが持つタグ。全部持つものに絞るので、選ぶほど狭まる。
  const choices = [
    ...new Set([...tags, ...(testcases.data ?? []).flatMap((t) => t.testcase.tags ?? [])]),
  ].sort();
  const toggle = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setSearch(new URLSearchParams(next.map((t) => ["tag", t])));
  };

  return (
    <div>
      <header className="flex flex-wrap items-baseline gap-4 border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold tracking-wide">qata</h1>
        <p className="text-sm text-muted-foreground">
          日本語の手順から作ったテストケースを確かめて、実行する
        </p>
      </header>
      <div className="grid min-h-[calc(100vh-61px)] md:grid-cols-[320px_1fr]">
        <nav
          className="border-b bg-card p-4 md:border-r md:border-b-0"
          aria-label="テストケースの一覧"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">テストケース</h2>
            <Button variant="ghost" size="sm" onClick={() => void testcases.refetch()}>
              読み直す
            </Button>
          </div>
          {testcases.error && <Alert variant="destructive">{testcases.error.message}</Alert>}
          {testcases.isPending && <p className="text-sm text-muted-foreground">読み込み中…</p>}
          {choices.length > 0 && (
            <div className="mb-3 grid gap-2" role="group" aria-label="タグで絞り込む">
              <div className="flex flex-wrap gap-1.5">
                {choices.map((tag) => (
                  <Button
                    key={tag}
                    variant={tags.includes(tag) ? "default" : "outline"}
                    size="xs"
                    aria-pressed={tags.includes(tag)}
                    onClick={() => toggle(tag)}
                  >
                    {tag}
                  </Button>
                ))}
              </div>
              {tags.length > 0 && (
                <p className="flex items-center justify-between text-xs text-muted-foreground">
                  選んだタグを全部持つものだけを出しています。
                  <Button variant="link" size="xs" onClick={() => setSearch(new URLSearchParams())}>
                    絞り込みを外す
                  </Button>
                </p>
              )}
            </div>
          )}
          {testcases.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {tags.length > 0
                ? "選んだタグを全部持つテストケースはありません。"
                : "まだありません。AI に日本語で頼むと、MCP で登録されてここに出ます。"}
            </p>
          )}
          <ul className="grid gap-2">
            {testcases.data?.map((t) => (
              <li key={t.id}>
                <NavLink
                  to={testcasePath(t.id) + tagSearch(tags)}
                  className={({ isActive }) =>
                    cn(
                      buttonVariants({ variant: "outline" }),
                      "grid h-auto w-full justify-stretch gap-1 px-3 py-2.5 text-left whitespace-normal",
                      isActive && "border-primary shadow-[inset_3px_0_0_var(--primary)]",
                    )
                  }
                >
                  <span className="font-semibold">{t.testcase.title}</span>
                  <span className="flex flex-wrap items-center gap-2.5 text-xs font-normal text-muted-foreground">
                    <Badge variant={reviewTone[t.review_status]}>
                      {reviewLabel[t.review_status]}
                    </Badge>
                    <span>{t.testcase.app_id}</span>
                    <span>{formatTime(t.created_at)}</span>
                  </span>
                  <TagList tags={t.testcase.tags} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
