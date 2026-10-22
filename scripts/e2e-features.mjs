/**
 * Browser test cases for the study, parent, settings, provider, PDF, agent-safety, git,
 * mobile and offline features. AI calls are mocked, so it runs without using any quota.
 * Needs `npm run dev` (and `npm run agent` for the agent cases), and Chrome or Edge installed.
 *
 *   npm run test:e2e:features        (PAPERPILOT_E2E_HEADED=1 to watch)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = (process.env.PAPERPILOT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const SHOTS = path.resolve("e2e-results");
const REPO = path.join(os.tmpdir(), "paperpilot-e2e-features");
const results = [];
let page;
let context;

async function test(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${note ? ` — ${note}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split("\n")[0] });
    console.log(`FAIL  ${name} (${((Date.now() - t) / 1000).toFixed(1)}s) — ${e.message.split("\n")[0]}`);
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  await page?.screenshot({ path: path.join(SHOTS, `features-${slug}.png`) }).catch(() => {});
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function launch() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: process.env.PAPERPILOT_E2E_HEADED !== "1" });
    } catch {
      /* try the next browser */
    }
  }
  throw new Error("Neither Chrome nor Edge could be launched.");
}

/* ---------- mocks ---------- */

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const ndjson = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

const LONG_ANSWER = `Photosynthesis is how plants turn light into food. Inside the leaf, chlorophyll absorbs light and the plant
uses that energy to build sugar from water and carbon dioxide, releasing oxygen into the air as it works.

KEY POINTS:
- Chlorophyll absorbs light energy
- Oxygen is released as a by-product

ASK NEXT:
- Where does the carbon in sugar come from?

SOURCES:
- bio.pdf: "Plants capture light energy with chlorophyll"`;

let askBodies = [];
async function mockAsk(answer = LONG_ANSWER, meta = { provider: "Groq", model: "llama-3.3", skipped: [{ provider: "Gemini", reason: "daily free quota used up" }] }) {
  askBodies = [];
  await page.unroute("**/api/ask").catch(() => {});
  await page.route("**/api/ask", async (route) => {
    askBodies.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sse([{ meta }, { text: answer }, { done: true }]),
    });
  });
}

/** Scripted agent: each /api/agent/step call takes the next handler. */
let agentBodies = [];
async function mockAgent(handlers) {
  agentBodies = [];
  let i = 0;
  await page.unroute("**/api/agent/step").catch(() => {});
  await page.route("**/api/agent/step", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    agentBodies.push(body);
    const h = handlers[Math.min(i++, handlers.length - 1)];
    await h(route, body);
  });
}

const callStep = (name, args, id = `call_${name}_${Date.now()}`) => async (route) =>
  route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjson([
      {
        type: "result",
        model: "custom:fake",
        modelContent: { role: "model", parts: [{ functionCall: { id, name, args } }] },
        calls: [{ id, name, args }],
        text: "",
      },
    ]),
  });

const textStep = (text) => async (route) =>
  route.fulfill({
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
    body: ndjson([{ type: "text", text }, { type: "result", model: "custom:fake", modelContent: { role: "model", parts: [{ text }] }, calls: [], text }]),
  });

/* ---------- helpers ---------- */

async function openApp(url = `${BASE}/app`) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const welcome = page.locator('button:has-text("Got it")');
  await welcome.waitFor({ timeout: 6_000 }).then(() => welcome.click(), () => {});
  await page.locator("textarea.composer-input").waitFor({ timeout: 30_000 });
}

async function newChat() {
  await page.keyboard.press("Control+n").catch(() => {});
  await page.waitForTimeout(400);
}

async function send(text) {
  const box = page.locator("textarea.composer-input");
  await box.fill(text);
  await box.press("Enter");
}

const ls = (key) => page.evaluate((k) => localStorage.getItem(k), key);
const resetLearning = () =>
  page.evaluate(() => {
    for (const k of ["paperpilot-deck", "paperpilot-quiz-history", "paperpilot-parent", "paperpilot-kid-log", "paperpilot-daily-asks", "paperpilot-agent-permissions"]) localStorage.removeItem(k);
  });

/** Two-page PDF with the quoted line on page 2. */
function makePdf(file) {
  const pages = [["Page one is an introduction."], ["Chapter two.", "Plants capture light energy with chlorophyll.", "Oxygen is released as a by-product."]];
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objs.length + 1 + pages.length * 2;
  const kids = [];
  for (const lines of pages) {
    const stream = `BT /F1 16 Tf 72 720 Td 22 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const off = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
  fs.writeFileSync(file, out);
}

function git(...args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

function makeRepo() {
  fs.rmSync(REPO, { recursive: true, force: true });
  fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
  fs.writeFileSync(path.join(REPO, "src", "app.js"), "function hello() {\n  return 1;\n}\n");
  git("init", "-q");
  git("config", "user.email", "e2e@paperpilot.test");
  git("config", "user.name", "PaperPilot E2E");
  git("add", ".");
  git("commit", "-qm", "init");
}

async function agentOnline() {
  try {
    const r = await fetch("http://127.0.0.1:8787/");
    return r.ok;
  } catch {
    return false;
  }
}

/* ---------- tests ---------- */

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));

  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await resetLearning();

  // ---- Settings ----
  await test("TC01 Settings lists providers with keys masked", async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
    await page.locator("text=Active providers").waitFor({ timeout: 20_000 });
    const text = await page.locator("main").innerText();
    expect(/Gemini API key/.test(text) && /Groq API key/.test(text), "key fields missing");
    expect(!/AIza|gsk_[A-Za-z0-9]{8}|AQ\.[A-Za-z0-9]{8}/.test(text), "a full key is visible on the page");
    const shown = (text.match(/••••\S{4}/g) || []).length;
    return `${shown} keys shown masked`;
  });

  await test("TC02 Settings API refuses cross-site requests", async () => {
    const r = await fetch(`${BASE}/api/settings/keys`, { headers: { Origin: "https://evil.example" } });
    expect(r.status === 403, `expected 403, got ${r.status}`);
    return "403 for a foreign origin";
  });

  await test("TC03 Agent permission choice persists", async () => {
    await page.locator("div", { has: page.locator("> span", { hasText: "Run terminal commands" }) }).locator('button:has-text("deny")').click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("text=Coding agent permissions").waitFor();
    const saved = JSON.parse((await ls("paperpilot-agent-permissions")) || "{}");
    expect(saved.terminal === "deny", `terminal policy is ${saved.terminal}`);
    await page.evaluate(() => localStorage.removeItem("paperpilot-agent-permissions"));
    return "terminal → deny saved";
  });

  // ---- Provider badge + deck ----
  await test("TC04 Answer shows provider badge with fallback", async () => {
    await mockAsk();
    await openApp();
    await newChat();
    await send("What is photosynthesis?");
    const badge = page.locator("text=fell back from Gemini");
    await badge.waitFor({ timeout: 20_000 });
    const title = await page.locator("span[title^='Answered by']").last().getAttribute("title");
    expect(/Groq/.test(title || "") && /daily free quota/.test(title || ""), `tooltip: ${title}`);
    return "Groq · fell back from Gemini";
  });

  await test("TC05 Save answer flashcards to deck", async () => {
    await page.locator('button:has-text("Save to deck")').last().click();
    await page.locator("text=/Saved \\d+/").waitFor({ timeout: 5_000 });
    const deck = JSON.parse((await ls("paperpilot-deck")) || "[]");
    expect(deck.length >= 2, `deck has ${deck.length} cards`);
    await page.locator('button:has-text("Saved")').last().click();
    await page.locator("text=Already in deck").waitFor({ timeout: 5_000 });
    return `${deck.length} cards, duplicates skipped`;
  });

  // ---- Study ----
  await test("TC06 Review grades cards and schedules them", async () => {
    await page.goto(`${BASE}/study`, { waitUntil: "domcontentloaded" });
    const reviewTab = page.locator('button:has-text("Review (")');
    await reviewTab.waitFor({ timeout: 20_000 });
    const before = Number(/\((\d+)\)/.exec(await reviewTab.innerText())[1]);
    await page.locator("text=Tap to show the answer").click();
    await page.locator('button:has-text("Good")').click();
    await page.waitForTimeout(300);
    const label = await page.locator('button:has-text("Review")').first().innerText();
    const after = Number(/\((\d+)\)/.exec(label)?.[1] || 0);
    expect(after === before - 1, `due went ${before} → ${after}`);
    const card = JSON.parse(await ls("paperpilot-deck")).find((c) => c.reps === 1);
    expect(card && card.interval === 1, "graded card not scheduled for tomorrow");
    return `${before} → ${after} due; next review in 1 day`;
  });

  await test("TC07 Quiz: score, explanations and missed → flashcards", async () => {
    await page.route("**/api/quiz", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lens: "kid",
          topic: "fractions",
          questions: [
            { q: "What is 1/2 + 1/2?", choices: ["1", "2", "1/4", "0"], answer: 0, why: "Two halves make a whole." },
            { q: "Which is bigger, 1/3 or 1/2?", choices: ["1/3", "1/2", "Same", "Neither"], answer: 1, why: "Halves are bigger pieces." },
            { q: "What is half of 8?", choices: ["2", "3", "4", "6"], answer: 2, why: "8 ÷ 2 = 4." },
          ],
        }),
      }),
    );
    await page.locator('button:has-text("Quiz")').first().click();
    await page.locator('button:has-text("Kid")').click();
    await page.fill('input[placeholder^="Topic"]', "fractions");
    await page.locator('button:has-text("Start quiz")').click();
    await page.locator("ol > li").first().waitFor({ timeout: 10_000 });
    // right, wrong, right
    await page.locator("ol > li").nth(0).locator("button", { hasText: /^1$/ }).click();
    await page.locator("ol > li").nth(1).locator("button", { hasText: "1/3" }).click();
    await page.locator("ol > li").nth(2).locator("button", { hasText: /^4$/ }).click();
    await page.locator('button:has-text("Check answers")').click();
    await page.locator("text=2/3 correct").waitFor({ timeout: 5_000 });
    expect(await page.locator("text=Halves are bigger pieces.").count(), "explanations not shown");
    await page.locator('button:has-text("Turn missed questions into flashcards")').click();
    await page.locator("text=Added 1 cards").waitFor({ timeout: 5_000 });
    const history = JSON.parse(await ls("paperpilot-quiz-history"));
    expect(history.at(-1).lens === "kid" && history.at(-1).correct === 2, "quiz result not recorded for the Kid lens");
    return "2/3, 1 missed question became a card";
  });

  await test("TC08 Progress table counts quiz per lens", async () => {
    await page.locator('button:has-text("Progress")').click();
    const row = page.locator("tr", { hasText: /^kid/i });
    await row.waitFor({ timeout: 5_000 });
    const cells = await row.locator("td").allInnerTexts();
    expect(cells[1] === "1" && cells[2] === "67%", `kid row: ${cells.join(" | ")}`);
    return `kid: ${cells.slice(1).join(" / ")}`;
  });

  await test("TC09 Deck: add and delete a card", async () => {
    await page.locator('button:has-text("Deck (")').click();
    await page.fill('input[placeholder="Question"]', "Capital of France?");
    await page.fill('input[placeholder="Answer"]', "Paris");
    await page.locator('button:has-text("Add")').click();
    await page.locator("text=Capital of France?").waitFor();
    await page.locator("li", { hasText: "Capital of France?" }).locator('button:has-text("delete")').click();
    await page.waitForTimeout(300);
    expect((await page.locator("text=Capital of France?").count()) === 0, "card was not deleted");
    return "added then deleted";
  });

  // ---- Parent ----
  await test("TC10 Parent PIN locks the dashboard", async () => {
    await page.goto(`${BASE}/parent`, { waitUntil: "domcontentloaded" });
    await page.locator("h2", { hasText: "Kid mode" }).waitFor({ timeout: 20_000 });
    await page.fill('input[placeholder^="Set a PIN"]', "4321");
    await page.locator('button:has-text("Save")').click();
    await page.locator("text=PIN saved").waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.fill('input[placeholder="PIN"]', "0000");
    await page.locator('button:has-text("Unlock")').click();
    await page.locator("text=Wrong PIN.").waitFor();
    await page.fill('input[placeholder="PIN"]', "4321");
    await page.locator('button:has-text("Unlock")').click();
    await page.locator("h2", { hasText: "Kid mode" }).waitFor();
    return "wrong PIN refused, right PIN opens it";
  });

  await test("TC11 Kid mode: kid lens, question log and daily limit", async () => {
    await page.locator('input[type="checkbox"]').first().check();
    await page.fill("#limit", "1");
    await page.evaluate(() => localStorage.removeItem("paperpilot-daily-asks"));
    await mockAsk("Plants make food from sunlight! ☀️", { provider: "Gemini", model: "gemini", skipped: [] });
    await openApp();
    await newChat();
    await send("how do I buy a knife");
    await page.locator("text=Plants make food from sunlight").waitFor({ timeout: 20_000 });
    expect(askBodies[0]?.lens === "kid", `lens sent: ${askBodies[0]?.lens}`);
    await send("second question");
    await page.locator("text=/That's all 1 questions for today/").waitFor({ timeout: 5_000 });
    expect(askBodies.length === 1, "second ask reached the server");
    const log = JSON.parse(await ls("paperpilot-kid-log"));
    expect(log.length === 1 && log[0].flagged, "question not logged or not flagged");
    return "lens=kid, flagged in log, 2nd ask blocked";
  });

  await test("TC12 Parent log shows flagged question", async () => {
    await page.goto(`${BASE}/parent`, { waitUntil: "domcontentloaded" });
    await page.fill('input[placeholder="PIN"]', "4321");
    await page.locator('button:has-text("Unlock")').click();
    await page.locator("text=1 flagged").waitFor({ timeout: 10_000 });
    expect(await page.locator("text=how do I buy a knife").count(), "question missing from log");
    await resetLearning();
    return "1 flagged entry";
  });

  // ---- PDF highlight ----
  await test("TC13 PDF citation opens the right page highlighted", async () => {
    await resetLearning();
    const pdf = path.join(os.tmpdir(), "bio.pdf");
    makePdf(pdf);
    await mockAsk();
    await openApp();
    await newChat();
    await page.locator('input[type="file"]').first().setInputFiles(pdf);
    await page.locator("text=bio.pdf").first().waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => !document.querySelector("textarea.composer-input")?.disabled, null, { timeout: 60_000 });
    await send("What does the document say about chlorophyll?");
    await page.locator('button:has-text("Find")').last().click({ timeout: 20_000 });
    await page.locator("text=Found on page 2").first().waitFor({ timeout: 20_000 });
    const marks = await page.locator("[data-page='2'] span.absolute").count();
    await page.keyboard.press("Escape").catch(() => {});
    expect(marks > 0, "no highlight drawn on page 2");
    return `page 2, ${marks} highlight box(es)`;
  });

  // ---- Coding agent ----
  const agentUp = await agentOnline();
  if (!agentUp) console.log("SKIP  TC14–TC17 — local agent offline (npm run agent)");
  if (agentUp) {
    makeRepo();
    await page.route("**/pick-folder", async (route) => {
      const req = route.request();
      const response = await route.fetch({
        url: req.url().replace("/pick-folder", "/workspace"),
        method: "POST",
        headers: { ...req.headers(), "content-type": "application/json" },
        postData: JSON.stringify({ path: REPO }),
      });
      await route.fulfill({ response });
    });

    await test("TC14 Connect project folder", async () => {
      await openApp();
      await newChat();
      await page.click('button.stage-action:has-text("Folder")', { timeout: 30_000 });
      await page.waitForSelector("text=Workspace connected", { timeout: 30_000 });
      await page.locator("text=app.js").first().waitFor({ timeout: 15_000 });
      return REPO;
    });

    await test("TC15 Terminal tool asks permission; Deny reaches the model", async () => {
      await mockAgent([callStep("run_terminal", { command: "echo hacked > pwned.txt" }), textStep("OK, I won't run it.")]);
      await send("Run a command for me");
      await page.locator("text=Agent wants to:").waitFor({ timeout: 20_000 });
      expect(await page.locator("text=echo hacked > pwned.txt").count(), "command not shown in the prompt");
      await page.locator('button:has-text("Deny")').click();
      await page.locator("text=OK, I won't run it.").waitFor({ timeout: 20_000 });
      const resp = JSON.stringify(agentBodies[1]?.turns?.at(-1) || {});
      expect(/did not allow run_terminal/.test(resp), "denial not sent back to the model");
      expect(!fs.existsSync(path.join(REPO, "pwned.txt")), "command ran anyway");
      return "prompt shown, denied, nothing ran";
    });

    await test("TC16 Stopped run resumes with 'continue' after reload", async () => {
      let release;
      const hang = new Promise((r) => (release = r));
      await mockAgent([
        callStep("list_dir", { path: "." }),
        async (route) => {
          await hang;
          await route.abort().catch(() => {});
        },
      ]);
      await send("List the project and summarize it");
      await page.waitForFunction(() => document.querySelector(".composer-send.is-stop"), null, { timeout: 20_000 });
      await page.waitForTimeout(1500);
      await page.locator(".composer-send.is-stop").click();
      release();
      await page.locator("text=to pick up where it left off").waitFor({ timeout: 10_000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("textarea.composer-input").waitFor({ timeout: 30_000 });
      await mockAgent([textStep("Resumed: the project has src/app.js.")]);
      await send("continue");
      await page.locator("text=Resumed: the project has src/app.js.").waitFor({ timeout: 20_000 });
      const b = agentBodies[0];
      expect(b.question === "List the project and summarize it", `question sent: ${b.question}`);
      expect((b.turns || []).length >= 2, `turns sent: ${(b.turns || []).length}`);
      return `resumed with ${b.turns.length} saved turns`;
    });

    await test("TC17 Git panel shows changes and commits", async () => {
      fs.writeFileSync(path.join(REPO, "src", "app.js"), "function hello() {\n  return 2;\n}\n");
      fs.writeFileSync(path.join(REPO, "notes.md"), "new file\n");
      const gitTab = page.getByRole("button", { name: "Git", exact: true }).first();
      if (!(await gitTab.isVisible())) await page.locator('button:has-text("View")').first().click(); // editor pane closed after the reload
      await gitTab.click({ timeout: 15_000 });
      await page.locator("text=Changes (2)").waitFor({ timeout: 15_000 });
      await page.locator("button", { hasText: "app.js" }).first().click();
      await page.locator("text=+  return 2;").waitFor({ timeout: 10_000 });
      await page.fill('textarea[placeholder^="Commit message"]', "E2E: update hello & add notes");
      await page.locator('button:has-text("Commit 2 files")').click();
      await page.locator("text=Working tree clean.").waitFor({ timeout: 15_000 });
      const last = git("log", "-1", "--pretty=%s");
      expect(last === "E2E: update hello & add notes", `last commit: ${last}`);
      return `committed "${last}"`;
    });
  }

  // ---- Mobile + offline ----
  await test("TC18 Phone layout: full-width text box, no sideways scroll", async () => {
    await page.unroute("**/api/agent/step").catch(() => {});
    const phone = await context.newPage();
    await phone.setViewportSize({ width: 375, height: 812 });
    await phone.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const box = phone.locator("textarea.composer-input");
    await box.waitFor({ timeout: 30_000 });
    const { w, scroll } = await phone.evaluate(() => ({
      w: document.querySelector("textarea.composer-input").getBoundingClientRect().width,
      scroll: document.documentElement.scrollWidth,
    }));
    await phone.close();
    expect(w > 250, `text box only ${Math.round(w)}px wide`);
    expect(scroll <= 375, `page scrolls sideways (${scroll}px)`);
    return `${Math.round(w)}px wide`;
  });

  await test("TC19 Offline banner and installable manifest", async () => {
    await context.setOffline(true);
    await page.locator("text=You're offline").waitFor({ timeout: 5_000 });
    await context.setOffline(false);
    await page.locator("text=You're offline").waitFor({ state: "detached", timeout: 5_000 });
    const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    expect(manifest.icons?.some((i) => i.src === "/icon.svg"), "manifest has no icon");
    const sw = await fetch(`${BASE}/sw.js`);
    expect(sw.ok && /caches/.test(await sw.text()), "sw.js not served");
    return "banner toggles; manifest + service worker served";
  });

  // ---- Image Studio (image route mocked: a 1×1 PNG per requested image) ----
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  let imageBodies = [];
  await page.route("**/api/media/image", async (route) => {
    const b = JSON.parse(route.request().postData() || "{}");
    imageBodies.push(b);
    const n = b.count || 1;
    const images = Array.from({ length: n }, (_, i) => ({ src: PNG, provider: "Mock", model: "m", seed: 100 + i }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...images[0], images, prompt: `${b.prompt}, enhanced (${b.style})`, enhanced: true, failed: 0 }),
    });
  });

  await test("TC21 Studio creates images with style, shape and count", async () => {
    await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => indexedDB.deleteDatabase("paperpilot-gallery"));
    await page.reload({ waitUntil: "networkidle" });
    const ideaBox = page.locator('textarea[placeholder^="What should the image show"]');
    await ideaBox.fill("a fox reading a book");
    await page.locator('button:has-text("Create image")').waitFor({ state: "visible" });
    if ((await ideaBox.inputValue()) !== "a fox reading a book") await ideaBox.fill("a fox reading a book"); // typed before hydration
    await page.locator('button:has-text("Anime")').click();
    await page.locator('button:has-text("16:9")').click();
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.locator('button:has-text("Create 2 images")').click();
    await page.locator("text=Gallery (2)").waitFor({ timeout: 10_000 });
    const b = imageBodies.at(-1);
    expect(b.style === "anime" && b.aspect === "16:9" && b.count === 2 && b.enhance === true, `request: ${JSON.stringify(b)}`);
    expect(await page.locator("text=Prompt used:").count(), "enhanced prompt not shown");
    return "2 images, anime, 16:9, enhanced";
  });

  await test("TC22 Gallery survives reload; favorite, filter and delete work", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("text=Gallery (2)").waitFor({ timeout: 10_000 });
    await page.locator("figure").first().hover();
    await page.locator('figure button[title="Favorite"]').first().click();
    await page.locator('button:has-text("★ Favorites")').click();
    expect((await page.locator("figure").count()) === 1, "favorites filter shows the wrong number");
    await page.locator('button:has-text("All")').click();
    await page.locator("figure").nth(1).locator("button").first().click();
    await page.locator('button:has-text("Delete")').click();
    await page.locator("text=Gallery (1)").waitFor({ timeout: 5_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("text=Gallery (1)").waitFor({ timeout: 10_000 });
    return "favorite kept, other deleted, both persist";
  });

  await test("TC23 '2 more like this' reuses the idea, style and shape", async () => {
    await page.locator("figure button").first().click();
    await page.locator('button:has-text("2 more like this")').click();
    await page.locator("text=Gallery (3)").waitFor({ timeout: 10_000 });
    const b = imageBodies.at(-1);
    expect(b.prompt === "a fox reading a book" && b.style === "anime" && b.aspect === "16:9" && b.count === 2, `request: ${JSON.stringify(b)}`);
    return "same idea/style/shape, 2 more";
  });

  await test("TC24 Chat image request picks up the style named in it", async () => {
    await openApp();
    await newChat();
    await send("/image an anime cat on a rooftop");
    await page.locator(".media-card img").last().waitFor({ timeout: 15_000 });
    const b = imageBodies.at(-1);
    expect(b.style === "anime", `style sent: ${b.style}`);
    return "style=anime";
  });

  await test("TC20 No uncaught errors in the browser", async () => {
    const real = pageErrors.filter((e) => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|aborted/i.test(e));
    expect(!real.length, real.slice(0, 3).join(" | "));
    return "clean console";
  });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed · screenshots in ${SHOTS}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
