/**
 * Splitting long replies into deliverable messages.
 *
 * The WhatsApp Cloud API rejects a `text.body` over 4096 characters outright —
 * the whole message 400s, so an over-long answer is not truncated, it simply
 * never arrives. That cost a member their actual question once (a 5252-char
 * tomato answer, 2026-08-06): the reply was generated, stored, and silently
 * dropped at the transport.
 *
 * Depth is wanted — a grower asking how to raise tomatoes should get the full
 * answer, not a truncated one. So splitting is the delivery mechanism for long
 * replies, not an apology for them: the parts arrive back-to-back and read like
 * someone explaining at length, which is exactly the intent.
 *
 * That's why it stays invisible — no "(1/2)" markers, no editorializing,
 * nothing that reads as a bot artifact. Chunks are joined back by their own
 * separator, so nothing is added or lost, and seams land on paragraph breaks so
 * each message is a whole thought.
 */

/** Meta's hard cap on `text.body`. Exceeding it fails the send with a 400. */
export const WHATSAPP_TEXT_LIMIT = 4096;

/**
 * What we actually split at. The margin absorbs the gap between Meta's notion
 * of a character and JS's UTF-16 `length` — emoji outside the BMP count as two
 * here, and our replies are full of them.
 */
export const SAFE_CHUNK_LIMIT = 3900;

/**
 * Break points in descending order of how well the seam reads. Plain strings,
 * not regexes, so that joining the chunks with the same separator reproduces
 * the input exactly.
 */
const SEPARATORS = ["\n\n", "\n", " "] as const;

/** Last resort for a single unbreakable token (a long URL, an unspaced string). */
function hardSlice(text: string, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
}

function splitAtDepth(text: string, limit: number, depth: number): string[] {
  if (text.length <= limit) return [text];
  if (depth >= SEPARATORS.length) return hardSlice(text, limit);

  const sep = SEPARATORS[depth];
  const parts = text.split(sep);
  // This separator doesn't occur — try a finer one rather than emitting an
  // oversized chunk.
  if (parts.length === 1) return splitAtDepth(text, limit, depth + 1);

  const out: string[] = [];
  let current = "";
  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (part.length <= limit) {
      current = part;
      continue;
    }
    // One part alone overflows: split it finer, then keep its tail open so the
    // following parts can still pack onto it instead of starting a new message.
    const sub = splitAtDepth(part, limit, depth + 1);
    out.push(...sub.slice(0, -1));
    current = sub[sub.length - 1];
  }
  if (current) out.push(current);
  return out;
}

/**
 * Split `text` into chunks that each fit `limit`, preferring paragraph breaks,
 * then line breaks, then word breaks. A blank reply yields no messages at all —
 * sending an empty body is a 400 of its own.
 */
export function splitForWhatsApp(text: string, limit = SAFE_CHUNK_LIMIT): string[] {
  if (!text.trim()) return [];
  return splitAtDepth(text, limit, 0);
}
