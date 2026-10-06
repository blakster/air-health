package com.vansh.airhealth.sync;

import androidx.health.connect.client.records.metadata.DataOrigin;
import androidx.health.connect.client.records.metadata.Device;
import androidx.health.connect.client.records.metadata.Metadata;
import java.time.Instant;

/** Health Connect sets id / origin / lastModified on read; Kotlin hides that constructor, Java can call it. */
final class TestMeta {
    static Metadata of(String id, String origin, long lastModifiedMs, Device device) {
        return new Metadata(Metadata.RECORDING_METHOD_AUTOMATICALLY_RECORDED, id, new DataOrigin(origin), Instant.ofEpochMilli(lastModifiedMs), null, 0L, device);
    }
}
