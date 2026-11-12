import fs from "node:fs/promises";
import { syncTencentWeldingDates } from "../tencent-welding-sync.mjs";

const seed = JSON.parse(await fs.readFile(new URL("../动力站管道模型和属性文件/welding-dates.json", import.meta.url), "utf8"));
const result = await syncTencentWeldingDates(seed);
console.log(JSON.stringify({
  syncMode: result.syncMode,
  recordCount: result.recordCount,
  matchedRecordCount: result.matchedRecordCount,
  liveDateCount: result.liveDateCount,
  firstRecord: result.records[0],
  lastRecord: result.records.at(-1)
}, null, 2));
