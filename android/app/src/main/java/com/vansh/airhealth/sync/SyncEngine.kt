package com.vansh.airhealth.sync

import android.content.Context
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import java.util.UUID
import kotlin.reflect.KClass
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

data class SyncResult(val ok: Boolean, val sent: Int, val message: String?)

/**
 * Backfill (newest day first, resumable) then incremental sync through the Health Connect Changes API.
 * The changes token is taken BEFORE the backfill starts, so anything written during the backfill is picked up
 * by the first incremental run; the server de-duplicates by record id + lastModified.
 */
class SyncEngine(private val ctx: Context, private val onProgress: suspend (String) -> Unit = {}) {
    private val state = SyncState(ctx)
    private val vault = TokenVault(ctx)
    private val zone: ZoneId = ZoneId.systemDefault()
    private var sent = 0

    companion object {
        const val BACKFILL_DAYS = 30L
        const val BACKFILL_DAYS_WITH_HISTORY = 365L
        /** One local day per window: earlier first paint + "day N of M" progress. */
        const val WINDOW_DAYS = 1L
        const val CHANGES_FLUSH = 8000
        /** Cap concurrent HC reads so we don't overwhelm the binder. */
        const val READ_PARALLELISM = 4
        private val lock = Any()
        @Volatile private var running = false

        fun deviceLabel() = "${Build.MANUFACTURER} ${Build.MODEL} / Android ${Build.VERSION.RELEASE}"
    }

    suspend fun run(trigger: String): SyncResult {
        synchronized(lock) { if (running) return SyncResult(true, 0, "A sync is already running.") ; running = true }
        state.lastAttemptAt = System.currentTimeMillis()
        try {
            val r = runInner(trigger)
            state.lastError = r.message.takeIf { !r.ok }
            if (r.ok) { state.lastSyncAt = System.currentTimeMillis(); state.lastSent = r.sent }
            return r
        } catch (e: Throwable) {
            val msg = Errors.explain(e, state.server)
            state.lastError = msg
            if (sent > 0) state.lastSent = sent
            return SyncResult(false, sent, msg)
        } finally {
            state.progress = null
            synchronized(lock) { running = false }
        }
    }

    private suspend fun progress(s: String) { state.progress = s; onProgress(s) }

    private suspend fun runInner(trigger: String): SyncResult {
        val token = vault.load()
        if (!state.paired || token == null) return SyncResult(false, 0, "Not paired yet. Enter the pairing code from the dashboard's Data page.")
        if (HealthConnectClient.getSdkStatus(ctx) != HealthConnectClient.SDK_AVAILABLE)
            return SyncResult(false, 0, "Health Connect isn't available on this phone yet. Install or update it from the Play Store.")
        val client = HealthConnectClient.getOrCreate(ctx)
        val granted = client.permissionController.getGrantedPermissions()
        val types = HcTypes.ALL.filter { it.permission in granted && (it.feature == null || featureOn(client, it.feature)) }
        if (types.isEmpty()) return SyncResult(false, 0, "No Health Connect permissions yet. Tap \"Grant permissions\".")
        val api = Api(state.server)
        // Reachability + pairing check first, and honour a "resync everything" request from the dashboard.
        progress("Contacting the dashboard")
        val st = api.status(token, ackResync = true)
        if (st.optBoolean("resync", false)) state.resetSync()
        // Sleep-only recovery: re-read recent SleepSession (+ overnight companions) without wiping the changes token / full history.
        val sleepObj = st.optJSONObject("sleepResync")
        val sleepDays = sleepObj?.optInt("days", 0) ?: 0
        if (sleepDays > 0) {
            api.status(token, ackSleepResync = true) // consume so we do not loop
            sleepRecover(client, api, token, types, sleepDays.coerceIn(1, 14))
        }
        val keySet = types.joinToString(",") { it.key }
        val history = HcTypes.HISTORY in granted && featureOn(client, HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY)

        if (state.changesToken == null || state.tokenTypes != keySet) backfill(client, api, token, types, keySet, history)
        changes(client, api, token, types, history, keySet)
        return SyncResult(true, sent, null)
    }

    /** Recent nights only: SleepSession + overnight vitals. Does not reset the incremental changes token. */
    private suspend fun sleepRecover(client: HealthConnectClient, api: Api, token: String, types: List<HcType>, days: Int) {
        val want = setOf("SleepSession", "HeartRateVariabilityRmssd", "RespiratoryRate", "OxygenSaturation", "SkinTemperature", "RestingHeartRate")
        val sleepTypes = types.filter { it.key in want }
        if (sleepTypes.none { it.key == "SleepSession" }) {
            progress("Sleep recovery skipped (no SleepSession permission)")
            return
        }
        val now = Instant.now()
        val from = now.minus(Duration.ofDays(days.toLong()))
        progress("Recovering sleep · last $days night(s)")
        val recs = readTypesParallel(client, sleepTypes, from, now)
        if (recs.isEmpty()) {
            progress("No sleep records in Health Connect for the last $days day(s)")
            return
        }
        send(api, token, "sleep-recover", recs, emptyList(), emptyList())
    }

    private fun featureOn(client: HealthConnectClient, f: Int) =
        try { client.features.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE } catch (e: Throwable) { false }

    private suspend fun backfill(client: HealthConnectClient, api: Api, token: String, types: List<HcType>, keySet: String, history: Boolean) {
        val now = Instant.now()
        if (state.pendingToken == null || state.pendingTypes != keySet) {
            state.pendingToken = client.getChangesToken(ChangesTokenRequest(types.map { it.cls }.toSet()))
            state.pendingTypes = keySet
            val days = if (history) BACKFILL_DAYS_WITH_HISTORY else BACKFILL_DAYS
            state.backfillFrom = now.minus(Duration.ofDays(days)).toEpochMilli()
            state.backfillEnd = now.toEpochMilli()
            state.backfillCursor = now.toEpochMilli()
        }
        val from = Instant.ofEpochMilli(state.backfillFrom)
        val endMs = if (state.backfillEnd > 0) state.backfillEnd else state.backfillCursor
        val totalDays = (((endMs - state.backfillFrom) / 86_400_000L).toInt()).coerceAtLeast(1)
        // Resume point: the cursor only moves down after a window was fully sent. Data written after the backfill
        // started is covered by the changes token taken above.
        var cursor = Instant.ofEpochMilli(state.backfillCursor)
        while (cursor.isAfter(from)) {
            val winStart = maxOf(from, cursor.minus(Duration.ofDays(WINDOW_DAYS)))
            val remaining = (((cursor.toEpochMilli() - state.backfillFrom) / 86_400_000L).toInt()).coerceAtLeast(0)
            val dayNum = (totalDays - remaining + 1).coerceIn(1, totalDays)
            progress("Backfill day $dayNum of $totalDays · ${fmtDay(winStart)}")
            val recs = readTypesParallel(client, types, winStart, cursor)
            val aggs = aggregates(client, types, winStart.atZone(zone).toLocalDate(), cursor.atZone(zone).toLocalDate())
            send(api, token, "backfill", recs, emptyList(), aggs)
            cursor = winStart
            state.backfillCursor = cursor.toEpochMilli()
        }
        state.changesToken = state.pendingToken
        state.tokenTypes = keySet
        state.pendingToken = null; state.pendingTypes = null
    }

    private suspend fun changes(client: HealthConnectClient, api: Api, token: String, types: List<HcType>, history: Boolean, keySet: String) {
        progress("Checking for new data")
        val handled = types.map { it.cls }.toSet()
        var tok = state.changesToken ?: return
        val recs = ArrayList<WireRecord>(); val deleted = ArrayList<String>()
        while (true) {
            val resp = client.getChanges(tok)
            if (resp.changesTokenExpired) {
                // Token is older than ~30 days: start over with a fresh backfill (server de-duplicates).
                state.changesToken = null
                backfill(client, api, token, types, keySet, history)
                tok = state.changesToken ?: return
                continue
            }
            for (c in resp.changes) when (c) {
                is UpsertionChange -> if (c.record::class in handled) Mapper.map(c.record)?.let { recs += it }
                is DeletionChange -> deleted += c.recordId
            }
            val next = resp.nextChangesToken
            if (!resp.hasMore || recs.size + deleted.size >= CHANGES_FLUSH) {
                if (recs.isNotEmpty() || deleted.isNotEmpty()) {
                    progress("Sending ${recs.size + deleted.size} changes")
                    val days = recs.map { it.localDate(zone) }
                    val aggs = if (days.isEmpty()) emptyList() else aggregates(client, types, days.min(), days.max())
                    send(api, token, "changes", recs, deleted, aggs)
                    recs.clear(); deleted.clear()
                }
                state.changesToken = next
            }
            tok = next
            if (!resp.hasMore) break
        }
    }

    /** Read every granted type for [from, to), a few at a time in parallel. */
    private suspend fun readTypesParallel(client: HealthConnectClient, types: List<HcType>, from: Instant, to: Instant): List<WireRecord> =
        coroutineScope {
            val sem = Semaphore(READ_PARALLELISM)
            types.map { t ->
                async {
                    sem.withPermit {
                        readAll(client, t.cls, from, to).mapNotNull { Mapper.map(it) }
                    }
                }
            }.awaitAll().flatten()
        }

    private suspend fun <T : Record> readAll(client: HealthConnectClient, cls: KClass<T>, from: Instant, to: Instant): List<T> {
        val out = ArrayList<T>(); var page: String? = null
        do {
            val r = client.readRecords(ReadRecordsRequest(cls, TimeRangeFilter.between(from, to), pageSize = 5000, pageToken = page))
            out += r.records; page = r.pageToken
        } while (!page.isNullOrEmpty())
        return out
    }

    /** HC's de-duplicated per-day totals (local days), used by the server when no Fitbit-origin records exist. */
    private suspend fun aggregates(client: HealthConnectClient, types: List<HcType>, first: LocalDate, last: LocalDate): List<DayAggregate> {
        val keys = types.map { it.key }.toSet()
        val metrics = mutableSetOf<AggregateMetric<*>>()
        if ("Steps" in keys) metrics += StepsRecord.COUNT_TOTAL
        if ("Distance" in keys) metrics += DistanceRecord.DISTANCE_TOTAL
        if ("TotalCaloriesBurned" in keys) metrics += TotalCaloriesBurnedRecord.ENERGY_TOTAL
        if ("ActiveCaloriesBurned" in keys) metrics += ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL
        if (metrics.isEmpty()) return emptyList()
        val start = maxOf(first, last.minusDays(40)) // HC limits aggregation ranges; changes rarely span longer
        return try {
            client.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(metrics, TimeRangeFilter.between(start.atStartOfDay(), last.plusDays(1).atStartOfDay()), Period.ofDays(1)),
            ).map { g ->
                val r = g.result
                DayAggregate(
                    g.startTime.toLocalDate().toString(), r[StepsRecord.COUNT_TOTAL], r[DistanceRecord.DISTANCE_TOTAL]?.inMeters,
                    r[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories, r[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
                    r.dataOrigins.map { it.packageName }.sorted(),
                )
            }.filter { (it.steps ?: 0) > 0 || (it.distanceM ?: 0.0) > 0 || (it.kcalActive ?: 0.0) > 0 } // total kcal alone is HC's BMR estimate
        } catch (e: SecurityException) { throw e } catch (e: Exception) { emptyList() } // aggregates are optional
    }

    private suspend fun send(api: Api, token: String, kind: String, recs: List<WireRecord>, deleted: List<String>, aggs: List<DayAggregate>) {
        val chunks = Batcher.chunk(recs, deleted, aggs, zone)
        chunks.forEachIndexed { i, ch ->
            if (chunks.size > 1) progress("Sending ${ch.days.firstOrNull() ?: "changes"} (${i + 1} of ${chunks.size})")
            val p = Payload(kind, ch.days, ch.records, ch.deleted, ch.aggregates, zone.id, BuildConfig.VERSION_NAME, deviceLabel(), UUID.randomUUID().toString())
            api.ingest(token, p.gzip())
            sent += ch.records.size + ch.deleted.size
            state.totalSent = state.totalSent + ch.records.size + ch.deleted.size
        }
    }

    private fun fmtDay(i: Instant) = i.atZone(zone).toLocalDate().let { "${it.dayOfMonth} ${it.month.name.take(3).lowercase().replaceFirstChar { c -> c.uppercase() }}" }
}
