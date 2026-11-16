// 契約の値を、画面に出す日本語に変える。
import type { ReviewStatus, Run, RunStep, Step } from "./api";

/** バッジの色（src/components/ui/badge.tsx の variant）。 */
type Tone = "success" | "warning" | "destructive" | "secondary";

export const reviewLabel: Record<ReviewStatus, string> = {
  pending: "確認待ち",
  approved: "承認済み",
  not_required: "確認不要",
};

export const reviewTone: Record<ReviewStatus, Tone> = {
  pending: "warning",
  approved: "success",
  not_required: "secondary",
};

export const runLabel: Record<Run["status"], string> = {
  passed: "成功",
  failed: "失敗",
  error: "エラー",
};

export const runTone: Record<Run["status"], Tone> = {
  passed: "success",
  failed: "destructive",
  error: "destructive",
};

export const runStepLabel: Record<RunStep["status"], string> = {
  passed: "OK",
  failed: "NG",
  error: "エラー",
  skipped: "未実行",
};

export const runStepTone: Record<RunStep["status"], Tone> = {
  passed: "success",
  failed: "destructive",
  error: "destructive",
  skipped: "secondary",
};

/** ステップを、人が読む一文にする。 */
export function describeStep(step: Step): string {
  switch (step.type) {
    case "press_key":
      return `「${step.part}」のキーを押す`;
    case "tap":
      return `「${step.part}」をタップする`;
    case "expect_text":
      return `「${step.part}」が「${step.expected}」であることを確かめる`;
  }
}

export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
