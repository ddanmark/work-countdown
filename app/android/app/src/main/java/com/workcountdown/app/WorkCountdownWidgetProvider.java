package com.workcountdown.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;

/**
 * 下班了吗 桌面小部件 Provider（共享基类）。
 *
 * 设计要点：
 *  - 同时支持 small (2x1) 和 medium (4x2) 两种布局，
 *    布局选择由 AppWidgetProviderInfo.minWidth 自动决定。
 *  - 通过 AlarmManager + 自续约，每秒刷新一次（setExact，屏亮时精确触发；
 *    manifest 已声明 USE_EXACT_ALARM），倒计时实时走秒。
 *  - tickAll 同时检查 small + medium 实例，确保续约不漏。
 *  - 全新倒计时向设计：核心就是"距下班还有多久"的大数字 + 一个每秒走秒、
 *    像表盘秒针的指针环动画（setRotation(秒*6°)）；背景渐变按状态切换。
 *    不再复用 App 内的 emoji / 多标题 / 多行样式。
 */
public class WorkCountdownWidgetProvider extends AppWidgetProvider {

    static final String ACTION_TICK = "com.workcountdown.app.WIDGET_TICK";
    static final String ACTION_REFRESH = "com.workcountdown.app.WIDGET_REFRESH";

    // 1s 刷新：让用户能实时看到倒计时在动。
    // setExact 仍计入 Android 12+ 的精确闹钟配额（仅 USE_EXACT_ALARM 豁免），
    // 但非唤醒类型 + 屏亮场景下按秒触发实际可行；被 ROM 节流时倒计时仍由
    // Chronometer 系统驱动走秒，看门狗兜底恢复整条链。
    private static final long TICK_INTERVAL_MS = 1_000L;

    // 看门狗：1s 自续约链是"单点故障"——任何一次广播被 ROM 吞掉/进程被冻结/设备重启，
    // 链条就永久断掉（倒计时因 Chronometer 由系统驱动照走，工资/弧线/秒针环全部冻住）。
    // setRepeating 由系统独立重复触发、无需续约，单次被吞不影响下一次；
    // 触发时 tickAll 会刷新全部 widget 并重新点燃 1s 链，把"断一次=永久死"变成"最多滞后数分钟"。
    private static final long WATCHDOG_INTERVAL_MS = 3 * 60_000L;

    // 跨零一对闹钟的 requestCode（与秒级 tick=0、看门狗=1 区分）
    private static final int RC_CROSSING = 2;   // 归零后 300ms：立即重算状态
    private static final int RC_HANDOFF = 3;    // 归零前 HANDOFF_MS：切到 TextView 踩值模式

    // 倒计时最后阶段（剩余 <= 2 分钟）从 Chronometer 换成 TextView 逐 tick 写值：
    // TextView 的文字只在进程运行时才变化、写入值恒 >= 0，从构造上杜绝负数显示
    // （Chronometer 跨过 base 后由系统继续自走成 "-0:00:12"，RemoteViews 没有手段让它停在 0，
    //  只能保证跨零前不再用它）。ROM 节流下秒级 tick 约 5s 一次，2 分钟窗口足够完成切换。
    private static final long HANDOFF_MS = 120_000L;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        TickData data = computeTickData(context);
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId, data);
        }
        scheduleNextTick(context);
        scheduleCrossing(context, data.status.todayRemainMs);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_TICK.equals(action) || ACTION_REFRESH.equals(action)) {
            tickAll(context);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            // 重启/应用更新后闹钟全部清空：若有 widget 实例则重新点燃 tick 链
            tickAll(context);
        }
    }

    @Override
    public void onEnabled(Context context) {
        scheduleNextTick(context);
    }

    @Override
    public void onDisabled(Context context) {
        // onDisabled 按类触发：本类最后一个实例被移除时调用。
        // 三种 widget 共享同一条闹钟链，只有全部实例都不存在时才允许停掉，
        // 否则移除中尺寸的最后一个就会误杀 small/compact 的秒级刷新。
        if (countAllWidgetInstances(context) == 0) stopTicker(context);
    }

    /** 统计三种 widget 当前实例总数（0 = 桌面上一个都不剩） */
    private static int countAllWidgetInstances(Context context) {
        AppWidgetManager awm = AppWidgetManager.getInstance(context);
        int total = awm.getAppWidgetIds(new ComponentName(context, WorkCountdownWidgetProvider.class)).length;
        try {
            Class<?> mediumCls = Class.forName("com.workcountdown.app.WorkCountdownWidgetProviderMedium");
            total += awm.getAppWidgetIds(new ComponentName(context, mediumCls)).length;
        } catch (Throwable ignored) { }
        try {
            Class<?> compactCls = Class.forName("com.workcountdown.app.WorkCountdownWidgetProviderCompact");
            total += awm.getAppWidgetIds(new ComponentName(context, compactCls)).length;
        } catch (Throwable ignored) { }
        return total;
    }

    /**
     * 同时刷新 small / medium / compact 三种 widget 实例。
     * 配置解析、状态计算、配色只做一次共享给全部实例——
     * 每秒 tick 不再每个实例重复 JSON 解析 + 周月进度 ~38 天循环。
     */
    private void tickAll(Context context) {
        AppWidgetManager awm = AppWidgetManager.getInstance(context);
        int totalUpdated = 0;
        TickData data = computeTickData(context);

        // 下班前提醒：走 widget 的秒级 tick 链（后台）+ MainActivity 焦点刷新（前台）
        maybeFireOffworkReminder(context, data);

        // 1) small widget 实例
        ComponentName smallCn = new ComponentName(context, WorkCountdownWidgetProvider.class);
        for (int id : awm.getAppWidgetIds(smallCn)) {
            updateWidget(context, awm, id, data);
            totalUpdated++;
        }

        // 2) medium widget 实例（不同 Provider 类）
        try {
            Class<?> mediumCls = Class.forName("com.workcountdown.app.WorkCountdownWidgetProviderMedium");
            ComponentName mediumCn = new ComponentName(context, mediumCls);
            for (int id : awm.getAppWidgetIds(mediumCn)) {
                updateWidget(context, awm, id, data);
                totalUpdated++;
            }
        } catch (Throwable ignored) {}

        // 3) compact(2×2) widget 实例
        try {
            Class<?> compactCls = Class.forName("com.workcountdown.app.WorkCountdownWidgetProviderCompact");
            ComponentName compactCn = new ComponentName(context, compactCls);
            for (int id : awm.getAppWidgetIds(compactCn)) {
                updateWidget(context, awm, id, data);
                totalUpdated++;
            }
        } catch (Throwable ignored) {}

        // 4) 只要桌面上还有任何实例，就续约下一次 tick + 归零补偿闹钟
        if (totalUpdated > 0) {
            scheduleNextTick(context);
            scheduleCrossing(context, data.status.todayRemainMs);
        }
    }

    /**
     * 排下一次 tick。每秒自续约刷新倒计时。
     *
     * Android 12+ 调用 setExact 必须持有 SCHEDULE_EXACT_ALARM 或 USE_EXACT_ALARM，
     * 否则抛 SecurityException。早期代码没 try/catch，导致 onUpdate 在渲染完成后
     * 于这里抛异常、tick 续约不上 —— 表现为"widget 只刷新一次、倒计时不动"。
     * 现在用 canScheduleExactAlarms() 判断并 try/catch 兜底：
     *  - 有精确闹钟权限 → setExact，1 秒走秒；
     *  - 无权限 → 降级 set()（系统约分钟级触发，至少能更新，且绝不抛异常）。
     */
    static void scheduleNextTick(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = tickPi(context, 0);

        long triggerAt = SystemClock.elapsedRealtime() + TICK_INTERVAL_MS;
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        try {
            if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // 非唤醒精确闹钟：屏幕亮时 1 秒触发一次；Doze 下系统自动延后（不影响可见体验）
                am.setExact(AlarmManager.ELAPSED_REALTIME, triggerAt, pi);
            } else {
                // 无精确闹钟权限 / 旧版本兜底：inexact，触发时机由系统决定（约分钟级）
                am.set(AlarmManager.ELAPSED_REALTIME, triggerAt, pi);
            }
        } catch (SecurityException se) {
            // 极端情况下仍缺权限：用 inexact 兜底，绝不让 tick 链断掉
            try { am.set(AlarmManager.ELAPSED_REALTIME, triggerAt, pi); } catch (Throwable ignored) {}
        }
        scheduleWatchdog(context);
    }

    /**
     * 看门狗循环闹钟：系统独立重复触发（inexact，无需权限、无需续约），
     * 触发时走 ACTION_TICK → tickAll，既兜底刷新一次，也会重新点燃 1s 精确链。
     * 与秒级 tick 共用 Intent 但 requestCode 不同（0/1），避免互相覆盖。
     */
    private static void scheduleWatchdog(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = tickPi(context, 1);
        try {
            am.setRepeating(AlarmManager.ELAPSED_REALTIME,
                SystemClock.elapsedRealtime() + WATCHDOG_INTERVAL_MS,
                WATCHDOG_INTERVAL_MS, pi);
        } catch (Throwable ignored) {}
    }

    /**
     * 跨零的一对"一次性唤醒闹钟"，配合 bindCountdown 的三段式绑定，保证倒计时
     * 归零后不可能显示负数（此前只用单个非唤醒闹钟在归零点重算，ROM 节流/进程
     * 冻结时闹钟迟迟不投递，Chronometer 自走进入负数区，用户看到 -0:00:12）：
     *  - 预切换（RC_HANDOFF）：归零前 HANDOFF_MS 触发，把倒计时从 Chronometer
     *    切到 TextView 踩值模式——即使此后进程被冻结、秒级链全断，屏幕上也只可能
     *    停在某个 >=0 的剩余值，绝不出现负数；
     *  - 归零（RC_CROSSING）：归零后 300ms 触发，立刻重算状态重绑
     *    （上班前→工作中 / 休息结束→工作中 / →已下班）。
     * 两者都用 ELAPSED_REALTIME_WAKEUP + setExactAndAllowWhileIdle：熄屏 Doze、
     * 进程冻结时也尽量准点唤醒投递（AllowWhileIdle 受 Doze 每 9 分钟一次限频，
     * 两闹钟只隔 2 分钟时第二个最多顺延几分钟，期间显示冻结的正值，可接受）。
     * remainMs <= HANDOFF_MS（已处于踩值模式）只取消预切换；<=0 两个都取消。
     */
    private static void scheduleCrossing(Context context, long remainMs) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent crossing = tickPi(context, RC_CROSSING);
        PendingIntent handoff = tickPi(context, RC_HANDOFF);
        if (remainMs <= 0) {
            am.cancel(crossing);
            am.cancel(handoff);
            return;
        }
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (remainMs > HANDOFF_MS) {
            scheduleOneShotWakeup(am, handoff,
                SystemClock.elapsedRealtime() + remainMs - HANDOFF_MS, canExact);
        } else {
            am.cancel(handoff);   // 已在踩值模式内，预切换无事可做
        }
        scheduleOneShotWakeup(am, crossing,
            SystemClock.elapsedRealtime() + remainMs + 300L, canExact);
    }

    /** 一次性精确唤醒闹钟：优先 setExactAndAllowWhileIdle，无权限/异常降级 set()（同为唤醒型） */
    private static void scheduleOneShotWakeup(AlarmManager am, PendingIntent pi, long triggerAt, boolean canExact) {
        try {
            if (canExact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            } else {
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            }
        } catch (SecurityException se) {
            try { am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi); } catch (Throwable ignored) {}
        }
    }

    /** 构造 ACTION_TICK 广播 PendingIntent（requestCode：0=秒级 1=看门狗 2=归零 3=预切换） */
    private static PendingIntent tickPi(Context context, int requestCode) {
        Intent intent = new Intent(context, WorkCountdownWidgetProvider.class);
        intent.setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(
            context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void stopTicker(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        // 秒级 tick、看门狗、归零、预切换四条闹钟一并取消（requestCode=0/1/2/3）
        am.cancel(tickPi(context, 0));
        am.cancel(tickPi(context, 1));
        am.cancel(tickPi(context, RC_CROSSING));
        am.cancel(tickPi(context, RC_HANDOFF));
    }

    /**
     * 公共刷新入口：App 内修改配置后从 WebView / Activity 触发。
     * 立即同步刷新（不等 tick），并重置续约点。
     */
    public static void refreshAll(Context context) {
        Intent intent = new Intent(context, WorkCountdownWidgetProvider.class);
        intent.setAction(ACTION_REFRESH);
        context.sendBroadcast(intent);
    }

    // ---------- 下班前提醒（系统通知） ----------
    // 配置 offworkReminder=提前分钟数（0=关，前端设置页开关）。
    // 触发链：本 Provider 的每秒 tick（后台，需桌面有小组件）+
    // MainActivity.onWindowFocusChanged 的 REFRESH 广播（App 前台）。
    // 每天只发一次（独立 SharedPreferences 记已发日期）；无通知权限时静默跳过。
    private static final String STATE_PREFS = "work-countdown-state";
    private static final String REMINDER_FIRED_KEY = "offwork-reminder-fired";
    private static final int REMINDER_NOTIF_ID = 2001;

    private static void maybeFireOffworkReminder(Context context, TickData data) {
        try {
            JSONObject config = data.config;
            if (config == null) return;
            int minutes = config.optInt("offworkReminder", 0);
            if (minutes <= 0 || minutes > 240) return;
            WidgetConfig.Status s = data.status;
            // 只在"工作中"判距下班倒计时（before/break 状态的 todayRemainMs 指上班/休息结束，语义不同）
            if (!"working".equals(s.label)) return;
            long remain = s.todayRemainMs;
            if (remain <= 0 || remain > minutes * 60000L) return;
            String todayKey = WidgetConfig.ymd(Calendar.getInstance());
            android.content.SharedPreferences st =
                    context.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE);
            if (todayKey.equals(st.getString(REMINDER_FIRED_KEY, null))) return;
            st.edit().putString(REMINDER_FIRED_KEY, todayKey).apply();
            fireOffworkNotification(context, minutes, remain);
        } catch (Throwable ignored) { }
    }

    private static void fireOffworkNotification(Context context, int minutes, long remainMs) {
        android.app.NotificationManager nm =
                (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // Android 13+ 未授权时静默跳过（授权请求在 MainActivity 启动时发起）
        if (Build.VERSION.SDK_INT >= 33 &&
                context.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return;
        }
        String chId = "offwork-reminder";
        if (Build.VERSION.SDK_INT >= 26) {
            android.app.NotificationChannel ch =
                    new android.app.NotificationChannel(chId, "下班提醒", android.app.NotificationManager.IMPORTANCE_HIGH);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long showMin = Math.max(1, (remainMs + 59999) / 60000); // 向上取整，避免"还有0分钟"
        android.app.Notification.Builder nb = Build.VERSION.SDK_INT >= 26
                ? new android.app.Notification.Builder(context, chId)
                : new android.app.Notification.Builder(context);
        android.app.Notification n = nb
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("快下班啦 🎉")
                .setContentText("还有约 " + showMin + " 分钟下班，收拾收拾准备跑路 🏃")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(REMINDER_NOTIF_ID, n);
    }

    /** 每轮 tick 只算一次、所有实例共享的数据（配置 JSON + 状态 + 配色） */
    private static class TickData {
        final WidgetConfig.Status status;
        final int paletteIdx;
        final JSONObject config; // 可为 null（配置读取失败时）
        TickData(WidgetConfig.Status status, int paletteIdx, JSONObject config) {
            this.status = status;
            this.paletteIdx = paletteIdx;
            this.config = config;
        }
    }

    /**
     * 解析配置并计算状态。computeStatus 包 try/catch：
     * 畸形配置（如空时间串，timeToCalendar 已容错但防其他意外）
     * 不能让每个 tick 都崩——回退到"待设置"占位状态。
     */
    private static TickData computeTickData(Context context) {
        WidgetConfig.Status status;
        JSONObject config = WidgetConfig.loadConfig(context);
        if (config != null) {
            try {
                status = WidgetConfig.computeStatus(config);
            } catch (Throwable t) {
                status = placeholderStatus();
            }
        } else {
            status = placeholderStatus();
        }
        int paletteIdx = 0;
        try {
            paletteIdx = WidgetConfig.loadBgPaletteIdx(context);
        } catch (Throwable ignored) { }
        return new TickData(status, paletteIdx, config);
    }

    private static WidgetConfig.Status placeholderStatus() {
        WidgetConfig.Status s = new WidgetConfig.Status();
        s.label = "working";
        s.headline = "待设置";
        s.timeText = "--:--:--";
        s.subText = "打开「下班了吗」设置排班";
        s.progress = 0;
        return s;
    }

    /**
     * 核心渲染：全新倒计时向设计。
     * 不再复用 App 内的 emoji/多标题样式——核心就是"距下班还有多久"，
     * 配一个每秒走秒的指针环动画（表盘式，对应倒计时主题）。
     */
    void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId, TickData data) {
        // 按 Provider 类决定布局（而非 minWidth），避免 minWidth 碰到阈值被误判。
        // Medium → 5×2 三圈；Compact → 2×2 单圈；其余 → 4×2 单倒计时。
        boolean isMedium = false;
        boolean isCompact = false;
        // getAppWidgetInfo 在"枚举实例→渲染"间隙里 widget 被移除时返回 null，判空防 NPE
        android.appwidget.AppWidgetProviderInfo info = appWidgetManager.getAppWidgetInfo(appWidgetId);
        if (info == null || info.provider == null) return;
        ComponentName provider = info.provider;
        if (provider.getClassName() != null) {
            String cn = provider.getClassName();
            if (cn.contains("Medium")) isMedium = true;
            else if (cn.contains("Compact")) isCompact = true;
        }
        int layoutId = isMedium ? R.layout.widget_medium
                : (isCompact ? R.layout.widget_compact : R.layout.widget_small);

        RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);

        WidgetConfig.Status status = data.status;

        // 2) 背景：与 App 内选择的渐变同步（读 work-countdown-bg → widget_palette_N）
        int palRes = paletteBgRes(context, data.paletteIdx);
        if (palRes != 0) views.setInt(R.id.widget_root, "setBackgroundResource", palRes);

        // 3) 今日倒计时：Chronometer 由系统每秒自更新（规避 ROM 对每秒闹钟的节流）；
        //    最后 HANDOFF_MS 换 TextView 踩值、无倒计时时显示静态状态——三段式见 bindCountdown。
        views.setTextViewText(R.id.widget_label, status.headline == null ? "" : status.headline);
        bindCountdown(views, R.id.widget_countdown_chr, R.id.widget_countdown_txt, status);  // 3×1 / 2×2
        bindCountdown(views, R.id.widget_today_chr, R.id.widget_today_txt, status);           // 5×2 今日圈

        // 4) 大尺寸三圈：进度弧（按完成度选 widget_arc_N 帧）+ 倒计时 + 已赚工资
        if (isMedium) {
            setArc(context, views, R.id.widget_today_arc, status.todayPct);
            setArc(context, views, R.id.widget_week_arc, status.weekPct);
            setArc(context, views, R.id.widget_month_arc, status.monthPct);
            views.setTextViewText(R.id.widget_week_time, strOr(status.weekRemain, "—"));
            views.setTextViewText(R.id.widget_month_time, strOr(status.monthRemain, "—"));
            setEarned(views, R.id.widget_today_earned, status.earnedText);
            setEarned(views, R.id.widget_week_earned, status.weekEarned);
            setEarned(views, R.id.widget_month_earned, status.monthEarned);
        }

        // 6b) 圆环尺寸(2×2)：单个大进度弧（今日完成度）+ 今日已赚
        if (isCompact) {
            setArc(context, views, R.id.widget_compact_arc, status.todayPct);
            setEarned(views, R.id.widget_compact_earned, status.earnedText);
        }

        // 7) 指针环动画：按当前"秒"旋转（秒*6°），一圈 60 秒，像表盘秒针走秒
        Calendar cal = Calendar.getInstance();
        views.setFloat(R.id.widget_ring, "setRotation", cal.get(Calendar.SECOND) * 6f);

        // 8) 点击打开 App
        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(
            context, appWidgetId, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    /** 进度弧帧资源缓存（widget_arc_0..100），避免每次 tick 都 getIdentifier */
    private static final int[] ARC_CACHE = new int[101];

    /** 按 0-100 完成度为指定 ImageView 选择进度弧帧 */
    private static void setArc(Context ctx, RemoteViews views, int viewId, int pct) {
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
        int res = ARC_CACHE[pct];
        if (res == 0) {
            res = ctx.getResources().getIdentifier("widget_arc_" + pct, "drawable", ctx.getPackageName());
            ARC_CACHE[pct] = res;
        }
        if (res != 0) views.setImageViewResource(viewId, res);
    }

    /**
     * 绑定今日倒计时。三段式，保证任何 ROM 节流/进程冻结下都不可能渲染出负数：
     *  - 剩余 > HANDOFF_MS：Chronometer（系统每秒自走，不受闹钟节流影响）；
     *  - 0 < 剩余 <= HANDOFF_MS：切到 TextView 由每次 tick 写入剩余值——文字只在
     *    进程运行时才变化，写入值恒 >= 0，构造上杜绝负数（切换本身由 scheduleCrossing
     *    的预切换唤醒闹钟兜底，即使此前进程一直冻结也能准点发生）；
     *  - 剩余 <= 0（已下班/休息日/待设置）：TextView 显示静态状态文字。
     */
    private static void bindCountdown(RemoteViews views, int chrId, int txtId, WidgetConfig.Status status) {
        long remain = status.todayRemainMs;
        boolean hasTime = status.timeText != null && !status.timeText.isEmpty();
        if (remain > HANDOFF_MS && hasTime) {
            views.setChronometer(chrId, SystemClock.elapsedRealtime() + remain, null, true);
            views.setBoolean(chrId, "setCountDown", true);
            views.setViewVisibility(chrId, View.VISIBLE);
            views.setViewVisibility(txtId, View.GONE);
        } else {
            views.setTextViewText(txtId,
                    remain > 0 && hasTime ? status.timeText
                            : (status.headline == null ? "" : status.headline));
            views.setViewVisibility(txtId, View.VISIBLE);
            views.setViewVisibility(chrId, View.GONE);
        }
    }

    /** 设置"已赚"文本：有值则显示，无（未开启工资）则隐藏该行，让圈内剩余文字自动居中 */
    private static void setEarned(RemoteViews views, int viewId, String text) {
        boolean has = text != null && !text.isEmpty();
        views.setTextViewText(viewId, has ? text : "");
        views.setViewVisibility(viewId, has ? View.VISIBLE : View.GONE);
    }

    private static String strOr(String s, String fallback) {
        return (s == null || s.isEmpty()) ? fallback : s;
    }

    /** 背景渐变帧资源缓存（widget_palette_0..11），与 App 内选择同步 */
    private static final int[] PALETTE_CACHE = new int[12];

    private static int paletteBgRes(Context ctx, int idx) {
        if (idx < 0) idx = 0;
        if (idx > 11) idx = 11;
        int res = PALETTE_CACHE[idx];
        if (res == 0) {
            res = ctx.getResources().getIdentifier("widget_palette_" + idx, "drawable", ctx.getPackageName());
            PALETTE_CACHE[idx] = res;
        }
        return res;
    }
}
