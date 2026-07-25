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

import { processMessage, backgroundTasks, resetForTests, type IncomingMessage } from "../src/core/reply";
import { generateTextResponse, isFarmingTopic } from "../src/lib/gemini";
import { setOptOut, deleteUserData, getUser, isOptedOut, getRecentInteractions } from "../src/lib/database";
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
    expect(sent.join(" ")).toContain("growing"); // FARMING_ONLY_REPLY
  });

  it("re-applies the guardrail for STALE history (last turn > 1h ago)", async () => {
    // Old interaction (2h ago) — not an active conversation, so off-topic redirects.
    (getRecentInteractions as any).mockReturnValue([
      { message: "grow tomatoes", response: "steps", timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
    ]);
    const { sent, responder } = capture();
    await processMessage(incoming("what is the football score tonight"), responder);
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(sent.join(" ")).toContain("growing");
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
