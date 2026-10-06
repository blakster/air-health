package com.vansh.airhealth.sync

import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import kotlin.reflect.KClass

/** One Health Connect data type this app reads. [feature] is set when the type needs a newer Health Connect. */
data class HcType(val key: String, val label: String, val cls: KClass<out Record>, val feature: Int? = null) {
    val permission: String get() = HealthPermission.getReadPermission(cls)
}

object HcTypes {
    val ALL = listOf(
        HcType("Steps", "Steps", StepsRecord::class),
        HcType("Distance", "Distance", DistanceRecord::class),
        HcType("ActiveCaloriesBurned", "Active calories", ActiveCaloriesBurnedRecord::class),
        HcType("TotalCaloriesBurned", "Total calories", TotalCaloriesBurnedRecord::class),
        HcType("HeartRate", "Heart rate", HeartRateRecord::class),
        HcType("RestingHeartRate", "Resting heart rate", RestingHeartRateRecord::class),
        HcType("HeartRateVariabilityRmssd", "HRV", HeartRateVariabilityRmssdRecord::class),
        HcType("SleepSession", "Sleep and stages", SleepSessionRecord::class),
        HcType("OxygenSaturation", "SpO\u2082", OxygenSaturationRecord::class),
        HcType("RespiratoryRate", "Breathing rate", RespiratoryRateRecord::class),
        HcType("SkinTemperature", "Skin temperature", SkinTemperatureRecord::class, HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE),
        HcType("Vo2Max", "VO\u2082 max", Vo2MaxRecord::class),
        HcType("ExerciseSession", "Workouts", ExerciseSessionRecord::class),
        HcType("Weight", "Weight", WeightRecord::class),
    )

    const val BACKGROUND = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    const val HISTORY = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
}
