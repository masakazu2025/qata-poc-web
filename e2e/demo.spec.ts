// 電卓のデモの流れを、端から端まで一本通す。
// AI の代わりに MCP のクライアントでテストケースを登録し、web で承認して実行し、結果とスクショを見る。
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { parentDir, serverUrl } from "../playwright.config";

type Structured = Record<string, unknown>;

async function connectMcp(): Promise<Client> {
  const client = new Client({ name: "qata-e2e", version: "0.1.0" });
  // MCP は REST と同じ server のプロセスが /mcp で答える（qata-server の README）
  await client.connect(new StreamableHTTPClientTransport(new URL(`${serverUrl}/mcp`)));
  return client;
}

async function call(client: Client, name: string, args: Structured = {}): Promise<Structured> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, `${name} が失敗した：${JSON.stringify(result.content)}`).toBeFalsy();
  return result.structuredContent as Structured;
}

test("MCP で登録したテストケースを、web で承認して実行し、結果とスクショを見る", async ({
  page,
}) => {
  const title = `1 + 2 の足し算（${new Date().toISOString()}）`;

  await test.step("AI が MCP で部品の辞書を読み、テストケースを登録する", async () => {
    const client = await connectMcp();
    try {
      const { apps } = await call(client, "list_apps");
      expect(apps).toEqual(
        expect.arrayContaining([expect.objectContaining({ app_id: "calculator" })]),
      );

      const dictionary = await call(client, "get_part_dictionary", { app_id: "calculator" });
      const parts = dictionary.parts as Record<string, unknown>;
      for (const name of ["1", "足す", "2", "等号", "表示"]) expect(parts).toHaveProperty(name);

      // 日本語の手順から AI が作るものとして、契約の例を使う
      const example = JSON.parse(
        readFileSync(path.join(parentDir, "contracts/examples/testcase.add.json"), "utf-8"),
      ) as Structured;
      const testcase = { ...example, title, needs_review: true };

      const validation = await call(client, "validate_testcase", { testcase });
      expect(validation).toMatchObject({ valid: true });

      const registered = await call(client, "register_testcase", { testcase });
      expect(registered).toMatchObject({
        registered: true,
        testcase_record: { review_status: "pending" },
      });
    } finally {
      await client.close();
    }
  });

  await test.step("web の一覧に出て、確認待ちなので実行できない", async () => {
    await page.goto("/");
    const item = page.getByRole("link", { name: new RegExp(escape(title)) });
    await expect(item).toBeVisible({ timeout: 10_000 }); // 一覧は 3 秒ごとに読み直す
    await item.click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page).toHaveURL(/\/testcases\/[^/]+$/);
    await expect(page.getByText("電卓で 1 + 2 = を押して")).toBeVisible();
    await expect(page.getByRole("button", { name: "実行する" })).toBeDisabled();
  });

  await test.step("承認して実行する", async () => {
    await page.getByRole("button", { name: "承認する" }).click();
    const run = page.getByRole("button", { name: "実行する" });
    await expect(run).toBeEnabled();
    await run.click();
  });

  await test.step("結果とスクショを見る", async () => {
    const result = page.getByRole("region", { name: "実行の結果" });
    await expect(result.locator("strong")).toHaveText("成功", { timeout: 30_000 });
    const steps = result.getByRole("list", { name: "ステップごとの結果" }).getByRole("listitem");
    await expect(steps).toHaveCount(5);
    await expect(steps.locator('[data-slot="badge"]')).toHaveText(["OK", "OK", "OK", "OK", "OK"]);
    await expect(result.getByText("期待：3　実際：3")).toBeVisible();

    const shots = result.getByRole("img", { name: /のあとのスクショ/ });
    await expect(shots).toHaveCount(5);
    for (const shot of await shots.all()) {
      await shot.scrollIntoViewIfNeeded();
      await expect
        .poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);
    }

    await result.getByRole("button", { name: "ステップ 5 のあとのスクショを大きく見る" }).click();
    await expect(page.getByRole("dialog", { name: "ステップ 5 のあとのスクショ" })).toBeVisible();
    await page.getByRole("button", { name: "閉じる" }).click();
  });

  await test.step("実行の結果の URL を開き直すと、同じ結果が出る", async () => {
    await expect(page).toHaveURL(/\/testcases\/[^/]+\/runs\/[^/]+$/);
    await page.reload();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const result = page.getByRole("region", { name: "実行の結果" });
    await expect(result.locator("strong")).toHaveText("成功");
    await expect(
      result.getByRole("list", { name: "ステップごとの結果" }).getByRole("listitem"),
    ).toHaveCount(5);
  });
});

test("MCP でタグを付けて登録したテストケースを、web でタグで絞り込む", async ({ page }) => {
  const stamp = new Date().toISOString();
  // ほかのテストで登録したものと混ざらないように、この回だけのタグを付ける。
  const runTag = `e2e:${stamp}`;
  const otherTag = `e2e:ほか:${stamp}`;
  const wanted = `絞り込みで出るもの（${stamp}）`;
  const others = [
    { title: `同じ機能で別の回のもの（${stamp}）`, tags: ["機能:加算", otherTag] },
    { title: `タグのないもの（${stamp}）`, tags: undefined },
  ];

  await test.step("AI が MCP で、タグの違うテストケースを登録する", async () => {
    const example = JSON.parse(
      readFileSync(path.join(parentDir, "contracts/examples/testcase.add.json"), "utf-8"),
    ) as Structured;
    const client = await connectMcp();
    try {
      for (const { title, tags } of [{ title: wanted, tags: ["機能:加算", runTag] }, ...others]) {
        const testcase: Structured = { ...example, title };
        if (tags) testcase.tags = tags;
        else delete testcase.tags;
        const registered = await call(client, "register_testcase", { testcase });
        expect(registered).toMatchObject({ registered: true });
      }
    } finally {
      await client.close();
    }
  });

  await test.step("web でタグを選ぶと、そのタグを持つものだけが並ぶ", async () => {
    await page.goto("/");
    const list = page.getByRole("navigation", { name: "テストケースの一覧" });
    for (const title of [wanted, ...others.map((o) => o.title)]) {
      await expect(list.getByRole("link", { name: new RegExp(escape(title)) })).toBeVisible({
        timeout: 10_000,
      });
    }
    await list
      .getByRole("group", { name: "タグで絞り込む" })
      .getByRole("button", { name: runTag, exact: true })
      .click();
    await expect(page).toHaveURL(/\?tag=/);
    await expect(list.getByRole("link")).toHaveCount(1);
    await expect(list.getByRole("link", { name: new RegExp(escape(wanted)) })).toBeVisible();
  });

  await test.step("開き直しても絞り込みが残り、詳細にもタグが出る", async () => {
    await page.reload();
    const list = page.getByRole("navigation", { name: "テストケースの一覧" });
    await expect(list.getByRole("link")).toHaveCount(1);
    await list.getByRole("link", { name: new RegExp(escape(wanted)) }).click();
    await expect(page.getByRole("heading", { name: wanted })).toBeVisible();
    // タグの並びの順は意味を持たない（契約）ので、それぞれが出ていることだけを見る。
    const tags = page.getByRole("main").getByRole("list", { name: "タグ" }).getByRole("listitem");
    await expect(tags).toHaveCount(2);
    for (const tag of ["機能:加算", runTag])
      await expect(tags.filter({ hasText: tag })).toHaveCount(1);
    await expect(list.getByRole("link")).toHaveCount(1);
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
