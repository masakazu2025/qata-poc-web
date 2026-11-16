import { useState } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, Route, Routes } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Api } from "./api";
import { TestcasePage } from "./TestcaseDetail";
import { formatTime, reviewLabel, reviewTone } from "./labels";
import { createQueryClient, pollInterval, queryKeys, testcasePath } from "./queries";

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
  const testcases = useQuery({
    queryKey: queryKeys.testcases,
    queryFn: api.listTestcases,
    refetchInterval: pollInterval(pollMs),
  });

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
          {testcases.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              まだありません。AI に日本語で頼むと、MCP で登録されてここに出ます。
            </p>
          )}
          <ul className="grid gap-2">
            {testcases.data?.map((t) => (
              <li key={t.id}>
                <NavLink
                  to={testcasePath(t.id)}
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
