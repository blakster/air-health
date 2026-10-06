package com.vansh.airhealth.sync

import android.app.Activity
import android.os.Bundle
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit

/** adb shell am start -n com.vansh.airhealth.sync.debug/com.vansh.airhealth.sync.DebugSeedActivity */
class DebugSeedActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MainScope().launch {
            try {
                val c = HealthConnectClient.getOrCreate(this@DebugSeedActivity)
                val dev = Device(Device.TYPE_FITNESS_BAND, "Google", "Fitbit Air (emulator seed)")
                val off = ZoneOffset.ofHoursMinutes(5, 30)
                val now = Instant.now().truncatedTo(ChronoUnit.MINUTES)
                val recs = mutableListOf<androidx.health.connect.client.records.Record>()
                for (d in 0 until 3) for (h in 0 until 12) {
                    val s = now.minus(d.toLong(), ChronoUnit.DAYS).minus(h * 60L + 30, ChronoUnit.MINUTES)
                    recs += StepsRecord(s, off, s.plusSeconds(600), off, 100L + h * 10, Metadata.autoRecorded(dev))
                }
                val hs = now.minus(2, ChronoUnit.HOURS)
                recs += HeartRateRecord(hs, off, hs.plusSeconds(3600), off, (0 until 720).map { HeartRateRecord.Sample(hs.plusSeconds(it * 5L), 62L + it % 25) }, Metadata.autoRecorded(dev))
                val ss = now.minus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.DAYS).minus(5, ChronoUnit.HOURS)
                recs += SleepSessionRecord(ss, off, ss.plusSeconds(7 * 3600), off, Metadata.autoRecorded(dev), "Seed", null, listOf(
                    SleepSessionRecord.Stage(ss, ss.plusSeconds(3 * 3600), SleepSessionRecord.STAGE_TYPE_LIGHT),
                    SleepSessionRecord.Stage(ss.plusSeconds(3 * 3600), ss.plusSeconds(5 * 3600), SleepSessionRecord.STAGE_TYPE_DEEP),
                    SleepSessionRecord.Stage(ss.plusSeconds(5 * 3600), ss.plusSeconds(7 * 3600), SleepSessionRecord.STAGE_TYPE_REM)))
                recs += RestingHeartRateRecord(now.minus(3, ChronoUnit.HOURS), off, 58, Metadata.autoRecorded(dev))
                val r = c.insertRecords(recs)
                Log.i("AirHealthSeed", "SEED_OK inserted=${r.recordIdsList.size}")
            } catch (e: Throwable) {
                Log.e("AirHealthSeed", "SEED_FAIL ${e.javaClass.simpleName}: ${e.message}")
            }
            finish()
        }
    }
}
