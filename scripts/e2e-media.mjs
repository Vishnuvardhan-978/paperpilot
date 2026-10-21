/**
 * Browser test for image / video generation in chat (drives the installed Chrome or Edge).
 * Needs `npm run dev` running. Video success is simulated (Veo / Pollinations video cost money);
 * the image test hits the real providers.
 *
 *   node scripts/e2e-media.mjs          (PAPERPILOT_E2E_HEADED=1 to watch)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = process.env.PAPERPILOT_APP_URL || "http://localhost:3000/app";
const SHOTS = path.resolve("e2e-results");
const results = [];
let page;

async function test(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)${note ? ` — ${note}` : ""}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name} (${((Date.now() - t) / 1000).toFixed(1)}s) — ${e.message.split("\n")[0]}`);
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
  await page.screenshot({ path: path.join(SHOTS, `media-${slug}.png`) }).catch(() => {});
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

async function send(text) {
  const box = page.locator("textarea.composer-input");
  await box.fill(text);
  await box.press("Enter");
}

/** Waits for the newest media card to leave the pending state; returns "image" | "video" | "error: …". */
async function lastCardResult(timeout) {
  const card = page.locator(".media-card").last();
  await card.waitFor({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll(".media-card");
      const c = cards[cards.length - 1];
      return c && !c.querySelector(".agent-spin");
    },
    null,
    { timeout },
  );
  if (await card.locator("img").count()) return "image";
  if (await card.locator("video").count()) return "video";
  return `error: ${(await card.innerText()).replace(/\s+/g, " ").trim()}`;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));

  await test("Open app in a fresh chat", async () => {
    await page.goto(APP, { waitUntil: "domcontentloaded" });
    const welcome = page.locator('button:has-text("Got it")');
    await welcome.waitFor({ timeout: 8_000 }).then(() => welcome.click(), () => {});
    await page.keyboard.press("Control+n").catch(() => {});
    await page.locator("textarea.composer-input").waitFor({ timeout: 30_000 });
  });

  await test("Plain-English image request", async () => {
    await send("create an image of a lighthouse on a cliff at sunset, watercolor");
    const r = await lastCardResult(180_000);
    expect(r === "image", r);
    const src = await page.locator(".media-card img").last().getAttribute("src");
    expect(src?.startsWith("data:image/"), "image src is not a data URL");
    const label = await page.locator(".media-card").last().innerText();
    return label.match(/Pollinations[^\n·]*|Gemini|Google Imagen/)?.[0] || "image shown";
  });

  await test("Image survives a page reload", async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".media-card img").last().waitFor({ timeout: 20_000 });
  });

  await test("/video without a paid provider explains what is needed", async () => {
    await send("/video a paper airplane gliding across a desk");
    const r = await lastCardResult(60_000);
    if (r === "video") return "a paid video provider is configured — real video rendered";
    expect(/billing|POLLINATIONS_API_KEY|credits/i.test(r), `unexpected: ${r}`);
    return "billing message shown";
  });

  await test("Video job polls until done (simulated provider)", async () => {
    let polls = 0;
    const jobId = "pollinations/00000000-0000-4000-8000-000000000000";
    await page.route("**/api/media/video**", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ json: { jobId, model: "test-model", provider: "Test provider" } });
      }
      polls++;
      return route.fulfill({ json: polls < 2 ? { status: "running" } : { status: "done", src: "/api/media/file/0123456789abcdef0123456789abcdef.mp4" } });
    });
    await send("make a vertical video of rain on a window");
    const r = await lastCardResult(60_000);
    await page.unroute("**/api/media/video**");
    expect(r === "video", r);
    const ratio = await page.locator(".media-card").last().innerText();
    expect(ratio.includes("9:16"), "vertical aspect not detected");
    return `${polls} polls, 9:16`;
  });

  await test("Command palette has Generate image", async () => {
    await page.keyboard.press("Control+k");
    const item = page.locator('text="Generate image"').first();
    await item.waitFor({ timeout: 5_000 });
    await item.click();
    const value = await page.locator("textarea.composer-input").inputValue();
    expect(value === "/image ", `composer has "${value}"`);
  });

  await test("No page errors", async () => {
    expect(!pageErrors.length, pageErrors.join(" | "));
  });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed. Screenshots: ${SHOTS}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
