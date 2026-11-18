// scripts/sync_contracts.mjs（親のタグから契約を写す道具）の、写し方・比べ方・版の比べ方・警告。
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  contractsIn,
  differences,
  newerVersion,
  oldVersionNotice,
  warnIfOld,
  write,
} from "../scripts/sync_contracts.mjs";

type Entry = { name: string; data?: string; type?: string; prefix?: string };

function header({ name, data = "", type = "0", prefix = "" }: Entry): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write("0000644\0", 100);
  block.write(Buffer.byteLength(data).toString(8).padStart(11, "0") + "\0", 124);
  block.write(type, 156);
  block.write("ustar\0", 257);
  block.write(prefix, 345, 155, "utf8");
  return block;
}

/** GitHub の tarball と同じく、pax のヘッダと一段目のフォルダを持つ tar.gz を作る。 */
function tarball(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "", "utf8");
    parts.push(header(entry), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

function pax(path: string): string {
  // 長さは、頭の数も含めたバイト数
  const body = ` path=${path}\n`;
  const bytes = (n: number) => Buffer.byteLength(`${n}${body}`);
  let length = Buffer.byteLength(body);
  while (bytes(length) !== length) length = bytes(length);
  return `${length}${body}`;
}

const sample = () =>
  tarball([
    { name: "pax_global_header", type: "g", data: pax("ignored") },
    { name: "qata-contracts-v1.0.0/", type: "5" },
    { name: "qata-contracts-v1.0.0/README.md", data: "親の説明" },
    { name: "qata-contracts-v1.0.0/contracts/VERSION", data: "1.0.0\n" },
    { name: "qata-contracts-v1.0.0/contracts/schemas/", type: "5" },
    { name: "qata-contracts-v1.0.0/contracts/schemas/run.schema.json", data: "{}" },
    // 100 字を超える道は pax の path で渡ってくる
    {
      name: "PaxHeader",
      type: "x",
      data: pax(`qata-contracts-v1.0.0/contracts/examples/${"長".repeat(40)}.json`),
    },
    { name: "short-name", data: "[1]" },
    // ustar の prefix に分けて入る道
    { name: "openapi.yaml", prefix: "qata-contracts-v1.0.0/contracts", data: "openapi: 3.1.0" },
  ]);

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qata-sync-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("tarball から契約を取り出す", () => {
  it("contracts/ の中だけを、contracts/ からの道で取る（pax と prefix の道も）", () => {
    const files = contractsIn(sample());
    expect([...files.keys()].sort()).toEqual(
      [
        `examples/${"長".repeat(40)}.json`,
        "openapi.yaml",
        "schemas/run.schema.json",
        "VERSION",
      ].sort(),
    );
    expect(files.get("VERSION")?.toString()).toBe("1.0.0\n");
    expect(files.get(`examples/${"長".repeat(40)}.json`)?.toString()).toBe("[1]");
  });

  it("contracts/ がなければ投げる", () => {
    expect(() => contractsIn(tarball([{ name: "qata-x/README.md", data: "a" }]))).toThrow(
      /contracts\/ がない/,
    );
  });
});

describe("写しと比べる", () => {
  it("写したばかりなら違いはない", () => {
    const dir = join(tempDir(), "qata-contracts");
    write(sample(), dir);
    expect(readFileSync(join(dir, "VERSION"), "utf8")).toBe("1.0.0\n");
    expect(differences(sample(), dir)).toEqual([]);
  });

  it("書き換え・足したもの・消したものを拾う", () => {
    const dir = join(tempDir(), "qata-contracts");
    write(sample(), dir);
    writeFileSync(join(dir, "openapi.yaml"), "openapi: 3.0.0");
    mkdirSync(join(dir, "extra"));
    writeFileSync(join(dir, "extra", "added.json"), "{}");
    rmSync(join(dir, "VERSION"));
    expect(differences(sample(), dir)).toEqual(["VERSION", "extra/added.json", "openapi.yaml"]);
  });

  it("写しがなければ、すべてが違う", () => {
    expect(differences(sample(), join(tempDir(), "none"))).toHaveLength(4);
  });

  it("写し直すと、前の写しにだけあったものは消える", () => {
    const dir = join(tempDir(), "qata-contracts");
    mkdirSync(dir);
    writeFileSync(join(dir, "old.json"), "{}");
    write(sample(), dir);
    expect(differences(sample(), dir)).toEqual([]);
  });
});

const lsRemote = (...tags: string[]) =>
  tags.map((t, i) => `${String(i).padStart(40, "0")}\trefs/tags/${t}`).join("\n") + "\n";

describe("親の最新の版", () => {
  it("読む版より新しい、一番大きい版を返す", () => {
    expect(
      newerVersion("1.0.0", lsRemote("contracts-v1.0.0", "contracts-v1.2.0", "contracts-v1.1.5")),
    ).toBe("1.2.0");
  });

  it("版は数として比べる（1.10.0 は 1.9.0 より大きい）", () => {
    expect(newerVersion("1.9.0", lsRemote("contracts-v1.9.0", "contracts-v1.10.0"))).toBe("1.10.0");
  });

  it("読む版が最新なら、なし", () => {
    expect(newerVersion("1.1.0", lsRemote("contracts-v1.0.0", "contracts-v1.1.0"))).toBeUndefined();
    expect(newerVersion("1.0.0", "")).toBeUndefined();
  });

  it("ほかのタグ・形の違う版・注釈付きタグの ^{} を扱う", () => {
    const tags = lsRemote("v9.9.9", "contracts-vx", "contracts-v2.0", "contracts-v1.3.0^{}");
    expect(newerVersion("1.0.0", tags)).toBe("1.3.0");
  });

  it("読む版の形が違えば投げる", () => {
    expect(() => newerVersion("1.0", "")).toThrow(/形が違う/);
  });
});

describe("古い版の警告", () => {
  it("古ければ GitHub Actions の警告の形で、上げ方を添える", () => {
    expect(oldVersionNotice("1.0.0", lsRemote("contracts-v1.1.0"))).toBe(
      "::warning::読む契約の版 1.0.0 は、親の最新 1.1.0 より古い。node scripts/sync_contracts.mjs 1.1.0 で上げる",
    );
  });

  it("最新なら警告にしない", () => {
    expect(oldVersionNotice("1.1.0", lsRemote("contracts-v1.1.0"))).toBe(
      "読む契約の版 1.1.0 は、親の最新",
    );
  });

  it("タグが取れないときも、投げずに警告だけにする", () => {
    const notice = warnIfOld("1.0.0", () => {
      throw new Error("つながらない");
    });
    expect(notice).toBe("::warning::親の契約の版のタグが取れなかった：つながらない");
  });

  it("取れたタグで比べる", () => {
    expect(warnIfOld("1.0.0", () => lsRemote("contracts-v2.0.0"))).toMatch(
      /^::warning::.*2\.0\.0 より古い/,
    );
  });
});
