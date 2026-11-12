import { createRequire } from "node:module";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const model = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/model-index.json", import.meta.url), "utf8"));
const calibrationReport = JSON.parse(await fs.readFile(new URL("../qa-focus-calibration.json", import.meta.url), "utf8"));
const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
const residual = calibrationReport.residual.map((calibration) => ({ node: nodesById.get(calibration.id), calibration })).filter(({ node }) => node);

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--no-proxy-server", "--proxy-bypass-list=*"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto("http://127.0.0.1:5173/?qa=focus-occlusion", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => window.__tileset?.tilesLoaded === true, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-row[data-depth="5"]').length > 1700, null, { timeout: 10000 });
  const lowVisibility = [];
  let visible = 0;
  for (const { node, calibration } of residual) {
    await page.evaluate((nodeId) => document.querySelector(`.tree-row[data-node-id="${nodeId}"]`)?.click(), node.id);
    await page.waitForTimeout(55);
    const targetPicks = await page.evaluate((componentIds) => {
      const target = new Set(componentIds);
      const viewer = window.__viewer;
      viewer.scene.render();
      const width = viewer.canvas.clientWidth;
      const height = viewer.canvas.clientHeight;
      let matches = 0;
      for (let y = height / 2 - 126; y <= height / 2 + 126; y += 14) {
        for (let x = width / 2 - 126; x <= width / 2 + 126; x += 14) {
          const picked = viewer.scene.pick(new window.Cesium.Cartesian2(x, y));
          const componentId = picked?.getProperty?.("componentId");
          if (componentId !== undefined && componentId !== null && target.has(String(componentId))) matches += 1;
        }
      }
      return matches;
    }, node.componentIds || []);
    if (targetPicks >= 3) visible += 1;
    else lowVisibility.push({ id: node.id, name: node.name, targetPicks, ...calibration });
  }
  const result = {
    residualChecked: residual.length,
    visiblyClear: visible,
    lowVisibilityCount: lowVisibility.length,
    lowVisibility
  };
  await fs.writeFile(new URL("../qa-focus-occlusion-results.json", import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ residualChecked: result.residualChecked, visiblyClear: result.visiblyClear, lowVisibilityCount: result.lowVisibilityCount }));
} finally {
  await browser.close();
}
