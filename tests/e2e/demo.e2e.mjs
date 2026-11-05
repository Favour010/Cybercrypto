/**
 * End-to-end regression suite for the demo data layer (all 12 modules).
 *
 *   npm run build && JOBSYNC_DATA_MODE=demo npm start   # in one terminal
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e # in another
 *
 * Uses the `playwright` library (not @playwright/test). Each scenario starts
 * from a fresh browser context, i.e. freshly seeded demo data.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const results = [];
let browser;

async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => {
    // Failed connection tests log the HTTP status of the test request itself.
    if (m.type() === "error" && !/status of 422/.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  const t0 = Date.now();
  try {
    await fn(page);
    if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: err.message.split("\n")[0] });
  } finally {
    await context.close();
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

async function open(page, path) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading demo data"), null, { timeout: 60_000 });
}

const main = (page) => page.locator("main").innerText();

browser = await chromium.launch();

await scenario("every navigation item and sub-route renders real content", async (page) => {
  await open(page, "/");
  const nav = await page.$$eval("nav[aria-label=Main] a", (as) => as.map((a) => a.getAttribute("href")));
  expect(nav.length === 12, `expected 12 navigation items, got ${nav.length}`);
  await open(page, "/jobs");
  const job = await page.locator("table tbody tr a").first().getAttribute("href");
  await open(page, "/executions");
  const exec = await page.locator("table tbody tr a").first().getAttribute("href");
  for (const r of [
    ...nav,
    job,
    `${job}/edit`,
    exec,
    "/portals/northstar",
    "/incoming?view=rejected",
    "/failed?tab=failed",
    "/analytics?days=21",
    "/settings/system/users",
  ]) {
    await open(page, r);
    const text = await main(page);
    expect(
      !/Not yet implemented|delivered in Phase|This page could not be found/i.test(text),
      `${r} shows placeholder or 404`,
    );
    expect(text.length > 500, `${r} has too little content`);
    expect(await page.locator("main h1").count(), `${r} has no heading`);
  }
});

await scenario("jobs: search, create with attachment, edit, archive, persist", async (page) => {
  await open(page, "/jobs");
  await page.fill("#q", "Harbour");
  await page.click('button:has-text("Apply")');
  await page.waitForURL(/q=Harbour/);
  await open(page, "/jobs/new");
  await page.waitForFunction(() => document.querySelector("input[name=submission_token]")?.value.length === 36);
  await page.fill("[name=customer_name]:visible", "E2E Facilities");
  await page.fill("[name=service_address]:visible", "1 Test Street, London");
  await page.fill("[name=category]:visible", "Plumbing");
  await page.fill("[name=description]:visible", "Leaking valve.");
  await page.check("input[name=destinations][value=northstar]");
  await page.setInputFiles("[name=attachments]:visible", {
    name: "note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Meter reading 1234"),
  });
  await page.click('button:has-text("Create job")');
  await page.waitForURL(/notice=created/);
  await page.waitForFunction(() => /JS-\d{6}/.test(document.querySelector("main h1")?.textContent || ""));
  const text = await main(page);
  expect(
    text.includes("Job created") && text.includes("note.txt") && text.includes("Pending"),
    "created job details missing",
  );
  await page.click('a:has-text("Edit job")');
  await page.waitForURL(/\/edit$/);
  await page.fill("[name=technician]:visible", "Technician E2E");
  await page.click('button:has-text("Save changes")');
  await page.waitForURL(/notice=updated/);
  await page.click('button:has-text("Archive job")');
  await page.click('[role=dialog] button:has-text("Archive")');
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => /JS-\d{6}/.test(document.querySelector("main h1")?.textContent || ""));
  const after = await main(page);
  expect(after.includes("Technician E2E") && after.includes("Restore job"), "edit or archive did not persist");
});

await scenario("incoming: simulator answers 201 / 200 / 409 / 422; generator; routing", async (page) => {
  await open(page, "/incoming");
  for (const code of ["201", "200"]) {
    await page.click('button:has-text("Send payload")');
    await page.waitForSelector(`text=HTTP ${code}`);
  }
  await page.fill(
    "#intake-json",
    (await page.inputValue("#intake-json")).replace("Example Facilities Ltd", "Changed Ltd"),
  );
  await page.click('button:has-text("Send payload")');
  await page.waitForSelector("text=HTTP 409");
  await page.fill("#intake-json", '{"source":"aroflo"}');
  await page.click('button:has-text("Send payload")');
  await page.waitForSelector("text=HTTP 422");
  await page.fill("#gen-count", "30");
  await page.click('button:has-text("Generate")');
  await page.waitForSelector("text=Last batch: 30 payloads");
  await open(page, "/incoming?view=awaiting_routing");
  if (await page.locator('button:has-text("Run routing now")').count()) {
    await page.click('button:has-text("Run routing now")');
    await page.waitForTimeout(500);
    const tabs = await page.locator('nav[aria-label="Incoming views"]').innerText();
    expect(/Awaiting routing\s*0/.test(tabs), "routing did not clear the awaiting jobs");
  }
});

await scenario("automation: worker respects concurrency and per-portal locks; retries", async (page) => {
  await open(page, "/queue");
  await page.click('button:has-text("Start worker")');
  await page.waitForTimeout(2500);
  const lanes = await page.locator("text=Locked").count();
  expect(lanes >= 1 && lanes <= 3, `expected 1–3 locked portals, got ${lanes}`);
  await page.waitForTimeout(8000);
  await open(page, "/executions?days=1");
  await page.locator("table tbody tr a").first().click();
  await page.waitForURL(/\/executions\/[0-9a-f-]{36}$/);
  await page.waitForSelector("text=Simulated execution", { timeout: 30_000 });
  const ex = await main(page);
  expect(ex.includes("Simulated execution") && ex.includes("Capture confirmation"), "execution timeline missing");
  await open(page, "/failed?tab=failed");
  await page.click('button:has-text("Retry all")');
  await page.click('[role=dialog] button:has-text("Retry all")');
  await page.waitForTimeout(500);
  expect(
    /Failed\s*0/.test(await page.locator('nav[aria-label="Failed job views"]').innerText()),
    "bulk retry did not clear failed tasks",
  );
});

await scenario("admin: settings validation, audit diff, secrets never stored, roles", async (page) => {
  await open(page, "/settings/system");
  await page.fill("#sys-max_concurrency", "50");
  await page.click('button:has-text("Save configuration")');
  await page.waitForSelector("text=Concurrency must be 1–10 browser workers.");
  await page.fill("#sys-max_concurrency", "5");
  await page.click('button:has-text("Save configuration")');
  await page.waitForSelector("text=System configuration saved.");
  await open(page, "/audit?entity=system_settings");
  await page.locator("main details summary").first().click();
  expect(/"to": 5/.test(await page.locator("main details[open] pre").innerText()), "audit diff missing");
  await open(page, "/settings/integrations");
  await page.fill("#n8n-url", "https://example.com/webhook/jobsync");
  await page.fill("#n8n-secret", "never-store-this-9876");
  await page.click('button:has-text("Save") >> nth=0');
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("jobsync-demo");
        r.onsuccess = () => {
          const g = r.result.transaction("state").objectStore("state").get("current");
          g.onsuccess = () => res(JSON.stringify(g.result));
        };
      }),
  );
  expect(!stored.includes("never-store-this"), "raw secret was stored in the browser");
  await page.click("summary");
  await page.click("text=Vera Viewer");
  await page.waitForTimeout(1200);
  await open(page, "/audit");
  expect((await main(page)).includes("You do not have permission"), "viewer could read the audit log");
});

await scenario("full workflow: create → rule routing → queue → simulated dry run → reporting", async (page) => {
  // Deterministic, fast simulation: no failures, no human review.
  await open(page, "/settings/system");
  await page.fill("#sys-failurePct", "0");
  await page.fill("#sys-reviewPct", "0");
  await page.selectOption("#sys-speed", "0.03");
  await page.click('button:has-text("Save configuration")');
  await page.waitForSelector("text=System configuration saved.");

  // A manual job with NO destinations: the routing rules must choose the portal.
  await open(page, "/jobs/new");
  await page.waitForFunction(() => document.querySelector("input[name=submission_token]")?.value.length === 36);
  await page.fill("[name=customer_name]:visible", "E2E Workflow Ltd");
  await page.fill("[name=service_address]:visible", "2 Workflow Way, Leeds");
  await page.fill("[name=category]:visible", "Fire Safety");
  await page.selectOption("[name=priority]:visible", "urgent");
  await page.fill("[name=description]:visible", "Annual fire alarm inspection.");
  await page.click('button:has-text("Create job")');
  await page.waitForURL(/notice=created/);
  const jobUrl = new URL(page.url()).pathname;
  await page.waitForFunction(() => /JS-\d{6}/.test(document.querySelector("main h1")?.textContent || ""));
  const reference = (await page.locator("main h1:visible").innerText()).trim();
  let detail = await main(page);
  expect(detail.includes("Greenfield"), "routing rule did not assign Greenfield");
  expect(!/Northstar|BluePeak|MetroCare/.test(detail.split("Activity")[0]), "job was sent to unrelated portals");

  // Queue → simulated worker → dry run.
  await open(page, "/queue");
  await page.click('button:has-text("Start worker")');
  await page.waitForSelector('button:has-text("Pause worker")');
  await page.waitForTimeout(800); // let the save land before the full reload below
  await open(page, jobUrl);
  await page.waitForFunction(() => document.querySelector("main")?.innerText.includes("Dry run passed"), null, {
    timeout: 120_000,
  });
  detail = await main(page);
  expect(
    !/\bSubmitted\b(?! manually)/.test(detail.split("\n").slice(0, 12).join(" ")),
    "dry run labelled as Submitted",
  );

  // Reporting reflects it (after the debounced save).
  await page.waitForTimeout(800);
  await open(page, `/jobs?q=${encodeURIComponent(reference)}`);
  await page.waitForSelector(`main table tbody tr:has-text("${reference}")`);
  expect(
    (await page.locator(`main table tbody tr:has-text("${reference}")`).innerText()).includes("Dry run passed"),
    "jobs list does not label the dry run",
  );
  await open(page, "/executions?days=1&portal=greenfield");
  await page.waitForSelector(`main table tbody tr:has-text("${reference}")`);
  await open(page, "/");
  expect((await main(page)).includes("Dry-run passed or submitted"), "overview charts claim real submissions");
  await open(page, "/analytics?days=7");
  expect((await main(page)).length > 500, "analytics did not render");
});

await scenario("users & roles: add, deactivate, guard rails, switch user", async (page) => {
  await open(page, "/settings/system/users");
  await page.click('button:has-text("Add user")');
  await page.fill("[role=dialog] input:not([type=email]) >> nth=0", "Erin Engineer");
  await page.fill("[role=dialog] input[type=email]", "erin@example.com");
  await page.selectOption("[role=dialog] select", "operator");
  await page.click("[role=dialog] button[type=submit]");
  await page.waitForSelector("text=Erin Engineer added.");
  // Duplicate email is refused.
  await page.click('button:has-text("Add user")');
  await page.fill("[role=dialog] input:not([type=email]) >> nth=0", "Erin Again");
  await page.fill("[role=dialog] input[type=email]", "ERIN@example.com");
  await page.click("[role=dialog] button[type=submit]");
  await page.waitForSelector("text=Another user already has this email address.");
  await page.keyboard.press("Escape");
  // Own account cannot be deactivated.
  const ownRow = page.locator("tr", { hasText: "(you)" });
  expect(await ownRow.locator('button:has-text("Deactivate")').isDisabled(), "admin could deactivate themselves");
  // Deactivate the viewer.
  await page.locator("tr", { hasText: "Vera Viewer" }).locator('button:has-text("Deactivate")').click();
  await page.click('[role=dialog] button:has-text("Deactivate")');
  await page.waitForSelector("text=Vera Viewer deactivated.");
  // The user menu offers active users only; switch to the new operator.
  await page.click("header summary");
  const menu = await page.locator("header details").innerText();
  expect(!menu.includes("Vera Viewer") && menu.includes("Erin Engineer"), "user menu shows the wrong users");
  await page.click("text=Erin Engineer");
  await page.waitForTimeout(1200);
  await open(page, "/settings/system/users");
  expect((await page.locator('button:has-text("Add user")').count()) === 0, "operator can add users");
  await open(page, "/audit");
  expect((await main(page)).includes("You do not have permission"), "operator could read the audit log");
});

await scenario("worker results: rejected, applied, duplicate", async (page) => {
  await open(page, "/settings/integrations");
  await page.click('button:has-text("Start attempt")');
  await page.waitForSelector("text=it waits for a result");
  await page.click('button:has-text("Invalid: dry run claims a submission")');
  await page.click('button:has-text("Post result")');
  await page.waitForSelector("text=Rejected — nothing changed");
  expect(
    (await main(page)).includes("A dry-run execution can never report a real submission"),
    "rejection reason missing",
  );
  await page.click('button:has-text("Dry run passed") >> nth=0');
  await page.click('button:has-text("Post result")');
  await page.waitForSelector("text=Applied");
  await page.click('button:has-text("Post result")');
  await page.waitForSelector("text=Duplicate — ignored");
  const log = await main(page);
  expect(/Recent posted results/.test(log), "result log missing");
});

await scenario("phone width: no page scrolls sideways", async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const r of [
    "/",
    "/jobs",
    "/incoming",
    "/jobs/new",
    "/portals",
    "/portals/apex",
    "/queue",
    "/executions",
    "/failed",
    "/analytics",
    "/settings/integrations",
    "/audit",
    "/settings/system",
    "/settings/system/users",
  ]) {
    await open(page, r);
    expect(
      !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
      `${r} overflows at 390px`,
    );
  }
});

await browser.close();
for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} (${(r.ms / 1000).toFixed(1)}s)${r.ok ? "" : `\n      ${r.error}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
