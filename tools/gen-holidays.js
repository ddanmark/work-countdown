#!/usr/bin/env node
/* ============================================================
   gen-holidays.js — 法定节假日数据生成器
   数据源: holidays.json（单一来源）
   目标:   ① app/www/app.js            （HOLIDAY_GROUPS 数组段）
           ② miniprogram/miniprogram/utils/holidays.js（同上）
           ③ WidgetConfig.java          （BUILTIN_HOLIDAYS static 初始化段）

   每年国务院发布放假安排后：在 holidays.json 里加年份分组，
   运行 `node tools/gen-holidays.js`，再照常 build.bat / 小程序工具上传。
   幂等：可重复运行，只重写标记之间的内容。
   ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "holidays.json");

const BEGIN = "// @holidays-gen:begin";
const END = "// @holidays-gen:end";
const NOTE = " —— 本段由 tools/gen-holidays.js 从 holidays.json 生成，勿手改";

function fail(msg) {
  console.error("[gen-holidays] 错误: " + msg);
  process.exit(1);
}

// ---------- 读取并校验数据源 ----------
let years;
try {
  years = JSON.parse(fs.readFileSync(SRC, "utf8")).years;
} catch (e) {
  fail("无法解析 holidays.json: " + e.message);
}
if (!years || typeof years !== "object" || Array.isArray(years)) fail("holidays.json 缺少 years 对象");

const yearKeys = Object.keys(years).sort();
if (yearKeys.length === 0) fail("years 为空");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const seen = new Map(); // date -> "组名"
for (const y of yearKeys) {
  if (!/^\d{4}$/.test(y)) fail("年份 key 格式错误: " + y);
  if (!Array.isArray(years[y])) fail("years." + y + " 应为数组");
  for (const g of years[y]) {
    if (!g.name || !Array.isArray(g.holidays) || !Array.isArray(g.workdays)) {
      fail(`${y} 存在缺少 name/holidays/workdays 的分组`);
    }
    for (const [d, kind] of [
      ...g.holidays.map((d) => [d, "holidays"]),
      ...g.workdays.map((d) => [d, "workdays"]),
    ]) {
      if (!DATE_RE.test(d)) fail(`日期格式错误: "${d}"（${g.name}.${kind}）`);
      const t = new Date(d + "T00:00:00Z");
      if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) fail("非法日期: " + d);
      if (!d.startsWith(y + "-")) fail(`${d} 出现在 ${y} 年分组（${g.name}）内，但日期年份不符`);
      if (seen.has(d)) fail(`日期重复: ${d} 同时出现在「${seen.get(d)}」和「${g.name}」`);
      seen.set(d, g.name);
    }
  }
}
console.log(`数据源 OK: ${yearKeys.join("、")} 年，共 ${seen.size} 个日期`);

// ---------- 生成 JS 端 HOLIDAY_GROUPS 数组段 ----------
function prettyArr(a) {
  return JSON.stringify(a).split('","').join('", "');
}
function jsGroupsContent(indent, extraHeader) {
  const pad = " ".repeat(indent);
  const L = [];
  if (extraHeader) L.push(extraHeader);
  L.push(`${pad}const HOLIDAY_GROUPS = [`);
  for (const y of yearKeys) {
    L.push(`${pad}  // ---- ${y} ----`);
    for (const g of years[y]) {
      L.push(`${pad}  { name: ${JSON.stringify(g.name)}, holidays: ${prettyArr(g.holidays)}, workdays: ${prettyArr(g.workdays)} },`);
    }
  }
  L.push(`${pad}];`);
  return L.join("\n");
}

// ---------- 生成 Java 端 static 初始化段 ----------
function javaPut(fn, ds) {
  const MAX_PER_LINE = 4;
  const nLines = Math.ceil(ds.length / MAX_PER_LINE);
  const base = Math.floor(ds.length / nLines);
  const extra = ds.length % nLines; // 前 extra 行每行 base+1 个，均匀切分避免孤行
  const parts = [];
  let i = 0;
  for (let li = 0; li < nLines; li++) {
    const take = base + (li < extra ? 1 : 0);
    parts.push(ds.slice(i, i + take).map((d) => `"${d}"`).join(", "));
    i += take;
  }
  if (parts.length === 1) return `        ${fn}(${parts[0]});`;
  return parts
    .map((p, li) => {
      const lastLine = li === parts.length - 1;
      if (li === 0) return `        ${fn}(${p},`;
      return `                ${p}${lastLine ? ");" : ","}`;
    })
    .join("\n");
}
function javaStaticContent() {
  const L = [];
  L.push(`    // ---------- 法定节假日 / 调休（${yearKeys.join("、")}）与前端 HOLIDAY_GROUPS 同源生成 ----------`);
  L.push("    static {");
  for (const y of yearKeys) {
    L.push(`        // ---- ${y} ----`);
    for (const g of years[y]) {
      L.push(`        // ${g.name}`);
      if (g.holidays.length) L.push(javaPut("putHolidays", g.holidays));
      if (g.workdays.length) L.push(javaPut("putWorkdays", g.workdays));
    }
  }
  L.push("    }");
  return L.join("\n");
}

// ---------- 用标记替换目标文件段落 ----------
function rewrite(relPath, content) {
  const p = path.join(ROOT, relPath);
  const s = fs.readFileSync(p, "utf8");
  const bi = s.indexOf(BEGIN);
  const ei = s.indexOf(END);
  if (bi < 0 || ei < 0 || ei < bi) fail(`${relPath} 缺少 ${BEGIN} / ${END} 标记对`);
  const out = s.slice(0, bi) + BEGIN + NOTE + "\n" + content + "\n" + s.slice(ei);
  if (out === s) {
    console.log(`  ✔ ${relPath} 无变化`);
  } else {
    fs.writeFileSync(p, out);
    console.log(`  ✎ ${relPath} 已更新`);
  }
}

console.log("生成目标:");
rewrite("app/www/app.js", jsGroupsContent(2));
rewrite("miniprogram/miniprogram/utils/holidays.js", jsGroupsContent(0));
rewrite(path.join("app/android/app/src/main/java/com/workcountdown/app/WidgetConfig.java"), javaStaticContent());
console.log("完成。安卓端记得 npx cap copy android + build.bat 同步 assets/public。");
