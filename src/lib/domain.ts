import { proto } from "@whiskeysockets/baileys";

export const DOMAIN_KEYWORDS = [
  "farming", "garden", "gardening", "plant", "plants", "crop", "crops",
  "soil", "compost", "fertilizer", "pest", "pesticide", "harvest",
  "seed", "seeds", "irrigation", "water", "tomato", "chilli", "chili",
  "leaf", "leaves", "root", "fruit", "vegetable", "herb", "organic",
  "terrace", "balcony", "grow", "growing", "cultivation", "agriculture",
  "horticulture", "botany", "flower", "bloom", "weed", "mulch",
  "nitrogen", "phosphorus", "potassium", "npk", "ph", "manure",
  "vermicompost", "drip", "spray", "pruning", "grafting",
  "agrifriend", "agri",
];

export const FARMING_ONLY_REPLY =
  "I'm focused on our farming community and plant health. Let's keep the discussion grounded in agriculture! 🌱";

// Word-boundary match so short keywords like "ph"/"agri" don't false-match
// inside unrelated words ("phone", "graph", "photo"). The keyword list already
// includes plural/variant forms, so we don't lose coverage from exact matching.
const KEYWORD_REGEX = new RegExp(`\\b(${DOMAIN_KEYWORDS.join("|")})\\b`, "i");

/** Fast keyword pre-filter. A miss should fall back to a model classifier. */
export function isFarmingRelated(text: string): boolean {
  return KEYWORD_REGEX.test(text);
}

/** Escape regex metacharacters so user/env-supplied strings are literal. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractTextFromMessage(msg: proto.IWebMessageInfo): string {
  const m = msg.message;
  if (!m) return "";

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;

  return "";
}
