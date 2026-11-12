import { createRequire } from "node:module";

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
  await page.goto("http://127.0.0.1:5173/?qa=sidebars", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });

  await page.locator("#collapseLeft").click();
  await page.waitForTimeout(320);
  const leftButtonVisible = await page.locator("#reopenLeft").isVisible();
  const leftCollapsed = await page.evaluate(() => document.body.classList.contains("left-collapsed"));
  await page.locator("#reopenLeft").click();
  await page.waitForTimeout(320);
  const leftRestored = !await page.evaluate(() => document.body.classList.contains("left-collapsed"));

  await page.locator("#collapseRight").click();
  await page.waitForTimeout(320);
  const rightButtonVisible = await page.locator("#reopenRight").isVisible();
  const rightCollapsed = await page.evaluate(() => document.body.classList.contains("right-collapsed"));
  await page.locator("#reopenRight").click();
  await page.waitForTimeout(320);
  const rightRestored = !await page.evaluate(() => document.body.classList.contains("right-collapsed"));

  const systemRow = page.locator('.tree-row[data-depth="4"]').first();
  const systemNode = systemRow.locator("..");
  await systemRow.click();
  await page.waitForTimeout(180);
  const treeExpanded = await systemNode.evaluate((element) => element.classList.contains("expanded"));
  await systemRow.click();
  await page.waitForTimeout(180);
  const treeCollapsedAgain = !await systemNode.evaluate((element) => element.classList.contains("expanded"));
  await systemRow.click();
  const secondSystemRow = page.locator('.tree-row[data-depth="4"]').nth(1);
  const secondSystemNode = secondSystemRow.locator("..");
  await secondSystemRow.click();
  await page.waitForTimeout(180);
  const previousPipelineAutoCollapsed = !await systemNode.evaluate((element) => element.classList.contains("expanded"));
  const selectedPipelineExpanded = await secondSystemNode.evaluate((element) => element.classList.contains("expanded"));
  const cameraPosition = () => page.evaluate(() => ({ ...window.__viewer.camera.position }));
  const cameraDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
  const cameraBeforeTreeSelection = await cameraPosition();
  await systemRow.click();
  await page.locator('.tree-row[data-depth="5"]:visible').first().click();
  await page.waitForTimeout(180);
  const cameraAfterTreeSelection = await cameraPosition();
  const treeSelectionFocusedCamera = cameraDistance(cameraBeforeTreeSelection, cameraAfterTreeSelection) > 0.01;
  await page.locator("#homeView").click();
  await page.waitForTimeout(250);
  const cameraBeforeShortcut = await cameraPosition();
  await page.keyboard.press("f");
  await page.waitForTimeout(250);
  const cameraAfterShortcut = await cameraPosition();
  const focusShortcutMovedCamera = cameraDistance(cameraBeforeShortcut, cameraAfterShortcut) > 0.01;
  await page.locator("#homeView").click();
  await page.waitForTimeout(650);
  const canvasBox = await page.locator("#cesiumContainer canvas").boundingBox();
  const pickPosition = await page.evaluate(() => {
    const viewer = window.__viewer;
    for (let y = 140; y < viewer.canvas.clientHeight - 80; y += 12) {
      for (let x = 80; x < viewer.canvas.clientWidth - 80; x += 12) {
        const picked = viewer.scene.pick(new window.Cesium.Cartesian2(x, y));
        if (picked instanceof window.Cesium.Cesium3DTileFeature && picked.getProperty("componentId")) return { x, y };
      }
    }
    return null;
  });
  if (pickPosition) {
    await page.mouse.click(canvasBox.x + pickPosition.x, canvasBox.y + pickPosition.y);
    await page.waitForTimeout(450);
  }
  const propertySectionText = await page.locator("#propertyList").innerText();
  const selectedSummaryHidden = await page.locator(".selected-card").isHidden();
  const modelPickDisplayedEp3dSection = propertySectionText.includes("EP3D 属性");
  const modelPickDisplayedKeyEp3dField = /焊点编号|元件编号|管线号|连接焊口编号/.test(propertySectionText);

  console.log(JSON.stringify({
    leftButtonVisible,
    leftCollapsed,
    leftRestored,
    rightButtonVisible,
    rightCollapsed,
    rightRestored,
    treeExpanded,
    treeCollapsedAgain,
    previousPipelineAutoCollapsed,
    selectedPipelineExpanded,
    treeSelectionFocusedCamera,
    focusShortcutMovedCamera,
    modelPickFoundFeature: Boolean(pickPosition),
    selectedSummaryHidden,
    modelPickDisplayedEp3dSection,
    modelPickDisplayedKeyEp3dField,
    consoleErrors
  }));
} finally {
  await browser.close();
}
