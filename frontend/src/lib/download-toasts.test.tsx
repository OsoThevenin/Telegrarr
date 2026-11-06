import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppToaster } from "@/app/AppToaster";
import {
  bulkPauseToast,
  bulkResumeToast,
  bulkRetryToast,
  cancelToast,
  pauseToast,
  resumeToast,
  retryToast,
  useDownloadToast,
  type ToastDecision,
} from "@/lib/download-toasts";

describe("download toasts", () => {
  it.each([
    [{ ok: false }, { messageKey: "dl.nothing_to_cancel", kind: "err" }],
    [{ ok: true }, null],
  ])("says when a Stop had nothing to cancel: %j", (answer, expected) => {
    expect(cancelToast(answer)).toEqual(expected);
  });

  it.each([
    [{ ok: true }, { messageKey: "dl.requeued", kind: "ok" }],
    [{ ok: false }, { messageKey: "dl.not_requeued", kind: "err" }],
    [{ ok: false, reason: "dl.err.message_gone" }, { messageKey: "dl.err.message_gone", kind: "err" }],
  ])("says re-queued only when the server re-queued: %j", (answer, expected) => {
    expect(retryToast(answer)).toEqual(expected);
  });

  it.each([
    [{ count: 2 }, { messageKey: "dl.requeued_n", params: { count: 2 }, kind: "ok" }],
    [{ count: 0 }, { messageKey: "dl.not_requeued", kind: "err" }],
  ])("reports how many rows a bulk Retry re-queued: %j", (answer, expected) => {
    expect(bulkRetryToast(answer)).toEqual(expected);
  });

  it.each([
    [{ ok: true }, { messageKey: "dl.paused", kind: "ok" }],
    [{ ok: false }, { messageKey: "dl.nothing_to_pause", kind: "err" }],
  ])("says paused only when the server paused: %j", (answer, expected) => {
    expect(pauseToast(answer)).toEqual(expected);
  });

  it.each([
    [{ ok: true }, { messageKey: "dl.resumed", kind: "ok" }],
    [{ ok: false }, { messageKey: "dl.not_paused", kind: "err" }],
    [{ ok: false, reason: "dl.err.message_gone" }, { messageKey: "dl.err.message_gone", kind: "err" }],
  ])("says resumed only when the server re-queued: %j", (answer, expected) => {
    expect(resumeToast(answer)).toEqual(expected);
  });

  it.each([
    [{ count: 2 }, { messageKey: "dl.paused_n", params: { count: 2 }, kind: "ok" }],
    [{ count: 0 }, { messageKey: "dl.nothing_to_pause", kind: "err" }],
  ])("reports how many rows a bulk Pause held: %j", (answer, expected) => {
    expect(bulkPauseToast(answer)).toEqual(expected);
  });

  it.each([
    [{ count: 2 }, { messageKey: "dl.resumed_n", params: { count: 2 }, kind: "ok" }],
    [{ count: 0 }, { messageKey: "dl.not_resumed", kind: "err" }],
  ])("reports how many rows a bulk Resume re-queued: %j", (answer, expected) => {
    expect(bulkResumeToast(answer)).toEqual(expected);
  });
});

function ToastButton({ decision }: { decision: ToastDecision | null }) {
  const showDownloadToast = useDownloadToast();
  return <button onClick={() => showDownloadToast(decision)}>show</button>;
}

async function showToastFor(decision: ToastDecision | null) {
  render(
    <>
      <AppToaster />
      <ToastButton decision={decision} />
    </>,
  );
  await act(async () => {
    screen.getByRole("button", { name: "show" }).click();
  });
}

describe("useDownloadToast", () => {
  it("shows the translated message with its params", async () => {
    await showToastFor(bulkRetryToast({ count: 3 }));

    expect(await screen.findByText("Baixades tornades a la cua: 3")).toBeVisible();
  });

  it("shows nothing when the answer needs no toast", async () => {
    await showToastFor(cancelToast({ ok: true }));

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
