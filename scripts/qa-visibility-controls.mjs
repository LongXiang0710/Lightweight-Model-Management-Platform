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
const readState = () => page.evaluate(() => JSON.parse(document.body.dataset.modelVisibility || "{}"));

try {
  await page.goto("http://127.0.0.1:5173/?qa=visibility", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.locator('.tree-row[data-depth="4"]').first().click();
  const structurePath = await page.evaluate(() => [...document.querySelectorAll("#propertyList div")]
    .find((row) => row.querySelector("span")?.textContent === "结构路径")
    ?.querySelector("strong")?.textContent || "");
  const component = page.locator('.tree-row[data-depth="5"]:visible').first();
  await component.click();
  const selectedNodeId = await component.getAttribute("data-node-id");
  const pipelineName = await page.evaluate(() => [...document.querySelectorAll("#propertyList div")]
    .find((row) => row.querySelector("span")?.textContent === "管线名称")
    ?.querySelector("strong")?.textContent || "");

  const initial = await readState();
  await page.locator("#hideSelected").click();
  const hidden = await readState();
  const hiddenButtonLabel = await page.locator("#hideSelected em").innerText();
  await page.locator("#hideSelected").click();
  const restoredByButton = await readState();
  const restoredButtonLabel = await page.locator("#hideSelected em").innerText();
  await page.locator("#hideSelected").click();
  await page.locator("#showAllObjects").click();
  const restoredAfterHide = await readState();

  await page.locator("#isolateSelected").click();
  const isolated = await readState();
  const isolateActive = await page.locator("#isolateSelected").evaluate((element) => element.classList.contains("active"));
  const secondComponent = page.locator('.tree-row[data-depth="5"]:visible').nth(1);
  await secondComponent.click();
  const hiddenSelectionLabel = await page.locator("#hideSelected em").innerText();
  const stateAfterSelectingHidden = await readState();
  await page.locator("#hideSelected").click();
  const stateAfterShowingHidden = await readState();
  const shownSelectionLabel = await page.locator("#hideSelected em").innerText();
  await page.locator("#isolateSelected").click();
  const reIsolated = await readState();
  await page.locator("#translucentSelected").click();
  const translucent = await readState();
  const translucentActive = await page.locator("#translucentSelected").evaluate((element) => element.classList.contains("active"));
  const screenshotPath = resolve("qa-visibility-controls.png");
  await page.screenshot({ path: screenshotPath });

  await page.locator("#translucentSelected").click();
  const opaqueAgain = await readState();
  await page.locator("#showAllObjects").click();
  const final = await readState();

  console.log(JSON.stringify({
    selectedNodeId,
    structurePath,
    pipelineName,
    initial,
    hidden,
    hiddenButtonLabel,
    restoredByButton,
    restoredButtonLabel,
    restoredAfterHide,
    isolated,
    isolateActive,
    hiddenSelectionLabel,
    stateAfterSelectingHidden,
    stateAfterShowingHidden,
    shownSelectionLabel,
    reIsolated,
    translucent,
    translucentActive,
    opaqueAgain,
    final,
    screenshotPath
  }, null, 2));
} finally {
  await browser.close();
}
