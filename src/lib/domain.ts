import { proto } from "@whiskeysockets/baileys";

/** Shared gardening vocabulary. Every persona's scope is this base plus its own
 *  extra keywords (see config/personas.ts). */
export const GARDENING_KEYWORDS = [
  "garden", "gardening", "plant", "plants", "crop", "crops",
  "soil", "compost", "fertilizer", "pest", "pesticide", "harvest",
  "seed", "seeds", "irrigation", "water", "tomato", "chilli", "chili",
  "leaf", "leaves", "root", "fruit", "vegetable", "herb", "organic",
  "terrace", "balcony", "grow", "growing", "cultivation",
  "horticulture", "flower", "flowering", "bloom", "weed", "mulch",
  "nitrogen", "phosphorus", "potassium", "npk", "ph", "manure",
  "vermicompost", "vermiwash", "drip", "spray", "pruning", "grafting",
  // CTG organic terrace-gardening focus: the full plant lifecycle, organic
  // nutrition, and organic pest management / bio-inputs. Deliberately excludes
  // bare generic words (pot, kitchen, urban, container) whose real use cases
  // already match via plant/garden — including them would false-match
  // "buy a pot", "kitchen cleaning", "urban development".
  "nursery", "seedling", "sapling", "potting", "sowing", "transplant",
  "germination", "germinate", "pollination", "fruiting", "ornamental",
  "rooftop", "greenhouse", "polyhouse", "grafting", "orchard",
  "neem", "jeevamrutham", "jeevamrutam", "panchagavya", "trichoderma",
  "pseudomonas", "azospirillum", "rhizobium", "azotobacter", "psb",
  "biofertilizer", "biopesticide", "biofungicide", "ipm", "mushroom",
  "kvk", "mandi", "ctg",
];

export const FARMING_ONLY_REPLY =
  "🌱 Namaste andi! Nenu CTG Admn — organic, chemical-free ga vegetable, fruit, flower & ornamental plants pots/containers lo pencha-daniki help chestanu. Mee gardening question adagandi!";

/**
 * Build a fast keyword pre-filter. Word-boundary match so short keywords like
 * "ph"/"ctg" don't false-match inside unrelated words ("phone", "graph"). The
 * keyword lists include plural/variant forms, so exact matching loses no
 * coverage. Metacharacters in keywords are escaped so a stray "." stays literal.
 */
export function makeKeywordMatcher(keywords: readonly string[]): (text: string) => boolean {
  const regex = new RegExp(`\\b(${keywords.map(escapeRegExp).join("|")})\\b`, "i");
  return (text: string) => regex.test(text);
}

/** Default gardening pre-filter (shared base vocabulary). A miss should fall
 *  back to a model classifier. Per-persona scope lives in config/personas.ts. */
export const isFarmingRelated = makeKeywordMatcher(GARDENING_KEYWORDS);

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
