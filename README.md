# qata-web

[qata](https://github.com/masakazu2025/qata) の web です。AI が MCP で登録したテストケースを一覧にし、元の日本語の手順と生成されたステップを見比べて承認し、実行して、ステップごとの結果とスクショを見ます。server の REST API だけを使います。

契約と全体の要件は、親のリポジトリ `qata` が正です。契約は、その版を `qata-contracts/` に写して持つので（下の「読む契約の版」）、関門はこのリポジトリだけで回ります。端から端までのテストだけは、隣に qata-server と qata-runner を並べます。

やることは、このリポジトリの GitHub の issue で管理しています。部品をまたぐものと全体の判断は、親の [qata の issue](https://github.com/masakazu2025/qata/issues) に置きます。

## 関門

pull request と main への push のたびに、GitHub Actions（`.github/workflows/ci.yml`）が下と「端から端までのテスト」を回します（端から端までは、qata-server・qata-runner の main と Windows でつなぐ）。通らないと main にマージできません。

```
npm ci
npm run check          # 型の検査・lint（ESLint）・テスト（生成した型と契約・画面）・書式
```

lint は `npm run lint` だけでも回せます。警告も一つあれば止まります（`--max-warnings 0`）。設定は `eslint.config.js`。

テストの偽の server が返すものは、すべて読む版の契約（JSON Schema）で判定します。

画面のテストは、偽の server がすぐ応答するもの（組 `default`）と、応答を毎回 20ms 遅らせたもの（組 `slow-server`）の二通りで回します（`vite.config.ts`）。すぐ応答する偽物だけだと、待つつもりで待っていないテストがたまたま通るためです。古い応答があとから届く形は、`tests/fakeServer.ts` の `holdResponses` で、応答を止めてから流して確かめます。

CI は、写しを手で直していないか（`sync_contracts.mjs --check`）も確かめます。読む契約の版が親の最新より古いと警告を出します（関門は落としません。`sync_contracts.mjs --warn-if-old`）。

## 読む契約の版

web は、親の契約の版を一つ選んで写して持ち、その版だけを読みます。親の `main` が進んでも、ここで版を上げるまで前の版を読み続けます。隣に並べた親（`../qata/`）の中身は読みません。

- 写し：`qata-contracts/`。親のタグ `contracts-v<版>` の `contracts/` を丸ごと写したもの。手で直しません。
- 読む版：`qata-contracts/VERSION`。変更の記録は `qata-contracts/CHANGELOG.md`。
- 型の生成・テスト（偽の server の判定・デモ版の写し）・端から端までのテストは、どれも `qata-contracts/` を読みます。

版を上げるときは、写し直してから型を生成し直します。デモ版のデータ（`src/demo/data/`）も、`qata-contracts/examples/` から写し直します（違えば `npm test` が落ちます）。

```
node scripts/sync_contracts.mjs 1.1.0
npm run generate
```

## 端から端までのテスト

隣に並べた qata-server・qata-runner と、この web を本物どうしでつないで、デモの流れ（AI が MCP でテストケースを登録 → web で承認 → 実行 → 結果とスクショ）を一本通します。偽物を本物に置き換えるたびに、これが通り続けることを関門にします。

```
作業フォルダ/
├── qata-runner/
├── qata-server/
└── qata-web/      ← ここで npm run e2e
```

web・server・runner は、それぞれ自分の `qata-contracts/` を読みます。web から契約の場所は渡しません。どの版どうしで動かしたかは、始めに「読む契約の版：web 1.0.0・server 1.0.0・runner 1.0.0」のように出し、まとめ（レポート）にも残します。版がずれていても、足すだけの違いならそのまま動きます。

```
npx playwright install chromium   # 初めてのときだけ
npm run e2e
```

`uv` が要ります。runner・server・web は既定とは別の番号（18001・18000・15173）で立ち上げ、終わったら止めます。保存先は毎回新しく作ります。各ステップの画面は `test-results/`、まとめは `npx playwright show-report` で見られます。

runner の操作は既定で偽物です。本物の電卓を動かして回すときは、下を使います（手元の Windows だけ。CI はデスクトップがないので偽物のまま）。電卓を起動し、キーボードとマウスを使うので、終わるまで触らないでください。

```
npm run e2e:windows    # runner を QATA_RUNNER_OPERATOR=windows で立ち上げる
```

## デモ版

https://qata-web.vercel.app/ で、server と runner なしに画面を触れます。ブラウザの中の偽の server が契約の例を返し、スクショは本物の電卓を撮ったもの（`src/demo/`）です。登録 → 承認 → 実行 → 結果とスクショを一通り試せます。データはブラウザの中だけで、再読み込みで最初に戻ります。

```
npm run build:demo                  # dist/ にデモ版を作る（Vercel もこれを使う、vercel.json）
npx vite preview --mode demo        # 手元で見る
```

main に入ると Vercel が公開し直します。pull request ごとにプレビューの URL も出ます。

## 契約から型を生成する

読む版の `qata-contracts/openapi.yaml` から TypeScript の型を生成し、`src/contracts/openapi.ts` に置いてコミットします。手で直しません。契約が変わったら生成し直します。生成物が契約と合っているかは `npm test` で確かめます。

```
npm run generate
```

## 立ち上げる

qata-server（と qata-runner）を立ち上げてから、

```
npm run dev
```

`http://127.0.0.1:5173` を開きます。`/api` は qata-server（既定は `http://127.0.0.1:8000`、変えるときは環境変数 `QATA_SERVER_URL`）に中継します。一覧と、開いている詳細（実行の結果の一覧も）は 3 秒ごとに読み直すので、AI が MCP で登録・実行したものが開いたままの画面に出ます。

画面は URL で開けます（React Router）。server からの読み込みと読み直しは TanStack Query に任せています。

見た目は Tailwind CSS と shadcn/ui で書きます。shadcn/ui の部品は `src/components/ui/` に置いた手元のソースで、要るものは `npx shadcn add <部品>` で足します（設定は `components.json`）。色などの値は `src/index.css` に置き、クラスを手で書いた CSS は置きません。

| URL                                      | 画面                                                 |
| ---------------------------------------- | ---------------------------------------------------- |
| `/`                                      | テストケースの一覧                                   |
| `/testcases/{testcase_id}`               | テストケース一つ（実行の結果は、いちばん新しいもの） |
| `/testcases/{testcase_id}/runs/{run_id}` | テストケース一つと、選んだ実行の結果                 |

どの画面も、後ろに `?tag=機能:加算&tag=設計書:A` のように付けると、左の一覧がそのタグを全部持つものに絞られます（server の REST の一覧と同じ書き方）。一覧の上のタグを押して選びます。画面を移っても、絞り込みは残ります。
