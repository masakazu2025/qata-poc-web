import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Api, Run } from "./api";
import { describeStep, formatTime, runLabel, runStepLabel, runStepTone } from "./labels";

type Props = { api: Api; run: Run };

export function RunView({ api, run }: Props) {
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);
  const seconds = (Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000;
  const passed = run.status === "passed";

  return (
    <div className="grid gap-3" aria-label={`実行 ${run.id}`}>
      <p
        className={cn(
          "flex items-baseline gap-3 rounded-lg px-3.5 py-2.5",
          passed ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive",
        )}
      >
        <strong className="text-lg">{runLabel[run.status]}</strong>
        <span>
          {formatTime(run.started_at)} に実行
          {Number.isFinite(seconds) && `（${seconds.toFixed(1)} 秒）`}
        </span>
      </p>
      {run.error && (
        <Alert variant="destructive">
          {run.error.message}（{run.error.code}）
        </Alert>
      )}
      <ol
        className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
        aria-label="ステップごとの結果"
      >
        {run.steps.map((s) => {
          const alt = `ステップ ${s.index + 1} のあとのスクショ`;
          const src = s.screenshot_id ? api.screenshotUrl(s.screenshot_id) : null;
          const ng = s.status === "failed" || s.status === "error";
          return (
            <li key={s.index}>
              <Card
                className={cn(
                  "h-full justify-between gap-2.5 px-3",
                  ng && "ring-destructive",
                  s.status === "skipped" && "opacity-60",
                )}
              >
                <div className="grid gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-muted-foreground">{s.index + 1}</span>
                    <Badge variant={runStepTone[s.status]}>{runStepLabel[s.status]}</Badge>
                  </span>
                  <span>{describeStep(s.step)}</span>
                  {s.step.type === "expect_text" && s.actual !== undefined && (
                    <span className="text-xs">
                      期待：<Code>{s.step.expected}</Code>　実際：<Code>{s.actual}</Code>
                    </span>
                  )}
                  {s.message && <span className="text-xs text-muted-foreground">{s.message}</span>}
                </div>
                {src ? (
                  <button
                    type="button"
                    className="block aspect-4/3 w-full overflow-hidden rounded-md border bg-background"
                    onClick={() => setZoomed({ src, alt })}
                    aria-label={`${alt}を大きく見る`}
                  >
                    <img src={src} alt={alt} loading="lazy" className="size-full object-contain" />
                  </button>
                ) : (
                  <span className="grid aspect-4/3 place-items-center rounded-md border bg-background text-xs text-muted-foreground">
                    スクショなし
                  </span>
                )}
              </Card>
            </li>
          );
        })}
      </ol>
      <Dialog open={zoomed !== null} onOpenChange={(open) => !open && setZoomed(null)}>
        {/* 前と同じく、黒の半透明の上に画像だけを出す */}
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          overlayClassName="bg-black/75 supports-backdrop-filter:backdrop-blur-none"
          className="top-0 left-0 size-full max-w-none translate-x-0 translate-y-0 place-items-center rounded-none bg-transparent p-6 ring-0 sm:max-w-none"
          onClick={() => setZoomed(null)}
        >
          <DialogTitle className="sr-only">{zoomed?.alt}</DialogTitle>
          {zoomed && (
            <img
              src={zoomed.src}
              alt={zoomed.alt}
              className="max-h-[calc(100vh-100px)] max-w-full bg-white"
            />
          )}
          <DialogClose asChild>
            <Button variant="outline" className="absolute top-4 right-4">
              閉じる
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 font-mono">{children}</code>;
}
