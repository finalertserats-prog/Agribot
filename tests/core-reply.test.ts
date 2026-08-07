import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/gemini", () => ({
  generateTextResponse: vi.fn(async () => "Here is some farming advice 🌱"),
  analyzeImage: vi.fn(async () => "Your plant looks healthy!"),
  isFarmingTopic: vi.fn(async () => false),
  extractProfile: vi.fn(async () => ({ name: "", plants: "", issues: "", location: "" })),
}));
const EXISTING_USER = {
  id: "wa1",
  name: "Farmer",
  groupId: "wa1",
  plants: "",
  issues: "",
  location: "",
  firstSeen: "",
  lastSeen: "",
  phone: "",
};
vi.mock("../src/lib/database", () => ({
  upsertUser: vi.fn(),
  getUser: vi.fn(() => EXISTING_USER),
  updateUserProfile: vi.fn(),
  saveInteraction: vi.fn(),
  markInteractionDelivered: vi.fn(),
  getRecentInteractions: vi.fn(() => []),
  isOptedOut: vi.fn(() => false),
  setOptOut: vi.fn(),
  clearOptOut: vi.fn(),
  deleteUserData: vi.fn(async () => {}),
}));
vi.mock("../src/lib/memory", () => ({
  storeMemory: vi.fn(async () => {}),
  queryMemory: vi.fn(async () => []),
  deleteUserMemories: vi.fn(async () => {}),
}));

import {
  processMessage,
  backgroundTasks,
  resetForTests,
  DeliverySuppressedError,
  type IncomingMessage,
} from "../src/core/reply";
import { generateTextResponse, isFarmingTopic } from "../src/lib/gemini";
import {
  setOptOut,
  deleteUserData,
  getUser,
  isOptedOut,
  getRecentInteractions,
  saveInteraction,
  markInteractionDelivered,
} from "../src/lib/database";
import { deleteUserMemories } from "../src/lib/memory";

function incoming(text: string, over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    userId: "wa1",
    remoteJid: "wa1",
    displayName: "Farmer",
    text,
    hasImage: false,
    loadImage: async () => null,
    ...over,
  };
}

function capture() {
  const sent: string[] = [];
  return { sent, responder: { send: async (t: string) => void sent.push(t) } };
}

const drain = () => Promise.allSettled([...backgroundTasks]);

beforeEach(() => {
  resetForTests();
  vi.clearAllMocks();
  (isOptedOut as any).mockReturnValue(false);
  (getUser as any).mockReturnValue(EXISTING_USER);
  (getRecentInteractions as any).mockReturnValue([]); // cold by default
  (isFarmingTopic as any).mockResolvedValue(false);
});

describe("processMessage — transport-agnostic core", () => {
  it("answers a farming question via the injected responder", async () => {
    const { sent, responder } = capture();
    await processMessage(incoming("how do I grow tomatoes?"), responder);
    expect(generateTextResponse).toHaveBeenCalledOnce();
    expect(sent).toContain("Here is some farming advice 🌱");
  });

  it("lets a mid-conversation follow-up ('Yes please') through — no off-topic redirect", async () => {
    // Ongoing conversation: a prior interaction within the last hour.
    (getRecentInteractions as any).mockReturnValue([
      { message: "grow tomatoes", response: "here are steps", timestamp: new Date().toISOString() },
    ]);
    const { sent, responder } = capture();
    await processMessage(incoming("Yes please"), responder);
    expect(isFarmingTopic).not.toHaveBeenCalled(); // guardrail skipped mid-conversation
    expect(generateTextResponse).toHaveBeenCalledOnce();
    expect(sent).toContain("Here is some farming advice 🌱"); // answered, not the canned redirect
  });

  it("still redirects a COLD off-topic message (no prior history)", async () => {
    (getRecentInteractions as any).mockReturnValue([]);
    const { sent, responder } = capture();
    await processMessage(incoming("what is the football score tonight"), responder);
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(sent.join(" ")).toContain("gardening"); // persona.offTopicReply
  });

  it("re-applies the guardrail for STALE history (last turn > 1h ago)", async () => {
    // Old interaction (2h ago) — not an active conversation, so off-topic redirects.
    (getRecentInteractions as any).mockReturnValue([
      { message: "grow tomatoes", response: "steps", timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
    ]);
    const { sent, responder } = capture();
    await processMessage(incoming("what is the football score tonight"), responder);
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(sent.join(" ")).toContain("gardening");
  });

  it("opts a user out on STOP without calling Gemini", async () => {
    const { sent, responder } = capture();
    await processMessage(incoming("STOP"), responder);
    expect(setOptOut).toHaveBeenCalledWith("wa1");
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(sent.join(" ")).toContain("unsubscribed");
  });

  it("erases data on DELETE, even for an opted-out user", async () => {
    (isOptedOut as any).mockReturnValue(true);
    const { sent, responder } = capture();
    await processMessage(incoming("DELETE"), responder);
    expect(deleteUserData).toHaveBeenCalledWith("wa1");
    expect(deleteUserMemories).toHaveBeenCalledWith("wa1");
    expect(sent.join(" ")).toContain("erased");
  });

  it("stays silent for an already opted-out user", async () => {
    (isOptedOut as any).mockReturnValue(true);
    const { sent, responder } = capture();
    await processMessage(incoming("how do I grow tomatoes?"), responder);
    expect(sent).toHaveLength(0);
    expect(generateTextResponse).not.toHaveBeenCalled();
  });

  it("suppresses the reply if the user opts out mid-flight (after generation)", async () => {
    // false at the opt-out gate, true at the pre-send compliance re-check.
    (isOptedOut as any).mockReturnValueOnce(false).mockReturnValue(true);
    const { sent, responder } = capture();
    await processMessage(incoming("how do I grow tomatoes?"), responder);
    expect(generateTextResponse).toHaveBeenCalledOnce(); // work happened...
    expect(sent).toHaveLength(0); // ...but nothing was sent after the opt-out
  });

  it("persists the interaction after replying", async () => {
    const { responder } = capture();
    await processMessage(incoming("my tomato leaves are yellow"), responder);
    await drain();
    const { saveInteraction } = await import("../src/lib/database");
    expect(saveInteraction).toHaveBeenCalledOnce();
  });
});

describe("processMessage — the answer is handed over as the answer", () => {
  /** A transport that distinguishes the answer from an interstitial. */
  function splitResponder() {
    const calls: Array<{ kind: "send" | "sendFinal"; text: string }> = [];
    return {
      calls,
      responder: {
        send: async (text: string) => void calls.push({ kind: "send", text }),
        sendFinal: async (text: string) => void calls.push({ kind: "sendFinal", text }),
      },
    };
  }

  // The Cloud transport speaks whatever comes through sendFinal. If the core
  // routed the answer through plain send, voice replies would silently stop.
  it("routes the model's answer through sendFinal", async () => {
    const { calls, responder } = splitResponder();
    await processMessage(incoming("how do I grow tomatoes?"), responder);

    expect(calls).toContainEqual({ kind: "sendFinal", text: "Here is some farming advice 🌱" });
  });

  // "Please try again in a minute" must never be read aloud ahead of the thing
  // the member actually asked for.
  it("routes an interstitial through plain send, never sendFinal", async () => {
    (getUser as any).mockReturnValueOnce(undefined); // first contact → consent notice
    const { calls, responder } = splitResponder();
    await processMessage(incoming("how do I grow tomatoes?"), responder);

    const interstitials = calls.filter((c) => c.text !== "Here is some farming advice 🌱");
    expect(interstitials.length).toBeGreaterThan(0);
    for (const c of interstitials) expect(c.kind).toBe("send");
  });

  it("falls back to send for a transport that has no separate answer channel", async () => {
    const { sent, responder } = capture();
    await processMessage(incoming("how do I grow tomatoes?"), responder);
    expect(sent).toContain("Here is some farming advice 🌱");
  });

  it("marks the interaction delivered once the answer is actually out", async () => {
    (saveInteraction as any).mockReturnValueOnce(77);
    const { responder } = splitResponder();
    await processMessage(incoming("how do I grow tomatoes?"), responder);

    expect(markInteractionDelivered).toHaveBeenCalledWith(77);
  });

  // The transport re-checks opt-out on the way out because building a voice
  // note takes real time. When it refuses, nothing was delivered — and the
  // ledger has to keep saying so.
  it("does not mark delivered when the transport refuses on an opt-out", async () => {
    (saveInteraction as any).mockReturnValueOnce(78);
    const responder = {
      send: async () => {},
      sendFinal: async () => {
        throw new DeliverySuppressedError();
      },
    };

    await expect(
      processMessage(incoming("how do I grow tomatoes?"), responder)
    ).resolves.toBeUndefined();
    expect(markInteractionDelivered).not.toHaveBeenCalled();
  });

  it("still rethrows a genuine send failure so the transport can react", async () => {
    const responder = {
      send: async () => {},
      sendFinal: async () => {
        throw new Error("WhatsApp Cloud sendText failed: 400");
      },
    };

    await expect(processMessage(incoming("how do I grow tomatoes?"), responder)).rejects.toThrow(
      /400/
    );
  });
});
