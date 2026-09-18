#!/usr/bin/env node
/* ============================================================
   test-cimbar-e2e.js — 「扫码取文件」解码链路的端到端验证

   做法：起一个静态服务把 app/www 暴露出来，用 Playwright 打开 tools/cimbar-e2e.html。
   该页面用同一个 wasm 模块做两件事：
     1) 当编码器：把一段字节渲染成 cimbar 动态码（GL 渲染 + readPixels 取帧）
     2) 当解码器：把取到的帧按真实路径喂给 cimbar/cimbar-recv.js（Worker → 喷泉码 → zstd）
   最后比对还原出来的字节和原始字节是否一致。不需要摄像头。

   依赖：playwright（未随仓库安装，属可选开发依赖）
     npm i -D playwright && npx playwright install chromium

   用法：
     node tools/test-cimbar-e2e.js                 # 默认 4 KB
     node tools/test-cimbar-e2e.js --bytes=200000  # 换个大小
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "app", "www");
const MP = path.join(ROOT, "miniprogram", "miniprogram");
const HARNESS = path.join(__dirname, "cimbar-e2e.html");
const PORT = Number(process.env.CIMBAR_E2E_PORT || 8731);
const BYTES = (process.argv.find((a) => a.indexOf("--bytes=") === 0) || "--bytes=4000").split("=")[1];
const RANDOM = process.argv.indexOf("--random") >= 0 ? "&random=1" : "";
// 自检开关：故意篡改原始数据首字节，用来确认「比对」这一步不是走过场
const TAMPER = process.argv.indexOf("--no-tamper") >= 0 ? "" : "&tamper=1";
// --engine=mp 时验证小程序端的 decoder.js，否则验证网页/App 端的 cimbar-recv.js
const ENGINE = process.argv.indexOf("--engine=mp") >= 0 ? "mp" : "web";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

// playwright 是可选开发依赖：先找项目内，再找常见的全局安装位置
// （不同 node 版本跑 `npm root -g` 结果不同，所以不能只依赖它）
function loadPlaywright() {
  const tried = [];
  const candidates = [];
  if (process.env.PLAYWRIGHT_PATH) candidates.push(process.env.PLAYWRIGHT_PATH);
  try {
    const globalDir = require("child_process")
      .execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim();
    if (globalDir) candidates.push(path.join(globalDir, "playwright"));
  } catch (e) {
    /* npm 不在 PATH 里也无所谓，下面还有兜底路径 */
  }
  const home = require("os").homedir();
  candidates.push(
    path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm", "node_modules", "playwright"),
    path.join(home, ".npm-global", "lib", "node_modules", "playwright"),
    "/usr/local/lib/node_modules/playwright",
    "/usr/lib/node_modules/playwright"
  );

  for (const p of candidates) {
    try {
      return require(p);
    } catch (e) {
      tried.push(p);
    }
  }
  try {
    return require("playwright");
  } catch (e) {
    throw new Error(
      "找不到 playwright。请任选一种方式安装：\n" +
        "  npm i -D playwright && npx playwright install chromium\n" +
        "  npm i -g playwright && npx playwright install chromium\n" +
        "也可以用 PLAYWRIGHT_PATH 指定路径。已尝试：\n  " +
        tried.join("\n  ")
    );
  }
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/_cimbar-e2e.html") {
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    return res.end(fs.readFileSync(HARNESS));
  }
  // /mp/** 映射到小程序源码目录，供测试页用 CommonJS shim 加载真实的 decoder.js
  const root = url.indexOf("/mp/") === 0 ? MP : WWW;
  const rel = url.indexOf("/mp/") === 0 ? url.slice(3) : url === "/" ? "/index.html" : url;
  const file = path.resolve(root, "." + rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  const { chromium } = loadPlaywright();
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const browser = await chromium.launch({
    // 无头 Chromium 需要软件渲染才能跑 cimbar 编码端的 GL
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("  console.error: " + m.text());
  });

  let ok = false;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/_cimbar-e2e.html?engine=${ENGINE}&bytes=${BYTES}${RANDOM}${TAMPER}`, { waitUntil: "load" });
    await page.waitForFunction("window.__e2e && window.__e2e.done", null, { timeout: 300000 });
    const r = await page.evaluate("window.__e2e");
    console.log(r.log.join("\n"));
    ok = r.ok;
  } catch (e) {
    const st = await page.evaluate("window.__e2e").catch(() => null);
    if (st && st.log) console.log(st.log.join("\n"));
    console.log("⏱ " + e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(ok ? "\n✅ cimbar 端到端验证通过（" + ENGINE + " 端）" : "\n❌ cimbar 端到端验证失败（" + ENGINE + " 端）");
  process.exit(ok ? 0 : 1);
})();
