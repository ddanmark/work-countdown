package com.workcountdown.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Calendar;
import java.util.TimeZone;

/**
 * 黄金向量测试（桌面 JVM）：读取 tools/golden-cases.json，与 www / 小程序端的
 * test-golden.js 断言同一份期望值——三实现（app.js / schedule.js / WidgetConfig.java）
 * 口径漂移会在任一端立刻爆红。
 *
 * 运行：bash tools/test-java.sh（需真 org.json jar 于 tools/vendor/json.jar，
 * android.jar 里的 org.json 是抛异常的 stub，仅用于编译 Context/SharedPreferences 符号）。
 * 时区固定 Asia/Shanghai，与 JS 端本机时区一致（国内无夏令时）。
 */
public class WidgetGoldenTest {
    public static void main(String[] args) throws Exception {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
        JSONObject root = new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8));
        JSONArray cases = root.getJSONArray("cases");
        int pass = 0, fail = 0;

        for (int ci = 0; ci < cases.length(); ci++) {
            JSONObject c = cases.getJSONObject(ci);
            String name = c.getString("name");
            JSONObject config = c.getJSONObject("config");
            Calendar now = parseIso(c.getString("now"));
            JSONObject e = c.getJSONObject("expect");

            int r1 = checkRange(name + " week", WidgetConfig.weekProgress(config, now), e.getJSONArray("week"));
            int r2 = checkRange(name + " month", WidgetConfig.monthProgress(config, now), e.getJSONArray("month"));
            int r3 = checkRange(name + " weekPaid", WidgetConfig.weekPaidTime(config, now), e.getJSONArray("weekPaid"));
            int r4 = checkRange(name + " monthPaid", WidgetConfig.monthPaidTime(config, now), e.getJSONArray("monthPaid"));
            long stdGot = WidgetConfig.monthStandardTime(config, now);
            long stdWant = e.getLong("monthStd");
            int r5 = stdGot == stdWant ? 0 : 1;
            if (r5 > 0) System.out.println("  ✘ [" + name + "] monthStd got=" + stdGot + " want=" + stdWant);
            pass += 5 - (r1 + r2 + r3 + r4 + r5);
            fail += r1 + r2 + r3 + r4 + r5;

            if (c.has("workDayChecks")) {
                JSONArray checks = c.getJSONArray("workDayChecks");
                JSONArray wants = e.getJSONArray("workDay");
                for (int i = 0; i < checks.length(); i++) {
                    String d = checks.getJSONArray(i).getString(0);
                    boolean want = wants.getBoolean(i);
                    boolean got = WidgetConfig.isWorkDay(config, parseIso(d + "T10:00:00"));
                    if (got == want) { pass++; } else { fail++; System.out.println("  ✘ [" + name + "] isWorkDay " + d + " got=" + got + " want=" + want); }
                }
            }
        }
        System.out.println(fail == 0 ? "✔ WidgetConfig 黄金向量全部通过（" + pass + " 项）" : "✘ 失败 " + fail + " / " + (pass + fail) + " 项");
        System.exit(fail == 0 ? 0 : 1);
    }

    /** "2026-08-24T10:00:00" → Calendar（字段置零，无毫秒残差） */
    static Calendar parseIso(String s) {
        String[] dt = s.split("T");
        String[] ymd = dt[0].split("-");
        String[] hms = dt[1].split(":");
        Calendar c = Calendar.getInstance();
        c.set(Integer.parseInt(ymd[0]), Integer.parseInt(ymd[1]) - 1, Integer.parseInt(ymd[2]),
                Integer.parseInt(hms[0]), Integer.parseInt(hms[1]), hms.length > 2 ? Integer.parseInt(hms[2]) : 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    /** long[]{total, done, future} 对比期望 [totalMs, doneMs, futureWorkMs] */
    static int checkRange(String label, long[] got, JSONArray want) throws Exception {
        for (int i = 0; i < want.length(); i++) {
            if (got[i] != want.getLong(i)) {
                System.out.println("  ✘ [" + label + "] got=[" + got[0] + "," + got[1] + "," + got[2] + "] want=" + want);
                return 1;
            }
        }
        return 0;
    }
}
