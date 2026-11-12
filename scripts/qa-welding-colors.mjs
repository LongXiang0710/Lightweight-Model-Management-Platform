import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const modelIndex = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/model-index.json", import.meta.url), "utf8"));
const normalize = (value) => String(value ?? "").trim();
const targetLine = "WW-08001-80-QHA";
const targetWeld = "1";
const expectedWeldCount = modelIndex.nodes.filter((node) => normalize(node.properties?.["EP3D_焊点编号"])).length;
const targetNode = modelIndex.nodes.find((node) => {
  const properties = node.properties || {};
  return normalize(properties["EP3D_管 线 号"]) === targetLine && normalize(properties["EP3D_焊点编号"]) === targetWeld;
});
if (!targetNode) throw new Error("测试焊缝节点不存在");
const elementIds = ["EP3D_元件1编号", "EP3D_元件2编号"].map((field) => normalize(targetNode.properties[field])).filter((value) => value && value !== "-");
const adjacentComponentIds = modelIndex.nodes
  .filter((node) => normalize(node.properties?.["EP3D_管 线 号"]) === targetLine && elementIds.includes(normalize(node.properties?.["EP3D_元件编号"])))
  .flatMap((node) => node.componentIds || []);

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
  await page.route("**/api/welding-sync?**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    for (const record of payload.records) {
      record.weldingDate = "2026-08-18";
      record.virtual = false;
    }
    payload.liveDateCount = payload.records.length;
    payload.syncMode = "cloud-live";
    await route.fulfill({ response, json: payload });
  });

  await page.goto("http://127.0.0.1:5173/?qa=welding-colors", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction((expected) => {
    const state = JSON.parse(document.body.dataset.weldingVisualization || "{}");
    return state.weldedWelds === expected && state.seamFeatures > 0 && state.adjacentFeatures > 0;
  }, expectedWeldCount, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const visualization = await page.evaluate(() => JSON.parse(document.body.dataset.weldingVisualization || "{}"));
  const coloredFeatures = await page.evaluate(({ seamIds, adjacentIds }) => {
    const seam = new Set(seamIds);
    const adjacent = new Set(adjacentIds);
    const result = { seam: [], adjacent: [] };
    const visitContent = (content) => {
      if (!content) return;
      for (const inner of content.innerContents || []) visitContent(inner);
      for (let index = 0; index < Number(content.featuresLength || 0); index += 1) {
        const feature = content.getFeature(index);
        const id = String(feature.getProperty("componentId") ?? "");
        const rgb = [feature.color.red, feature.color.green, feature.color.blue].map((value) => Math.round(value * 255));
        if (seam.has(id)) result.seam.push({ id, rgb });
        if (adjacent.has(id)) result.adjacent.push({ id, rgb });
      }
    };
    const visitTile = (tile) => {
      visitContent(tile.content);
      for (const child of tile.children || []) visitTile(child);
    };
    visitTile(window.__tileset.root);
    return result;
  }, { seamIds: targetNode.componentIds || [], adjacentIds: adjacentComponentIds });

  await page.evaluate((nodeId) => {
    const row = document.querySelector(`.tree-row[data-node-id="${nodeId}"]`);
    if (!row) throw new Error("测试焊缝结构树节点不存在");
    let parent = row.parentElement;
    while (parent) {
      if (parent.classList.contains("tree-node")) parent.classList.add("expanded");
      parent = parent.parentElement;
    }
    row.click();
  }, targetNode.id);
  await page.waitForFunction(() => document.querySelector("#propertyList")?.textContent?.includes("2026-08-18"), null, { timeout: 5000 });
  const propertyText = await page.locator("#propertyList").innerText();
  const seamColorApplied = coloredFeatures.seam.some((feature) => feature.rgb.join(",") === "255,45,45");
  const adjacentColorApplied = coloredFeatures.adjacent.some((feature) => feature.rgb.join(",") === "255,176,0");
  const fpsText = await page.locator("#fpsMeter").innerText();
  const fps = Number.parseInt(fpsText, 10);

  console.log(JSON.stringify({
    visualization,
    displayedWeldedStatus: propertyText.includes("已焊接"),
    displayedCloudDate: propertyText.includes("2026-08-18"),
    seamColorApplied,
    adjacentColorApplied,
    coloredSeamFeaturesSeen: coloredFeatures.seam.length,
    coloredAdjacentFeaturesSeen: coloredFeatures.adjacent.length,
    fps,
    fpsAtLeast20: Number.isFinite(fps) && fps >= 20,
    consoleErrors
  }));
} finally {
  await browser.close();
}
