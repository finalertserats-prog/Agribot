import { getProvider } from "../llm";
import { logger } from "../logger";
import { hasResidualPii, isPersonalOnly, scrubPii } from "./privacy";

/**
 * The quality gate for cross-member knowledge.
 *
 * Getting this wrong is worse than having no shared knowledge at all. A wrong
 * answer promoted here is repeated to EVERY member who asks a similar question,
 * and it arrives carrying the authority of "the community's accumulated
 * knowledge". The HRMN-99 failure is the cautionary case: a fluent, confident,
 * completely inverted answer. Had it been promoted, every future apple question
 * would have inherited it.
 *
 * So the gate is deliberately conservative and REJECTS BY DEFAULT. Anything
 * uncertain, unverifiable, personal, or merely conversational is dropped. We
 * lose recall; we do not lose trust.
 */

export interface KnowledgeCandidate {
  question: string;
  answer: string;
  memberName?: string;
}

export interface PromotionVerdict {
  promote: boolean;
  /** Generalized, PII-free knowledge text. Only set when promote is true. */
  knowledge?: string;
  /** Short topic label used for retrieval and for human review. */
  topic?: string;
  reason: string;
  /** Judge's 0-1 confidence that the horticultural content is CORRECT. */
  confidence?: number;
}

/**
 * Below this, the answer is not trustworthy enough to repeat to strangers.
 * Set high on purpose: the cost of a false accept (poisoned knowledge, served
 * confidently, forever) massively outweighs a false reject (we simply answer
 * the question fresh next time, exactly as we do today).
 */
export const MIN_CONFIDENCE = 0.85;

/** Trivially short exchanges carry no transferable knowledge. */
const MIN_ANSWER_CHARS = 200;

const GATE_PROMPT = `You are the quality gate for a gardening community's SHARED knowledge base in Hyderabad, India. Anything you approve will be shown to OTHER experienced growers as trusted community knowledge, so a wrong approval is far more damaging than a missed one.

Judge the Q&A below and reply with ONLY JSON:
{
  "generalizable": <true if this teaches something useful to OTHER growers, false if it only concerns this one person's situation>,
  "correct": <true only if the horticultural content is factually sound>,
  "confidence": <0..1, your confidence that it is factually correct>,
  "topic": "<short topic label, e.g. 'apple cultivar HRMN-99 in low-chill plains'>",
  "knowledge": "<the transferable knowledge, rewritten as a standalone factual note. Third person. No greetings, no names, no personal details, no 'you'. Keep every dose, dilution, interval and cultivar name exactly. Empty string if not generalizable.>",
  "reason": "<one line>"
}

Rules:
- If the answer contains ANY claim you believe is wrong or cannot verify, set correct=false. Do not be generous.
- If the answer invents an acronym expansion, attribution, or cultivar trait, set correct=false.
- Vague or generic advice ("use good soil", "water regularly") is NOT worth sharing: generalizable=false.
- The knowledge text must not identify any individual.

Q: `;

/**
 * Decide whether one exchange becomes shared knowledge.
 *
 * Order matters and is a cost decision as much as a safety one: the cheap
 * deterministic rejects run first so the judge model is only paid for on
 * exchanges that could plausibly qualify.
 */
export async function evaluateForPromotion(
  c: KnowledgeCandidate
): Promise<PromotionVerdict> {
  if (c.answer.length < MIN_ANSWER_CHARS) {
    return { promote: false, reason: "answer too short to carry knowledge" };
  }
  if (isPersonalOnly(c.question, c.answer)) {
    return { promote: false, reason: "personal/administrative exchange" };
  }

  const question = scrubPii(c.question, c.memberName);
  const answer = scrubPii(c.answer, c.memberName);

  let parsed: {
    generalizable?: boolean;
    correct?: boolean;
    confidence?: number;
    topic?: string;
    knowledge?: string;
    reason?: string;
  };
  try {
    const raw = await getProvider().generateText(
      `${GATE_PROMPT}${question}\n\nA: ${answer}`
    );
    // Models occasionally wrap JSON in prose or a fence despite instructions.
    const json = raw.match(/\{[\s\S]*\}/);
    if (!json) return { promote: false, reason: "gate returned no JSON" };
    parsed = JSON.parse(json[0]);
  } catch (err) {
    // Fail CLOSED. An unavailable judge must never mean "promote anyway".
    logger.warn({ err }, "[knowledge] quality gate failed — not promoting");
    return { promote: false, reason: "quality gate unavailable" };
  }

  if (!parsed.generalizable) {
    return { promote: false, reason: parsed.reason || "not generalizable" };
  }
  if (!parsed.correct) {
    return { promote: false, reason: parsed.reason || "judged factually unsound" };
  }
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  if (confidence < MIN_CONFIDENCE) {
    return { promote: false, reason: `confidence ${confidence} below ${MIN_CONFIDENCE}`, confidence };
  }

  const knowledge = (parsed.knowledge || "").trim();
  if (knowledge.length < MIN_ANSWER_CHARS / 2) {
    return { promote: false, reason: "generalized text too thin", confidence };
  }

  // Last line of defence: the generalization pass is an LLM, and LLMs asked to
  // strip personal details sometimes keep them. Refuse rather than trust it.
  if (hasResidualPii(knowledge)) {
    logger.warn({ topic: parsed.topic }, "[knowledge] residual PII after generalization — rejected");
    return { promote: false, reason: "residual PII after generalization", confidence };
  }

  return {
    promote: true,
    knowledge,
    topic: parsed.topic || "general",
    confidence,
    reason: parsed.reason || "approved",
  };
}
