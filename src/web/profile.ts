import { getUser, setUserProfile, deleteUserData } from "../lib/database";
import { deleteUserMemories } from "../lib/memory";

export interface ProfileInput {
  sessionId: string;
  name: string;
  phone?: string;
  location?: string;
}

export interface ProfileView {
  /** True once the user has completed onboarding (a confirmed, real name). */
  onboarded: boolean;
  name: string;
  location: string;
  phone: string;
}

const NAME_MAX = 60;
const FIELD_MAX = 80;
const SESSION_MAX = 100;
// Placeholder names the system assigns before a farmer tells us who they are.
const PLACEHOLDER_NAMES = new Set(["", "Farmer", "Web Farmer"]);

type ValidateResult = { ok: true; value: ProfileInput } | { ok: false; error: string };

/**
 * Validate an onboarding-form submission. Name is required; location and phone
 * are optional (we never block a farmer's question behind mandatory PII). All
 * fields are length-capped and the phone is sanity-checked, so the public
 * endpoint can't be used to stuff the DB with garbage.
 */
export function validateProfile(body: unknown): ValidateResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const sessionId = typeof b.sessionId === "string" ? b.sessionId.trim() : "";
  if (!sessionId) return { ok: false, error: "missing session id" };
  if (sessionId.length > SESSION_MAX) return { ok: false, error: "invalid session id" };

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > NAME_MAX) return { ok: false, error: "name is too long" };

  const location =
    typeof b.location === "string" ? b.location.trim().slice(0, FIELD_MAX) : "";

  let phone = typeof b.phone === "string" ? b.phone.trim() : "";
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return { ok: false, error: "that phone number looks off — check it?" };
    phone = phone.slice(0, 24);
  }

  return {
    ok: true,
    value: { sessionId, name, phone: phone || undefined, location: location || undefined },
  };
}

/**
 * A farmer is "onboarded" (returning) when we hold a real, user-confirmed name
 * for their session — not a placeholder and not a name we merely guessed from
 * chatter. This drives whether the web UI shows the form or greets them back.
 */
export function getProfileView(sessionId: string): ProfileView {
  const u = getUser(sessionId);
  if (!u) return { onboarded: false, name: "", location: "", phone: "" };
  const confirmed = u.confirmed.split(",").map((s) => s.trim());
  const onboarded = confirmed.includes("name") && !PLACEHOLDER_NAMES.has(u.name);
  return { onboarded, name: u.name, location: u.location, phone: u.phone };
}

/** Persist an onboarding submission authoritatively, then return the view. */
export async function saveProfile(input: ProfileInput): Promise<ProfileView> {
  await setUserProfile(input.sessionId, "web", {
    name: input.name,
    phone: input.phone,
    location: input.location,
  });
  return getProfileView(input.sessionId);
}

/** Erase a web user's stored data — DPDP parity with the WhatsApp DELETE path. */
export async function eraseProfile(sessionId: string): Promise<void> {
  await deleteUserData(sessionId);
  await deleteUserMemories(sessionId);
}
