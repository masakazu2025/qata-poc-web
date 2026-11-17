// デモ版（vite build --mode demo）。本物の server の代わりに、ブラウザの中の偽の server を使う。
// データは親の契約の例を写したもの（data/）と、電卓のスクショ（screenshots/）。再読み込みで最初に戻る。
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { App } from "../App";
import { createApi, type Run, type Testcase, type TestcaseRecord } from "../api";
import addExample from "./data/testcase.add.json";
import recordExample from "./data/testcase-record.json";
import runExample from "./data/run.json";
import { createFakeServer } from "./fakeServer";

const screenshots = import.meta.glob<string>("./screenshots/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const copy = <T,>(value: unknown): T => structuredClone(value) as T;

/**
 * タグで絞り込むのを試せるように、契約の例を元に、題とタグだけを変えたものを並べる。
 * 手順とスクショは例と同じ（1 + 2 = 3）なので、題もそれに合うものにする。確認は要らないものにする。
 */
const taggedVariants: { id: string; title: string; tags?: string[] }[] = [
  {
    id: "tc_demo_display",
    title: "足し算の答えが表示に出ることを確かめる",
    tags: ["機能:表示", "設計書:電卓の基本操作"],
  },
  {
    id: "tc_demo_regression",
    title: "1 + 2 の足し算（直したあとの確かめ）",
    tags: ["機能:加算", "設計書:電卓の応用", "優先:高"],
  },
  { id: "tc_demo_untagged", title: "タグを付けていないテストケース" },
];

function demoTestcases(): TestcaseRecord[] {
  const example = copy<TestcaseRecord>(recordExample);
  const variants = taggedVariants.map(({ id, title, tags }) => {
    const record = copy<TestcaseRecord>(recordExample);
    record.testcase = { ...record.testcase, title, needs_review: false };
    if (tags) record.testcase.tags = tags;
    else delete record.testcase.tags;
    return { ...record, id, review_status: "not_required" as const };
  });
  return [example, ...variants];
}

export function createDemo(origin = window.location.origin) {
  const server = createFakeServer(demoTestcases(), [copy(runExample)], {
    nextRun: (testcaseId, runId) => {
      const finished = new Date();
      const started = new Date(finished.getTime() - 3000);
      return {
        ...copy<Run>(runExample),
        id: runId,
        testcase_id: testcaseId,
        started_at: started.toISOString(),
        finished_at: finished.toISOString(),
      };
    },
  });
  const baseUrl = `${origin}/api`;
  const api = {
    ...createApi(baseUrl, server.fetch),
    screenshotUrl: (id: string) => screenshots[`./screenshots/${id}.png`] ?? "",
  };
  /** AI が MCP で登録する代わりに、契約の例を登録する。 */
  const register = async (): Promise<TestcaseRecord> => {
    const response = await server.fetch(
      new Request(`${baseUrl}/testcases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(copy<Testcase>(addExample)),
      }),
    );
    return (await response.json()) as TestcaseRecord;
  };
  return { api, register };
}

export type Demo = ReturnType<typeof createDemo>;

export function DemoApp({ demo, pollMs = 1000 }: { demo: Demo; pollMs?: number }) {
  const [registered, setRegistered] = useState(0);
  const onRegister = async () => {
    await demo.register();
    setRegistered((n) => n + 1);
  };
  return (
    <>
      <aside
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-warning-muted px-6 py-3 text-sm text-warning"
        aria-label="デモ版"
      >
        <p className="basis-full">
          <strong>デモ版</strong>
          です。server と runner
          の代わりに、ブラウザの中の偽物が動きます。スクショは本物の電卓を撮ったものです。再読み込みで最初に戻ります。
        </p>
        <p className="basis-full">
          本物では、AI に日本語で「電卓で 1 + 2 = を押して、表示が 3
          になることを確かめて」と頼むと、AI がテストケースを作って登録し、ここに出ます。
        </p>
        <Button onClick={() => void onRegister()}>AI に頼んだことにして、登録する</Button>
        {registered > 0 && (
          <span className="text-muted-foreground" role="status">
            登録しました。一覧の「確認待ち」を選んで、承認してから実行してください。
          </span>
        )}
      </aside>
      <App api={demo.api} pollMs={pollMs} />
    </>
  );
}
