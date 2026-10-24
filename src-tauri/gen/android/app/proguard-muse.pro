# Tauri loads MusePlugin by name and calls @Command methods reflectively
-keep class com.hosung.muse.** { *; }
# youtubedl-android maps yt-dlp JSON with Jackson
-keep class com.yausername.** { *; }
-dontwarn com.yausername.**
-keep class com.fasterxml.jackson.** { *; }
-dontwarn com.fasterxml.jackson.**
-dontwarn org.apache.commons.**
# youtubedl-android unpacks Python with Commons Compress, which registers zip extra-field
# classes reflectively ("class … is not a concrete class" once R8 rewrites them)
-keep class org.apache.commons.compress.** { *; }
-keep class org.apache.commons.io.** { *; }
-dontwarn org.apache.commons.compress.**
-keepattributes Signature, InnerClasses, EnclosingMethod, *Annotation*
