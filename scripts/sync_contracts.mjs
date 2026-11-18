// 親のタグ contracts-v<版> の contracts/ を、qata-contracts/ に丸ごと写す。
//
// 使い方：
//   node scripts/sync_contracts.mjs 1.0.0          その版を写す（版を上げるとき）
//   node scripts/sync_contracts.mjs --check        写しを手で直していないか確かめる
//   node scripts/sync_contracts.mjs --warn-if-old  親に新しい版があれば警告
//
// 読む版は qata-contracts/VERSION。写しは手で直さない（親の repos-and-contracts.md の
// 「子の持ち方」、D54）。版を上げたら npm run generate で型を作り直す。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
export const copyDir = resolve(root, "qata-contracts");
const PARENT_REPO = "https://github.com/masakazu2025/qata";
const TAG_PREFIX = "contracts-v";

export function readVersion(dir = copyDir) {
  return readFileSync(join(dir, "VERSION"), "utf8").trim();
}

/** 親のタグの tarball を取る。 */
export async function download(version) {
  const url = `${PARENT_REPO}/archive/refs/tags/${TAG_PREFIX}${version}.tar.gz`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url} が取れない：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function field(block, start, length) {
  const end = block.indexOf(0, start);
  return block.toString("utf8", start, end === -1 || end > start + length ? start + length : end);
}

/** pax の拡張ヘッダ（「長さ 名前=値\n」の並び）から path を取る。 */
function paxPath(data) {
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const length = Number(data.toString("utf8", offset, space));
    const record = data.toString("utf8", space + 1, offset + length - 1);
    if (record.startsWith("path=")) return record.slice("path=".length);
    offset += length;
  }
  return undefined;
}

/** tar（ustar と pax）のふつうのファイルを、道 → 中身で返す。 */
export function tarFiles(tar) {
  const files = new Map();
  let offset = 0;
  let nextPath;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      nextPath = paxPath(data);
      continue;
    }
    if (type === "g") continue;
    const prefix = field(header, 345, 155);
    const name =
      nextPath ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
    nextPath = undefined;
    if (type === "0") files.set(name, Buffer.from(data));
  }
  return files;
}

/**
 * tarball の中の contracts/ のファイル（contracts/ からの相対の道 → 中身）。
 * GitHub の tarball は、一段目に「リポジトリ名-タグ」のフォルダがある。
 */
export function contractsIn(tarball) {
  const found = new Map();
  for (const [name, data] of tarFiles(gunzipSync(tarball))) {
    const parts = name.split("/").filter(Boolean);
    if (parts.length < 3 || parts[1] !== "contracts") continue;
    found.set(parts.slice(2).join("/"), data);
  }
  if (found.size === 0) throw new Error("tarball に contracts/ がない");
  return found;
}

export function filesIn(dir) {
  const files = new Map();
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(dir, path).split(sep).join("/"), readFileSync(path));
  }
  return files;
}

/** 写しを tarball の contracts/ の中身に置き換える。読めてから消す（読めないときに消えたままにならないように）。 */
export function write(tarball, dir = copyDir) {
  const files = contractsIn(tarball);
  rmSync(dir, { recursive: true, force: true });
  for (const [name, data] of files) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  }
}

/** tarball の contracts/ と写しで、中身が違うか片方にしかないファイルの一覧。 */
export function differences(tarball, dir = copyDir) {
  const expected = contractsIn(tarball);
  const actual = filesIn(dir);
  const names = new Set([...expected.keys(), ...actual.keys()]);
  return [...names]
    .filter((name) => {
      const a = expected.get(name);
      const b = actual.get(name);
      return !a || !b || !a.equals(b);
    })
    .sort();
}

/** 「1.4.2」を [1, 4, 2] に。形が違えば undefined。 */
export function parseVersion(text) {
  const parts = text.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  return parts.map(Number);
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * git ls-remote --tags の出力から、読む版より新しい一番大きい版。なければ undefined。
 * 版は数として比べる（1.10.0 は 1.9.0 より大きい）。
 */
export function newerVersion(current, lsRemote) {
  const currentKey = parseVersion(current);
  if (!currentKey) throw new Error(`読む版の形が違う：${JSON.stringify(current)}`);
  let latest;
  for (const line of lsRemote.split("\n")) {
    const ref = (line.split("\t").at(-1) ?? "").trim().replace(/\^\{\}$/, "");
    const tag = ref.replace(/^refs\/tags\//, "");
    if (!tag.startsWith(TAG_PREFIX)) continue;
    const key = parseVersion(tag.slice(TAG_PREFIX.length));
    if (key && (!latest || compare(key, latest) > 0)) latest = key;
  }
  if (!latest || compare(latest, currentKey) <= 0) return undefined;
  return latest.join(".");
}

/** 親の contracts-v* のタグを git ls-remote --tags の形で取る。 */
export function listTags() {
  return execFileSync("git", ["ls-remote", "--tags", PARENT_REPO, `${TAG_PREFIX}*`], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

/** 読む版と親のタグから、CI に出す一行。古ければ GitHub Actions の警告の形。 */
export function oldVersionNotice(current, lsRemote) {
  const newer = newerVersion(current, lsRemote);
  if (newer) {
    return (
      `::warning::読む契約の版 ${current} は、親の最新 ${newer} より古い。` +
      `node scripts/sync_contracts.mjs ${newer} で上げる`
    );
  }
  return `読む契約の版 ${current} は、親の最新`;
}

/**
 * 親に新しい版があれば警告の一行を返す。関門は落とさない。
 * タグが取れないとき（つながらないなど）も、警告だけにする。
 */
export function warnIfOld(current = readVersion(), getTags = listTags) {
  let lsRemote;
  try {
    lsRemote = getTags();
  } catch (e) {
    return `::warning::親の契約の版のタグが取れなかった：${e instanceof Error ? e.message : String(e)}`;
  }
  return oldVersionNotice(current, lsRemote);
}

async function main(args) {
  const flags = args.filter((a) => a.startsWith("--"));
  const [version] = args.filter((a) => !a.startsWith("--"));
  if (flags.length > 1 || flags.some((f) => f !== "--check" && f !== "--warn-if-old")) {
    console.error("使い方：sync_contracts.mjs <版> | --check [版] | --warn-if-old");
    return 2;
  }
  if (flags[0] === "--warn-if-old") {
    console.log(warnIfOld());
    return 0;
  }
  if (flags[0] === "--check") {
    const v = version ?? readVersion();
    // その版のタグの中身を取り直し、写しと比べる
    const found = differences(await download(v));
    if (found.length > 0) {
      console.log(`qata-contracts/ が、親のタグ ${TAG_PREFIX}${v} と違う：`);
      for (const name of found) console.log(`  ${name}`);
      console.log(`手で直さず、node scripts/sync_contracts.mjs ${v} で写し直す`);
      return 1;
    }
    console.log(`qata-contracts/ は、親のタグ ${TAG_PREFIX}${v} と同じ`);
    return 0;
  }
  if (!version || !parseVersion(version)) {
    console.error(`写す版を三つの数で指定する（例：1.0.0）：${version ?? "なし"}`);
    return 2;
  }
  write(await download(version));
  console.log(`写した：${TAG_PREFIX}${version} → ${copyDir}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
