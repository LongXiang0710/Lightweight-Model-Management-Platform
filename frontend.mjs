import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const port = Number(process.env.FRONTEND_PORT || 5173);
const roots = {
  "/cesium/": resolve("vendor/cesium"),
  "/src/": resolve("src")
};
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".gif": "image/gif", ".woff": "font/woff", ".woff2": "font/woff2", ".ktx2": "image/ktx2"
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    let filePath = resolve("index.html");
    let cacheControl = "no-cache";
    for (const [prefix, root] of Object.entries(roots)) {
      if (pathname.startsWith(prefix)) {
        filePath = resolve(root, pathname.slice(prefix.length));
        if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) throw new Error("Invalid path");
        cacheControl = prefix === "/cesium/" ? "public, max-age=2592000" : "no-cache";
        break;
      }
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": cacheControl
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`前端网页服务已监听 0.0.0.0:${port}`);
});
