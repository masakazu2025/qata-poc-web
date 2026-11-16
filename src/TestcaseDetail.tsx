import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import type { Api, Run, TestcaseRecord } from "./api";
import { RunView } from "./RunView";
import { describeStep, formatTime, reviewLabel, runLabel } from "./labels";
import { pollInterval, queryKeys, runPath, testcasePath } from "./queries";

type PageProps = { api: Api; pollMs: number };

/** URL（/testcases/:testcaseId と、その下の /runs/:runId）から、テストケース一つの画面を出す。 */
export function TestcasePage({ api, pollMs }: PageProps) {
  const { testcaseId = "", runId } = useParams();
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: queryKeys.testcase(testcaseId),
    queryFn: () => api.getTestcase(testcaseId),
    // 一覧で読んだものがあれば、読み終えるまでそれを出す（URL を開いたときは一覧がまだないこともある）。
    placeholderData: () =>
      queryClient
        .getQueryData<TestcaseRecord[]>(queryKeys.testcases)
        ?.find((t) => t.id === testcaseId),
    // 一覧と同じ間隔で読み直す。開いたままの画面で、ほかからの承認などが出るように。
    refetchInterval: pollInterval(pollMs),
  });

  if (record.data) {
    return <TestcaseDetail key={testcaseId} api={api} record={record.data} selectedRunId={runId} />;
  }
  if (record.error) {
    return (
      <p role="alert" className="alert">
        {record.error.message}
      </p>
    );
  }
  return <p className="muted">読み込み中…</p>;
}

type Action = "approve" | "run" | "delete";
type Done =
  { kind: "approve"; record: TestcaseRecord } | { kind: "run"; run: Run } | { kind: "delete" };

type Props = {
  api: Api;
  record: TestcaseRecord;
  /** URL で選んだ実行の結果。なければ、いちばん新しいもの。 */
  selectedRunId?: string;
};

export function TestcaseDetail({ api, record, selectedRunId }: Props) {
  const { testcase } = record;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const runs = useQuery({
    queryKey: queryKeys.runs(record.id),
    queryFn: () => api.listRuns(record.id),
  });

  const action = useMutation({
    mutationFn: async (kind: Action): Promise<Done> => {
      if (kind === "approve") return { kind, record: await api.approveTestcase(record.id) };
      if (kind === "run") return { kind, run: await api.runTestcase(record.id) };
      await api.deleteTestcase(record.id);
      return { kind };
    },
    // 読んだものの入れ物は、画面を離れたあとに終わっても直す。
    onSuccess: (done) => {
      if (done.kind === "approve") {
        queryClient.setQueryData(queryKeys.testcase(record.id), done.record);
        queryClient.setQueryData<TestcaseRecord[]>(queryKeys.testcases, (list) =>
          list?.map((t) => (t.id === record.id ? done.record : t)),
        );
      } else if (done.kind === "run") {
        queryClient.setQueryData<Run[]>(queryKeys.runs(record.id), (list) => [
          done.run,
          ...(list ?? []),
        ]);
      } else {
        queryClient.setQueryData<TestcaseRecord[]>(queryKeys.testcases, (list) =>
          list?.filter((t) => t.id !== record.id),
        );
      }
    },
  });

  // 画面の移動は、この画面にいるうちに終わったときだけ（mutate に渡したコールバックは、画面を離れると呼ばれない）。
  const act = (kind: Action) =>
    action.mutate(kind, {
      onSuccess: (done) => {
        if (done.kind === "run") void navigate(runPath(record.id, done.run.id));
        if (done.kind === "delete") void navigate("/");
      },
    });

  const busy = action.isPending ? action.variables : null;
  const error = action.error ?? runs.error;
  const pending = record.review_status === "pending";

  const selectedRun = selectedRunId
    ? runs.data?.find((r) => r.id === selectedRunId)
    : runs.data?.[0];

  return (
    <article className="detail">
      <div className="detail-head">
        <div>
          <h2>{testcase.title}</h2>
          <p className="testcase-meta">
            <span className={`badge review-${record.review_status}`}>
              {reviewLabel[record.review_status]}
            </span>
            <span>アプリ：{testcase.app_id}</span>
            <span>登録：{formatTime(record.created_at)}</span>
          </p>
        </div>
        <button
          type="button"
          className="ghost danger"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm(`「${testcase.title}」を消しますか？（実行の結果は残ります）`)) {
              act("delete");
            }
          }}
        >
          消す
        </button>
      </div>

      <section className="compare" aria-label="手順とステップの見比べ">
        <div className="panel">
          <h3>元の手順（日本語）</h3>
          <p className="instruction">{testcase.instruction}</p>
          <label className="check">
            <input type="checkbox" checked={testcase.needs_review} readOnly disabled />
            実行の前に人が確認する
          </label>
        </div>
        <div className="panel">
          <h3>生成されたステップ</h3>
          <ol className="steps">
            {testcase.steps.map((step, i) => (
              <li key={i} className={step.type === "expect_text" ? "step expect" : "step"}>
                <span>{describeStep(step)}</span>
                {step.note && <span className="note">{step.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="actions" aria-label="操作">
        {pending && (
          <>
            <p className="muted">
              人の確認待ちです。ステップを見比べて、よければ承認してください。
            </p>
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() => act("approve")}
            >
              {busy === "approve" ? "承認中…" : "承認する"}
            </button>
          </>
        )}
        <button
          type="button"
          className={pending ? "" : "primary"}
          disabled={pending || busy !== null}
          title={pending ? "承認するまで実行できません" : undefined}
          onClick={() => act("run")}
        >
          {busy === "run" ? "実行中…" : "実行する"}
        </button>
      </section>

      {error && (
        <p role="alert" className="alert">
          {error.message}
        </p>
      )}

      <section className="runs" aria-label="実行の結果">
        <h3>実行の結果</h3>
        {runs.isPending && <p className="muted">読み込み中…</p>}
        {runs.data?.length === 0 && <p className="muted">まだ実行していません。</p>}
        {runs.data && runs.data.length > 0 && (
          <ul className="run-tabs">
            {runs.data.map((run) => {
              const selected = run.id === selectedRun?.id;
              return (
                <li key={run.id}>
                  <Link
                    to={runPath(record.id, run.id)}
                    aria-current={selected ? "page" : undefined}
                    className={selected ? "link-button run-tab selected" : "link-button run-tab"}
                  >
                    <span className={`badge run-${run.status}`}>{runLabel[run.status]}</span>
                    {formatTime(run.started_at)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {runs.data && !selectedRun && selectedRunId && (
          <p className="muted">
            この実行の結果は見つかりません。
            <Link to={testcasePath(record.id)}>いちばん新しい結果を見る</Link>
          </p>
        )}
        {selectedRun && <RunView api={api} run={selectedRun} />}
      </section>
    </article>
  );
}
