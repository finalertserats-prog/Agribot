import { describe, it, expect, vi, beforeEach } from "vitest";
import { WhatsAppCloudClient } from "../src/lib/whatsappCloud";

const CFG = {
  accessToken: "TOKEN123",
  phoneNumberId: "PNID",
  verifyToken: "v",
  appSecret: "s",
  graphVersion: "v22.0",
};

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("WhatsAppCloudClient.sendText", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => okJson({ messages: [{ id: "wamid.OUT" }] }));
  });

  it("POSTs to the messages endpoint with the bearer token and text body", async () => {
    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any });
    await client.sendText("919812345678", "hello farmer");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v22.0/PNID/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer TOKEN123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919812345678",
      type: "text",
      text: { preview_url: false, body: "hello farmer" },
    });
  });

  it("throws on a non-2xx response so callers can log/handle it", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "invalid token" } }),
      text: async () => '{"error":{"message":"invalid token"}}',
    });
    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any });
    await expect(client.sendText("919", "hi")).rejects.toThrow();
  });
});

describe("WhatsAppCloudClient.fetchImage", () => {
  it("resolves the media URL then downloads the bytes with auth", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://graph.facebook.com/v22.0/MEDIA1") {
        return okJson({ url: "https://lookaside.fbsbx.com/media/xyz", mime_type: "image/png" });
      }
      // second call — the binary download
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
        headers: { get: () => "image/png" },
      };
    });

    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any, maxImageBytes: 1024 });
    const result = await client.fetchImage("MEDIA1");

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(Array.from(result!.bytes)).toEqual([1, 2, 3, 4, 5]);
    // second fetch must carry the bearer token
    const secondInit = fetchMock.mock.calls[1][1];
    expect(secondInit.headers.Authorization).toBe("Bearer TOKEN123");
  });

  it("returns null when the image exceeds the size limit", async () => {
    const big = new Uint8Array(2048);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/MEDIA1")) return okJson({ url: "https://x/y", mime_type: "image/jpeg" });
      return { ok: true, status: 200, arrayBuffer: async () => big.buffer, headers: { get: () => "image/jpeg" } };
    });
    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any, maxImageBytes: 1024 });
    expect(await client.fetchImage("MEDIA1")).toBeNull();
  });

  it("rejects oversized media early via Content-Length, without buffering", async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(0).buffer);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/MEDIA1")) return okJson({ url: "https://x/y", mime_type: "image/jpeg" });
      return { ok: true, status: 200, arrayBuffer, headers: { get: (h: string) => (h === "content-length" ? "5000000" : "image/jpeg") } };
    });
    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any, maxImageBytes: 1024 });
    expect(await client.fetchImage("MEDIA1")).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled(); // bailed before downloading the body
  });

  it("returns null when media resolution fails", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => "not found" }));
    const client = new WhatsAppCloudClient(CFG, { fetchFn: fetchMock as any });
    expect(await client.fetchImage("MISSING")).toBeNull();
  });
});
