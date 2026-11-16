import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { createApi, type Run, type TestcaseRecord } from "../src/api";
import { createFakeServer, exampleRecord, exampleRun, type FakeServer } from "./fakeServer";

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

/** 今いる URL を、テストから読めるように出す。 */
function Location() {
  return <output aria-label="URL">{useLocation().pathname}</output>;
}

function renderAt(fetchImpl: typeof fetch, url = "/") {
  render(
    <MemoryRouter initialEntries={[url]}>
      <App api={createApi(BASE, fetchImpl)} />
      <Location />
    </MemoryRouter>,
  );
}

function start(server: FakeServer, url = "/") {
  renderAt(server.fetch, url);
  return userEvent.setup();
}

const currentUrl = () => screen.getByRole("status", { name: "URL" });

function sidebar() {
  return screen.getByRole("navigation", { name: "テストケースの一覧" });
}

async function openTestcase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await within(sidebar()).findByRole("link", { name: TITLE }));
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

    expect(await screen.findByRole("button", { name: "実行する" })).toBeEnabled();
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

  it("消すと一覧からなくなる", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const server = createFakeServer([exampleRecord()]);
    const user = start(server);
    await openTestcase(user);
    await user.click(screen.getByRole("button", { name: "消す" }));
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
    expect(currentUrl()).toHaveTextContent(/^\/testcases\/tc_1\/runs\/run_new_\d+$/);
    const images = within(runs).getAllByRole("img");
    expect(images.map((i) => i.getAttribute("src"))).toEqual(
      ["ss_1", "ss_2", "ss_3", "ss_4", "ss_5"].map((id) => `${BASE}/screenshots/${id}`),
    );
    expect(within(runs).getByText(/期待：/)).toHaveTextContent("期待：3 実際：3");
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
