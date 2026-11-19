import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createApi, type Run, type TestcaseRecord } from "../src/api";
import {
  createFakeServer,
  exampleRecord,
  exampleRun,
  holdResponses,
  respondWith,
  wait,
  type FakeServer,
} from "./fakeServer";

const BASE = "http://localhost:3000/api";
const TITLE = /1 \+ 2 の足し算/;

function pendingRecord(): TestcaseRecord {
  return { ...exampleRecord(), id: "tc_pending", review_status: "pending" };
}

function failedRun(testcaseId: string, runId: string): Run {
  const run: Run = { ...exampleRun(), id: runId, testcase_id: testcaseId, status: "failed" };
  run.steps = run.steps.map((s) =>
    s.step.type === "expect_text"
      ? { ...s, status: "failed", actual: "4", message: "表示が 3 ではなく 4 でした" }
      : s,
  );
  return run;
}

/** 今いる URL を、テストから読めるように出す。ブラウザの「戻る」の代わりのボタンも置く。 */
function Location() {
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="URL">
        {useLocation().pathname}
        {useLocation().search}
      </output>
      <button type="button" onClick={() => void navigate(-1)}>
        ブラウザで戻る
      </button>
    </>
  );
}

function renderAt(fetchImpl: typeof fetch, url = "/", pollMs = 0) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App api={createApi(BASE, fetchImpl)} pollMs={pollMs} />
      <Location />
    </MemoryRouter>,
  );
}

function start(server: FakeServer, url = "/", pollMs = 0) {
  renderAt(server.fetch, url, pollMs);
  return userEvent.setup();
}

const currentUrl = () => screen.getByRole("status", { name: "URL" });

function sidebar() {
  return screen.getByRole("navigation", { name: "テストケースの一覧" });
}

async function openTestcase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await within(sidebar()).findByRole("link", { name: TITLE }));
}

/**
 * 押せるようになるまで待って、そのボタンを返す。
 * findByRole は押せないボタンも見つけてすぐ返すので、押せるようになるのを待つときはこれを使う。
 */
async function enabledButton(name: string) {
  return vi.waitFor(() => {
    const button = screen.getByRole("button", { name });
    expect(button).toBeEnabled();
    return button;
  });
}

/** 「消す」を押し、確かめの小窓でも「消す」を押す。 */
async function deleteTestcase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "消す" }));
  const confirm = await screen.findByRole("alertdialog", { name: /を消しますか/ });
  await user.click(within(confirm).getByRole("button", { name: "消す" }));
}

describe("テストケースの一覧", () => {
  it("登録されたテストケースが、確認の状態と一緒に並ぶ", async () => {
    start(createFakeServer([pendingRecord(), exampleRecord()]));
    const items = await within(sidebar()).findAllByRole("link", { name: TITLE });
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("確認待ち");
    expect(items[1]).toHaveTextContent("承認済み");
  });

  it("server に届かなければ、そう伝える", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    renderAt(fetchImpl);
    expect(await screen.findByRole("alert")).toHaveTextContent("server に届きません");
  });

  it("選ぶと、そのテストケースの URL に移る", async () => {
    const user = start(createFakeServer([exampleRecord()]));
    await openTestcase(user);
    expect(currentUrl()).toHaveTextContent("/testcases/tc_1");
    expect(within(sidebar()).getByRole("link", { name: TITLE })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

function taggedRecord(id: string, title: string, tags: string[]): TestcaseRecord {
  const record = exampleRecord();
  return { ...record, id, testcase: { ...record.testcase, title, tags } };
}

/** 加算と減算と、タグのないもの。加算の二つは設計書のタグが違う。 */
function taggedServer() {
  return createFakeServer([
    taggedRecord("tc_add_a", "足し算 A", ["機能:加算", "設計書:A"]),
    taggedRecord("tc_add_b", "足し算 B", ["機能:加算", "設計書:B"]),
    taggedRecord("tc_sub", "引き算", ["機能:減算", "設計書:A"]),
    {
      ...exampleRecord(),
      id: "tc_plain",
      testcase: { ...exampleRecord().testcase, tags: undefined },
    },
  ]);
}

const filter = () => within(sidebar()).getByRole("group", { name: "タグで絞り込む" });
const listedTitles = () =>
  within(sidebar())
    .getAllByRole("link")
    .map((link) => link.querySelector(".font-semibold")?.textContent);

describe("タグ", () => {
  it("一覧と詳細に、テストケースのタグが出る", async () => {
    const user = start(createFakeServer([exampleRecord()]));
    const item = await within(sidebar()).findByRole("link", { name: TITLE });
    expect(within(item).getByRole("list", { name: "タグ" })).toHaveTextContent(
      "機能:加算設計書:電卓の基本操作",
    );
    await openTestcase(user);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("list", { name: "タグ" })).toHaveTextContent("機能:加算");
  });

  it("タグのないものは、タグを出さず、絞り込みも出さない", async () => {
    const record = exampleRecord();
    start(createFakeServer([{ ...record, testcase: { ...record.testcase, tags: undefined } }]));
    const item = await within(sidebar()).findByRole("link", { name: TITLE });
    expect(within(item).queryByRole("list", { name: "タグ" })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole("group", { name: "タグで絞り込む" })).toBeNull();
  });

  it("タグを選ぶと、選んだタグを全部持つものだけが並び、URL に残る", async () => {
    const server = taggedServer();
    const user = start(server);
    await within(sidebar()).findByRole("link", { name: /引き算/ });

    await user.click(within(filter()).getByRole("button", { name: "機能:加算" }));
    await vi.waitFor(() => expect(listedTitles()).toEqual(["足し算 A", "足し算 B"]));
    expect(within(filter()).getByRole("button", { name: "機能:加算" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(filter()).getByRole("button", { name: "設計書:A" }));
    await vi.waitFor(() => expect(listedTitles()).toEqual(["足し算 A"]));
    expect(currentUrl()).toHaveTextContent("/?tag=%E6%A9%9F%E8%83%BD%3A%E5%8A%A0%E7%AE%97&tag=");
    // 絞り込みは server がする（REST の tag を繰り返す）。
    expect(server.calls.at(-1)).toBe(
      `GET /testcases?tag=${encodeURIComponent("機能:加算")}&tag=${encodeURIComponent("設計書:A")}`,
    );

    // 選んだものを押すと外れる。
    await user.click(within(filter()).getByRole("button", { name: "機能:加算" }));
    await vi.waitFor(() => expect(listedTitles()).toEqual(["足し算 A", "引き算"]));
  });

  it("タグを選んで読み終えるまで、前の一覧とタグが残る", async () => {
    const server = taggedServer();
    let release = () => {};
    let waiting = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      // 絞り込んだ一覧だけ、release を呼ぶまで返さない（遅い server の代わり）。
      if (new URL((input as Request).url).search.includes("tag=")) {
        waiting = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return server.fetch(input, init);
    };
    renderAt(fetchImpl);
    const user = userEvent.setup();
    await within(sidebar()).findByRole("link", { name: /引き算/ });

    await user.click(within(filter()).getByRole("button", { name: "機能:加算" }));
    await vi.waitFor(() => expect(waiting).toBe(true));
    expect(within(filter()).getByRole("button", { name: "設計書:B" })).toBeVisible();
    expect(listedTitles()).toHaveLength(4);

    release();
    await vi.waitFor(() => expect(listedTitles()).toEqual(["足し算 A", "足し算 B"]));
  });

  it("空の ?tag= は、選んでいないものとする", async () => {
    const server = taggedServer();
    start(server, "/?tag=");
    await vi.waitFor(() => expect(listedTitles()).toHaveLength(4));
    expect(server.calls[0]).toBe("GET /testcases");
    expect(within(filter()).queryByRole("button", { name: "" })).toBeNull();
    expect(within(filter()).queryByRole("button", { pressed: true })).toBeNull();
  });

  it("絞り込みを外すと、全部に戻る", async () => {
    const user = start(taggedServer(), "/?tag=機能:減算");
    await vi.waitFor(() => expect(listedTitles()).toEqual(["引き算"]));
    await user.click(within(sidebar()).getByRole("button", { name: "絞り込みを外す" }));
    await vi.waitFor(() => expect(listedTitles()).toHaveLength(4));
    expect(currentUrl()).toHaveTextContent(/^\/$/);
  });

  it("全部持つものがなければ、そう出る", async () => {
    start(taggedServer(), "/?tag=機能:減算&tag=設計書:B");
    expect(
      await within(sidebar()).findByText("選んだタグを全部持つテストケースはありません。"),
    ).toBeVisible();
    // 選んだタグは、外せるように出しておく。
    expect(within(filter()).getByRole("button", { name: "設計書:B" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("絞り込んだまま詳細を開いて実行しても、絞り込みが残る", async () => {
    const user = start(taggedServer(), "/?tag=機能:減算");
    await user.click(await within(sidebar()).findByRole("link", { name: /引き算/ }));
    expect(currentUrl()).toHaveTextContent("/testcases/tc_sub?tag=");
    await user.click(screen.getByRole("button", { name: "実行する" }));
    await vi.waitFor(() => expect(currentUrl()).toHaveTextContent(/\/runs\/[^?]+\?tag=/));
    expect(listedTitles()).toEqual(["引き算"]);
  });

  it("絞り込んだ一覧から承認すると、その一覧にも承認が出る", async () => {
    const server = taggedServer();
    server.testcases[2] = { ...server.testcases[2], review_status: "pending" };
    const user = start(server, "/testcases/tc_sub?tag=機能:減算");
    const item = await within(sidebar()).findByRole("link", { name: /引き算/ });
    expect(item).toHaveTextContent("確認待ち");
    await user.click(await screen.findByRole("button", { name: "承認する" }));
    await vi.waitFor(() => expect(item).toHaveTextContent("承認済み"));
  });
});

describe("URL を開く", () => {
  it("テストケース一つの URL を開くと、その詳細と、いちばん新しい実行の結果が出る", async () => {
    const older = failedRun("tc_1", "run_old");
    older.started_at = "2026-11-08T09:00:00+09:00";
    start(createFakeServer([exampleRecord()], [exampleRun(), older]), "/testcases/tc_1");
    expect(await screen.findByRole("heading", { name: TITLE })).toBeVisible();
    const runs = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("成功", { selector: "strong" })).toBeVisible();
  });

  it("実行の結果一つの URL を開くと、その結果が出る", async () => {
    const older = failedRun("tc_1", "run_old");
    start(
      createFakeServer([exampleRecord()], [exampleRun(), older]),
      "/testcases/tc_1/runs/run_old",
    );
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("失敗", { selector: "strong" })).toBeVisible();
    expect(within(runs).getByRole("link", { name: /失敗/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("ないテストケースの URL を開くと、server の説明が出る", async () => {
    start(createFakeServer([exampleRecord()]), "/testcases/tc_none");
    expect(await screen.findByRole("alert")).toHaveTextContent("見つかりません");
  });

  it("ない実行の結果の URL を開くと、見つからないと出る", async () => {
    start(createFakeServer([exampleRecord()], [exampleRun()]), "/testcases/tc_1/runs/run_none");
    expect(await screen.findByText(/この実行の結果は見つかりません/)).toBeVisible();
  });
});

describe("ほかからの変更と、画面の行き来", () => {
  it("開いたままの詳細に、ほかでの承認が出る", async () => {
    const server = createFakeServer([pendingRecord()]);
    start(server, "/testcases/tc_pending", 30);
    expect(await screen.findByRole("button", { name: "承認する" })).toBeVisible();
    server.testcases[0] = { ...server.testcases[0], review_status: "approved" };
    await enabledButton("実行する");
    expect(screen.queryByRole("button", { name: "承認する" })).not.toBeInTheDocument();
  });

  it("開いたままの詳細に、ほかで足された実行の結果が出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    start(server, "/testcases/tc_1", 30);
    expect(await screen.findByText("まだ実行していません。")).toBeVisible();
    // AI が MCP から実行した代わりに、server に直に足す
    server.runs.unshift({ ...exampleRun(), id: "run_mcp", testcase_id: "tc_1" });
    const results = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(results).findByRole("link", { name: /成功/ })).toBeInTheDocument();
    expect(screen.queryByText("まだ実行していません。")).not.toBeInTheDocument();
  });

  it("承認の前に読んだ一覧が、承認のあとに届いても、承認が残る", async () => {
    const server = createFakeServer([pendingRecord()]);
    const user = start(server);
    await openTestcase(user);
    // 一覧の読み直しを、承認の前の中身のまま止める
    const list = holdResponses(server, (call) => call === "GET /testcases");
    await user.click(within(sidebar()).getByRole("button", { name: "読み直す" }));
    await vi.waitFor(() => expect(list.held()).toBe(1));

    await user.click(screen.getByRole("button", { name: "承認する" }));
    await enabledButton("実行する");
    expect(within(sidebar()).getByRole("link", { name: TITLE })).toHaveTextContent("承認済み");

    list.release();
    await wait(50);
    expect(within(sidebar()).getByRole("link", { name: TITLE })).toHaveTextContent("承認済み");
    expect(server.calls.filter((c) => c === "GET /testcases")).toHaveLength(2);
  });

  it("消す前に読んだ一覧が、消したあとに届いても、一覧に戻らない", async () => {
    const server = createFakeServer([exampleRecord()]);
    const user = start(server);
    await openTestcase(user);
    const list = holdResponses(server, (call) => call === "GET /testcases");
    await user.click(within(sidebar()).getByRole("button", { name: "読み直す" }));
    await vi.waitFor(() => expect(list.held()).toBe(1));

    await deleteTestcase(user);
    expect(await screen.findByText("左の一覧からテストケースを選んでください。")).toBeVisible();

    list.release();
    await wait(50);
    expect(within(sidebar()).queryByRole("link", { name: TITLE })).not.toBeInTheDocument();
  });

  it("開いている間にほかで消されると、見つからないと出て、実行できない", async () => {
    const server = createFakeServer([exampleRecord()]);
    start(server, "/testcases/tc_1", 30);
    await enabledButton("実行する");
    server.testcases.splice(0, 1);
    expect(await screen.findByRole("alert")).toHaveTextContent("見つかりません");
    expect(screen.queryByRole("button", { name: "実行する" })).not.toBeInTheDocument();
  });

  it("消したあと戻ると、消したものは出ず、見つからないと出る", async () => {
    const user = start(createFakeServer([exampleRecord()]));
    await openTestcase(user);
    await deleteTestcase(user);
    expect(await screen.findByText("左の一覧からテストケースを選んでください。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "ブラウザで戻る" }));
    expect(currentUrl()).toHaveTextContent("/testcases/tc_1");
    expect(await screen.findByRole("alert")).toHaveTextContent("見つかりません");
    expect(screen.queryByRole("button", { name: "実行する" })).not.toBeInTheDocument();
  });

  it("実行中にほかのテストケースへ移ると、終わっても引き戻されない", async () => {
    const server = createFakeServer([exampleRecord(), { ...exampleRecord(), id: "tc_2" }]);
    let finishRun = () => {};
    const slowFetch: typeof fetch = async (input, init) => {
      const request = input as Request;
      if (request.method === "POST" && request.url.endsWith("/runs")) {
        await new Promise<void>((resolve) => (finishRun = resolve));
      }
      return server.fetch(input, init);
    };
    renderAt(slowFetch, "/testcases/tc_1");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "実行する" }));
    expect(await screen.findByRole("button", { name: "実行中…" })).toBeDisabled();

    const links = within(sidebar()).getAllByRole("link", { name: TITLE });
    await user.click(links[1]);
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_2$/);
    finishRun();
    await vi.waitFor(() => expect(server.calls).toContain("POST /testcases/tc_1/runs"));
    // 実行の結果が届いて入れ物が直るまで待ってから、URL を見る
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_2$/);
  });

  it("実行中にほかのテストケースへ移って戻っても、実行できず、終わると結果が出る", async () => {
    const server = createFakeServer([exampleRecord(), { ...exampleRecord(), id: "tc_2" }]);
    let finishRun = () => {};
    const slowFetch: typeof fetch = async (input, init) => {
      const request = input as Request;
      if (request.method === "POST" && request.url.endsWith("/runs")) {
        await new Promise<void>((resolve) => (finishRun = resolve));
      }
      return server.fetch(input, init);
    };
    renderAt(slowFetch, "/testcases/tc_1");
    const user = userEvent.setup();
    expect(await screen.findByText("まだ実行していません。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "実行する" }));
    expect(await screen.findByRole("button", { name: "実行中…" })).toBeDisabled();

    const links = within(sidebar()).getAllByRole("link", { name: TITLE });
    await user.click(links[1]);
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_2$/);
    // ほかのテストケースは実行できる（実行中なのは tc_1 だけ）
    await enabledButton("実行する");

    await user.click(links[0]);
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_1$/);
    expect(await screen.findByRole("button", { name: "実行中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "消す" })).toBeDisabled();

    finishRun();
    const results = await screen.findByRole("region", { name: "実行の結果" });
    expect(await within(results).findByRole("link", { name: /成功/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "実行する" })).toBeEnabled();
    expect(server.calls.filter((c) => c === "POST /testcases/tc_1/runs")).toHaveLength(1);
  });

  it("実行中にほかのテストケースへ移って戻り、実行が失敗すると、server の説明が出る", async () => {
    const run = startHeldRun();
    run.server.nextRun = () => null;
    const user = userEvent.setup();
    await run.leaveAndReturn(user);

    run.finish();
    expect(await screen.findByRole("alert")).toHaveTextContent("runner に届きません");
    expect(screen.getByRole("button", { name: "実行する" })).toBeEnabled();
  });

  it("戻ったときの結果の一覧の読み直しが、実行の終わりより遅く届いても、結果が残る", async () => {
    const run = startHeldRun();
    const user = userEvent.setup();
    // 戻ったときに読む一覧は、実行の終わる前の中身のまま、終わったあとに届く
    run.holdRunList = true;
    await run.leaveAndReturn(user);

    run.finish();
    const results = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(results).findByRole("link", { name: /成功/ })).toBeInTheDocument();
    run.releaseRunList();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(results).getAllByRole("link", { name: /成功/ })).toHaveLength(1);
  });
});

/**
 * tc_1 の実行を、finish() を呼ぶまで終わらせない形で始める。
 * holdRunList を true にすると、それ以降の tc_1 の結果の一覧は、その時点の中身のまま、releaseRunList() まで届かない。
 */
function startHeldRun() {
  const server = createFakeServer([exampleRecord(), { ...exampleRecord(), id: "tc_2" }]);
  let finish = () => {};
  let releaseRunList = () => {};
  const runListGate = new Promise<void>((resolve) => (releaseRunList = resolve));
  const held = {
    server,
    holdRunList: false,
    finish: () => finish(),
    releaseRunList: () => releaseRunList(),
    async leaveAndReturn(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole("button", { name: "実行する" }));
      expect(await screen.findByRole("button", { name: "実行中…" })).toBeDisabled();
      const links = within(sidebar()).getAllByRole("link", { name: TITLE });
      await user.click(links[1]);
      await enabledButton("実行する");
      await user.click(links[0]);
      expect(await screen.findByRole("button", { name: "実行中…" })).toBeDisabled();
    },
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = input as Request;
    if (request.method === "POST" && request.url.endsWith("/runs")) {
      await new Promise<void>((resolve) => (finish = resolve));
    }
    const holdThis =
      held.holdRunList && request.method === "GET" && request.url.includes("testcase_id=tc_1");
    const response = await server.fetch(input, init);
    if (holdThis) await runListGate;
    return response;
  };
  renderAt(fetchImpl, "/testcases/tc_1");
  return held;
}

describe("人の確認", () => {
  it("元の日本語と、生成されたステップを見比べられる", async () => {
    const user = start(createFakeServer([exampleRecord()]));
    await openTestcase(user);
    const compare = screen.getByRole("region", { name: "手順とステップの見比べ" });
    expect(compare).toHaveTextContent("電卓で 1 + 2 = を押して、表示が 3 になることを確かめる");
    const steps = within(compare).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent)).toEqual([
      "「1」のキーを押す",
      "「足す」をタップする",
      "「2」のキーを押す",
      "「等号」のキーを押す",
      "「表示」が「3」であることを確かめる",
    ]);
  });

  it("確認待ちのものは実行できず、承認すると実行できる", async () => {
    const server = createFakeServer([pendingRecord()]);
    const user = start(server);
    await openTestcase(user);

    expect(screen.getByRole("button", { name: "実行する" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "承認する" }));

    await enabledButton("実行する");
    expect(screen.queryByRole("button", { name: "承認する" })).not.toBeInTheDocument();
    expect(server.calls).toContain("POST /testcases/tc_pending/approve");
    expect(within(sidebar()).getByRole("link", { name: TITLE })).toHaveTextContent("承認済み");
  });

  it("確認の要らないものは、承認なしで実行できる", async () => {
    const user = start(createFakeServer([{ ...exampleRecord(), review_status: "not_required" }]));
    await openTestcase(user);
    expect(screen.queryByRole("button", { name: "承認する" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "実行する" })).toBeEnabled();
  });

  it("消すのをやめると、何も消えない", async () => {
    const server = createFakeServer([exampleRecord()]);
    const user = start(server);
    await openTestcase(user);
    await user.click(screen.getByRole("button", { name: "消す" }));
    const confirm = await screen.findByRole("alertdialog", { name: /を消しますか/ });
    await user.click(within(confirm).getByRole("button", { name: "やめる" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(currentUrl()).toHaveTextContent("/testcases/tc_1");
    expect(server.calls).not.toContain("DELETE /testcases/tc_1");
  });

  it("消すと一覧からなくなる", async () => {
    const server = createFakeServer([exampleRecord()]);
    const user = start(server);
    await openTestcase(user);
    await deleteTestcase(user);
    expect(await screen.findByText("左の一覧からテストケースを選んでください。")).toBeVisible();
    expect(currentUrl()).toHaveTextContent(/^\/$/);
    expect(within(sidebar()).queryByRole("link", { name: TITLE })).not.toBeInTheDocument();
    expect(server.calls).toContain("DELETE /testcases/tc_1");
  });
});

describe("実行と結果", () => {
  it("実行すると、ステップごとの結果とスクショが出る", async () => {
    const user = start(createFakeServer([exampleRecord()]));
    await openTestcase(user);
    expect(await screen.findByText("まだ実行していません。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "実行する" }));

    const runs = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("成功", { selector: "strong" })).toBeVisible();
    // 結果は、URL が移るより一瞬早く出ることがあるので、移るのを待つ
    await vi.waitFor(() =>
      expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_1\/runs\/run_new_\d+$/),
    );
    const images = within(runs).getAllByRole("img");
    expect(images.map((i) => i.getAttribute("src"))).toEqual(
      ["ss_1", "ss_2", "ss_3", "ss_4", "ss_5"].map((id) => `${BASE}/screenshots/${id}`),
    );
    expect(within(runs).getByText(/期待：/)).toHaveTextContent("期待：3 実際：3");
  });

  it("大きく見ている間にほかで実行されて、出す結果が変わると、大きく見ていたものは閉じる", async () => {
    const server = createFakeServer([exampleRecord()], [exampleRun()]);
    start(server, "/testcases/tc_1", 30);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "ステップ 5 のあとのスクショを大きく見る" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();

    // AI が MCP から実行した代わりに、server に直に足す。URL で結果を選んでいないので、出すのはいちばん新しいものに変わる
    server.runs.unshift(failedRun("tc_1", "run_mcp"));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const results = screen.getByRole("region", { name: "実行の結果" });
    expect(within(results).getByRole("link", { name: /失敗/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("スクショを押すと大きく見られる", async () => {
    const user = start(createFakeServer([exampleRecord()], [exampleRun()]));
    await openTestcase(user);
    await user.click(
      await screen.findByRole("button", { name: "ステップ 5 のあとのスクショを大きく見る" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", `${BASE}/screenshots/ss_5`);
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Esc でも閉じる
    await user.click(
      screen.getByRole("button", { name: "ステップ 5 のあとのスクショを大きく見る" }),
    );
    expect(screen.getByRole("dialog", { name: "ステップ 5 のあとのスクショ" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 大きくした画像を押しても閉じる
    await user.click(
      screen.getByRole("button", { name: "ステップ 5 のあとのスクショを大きく見る" }),
    );
    await user.click(within(screen.getByRole("dialog")).getByRole("img"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("確認事項が合わなければ、失敗と、期待と実際の値が出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    server.nextRun = failedRun;
    const user = start(server);
    await openTestcase(user);
    await user.click(screen.getByRole("button", { name: "実行する" }));

    const runs = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("失敗", { selector: "strong" })).toBeVisible();
    expect(within(runs).getByText(/期待：/)).toHaveTextContent("期待：3 実際：4");
    expect(within(runs).getByText("表示が 3 ではなく 4 でした")).toBeVisible();
  });

  it("runner に届かなければ、server の説明が出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    server.nextRun = () => null;
    const user = start(server);
    await openTestcase(user);
    await user.click(screen.getByRole("button", { name: "実行する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("runner に届きません");
  });

  it("前の実行の結果を選んで見られる", async () => {
    const older = failedRun("tc_1", "run_old");
    older.started_at = "2026-11-08T09:00:00+09:00";
    older.finished_at = "2026-11-08T09:00:02+09:00";
    const user = start(createFakeServer([exampleRecord()], [exampleRun(), older]));
    await openTestcase(user);

    const runs = screen.getByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("成功", { selector: "strong" })).toBeVisible();
    await user.click(within(runs).getByRole("link", { name: /失敗/ }));
    expect(within(runs).getByText("失敗", { selector: "strong" })).toBeVisible();
  });
});

/** 途中で止まった実行。3 つめのステップでエラーになり、残りは飛ばした。スクショは撮れたものだけ。 */
function erroredRun(testcaseId: string, runId: string): Run {
  const run: Run = {
    ...exampleRun(),
    id: runId,
    testcase_id: testcaseId,
    status: "error",
    error: { code: "part_not_found", message: "部品「2」が見つかりません" },
  };
  run.steps = run.steps.map((s) => {
    if (s.index < 2) return s;
    const { step, index } = s;
    return index === 2
      ? { index, step, status: "error", message: "部品「2」が見つかりません" }
      : { index, step, status: "skipped" };
  });
  return run;
}

const isRunList = (call: string) => call.startsWith("GET /runs");
const runListError = { error: { code: "internal", message: "実行の結果を読めません" } };

describe("エラーと、空・読み込み中の表示", () => {
  it("結果の一覧の読み込みに失敗したあとに承認しても、エラーが残り、読み込み中とは出ない", async () => {
    const server = createFakeServer([pendingRecord()]);
    respondWith(server, isRunList, 500, runListError);
    start(server, "/testcases/tc_pending");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByRole("alert")).toHaveTextContent("実行の結果を読めません");

    await userEvent.setup().click(screen.getByRole("button", { name: "承認する" }));
    await enabledButton("実行する");
    expect(within(runs).getByRole("alert")).toHaveTextContent("実行の結果を読めません");
    expect(within(runs).queryByText("読み込み中…")).not.toBeInTheDocument();
  });

  it("結果の一覧を読んでいる間に承認しても、読み終えて、読み込み中のまま止まらない", async () => {
    const server = createFakeServer(
      [pendingRecord()],
      [{ ...exampleRun(), testcase_id: "tc_pending" }],
    );
    const runList = holdResponses(server, isRunList);
    start(server, "/testcases/tc_pending");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    await vi.waitFor(() => expect(runList.held()).toBe(1));

    await userEvent.setup().click(screen.getByRole("button", { name: "承認する" }));
    await enabledButton("実行する");
    runList.release();
    expect(await within(runs).findByText("成功", { selector: "strong" })).toBeVisible();
    expect(within(runs).queryByText("読み込み中…")).not.toBeInTheDocument();
  });

  it("テストケースの一覧を読んでいる間に承認しても、読み終えて、読み込み中のまま止まらない", async () => {
    const server = createFakeServer([pendingRecord()]);
    const list = holdResponses(server, (call) => call === "GET /testcases");
    start(server, "/testcases/tc_pending");
    await vi.waitFor(() => expect(list.held()).toBe(1));

    await userEvent.setup().click(await enabledButton("承認する"));
    await enabledButton("実行する");
    list.release();
    expect(await within(sidebar()).findByRole("link", { name: TITLE })).toHaveTextContent(
      "承認済み",
    );
    expect(within(sidebar()).queryByText("読み込み中…")).not.toBeInTheDocument();
  });

  it("結果の一覧の読み込みに失敗したあとに実行を断られると、両方のエラーが出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    respondWith(server, isRunList, 500, runListError);
    respondWith(server, (call) => call === "POST /testcases/tc_1/runs", 409, {
      error: { code: "runner_busy", message: "runner はほかの実行の最中です" },
    });
    start(server, "/testcases/tc_1");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    await within(runs).findByRole("alert");

    await userEvent.setup().click(await enabledButton("実行する"));
    const actions = screen.getByRole("region", { name: "操作" });
    expect(await within(actions).findByRole("alert")).toHaveTextContent(
      "runner はほかの実行の最中です",
    );
    expect(within(runs).getByRole("alert")).toHaveTextContent("実行の結果を読めません");
  });

  it("結果の一覧の読み込みに失敗したあとに実行すると、前の実行も一覧に出る", async () => {
    const older = failedRun("tc_1", "run_old");
    const server = createFakeServer([exampleRecord()], [older]);
    respondWith(server, isRunList, 500, runListError, 1);
    start(server, "/testcases/tc_1");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    await within(runs).findByRole("alert");

    await userEvent.setup().click(await enabledButton("実行する"));
    expect(await within(runs).findByRole("link", { name: /失敗/ })).toBeVisible();
    expect(within(runs).getByRole("link", { name: /成功/ })).toBeVisible();
    expect(within(runs).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("中継が本文なしの 502 を返したら、server に届かないと出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    respondWith(server, () => true, 502);
    start(server);
    const alert = await within(sidebar()).findByRole("alert");
    expect(alert).toHaveTextContent("server に届きません");
    expect(alert).not.toHaveTextContent("HTTP 502");
  });

  it("server が説明つきの 502 を返したら、その説明が出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    server.nextRun = () => null;
    start(server, "/testcases/tc_1");
    await userEvent.setup().click(await enabledButton("実行する"));
    const actions = screen.getByRole("region", { name: "操作" });
    expect(await within(actions).findByRole("alert")).toHaveTextContent("runner に届きません");
    expect(within(actions).getByRole("alert")).not.toHaveTextContent("server に届きません");
  });

  it("途中で止まった実行は、エラーの理由と、エラーのステップと、飛ばしたステップが出る", async () => {
    start(createFakeServer([exampleRecord()], [erroredRun("tc_1", "run_err")]), "/testcases/tc_1");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    expect(await within(runs).findByText("エラー", { selector: "strong" })).toBeVisible();
    expect(within(runs).getByRole("alert")).toHaveTextContent(
      "部品「2」が見つかりません（part_not_found）",
    );
    const steps = within(
      within(runs).getByRole("list", { name: "ステップごとの結果" }),
    ).getAllByRole("listitem");
    expect(steps[2]).toHaveTextContent("エラー");
    expect(steps[2]).toHaveTextContent("部品「2」が見つかりません");
    expect(steps[3]).toHaveTextContent("未実行");
    expect(steps[4]).toHaveTextContent("未実行");
  });

  it("スクショのないステップは、スクショなしと出る", async () => {
    start(createFakeServer([exampleRecord()], [erroredRun("tc_1", "run_err")]), "/testcases/tc_1");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    const steps = within(
      await within(runs).findByRole("list", { name: "ステップごとの結果" }),
    ).getAllByRole("listitem");
    expect(within(steps[1]).getByRole("img")).toBeVisible();
    for (const step of steps.slice(2)) {
      expect(within(step).queryByRole("img")).not.toBeInTheDocument();
      expect(step).toHaveTextContent("スクショなし");
    }
  });

  it("登録のあとで部品の辞書が変わって実行を断られると、server の説明が出て、また押せる", async () => {
    const server = createFakeServer([exampleRecord()]);
    respondWith(server, (call) => call === "POST /testcases/tc_1/runs", 409, {
      error: { code: "testcase_out_of_date", message: "いまの部品の辞書に合いません" },
    });
    start(server, "/testcases/tc_1");
    await userEvent.setup().click(await enabledButton("実行する"));
    const actions = screen.getByRole("region", { name: "操作" });
    expect(await within(actions).findByRole("alert")).toHaveTextContent(
      "いまの部品の辞書に合いません",
    );
    expect(screen.getByRole("button", { name: "実行する" })).toBeEnabled();
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_1$/);
  });

  it("開いている間にほかで確認待ちに戻され、実行を断られると、server の説明が出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    start(server, "/testcases/tc_1");
    const run = await enabledButton("実行する");
    // ほかで確認待ちに戻された代わりに、server に直に書く（読み直していないので、画面は承認済みのまま）
    server.testcases[0] = { ...server.testcases[0], review_status: "pending" };
    await userEvent.setup().click(run);
    const actions = screen.getByRole("region", { name: "操作" });
    expect(await within(actions).findByRole("alert")).toHaveTextContent("人の確認待ちです");
  });

  it("テストケースが一つもなければ、そう出る", async () => {
    start(createFakeServer([]));
    expect(await within(sidebar()).findByText(/まだありません。AI に日本語で頼むと/)).toBeVisible();
  });

  it("一覧を読み終えるまで、読み込み中と出る", async () => {
    const server = createFakeServer([exampleRecord()]);
    const list = holdResponses(server, (call) => call === "GET /testcases");
    start(server);
    expect(within(sidebar()).getByText("読み込み中…")).toBeVisible();
    list.release();
    expect(await within(sidebar()).findByRole("link", { name: TITLE })).toBeVisible();
    expect(within(sidebar()).queryByText("読み込み中…")).not.toBeInTheDocument();
  });

  it("実行の結果の一覧を読み終えるまで、読み込み中と出る", async () => {
    const server = createFakeServer([exampleRecord()], [exampleRun()]);
    const runList = holdResponses(server, isRunList);
    start(server, "/testcases/tc_1");
    const runs = await screen.findByRole("region", { name: "実行の結果" });
    expect(within(runs).getByText("読み込み中…")).toBeVisible();
    runList.release();
    expect(await within(runs).findByText("成功", { selector: "strong" })).toBeVisible();
    expect(within(runs).queryByText("読み込み中…")).not.toBeInTheDocument();
  });
});
