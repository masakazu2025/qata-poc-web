// テストの偽の server。返すものはすべて親の契約で判定する（偽物が契約からずれないように）。
import type { Run, TestcaseRecord } from "../src/api";
import { createFakeServer as create, type FakeServer } from "../src/demo/fakeServer";
import { assertServerShape, readExample } from "./contract";

export type { FakeServer };

export const exampleRecord = (): TestcaseRecord => readExample("testcase-record.json");
export const exampleRun = (): Run => readExample("run.json");

/**
 * 偽の server の応答を、毎回これだけ遅らせる（ミリ秒）。vitest の組 slow-server が QATA_FAKE_DELAY_MS で決める（vite.config.ts）。
 * すぐに応答する偽物だと、待つつもりで待っていないテストもたまたま通るので、遅らせてもう一度回す。
 */
export const fakeDelayMs = Number(process.env.QATA_FAKE_DELAY_MS ?? 0);

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 偽の server の delay に渡す、組ごとの遅れ。 */
export const fakeDelay = () => (fakeDelayMs > 0 ? wait(fakeDelayMs) : undefined);

export function createFakeServer(testcases: TestcaseRecord[], runs: Run[] = []): FakeServer {
  return create(testcases, runs, {
    check: assertServerShape,
    nextRun: (testcaseId, runId) => ({ ...exampleRun(), id: runId, testcase_id: testcaseId }),
    delay: fakeDelay,
  });
}

/**
 * match に合う応答を、作った時点の中身のまま、release() を呼ぶまで止める。
 * 止めている間にほかの操作をすれば、その操作より古い応答があとから届く形になる。
 */
export function holdResponses(server: FakeServer, match: (call: string) => boolean) {
  const delay = server.delay;
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  server.delay = async (call) => {
    if (match(call)) {
      held++;
      await gate;
    }
    await delay(call);
  };
  return {
    /** 止めた応答の数。 */
    held: () => held,
    release: () => {
      server.delay = delay;
      release();
    },
  };
}
