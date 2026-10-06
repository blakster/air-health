package com.vansh.airhealth.sync

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.zip.Deflater
import java.util.zip.GZIPOutputStream

/**
 * Wire format sent to POST /api/hc/ingest (gzip JSON). Pure Kotlin so it can be unit tested on the JVM.
 *
 * Record: {"t":type,"id":hcId,"lm":lastModifiedMs,"o":originPackage,"dev":"maker model (TYPE)","s":startMs,"e":endMs,
 *          "so":startOffsetSec,"eo":endOffsetSec,"v":{type-specific values}}
 */
data class WireRecord(
    val type: String,
    val id: String,
    val lastModified: Long,
    val origin: String,
    val device: String?,
    val start: Long,
    val end: Long?,
    val startOffsetSec: Int?,
    val endOffsetSec: Int?,
    val values: Map<String, Any?>,
) {
    /** Local calendar day of the record start, in the record's own offset (falls back to the phone's zone). */
    fun localDate(zone: ZoneId): LocalDate {
        val inst = Instant.ofEpochMilli(start)
        val off = startOffsetSec?.let { ZoneOffset.ofTotalSeconds(it) } ?: zone.rules.getOffset(inst)
        return inst.atOffset(off).toLocalDate()
    }

    /** Rough payload weight, used to keep each request small. HR samples dominate. */
    fun weight(): Int {
        var w = 1
        for (v in values.values) if (v is List<*>) w += v.size
        return w
    }

    fun toJson(sb: StringBuilder) {
        val m = LinkedHashMap<String, Any?>()
        m["t"] = type; m["id"] = id; m["lm"] = lastModified; m["o"] = origin
        if (device != null) m["dev"] = device
        m["s"] = start
        if (end != null) m["e"] = end
        if (startOffsetSec != null) m["so"] = startOffsetSec
        if (endOffsetSec != null) m["eo"] = endOffsetSec
        m["v"] = values
        Json.write(sb, m)
    }
}

/** HC's own de-duplicated daily totals (aggregate API, priority-ordered across apps). */
data class DayAggregate(
    val date: String,
    val steps: Long?,
    val distanceM: Double?,
    val kcalTotal: Double?,
    val kcalActive: Double?,
    val origins: List<String>,
) {
    fun toMap(): Map<String, Any?> = linkedMapOf(
        "date" to date, "steps" to steps, "distance_m" to distanceM, "kcal_total" to kcalTotal,
        "kcal_active" to kcalActive, "origins" to origins,
    )
}

data class Payload(
    val kind: String,
    val days: List<String>,
    val records: List<WireRecord>,
    val deleted: List<String>,
    val aggregates: List<DayAggregate>,
    val tz: String,
    val appVersion: String,
    val device: String,
    val batch: String,
) {
    fun toJson(): String {
        val sb = StringBuilder(4096 + records.size * 160)
        sb.append("{\"v\":1,\"kind\":"); Json.str(sb, kind)
        sb.append(",\"batch\":"); Json.str(sb, batch)
        sb.append(",\"tz\":"); Json.str(sb, tz)
        sb.append(",\"app\":"); Json.str(sb, appVersion)
        sb.append(",\"device\":"); Json.str(sb, device)
        sb.append(",\"sentAt\":").append(System.currentTimeMillis())
        sb.append(",\"days\":"); Json.write(sb, days)
        sb.append(",\"deleted\":"); Json.write(sb, deleted)
        sb.append(",\"aggregates\":"); Json.write(sb, aggregates.map { it.toMap() })
        sb.append(",\"records\":[")
        records.forEachIndexed { i, r -> if (i > 0) sb.append(','); r.toJson(sb) }
        sb.append("]}")
        return sb.toString()
    }

    fun gzip(): ByteArray {
        val bos = ByteArrayOutputStream()
        FastGzip(bos).use { it.write(toJson().toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }
}

/** GZIP tuned for sync latency (CPU << network wait on Tailscale). */
private class FastGzip(out: OutputStream) : GZIPOutputStream(out) {
    init { def.setLevel(Deflater.BEST_SPEED) }
}

/** One request's worth of data. */
data class Chunk(val days: List<String>, val records: List<WireRecord>, val deleted: List<String>, val aggregates: List<DayAggregate>)

object Batcher {
    /**
     * Max weight (records + HR minute-samples) per request.
     * After 1-min HR downsample a full day is typically well under 5k; packing several days cuts round trips.
     * ~80k still gzips to a few hundred KB, under the server's 25 MB limit.
     */
    const val MAX_WEIGHT = 80_000

    /**
     * Split records into request chunks. Days are ordered newest first so recent data lands first.
     * Light consecutive days are packed together until [maxWeight]; a single heavy day is split further.
     * Each day's HC aggregate rides on that day's last slice; deletions and leftover aggregates ride on the
     * first chunk, or get a chunk of their own when there are no records.
     */
    fun chunk(records: List<WireRecord>, deleted: List<String>, aggregates: List<DayAggregate>, zone: ZoneId, maxWeight: Int = MAX_WEIGHT): List<Chunk> {
        val byDay = records.groupBy { it.localDate(zone).toString() }.toSortedMap(compareByDescending { it })
        val aggByDay = aggregates.associateBy { it.date }.toMutableMap()
        // Build per-day slices first (a heavy day may become several slices).
        data class Slice(val day: String, val records: List<WireRecord>, val aggregates: List<DayAggregate>, val weight: Int)
        val slices = mutableListOf<Slice>()
        for ((day, recs) in byDay) {
            val parts = mutableListOf<List<WireRecord>>()
            var cur = mutableListOf<WireRecord>(); var w = 0
            for (r in recs.sortedBy { it.start }) {
                val rw = r.weight()
                if (cur.isNotEmpty() && w + rw > maxWeight) { parts += cur; cur = mutableListOf(); w = 0 }
                cur += r; w += rw
            }
            if (cur.isNotEmpty()) parts += cur
            parts.forEachIndexed { i, p ->
                val agg = if (i == parts.lastIndex) listOfNotNull(aggByDay.remove(day)) else emptyList()
                slices += Slice(day, p, agg, p.sumOf { it.weight() })
            }
        }
        // Pack light slices newest-first into fewer HTTP requests.
        val out = mutableListOf<Chunk>()
        var days = mutableListOf<String>()
        var recs = mutableListOf<WireRecord>()
        var aggs = mutableListOf<DayAggregate>()
        var weight = 0
        fun flush() {
            if (recs.isEmpty() && aggs.isEmpty()) return
            out += Chunk(days.distinct(), recs.toList(), emptyList(), aggs.toList())
            days = mutableListOf(); recs = mutableListOf(); aggs = mutableListOf(); weight = 0
        }
        for (s in slices) {
            if (recs.isNotEmpty() && weight + s.weight > maxWeight) flush()
            days += s.day; recs += s.records; aggs += s.aggregates; weight += s.weight
        }
        flush()
        val leftover = aggByDay.values.sortedByDescending { it.date }
        if (deleted.isNotEmpty() || leftover.isNotEmpty()) {
            if (out.isEmpty()) out += Chunk(leftover.map { it.date }, emptyList(), deleted, leftover)
            else {
                val f = out[0]
                out[0] = f.copy(
                    days = (f.days + leftover.map { it.date }).distinct(),
                    deleted = deleted,
                    aggregates = f.aggregates + leftover,
                )
            }
        }
        return out
    }
}

/** Minimal JSON writer (org.json is not available in plain JVM unit tests). */
object Json {
    fun write(sb: StringBuilder, v: Any?) {
        when (v) {
            null -> sb.append("null")
            is String -> str(sb, v)
            is Boolean -> sb.append(v)
            is Int, is Long, is Short, is Byte -> sb.append(v.toString())
            is Double -> num(sb, v)
            is Float -> num(sb, v.toDouble())
            is Number -> num(sb, v.toDouble())
            is Map<*, *> -> {
                sb.append('{'); var first = true
                for ((k, x) in v) { if (!first) sb.append(','); first = false; str(sb, k.toString()); sb.append(':'); write(sb, x) }
                sb.append('}')
            }
            is Iterable<*> -> { sb.append('['); var first = true; for (x in v) { if (!first) sb.append(','); first = false; write(sb, x) }; sb.append(']') }
            is LongArray -> write(sb, v.toList())
            is DoubleArray -> write(sb, v.toList())
            else -> str(sb, v.toString())
        }
    }

    private fun num(sb: StringBuilder, d: Double) {
        if (d.isNaN() || d.isInfinite()) { sb.append("null"); return }
        if (d == Math.rint(d) && Math.abs(d) < 1e15) sb.append(d.toLong()) else {
            // 4 decimals is plenty for health values and keeps payloads small.
            val r = Math.round(d * 10000.0) / 10000.0
            sb.append(r.toString())
        }
    }

    fun str(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) when (c) {
            '"' -> sb.append("\\\""); '\\' -> sb.append("\\\\"); '\n' -> sb.append("\\n"); '\r' -> sb.append("\\r"); '\t' -> sb.append("\\t")
            else -> if (c < ' ') sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
        }
        sb.append('"')
    }

    fun stringify(v: Any?): String = StringBuilder().also { write(it, v) }.toString()
}
