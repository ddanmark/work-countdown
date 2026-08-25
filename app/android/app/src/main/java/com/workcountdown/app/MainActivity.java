package com.workcountdown.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * 兜底背景色，避免 WebView 未绘制完成时出现白闪。
     * 和 body 的渐变色主色保持一致。
     */
    private static final int FALLBACK_BG = Color.rgb(102, 126, 234);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 在 super.onCreate 之前先打入 decor fits=false，
        // 确保 Capacitor 装载 WebView 时内容已按 edge-to-edge 布局，
        // 避免一帧后再 inset 造成的跳动。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        super.onCreate(savedInstanceState);
        applyEdgeToEdge();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyEdgeToEdge();
            // 用户从后台切回 App 时，立刻刷一次桌面小部件，
            // 避免秒级 tick 链被 ROM 杀掉后要等看门狗（约 3 分钟）才恢复。
            WorkCountdownWidgetProvider.refreshAll(this);
        }
    }

    /**
     * 让 WebView 内容延伸到状态栏 / 导航栏下方，并把系统栏背景设为透明，
     * 让 body 的渐变（#667eea → #764ba2）直接透到整个屏幕。
     *
     * 注意：
     * - targetSdkVersion = 36 (Android 16) 下，
     *   theme 属性 android:enforceStatusBarContrast / enforceNavigationBarContrast
     *   在 API 35+ 已经被废弃并忽略，必须用对应的 Window API 方法。
     * - 状态栏和导航栏文字/图标亮度由 WindowInsetsControllerCompat 控制。
     */
    private void applyEdgeToEdge() {
        android.view.Window window = getWindow();
        if (window == null) return;

        // 1) decor view 不参与 fitsSystemWindows，内容铺满整屏
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // 2) 状态栏 / 导航栏背景透明
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.addFlags(
                    android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        }

        // 3) ★ 关键修复 ★
        // Android 10 (Q/API 29) 起，可以用如下方法关闭系统栏自动追加的对比度蒙层。
        // Android 15+ 强制 edge-to-edge，如果不显式调用，
        // 系统会在透明栏上覆盖一层 20~30% 不透明的灰蒙层，导致底部出现白条/灰条。
        // theme 属性 enforceStatusBarContrast / enforceNavigationBarContrast
        // 在 Android 15+ (API 35) 已被废弃，这里用 API 方法兜底。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try { window.setStatusBarContrastEnforced(false); } catch (Throwable ignored) {}
            try { window.setNavigationBarContrastEnforced(false); } catch (Throwable ignored) {}
        }

        // 4) 低版本兜底：先染一下 decor，避免 WebView 还没绘制时短暂白闪
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            window.getDecorView().setBackgroundColor(FALLBACK_BG);
        }

        // 5) 状态栏 / 导航栏文字图标亮度 —— 我们背景是深紫蓝，用亮色（白色）
        View decor = window.getDecorView();
        WindowInsetsControllerCompat controller =
                new WindowInsetsControllerCompat(window, decor);
        controller.setAppearanceLightStatusBars(false);     // 状态栏文字白色
        controller.setAppearanceLightNavigationBars(false); // 导航栏手势条白色
        // 默认行为：用户从边缘上滑时短暂显示系统栏再自动隐藏，与常见 App 习惯一致
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);

        // 6) 旧 API 兜底：强制系统栏文字/图标为亮色（白色）。
        // 个别设备上 WindowInsetsControllerCompat 不生效，导致状态栏文字变深色。
        int vis = decor.getSystemUiVisibility();
        vis &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        vis &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(vis);

        // 7) 刘海屏 / 挖孔屏：让内容延伸到刘海区域（API 28+；shortEdges 竖屏即可覆盖顶/底刘海）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.view.WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode =
                    android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        // 8) ★ 最关键 ★ 递归关闭 decorView 所有子视图的 fitsSystemWindows。
        // setDecorFitsSystemWindows(false) 只作用于 decor 自身、不递归子视图；
        // Capacitor 的 WebView 容器默认 fitsSystemWindows=true，会自动给内容加上
        // 状态栏/导航栏内边距，系统栏区域露出窗口默认白底 → 白条。
        // 关掉整棵子树的 fitsSystemWindows 后，WebView 真正铺满全屏；
        // insets 仍会透传到 WebView，前端 env(safe-area-inset-*) 照常生效。
        disableFitsSystemWindows((ViewGroup) decor);
    }

    private void disableFitsSystemWindows(ViewGroup group) {
        if (group == null) return;
        group.setFitsSystemWindows(false);
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            child.setFitsSystemWindows(false);
            if (child instanceof ViewGroup) {
                disableFitsSystemWindows((ViewGroup) child);
            }
        }
    }
}
