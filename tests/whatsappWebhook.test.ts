import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Mock the reply core so dispatch tests don't touch DB/AI.
vi.mock("../src/core/reply", () => ({
  processMessage: vi.fn(async () => {}),
}));

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

  it("skips unsupported message types (audio/location)", () => {
    const out = parseInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "X" }, wa_id: "91000" }],
                messages: [{ from: "91000", id: "wamid.D", type: "audio", audio: { id: "A" } }],
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
    };
  }

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
