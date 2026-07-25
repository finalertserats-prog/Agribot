import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/gemini", () => ({
  generateTextResponse: vi.fn(async () => "Here is some farming advice 🌱"),
  analyzeImage: vi.fn(async () => "Your plant looks healthy!"),
  isFarmingTopic: vi.fn(async () => false),
  extractProfile: vi.fn(async () => ({ name: "", plants: "", issues: "", location: "" })),
}));
const EXISTING_USER = {
  id: "web-1", name: "Ravi", groupId: "web", plants: "", issues: "",
  location: "", firstSeen: "", lastSeen: "", phone: "", confirmed: "",
};
vi.mock("../src/lib/database", () => ({
  upsertUser: vi.fn(),
  getUser: vi.fn(() => EXISTING_USER),
  updateUserProfile: vi.fn(),
  saveInteraction: vi.fn(),
  getRecentInteractions: vi.fn(() => []),
}));
vi.mock("../src/lib/memory", () => ({
  storeMemory: vi.fn(async () => {}),
  queryMemory: vi.fn(async () => []),
}));

import { webChat } from "../src/web/chat";
import { generateTextResponse, isFarmingTopic } from "../src/lib/gemini";
import { getRecentInteractions } from "../src/lib/database";

beforeEach(() => {
  vi.clearAllMocks();
  (getRecentInteractions as any).mockReturnValue([]);
  (isFarmingTopic as any).mockResolvedValue(false);
});

describe("webChat — context-aware farming guardrail", () => {
  it("lets a mid-conversation follow-up ('Yes please') through — no off-topic redirect", async () => {
    (getRecentInteractions as any).mockReturnValue([
      { message: "grow tomatoes", response: "steps", timestamp: new Date().toISOString() },
    ]);
    const r = await webChat({ sessionId: "web-1", message: "Yes please" });
    expect(isFarmingTopic).not.toHaveBeenCalled();
    expect(generateTextResponse).toHaveBeenCalledOnce();
    expect(r.reply).toBe("Here is some farming advice 🌱");
  });

  it("redirects a COLD off-topic message (no history)", async () => {
    (getRecentInteractions as any).mockReturnValue([]);
    const r = await webChat({ sessionId: "web-1", message: "what is the football score tonight" });
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(r.reply).toContain("growing");
  });

  it("re-applies the guardrail for STALE history (> 1h ago)", async () => {
    (getRecentInteractions as any).mockReturnValue([
      { message: "grow tomatoes", response: "steps", timestamp: new Date(Date.now() - 2 * 60 * 60_000).toISOString() },
    ]);
    const r = await webChat({ sessionId: "web-1", message: "who won the match" });
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(r.reply).toContain("growing");
  });
});
