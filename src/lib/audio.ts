import { spawn } from "node:child_process";
import type { AudioBytes } from "./speech/types";

/**
 * Audio transcoding for the WhatsApp voice-note path.
 *
 * WhatsApp only renders a message as a playable voice-note bubble when it is
 * OGG with the Opus codec. Send an MP3 or a WAV and it still arrives, but as a
 * file attachment the member has to download — which defeats the entire point
 * of replying in voice. So every TTS output funnels through here regardless of
 * what the engine returned.
 */

/** WhatsApp caps voice notes at 16MB; we stay well under and fail loudly past it. */
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

/** A stuck ffmpeg must not pin a request open forever. */
const TRANSCODE_TIMEOUT_MS = 30_000;

export class FfmpegMissingError extends Error {
  constructor() {
    super("ffmpeg not found on PATH — voice replies need it to produce OGG/Opus");
    this.name = "FfmpegMissingError";
  }
}

/**
 * Transcode arbitrary audio to mono 48kHz OGG/Opus.
 *
 * Mono and 48kHz because that is what WhatsApp voice notes are; leaving a
 * stereo 44.1kHz stream through works on some clients and renders as a plain
 * file on others, which is the kind of bug that only shows up on the one phone
 * you cannot reproduce on.
 */
export async function toWhatsAppVoice(input: AudioBytes): Promise<AudioBytes> {
  // `-i pipe:0` reads stdin, `pipe:1` writes stdout — no temp files, so
  // concurrent replies can't collide on a shared path.
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-i", "pipe:0",
    "-vn",
    "-map_metadata", "-1",
    "-ac", "1",
    "-ar", "48000",
    "-c:a", "libopus",
    "-b:a", "32k",       // ample for speech; keeps notes small on rural connections
    "-application", "voip",
    "-f", "ogg",
    "pipe:1",
  ];

  return new Promise<AudioBytes>((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    const chunks: Buffer[] = [];
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() => reject(new Error("ffmpeg timed out transcoding voice reply")));
    }, TRANSCODE_TIMEOUT_MS);

    proc.on("error", (err: NodeJS.ErrnoException) => {
      finish(() => reject(err.code === "ENOENT" ? new FfmpegMissingError() : err));
    });
    proc.stderr.on("data", (d) => {
      stderr += String(d);
    });
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));

    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 200)}`));
        }
        const out = Buffer.concat(chunks);
        if (out.byteLength === 0) return reject(new Error("ffmpeg produced no audio"));
        if (out.byteLength > MAX_OUTPUT_BYTES) {
          return reject(new Error(`voice reply too large (${out.byteLength} bytes)`));
        }
        resolve({ bytes: new Uint8Array(out), mimeType: "audio/ogg" });
      });
    });

    // EPIPE here means ffmpeg died before consuming the input; the close/error
    // handlers already own that failure, so swallow it rather than emitting an
    // unhandled error that would crash the process.
    proc.stdin.on("error", () => {});
    proc.stdin.end(Buffer.from(input.bytes));
  });
}
