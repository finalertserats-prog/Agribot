import { describe, it, expect } from "vitest";
import { resolveCloudConfig } from "../src/config";

describe("resolveCloudConfig — WhatsApp Cloud API activation", () => {
  const full = {
    WHATSAPP_CLOUD_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_VERIFY_TOKEN: "verify",
    WHATSAPP_APP_SECRET: "secret",
  };

  it("returns null when nothing is configured (Cloud stays off)", () => {
    expect(resolveCloudConfig({})).toBeNull();
  });

  it("returns a config object when all four required vars are present", () => {
    const c = resolveCloudConfig(full);
    expect(c).not.toBeNull();
    expect(c!.accessToken).toBe("tok");
    expect(c!.phoneNumberId).toBe("123");
    expect(c!.verifyToken).toBe("verify");
    expect(c!.appSecret).toBe("secret");
  });

  it("defaults the Graph API version when not overridden", () => {
    const c = resolveCloudConfig(full);
    expect(c!.graphVersion).toMatch(/^v\d+\.\d+$/);
  });

  it("honors an explicit Graph API version override", () => {
    const c = resolveCloudConfig({ ...full, WHATSAPP_GRAPH_VERSION: "v25.0" });
    expect(c!.graphVersion).toBe("v25.0");
  });

  it("returns null when the access token is missing (cannot send)", () => {
    expect(resolveCloudConfig({ ...full, WHATSAPP_CLOUD_TOKEN: undefined })).toBeNull();
  });

  it("returns null when the phone number id is missing (cannot address)", () => {
    expect(resolveCloudConfig({ ...full, WHATSAPP_PHONE_NUMBER_ID: undefined })).toBeNull();
  });

  it("returns null when the verify token is missing (cannot verify webhook)", () => {
    expect(resolveCloudConfig({ ...full, WHATSAPP_VERIFY_TOKEN: undefined })).toBeNull();
  });

  it("returns null when the app secret is missing (cannot check signatures)", () => {
    expect(resolveCloudConfig({ ...full, WHATSAPP_APP_SECRET: undefined })).toBeNull();
  });
});
