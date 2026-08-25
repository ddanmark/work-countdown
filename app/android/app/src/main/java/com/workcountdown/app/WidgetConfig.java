package com.workcountdown.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * 小部件配置读取 + 倒计时计算（从 www/app.js 的 JS 逻辑移植）。
 * 从 Capacitor Preferences 插件的 SharedPreferences 文件读取排班配置。
 *
 * 工时口径与前端 app.js 完全对齐：含 2026 法定节假日/调休、用户自定义节假日、
 * 请假、大小周（含小周 small 覆盖）。今日/本周/本月进度与已赚工资同源。
 */
public class WidgetConfig {

    private static final String PREFS_FILE = "CapacitorStorage";
    // 必须与前端 app/www/app.js 的 STORAGE_KEY 保持一致（v3）。
    private static final String STORAGE_KEY = "work-countdown-config-v3";

    // 一天的排班
    public static class DaySchedule {
        boolean enabled;
        String workStart = "09:00";
        String workEnd = "18:00";
        // breaks: [{name, start, end}, ...]
        String[][] breaks = new String[0][3]; // [name, start, end]
    }

    // 当前状态计算结果
    public static class Status {
        public String statusText;          // 完整文字（兼容/备用）
        public String label;               // "working"/"break"/"off"/"before"/"holiday"
        public String headline;            // 短标签："距下班"/"距上班"/"午休"/"已下班"/"休息日"
        public String timeText;            // 今日纯时长："3:25:30"；无倒计时的状态为 ""
        public long todayRemainMs;         // 今日倒计时剩余毫秒（驱动 Chronometer）；无倒计时为 0
        public int progress;               // 今日工作进度 0-100
        public String subText;             // 副文字
        public String onTimeStr;           // 上班 "09:00"
        public String offTimeStr;          // 下班 "18:00"
        public String nextBreakStr;        // 下个休息段（名称+时间点）"午休 12:00"
        public String nextBreakCountdown;  // 下个休息倒计时 "2:30"；无则 ""
        public String earnedText;          // 今日已赚 "¥238.00"；无工资/非工作时段 ""
        public String weekRemain;          // 本周剩余工时 "2天4时"
        public String weekEarned;          // 本周已赚 "¥1200.00"；无工资 ""
        public String monthRemain;         // 本月剩余工时 "8天"
        public String monthEarned;         // 本月已赚
        public int todayPct;               // 今日完成度 0-100（进度弧用）
        public int weekPct;                // 本周完成度 0-100
        public int monthPct;               // 本月完成度 0-100
    }

    /** 读取配置 JSON */
    public static JSONObject loadConfig(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            String json = prefs.getString(STORAGE_KEY, null);
            if (json != null) return new JSONObject(json);
        } catch (Exception e) { /* ignore */ }
        return null;
    }

    /**
     * 读取用户在 App 内选择的背景配色序号（与 vent.js 的 BG_KEY="work-countdown-bg" 同源，
     * 同样存在 CapacitorStorage 文件里）。共 12 套，默认 0。Widget 据此选 widget_palette_N 渐变。
     */
    public static int loadBgPaletteIdx(Context ctx) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            String v = prefs.getString("work-countdown-bg", null);
            if (v != null) {
                int idx = Integer.parseInt(v.trim());
                if (idx >= 0 && idx < 12) return idx;
            }
        } catch (Exception e) { /* ignore */ }
        return 0;
    }

    // ---------- 2026 法定节假日 / 调休（与前端 HOLIDAY_GROUPS 完全一致） ----------
    private static final java.util.Map<String, String> BUILTIN_HOLIDAYS = new java.util.HashMap<>();
    static {
        // 元旦
        putHolidays("2026-01-01", "2026-01-02", "2026-01-03");
        putWorkdays("2026-01-04");
        // 春节
        putHolidays("2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18",
                "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23");
        putWorkdays("2026-02-14", "2026-02-28");
        // 清明
        putHolidays("2026-04-05", "2026-04-06", "2026-04-07");
        // 劳动节
        putHolidays("2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05");
        putWorkdays("2026-05-09");
        // 端午
        putHolidays("2026-06-19", "2026-06-20", "2026-06-21");
        // 中秋
        putHolidays("2026-09-25", "2026-09-26", "2026-09-27");
        // 国庆
        putHolidays("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
                "2026-10-05", "2026-10-06", "2026-10-07");
        putWorkdays("2026-09-20", "2026-10-10");
    }
    private static void putHolidays(String... ds) { for (String d : ds) BUILTIN_HOLIDAYS.put(d, "holiday"); }
    private static void putWorkdays(String... ds) { for (String d : ds) BUILTIN_HOLIDAYS.put(d, "workday"); }

    private static String ymd(Calendar d) {
        return String.format(java.util.Locale.US, "%04d-%02d-%02d",
                d.get(Calendar.YEAR), d.get(Calendar.MONTH) + 1, d.get(Calendar.DAY_OF_MONTH));
    }

    /** 节假日覆盖：用户自定义优先 > 已删除内置(返回null) > 内置法定。值为 "holiday"/"workday" 或 null */
    private static String getHolidayOverride(JSONObject config, Calendar date) {
        String key = ymd(date);
        JSONObject holidays = config.optJSONObject("holidays");
        if (holidays != null && holidays.has(key)) return holidays.optString(key, null);
        JSONObject deleted = config.optJSONObject("deletedBuiltinHolidays");
        if (deleted != null && deleted.has(key)) return null;
        return BUILTIN_HOLIDAYS.get(key);
    }

    private static boolean isLeaveDay(JSONObject config, Calendar date) {
        JSONObject leaves = config.optJSONObject("leaves");
        return leaves != null && leaves.has(ymd(date));
    }

    /**
     * 获取某天生效的排班（含上下班时间和休息段）。
     * 大小周模式下：小周的周一~周五若配置了 small 覆盖，则读 small 的时间/休息，
     * 否则回退主字段。与前端 app.js daySchedule(date) 对齐。
     */
    public static DaySchedule getDay(JSONObject config, Calendar date) {
        DaySchedule day = new DaySchedule();
        int dayOfWeek = date.get(Calendar.DAY_OF_WEEK);
        int jsDay = dayOfWeek == Calendar.SUNDAY ? 0 : dayOfWeek - 1;
        try {
            JSONObject schedules = config.getJSONObject("schedules");
            JSONObject d = schedules.getJSONObject(String.valueOf(jsDay));
            day.enabled = d.optBoolean("enabled", false);

            JSONObject src = d;
            String mode = config.optString("mode", "fixed");
            if ("bigSmall".equals(mode) && jsDay >= 1 && jsDay <= 5 && !isBigWeek(config, date)) {
                JSONObject small = d.optJSONObject("small");
                if (small != null) src = small;
            }

            day.workStart = src.optString("workStart", "09:00");
            day.workEnd = src.optString("workEnd", "18:00");
            JSONArray arr = src.optJSONArray("breaks");
            if (arr != null && arr.length() > 0) {
                day.breaks = new String[arr.length()][3];
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject b = arr.getJSONObject(i);
                    day.breaks[i][0] = b.optString("name", "休息" + (i + 1));
                    day.breaks[i][1] = b.optString("start", "12:00");
                    day.breaks[i][2] = b.optString("end", "13:00");
                }
            }
        } catch (Exception e) { /* 用默认值 */ }
        return day;
    }

    /** 判断某天是否为工作日（与前端 isWorkDay 对齐：节假日/调休/全天假/大小周；时段假当天仍算工作日） */
    public static boolean isWorkDay(JSONObject config, Calendar date) {
        String override = getHolidayOverride(config, date);
        boolean leave = isFullLeaveDay(config, date);
        if ("workday".equals(override)) {
            return !leave;                       // 调休上班日：除非请假否则上班
        }
        if ("holiday".equals(override)) return false;
        if (leave) return false;
        int jsDay = date.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY ? 0 : date.get(Calendar.DAY_OF_WEEK) - 1;
        DaySchedule day = getDay(config, date);
        String mode = config.optString("mode", "fixed");
        // 大小周的周六只看大小周与起止时间，不看 enabled（前端 app.js 同此逻辑；
        // 切到大小周时前端只补 workStart/workEnd，不会把周六 enabled 置 true）
        if ("bigSmall".equals(mode) && jsDay == 6) {
            return isBigWeek(config, date) && !day.workStart.isEmpty() && !day.workEnd.isEmpty();
        }
        return day.enabled;
    }

    /** 带薪假类型：年假/婚假/产假/丧假的请假时段照常计薪（不影响当月工资）；
     *  事假/病假/其他完全不计。与前端 app.js、小程序 schedule.js 保持一致。 */
    private static final java.util.Set<String> PAID_LEAVE_REASONS = new java.util.HashSet<>(
            java.util.Arrays.asList("年假", "婚假", "产假", "丧假"));

    /** 请假条目：reason=类型；start/end 非空表示按时段请假（HH:MM-HH:MM），null 表示全天 */
    static class LeaveInfo {
        final String reason;
        final String start;
        final String end;
        LeaveInfo(String reason, String start, String end) {
            this.reason = reason;
            this.start = start;
            this.end = end;
        }
    }

    /** "H:MM"/"HH:MM" → 规范 "HH:MM"；非法返回 null */
    static String normHM(String s) {
        if (s == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^(\\d{1,2}):(\\d{2})$").matcher(s);
        if (!m.matches()) return null;
        int h = Integer.parseInt(m.group(1));
        int mi = Integer.parseInt(m.group(2));
        if (h > 23 || mi > 59) return null;
        return String.format(java.util.Locale.US, "%02d:%02d", h, mi);
    }

    /** 解析单个请假条目：对象 {reason,start,end}（时段非法回退全天）；字符串=全天 */
    static LeaveInfo parseLeaveEntry(Object v) {
        if (v instanceof JSONObject) {
            JSONObject o = (JSONObject) v;
            String r = normalizeLeaveReason(o.optString("reason", null));
            if (r == null) r = "请假";
            String s = normHM(o.optString("start", null));
            String e = normHM(o.optString("end", null));
            if (s != null && e != null && s.compareTo(e) < 0) return new LeaveInfo(r, s, e);
            return new LeaveInfo(r, null, null);
        }
        String r = normalizeLeaveReason(v == null ? null : String.valueOf(v));
        return new LeaveInfo(r == null ? "请假" : r, null, null);
    }

    /** 解析 leaves[date] 的值 → 条目数组（同一天可多段）：字符串/对象=单条；数组=多条 */
    static LeaveInfo[] parseLeaveValue(Object v) {
        if (v instanceof org.json.JSONArray) {
            org.json.JSONArray arr = (org.json.JSONArray) v;
            LeaveInfo[] out = new LeaveInfo[arr.length()];
            for (int i = 0; i < arr.length(); i++) out[i] = parseLeaveEntry(arr.opt(i));
            return out;
        }
        return new LeaveInfo[]{parseLeaveEntry(v)};
    }

    /** 某天的请假条目数组；无请假返回 null */
    static LeaveInfo[] leaveInfosOf(JSONObject config, Calendar date) {
        JSONObject leaves = config.optJSONObject("leaves");
        if (leaves == null) return null;
        String key = ymd(date);
        if (!leaves.has(key)) return null;
        return parseLeaveValue(leaves.opt(key));
    }

    /** 某天的请假类型（第一条）；无请假返回 null */
    static String leaveReasonOf(JSONObject config, Calendar date) {
        LeaveInfo[] lvs = leaveInfosOf(config, date);
        return (lvs == null || lvs.length == 0) ? null : lvs[0].reason;
    }

    /** 全天假（任一条目无时段即视为全天，整天按休息处理）；纯时段假当天仍是工作日 */
    static boolean isFullLeaveDay(JSONObject config, Calendar date) {
        LeaveInfo[] lvs = leaveInfosOf(config, date);
        if (lvs == null || lvs.length == 0) return false;
        for (LeaveInfo l : lvs) if (l.start == null) return true;
        return false;
    }

    /** 归一化请假类型：小程序端存储带 emoji 前缀（"🌴 年假"），安卓端为裸值（"年假"），
     *  配置互通后两种形式都会出现，比较/展示前先去掉 emoji 等非汉字前缀 */
    static String normalizeLeaveReason(String r) {
        if (r == null) return null;
        int i = 0;
        while (i < r.length()) {
            char c = r.charAt(i);
            if (c >= 0x4E00 && c <= 0x9FFF) break;   // 第一个汉字开始保留
            i++;
        }
        String out = r.substring(i).trim();
        return out.isEmpty() ? null : out;
    }

    /** 不考虑请假的"本该上班"判定：带薪假只在本来要上班的日子才计入 */
    static boolean isWorkDayIgnoringLeave(JSONObject config, Calendar date) {
        String override = getHolidayOverride(config, date);
        if ("workday".equals(override)) return true;
        if ("holiday".equals(override)) return false;
        int jsDay = date.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY ? 0 : date.get(Calendar.DAY_OF_WEEK) - 1;
        DaySchedule day = getDay(config, date);
        String mode = config.optString("mode", "fixed");
        // 同 isWorkDay：大小周的周六不看 enabled
        if ("bigSmall".equals(mode) && jsDay == 6) {
            return isBigWeek(config, date) && !day.workStart.isEmpty() && !day.workEnd.isEmpty();
        }
        return day.enabled;
    }

    /** 任一条目为带薪类型且当天本该上班（"今日已赚照常累计"的开关） */
    static boolean isPaidLeaveDay(JSONObject config, Calendar date) {
        LeaveInfo[] lvs = leaveInfosOf(config, date);
        if (lvs == null) return false;
        for (LeaveInfo l : lvs) if (PAID_LEAVE_REASONS.contains(l.reason)) return isWorkDayIgnoringLeave(config, date);
        return false;
    }

    /**
     * 有效排班：把当天各段"按时段请假"作为附加休息段注入——工时扣减、"假中"状态、
     * 下次休息/请假提示全部复用休息段机制，时段与午休/彼此重叠部分不重复扣。
     * onlyUnpaid=true 时只注入不带薪条目（工资口径：带薪时段照常计薪，不扣）。
     * getDay 每次返回新对象，可安全修改。
     */
    static DaySchedule effectiveDay(JSONObject config, Calendar date, boolean onlyUnpaid) {
        DaySchedule sch = getDay(config, date);
        LeaveInfo[] lvs = leaveInfosOf(config, date);
        if (lvs == null) return sch;
        int n = 0;
        for (LeaveInfo l : lvs) {
            if (l.start != null && (!onlyUnpaid || !PAID_LEAVE_REASONS.contains(l.reason))) n++;
        }
        if (n == 0) return sch;
        String[][] nb = new String[sch.breaks.length + n][3];
        System.arraycopy(sch.breaks, 0, nb, 0, sch.breaks.length);
        int k = sch.breaks.length;
        for (LeaveInfo l : lvs) {
            if (l.start != null && (!onlyUnpaid || !PAID_LEAVE_REASONS.contains(l.reason))) {
                nb[k++] = new String[]{l.reason, l.start, l.end};
            }
        }
        sch.breaks = nb;
        return sch;
    }

    /** 判断某天是否属于"大周"（周六上班的那周） */
    public static boolean isBigWeek(JSONObject config, Calendar date) {
        try {
            JSONObject anchor = config.optJSONObject("bigSmallAnchor");
            if (anchor == null) return true;
            String mondayStr = anchor.optString("monday", null);
            if (mondayStr == null) return true;
            String[] parts = mondayStr.split("-");
            Calendar anchorMonday = Calendar.getInstance();
            anchorMonday.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 0, 0, 0);
            anchorMonday.set(Calendar.MILLISECOND, 0);
            Calendar weekMonday = getMondayOfWeek(date);
            long diff = weekMonday.getTimeInMillis() - anchorMonday.getTimeInMillis();
            long weeks = diff / (7L * 24 * 3600 * 1000);
            boolean anchorIsBig = "big".equals(anchor.optString("type", "big"));
            boolean sameAsAnchor = (weeks % 2 == 0);
            return sameAsAnchor ? anchorIsBig : !anchorIsBig;
        } catch (Exception e) {
            return true;
        }
    }

    /** 获取某天所在自然周的周一 */
    public static Calendar getMondayOfWeek(Calendar date) {
        Calendar d = (Calendar) date.clone();
        int day = d.get(Calendar.DAY_OF_WEEK);
        int diff = day == Calendar.SUNDAY ? -6 : 2 - day;
        d.add(Calendar.DAY_OF_MONTH, diff);
        d.set(Calendar.HOUR_OF_DAY, 0);
        d.set(Calendar.MINUTE, 0);
        d.set(Calendar.SECOND, 0);
        d.set(Calendar.MILLISECOND, 0);
        return d;
    }

    /**
     * 把 "HH:MM" 转成当天 Calendar。
     * 容错：配置里可能存在空串/非数字（畸形配置、导入损坏），
     * 这里校验后回退为 base 本身（等效 0 时长区间），绝不抛异常——
     * 否则 computeStatus 在每个 tick 里崩溃，widget 永久卡死。
     */
    public static Calendar timeToCalendar(String hhmm, Calendar base) {
        Calendar d = (Calendar) base.clone();
        if (hhmm == null) return d;
        String[] parts = hhmm.split(":");
        if (parts.length != 2) return d;
        try {
            int h = Integer.parseInt(parts[0].trim());
            int m = Integer.parseInt(parts[1].trim());
            if (h < 0 || h > 24 || m < 0 || m > 59) return d;
            d.set(Calendar.HOUR_OF_DAY, h);
            d.set(Calendar.MINUTE, m);
            d.set(Calendar.SECOND, 0);
            d.set(Calendar.MILLISECOND, 0);
        } catch (NumberFormatException ignored) { }
        return d;
    }

    /** [from, to] 区间内的净工作毫秒（扣除与休息段的重叠），与前端 netWorkMs 对齐 */
    public static long netWorkMs(DaySchedule day, Calendar from, Calendar to) {
        if (day == null) return 0;
        Calendar ws = timeToCalendar(day.workStart, from);
        Calendar we = timeToCalendar(day.workEnd, from);
        long lo = Math.max(from.getTimeInMillis(), ws.getTimeInMillis());
        long hi = Math.min(to.getTimeInMillis(), we.getTimeInMillis());
        if (hi <= lo) return 0;
        long total = hi - lo;
        for (String[] b : day.breaks) {
            if (b == null || b.length < 3 || b[1] == null || b[2] == null) continue;
            Calendar bs = timeToCalendar(b[1], from);
            Calendar be = timeToCalendar(b[2], from);
            long overlap = Math.max(0, Math.min(hi, be.getTimeInMillis()) - Math.max(lo, bs.getTimeInMillis()));
            total -= overlap;
        }
        return Math.max(0, total);
    }

    /** 一整天的净工作毫秒 */
    public static long totalWorkMs(DaySchedule day) {
        if (day == null) return 0;
        Calendar base = Calendar.getInstance();
        Calendar ws = timeToCalendar(day.workStart, base);
        Calendar we = timeToCalendar(day.workEnd, base);
        return netWorkMs(day, ws, we);
    }

    /**
     * 区间工时统计（双口径，与前端 rangeTime 对齐）。
     * 工时口径（weekProgress/monthProgress）：所有请假（全天/时段）的工时一律扣除——
     * 本周/本月总工时与"还需"随请假减少；工资口径（weekPaidTime/monthPaidTime）：带薪假
     * 照常计入，作为时薪费率与已赚的基准（带薪假不影响当月工资）。
     * rangeStart 为本周周一或本月 1 号；spanDays 为 7 或当月天数。
     */
    private static long[] rangeProgress(JSONObject config, Calendar now, Calendar rangeStart, int spanDays, boolean forSalary) {
        long total = 0, done = 0, future = 0;
        String todayKey = ymd(now);
        Calendar d = (Calendar) rangeStart.clone();
        for (int i = 0; i < spanDays; i++) {
            // 非工作日（周末/法定假/小周周六）本就不计工时：按"不看请假"口径剔除；
            // 必须用 IgnoringLeave 版本，请假日的扣减交给下面 lvs 分支（带薪全天假工资口径仍计满额）
            if (!isWorkDayIgnoringLeave(config, d)) {
                d.add(Calendar.DAY_OF_MONTH, 1);
                continue;
            }
            LeaveInfo[] lvs = leaveInfosOf(config, d);
            DaySchedule sch;
            boolean fullDay = false;
            if (lvs != null) {
                for (LeaveInfo l : lvs) {
                    if (l.start == null) { fullDay = true; break; }
                }
            }
            if (fullDay) {
                // 全天假：工时口径整日 0；工资口径仅带薪按满额计
                if (!(forSalary && isPaidLeaveDay(config, d))) {
                    d.add(Calendar.DAY_OF_MONTH, 1);
                    continue;
                }
                sch = getDay(config, d);
            } else if (lvs != null && lvs.length > 0) {
                // 时段假（可多段）：工时口径注入全部假段；工资口径只注入不带薪段（带薪段照常计薪）
                sch = effectiveDay(config, d, forSalary);
            } else {
                sch = getDay(config, d);
            }
            long dayTotal = totalWorkMs(sch);
            total += dayTotal;
            String dk = ymd(d);
            if (dk.compareTo(todayKey) < 0) {
                done += dayTotal;
            } else {
                Calendar ws = timeToCalendar(sch.workStart, d);
                if (dk.equals(todayKey) && now.getTimeInMillis() > ws.getTimeInMillis()) {
                    done += netWorkMs(sch, ws, now);
                }
                // 今天/未来仍需实际上班的工时（全天假=0；时段假=注入全部假段后的剩余）。
                // 已赚口径=确定到手：total−future，带薪假（含未来）立即视为已赚
                if (!fullDay) {
                    DaySchedule workSch = (forSalary && lvs != null && lvs.length > 0) ? effectiveDay(config, d, false) : sch;
                    long wTotal = totalWorkMs(workSch);
                    long wDone = dk.equals(todayKey) && now.getTimeInMillis() > ws.getTimeInMillis() ? netWorkMs(workSch, ws, now) : 0;
                    future += Math.max(0, wTotal - wDone);
                }
            }
            d.add(Calendar.DAY_OF_MONTH, 1);
        }
        return new long[]{total, done, future};
    }

    public static long[] weekProgress(JSONObject config, Calendar now) {
        return rangeProgress(config, now, getMondayOfWeek(now), 7, false);
    }

    public static long[] monthProgress(JSONObject config, Calendar now) {
        Calendar first = Calendar.getInstance();
        first.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), 1, 0, 0, 0);
        first.set(Calendar.MILLISECOND, 0);
        int days = now.getActualMaximum(Calendar.DAY_OF_MONTH);
        return rangeProgress(config, now, first, days, false);
    }

    public static long[] weekPaidTime(JSONObject config, Calendar now) {
        return rangeProgress(config, now, getMondayOfWeek(now), 7, true);
    }

    public static long[] monthPaidTime(JSONObject config, Calendar now) {
        Calendar first = Calendar.getInstance();
        first.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), 1, 0, 0, 0);
        first.set(Calendar.MILLISECOND, 0);
        int days = now.getActualMaximum(Calendar.DAY_OF_MONTH);
        return rangeProgress(config, now, first, days, true);
    }

    /** 标准月工时：本月"若无人请假"的应上工时（每个应上班日按满排班计，周末/法定假剔除）——时薪费率分母。
     *  分母不随请假浮动：事假天已赚不累计 → 月底已赚 < 月薪（事假扣款）；带薪假天照常累计 → 月底拿满。
     *  不能用 monthPaidTime 的 total 当分母：它会剔除不带薪假，分母变小费率变大，月底又补回满月薪，事假等于没扣。 */
    public static long monthStandardTime(JSONObject config, Calendar now) {
        long total = 0;
        Calendar d = Calendar.getInstance();
        d.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), 1, 0, 0, 0);
        d.set(Calendar.MILLISECOND, 0);
        int days = now.getActualMaximum(Calendar.DAY_OF_MONTH);
        for (int i = 0; i < days; i++) {
            if (isWorkDayIgnoringLeave(config, d)) total += totalWorkMs(getDay(config, d));
            d.add(Calendar.DAY_OF_MONTH, 1);
        }
        return total;
    }

    /** now 之后最近的休息段 [name,start,end]；无则 null */
    private static String[] nextBreakAfter(DaySchedule day, Calendar now) {
        String[] result = null;
        Calendar next = null;
        for (String[] b : day.breaks) {
            if (b == null || b.length < 3 || b[1] == null) continue;
            Calendar bs = timeToCalendar(b[1], now);
            if (bs.after(now) && (next == null || bs.before(next))) {
                next = bs;
                result = b;
            }
        }
        return result;
    }

    /** 紧凑剩余工时：>=1天 → "X天Y时"；>=1时 → "Y时Z分"；否则 "Z分" */
    private static String formatRemainingCompact(long ms) {
        if (ms < 0) ms = 0;
        long totalSec = ms / 1000;
        long days = totalSec / 86400;
        long hours = (totalSec % 86400) / 3600;
        long mins = (totalSec % 3600) / 60;
        if (days >= 1) return hours > 0 ? days + "天" + hours + "时" : days + "天";
        if (hours >= 1) return mins > 0 ? hours + "时" + mins + "分" : hours + "时";
        return mins + "分";
    }

    private static long sub0(long a, long b) { return Math.max(0, a - b); }

    private static String formatMoney(double v) {
        if (v >= 100000) return String.valueOf(Math.round(v));
        return String.format(java.util.Locale.CHINA, "%.2f", v);
    }

    /** 计算当前状态 */
    public static Status computeStatus(JSONObject config) {
        Status s = new Status();
        Calendar now = Calendar.getInstance();
        int jsDay = now.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY ? 0 : now.get(Calendar.DAY_OF_WEEK) - 1;
        String[] weekFull = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};

        // --- 本周/本月：工时口径（所有请假日一律 0 工时，总工时随请假减少）---
        long[] wk = weekProgress(config, now);
        long[] mo = monthProgress(config, now);
        s.weekRemain = formatRemainingCompact(sub0(wk[0], wk[1]));
        s.monthRemain = formatRemainingCompact(sub0(mo[0], mo[1]));
        s.weekPct = wk[0] > 0 ? (int) (wk[1] * 100 / wk[0]) : 0;
        s.monthPct = mo[0] > 0 ? (int) (mo[1] * 100 / mo[0]) : 0;
        // --- 工资口径：已赚=确定到手工时（带薪总工时 − 未来仍需上班工时，带薪假含未来立即视为已赚）；
        //     费率分母=标准月工时（不随请假浮动，事假天已赚为 0 → 月底扣款） ---
        double monthly = config.optBoolean("salaryEnabled", false) ? config.optDouble("monthlySalary", 0) : 0;
        boolean hasSalary = monthly > 0;
        long[] wkP = weekPaidTime(config, now);
        long[] moP = monthPaidTime(config, now);
        long moStd = monthStandardTime(config, now);
        hasSalary = hasSalary && moStd > 0;
        if (hasSalary) {
            s.weekEarned = "¥" + formatMoney(Math.max(0, wkP[0] - wkP[2]) * monthly / moStd);
            s.monthEarned = "¥" + formatMoney(Math.max(0, moP[0] - moP[2]) * monthly / moStd);
        }

        boolean todayWork = isWorkDay(config, now);

        if (!todayWork) {
            s.label = "holiday";
            String lvReason = normalizeLeaveReason(leaveReasonOf(config, now));
            boolean paidLeave = isPaidLeaveDay(config, now);
            s.statusText = lvReason != null ? "🌴 " + lvReason : "🎉 休息日";
            s.headline = lvReason != null ? lvReason : "休息日";
            s.timeText = "";
            s.progress = 0;
            s.subText = paidLeave ? "带薪休息，工资不受影响" : "今天是" + weekFull[jsDay];
            // 带薪假：工时口径进度保持 0（请假日的工时一律为 0），仅已赚按钟点照常累计
            if (paidLeave) {
                DaySchedule lvDay = getDay(config, now);
                Calendar lvWs = timeToCalendar(lvDay.workStart, now);
                long dw = netWorkMs(lvDay, lvWs, now);
                if (hasSalary && dw > 0) s.earnedText = "¥" + formatMoney(dw * monthly / moStd);
            }
            return s;
        }

        // 有效排班：按时段请假已作为附加休息段注入（"假中"状态与休息共用一套逻辑，工时自动扣除）
        DaySchedule day = effectiveDay(config, now, false);
        Calendar ws = timeToCalendar(day.workStart, now);
        Calendar we = timeToCalendar(day.workEnd, now);
        s.onTimeStr = day.workStart;
        s.offTimeStr = day.workEnd;

        // 下个休息倒计时（无则空，前端展示会隐藏整块）
        String[] nb = nextBreakAfter(day, now);
        if (nb != null) {
            s.nextBreakCountdown = formatDuration(timeToCalendar(nb[1], now).getTimeInMillis() - now.getTimeInMillis());
            s.nextBreakStr = nb[0] + " " + nb[1];
        }

        // 检查是否在某个休息段内
        String[] currentBreak = null;
        for (String[] brk : day.breaks) {
            Calendar bs = timeToCalendar(brk[1], now);
            Calendar be = timeToCalendar(brk[2], now);
            if (!now.before(bs) && now.before(be)) {
                currentBreak = brk;
                break;
            }
        }

        if (now.before(ws)) {
            // 还没到上班
            s.label = "before";
            s.todayRemainMs = ws.getTimeInMillis() - now.getTimeInMillis();
            s.timeText = formatDuration(s.todayRemainMs);
            s.statusText = "距上班 " + s.timeText;
            s.headline = "距上班";
            s.progress = 0;
            s.subText = "上班 " + day.workStart;
        } else if (!now.before(we) && currentBreak == null) {
            // 已下班
            s.label = "off";
            s.statusText = "🎉 已下班";
            s.headline = "已下班";
            s.timeText = "";
            s.progress = 100;
            s.subText = "好好休息！";
        } else if (currentBreak != null) {
            // 休息中
            s.label = "break";
            Calendar be = timeToCalendar(currentBreak[2], now);
            s.todayRemainMs = be.getTimeInMillis() - now.getTimeInMillis();
            s.timeText = formatDuration(s.todayRemainMs);
            s.statusText = "☕ " + currentBreak[0] + " " + s.timeText;
            s.headline = currentBreak[0];
            s.progress = 100;
            s.subText = "距下班 " + formatDuration(we.getTimeInMillis() - now.getTimeInMillis());
        } else {
            // 工作中
            s.label = "working";
            s.todayRemainMs = we.getTimeInMillis() - now.getTimeInMillis();
            s.timeText = formatDuration(s.todayRemainMs);
            s.statusText = "距下班 " + s.timeText;
            s.headline = "距下班";
            long totalWork = totalWorkMs(day);
            long doneWork = netWorkMs(day, ws, now);
            s.progress = totalWork > 0 ? (int) Math.min(100, Math.max(0, doneWork * 100 / totalWork)) : 0;
            if (nb != null) {
                s.subText = "距" + nb[0] + " " + s.nextBreakCountdown;
            } else {
                s.subText = "还需工作 " + formatDuration(sub0(totalWork, doneWork));
            }
        }

        // 今日完成度（统一口径：净已工作 / 今日净工时；覆盖各分支里 break=100 的旧行为）
        // 整型截断：剩余净工时 >0 时最高只到 99，倒计时结束（dw==tw）才 100，与前端"封顶 99.9"口径一致
        {
            long tw = totalWorkMs(day);
            long dw = netWorkMs(day, ws, now);
            s.progress = tw > 0 ? (int) Math.min(100, Math.max(0, dw * 100 / tw)) : 0;
        }
        s.todayPct = s.progress;

        // 今日已赚（工资口径：只扣不带薪假段，带薪时段照常累计）
        if (hasSalary) {
            DaySchedule moneyDay = effectiveDay(config, now, true);
            long dayDone = netWorkMs(moneyDay, ws, now);
            if (dayDone > 0) s.earnedText = "¥" + formatMoney(dayDone * monthly / moStd);
        }
        return s;
    }

    /** 格式化时长: 3725000ms → "1:02:05" */
    public static String formatDuration(long ms) {
        if (ms < 0) ms = 0;
        long totalSec = ms / 1000;
        long h = totalSec / 3600;
        long m = (totalSec % 3600) / 60;
        long sec = totalSec % 60;
        if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
        return m + ":" + pad(sec);
    }

    private static String pad(long n) {
        return n < 10 ? "0" + n : "" + n;
    }
}
