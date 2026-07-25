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
  // Broader "farming as a way of life" scope: home/terrace/urban growing,
  // methods, and where-to-get-things sourcing. Deliberately excludes bare
  // generic words (pot, kitchen, urban, container) whose real use cases already
  // match via plant/garden/farming — including them would false-match
  // "buy a pot", "kitchen cleaning", "urban development".
  "nursery", "seedling", "sapling", "potting", "hydroponics", "aquaponics",
  "rooftop", "greenhouse", "polyhouse", "sowing", "transplant", "pollination",
  "poultry", "beekeeping", "mushroom", "orchard", "kvk", "mandi",
  "agrifriend", "agri", "dosth",
];

export const FARMING_ONLY_REPLY =
  "I'm here for all things growing — farming, terrace and home gardening, plants, soil and where to get what you need. Ask me anything about growing! 🌱";

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
