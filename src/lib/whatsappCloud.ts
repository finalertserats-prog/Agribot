import { logger } from "./logger";
import { splitForWhatsApp } from "./textChunk";
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
  async sendText(to: string, text: string, isGroup = false): Promise<void> {
    // Meta rejects a body over 4096 chars with a 400 — the whole message, not
    // just the tail. Split here rather than at a caller: this is the only layer
    // that knows the cap, and every path to it (reply, autonomy, ops) inherits
    // the protection. Sequential, so the parts land in order.
    const parts = splitForWhatsApp(text);
    // An empty body is a 400 of its own, so it is dropped rather than sent —
    // but dropping it silently would make "we replied with nothing" look like a
    // successful reply, which is the exact class of bug this change exists to
    // kill. Throw so the caller's failure path runs and the member hears back.
    if (parts.length === 0) {
      logger.error({ to }, "[cloud] refusing to send an empty reply");
      throw new Error("WhatsApp Cloud sendText called with empty text");
    }
    for (const part of parts) {
      await this.sendOneText(to, part, isGroup);
    }
  }

  private async sendOneText(to: string, text: string, isGroup: boolean): Promise<void> {
    // Same /messages endpoint for 1:1 and groups — only recipient_type differs.
    // For a group, `to` is the group id (official Groups API).
    const res = await this.fetchFn(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { ...this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: isGroup ? "group" : "individual",
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
   * Send a previously-uploaded audio media id as a voice note.
   *
   * WhatsApp decides "voice note bubble" vs "file attachment" from the uploaded
   * bytes, not from a flag here — hence the OGG/Opus transcode upstream. There
   * is no `voice: true` field to set.
   */
  async sendAudio(to: string, mediaId: string, isGroup = false): Promise<void> {
    const res = await this.fetchFn(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { ...this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: isGroup ? "group" : "individual",
        to,
        type: "audio",
        audio: { id: mediaId },
      }),
    });
    if (!res.ok) {
      const detail = await safeText(res);
      logger.error({ status: res.status, detail }, "[cloud] sendAudio failed");
      throw new Error(`WhatsApp Cloud sendAudio failed: ${res.status}`);
    }
  }

  /**
   * Upload bytes to Meta and return the media id used by sendAudio.
   *
   * Multipart is built via FormData/Blob rather than hand-rolled boundaries so
   * the runtime sets Content-Type (including the boundary) itself — a
   * hand-written boundary that drifts from the header is the classic cause of
   * an opaque 400 here. Returns null on failure: a missing voice note should
   * degrade to the text reply that was already sent, never throw away the answer.
   */
  async uploadMedia(bytes: Uint8Array, mimeType: string, filename: string): Promise<string | null> {
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", mimeType);
      form.append("file", new Blob([bytes], { type: mimeType }), filename);

      const res = await this.fetchFn(`${this.base}/${this.cfg.phoneNumberId}/media`, {
        method: "POST",
        headers: this.authHeader(), // no Content-Type — FormData sets the boundary
        body: form,
      });
      if (!res.ok) {
        logger.error(
          { status: res.status, detail: await safeText(res) },
          "[cloud] uploadMedia failed"
        );
        return null;
      }
      const body = (await res.json()) as { id?: string };
      return body.id ?? null;
    } catch (err) {
      logger.error({ err }, "[cloud] uploadMedia error");
      return null;
    }
  }

  /**
   * Mark the farmer's message read (blue ticks) AND show a "typing…" indicator,
   * so CTG Admn reads-then-thinks like a person instead of firing back instantly.
   * Official Cloud API feature — no ban risk. The indicator auto-dismisses when we
   * reply (or after 25s). Best-effort: a human-feel touch, never worth failing a
   * reply over, so errors are logged and swallowed.
   */
  async markReadAndTyping(messageId: string): Promise<void> {
    try {
      const res = await this.fetchFn(`${this.base}/${this.cfg.phoneNumberId}/messages`, {
        method: "POST",
        headers: { ...this.authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
      });
      if (!res.ok) {
        logger.debug({ status: res.status }, "[cloud] markReadAndTyping non-OK (non-critical)");
      }
    } catch (err) {
      logger.debug({ err }, "[cloud] markReadAndTyping failed (non-critical)");
    }
  }

  /**
   * Two-step media download: resolve the media id to a short-lived URL, then
   * fetch the bytes (both require the bearer token). Returns null on any
   * failure or if the image exceeds the size cap — callers treat null as
   * "couldn't process the image".
   */
  async fetchImage(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    return this.fetchMedia(mediaId, this.maxImageBytes, "image/jpeg");
  }

  /**
   * Download any inbound media (image, voice note). Split out from fetchImage
   * so audio can carry its own cap: a 60-second voice note is small, but the
   * image ceiling is not the right yardstick for it and reusing that limit
   * silently drops long questions.
   */
  async fetchMedia(
    mediaId: string,
    maxBytes: number,
    fallbackMime: string
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
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
      if (declaredLen && declaredLen > maxBytes) {
        logger.warn({ size: declaredLen }, "[cloud] media over size limit (Content-Length) — dropping");
        return null;
      }
      const buf = new Uint8Array(await binRes.arrayBuffer());
      if (buf.byteLength > maxBytes) {
        logger.warn({ size: buf.byteLength }, "[cloud] media exceeds size limit — dropping");
        return null;
      }
      const mimeType =
        meta.mime_type || binRes.headers.get("content-type") || fallbackMime;
      return { bytes: buf, mimeType };
    } catch (err) {
      logger.error({ err }, "[cloud] fetchMedia error");
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
