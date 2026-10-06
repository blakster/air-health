package com.vansh.airhealth.sync

import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Device
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.units.Percentage
import androidx.health.connect.client.units.Temperature
import androidx.health.connect.client.units.TemperatureDelta
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.zip.GZIPInputStream

class MapperTest {
    private val ist = ZoneOffset.ofHoursMinutes(5, 30)
    private val zone = ZoneId.of("Asia/Kolkata")
    private val fitbit = "com.fitbit.FitbitMobile"
    private val band = Device(Device.TYPE_FITNESS_BAND, "Google", "Fitbit Air")
    private fun md(id: String, origin: String = fitbit, lm: Long = 1_760_000_000_000L, dev: Device? = band) =
        TestMeta.of(id, origin, lm, dev)
    private fun t(s: String) = Instant.parse(s)

    @Test fun steps() {
        val r = StepsRecord(t("2026-10-06T03:00:00Z"), ist, t("2026-10-06T03:01:00Z"), ist, 87, md("s1"))
        val w = Mapper.map(r)!!
        assertEquals("Steps", w.type); assertEquals("s1", w.id); assertEquals(fitbit, w.origin)
        assertEquals(87L, w.values["count"]); assertEquals(19800, w.startOffsetSec)
        assertEquals("Google Fitbit Air (FITNESS_BAND)", w.device)
        assertEquals("2026-10-06", w.localDate(zone).toString())
    }

    @Test fun localDateUsesRecordOffset() {
        // 19:00Z on 5 Oct is 00:30 IST on 6 Oct.
        val r = StepsRecord(t("2026-10-05T19:00:00Z"), ist, t("2026-10-05T19:01:00Z"), ist, 5, md("s2"))
        assertEquals("2026-10-06", Mapper.map(r)!!.localDate(ZoneId.of("UTC")).toString())
        // Without an offset, the phone zone is used.
        val r2 = StepsRecord(t("2026-10-05T19:00:00Z"), null, t("2026-10-05T19:01:00Z"), null, 5, md("s3"))
        assertEquals("2026-10-05", Mapper.map(r2)!!.localDate(ZoneId.of("UTC")).toString())
        assertEquals("2026-10-06", Mapper.map(r2)!!.localDate(zone).toString())
    }

    @Test fun units() {
        val d = Mapper.map(DistanceRecord(t("2026-10-06T03:00:00Z"), ist, t("2026-10-06T03:10:00Z"), ist, Length.kilometers(1.25), md("d1")))!!
        assertEquals(1250.0, d.values["m"] as Double, 1e-9)
        val c = Mapper.map(TotalCaloriesBurnedRecord(t("2026-10-06T03:00:00Z"), ist, t("2026-10-06T04:00:00Z"), ist, Energy.kilocalories(95.5), md("c1")))!!
        assertEquals(95.5, c.values["kcal"] as Double, 1e-9)
        val wt = Mapper.map(WeightRecord(t("2026-10-06T03:00:00Z"), ist, Mass.kilograms(71.4), md("w1", dev = null)))!!
        assertEquals(71.4, wt.values["kg"] as Double, 1e-9); assertNull(wt.end); assertNull(wt.device)
        val o = Mapper.map(OxygenSaturationRecord(t("2026-10-06T00:00:00Z"), ist, Percentage(96.5), md("o1")))!!
        assertEquals(96.5, o.values["pct"] as Double, 1e-9)
        val hrv = Mapper.map(HeartRateVariabilityRmssdRecord(t("2026-10-06T00:00:00Z"), ist, 42.0, md("v1")))!!
        assertEquals("HeartRateVariabilityRmssd", hrv.type); assertEquals(42.0, hrv.values["ms"] as Double, 1e-9)
        val rhr = Mapper.map(RestingHeartRateRecord(t("2026-10-06T00:00:00Z"), ist, 58, md("r1")))!!
        assertEquals(58L, rhr.values["bpm"])
    }

    @Test fun heartRateSamples() {
        val s0 = t("2026-10-06T04:00:00Z")
        // 120 samples every 5s over 10 minutes → 10 one-minute aggregates on the wire.
        val samples = (0 until 120).map { HeartRateRecord.Sample(s0.plusSeconds(it * 5L), 60L + it % 30) }
        val r = HeartRateRecord(s0, ist, s0.plusSeconds(600), ist, samples, md("h1"))
        val w = Mapper.map(r)!!
        val hr = w.values["hr"] as List<*>
        assertEquals(10, hr.size)
        assertEquals(listOf(s0.toEpochMilli(), 66L), hr[0]) // avg of bpm 60..71 over first minute (rounded)
        assertEquals(11, w.weight())
    }

    @Test fun heartRateDownsampleKeepsEmpty() {
        assertTrue(Mapper.downsampleHr(emptyList()).isEmpty())
    }

    @Test fun sleepStages() {
        val s = t("2026-10-05T17:30:00Z") // 23:00 IST
        val stages = listOf(
            SleepSessionRecord.Stage(s, s.plusSeconds(1800), SleepSessionRecord.STAGE_TYPE_LIGHT),
            SleepSessionRecord.Stage(s.plusSeconds(1800), s.plusSeconds(3600), SleepSessionRecord.STAGE_TYPE_DEEP),
            SleepSessionRecord.Stage(s.plusSeconds(3600), s.plusSeconds(4200), SleepSessionRecord.STAGE_TYPE_REM),
            SleepSessionRecord.Stage(s.plusSeconds(4200), s.plusSeconds(4500), SleepSessionRecord.STAGE_TYPE_AWAKE),
        )
        val r = SleepSessionRecord(s, ist, s.plusSeconds(4500), ist, md("sl1"), null, null, stages)
        val w = Mapper.map(r)!!
        val st = w.values["stages"] as List<*>
        assertEquals(4, st.size)
        assertEquals(listOf("LIGHT", "DEEP", "REM", "AWAKE"), st.map { (it as List<*>)[2] })
        assertEquals("2026-10-05", w.localDate(zone).toString()) // bucketed by start; server dates nights by wake time
    }

    @Test fun skinTempVo2Exercise() {
        val s = t("2026-10-05T18:00:00Z")
        val sk = SkinTemperatureRecord(s, ist, s.plusSeconds(3600), ist, md("k1"), listOf(SkinTemperatureRecord.Delta(s.plusSeconds(60), TemperatureDelta.celsius(-0.3))), Temperature.celsius(33.1), SkinTemperatureRecord.MEASUREMENT_LOCATION_WRIST)
        val w = Mapper.map(sk)!!
        assertEquals(33.1, w.values["baseline"] as Double, 1e-9)
        assertEquals(-0.3, ((w.values["deltas"] as List<*>)[0] as List<*>)[1] as Double, 1e-9)
        val v = Mapper.map(Vo2MaxRecord(s, ist, md("vo"), 44.5, Vo2MaxRecord.MEASUREMENT_METHOD_HEART_RATE_RATIO))!!
        assertEquals(44.5, v.values["v"] as Double, 1e-9)
        val ex = Mapper.map(ExerciseSessionRecord(s, ist, s.plusSeconds(1800), ist, md("e1"), ExerciseSessionRecord.EXERCISE_TYPE_WALKING, "Evening walk"))!!
        assertEquals("Walk", ex.values["name"]); assertEquals("Evening walk", ex.values["title"])
    }

    @Test fun payloadJsonRoundTripAndGzip() {
        val r = Mapper.map(StepsRecord(t("2026-10-06T03:00:00Z"), ist, t("2026-10-06T03:01:00Z"), ist, 87, md("s\"q")))!!
        val p = Payload("backfill", listOf("2026-10-06"), listOf(r), listOf("gone1"), listOf(DayAggregate("2026-10-06", 6758, 4800.5, 2100.0, null, listOf(fitbit))), "Asia/Kolkata", "1.0.0", "Pixel / Android 16", "b1")
        val text = GZIPInputStream(ByteArrayInputStream(p.gzip())).readBytes().toString(Charsets.UTF_8)
        val j = JSONObject(text)
        assertEquals(1, j.getInt("v")); assertEquals("backfill", j.getString("kind"))
        val rec = j.getJSONArray("records").getJSONObject(0)
        assertEquals("s\"q", rec.getString("id")); assertEquals(87, rec.getJSONObject("v").getInt("count")); assertEquals(19800, rec.getInt("so"))
        assertEquals("gone1", j.getJSONArray("deleted").getString(0))
        val a = j.getJSONArray("aggregates").getJSONObject(0)
        assertEquals(6758, a.getInt("steps")); assertTrue(a.isNull("kcal_active"))
    }

    @Test fun batcherChunksByDayNewestFirst() {
        val recs = listOf("2026-10-04", "2026-10-06", "2026-10-05", "2026-10-06").mapIndexed { i, d ->
            Mapper.map(StepsRecord(t("${d}T06:00:00Z").plusSeconds(i * 60L), ist, t("${d}T06:00:00Z").plusSeconds(i * 60L + 60), ist, 10, md("x$i")))!!
        }
        val aggs = listOf(DayAggregate("2026-10-06", 20, null, null, null, emptyList()), DayAggregate("2026-10-01", 5, null, null, null, emptyList()))
        // Light days pack into one request (newest first); leftover aggregate for 2026-10-01 rides along.
        val ch = Batcher.chunk(recs, listOf("del"), aggs, zone)
        assertEquals(1, ch.size)
        assertEquals(listOf("2026-10-06", "2026-10-05", "2026-10-04", "2026-10-01"), ch[0].days)
        assertEquals(4, ch[0].records.size); assertEquals(listOf("del"), ch[0].deleted)
        assertEquals(setOf("2026-10-06", "2026-10-01"), ch[0].aggregates.map { it.date }.toSet())
    }

    @Test fun batcherDoesNotPackWhenOverWeight() {
        val recs = listOf("2026-10-06", "2026-10-05").mapIndexed { i, d ->
            Mapper.map(StepsRecord(t("${d}T06:00:00Z"), ist, t("${d}T06:01:00Z"), ist, 10, md("p$i")))!!
        }
        // Force a tiny budget so each day is its own chunk.
        val ch = Batcher.chunk(recs, emptyList(), emptyList(), zone, maxWeight = 1)
        assertEquals(2, ch.size)
        assertEquals(listOf(listOf("2026-10-06"), listOf("2026-10-05")), ch.map { it.days })
    }

    @Test fun batcherSplitsHeavyDay() {
        val s0 = t("2026-10-06T04:00:00Z")
        // After 1-min downsample each hour of 5s samples is ~60 weight; use a tight budget to force splits.
        val recs = (0 until 5).map { k ->
            val st = s0.plusSeconds(k * 3600L)
            Mapper.map(HeartRateRecord(st, ist, st.plusSeconds(3600), ist, (0 until 700).map { HeartRateRecord.Sample(st.plusSeconds(it * 5L), 70) }, md("h$k")))!!
        }
        val ch = Batcher.chunk(recs, emptyList(), emptyList(), zone, maxWeight = 130)
        assertTrue(ch.size >= 3)
        assertTrue(ch.all { it.days == listOf("2026-10-06") })
        assertEquals(5, ch.sumOf { it.records.size })
    }

    @Test fun deletionsOnly() {
        val ch = Batcher.chunk(emptyList(), listOf("a", "b"), emptyList(), zone)
        assertEquals(1, ch.size); assertEquals(listOf("a", "b"), ch[0].deleted); assertTrue(ch[0].records.isEmpty())
    }

    @Test fun jsonEscapesAndNumbers() {
        assertEquals("{\"a\":\"x\\ny\",\"b\":[1,2.5,null],\"c\":3}", Json.stringify(linkedMapOf("a" to "x\ny", "b" to listOf(1, 2.5, Double.NaN), "c" to 3.0)))
    }
}
