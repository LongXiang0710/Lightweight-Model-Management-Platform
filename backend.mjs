import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { syncTencentWeldingDates, TENCENT_WELDING_SOURCE_URL } from "./tencent-welding-sync.mjs";

const port = Number(process.env.BACKEND_PORT || 4173);
const modelDirectory = resolve("动力站管道模型和属性文件");
const weldingSeed = JSON.parse(await readFile(resolve(modelDirectory, "welding-dates.json"), "utf8"));

const mimeTypes = { ".json": "application/json; charset=utf-8", ".b3dm": "application/octet-stream", ".csv": "text/csv; charset=utf-8" };

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (request.url === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      model: "动力站管道模型",
      source: "tileset.json + b3dm",
      weldingSource: TENCENT_WELDING_SOURCE_URL,
      weldingSync: "browser-refresh",
      time: new Date().toISOString()
    });
    return;
  }

  if (request.url?.startsWith("/api/welding-sync")) {
    try {
      sendJson(response, 200, await syncTencentWeldingDates(weldingSeed));
    } catch (error) {
      console.error("腾讯文档焊接日期同步失败：", error);
      sendJson(response, 200, {
        ...weldingSeed,
        records: weldingSeed.records.map((record) => ({ ...record, weldingDate: null, virtual: false })),
        schemaVersion: 2,
        syncedAt: new Date().toISOString(),
        syncMode: "cloud-error",
        liveDateCount: 0,
        syncError: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (!request.url?.startsWith("/model/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const relativePath = decodeURIComponent(request.url.slice("/model/".length).split("?")[0]);
    const filePath = resolve(modelDirectory, relativePath);
    if (filePath !== modelDirectory && !filePath.startsWith(`${modelDirectory}${sep}`)) throw new Error("Invalid path");
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    const extension = extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": extension === ".b3dm" ? "public, max-age=31536000, immutable" : "no-cache"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Model resource not found" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`后端模型服务已监听 0.0.0.0:${port}`);
});
