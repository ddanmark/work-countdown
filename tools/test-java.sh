#!/usr/bin/env bash
# 编译并运行 WidgetConfig.java 黄金向量测试（桌面 JVM）
# 依赖：JDK 17+、tools/vendor/json.jar（真 org.json，下载见下）、ANDROID_JAR（默认 platform 36）
#   首次下载 org.json：curl -sL -o tools/vendor/json.jar \
#     https://maven.aliyun.com/repository/public/org/json/json/20240303/json-20240303.jar
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JSON_JAR="$ROOT/tools/vendor/json.jar"
ANDROID_JAR="${ANDROID_JAR:-D:/runtime/android-sdk/platforms/android-36/android.jar}"
OUT="$ROOT/tools/vendor/classes"
[ -f "$JSON_JAR" ] || { echo "缺少 $JSON_JAR（见脚本头部注释下载）"; exit 1; }
mkdir -p "$OUT"
# Git Bash(MSYS) 会吞掉分号 classpath，Windows 路径需显式转换；非 MSYS 环境原样使用
W() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }
CP="$(W "$OUT");$(W "$JSON_JAR");$(W "$ANDROID_JAR")"
javac -encoding UTF-8 -cp "$CP" -d "$OUT" \
  "$(W "$ROOT")/app/android/app/src/main/java/com/workcountdown/app/WidgetConfig.java" \
  "$(W "$ROOT")/tools/widget-golden/WidgetGoldenTest.java"
java -cp "$CP" com.workcountdown.app.WidgetGoldenTest "$(W "$ROOT")\\tools\\golden-cases.json"
