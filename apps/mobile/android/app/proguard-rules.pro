# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:


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
