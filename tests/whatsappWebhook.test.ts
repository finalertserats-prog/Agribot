import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock the reply core so dispatch tests don't touch DB/AI.
vi.mock("../src/core/reply", () => ({
  processMessage: vi.fn(async () => {}),
}));

// Speech providers are resolved lazily from env; stub them so voice-path tests
// exercise the webhook's own decisions rather than a vendor.
const sttMock = { name: "test-stt", transcribe: vi.fn() };
vi.mock("../src/lib/speech", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, resolveStt: () => sttMock, resolveTts: () => null };
});

import {
  verifyWebhook,
  isValidSignature,
  parseInboundMessages,
  dispatchInbound,
  type CloudMessenger,
} from "../src/web/whatsappWebhook";
import { processMessage } from "../src/core/reply";
import { SeenCache } from "../src/lib/seen";

const CFG = {
  accessToken: "tok",
  phoneNumberId: "PNID",
  verifyToken: "the-verify-token",
  appSecret: "the-app-secret",
  graphVersion: "v22.0",
};

beforeEach(() => vi.clearAllMocks());

describe("verifyWebhook — GET handshake", () => {
  it("echoes the challenge when mode+token match", () => {
    const r = verifyWebhook(
      { "hub.mode": "subscribe", "hub.verify_token": "the-verify-token", "hub.challenge": "12345" },
      CFG
    );
    expect(r).toEqual({ status: 200, body: "12345" });
  });

  it("rejects a wrong verify token with 403", () => {
    const r = verifyWebhook(
      { "hub.mode": "subscribe", "hub.verify_token": "WRONG", "hub.challenge": "12345" },
      CFG
    );
    expect(r.status).toBe(403);
  });

  it("rejects a non-subscribe mode with 403", () => {
    const r = verifyWebhook(
      { "hub.mode": "unsubscribe", "hub.verify_token": "the-verify-token", "hub.challenge": "x" },
      CFG
    );
    expect(r.status).toBe(403);
  });
});

describe("isValidSignature — X-Hub-Signature-256", () => {
  const raw = Buffer.from(JSON.stringify({ hello: "world" }));
  const good =
    "sha256=" + crypto.createHmac("sha256", CFG.appSecret).update(raw).digest("hex");

  it("accepts a correctly signed body", () => {
    expect(isValidSignature(raw, good, CFG.appSecret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ hello: "evil" }));
    expect(isValidSignature(tampered, good, CFG.appSecret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(isValidSignature(raw, undefined, CFG.appSecret)).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    expect(isValidSignature(raw, "garbage", CFG.appSecret)).toBe(false);
  });
});

describe("parseInboundMessages — Meta payload normalization", () => {
  const textPayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ profile: { name: "Ravi" }, wa_id: "919812345678" }],
              messages: [
                { from: "919812345678", id: "wamid.A", type: "text", text: { body: "how to grow tomatoes" } },
              ],
            },
          },
        ],
      },
    ],
  };

  it("extracts a text message with the contact name", () => {
    const out = parseInboundMessages(textPayload);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      waId: "919812345678",
      name: "Ravi",
      messageId: "wamid.A",
      text: "how to grow tomatoes",
      hasImage: false,
    });
  });

  it("extracts an image message with caption as text", () => {
    const out = parseInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Sita" }, wa_id: "91999" }],
                messages: [
                  { from: "91999", id: "wamid.B", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", caption: "sick plant" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out[0]).toMatchObject({ hasImage: true, imageId: "MEDIA1", mimeType: "image/jpeg", text: "sick plant" });
  });

  it("ignores status/delivery webhooks (no messages array)", () => {
    const out = parseInboundMessages({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.C", status: "delivered" }] } }] }],
    });
    expect(out).toHaveLength(0);
  });

  // Voice notes used to be dropped here. They are now first-class: the media id
  // is captured and the transcript fills `text` later in dispatch.
  it("captures a voice note's media id and mime type", () => {
    const out = parseInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "X" }, wa_id: "91000" }],
                messages: [
                  {
                    from: "91000",
                    id: "wamid.D",
                    type: "audio",
                    audio: { id: "A", mime_type: "audio/ogg; codecs=opus", voice: true },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].audioId).toBe("A");
    expect(out[0].mimeType).toContain("audio/ogg");
    expect(out[0].text).toBe("");
    expect(out[0].hasImage).toBe(false);
  });

  it("still skips genuinely unsupported types (location, sticker)", () => {
    const out = parseInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "X" }, wa_id: "91000" }],
                messages: [
                  { from: "91000", id: "wamid.E", type: "location", location: { latitude: 1 } },
                  { from: "91000", id: "wamid.F", type: "sticker", sticker: { id: "S" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out).toHaveLength(0);
  });

  it("returns empty for a malformed payload without throwing", () => {
    expect(parseInboundMessages({} as any)).toEqual([]);
    expect(parseInboundMessages(null as any)).toEqual([]);
  });
});

describe("dispatchInbound — routing to the core", () => {
  function messenger(): CloudMessenger {
    return {
      sendText: vi.fn(async () => {}),
      fetchImage: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" })),
      markReadAndTyping: vi.fn(async () => {}),
    };
  }

  it("marks a 1:1 message read + shows typing (human touch), by message id", async () => {
    const m = messenger();
    await dispatchInbound(
      [{ waId: "91999", name: "Ravi", messageId: "wamid.T", text: "hi", hasImage: false }],
      m,
      new SeenCache(100)
    );
    expect(m.markReadAndTyping).toHaveBeenCalledWith("wamid.T");
  });

  it("does NOT show a typing indicator for group messages", async () => {
    const m = messenger();
    await dispatchInbound(
      [
        {
          waId: "91999",
          name: "Ravi",
          messageId: "wamid.TG",
          text: "how do I grow tomatoes?",
          hasImage: false,
          groupId: "120363-group",
        },
      ],
      m,
      new SeenCache(100)
    );
    expect(m.markReadAndTyping).not.toHaveBeenCalled();
  });

  it("calls processMessage once per new message", async () => {
    const seen = new SeenCache(100);
    await dispatchInbound(
      [{ waId: "91999", name: "Ravi", messageId: "wamid.A", text: "hi", hasImage: false }],
      messenger(),
      seen
    );
    expect(processMessage).toHaveBeenCalledOnce();
  });

  it("dedupes a redelivered message id (Meta retry)", async () => {
    const seen = new SeenCache(100);
    const msg = { waId: "91999", name: "Ravi", messageId: "wamid.DUP", text: "hi", hasImage: false };
    await dispatchInbound([msg], messenger(), seen);
    await dispatchInbound([msg], messenger(), seen);
    expect(processMessage).toHaveBeenCalledOnce();
  });

  it("binds the responder to the messenger's sendText", async () => {
    const m = messenger();
    (processMessage as any).mockImplementationOnce(async (_msg: any, res: any) => {
      await res.send("reply text");
    });
    await dispatchInbound(
      [{ waId: "91999", name: "Ravi", messageId: "wamid.E", text: "hi", hasImage: false }],
      m,
      new SeenCache(100)
    );
    expect(m.sendText).toHaveBeenCalledWith("91999", "reply text", false); // 1:1 => not a group
  });

  // The exact hole that lost interaction 79: the send failed, processMessage
  // swallowed it, and the member was left with nothing at all. A failed send
  // must still produce *something* addressed to the member.
  it("tells the member something went wrong when the reply could not be sent", async () => {
    const m = messenger();
    (m.sendText as any).mockRejectedValueOnce(new Error("WhatsApp Cloud sendText failed: 400"));
    (processMessage as any).mockImplementationOnce(async (_msg: any, res: any) => {
      await res.send("a very long answer that the transport rejects");
    });

    await dispatchInbound(
      [{ waId: "91999", name: "Ravi", messageId: "wamid.FAIL", text: "hi", hasImage: false }],
      m,
      new SeenCache(100)
    );

    expect(m.sendText).toHaveBeenCalledTimes(2);
    const [to, body] = (m.sendText as any).mock.calls[1];
    expect(to).toBe("91999");
    expect(body).toMatch(/Kshaminchandi/);
  });

  it("routes an official GROUP message to the group and replies with recipient_type=group", async () => {
    const m = messenger();
    (processMessage as any).mockImplementationOnce(async (_msg: any, res: any) => {
      await res.send("grow tip");
    });
    await dispatchInbound(
      [
        {
          waId: "91999",
          name: "Ravi",
          messageId: "wamid.G",
          text: "how do I grow tomatoes?", // in-scope gardening question → answered
          hasImage: false,
          groupId: "120363-group",
        },
      ],
      m,
      new SeenCache(100)
    );
    // Reply goes to the GROUP id, flagged as a group send.
    expect(m.sendText).toHaveBeenCalledWith("120363-group", "grow tip", true);
  });

  it("stays silent on untagged off-topic chit-chat in a group", async () => {
    const m = messenger();
    await dispatchInbound(
      [
        {
          waId: "91999",
          name: "Ravi",
          messageId: "wamid.H",
          text: "good morning everyone",
          hasImage: false,
          groupId: "120363-group",
        },
      ],
      m,
      new SeenCache(100)
    );
    expect(m.sendText).not.toHaveBeenCalled();
  });
});

describe("voice notes — never answer a transcript we did not understand", () => {
  function voiceMessenger(): CloudMessenger {
    return {
      sendText: vi.fn(async () => {}),
      fetchImage: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/jpeg" })),
      fetchMedia: vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "audio/ogg" })),
      markReadAndTyping: vi.fn(async () => {}),
    } as CloudMessenger;
  }
  const voiceNote = {
    waId: "91999",
    name: "Ravi",
    messageId: "wamid.V",
    text: "",
    hasImage: false,
    audioId: "AUDIO1",
  };

  it("answers a confidently transcribed voice note", async () => {
    sttMock.transcribe.mockResolvedValueOnce({ text: "tomato lo leaf miner", confidence: -0.2 });
    await dispatchInbound([{ ...voiceNote }], voiceMessenger(), new SeenCache(100));
    expect(processMessage).toHaveBeenCalledOnce();
    expect((processMessage as any).mock.calls[0][0].text).toBe("tomato lo leaf miner");
  });

  // The real failure: "Hello, kura gelela banding cadi" was answered with 3500
  // chars about the wrong crop. Asking beats guessing.
  it("asks the member to repeat instead of answering a low-confidence transcript", async () => {
    const m = voiceMessenger();
    sttMock.transcribe.mockResolvedValueOnce({
      text: "Hello, kura gelela banding cadi.",
      confidence: -1.8,
    });
    await dispatchInbound([{ ...voiceNote }], m, new SeenCache(100));

    expect(processMessage).not.toHaveBeenCalled();
    expect(m.sendText).toHaveBeenCalledOnce();
    expect((m.sendText as any).mock.calls[0][1]).toMatch(/ardham cheskoleka/);
  });

  // A vendor that reports no confidence must not be read as zero confidence,
  // or every Sarvam transcript would be rejected.
  it("trusts a transcript from a vendor that reports no confidence at all", async () => {
    sttMock.transcribe.mockResolvedValueOnce({ text: "kura mokkalu ela pencali" });
    await dispatchInbound([{ ...voiceNote }], voiceMessenger(), new SeenCache(100));
    expect(processMessage).toHaveBeenCalledOnce();
  });
});
