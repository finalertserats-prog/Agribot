import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/database", () => ({
  getUser: vi.fn(),
  setUserProfile: vi.fn(async () => ({})),
  deleteUserData: vi.fn(async () => {}),
}));
vi.mock("../src/lib/memory", () => ({ deleteUserMemories: vi.fn(async () => {}) }));

import { validateProfile, getProfileView, saveProfile, eraseProfile } from "../src/web/profile";
import { getUser, setUserProfile, deleteUserData } from "../src/lib/database";
import { deleteUserMemories } from "../src/lib/memory";

beforeEach(() => vi.clearAllMocks());

describe("validateProfile", () => {
  it("accepts a valid name-only submission", () => {
    const r = validateProfile({ sessionId: "web-abc", name: "Ravi" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ sessionId: "web-abc", name: "Ravi" });
  });

  it("rejects a missing session id", () => {
    expect(validateProfile({ name: "Ravi" }).ok).toBe(false);
  });

  it("rejects an empty name (name is required)", () => {
    expect(validateProfile({ sessionId: "web-abc", name: "  " }).ok).toBe(false);
  });

  it("accepts optional location and phone", () => {
    const r = validateProfile({ sessionId: "web-abc", name: "Ravi", location: "Guntur", phone: "+91 98765 43210" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.location).toBe("Guntur"); expect(r.value.phone).toContain("98765"); }
  });

  it("rejects an implausible phone number", () => {
    expect(validateProfile({ sessionId: "web-abc", name: "Ravi", phone: "123" }).ok).toBe(false);
  });

  it("rejects an over-long session id (anti-abuse)", () => {
    expect(validateProfile({ sessionId: "x".repeat(200), name: "Ravi" }).ok).toBe(false);
  });
});

describe("getProfileView — returning-user check", () => {
  it("reports onboarded when name is confirmed and real", () => {
    (getUser as any).mockReturnValue({ name: "Ravi", location: "Guntur", phone: "", confirmed: "name,location" });
    expect(getProfileView("web-1")).toMatchObject({ onboarded: true, name: "Ravi" });
  });

  it("reports NOT onboarded for a chat-only user (placeholder name, unconfirmed)", () => {
    (getUser as any).mockReturnValue({ name: "Web Farmer", location: "", phone: "", confirmed: "" });
    expect(getProfileView("web-2").onboarded).toBe(false);
  });

  it("reports NOT onboarded for an unknown session", () => {
    (getUser as any).mockReturnValue(undefined);
    expect(getProfileView("web-3").onboarded).toBe(false);
  });
});

describe("saveProfile", () => {
  it("writes an authoritative profile and returns the view", async () => {
    (getUser as any).mockReturnValue({ name: "Ravi", location: "Guntur", phone: "", confirmed: "name,location" });
    const view = await saveProfile({ sessionId: "web-1", name: "Ravi", location: "Guntur" });
    expect(setUserProfile).toHaveBeenCalledWith("web-1", "web", { name: "Ravi", phone: undefined, location: "Guntur" });
    expect(view.onboarded).toBe(true);
  });
});

describe("eraseProfile — web DPDP parity", () => {
  it("deletes the user's data and vector memories", async () => {
    await eraseProfile("web-1");
    expect(deleteUserData).toHaveBeenCalledWith("web-1");
    expect(deleteUserMemories).toHaveBeenCalledWith("web-1");
  });
});
