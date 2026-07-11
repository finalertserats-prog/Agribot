import { logger } from "../lib/logger";
import type { OutboundCandidate } from "../policy/types";

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** How proactive messages actually go out. Swap the impl for the real channel. */
export interface Transport {
  send(candidate: OutboundCandidate, text: string): Promise<SendResult>;
}

/**
 * Stub transport: logs what WOULD be sent, never contacts WhatsApp. Lets the
 * whole proactive pipeline run and be tested end-to-end before the official
 * WhatsApp Business Platform is wired in (an operator/Meta-approval task).
 */
export class LoggingTransport implements Transport {
  async send(candidate: OutboundCandidate, text: string): Promise<SendResult> {
    // Log metadata, not the rendered text — it can contain PII / advisory content.
    // Full text only at debug level for local troubleshooting.
    logger.info(
      { farmerId: candidate.farmerId, messageType: candidate.messageType, templateId: candidate.templateId },
      "[autonomy] (stub) would send proactive message"
    );
    logger.debug({ farmerId: candidate.farmerId, text }, "[autonomy] (stub) rendered text");
    return { ok: true };
  }
}

/**
 * Placeholder for the real WhatsApp Business Platform (Cloud API) transport.
 * Requires an approved template, the business number, and an access token —
 * all operator setup (Phase A ops task). Left unimplemented on purpose so it
 * can't accidentally send from an unverified/unofficial channel.
 */
export class WhatsAppCloudTransport implements Transport {
  async send(): Promise<SendResult> {
    return { ok: false, error: "WhatsApp Business Platform transport not configured" };
  }
}
