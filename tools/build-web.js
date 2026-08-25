#!/usr/bin/env node
/* ============================================================
   build-web.js — 生成 web/ 目录：PWA 网页版变体
   复制 app/www 全部资源 + 注入 manifest / Service Worker 注册 / 图标，
   与安卓端共用同一份代码（localStorage 兜底存储，配置可用 Z1 文本/二维码互通）。
   产物不入库（见 .gitignore），GitHub Actions 构建后发布 Pages。
   本地预览：node tools/build-web.js 后任选静态服务器指向 web/（SW 需 http 环境）。
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "app", "www");
const OUT = path.join(ROOT, "web");

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.copyFileSync(path.join(ROOT, "app", "icon.png"), path.join(OUT, "icon.png"));

let html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
if (!html.includes("manifest.webmanifest")) {
  html = html.replace(
    "</head>",
    '  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="icon" href="icon.png" type="image/png">\n</head>'
  );
}
if (!html.includes("serviceWorker")) {
  html = html.replace(
    "</body>",
    '  <script>if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) navigator.serviceWorker.register("sw.js").catch(function () {});</script>\n</body>'
  );
}
fs.writeFileSync(path.join(OUT, "index.html"), html, "utf8");

fs.writeFileSync(
  path.join(OUT, "manifest.webmanifest"),
  JSON.stringify(
    {
      name: "下班了吗 ⏰",
      short_name: "下班了吗",
      description: "下班倒计时 · 进度 · 工资 · 排班 · 节假日",
      start_url: "./index.html",
      scope: "./",
      display: "standalone",
      orientation: "portrait",
      background_color: "#667eea",
      theme_color: "#667eea",
      icons: [{ src: "icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" }],
    },
    null,
    2
  )
);

// Service Worker：同源静态资源缓存优先（离线可用）；改资源时把 CACHE 版本号 +1
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./styles.css",
  "./custom-select.js",
  "./vent.js",
  "./qrcode.min.js",
  "./jsQR.js",
  "./lz-string.min.js",
  "./manifest.webmanifest",
  "./icon.png",
];
fs.writeFileSync(
  path.join(OUT, "sw.js"),
  `/* 由 tools/build-web.js 生成 */
const CACHE = "work-countdown-v1";
const ASSETS = ${JSON.stringify(ASSETS)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          })
          .catch(() => caches.match("./index.html"))
    )
  );
});
`
);
console.log("web/ 已生成：" + OUT + "（" + fs.readdirSync(OUT).length + " 个文件）");
