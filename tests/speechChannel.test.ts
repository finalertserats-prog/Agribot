import { describe, it, expect } from "vitest";
import { requestedVoiceReply, shouldSendVoiceReply } from "../src/lib/speech/channel";

describe("requestedVoiceReply — reading the member's channel preference", () => {
  it("detects a Telugu-English request for audio", () => {
    expect(requestedVoiceReply("voice lo cheppandi andi")).toBe(true);
    expect(requestedVoiceReply("audio lo pampandi")).toBe(true);
    expect(requestedVoiceReply("voice note kavali")).toBe(true);
  });

  it("detects an English request for audio", () => {
    expect(requestedVoiceReply("please send a voice reply")).toBe(true);
  });

  it("detects a Telugu-script request", () => {
    expect(requestedVoiceReply("వాయిస్ లో చెప్పండి")).toBe(true);
  });

  it("detects a request for text only", () => {
    expect(requestedVoiceReply("text lo chalu andi")).toBe(false);
    expect(requestedVoiceReply("voice vaddu")).toBe(false);
    expect(requestedVoiceReply("no voice please")).toBe(false);
    expect(requestedVoiceReply("don't send voice")).toBe(false);
  });

  // "voice vaddu" carries a channel word; refusal must be checked first or it
  // reads as a request for the very thing being declined.
  it("reads a refusal as a refusal, not a request", () => {
    expect(requestedVoiceReply("voice vaddu, text lo pampandi")).toBe(false);
  });

  it("says nothing when the member expressed no preference", () => {
    expect(requestedVoiceReply("tomato lo leaf miner undi, em cheyyali?")).toBeUndefined();
    expect(requestedVoiceReply("")).toBeUndefined();
  });

  // \bvoice\b cannot match inside "invoice" — there is no boundary before "v".
  it("does not fire on an unrelated word that merely contains 'voice'", () => {
    expect(requestedVoiceReply("nursery invoice ivvandi")).toBeUndefined();
  });

  it("needs a request word, not just the channel word", () => {
    expect(requestedVoiceReply("my plant leaves look like audio cables")).toBeUndefined();
  });
});

describe("shouldSendVoiceReply — explicit ask beats the default", () => {
  it("mirrors the channel the member used when they said nothing", () => {
    expect(shouldSendVoiceReply("leaf miner undi", true)).toBe(true);
    expect(shouldSendVoiceReply("leaf miner undi", false)).toBe(false);
  });

  it("speaks when a typed message asks for voice", () => {
    expect(shouldSendVoiceReply("voice lo cheppandi", false)).toBe(true);
  });

  it("stays silent when a voice note asks for a text-only answer", () => {
    expect(shouldSendVoiceReply("text lo matrame pampandi", true)).toBe(false);
  });
});

/**
 * Proximity, not co-occurrence. "lo" (Telugu "in") and "send" are everyday
 * words — requiring only that both appear somewhere in the message turns
 * ordinary sentences into requests for audio.
 */
describe("requestedVoiceReply — resists false positives from common words", () => {
  it("ignores a message where the channel word and a request word are unrelated", () => {
    expect(
      requestedVoiceReply("voice problem undi, tomato lo emi cheyyali andi?")
    ).toBeUndefined();
  });

  it("ignores 'audio' mentioned far from any request word", () => {
    expect(
      requestedVoiceReply("audio recorder pakkana pettanu, mari tomato lo purugu undi")
    ).toBeUndefined();
  });

  it("still fires when the words genuinely sit together", () => {
    expect(requestedVoiceReply("andi voice lo cheppandi please")).toBe(true);
    expect(requestedVoiceReply("send voice")).toBe(true);
  });
});
