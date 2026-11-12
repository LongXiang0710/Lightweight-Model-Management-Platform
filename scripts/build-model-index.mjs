import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const modelDirectory = "动力站管道模型和属性文件";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  );
}

function readBatchTable(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "b3dm") return null;
  const featureJsonLength = buffer.readUInt32LE(12);
  const featureBinaryLength = buffer.readUInt32LE(16);
  const batchJsonLength = buffer.readUInt32LE(20);
  const batchStart = 28 + featureJsonLength + featureBinaryLength;
  return JSON.parse(buffer.toString("utf8", batchStart, batchStart + batchJsonLength).replace(/\0/g, "").trim());
}

function vectorAt(value, index) {
  if (Array.isArray(value[index])) return value[index];
  return value.slice(index * 3, index * 3 + 3);
}

function unionBounds(left, right) {
  if (!right) return left;
  if (!left) return [...right];
  left[0] = Math.min(left[0], right[0]);
  left[1] = Math.min(left[1], right[1]);
  left[2] = Math.min(left[2], right[2]);
  left[3] = Math.max(left[3], right[3]);
  left[4] = Math.max(left[4], right[4]);
  left[5] = Math.max(left[5], right[5]);
  return left;
}

async function buildBoundsIndex() {
  const fileNames = (await readdir(modelDirectory))
    .filter((name) => name.toLowerCase().endsWith(".b3dm"))
    .sort((left, right) => {
      const priority = (name) => name.includes("LOD0") ? 0 : name.includes("LOD1") ? 1 : 2;
      return priority(left) - priority(right) || left.localeCompare(right);
    });
  const boundsByComponent = new Map();
  for (const fileName of fileNames) {
    const table = readBatchTable(await readFile(join(modelDirectory, fileName)));
    if (!table?.componentId || !table.boundsMin || !table.boundsMax) continue;
    table.componentId.forEach((componentId, index) => {
      if (boundsByComponent.has(componentId)) return;
      const minimum = vectorAt(table.boundsMin, index);
      const maximum = vectorAt(table.boundsMax, index);
      if (minimum.length === 3 && maximum.length === 3) {
        boundsByComponent.set(componentId, [...minimum, ...maximum]);
      }
    });
  }
  return boundsByComponent;
}

const [structureText, csvText, boundsByComponent] = await Promise.all([
  readFile(join(modelDirectory, "structure.json"), "utf8"),
  readFile(join(modelDirectory, "全部对象属性.csv"), "utf8"),
  buildBoundsIndex()
]);

const structure = JSON.parse(structureText.replace(/^\uFEFF/, ""));
const csvRows = parseCsv(csvText);
const csvByTreeKey = new Map(csvRows.map((row) => [row.tree_key, row]));
const nodes = [];
const componentToNode = {};
const omittedPropertyKeys = new Set([
  "root_name", "project_name", "unit_name", "depth", "node_seq", "tree_key",
  "parent_tree_key", "display_path", "has_children"
]);
let matchedPropertyRows = 0;

function compactProperties(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).filter(([key, value]) => value && !omittedPropertyKeys.has(key)));
}

function visit(source, parentId, depth, path, occurrence) {
  const segment = depth >= 4 ? `${source.name}[${occurrence}]` : source.name;
  const treeKey = path ? `${path}/${segment}` : segment;
  if (depth > 5) {
    const componentId = source.componentId;
    return {
      componentIds: componentId ? [componentId] : [],
      bounds: componentId ? boundsByComponent.get(componentId) || null : null
    };
  }

  const propertyRow = csvByTreeKey.get(treeKey);
  if (propertyRow) matchedPropertyRows += 1;
  const output = {
    id: source.id,
    parentId,
    name: source.name,
    depth,
    treeKey,
    children: [],
    componentIds: [],
    bounds: null,
    properties: compactProperties(propertyRow)
  };
  nodes.push(output);

  const nameCounts = new Map();
  for (const child of source.children || []) {
    const childOccurrence = (nameCounts.get(child.name) || 0) + 1;
    nameCounts.set(child.name, childOccurrence);
    const result = visit(child, source.id, depth + 1, treeKey, childOccurrence);
    if (depth + 1 <= 5) output.children.push(child.id);
    else {
      output.componentIds.push(...result.componentIds);
      for (const componentId of result.componentIds) componentToNode[componentId] = output.id;
    }
    output.bounds = unionBounds(output.bounds, result.bounds);
  }

  if (depth < 5) {
    for (const childId of output.children) {
      const child = nodes.find((node) => node.id === childId);
      output.bounds = unionBounds(output.bounds, child?.bounds || null);
    }
  }
  return { componentIds: output.componentIds, bounds: output.bounds };
}

const rootIds = [];
const rootNameCounts = new Map();
for (const root of structure.roots || []) {
  const occurrence = (rootNameCounts.get(root.name) || 0) + 1;
  rootNameCounts.set(root.name, occurrence);
  rootIds.push(root.id);
  visit(root, null, 0, "", occurrence);
}

const output = {
  version: 1,
  generatedFrom: ["tileset.json + b3dm", "structure.json", "全部对象属性.csv"],
  roots: rootIds,
  nodes,
  componentToNode,
  stats: {
    nodeCount: nodes.length,
    componentCount: Object.keys(componentToNode).length,
    propertyRowCount: csvRows.length,
    matchedPropertyRows,
    boundedComponentCount: boundsByComponent.size
  }
};

await writeFile(join(modelDirectory, "model-index.json"), JSON.stringify(output));
console.log(JSON.stringify(output.stats, null, 2));
