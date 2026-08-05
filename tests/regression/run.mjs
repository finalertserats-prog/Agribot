#!/usr/bin/env node
/**
 * Answer-quality regression suite.
 *
 * Deliberately NOT a vitest test: every case costs a real model call, so this
 * runs on demand (`npm run regression`) before a model, prompt or persona
 * change ships — not on every unit-test run.
 *
 * Cases are HARVESTED from real member conversations the bot got wrong. That
 * is the whole point: the suite encodes what actual CTG growers caught, so a
 * regression is measured against real expectations rather than invented ones.
 *
 * Usage:
 *   node tests/regression/run.mjs                 # uses the deployed config
 *   node tests/regression/run.mjs --model gpt-4.1 # compare a candidate model
 *   node tests/regression/run.mjs --json          # machine-readable output
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

// Load .env without adding a dependency — this script runs on the VPS too.
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const modelArg = args.indexOf("--model");
const samplesArg = args.indexOf("--samples");
/**
 * Model answers are stochastic, so a single sample makes borderline cases
 * flip between runs — which is worse than no gate, because a spurious FAIL
 * trains you to ignore the suite. Sample N times and fail only on a MAJORITY,
 * so one unlucky generation cannot condemn a healthy config (and one lucky
 * one cannot excuse a broken one).
 */
const SAMPLES = samplesArg >= 0 ? Math.max(1, +args[samplesArg + 1]) : 3;
const MODEL = modelArg >= 0 ? args[modelArg + 1] : process.env.OPENAI_TEXT_MODEL || "gpt-5";
const EFFORT = process.env.OPENAI_REASONING_EFFORT;
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY not found — run from the app directory with a populated .env");
  process.exit(2);
}

// Use the real persona prompt so the suite tests what members actually get.
const { getDefaultPersona } = await import(path.join(root, "dist/config/personas.js"));
const SYSTEM = getDefaultPersona().systemPrompt;

const { cases } = JSON.parse(fs.readFileSync(path.join(here, "cases.json"), "utf8"));

async function ask(c) {
  const messages = [
    { role: "system", content: SYSTEM },
    ...(c.history || []),
    { role: "user", content: c.question },
  ];
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      // Only reasoning models accept this; a plain model 400s on the key.
      ...(EFFORT && /^(gpt-5|o[1-9])/.test(MODEL) ? { reasoning_effort: EFFORT } : {}),
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`);
  return j.choices?.[0]?.message?.content || "";
}

/**
 * Semantic grading by a strong model.
 *
 * Deterministic keyword rules alone proved insufficient here, and the failure
 * that exposed it is instructive: gpt-4o-mini invented "HRMN (Himachal Research
 * Minikit)" — a fabricated but entirely plausible-looking acronym expansion.
 * No forbidden-phrase list catches an invention you didn't predict, so the
 * keyword rules now only cover the known-literal traps and the judge carries
 * the semantic verdict.
 */
const JUDGE_MODEL = process.env.REGRESSION_JUDGE_MODEL || "gpt-5";

async function judge(c, answer) {
  if (!c.rubric?.length || !answer) return [];
  const prompt =
    `You are grading an answer given by a gardening expert bot to an experienced grower.\n\n` +
    `QUESTION:\n${c.question}\n\nANSWER:\n${answer}\n\n` +
    `Check the answer against EACH requirement:\n` +
    c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n") +
    `\n\nBe strict. Inventing a plausible-sounding fact, acronym expansion or attribution is ` +
    `always a violation, even when the rest of the answer is good.\n` +
    `Reply with ONLY JSON: {"violations":["<which requirement failed and how>", ...]}. ` +
    `Empty array if every requirement is met.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) return [`judge unavailable (HTTP ${res.status}) — treat this case as unverified`];
  const j = await res.json();
  try {
    return JSON.parse(j.choices?.[0]?.message?.content || "{}").violations || [];
  } catch {
    return ["judge returned unparseable output"];
  }
}

/** Literal traps only — the judge owns everything semantic. */
function grade(c, answer) {
  const failures = [];
  const lower = answer.toLowerCase();

  for (const pat of c.mustNotMatch || []) {
    const re = new RegExp(pat.replace(/^\(\?i\)/, ""), pat.startsWith("(?i)") ? "i" : "");
    if (re.test(answer)) failures.push(`said something it must not: /${pat}/`);
  }
  // "Any" groups: at least one term from each group must appear.
  for (const key of Object.keys(c)) {
    if (!key.startsWith("mustMentionAny")) continue;
    const group = c[key];
    if (!group.some((t) => lower.includes(t.toLowerCase()))) {
      failures.push(`mentioned none of [${group.join(", ")}]`);
    }
  }
  for (const t of c.mustMentionAll || []) {
    if (!lower.includes(t.toLowerCase())) failures.push(`did not mention "${t}"`);
  }
  if (c.minWords && answer.split(/\s+/).filter(Boolean).length < c.minWords) {
    failures.push(`too short (< ${c.minWords} words) — a thin answer for an expert grower`);
  }
  return failures;
}

/** One independent sample: generate an answer, then grade it. */
async function runSample(c) {
  try {
    const answer = await ask(c);
    return { failures: [...grade(c, answer), ...(await judge(c, answer))], answer };
  } catch (e) {
    return { failures: [`request failed: ${e.message}`], answer: "" };
  }
}

const results = [];
for (const c of cases) {
  const started = Date.now();
  // Samples run concurrently — sequential sampling would triple an already
  // slow suite and nobody would run it before shipping.
  const samples = await Promise.all(Array.from({ length: SAMPLES }, () => runSample(c)));
  const failed = samples.filter((s) => s.failures.length > 0);
  const pass = failed.length <= Math.floor(SAMPLES / 2);
  results.push({
    id: c.id,
    source: c.source,
    pass,
    samples: SAMPLES,
    failedSamples: failed.length,
    // Report the failing sample — that is the one worth reading.
    failures: failed[0]?.failures || [],
    seconds: +((Date.now() - started) / 1000).toFixed(1),
    answer: (failed[0] || samples[0]).answer,
  });
}

const passed = results.filter((r) => r.pass).length;

if (asJson) {
  console.log(
    JSON.stringify({ model: MODEL, effort: EFFORT, samples: SAMPLES, passed, total: results.length, results }, null, 2)
  );
} else {
  console.log(
    `\nAnswer-quality regression — model=${MODEL}${EFFORT ? ` effort=${EFFORT}` : ""}` +
      `, ${SAMPLES} sample(s)/case, majority rule\n`
  );
  for (const r of results) {
    const tally = `${r.samples - r.failedSamples}/${r.samples} samples clean`;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  (${r.seconds}s, ${tally})   [${r.source}]`);
    // Show the failing sample even when the majority passed — a flaky case is
    // a genuine early warning, just not a build-breaking one.
    for (const f of r.failures) console.log(`      ${r.pass ? "~" : "-"} ${f}`);
    if (!r.pass) console.log(`      answer: ${r.answer.replace(/\s+/g, " ").slice(0, 240)}...`);
  }
  console.log(`\n${passed}/${results.length} passed\n`);
}

process.exit(passed === results.length ? 0 : 1);
