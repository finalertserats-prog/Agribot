import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Shared fake-socket registry + a minimal event emitter, created in a hoisted
// block so the vi.mock factory can reference them.
const shared = vi.hoisted(() => {
  const sockets: any[] = [];
  const makeEv = () => {
    const h: Record<string, Function[]> = {};
    return {
      on: (e: string, fn: Function) => {
        (h[e] = h[e] || []).push(fn);
      },
      off: () => {},
      removeAllListeners: (e?: string) => {
        if (e) delete h[e];
      },
      emit: (e: string, arg: any) => (h[e] || []).map((fn) => fn(arg)),
    };
  };
  return { sockets, makeEv };
});

vi.mock("@whiskeysockets/baileys", () => ({
  default: vi.fn(() => {
    const s = { ev: shared.makeEv(), groupMetadata: vi.fn() };
    shared.sockets.push(s);
    return s;
  }),
  useMultiFileAuthState: vi.fn(async () => ({ state: {}, saveCreds: vi.fn() })),
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [2, 3, 1] })),
  DisconnectReason: { loggedOut: 401 },
  isJidGroup: vi.fn(() => false),
  jidNormalizedUser: vi.fn((j: string) => j),
  proto: {},
}));

import makeWASocket from "@whiskeysockets/baileys";
import { connectWhatsApp } from "../src/lib/whatsapp";

const closeEvt = (statusCode: number) => ({
  connection: "close",
  lastDisconnect: { error: { output: { statusCode } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  shared.sockets.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  // Emit 'open' on the latest socket to clear any pending reconnect timer/state.
  const s = shared.sockets.at(-1);
  s?.ev.emit("connection.update", { connection: "open" });
  vi.useRealTimers();
});

describe("connectWhatsApp", () => {
  it("creates a socket and registers handlers", async () => {
    await connectWhatsApp(vi.fn());
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    expect(shared.sockets).toHaveLength(1);
  });

  it("schedules a reconnect after a recoverable close", async () => {
    await connectWhatsApp(vi.fn());
    const before = (makeWASocket as any).mock.calls.length;
    shared.sockets.at(-1).ev.emit("connection.update", closeEvt(500));
    await vi.advanceTimersByTimeAsync(70_000);
    expect((makeWASocket as any).mock.calls.length).toBe(before + 1);
  });

  it("does not queue duplicate reconnects for two rapid closes", async () => {
    await connectWhatsApp(vi.fn());
    const before = (makeWASocket as any).mock.calls.length;
    const ev = shared.sockets.at(-1).ev;
    ev.emit("connection.update", closeEvt(500));
    ev.emit("connection.update", closeEvt(500)); // second must be ignored
    await vi.advanceTimersByTimeAsync(70_000);
    expect((makeWASocket as any).mock.calls.length).toBe(before + 1);
  });

  it("does NOT reconnect on loggedOut — exits instead", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await connectWhatsApp(vi.fn());
    const before = (makeWASocket as any).mock.calls.length;
    shared.sockets.at(-1).ev.emit("connection.update", closeEvt(401));
    // Exit now runs after the operator alert resolves (notify().finally(exit)),
    // so flush microtasks before asserting.
    await vi.advanceTimersByTimeAsync(0);
    expect(exitSpy).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(70_000);
    expect((makeWASocket as any).mock.calls.length).toBe(before); // no reconnect
    exitSpy.mockRestore();
  });

  it("drops duplicate message deliveries (dedup)", async () => {
    const onMsg = vi.fn(async () => {});
    await connectWhatsApp(onMsg);
    const ev = shared.sockets.at(-1).ev;
    const msg = {
      key: { remoteJid: "1@s.whatsapp.net", id: "dup-1", fromMe: false },
      message: { conversation: "hello" },
    };
    ev.emit("messages.upsert", { messages: [msg], type: "notify" });
    ev.emit("messages.upsert", { messages: [msg], type: "notify" });
    await vi.advanceTimersByTimeAsync(10);
    expect(onMsg).toHaveBeenCalledTimes(1);
  });
});
