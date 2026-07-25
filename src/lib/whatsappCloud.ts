import { logger } from "./logger";
import type { CloudConfig } from "../config";
import type { CloudMessenger } from "../web/whatsappWebhook";

type FetchFn = typeof fetch;

interface ClientOpts {
  /** Injectable for tests; defaults to the global fetch (Node 18+/22). */
  fetchFn?: FetchFn;
  /** Max image bytes to download before bailing. Defaults to 8 MB. */
  maxImageBytes?: number;
}

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Outbound WhatsApp Business Cloud API client — sends text replies and fetches
 * inbound media via Meta's Graph API. This is the official, no-ban-risk channel
 * for 1:1 chats (groups stay on Baileys).
 */
export class WhatsAppCloudClient implements CloudMessenger {
  private readonly fetchFn: FetchFn;
  private readonly maxImageBytes: number;
  private readonly base: string;

  constructor(private readonly cfg: CloudConfig, opts: ClientOpts = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxImageBytes = opts.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    this.base = `https://graph.facebook.com/${cfg.graphVersion}`;
  }

  private authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.accessToken}` };
  }

  /**
   * Send a free-form text reply. Valid only inside the 24h customer service
   * window (i.e. as a reply to a farmer-initiated message) — which is exactly
   * how the reactive bot is used. Outbound-outside-window needs a template.
   */
  async sendText(to: string, text: string): Promise<void> {
    const res = await this.fetchFn(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { ...this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      // Don't log the token; do log status + Meta's error detail for triage.
      logger.error({ status: res.status, detail }, "[cloud] sendText failed");
      throw new Error(`WhatsApp Cloud sendText failed: ${res.status}`);
    }
  }

  /**
   * Two-step media download: resolve the media id to a short-lived URL, then
   * fetch the bytes (both require the bearer token). Returns null on any
   * failure or if the image exceeds the size cap — callers treat null as
   * "couldn't process the image".
   */
  async fetchImage(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    try {
      const metaRes = await this.fetchFn(`${this.base}/${mediaId}`, { headers: this.authHeader() });
      if (!metaRes.ok) {
        logger.warn({ status: metaRes.status }, "[cloud] media resolve failed");
        return null;
      }
      const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
      if (!meta.url) return null;

      const binRes = await this.fetchFn(meta.url, { headers: this.authHeader() });
      if (!binRes.ok) {
        logger.warn({ status: binRes.status }, "[cloud] media download failed");
        return null;
      }
      // Reject oversized media BEFORE buffering it, when the server declares a
      // length. The post-download check below still backstops a missing/lying
      // Content-Length.
      const declaredLen = Number(binRes.headers.get("content-length") || 0);
      if (declaredLen && declaredLen > this.maxImageBytes) {
        logger.warn({ size: declaredLen }, "[cloud] image over size limit (Content-Length) — dropping");
        return null;
      }
      const buf = new Uint8Array(await binRes.arrayBuffer());
      if (buf.byteLength > this.maxImageBytes) {
        logger.warn({ size: buf.byteLength }, "[cloud] image exceeds size limit — dropping");
        return null;
      }
      const mimeType =
        meta.mime_type || binRes.headers.get("content-type") || "image/jpeg";
      return { bytes: buf, mimeType };
    } catch (err) {
      logger.error({ err }, "[cloud] fetchImage error");
      return null;
    }
  }
}

async function safeText(res: { text?: () => Promise<string> }): Promise<string> {
  try {
    return res.text ? await res.text() : "";
  } catch {
    return "";
  }
}
