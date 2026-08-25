// 编译期 stub：仅提供 WidgetConfig 桌面 JVM 测试所需的符号，
// 方法永不调用（loadConfig/loadBgPaletteIdx 不在测试路径上）。
// 重新生成：cd tools/vendor/android-stub-src && javac android/content/*.java -d ../stub-classes && jar cf ../android-stub.jar -C ../stub-classes .
package android.content;

public class Context {
    public static final int MODE_PRIVATE = 0;

    public SharedPreferences getSharedPreferences(String name, int mode) {
        throw new UnsupportedOperationException("android stub");
    }
}
