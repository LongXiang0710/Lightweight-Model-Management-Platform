import { readFile } from "node:fs/promises";

const filePath = process.argv[2];
const data = await readFile(filePath);
const header = {
  magic: data.toString("ascii", 0, 4),
  version: data.readUInt32LE(4),
  byteLength: data.readUInt32LE(8),
  featureJson: data.readUInt32LE(12),
  featureBinary: data.readUInt32LE(16),
  batchJson: data.readUInt32LE(20),
  batchBinary: data.readUInt32LE(24)
};
const glbOffset = 28 + header.featureJson + header.featureBinary + header.batchJson + header.batchBinary;
const featureTable = JSON.parse(data.toString("utf8", 28, 28 + header.featureJson).replace(/\0/g, "").trim());
const batchStart = 28 + header.featureJson + header.featureBinary;
const batchTable = JSON.parse(data.toString("utf8", batchStart, batchStart + header.batchJson).replace(/\0/g, "").trim());
const glbMagic = data.toString("ascii", glbOffset, glbOffset + 4);
const jsonLength = data.readUInt32LE(glbOffset + 12);
const json = JSON.parse(data.toString("utf8", glbOffset + 20, glbOffset + 20 + jsonLength).replace(/\0/g, "").trim());
console.log(JSON.stringify({
  header,
  glbOffset,
  glbMagic,
  featureTable,
  batchTableKeys: Object.keys(batchTable),
  batchTableSample: Object.fromEntries(Object.entries(batchTable).slice(0, 8).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 3) : value])),
  asset: json.asset,
  scene: json.scene,
  scenes: json.scenes,
  nodeSample: json.nodes?.slice(0, 4),
  meshCount: json.meshes?.length,
  meshPrimitiveSample: json.meshes?.slice(0, 2).map((mesh) => mesh.primitives),
  materialSample: json.materials?.slice(0, 6),
  accessorSample: json.accessors?.slice(0, 12).map(({ componentType, type, normalized, count, min, max }) => ({ componentType, type, normalized, count, min, max })),
  accessorBounds: json.accessors?.filter((item) => item.min || item.max).slice(0, 12).map(({ type, min, max }) => ({ type, min, max }))
}, null, 2));
