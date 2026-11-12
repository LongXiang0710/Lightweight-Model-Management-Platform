import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: [
    "--no-proxy-server",
    "--proxy-bypass-list=*"
  ]
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleMessages = [];
const failedRequests = [];

page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));

try {
  const startedAt = performance.now();
  await page.goto("http://127.0.0.1:5173/?qa=playwright", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForTimeout(1800);
  const initialScreenshotPath = resolve("qa-model-initial.png");
  await page.screenshot({ path: initialScreenshotPath, fullPage: false });
  const cameraPosition = () => page.evaluate(() => ({ ...window.__viewer.camera.position }));
  const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
  await page.locator("#collapseLeft").click();
  await page.waitForTimeout(120);
  const leftReopenVisible = await page.locator("#reopenLeft").isVisible();
  await page.locator("#reopenLeft").click();
  await page.waitForTimeout(120);
  const leftPanelRestored = !await page.evaluate(() => document.body.classList.contains("left-collapsed"));
  await page.locator("#collapseRight").click();
  await page.waitForTimeout(120);
  const rightReopenVisible = await page.locator("#reopenRight").isVisible();
  await page.locator("#reopenRight").click();
  await page.waitForTimeout(120);
  const rightPanelRestored = !await page.evaluate(() => document.body.classList.contains("right-collapsed"));
  const cameraInitial = await cameraPosition();
  await page.locator("#zoomIn").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve("qa-step-zoom-in.png"), fullPage: false });
  const cameraAfterZoomIn = await cameraPosition();
  await page.locator("#zoomOut").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve("qa-step-zoom-out.png"), fullPage: false });
  const cameraAfterZoomOut = await cameraPosition();
  const canvasBox = await page.locator("#cesiumContainer canvas").boundingBox();
  const centerX = canvasBox.x + canvasBox.width / 2;
  const centerY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(250);
  const cameraAfterWheelZoom = await cameraPosition();
  await page.locator("#homeView").click();
  await page.waitForTimeout(250);
  const cameraAfterWheelReset = await cameraPosition();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(centerX + 80, centerY + 35, { steps: 8 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(250);
  const cameraAfterDragRotation = await cameraPosition();
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centerX + 55, centerY + 30, { steps: 8 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(250);
  const cameraAfterPan = await cameraPosition();
  await page.locator("#toggleSpin").click();
  await page.waitForTimeout(700);
  await page.locator("#toggleSpin").click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve("qa-step-spin.png"), fullPage: false });
  const cameraAfterSpin = await cameraPosition();
  await page.locator("#homeView").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve("qa-step-home.png"), fullPage: false });
  await page.waitForFunction(() => window.__tileset?.tilesLoaded === true, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.locator("#loadTree").click();
  await page.locator("#modelTree .tree-children").first().waitFor({ state: "visible", timeout: 10000 });
  const cameraBeforeTreeSelection = await cameraPosition();
  await page.locator('.tree-row[data-depth="4"]').first().click();
  await page.waitForTimeout(350);
  const firstVisibleComponent = page.locator('.tree-row[data-depth="5"]:visible').first();
  await firstVisibleComponent.click();
  await page.waitForTimeout(500);
  const cameraAfterTreeSelection = await cameraPosition();
  const treeSelectedNodeId = await firstVisibleComponent.getAttribute("data-node-id");
  const activeAfterTreeSelection = await page.locator("#modelTree .tree-row.active").getAttribute("data-node-id");
  const propertyPanelAfterTreeSelection = await page.locator("#propertyContent").isVisible();
  await page.locator("#homeView").click();
  await page.waitForTimeout(500);
  const cameraBeforeShortcutFocus = await cameraPosition();
  await page.keyboard.press("f");
  await page.waitForTimeout(350);
  const cameraAfterShortcutFocus = await cameraPosition();

  await page.locator("#homeView").click();
  await page.waitForTimeout(700);
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
    await page.waitForTimeout(700);
  }
  const activeAfterModelPick = await page.locator("#modelTree .tree-row.active").getAttribute("data-node-id");
  const propertyPanelAfterModelPick = await page.locator("#propertyContent").isVisible();
  await page.waitForTimeout(1300);
  const interactionResults = {
    zoomInChangedCamera: distance(cameraInitial, cameraAfterZoomIn) > 0.01,
    zoomOutChangedCamera: distance(cameraAfterZoomIn, cameraAfterZoomOut) > 0.01,
    wheelZoomChangedCamera: distance(cameraAfterZoomOut, cameraAfterWheelZoom) > 0.01,
    wheelZoomStepRatio: distance(cameraAfterZoomOut, cameraAfterWheelZoom) / Math.max(distance(cameraInitial, { x: 0, y: 0, z: 0 }), 0.01),
    dragRotationChangedCamera: distance(cameraAfterWheelReset, cameraAfterDragRotation) > 0.01,
    middleDragChangedCamera: distance(cameraAfterDragRotation, cameraAfterPan) > 0.01,
    rotationChangedCamera: distance(cameraAfterZoomOut, cameraAfterSpin) > 0.01,
    structureLoaded: await page.locator("#modelTree .tree-row.child").count(),
    treeSelectionFocusedCamera: distance(cameraBeforeTreeSelection, cameraAfterTreeSelection) > 0.01,
    focusShortcutMovedCamera: distance(cameraBeforeShortcutFocus, cameraAfterShortcutFocus) > 0.01,
    treeSelectionActivatedNode: treeSelectedNodeId === activeAfterTreeSelection,
    treeSelectionDisplayedProperties: propertyPanelAfterTreeSelection,
    modelPickFoundFeature: Boolean(pickPosition),
    modelPickActivatedTreeNode: Boolean(activeAfterModelPick),
    modelPickChangedTreeNode: Boolean(activeAfterModelPick && activeAfterModelPick !== activeAfterTreeSelection),
    modelPickDisplayedProperties: propertyPanelAfterModelPick,
    leftReopenVisible,
    leftPanelRestored,
    rightReopenVisible,
    rightPanelRestored
  };
  const metrics = await page.evaluate(() => {
    const viewer = window.__viewer;
    const tileset = window.__tileset;
    const canvas = viewer?.canvas;
    let nonBackgroundPixels = null;
    if (canvas) {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const width = canvas.width;
        const height = canvas.height;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 25 || pixels[index + 1] > 25 || pixels[index + 2] > 25) count += 1;
        }
        nonBackgroundPixels = count;
      }
    }
    return {
      loadLabel: document.querySelector("#loadTime")?.textContent,
      fpsLabel: document.querySelector("#fpsMeter")?.textContent,
      serviceLabel: document.querySelector("#serviceText")?.textContent,
      debug: document.body.dataset.modelDebug ? JSON.parse(document.body.dataset.modelDebug) : null,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      tilesLoaded: tileset?.tilesLoaded,
      nonBackgroundPixels
    };
  });
  const screenshotPath = resolve("qa-model.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(JSON.stringify({
    navigationMs: Math.round(performance.now() - startedAt),
    initialScreenshotPath,
    screenshotPath,
    metrics,
    interactionResults,
    failedRequests,
    consoleMessages: consoleMessages.filter((item) => item.type === "error" || item.type === "warning")
  }, null, 2));
} finally {
  await browser.close();
}
