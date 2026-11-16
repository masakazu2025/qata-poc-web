import { useState } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, Route, Routes } from "react-router";
import type { Api } from "./api";
import { TestcasePage } from "./TestcaseDetail";
import { formatTime, reviewLabel } from "./labels";
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
          <Route
            index
            element={<p className="muted empty">左の一覧からテストケースを選んでください。</p>}
          />
          <Route
            path="testcases/:testcaseId"
            element={<TestcasePage api={api} pollMs={pollMs} />}
          />
          <Route
            path="testcases/:testcaseId/runs/:runId"
            element={<TestcasePage api={api} pollMs={pollMs} />}
          />
          <Route path="*" element={<p className="muted empty">この画面はありません。</p>} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}

function Layout({ api, pollMs }: Required<Props>) {
  const testcases = useQuery({
    queryKey: queryKeys.testcases,
    queryFn: api.listTestcases,
    refetchInterval: pollInterval(pollMs),
  });

  return (
    <div className="app">
      <header className="header">
        <h1>qata</h1>
        <p>日本語の手順から作ったテストケースを確かめて、実行する</p>
      </header>
      <div className="layout">
        <nav className="sidebar" aria-label="テストケースの一覧">
          <div className="sidebar-head">
            <h2>テストケース</h2>
            <button type="button" className="ghost" onClick={() => void testcases.refetch()}>
              読み直す
            </button>
          </div>
          {testcases.error && (
            <p role="alert" className="alert">
              {testcases.error.message}
            </p>
          )}
          {testcases.isPending && <p className="muted">読み込み中…</p>}
          {testcases.data?.length === 0 && (
            <p className="muted">
              まだありません。AI に日本語で頼むと、MCP で登録されてここに出ます。
            </p>
          )}
          <ul className="testcase-list">
            {testcases.data?.map((t) => (
              <li key={t.id}>
                <NavLink
                  to={testcasePath(t.id)}
                  className={({ isActive }) =>
                    isActive ? "link-button testcase-item selected" : "link-button testcase-item"
                  }
                >
                  <span className="testcase-title">{t.testcase.title}</span>
                  <span className="testcase-meta">
                    <span className={`badge review-${t.review_status}`}>
                      {reviewLabel[t.review_status]}
                    </span>
                    <span>{t.testcase.app_id}</span>
                    <span>{formatTime(t.created_at)}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
