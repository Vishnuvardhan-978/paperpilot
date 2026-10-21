/**
 * Provider-layer test with no real AI keys:
 *  - starts a fake OpenAI-compatible model (port 8790),
 *  - starts `next start` on port 3100 with a test config:
 *      app providers  = PaperPilot server (this same app, /api/v1) → custom (the fake model)
 *      server upstream = custom (the fake model)
 *  - checks the coding agent tool loop, chat, PaperPilot keys, daily limits and fallback.
 *
 *   npm run build && node scripts/e2e-ai.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const FAKE_PORT = 8790;
const APP_PORT = 3100;
const APP = `http://127.0.0.1:${APP_PORT}`;
const SERVER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pp-server-"));
const results = [];
const seen = [];

/* ---------- fake model ---------- */

function sse(res, chunks) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end("data: [DONE]\n\n");
}
const delta = (d) => ({ choices: [{ index: 0, delta: d }] });

const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "whisper-large" }, { id: "fake-coder" }] }));
    }
    const body = JSON.parse(raw || "{}");
    seen.push({ model: body.model, auth: req.headers.authorization, roles: body.messages.map((m) => m.role) });
    const last = body.messages[body.messages.length - 1];
    if (last.role === "tool") {
      const asked = body.messages.findLast((m) => m.role === "assistant" && m.tool_calls)?.tool_calls?.[0]?.id;
      const reply = asked === last.tool_call_id ? `Read ${last.content.length} chars; ids match.` : `ID MISMATCH ${asked} vs ${last.tool_call_id}`;
      return sse(res, [delta({ content: reply.slice(0, 8) }), delta({ content: reply.slice(8) }), { choices: [], usage: { prompt_tokens: 40, completion_tokens: 9 } }]);
    }
    if (body.tools?.length && /read/i.test(JSON.stringify(last.content))) {
      return sse(res, [
        delta({ reasoning: "I should open the file first." }),
        delta({ tool_calls: [{ index: 0, id: "call_fake_1", type: "function", function: { name: "read_file", arguments: '{"path":"WebC' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'ontent/js/cart.js"}' } }] }),
      ]);
    }
    return sse(res, [delta({ content: "Hello " }), delta({ content: "from the fake model." }), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } }]);
  });
});

/* ---------- helpers ---------- */

async function test(name, fn) {
  try {
    const note = await fn();
    results.push(true);
    console.log(`PASS ${name}${note ? ` — ${note}` : ""}`);
  } catch (e) {
    results.push(false);
    console.log(`FAIL ${name} — ${e.message}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

function keys(...args) {
  return execFileSync(process.execPath, ["scripts/pp-keys.mjs", ...args], { env: { ...process.env, PAPERPILOT_SERVER_DIR: SERVER_DIR }, encoding: "utf8" });
}

async function agentStep(turns = [], model = null) {
  const res = await fetch(`${APP}/api/agent/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Please read cart.js and summarise it", project: { name: "demo", paths: ["WebContent/js/cart.js"] }, turns, model }),
  });
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const err = events.find((e) => e.type === "error");
  if (err) throw new Error(`agent error: ${err.error}`);
  return { events, result: events.find((e) => e.type === "result") };
}

async function v1(body, key) {
  return fetch(`${APP}/api/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} did not start`);
}

/* ---------- run ---------- */

await new Promise((r) => fake.listen(FAKE_PORT, "127.0.0.1", r));
const appKey = /pp_test_\w+/.exec(keys("create", "app under test", "--daily", "3", "--test"))[0];
const spareKey = /pp_test_\w+/.exec(keys("create", "to be disabled", "--test"))[0];
const spareId = /key_\w+/.exec(keys("list").split("\n").find((l) => l.includes("to be disabled")))[0];

const env = {
  ...process.env,
  PORT: String(APP_PORT),
  HOSTNAME: "127.0.0.1",
  AI_PROVIDERS: "paperpilot,custom",
  PAPERPILOT_AI_URL: `${APP}/api/v1`,
  PAPERPILOT_AI_KEY: appKey,
  OPENAI_COMPAT_BASE_URL: `http://127.0.0.1:${FAKE_PORT}/v1`,
  OPENAI_COMPAT_API_KEY: "fake-upstream-key",
  OPENAI_COMPAT_LABEL: "Fake model",
  PAPERPILOT_SERVER_DIR: SERVER_DIR,
  GEMINI_API_KEY: "",
};
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
next.stdout.on("data", (d) => (serverLog += d));
next.stderr.on("data", (d) => (serverLog += d));

try {
  await waitFor(`${APP}/api/v1/models`, 60_000);

  await test("Server rejects a missing key", async () => {
    const r = await v1({ messages: [{ role: "user", content: "hi" }] });
    expect(r.status === 401, `status ${r.status}`);
  });

  await test("Server rejects a made-up key", async () => {
    const r = await v1({ messages: [{ role: "user", content: "hi" }] }, "pp_live_notarealkeynotarealkey1234");
    expect(r.status === 401, `status ${r.status}`);
  });

  await test("Server rejects a disabled key", async () => {
    keys("disable", spareId);
    await new Promise((r) => setTimeout(r, 5_500));
    const r = await v1({ messages: [{ role: "user", content: "hi" }] }, spareKey);
    expect(r.status === 403, `status ${r.status}`);
  });

  await test("Coding agent step 1: tool call arrives through the PaperPilot server", async () => {
    const { events, result } = await agentStep();
    expect(result, "no result");
    expect(result.model === "paperpilot:auto", `served by ${result.model}`);
    const call = result.calls[0];
    expect(call?.name === "read_file" && call.args.path === "WebContent/js/cart.js", `call ${JSON.stringify(call)}`);
    expect(call.id === "call_fake_1", `id ${call.id}`);
    expect(events.some((e) => e.type === "thought"), "thinking not streamed");
    globalThis.step1 = result;
    return `read_file(${call.args.path}), thinking streamed`;
  });

  await test("Coding agent step 2: tool result goes back with the matching id", async () => {
    const s1 = globalThis.step1;
    const turns = [
      s1.modelContent,
      { role: "user", parts: [{ functionResponse: { id: s1.calls[0].id, name: "read_file", response: { output: "function calcTotal(items) { return 1; }" } } }] },
    ];
    const { result } = await agentStep(turns, s1.model);
    expect(/ids match/.test(result.text), result.text);
    expect(result.calls.length === 0, "unexpected extra tool call");
    return result.text;
  });

  await test("Chat (Ask) streams through the provider chain", async () => {
    const r = await fetch(`${APP}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Say hello", scope: "open" }),
    });
    const text = (await r.text()).match(/"text":"([^"]*)"/g)?.map((m) => JSON.parse(`{${m}}`).text).join("") || "";
    expect(text === "Hello from the fake model.", `got "${text}"`);
    return text;
  });

  await test("Daily limit: 4th request on a 3/day key is refused", async () => {
    const r = await v1({ messages: [{ role: "user", content: "hi" }], stream: true }, appKey);
    expect(r.status === 429, `status ${r.status}`);
    expect(Number(r.headers.get("retry-after")) > 0, "no Retry-After");
    return (await r.json()).error.message;
  });

  await test("Fallback: app moves to the next provider when the server key is used up", async () => {
    const { result } = await agentStep();
    expect(result.model === "custom:fake-coder", `served by ${result.model}`);
    return `served by ${result.model} (model found via /models, skipping whisper)`;
  });

  await test("Usage is recorded per key (requests and tokens)", async () => {
    await new Promise((r) => setTimeout(r, 2_500));
    const out = keys("usage");
    const line = out.split("\n").find((l) => l.includes("app under test")) || "";
    expect(/\b3\/3 req/.test(line), line.trim());
    expect(/[1-9]\d* in \/ [1-9]\d* out/.test(line), `no tokens: ${line.trim()}`);
    return line.trim().replace(/\s+/g, " ");
  });

  await test("Upstream got the server's own key, never the user's PaperPilot key", async () => {
    expect(seen.length > 0, "fake model never called");
    expect(seen.every((s) => s.auth === "Bearer fake-upstream-key"), JSON.stringify(seen.map((s) => s.auth)));
  });
} finally {
  next.kill();
  fake.close();
  fs.rmSync(SERVER_DIR, { recursive: true, force: true });
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) console.log(`\n--- server log ---\n${serverLog.slice(-3000)}`);
process.exit(passed === results.length ? 0 : 1);
