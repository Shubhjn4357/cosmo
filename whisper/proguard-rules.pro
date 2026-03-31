
# Keep Coil3 image loading library classes
-dontwarn coil3.**
-keep class coil3.** { *; }

# Keep OkHttp and Okio networking classes
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep Apollo GraphQL classes (used by expo-dev-launcher)
-dontwarn com.apollographql.**

# Keep React Native Reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Keep Google Sign-In native classes in release builds
-dontwarn com.reactnativegooglesignin.**
-keep class com.reactnativegooglesignin.** { *; }
