import { createRequire } from "node:module";

const nodeId = process.env.QA_NODE_ID;
if (!nodeId) throw new Error("QA_NODE_ID is required");
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/龙祥/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  args: ["--no-proxy-server", "--proxy-bypass-list=*"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto("http://127.0.0.1:5173/?qa=focus-node", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.locator("#loadingScreen").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.tree-row[data-depth="5"]').length > 1700, null, { timeout: 10000 });
  const clicked = await page.evaluate((targetNodeId) => {
    const row = document.querySelector(`.tree-row[data-node-id="${targetNodeId}"]`);
    if (!row) return false;
    let parent = row.parentElement;
    while (parent) {
      if (parent.classList.contains("tree-node")) parent.classList.add("expanded");
      parent = parent.parentElement;
    }
    row.click();
    return true;
  }, nodeId);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "qa-focus-node.png" });
  console.log(JSON.stringify({ clicked, focusView: JSON.parse(await page.locator("body").getAttribute("data-focus-view") || "{}") }));
} finally {
  await browser.close();
}
