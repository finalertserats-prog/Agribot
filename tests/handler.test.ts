import { describe, it, expect, vi, beforeEach } from "vitest";
import type { proto, WASocket } from "@whiskeysockets/baileys";

// ---- mock the collaborator modules (domain helpers stay real) ----
vi.mock("../src/lib/gemini", () => ({
  generateTextResponse: vi.fn(async () => "Here is some farming advice 🌱"),
  analyzeImage: vi.fn(async () => "Your plant looks healthy!"),
  isFarmingTopic: vi.fn(async () => false),
  extractProfile: vi.fn(async () => ({ name: "", plants: "", issues: "", location: "" })),
}));
const EXISTING_USER = {
  id: "u1@s.whatsapp.net",
  name: "Farmer",
  groupId: "111@s.whatsapp.net",
  plants: "",
  issues: "",
  location: "",
  firstSeen: "",
  lastSeen: "",
};
vi.mock("../src/lib/database", () => ({
  upsertUser: vi.fn(),
  // Default: a KNOWN contact, so the first-contact consent notice does NOT fire
  // in the general tests. Consent tests override this to return undefined.
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
vi.mock("@whiskeysockets/baileys", () => ({
  downloadContentFromMessage: vi.fn(async function* () {
    yield Buffer.from([1, 2, 3, 4]);
  }),
}));

import { handleMessage, backgroundTasks, resetForTests } from "../src/handler";
import { generateTextResponse, analyzeImage, isFarmingTopic } from "../src/lib/gemini";
import {
  saveInteraction,
  isOptedOut,
  setOptOut,
  clearOptOut,
  getUser,
  deleteUserData,
} from "../src/lib/database";
import { deleteUserMemories } from "../src/lib/memory";
import { config } from "../src/config";

function fakeSocket(): WASocket & { sendMessage: ReturnType<typeof vi.fn> } {
  return { sendMessage: vi.fn(async () => undefined) } as any;
}

function textMsg(text: string, id = "m1"): proto.IWebMessageInfo {
  return {
    key: { remoteJid: "111@s.whatsapp.net", id },
    message: { conversation: text },
    pushName: "Farmer",
  } as any;
}

function imageMsg(): proto.IWebMessageInfo {
  return {
    key: { remoteJid: "111@s.whatsapp.net", id: "img1" },
    message: { imageMessage: { mimetype: "image/jpeg" } },
    pushName: "Farmer",
  } as any;
}

const drain = () => Promise.allSettled([...backgroundTasks]);

beforeEach(() => {
  resetForTests();
  vi.clearAllMocks();
  (isFarmingTopic as any).mockResolvedValue(false);
  (isOptedOut as any).mockReturnValue(false);
  (getUser as any).mockReturnValue(EXISTING_USER); // known contact by default
});

describe("handleMessage — DM text", () => {
  it("answers a farming question and sends a reply", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("how do I grow tomatoes?"), false, "u1@s.whatsapp.net");
    expect(generateTextResponse).toHaveBeenCalledOnce();
    expect(s.sendMessage).toHaveBeenCalledWith(
      "111@s.whatsapp.net",
      { text: "Here is some farming advice 🌱" }
    );
  });

  it("keyword fast-path skips the classifier", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("my tomato leaves are yellow"), false, "u1@s.whatsapp.net");
    expect(isFarmingTopic).not.toHaveBeenCalled();
    expect(generateTextResponse).toHaveBeenCalledOnce();
  });

  it("rejects off-topic text with the canned reply and no generation", async () => {
    (isFarmingTopic as any).mockResolvedValue(false);
    const s = fakeSocket();
    await handleMessage(s, textMsg("what is the football score tonight"), false, "u1@s.whatsapp.net");
    expect(generateTextResponse).not.toHaveBeenCalled();
    const sent = (s.sendMessage as any).mock.calls[0][1].text as string;
    expect(sent).toContain("farming community");
  });

  it("classifier fallback allows a farming question with no keyword", async () => {
    (isFarmingTopic as any).mockResolvedValue(true);
    const s = fakeSocket();
    await handleMessage(s, textMsg("why are the edges of my seedlings curling"), false, "u1@s.whatsapp.net");
    expect(isFarmingTopic).toHaveBeenCalledOnce();
    expect(generateTextResponse).toHaveBeenCalledOnce();
  });
});

describe("handleMessage — groups", () => {
  it("stays silent in a group without the trigger word", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("how do I grow tomatoes?"), true, "u1@s.whatsapp.net");
    expect(s.sendMessage).not.toHaveBeenCalled();
    expect(generateTextResponse).not.toHaveBeenCalled();
  });

  it("responds in a group when triggered", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("agrifriend how do I grow tomatoes?"), true, "u1@s.whatsapp.net");
    expect(generateTextResponse).toHaveBeenCalledOnce();
  });

  it("strips the trigger word from the text passed to the model", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("agrifriend how do I grow tomatoes?"), true, "u1@s.whatsapp.net");
    const promptText = (generateTextResponse as any).mock.calls[0][0] as string;
    expect(promptText).not.toContain("agrifriend");
    expect(promptText).toContain("grow tomatoes");
  });
});

describe("handleMessage — opt-out / consent", () => {
  it("opts a user out on STOP, confirms once, and never calls Gemini", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("STOP"), false, "u1@s.whatsapp.net");
    expect(setOptOut).toHaveBeenCalledWith("u1@s.whatsapp.net");
    expect(generateTextResponse).not.toHaveBeenCalled();
    const sent = (s.sendMessage as any).mock.calls[0][1].text as string;
    expect(sent).toContain("unsubscribed");
  });

  it("stays completely silent for an already opted-out user", async () => {
    (isOptedOut as any).mockReturnValue(true);
    const s = fakeSocket();
    await handleMessage(s, textMsg("how do I grow tomatoes?"), false, "u1@s.whatsapp.net");
    expect(s.sendMessage).not.toHaveBeenCalled();
    expect(generateTextResponse).not.toHaveBeenCalled();
    expect(setOptOut).not.toHaveBeenCalled();
  });

  it("re-subscribes an opted-out user on START and welcomes them back", async () => {
    (isOptedOut as any).mockReturnValue(true);
    const s = fakeSocket();
    await handleMessage(s, textMsg("START"), false, "u1@s.whatsapp.net");
    expect(clearOptOut).toHaveBeenCalledWith("u1@s.whatsapp.net");
    expect(generateTextResponse).not.toHaveBeenCalled();
    const sent = (s.sendMessage as any).mock.calls[0][1].text as string;
    expect(sent).toContain("Welcome back");
  });

  it("erases a user's data on DELETE and confirms, without calling Gemini", async () => {
    const s = fakeSocket();
    await handleMessage(s, textMsg("DELETE"), false, "u1@s.whatsapp.net");
    expect(deleteUserData).toHaveBeenCalledWith("u1@s.whatsapp.net");
    expect(deleteUserMemories).toHaveBeenCalledWith("u1@s.whatsapp.net");
    expect(generateTextResponse).not.toHaveBeenCalled();
    const sent = (s.sendMessage as any).mock.calls[0][1].text as string;
    expect(sent).toContain("erased");
  });

  it("honors DELETE even for an opted-out user", async () => {
    (isOptedOut as any).mockReturnValue(true);
    const s = fakeSocket();
    await handleMessage(s, textMsg("delete my data"), false, "u1@s.whatsapp.net");
    expect(deleteUserData).toHaveBeenCalledWith("u1@s.whatsapp.net");
  });

  it("sends the one-time consent notice to a brand-new contact, then answers", async () => {
    (getUser as any).mockReturnValue(undefined); // first contact
    const s = fakeSocket();
    await handleMessage(s, textMsg("how do I grow tomatoes?"), false, "new@s.whatsapp.net");
    const texts = (s.sendMessage as any).mock.calls.map((c: any) => c[1].text as string);
    expect(texts.some((t: string) => t === config.consentMessage)).toBe(true);
    expect(generateTextResponse).toHaveBeenCalledOnce(); // still answered
  });

  it("does NOT resend consent to a returning contact", async () => {
    (getUser as any).mockReturnValue(EXISTING_USER);
    const s = fakeSocket();
    await handleMessage(s, textMsg("how do I grow tomatoes?"), false, "u1@s.whatsapp.net");
    const texts = (s.sendMessage as any).mock.calls.map((c: any) => c[1].text as string);
    expect(texts.some((t: string) => t === config.consentMessage)).toBe(false);
  });
});

describe("handleMessage — rate limiting", () => {
  it("throttles a user past the per-user limit without calling Gemini", async () => {
    const s = fakeSocket();
    // config.rateLimitPerMinute = 8; the 9th should throttle.
    for (let i = 0; i < 8; i++) {
      await handleMessage(s, textMsg("grow tomatoes", `k${i}`), false, "spam@s.whatsapp.net");
    }
    (generateTextResponse as any).mockClear();
    await handleMessage(s, textMsg("grow tomatoes", "k9"), false, "spam@s.whatsapp.net");
    expect(generateTextResponse).not.toHaveBeenCalled();
    const last = (s.sendMessage as any).mock.calls.at(-1)[1].text as string;
    expect(last).toContain("catching up");
  });
});

describe("handleMessage — images", () => {
  it("routes an image to analyzeImage (bypasses the text guardrail)", async () => {
    const s = fakeSocket();
    await handleMessage(s, imageMsg(), false, "u1@s.whatsapp.net");
    expect(analyzeImage).toHaveBeenCalledOnce();
    expect(s.sendMessage).toHaveBeenCalledWith(
      "111@s.whatsapp.net",
      { text: "Your plant looks healthy!" }
    );
  });
});

describe("handleMessage — resilience", () => {
  it("on a Gemini failure, still replies with a fallback AND persists", async () => {
    (generateTextResponse as any).mockRejectedValueOnce(new Error("gemini down"));
    const s = fakeSocket();
    await handleMessage(s, textMsg("grow tomatoes"), false, "u1@s.whatsapp.net");
    const sent = (s.sendMessage as any).mock.calls[0][1].text as string;
    expect(sent).toContain("trouble processing");
    await drain();
    expect(saveInteraction).toHaveBeenCalledOnce();
  });

  it("persists even if the outbound send fails", async () => {
    const s = fakeSocket();
    (s.sendMessage as any).mockRejectedValueOnce(new Error("send failed"));
    await handleMessage(s, textMsg("grow tomatoes"), false, "u1@s.whatsapp.net");
    await drain();
    expect(saveInteraction).toHaveBeenCalledOnce();
  });
});
