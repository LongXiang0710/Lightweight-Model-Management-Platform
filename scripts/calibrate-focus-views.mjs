import fs from "node:fs/promises";
import { chooseFocusView, deriveRootBounds } from "../src/focus-view.js";

const model = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/model-index.json", import.meta.url), "utf8"));
const components = model.nodes.filter((node) => node.depth === 5 && Array.isArray(node.bounds));
const rootNode = model.nodes.find((node) => model.roots?.includes(node.id));
const rootBounds = rootNode?.bounds || deriveRootBounds(components);
let adjusted = 0;
let defaultBlocked = 0;
let clearAfterCalibration = 0;
const residual = [];

for (const node of components) {
  const result = chooseFocusView(node, components, rootBounds);
  if (result.defaultOccluders > 0) defaultBlocked += 1;
  if (result.adjusted) adjusted += 1;
  if (result.occluders === 0) clearAfterCalibration += 1;
  else residual.push({ id: node.id, name: node.name, occluders: result.occluders, defaultOccluders: result.defaultOccluders, candidateIndex: result.candidateIndex });
}

residual.sort((left, right) => right.occluders - left.occluders || right.defaultOccluders - left.defaultOccluders);
const report = {
  componentCount: components.length,
  defaultBlocked,
  adjusted,
  clearAfterCalibration,
  residualCount: residual.length,
  residual
};
await fs.writeFile(new URL("../qa-focus-calibration.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, residual: undefined, worstResidual: residual.slice(0, 20) }, null, 2));
