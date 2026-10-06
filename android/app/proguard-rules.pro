# Health Connect client uses reflection-free APIs; keep record classes' names for type labels in logs.
-keep class androidx.health.connect.client.records.** { *; }
-dontwarn org.jspecify.**
