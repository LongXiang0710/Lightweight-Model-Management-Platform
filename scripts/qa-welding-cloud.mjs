import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--no-proxy-server", "--proxy-bypass-list=*"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto("http://127.0.0.1:5173/?qa=welding-cloud", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-row[data-depth="5"]').length > 0, null, { timeout: 10000 });
  const weldTreeResult = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tree-row[data-depth="5"]')];
    const row = rows.find((candidate) => candidate.textContent?.includes("Weld"));
    if (!row) return { clicked: false, label: "" };
    let parent = row.parentElement;
    while (parent) {
      if (parent.classList.contains("tree-node")) parent.classList.add("expanded");
      parent = parent.parentElement;
    }
    row.click();
    return { clicked: true, label: row.textContent || "" };
  });
  await page.waitForFunction(() => document.querySelector("#propertyList")?.textContent?.includes("云端焊接数据"), null, { timeout: 5000 });
  await page.locator(".cloud-source-link").waitFor({ state: "visible", timeout: 30000 });
  const propertyText = await page.locator("#propertyList").innerText();
  const dateText = await page.locator(".cloud-date-row strong").innerText();
  const firstVisualization = await page.evaluate(() => JSON.parse(document.body.dataset.weldingVisualization || "{}"));
  const treeStateCounts = await page.evaluate(() => ({
    welded: document.querySelectorAll("#modelTree .tree-row.tree-welded").length,
    unwelded: document.querySelectorAll("#modelTree .tree-row.tree-unwelded").length
  }));
  const sourceHref = await page.locator(".cloud-source-link").getAttribute("href");
  const firstSync = await page.evaluate(() => JSON.parse(document.body.dataset.weldingSync || "{}"));
  await page.locator(".property-section-title.cloud").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve("qa-welding-cloud.png"), fullPage: false });
  await page.waitForTimeout(1100);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction((previous) => {
    const current = JSON.parse(document.body.dataset.weldingSync || "{}");
    return current.syncedAt && current.syncedAt !== previous;
  }, firstSync.syncedAt, { timeout: 30000 });
  const secondSync = await page.evaluate(() => JSON.parse(document.body.dataset.weldingSync || "{}"));
  console.log(JSON.stringify({
    clickedWeldNode: weldTreeResult.clicked,
    weldNumberShownInTree: /\d+号焊缝/.test(weldTreeResult.label),
    weldedTreeNodesShownRed: treeStateCounts.welded > 0,
    unweldedTreeNodesShownBlue: treeStateCounts.unwelded > 0,
    displayedCloudSection: propertyText.includes("云端焊接数据"),
    displayedDateField: propertyText.includes("焊接日期"),
    blankCloudDateRemainsBlank: dateText.trim() === "",
    displayedUnweldedStatus: propertyText.includes("未焊接"),
    noWeldedColorsWithoutDates: firstVisualization.weldedWelds === 0 && firstVisualization.seamFeatures === 0 && firstVisualization.adjacentFeatures === 0,
    unweldedSeamsClassified: firstVisualization.unweldedSeamFeatures > 0,
    displayedMatchKey: propertyText.includes("匹配字段"),
    sourceHref,
    firstSync,
    secondSync,
    refreshTriggeredNewSync: Boolean(firstSync.syncedAt && secondSync.syncedAt && firstSync.syncedAt !== secondSync.syncedAt),
    consoleErrors
  }));
} finally {
  await browser.close();
}
