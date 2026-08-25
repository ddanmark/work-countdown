/* ============================================================
   holiday-feed.js — 在线节假日数据源 + 校验
   与安卓端 app.js 的 validateRemoteHolidayData 口径保持一致
   （规则同 tools/gen-holidays.js：白名单重建，非法即抛错）
   ============================================================ */

const HOLIDAY_FEED_URL = "https://gitee.com/Nasblance/work-countdown/raw/main/holidays.json";

function validateRemoteHolidayData(data) {
  function bad(m) { throw new Error(m); }
  if (!data || typeof data !== "object") bad("数据格式无效");
  var years = data.years;
  if (!years || typeof years !== "object" || Array.isArray(years)) bad("缺少 years 字段");
  var clean = {}, seen = {}, total = 0;
  var dateRe = /^\d{4}-\d{2}-\d{2}$/;
  Object.keys(years).forEach(function (y) {
    if (!/^\d{4}$/.test(y) || +y < 2020 || +y > 2099) bad("年份无效: " + y);
    if (!Array.isArray(years[y])) bad(y + " 年数据格式无效");
    var groups = [];
    years[y].forEach(function (g) {
      if (!g || typeof g.name !== "string" || !g.name || !Array.isArray(g.holidays) || !Array.isArray(g.workdays)) bad(y + " 年存在无效分组");
      var grp = { name: g.name, holidays: [], workdays: [] };
      function check(d, kind) {
        if (typeof d !== "string" || !dateRe.test(d)) bad("日期格式无效: " + d);
        var t = new Date(d + "T00:00:00");
        if (isNaN(t.getTime()) || t.getFullYear() !== +d.slice(0, 4) || t.getMonth() !== +d.slice(5, 7) - 1 || t.getDate() !== +d.slice(8, 10)) bad("无效日期: " + d);
        if (d.slice(0, 4) !== y) bad(d + " 与所在年份 " + y + " 不符");
        if (seen[d]) bad("日期重复: " + d);
        seen[d] = 1; grp[kind].push(d); total++;
      }
      g.holidays.forEach(function (d) { check(d, "holidays"); });
      g.workdays.forEach(function (d) { check(d, "workdays"); });
      groups.push(grp);
    });
    clean[y] = groups;
  });
  if (total === 0) bad("数据为空");
  if (total > 500) bad("数据量异常（>500 天）");
  return { years: clean, count: total };
}

module.exports = {
  HOLIDAY_FEED_URL,
  validateRemoteHolidayData,
};
