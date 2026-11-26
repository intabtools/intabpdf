# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve WebView JavaScript bridge methods
-keepclassmembers class org.intabtools.intabpdf.MainActivity$NativeIntentBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve local Capacitor plugins and @CapacitorPlugin / @PluginMethod / @ActivityCallback metadata
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
}

# Preserve OpenCV JNI bindings
-keep class org.opencv.** { *; }
-dontwarn org.opencv.**
-keepclasseswithmembers class * {
    native <methods>;
}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
