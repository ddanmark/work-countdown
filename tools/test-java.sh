#!/usr/bin/env bash
# 编译并运行 WidgetConfig.java 黄金向量测试（桌面 JVM）
# 依赖：JDK 17+、tools/vendor/json.jar（真 org.json）、tools/vendor/android-stub.jar
#   （Context/SharedPreferences 编译期 stub，测试路径不会调用）。
#   首次下载 org.json：curl -sL -o tools/vendor/json.jar \
#     https://maven.aliyun.com/repository/public/org/json/json/20240303/json-20240303.jar
#   可用 ANDROID_JAR=真 android.jar 覆盖 stub（如本地 SDK 调试）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSON_JAR="$ROOT/tools/vendor/json.jar"
ANDROID_JAR="${ANDROID_JAR:-$ROOT/tools/vendor/android-stub.jar}"
OUT="$ROOT/tools/vendor/classes"
[ -f "$JSON_JAR" ] || { echo "缺少 $JSON_JAR（见脚本头部注释下载）"; exit 1; }
[ -f "$ANDROID_JAR" ] || { echo "缺少 $ANDROID_JAR"; exit 1; }
mkdir -p "$OUT"
# 跨平台：Windows/MSYS 用分号分隔并转混合路径（C:/...，正斜杠 java 也认）；Linux 用冒号
UNAME="$(uname -s)"
SEP=":"
case "$UNAME" in MINGW*|MSYS*|CYGWIN*) SEP=";";; esac
W() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
CP="$(W "$OUT")$SEP$(W "$JSON_JAR")$SEP$(W "$ANDROID_JAR")"
javac -encoding UTF-8 -cp "$CP" -d "$OUT" \
  "$(W "$ROOT")/app/android/app/src/main/java/com/workcountdown/app/WidgetConfig.java" \
  "$(W "$ROOT")/tools/widget-golden/WidgetGoldenTest.java"
java -cp "$CP" com.workcountdown.app.WidgetGoldenTest "$(W "$ROOT")/tools/golden-cases.json"
