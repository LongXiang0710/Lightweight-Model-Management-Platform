import { createRequire } from "node:module";
import fs from "node:fs/promises";

const nodeId = process.env.QA_NODE_ID;
if (!nodeId) throw new Error("QA_NODE_ID is required");
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const model = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/model-index.json", import.meta.url), "utf8"));
const node = model.nodes.find((candidate) => candidate.id === nodeId);
if (!node?.bounds) throw new Error("Target node bounds are missing");
const views = [
  ["east", [1, 0, 0.7]], ["west", [-1, 0, 0.7]],
  ["north", [0, 1, 0.7]], ["south", [0, -1, 0.7]],
  ["north-east", [1, 1, 0.7]], ["north-west", [-1, 1, 0.7]],
  ["south-east", [1, -1, 0.7]], ["south-west", [-1, -1, 0.7]]
];
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", args: ["--no-proxy-server", "--proxy-bypass-list=*"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto("http://127.0.0.1:5173/?qa=focus-cardinals", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-row[data-depth="5"]').length > 1700, null, { timeout: 10000 });
  await page.evaluate((targetNodeId) => document.querySelector(`.tree-row[data-node-id="${targetNodeId}"]`)?.click(), nodeId);
  for (const [name, offset] of views) {
    await page.evaluate(({ bounds, offset }) => {
      const Cesium = window.Cesium;
      const viewer = window.__viewer;
      const center = new Cesium.Cartesian3((bounds[0] + bounds[3]) / 2, (bounds[1] + bounds[4]) / 2, (bounds[2] + bounds[5]) / 2);
      const radius = Math.max(Cesium.Cartesian3.distance(center, new Cesium.Cartesian3(bounds[3], bounds[4], bounds[5])), 0.05);
      const range = Math.max(radius * 4, window.__tileset.boundingSphere.radius * 0.055, 0.55);
      const vector = Cesium.Cartesian3.normalize(new Cesium.Cartesian3(...offset), new Cesium.Cartesian3());
      const position = Cesium.Cartesian3.add(center, Cesium.Cartesian3.multiplyByScalar(vector, range, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(center, position, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3());
      viewer.camera.setView({ destination: position, orientation: { direction, up } });
      viewer.scene.render();
    }, { bounds: node.bounds, offset });
    await page.screenshot({ path: `qa-focus-${name}.png` });
  }
  console.log(JSON.stringify({ nodeId, views: views.map(([name, offset]) => ({ name, offset })) }));
} finally {
  await browser.close();
}
