import { describe, it, expect, afterEach, vi } from "vitest";
import type http from "http";

vi.mock("../src/core/reply", () => ({ processMessage: vi.fn(async () => {}) }));

import { startCloudWebhookServer } from "../src/web/cloudServer";
import type { CloudMessenger } from "../src/web/whatsappWebhook";

const CFG = {
  accessToken: "tok",
  phoneNumberId: "PNID",
  verifyToken: "verify-me",
  appSecret: "app-secret",
  graphVersion: "v22.0",
};

const messenger: CloudMessenger = {
  sendText: vi.fn(async () => {}),
  fetchImage: vi.fn(async () => null),
};

let server: http.Server | undefined;
afterEach(() => server?.close());

describe("cloud webhook server (integration)", () => {
  it("echoes the challenge on a valid GET verify", async () => {
    const started = await startCloudWebhookServer(CFG, messenger, 0);
    server = started.server;
    const res = await fetch(
      `http://127.0.0.1:${started.port}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=CHAL42`
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("CHAL42");
  });

  it("rejects a GET verify with the wrong token", async () => {
    const started = await startCloudWebhookServer(CFG, messenger, 0);
    server = started.server;
    const res = await fetch(
      `http://127.0.0.1:${started.port}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=x`
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unsigned POST with 403", async () => {
    const started = await startCloudWebhookServer(CFG, messenger, 0);
    server = started.server;
    const res = await fetch(`http://127.0.0.1:${started.port}/webhook/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    });
    expect(res.status).toBe(403);
  });

  it("serves a health check", async () => {
    const started = await startCloudWebhookServer(CFG, messenger, 0);
    server = started.server;
    const res = await fetch(`http://127.0.0.1:${started.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, transport: "whatsapp-cloud" });
  });
});
