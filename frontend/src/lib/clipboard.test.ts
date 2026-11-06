import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";

function stubSecureClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
}

function stubExecCommand(result: boolean | Error) {
  const execCommand = vi.fn(() => {
    if (result instanceof Error) throw result;
    return result;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  return execCommand;
}

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("uses the clipboard API in a secure context", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubSecureClipboard(writeText);

    await expect(copyText("key")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("key");
  });

  it("falls back over plain HTTP and leaves nothing behind", async () => {
    const execCommand = stubExecCommand(true);

    await expect(copyText("key")).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the clipboard API is denied", async () => {
    stubSecureClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    stubExecCommand(true);

    await expect(copyText("key")).resolves.toBe(true);
  });

  it("reports a copy that nothing could do", async () => {
    stubExecCommand(new Error("unsupported"));

    await expect(copyText("key")).resolves.toBe(false);
  });
});
