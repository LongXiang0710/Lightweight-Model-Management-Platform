import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { focusCandidateOffsets } from "../src/focus-view.js";

const nodeId = process.env.QA_NODE_ID;
if (!nodeId) throw new Error("QA_NODE_ID is required");
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const model = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/model-index.json", import.meta.url), "utf8"));
const node = model.nodes.find((candidate) => candidate.id === nodeId);
const root = model.nodes.find((candidate) => model.roots?.includes(candidate.id));
if (!node?.bounds || !root?.bounds) throw new Error("Target node or root bounds are missing");
const offsets = focusCandidateOffsets(node.bounds, root.bounds);
const startIndex = Number(process.env.QA_START || 0);
const candidateCount = Number(process.env.QA_COUNT || offsets.length);
const endIndex = Math.min(offsets.length, startIndex + candidateCount);
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--no-proxy-server", "--proxy-bypass-list=*"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto("http://127.0.0.1:5173/?qa=focus-candidates", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-row[data-depth="5"]').length > 1700, null, { timeout: 10000 });
  await page.evaluate((targetNodeId) => document.querySelector(`.tree-row[data-node-id="${targetNodeId}"]`)?.click(), nodeId);
  await page.waitForTimeout(300);
  const results = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const targetPicks = await page.evaluate(({ bounds, offset, componentIds }) => {
      const Cesium = window.Cesium;
      const viewer = window.__viewer;
      const center = new Cesium.Cartesian3(
        (bounds[0] + bounds[3]) / 2,
        (bounds[1] + bounds[4]) / 2,
        (bounds[2] + bounds[5]) / 2
      );
      const corner = new Cesium.Cartesian3(bounds[3], bounds[4], bounds[5]);
      const radius = Math.max(Cesium.Cartesian3.distance(center, corner), 0.05);
      const range = Math.max(radius * 4, window.__tileset.boundingSphere.radius * 0.055, 0.55);
      const offsetVector = Cesium.Cartesian3.normalize(new Cesium.Cartesian3(...offset), new Cesium.Cartesian3());
      const position = Cesium.Cartesian3.add(center, Cesium.Cartesian3.multiplyByScalar(offsetVector, range, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(center, position, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      let right = Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.magnitudeSquared(right) < 1e-8) right = Cesium.Cartesian3.clone(viewer.camera.right, right);
      Cesium.Cartesian3.normalize(right, right);
      const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      viewer.camera.setView({ destination: position, orientation: { direction, up } });
      viewer.scene.render();
      const target = new Set(componentIds);
      let matches = 0;
      for (let y = viewer.canvas.clientHeight / 2 - 210; y <= viewer.canvas.clientHeight / 2 + 210; y += 12) {
        for (let x = viewer.canvas.clientWidth / 2 - 210; x <= viewer.canvas.clientWidth / 2 + 210; x += 12) {
          const picked = viewer.scene.pick(new Cesium.Cartesian2(x, y));
          const componentId = picked?.getProperty?.("componentId");
          if (componentId !== undefined && componentId !== null && target.has(String(componentId))) matches += 1;
        }
      }
      return matches;
    }, { bounds: node.bounds, offset: offsets[index], componentIds: node.componentIds || [] });
    results.push({ index, offset: offsets[index], targetPicks });
  }
  results.sort((left, right) => right.targetPicks - left.targetPicks || left.index - right.index);
  const best = results[0];
  await page.evaluate(({ bounds, offset }) => {
    const Cesium = window.Cesium;
    const viewer = window.__viewer;
    const center = new Cesium.Cartesian3((bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2);
    const radius = Math.max(Cesium.Cartesian3.distance(center, new Cesium.Cartesian3(bounds[3], bounds[4], bounds[5])), 0.05);
    const range = Math.max(radius * 4, window.__tileset.boundingSphere.radius * 0.055, 0.55);
    const offsetVector = Cesium.Cartesian3.normalize(new Cesium.Cartesian3(...offset), new Cesium.Cartesian3());
    const position = Cesium.Cartesian3.add(center, Cesium.Cartesian3.multiplyByScalar(offsetVector, range, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(center, position, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    viewer.camera.setView({ destination: position, orientation: { direction, up } });
    viewer.scene.render();
  }, { bounds: node.bounds, offset: best.offset });
  await page.screenshot({ path: `qa-focus-candidate-${startIndex}.png` });
  const result = { nodeId, startIndex, endIndex, best, candidates: results };
  await fs.writeFile(new URL(`../qa-focus-candidate-${startIndex}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ nodeId, startIndex, endIndex, best, top: results.slice(0, 5) }, null, 2));
} finally {
  await browser.close();
}
