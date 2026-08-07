import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startTyping, resetTypingForTests } from "../src/lib/typing";

/** WhatsApp dismisses the indicator at 25s; the loop refreshes at 20s. */
const REFRESH_MS = 20_000;

function messenger(impl?: () => Promise<void>) {
  return { markReadAndTyping: vi.fn(impl ?? (async () => {})) };
}

/** Let the queued .then handlers on the poke promise run. */
const settle = () => Promise.resolve().then(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  resetTypingForTests();
});

afterEach(() => {
  resetTypingForTests();
  vi.useRealTimers();
});

describe("startTyping — the indicator lasts as long as the thinking does", () => {
  // Started before transcription, so the member sees us reading their voice
  // note rather than watching nothing happen for ten seconds.
  it("shows the indicator immediately, without waiting for a tick", () => {
    const m = messenger();
    startTyping(m, "wamid.1", "91999");
    expect(m.markReadAndTyping).toHaveBeenCalledWith("wamid.1");
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(1);
  });

  // The whole point: one call lasts 25 seconds, and a real answer takes longer.
  it("keeps refreshing so the indicator outlives WhatsApp's 25s expiry", async () => {
    const m = messenger();
    startTyping(m, "wamid.1", "91999");

    await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(4); // 1 immediate + 3 refreshes
  });

  it("refreshes against the same message id every time", async () => {
    const m = messenger();
    startTyping(m, "wamid.SAME", "91999");
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    for (const call of m.markReadAndTyping.mock.calls) expect(call[0]).toBe("wamid.SAME");
  });

  it("stops refreshing once the reply is on its way", async () => {
    const m = messenger();
    const handle = startTyping(m, "wamid.1", "91999");
    handle.stop();

    await vi.advanceTimersByTimeAsync(REFRESH_MS * 5);
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(1);
  });

  it("tolerates being stopped twice (both the send path and the finally)", () => {
    const handle = startTyping(messenger(), "wamid.1", "91999");
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  // A reply that somehow never finishes must not leave a permanent "typing…".
  it("gives up rather than typing forever", async () => {
    const m = messenger();
    startTyping(m, "wamid.1", "91999");

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    const atCeiling = m.markReadAndTyping.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(atCeiling);
  });
});

describe("startTyping — failure must never reach the member", () => {
  it("returns an inert handle when the transport cannot show typing", () => {
    const handle = startTyping({}, "wamid.1", "91999");
    expect(() => handle.stop()).not.toThrow();
  });

  it("swallows a rejecting transport instead of raising an unhandled rejection", async () => {
    const m = messenger(async () => {
      throw new Error("Meta said no");
    });
    expect(() => startTyping(m, "wamid.1", "91999")).not.toThrow();
    await settle();
  });

  // If Meta rejects repeat calls for an already-read message, the loop is
  // achieving nothing — spending a request every 20s to rediscover that is waste.
  it("stops trying after three consecutive failures", async () => {
    const m = messenger(async () => {
      throw new Error("rejected");
    });
    startTyping(m, "wamid.1", "91999");

    await vi.advanceTimersByTimeAsync(REFRESH_MS * 10);
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(3);
  });

  it("keeps going when a failure is followed by a success", async () => {
    let calls = 0;
    const m = messenger(async () => {
      calls += 1;
      if (calls === 2) throw new Error("blip");
    });
    startTyping(m, "wamid.1", "91999");

    await vi.advanceTimersByTimeAsync(REFRESH_MS * 5);
    expect(m.markReadAndTyping).toHaveBeenCalledTimes(6);
  });
});

describe("startTyping — one indicator per conversation", () => {
  // WhatsApp only shows one at a time, so a second loop for the same chat is
  // pure duplicate traffic. The newer message is the one we're answering.
  it("supersedes the previous indicator for the same chat", async () => {
    const m = messenger();
    startTyping(m, "wamid.OLD", "91999");
    startTyping(m, "wamid.NEW", "91999");

    m.markReadAndTyping.mockClear();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
    for (const call of m.markReadAndTyping.mock.calls) expect(call[0]).toBe("wamid.NEW");
  });

  it("keeps separate chats independent", async () => {
    const m = messenger();
    startTyping(m, "wamid.A", "91111");
    const b = startTyping(m, "wamid.B", "92222");
    b.stop();

    m.markReadAndTyping.mockClear();
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(m.markReadAndTyping.mock.calls.map((c) => c[0])).toEqual(["wamid.A"]);
  });
});
