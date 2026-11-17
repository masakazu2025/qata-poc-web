import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Api, Run, TestcaseRecord } from "./api";
import { TagList } from "./Tags";
import { RunView } from "./RunView";
import { describeStep, formatTime, reviewLabel, reviewTone, runLabel, runTone } from "./labels";
import {
  findInTestcaseLists,
  pollInterval,
  queryKeys,
  runPath,
  testcasePath,
  updateTestcaseLists,
} from "./queries";

type PageProps = { api: Api; pollMs: number };

/** URL（/testcases/:testcaseId と、その下の /runs/:runId）から、テストケース一つの画面を出す。 */
export function TestcasePage({ api, pollMs }: PageProps) {
  const { testcaseId = "", runId } = useParams();
  const queryClient = useQueryClient();
  const record = useQuery({
    queryKey: queryKeys.testcase(testcaseId),
    queryFn: () => api.getTestcase(testcaseId),
    // 一覧で読んだものがあれば、読み終えるまでそれを出す（URL を開いたときは一覧がまだないこともある）。
    placeholderData: () => findInTestcaseLists(queryClient, testcaseId),
    // 一覧と同じ間隔で読み直す。開いたままの画面で、ほかからの承認などが出るように。
    refetchInterval: pollInterval(pollMs),
  });

  // 読み直しが失敗したら、前に読んだものがあってもエラーを出す。ほかで消されたものを、操作できるまま残さないため。
  if (record.error) {
    return <Alert variant="destructive">{record.error.message}</Alert>;
  }
  if (record.data) {
    return <TestcaseDetail key={testcaseId} api={api} record={record.data} selectedRunId={runId} />;
  }
  return <p className="text-muted-foreground">読み込み中…</p>;
}

type Action = "approve" | "run" | "delete";
const actionKey = (testcaseId: string) => ["testcase-action", testcaseId] as const;
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
  // 一覧で選んだタグ（?tag=…）は、画面を移っても残す。
  const { search } = useLocation();

  const runs = useQuery({
    queryKey: queryKeys.runs(record.id),
    queryFn: () => api.listRuns(record.id),
  });

  const action = useMutation({
    // 進行中の操作は入れ物（MutationCache）に残る。名前を付けておき、画面を作り直しても下で読み直す。
    mutationKey: actionKey(record.id),
    mutationFn: async (kind: Action): Promise<Done> => {
      if (kind === "approve") return { kind, record: await api.approveTestcase(record.id) };
      if (kind === "run") return { kind, run: await api.runTestcase(record.id) };
      await api.deleteTestcase(record.id);
      return { kind };
    },
    // 読んだものの入れ物は、画面を離れたあとに終わっても直す。
    onSuccess: async (done) => {
      // 途中の読み直しを止める。あとから届いた古い応答で、直したものが上書きされないように。
      await queryClient.cancelQueries({ queryKey: queryKeys.testcases });
      // 実行中に画面を開き直すと、実行の結果の一覧を読み直す。その古い応答で、足した結果が消えないように。
      await queryClient.cancelQueries({ queryKey: queryKeys.runs(record.id) });
      if (done.kind === "approve") {
        queryClient.setQueryData(queryKeys.testcase(record.id), done.record);
        updateTestcaseLists(queryClient, (list) =>
          list.map((t) => (t.id === record.id ? done.record : t)),
        );
      } else if (done.kind === "run") {
        queryClient.setQueryData<Run[]>(queryKeys.runs(record.id), (list) => [
          done.run,
          // 読み直しで先に届いていたら、二つ並べない。
          ...(list ?? []).filter((r) => r.id !== done.run.id),
        ]);
      } else {
        updateTestcaseLists(queryClient, (list) => list.filter((t) => t.id !== record.id));
        // 「戻る」で開き直したときに、消したものを前に読んだまま出さないように。
        queryClient.removeQueries({ queryKey: queryKeys.testcase(record.id), exact: true });
        queryClient.removeQueries({ queryKey: queryKeys.runs(record.id), exact: true });
      }
    },
  });

  // 画面の移動は、この画面にいるうちに終わったときだけ（mutate に渡したコールバックは、画面を離れると呼ばれない）。
  const act = (kind: Action) =>
    action.mutate(kind, {
      onSuccess: (done) => {
        if (done.kind === "run") void navigate(runPath(record.id, done.run.id) + search);
        if (done.kind === "delete") void navigate("/" + search);
      },
    });

  // この画面で始めたものだけでなく、前に開いていたときに始めて、まだ終わっていないものも見る。
  // 失敗も同じく、いちばん新しい操作のものを出す（離れている間に失敗しても、戻ったときに出るように）。
  const actions = useMutationState({
    filters: { mutationKey: actionKey(record.id) },
    select: (mutation) => mutation.state,
  });
  const busy = (actions.find((a) => a.status === "pending")?.variables as Action) ?? null;
  const latest = actions.at(-1);
  const error = (latest?.status === "error" ? latest.error : null) ?? runs.error;
  const pending = record.review_status === "pending";

  const selectedRun = selectedRunId
    ? runs.data?.find((r) => r.id === selectedRunId)
    : runs.data?.[0];

  return (
    <article className="grid max-w-[1100px] gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold">{testcase.title}</h2>
          <p className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
            <Badge variant={reviewTone[record.review_status]}>
              {reviewLabel[record.review_status]}
            </Badge>
            <span>アプリ：{testcase.app_id}</span>
            <span>登録：{formatTime(record.created_at)}</span>
          </p>
          <TagList tags={testcase.tags} />
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={busy !== null}>
              消す
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>「{testcase.title}」を消しますか？</AlertDialogTitle>
              <AlertDialogDescription>実行の結果は残ります。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>やめる</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => act("delete")}>
                消す
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="手順とステップの見比べ">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">元の手順（日本語）</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-base whitespace-pre-wrap">{testcase.instruction}</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={testcase.needs_review} disabled />
              実行の前に人が確認する
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">生成されたステップ</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid list-decimal gap-1 pl-6">
              {testcase.steps.map((step, i) => (
                <li key={i} className={cn("pl-1", step.type === "expect_text" && "font-semibold")}>
                  <span>{describeStep(step)}</span>
                  {step.note && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {step.note}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-wrap items-center gap-3" aria-label="操作">
        {pending && (
          <>
            <p className="text-muted-foreground">
              人の確認待ちです。ステップを見比べて、よければ承認してください。
            </p>
            <Button disabled={busy !== null} onClick={() => act("approve")}>
              {busy === "approve" ? "承認中…" : "承認する"}
            </Button>
          </>
        )}
        <Button
          variant={pending ? "outline" : "default"}
          disabled={pending || busy !== null}
          title={pending ? "承認するまで実行できません" : undefined}
          onClick={() => act("run")}
        >
          {busy === "run" ? "実行中…" : "実行する"}
        </Button>
      </section>

      {error && <Alert variant="destructive">{error.message}</Alert>}

      <section className="grid gap-3" aria-label="実行の結果">
        <h3 className="text-sm font-semibold text-muted-foreground">実行の結果</h3>
        {runs.isPending && <p className="text-muted-foreground">読み込み中…</p>}
        {runs.data?.length === 0 && <p className="text-muted-foreground">まだ実行していません。</p>}
        {runs.data && runs.data.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {runs.data.map((run) => {
              const selected = run.id === selectedRun?.id;
              return (
                <li key={run.id}>
                  <Link
                    to={runPath(record.id, run.id) + search}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "gap-2 font-normal",
                      selected && "border-primary",
                    )}
                  >
                    <Badge variant={runTone[run.status]}>{runLabel[run.status]}</Badge>
                    {formatTime(run.started_at)}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {runs.data && !selectedRun && selectedRunId && (
          <p className="text-muted-foreground">
            この実行の結果は見つかりません。
            <Link
              to={testcasePath(record.id) + search}
              className="text-primary underline underline-offset-4"
            >
              いちばん新しい結果を見る
            </Link>
          </p>
        )}
        {selectedRun && <RunView api={api} run={selectedRun} />}
      </section>
    </article>
  );
}
