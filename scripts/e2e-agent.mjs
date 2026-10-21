#!/usr/bin/env node
/**
 * End-to-end test of PaperPilot's coding agent in a real browser.
 * Needs `npm run agent` and `npm run dev` running, and Chrome or Edge installed.
 *
 * Run: npm run test:e2e
 *
 * Works on a throwaway copy (PAPERPILOT_E2E_DIR, default C:\PaperPilot_E2E) so no real project is touched.
 * Set PAPERPILOT_E2E_BIGFILE to a large .js file to also test comment removal on real code.
 */
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.env.PAPERPILOT_E2E_URL || "http://localhost:3000/app";
const SANDBOX = path.resolve(process.env.PAPERPILOT_E2E_DIR || (os.platform() === "win32" ? "C:\\PaperPilot_E2E" : "/tmp/paperpilot-e2e"));
const BIG_FILE = process.env.PAPERPILOT_E2E_BIGFILE || "";
const SHOTS = path.join(ROOT, "e2e-results");
const TASK_TIMEOUT = 6 * 60_000;

const file = (rel) => path.join(SANDBOX, ...rel.split("/"));
const read = (rel) => fs.readFileSync(file(rel), "utf8");

const FIXTURES = {
  "WebContent/js/cart.js": `// Cart helpers used by checkout
/**
 * Sum of price * qty for every item.
 */
function calcTotal(items) {
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    total += items[i].price * items[i].qty; // line total
  }
  return total;
}

/* Returns true when n is an even number. */
function isEven(n) {
  return n % 2 === 1;
}

function formatMoney(value) {
  return "$" + value.toFixed(2);
}
`,
  "WebContent/js/checkout.js": `// Checkout page logic
function renderSummary(items) {
  var total = calcTotal(items);
  document.getElementById("total").textContent = formatMoney(total);
  if (isEven(items.length)) {
    document.getElementById("note").textContent = "Pairs discount applied";
  }
}

function onPay(items) {
  var amount = calcTotal(items);
  return { amount: amount, currency: "USD" };
}
`,
  "WebContent/SCRN/orders.jsp": `<%@ page contentType="text/html; charset=UTF-8" %>
<%-- Orders screen: lists the user's orders --%>
<!DOCTYPE html>
<html>
<head>
  <!-- Page styles -->
  <style>
    /* table layout */
    .orders { width: 100%; background: url(http://cdn.example.com/bg.png); }
  </style>
</head>
<body>
<%
  // load orders for the current user
  String user = (String) session.getAttribute("user"); /* may be null */
%>
  <h1>Orders for <%= user %></h1>
  <table class="orders" id="orders"></table>
  <script type="text/javascript">
    // fetch the orders as JSON
    var api = "http://api.example.com/orders?user=<%= user %>"; // endpoint
    /* render rows */
    function render(rows) { return rows.length; }
  </script>
</body>
</html>
`,
};

function makeSandbox() {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(FIXTURES)) {
    fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
    fs.writeFileSync(file(rel), text);
  }
  if (BIG_FILE && fs.existsSync(BIG_FILE)) {
    const rel = `WebContent/SCRN/Library/COMMON/${path.basename(BIG_FILE)}`;
    fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
    fs.copyFileSync(BIG_FILE, file(rel));
    return rel;
  }
  return null;
}

function parsesAsScript(code) {
  try {
    new vm.Script(code);
    return true;
  } catch {
    return false;
  }
}

function launchBrowser() {
  const attempts = ["chrome", "msedge"];
  return (async () => {
    for (const channel of attempts) {
      try {
        return await chromium.launch({ channel, headless: process.env.PAPERPILOT_E2E_HEADED !== "1" });
      } catch {
        /* try the next installed browser */
      }
    }
    throw new Error("Neither Chrome nor Edge could be launched.");
  })();
}

const results = [];
let page;

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function test(name, fn) {
  const started = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    const detail = await fn();
    results.push({ name, ok: true, secs: Math.round((Date.now() - started) / 1000), detail: detail || "" });
    console.log(`  ✔ passed${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false, secs: Math.round((Date.now() - started) / 1000), detail: e.message });
    console.log(`  ✘ FAILED — ${e.message}`);
  }
  await shot(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()).catch(() => {});
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function focusFile(rel) {
  await page.click('button[title="Go to file (Ctrl+P)"]');
  await page.fill(".quick-open-input", path.basename(rel));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (p) => document.querySelector(".composer-meta strong")?.textContent?.includes(p),
    rel,
    { timeout: 10_000 },
  );
}

/** Sends one chat message and waits for the agent run to finish; returns the reply text. */
async function askAgent(prompt) {
  const repliesBefore = await page.locator(".agent-reply").count();
  const box = page.locator("textarea.composer-input");
  await box.fill(prompt);
  await box.press("Enter");
  await page.waitForFunction(() => document.querySelector("textarea.composer-input")?.disabled === true, null, { timeout: 15_000 });
  await page.waitForFunction(() => document.querySelector("textarea.composer-input")?.disabled === false, null, {
    timeout: TASK_TIMEOUT,
  });
  if ((await page.locator(".agent-reply").count()) <= repliesBefore) {
    const banner = page.locator('button:has-text("Retry")').first().locator("xpath=..");
    const reason = (await banner.count()) ? (await banner.innerText()).replace(/\s*Retry\s*$/, "") : "no reply";
    throw new Error(`agent error: ${reason.trim()}`);
  }
  const head = page.locator(".agent-reply").last().locator(".agent-steps-head");
  if (await head.count()) await head.click();
  const reply = await page.locator(".agent-reply").last().innerText().catch(() => "");
  console.log(`  agent: ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
  return reply;
}

async function acceptAll() {
  const btn = page.locator('.review-bar button:has-text("Accept all")');
  if (await btn.count()) await btn.click();
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const bigRel = makeSandbox();
  console.log(`Sandbox: ${SANDBOX}${bigRel ? ` (+ ${bigRel})` : ""}`);

  const browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));

  // The native folder dialog can't be clicked by a script: answer it by pointing the agent at the sandbox.
  await page.route("**/pick-folder", async (route) => {
    const req = route.request();
    const response = await route.fetch({
      url: req.url().replace("/pick-folder", "/workspace"),
      method: "POST",
      headers: { ...req.headers(), "content-type": "application/json" },
      postData: JSON.stringify({ path: SANDBOX }),
    });
    await route.fulfill({ response });
  });

  await test("Open app and connect project folder", async () => {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    const welcome = page.locator('button:has-text("Got it")');
    await welcome.waitFor({ timeout: 8_000 }).then(() => welcome.click(), () => {});
    await page.click('button.stage-action:has-text("Folder")', { timeout: 30_000 });
    await page.waitForSelector("text=Workspace connected", { timeout: 30_000 });
    const tree = await page.locator("text=cart.js").count();
    expect(tree > 0, "cart.js not shown in the explorer");
    return "explorer lists the sandbox files";
  });
  if (!results[0].ok) {
    await browser.close();
    console.log("\nCould not connect the folder; skipping agent tests.");
    process.exit(1);
  }

  await test("Question only: explain a file (no edits)", async () => {
    const before = read("WebContent/js/checkout.js");
    await focusFile("WebContent/js/checkout.js");
    const reply = await askAgent("What does checkout.js do? Answer in 2-3 sentences, do not change any files.");
    expect(read("WebContent/js/checkout.js") === before, "checkout.js was modified");
    expect(/total|pay|summary/i.test(reply), "answer doesn't describe the file");
    return "answered without touching files";
  });

  await test("Remove comments from a JS file", async () => {
    await focusFile("WebContent/js/cart.js");
    const reply = await askAgent("remove comments in this file");
    const after = read("WebContent/js/cart.js");
    expect(!/\/\/|\/\*/.test(after), "comments still present");
    expect(/function calcTotal/.test(after) && /function formatMoney/.test(after), "code was lost");
    expect(parsesAsScript(after), "cart.js no longer parses");
    expect(/Remove comments/.test(reply), "agent did not use the remove_comments tool");
    await acceptAll();
    return "comments gone, code intact, used remove_comments";
  });

  await test("Remove comments from a JSP file", async () => {
    await focusFile("WebContent/SCRN/orders.jsp");
    await askAgent("remove all comments from this JSP");
    const after = read("WebContent/SCRN/orders.jsp");
    expect(!/<%--|<!--|\/\*|\/\/ /.test(after), "comments still present");
    expect(after.includes("http://cdn.example.com/bg.png") && after.includes("http://api.example.com/orders"), "URLs were damaged");
    expect(after.includes("<%= user %>") && after.includes('session.getAttribute("user")'), "JSP code was lost");
    await acceptAll();
    return "JSP, Java, script and style comments removed; URLs kept";
  });

  if (bigRel) {
    await test(`Remove comments from big real file (${path.basename(bigRel)})`, async () => {
      const before = read(bigRel);
      await focusFile(bigRel);
      await askAgent("remove comments in this file");
      const after = read(bigRel);
      expect(after.length < before.length, "file unchanged");
      expect(parsesAsScript(after), "file no longer parses");
      await acceptAll();
      return `${before.split(/\r?\n/).length} → ${after.split(/\r?\n/).length} lines, still parses`;
    });
  }

  await test("Rename a function across files", async () => {
    await askAgent("Rename the function calcTotal to computeTotal everywhere in the project (definition and all calls).");
    const cart = read("WebContent/js/cart.js");
    const checkout = read("WebContent/js/checkout.js");
    expect(!/calcTotal/.test(cart + checkout), "calcTotal still referenced");
    expect(/function computeTotal/.test(cart), "definition not renamed");
    expect((checkout.match(/computeTotal\(/g) || []).length === 2, "not all calls renamed");
    await acceptAll();
    return "definition + 2 calls renamed";
  });

  await test("Fix a bug", async () => {
    await focusFile("WebContent/js/cart.js");
    await askAgent("isEven returns the wrong result. Fix the bug.");
    const ctx = {};
    vm.runInNewContext(`${read("WebContent/js/cart.js")}\nthis.r = [isEven(2), isEven(3), isEven(0)];`, ctx);
    expect(JSON.stringify(ctx.r) === "[true,false,true]", `isEven still wrong: ${JSON.stringify(ctx.r)}`);
    await acceptAll();
    return "isEven(2)=true, isEven(3)=false";
  });

  await test("Reject all restores the file", async () => {
    await focusFile("WebContent/js/checkout.js");
    const before = read("WebContent/js/checkout.js");
    await askAgent('Add a new function named "refund" at the end of checkout.js that returns { refunded: true }.');
    expect(read("WebContent/js/checkout.js") !== before, "agent did not change the file");
    await page.click('.review-bar button:has-text("Reject all")');
    await page.waitForTimeout(1500);
    expect(read("WebContent/js/checkout.js") === before, "file not restored after Reject all");
    return "change made, then fully reverted";
  });

  await test("Agent writes no helper scripts", async () => {
    const all = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else all.push(path.relative(SANDBOX, full).replace(/\\/g, "/"));
      }
    };
    walk(SANDBOX);
    const expected = new Set([...Object.keys(FIXTURES), ...(bigRel ? [bigRel] : [])]);
    const extra = all.filter((f) => !expected.has(f) && !f.endsWith(".ppbak"));
    expect(!extra.length, `unexpected files: ${extra.join(", ")}`);
    return "only the project's own files exist";
  });

  await test("No uncaught errors in the browser", async () => {
    const unique = [...new Set(pageErrors)];
    expect(!unique.length, unique.join(" | "));
    return "clean console";
  });

  await browser.close();

  console.log("\n================ PaperPilot E2E results ================");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.secs}s)${r.ok ? "" : `\n      ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
