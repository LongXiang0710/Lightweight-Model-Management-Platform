import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const children = [
  spawn(process.execPath, ["backend.mjs"], { stdio: "inherit" }),
  spawn(process.execPath, ["frontend.mjs"], { stdio: "inherit" })
];

setTimeout(() => {
  console.log("\n动力站轻量化模型管理平台已启动");
  console.log("  后端模型服务：http://localhost:4173");
  console.log("  前端访问地址：http://localhost:5173");
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        console.log(`  局域网访问：http://${address.address}:5173`);
      }
    }
  }
  console.log("");
}, 500);

function shutdown(signal) {
  for (const child of children) child.kill(signal);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) shutdown("SIGTERM");
  });
}
