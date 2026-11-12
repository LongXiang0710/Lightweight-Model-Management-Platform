import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--no-proxy-server", "--proxy-bypass-list=*"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const cameraPosition = () => page.evaluate(() => ({ ...window.__viewer.camera.position }));
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

try {
  await page.goto("http://127.0.0.1:5173/?qa=tree-focus", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => window.__tileset?.tilesLoaded === true, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-ground-contrast.png" });
  await page.locator("#loadTree").click();
  const beforePipeline = await cameraPosition();
  await page.locator('.tree-row[data-depth="4"]').first().click();
  const afterPipeline = await cameraPosition();
  const component = page.locator('.tree-row[data-depth="5"]:visible').first();
  await component.click();
  await page.waitForTimeout(250);
  const afterComponent = await cameraPosition();
  await page.screenshot({ path: "qa-focus-view.png" });
  const componentNodeId = await component.getAttribute("data-node-id");
  const componentBounds = await page.evaluate(async (nodeId) => {
    const response = await fetch("http://127.0.0.1:4173/model/model-index.json");
    const model = await response.json();
    return model.nodes.find((node) => node.id === nodeId)?.bounds || null;
  }, componentNodeId);
  await page.locator("#homeView").click();
  await page.waitForTimeout(250);
  const canvas = page.locator("#cesiumContainer canvas");
  const canvasBox = await canvas.boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.55, canvasBox.y + canvasBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.72, canvasBox.y + canvasBox.height * 0.46, { steps: 8 });
  await page.mouse.up();
  await component.click();
  await page.waitForTimeout(250);
  const afterRotatedFocus = await cameraPosition();
  const componentCenterZ = componentBounds ? (componentBounds[2] + componentBounds[5]) / 2 : Number.NaN;
  console.log(JSON.stringify({
    pipelineClickDidNotFocus: distance(beforePipeline, afterPipeline) < 0.001,
    componentClickFocused: distance(afterPipeline, afterComponent) > 0.01,
    focusIndependentOfPreviousView: distance(afterComponent, afterRotatedFocus) < 0.001,
    cameraUsesElevatedView: Number.isFinite(componentCenterZ) && afterRotatedFocus.z > componentCenterZ,
    activeDepth: await page.locator("#modelTree .tree-row.active").getAttribute("data-depth"),
    toast: await page.locator("#toast").innerText(),
    propertyPanelVisible: await page.locator("#propertyContent").isVisible()
  }));
} finally {
  await browser.close();
}
