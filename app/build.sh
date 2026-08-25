#!/bin/bash
# ===== 一键构建 APK 脚本 =====
# 用法：在 Git Bash 中运行 bash build.sh

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "📂 项目目录: $APP_DIR"

# 1. 同步网页到 Android 工程
echo ""
echo "🔄 [1/3] 同步网页资源..."
cd "$APP_DIR"
npx cap copy android

# 2. 构建 APK
echo ""
echo "🔨 [2/3] 构建 APK..."
cd "$APP_DIR/android"
export JAVA_HOME="D:/runtime/Java/jdk17/openjdk/jdk-21"
export ANDROID_HOME="D:/runtime/android-sdk"
export ANDROID_SDK_ROOT="D:/runtime/android-sdk"
./gradlew assembleDebug --no-daemon

# 3. 输出结果
APK="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "✅ [3/3] 构建完成！"
echo "📦 APK 路径: $APK"
ls -lh "$APK"

# 显示版本号
echo ""
AAPT="D:/runtime/android-sdk/build-tools/36.0.0/aapt2.exe"
"$AAPT" dump badging "$APK" 2>/dev/null | grep -E "versionCode|versionName|application-label"
