import { act } from "@testing-library/react";

import type { LiveSnapshot } from "@/lib/status";

const OPEN = 1;
const CLOSED = 2;

/** Stands in for the browser's EventSource, which jsdom does not implement. */
export class FakeEventSource {
  static readonly CLOSED = CLOSED;
  static instances: FakeEventSource[] = [];

  readyState = OPEN;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances = [...FakeEventSource.instances, this];
  }

  close(): void {
    this.readyState = CLOSED;
  }
}

function openStreams(): FakeEventSource[] {
  return FakeEventSource.instances.filter((stream) => stream.readyState !== CLOSED);
}

export const EMPTY_SNAPSHOT: LiveSnapshot = {
  stats: { channels: 0, queued: 0, downloading: 0, paused: 0, completed: 0, failed: 0, total_size: 0 },
  active: [],
  paused: false,
  budget: { limit_gb: 0, used_bytes: 0, exhausted: false, resets_at: 0 },
  disk: { total: 0, used: 0, free: 0 },
  speed: 0,
};

/** Sends raw text down the open stream. */
export function emitRaw(data: string): void {
  act(() => {
    for (const stream of openStreams()) stream.onmessage?.(new MessageEvent("message", { data }));
  });
}

/** Sends a snapshot down the open stream, as the backend does about once a second. */
export function emitSnapshot(snapshot: Partial<LiveSnapshot> = {}): void {
  emitRaw(JSON.stringify({ ...EMPTY_SNAPSHOT, ...snapshot }));
}

/** Ends the open stream the way a server error does: the browser will not reconnect. */
export function failStream(): void {
  for (const stream of openStreams()) {
    stream.close();
    stream.onerror?.();
  }
}

export function openStreamCount(): number {
  return openStreams().length;
}
