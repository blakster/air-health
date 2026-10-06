package com.vansh.airhealth.sync

import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import java.time.Instant
import java.time.ZoneOffset

/** Health Connect record -> wire record. Values are plain SI-ish units (m, kcal, kg, bpm, ms, %, °C). */
object Mapper {
    fun map(r: Record): WireRecord? = when (r) {
        is StepsRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "Steps", mapOf("count" to r.count))
        is DistanceRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "Distance", mapOf("m" to r.distance.inMeters))
        is ActiveCaloriesBurnedRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "ActiveCaloriesBurned", mapOf("kcal" to r.energy.inKilocalories))
        is TotalCaloriesBurnedRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "TotalCaloriesBurned", mapOf("kcal" to r.energy.inKilocalories))
        is HeartRateRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "HeartRate", mapOf("hr" to downsampleHr(r.samples)))
        is RestingHeartRateRecord -> instant(r, "RestingHeartRate", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("bpm" to r.beatsPerMinute))
        is HeartRateVariabilityRmssdRecord -> instant(r, "HeartRateVariabilityRmssd", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("ms" to r.heartRateVariabilityMillis))
        is SleepSessionRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "SleepSession", mapOf(
            "title" to r.title,
            "stages" to r.stages.map { listOf(it.startTime.toEpochMilli(), it.endTime.toEpochMilli(), stageName(it.stage)) },
        ))
        is OxygenSaturationRecord -> instant(r, "OxygenSaturation", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("pct" to r.percentage.value))
        is RespiratoryRateRecord -> instant(r, "RespiratoryRate", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("rate" to r.rate))
        is SkinTemperatureRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "SkinTemperature", mapOf(
            "baseline" to r.baseline?.inCelsius,
            "deltas" to r.deltas.map { listOf(it.time.toEpochMilli(), it.delta.inCelsius) },
            "loc" to r.measurementLocation,
        ))
        is Vo2MaxRecord -> instant(r, "Vo2Max", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("v" to r.vo2MillilitersPerMinuteKilogram, "method" to r.measurementMethod))
        is ExerciseSessionRecord -> interval(r, r.startTime, r.startZoneOffset, r.endTime, r.endZoneOffset, "ExerciseSession", mapOf("type" to r.exerciseType, "name" to exerciseName(r.exerciseType), "title" to r.title))
        is WeightRecord -> instant(r, "Weight", r.time.toEpochMilli(), r.zoneOffset?.totalSeconds, mapOf("kg" to r.weight.inKilograms))
        else -> null
    }

    /**
     * Collapse raw HC heart-rate samples (often every 5s) to one point per local UTC minute.
     * The dashboard charts and zones are already 1-minute resolution, so this cuts payload size ~10–20×
     * without changing what the server stores in intraday.
     */
    fun downsampleHr(samples: List<HeartRateRecord.Sample>): List<List<Long>> {
        if (samples.isEmpty()) return emptyList()
        // minuteEpoch -> [sumBpm, count, min, max]
        val buckets = LinkedHashMap<Long, LongArray>()
        for (s in samples) {
            val bpm = s.beatsPerMinute
            if (bpm !in 21L..259L) continue
            val min = s.time.toEpochMilli() / 60_000L
            val b = buckets.getOrPut(min) { longArrayOf(0L, 0L, bpm, bpm) }
            b[0] += bpm; b[1] += 1; if (bpm < b[2]) b[2] = bpm; if (bpm > b[3]) b[3] = bpm
        }
        // Emit [minuteStartMs, avgBpm]. Avg is what the server's per-minute series uses; min/max of avgs
        // still approximate daily extremes well enough for the dashboard.
        return buckets.map { (min, b) -> listOf(min * 60_000L, Math.round(b[0].toDouble() / b[1]).toLong()) }
    }

    private fun interval(r: Record, s: Instant, so: ZoneOffset?, e: Instant, eo: ZoneOffset?, type: String, v: Map<String, Any?>) = WireRecord(
        type, r.metadata.id, r.metadata.lastModifiedTime.toEpochMilli(), r.metadata.dataOrigin.packageName, device(r.metadata),
        s.toEpochMilli(), e.toEpochMilli(), so?.totalSeconds, eo?.totalSeconds, v,
    )

    private fun instant(r: Record, type: String, t: Long, off: Int?, v: Map<String, Any?>) = WireRecord(
        type, r.metadata.id, r.metadata.lastModifiedTime.toEpochMilli(), r.metadata.dataOrigin.packageName, device(r.metadata),
        t, null, off, null, v,
    )

    fun device(m: Metadata): String? {
        val d = m.device ?: return null
        val name = listOfNotNull(d.manufacturer, d.model).joinToString(" ").trim()
        val type = when (d.type) {
            Device.TYPE_WATCH -> "WATCH"; Device.TYPE_PHONE -> "PHONE"; Device.TYPE_SCALE -> "SCALE"; Device.TYPE_RING -> "RING"
            Device.TYPE_FITNESS_BAND -> "FITNESS_BAND"; Device.TYPE_CHEST_STRAP -> "CHEST_STRAP"; Device.TYPE_HEAD_MOUNTED -> "HEAD_MOUNTED"
            Device.TYPE_SMART_DISPLAY -> "SMART_DISPLAY"; else -> "UNKNOWN"
        }
        return if (name.isEmpty()) type else "$name ($type)"
    }

    fun stageName(s: Int): String = when (s) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "AWAKE"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "ASLEEP"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "OUT_OF_BED"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "LIGHT"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "DEEP"
        SleepSessionRecord.STAGE_TYPE_REM -> "REM"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "AWAKE_IN_BED"
        else -> "UNKNOWN"
    }

    fun exerciseName(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walk"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "Run"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Treadmill run"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "Bike"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Stationary bike"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hike"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "Pool swim"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Open-water swim"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "Stairclimber"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING -> "Stairs"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "Strength"
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Weights"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING -> "HIIT"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "Elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Rowing machine"
        ExerciseSessionRecord.EXERCISE_TYPE_EXERCISE_CLASS -> "Workout"
        ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT -> "Workout"
        else -> "Exercise"
    }
}
