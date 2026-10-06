package com.vansh.airhealth.sync

import android.app.Application

class SyncApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (SyncState(this).paired) SyncWorker.schedule(this)
    }
}
