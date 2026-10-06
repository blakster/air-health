package com.vansh.airhealth.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val trigger = inputData.getString("trigger") ?: "periodic"
        val r = SyncEngine(applicationContext) { setProgress(workDataOf("progress" to it)) }.run(trigger)
        // Failures are recorded in SyncState and shown in the app; the periodic schedule is the retry.
        return Result.success(workDataOf("ok" to r.ok, "sent" to r.sent, "message" to r.message))
    }

    companion object {
        const val PERIODIC = "hc-sync-periodic"
        const val NOW = "hc-sync-now"
        /** Android's minimum periodic interval is 15 minutes. */
        const val PERIOD_MINUTES = 15L
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(PERIOD_MINUTES, TimeUnit.MINUTES, 5, TimeUnit.MINUTES)
                .setConstraints(net).setInputData(workDataOf("trigger" to "periodic")).build()
            // REPLACE so an upgrade from the old hourly unique name / interval takes effect.
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
            // Cancel the legacy hourly work name if it is still queued from v1.0.0.
            WorkManager.getInstance(ctx).cancelUniqueWork("hc-sync-hourly")
        }

        fun cancel(ctx: Context) {
            WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(ctx).cancelUniqueWork("hc-sync-hourly")
            WorkManager.getInstance(ctx).cancelUniqueWork(NOW)
        }

        fun syncNow(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(net)
                .setInputData(workDataOf("trigger" to "manual")).build()
            // REPLACE so tapping Sync now while a stale run is enqueued starts fresh.
            WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
        }
    }
}
