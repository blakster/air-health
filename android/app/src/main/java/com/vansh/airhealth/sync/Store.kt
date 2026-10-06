package com.vansh.airhealth.sync

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device token, encrypted with an AES-256-GCM key that lives in the Android Keystore (never leaves the secure
 * hardware / keystore daemon). Only the ciphertext is in SharedPreferences, and backups are disabled.
 */
class TokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("vault", Context.MODE_PRIVATE)
    private val alias = "airhealth-device-token"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun save(token: String) {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        val blob = c.iv + c.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs.edit().putString("t", Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
    }

    fun load(): String? {
        val b64 = prefs.getString("t", null) ?: return null
        return try {
            val blob = Base64.decode(b64, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 0, 12))
            String(c.doFinal(blob, 12, blob.size - 12), Charsets.UTF_8)
        } catch (e: Exception) { null }
    }

    fun clear() { prefs.edit().remove("t").apply() }
}

/** Non-secret sync state. */
class SyncState(context: Context) {
    val prefs: SharedPreferences = context.getSharedPreferences("sync", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", null) ?: BuildConfig.DEFAULT_SERVER
        set(v) = prefs.edit().putString("server", v.trim().trimEnd('/')).apply()
    var paired: Boolean
        get() = prefs.getBoolean("paired", false)
        set(v) = prefs.edit().putBoolean("paired", v).apply()

    var changesToken: String?
        get() = prefs.getString("changesToken", null)
        set(v) = prefs.edit().putString("changesToken", v).apply()
    var tokenTypes: String?
        get() = prefs.getString("tokenTypes", null)
        set(v) = prefs.edit().putString("tokenTypes", v).apply()
    var pendingToken: String?
        get() = prefs.getString("pendingToken", null)
        set(v) = prefs.edit().putString("pendingToken", v).apply()
    var pendingTypes: String?
        get() = prefs.getString("pendingTypes", null)
        set(v) = prefs.edit().putString("pendingTypes", v).apply()
    var backfillFrom: Long
        get() = prefs.getLong("backfillFrom", 0)
        set(v) = prefs.edit().putLong("backfillFrom", v).apply()
    var backfillCursor: Long
        get() = prefs.getLong("backfillCursor", 0)
        set(v) = prefs.edit().putLong("backfillCursor", v).apply()
    var backfillEnd: Long
        get() = prefs.getLong("backfillEnd", 0)
        set(v) = prefs.edit().putLong("backfillEnd", v).apply()

    var lastSyncAt: Long
        get() = prefs.getLong("lastSyncAt", 0)
        set(v) = prefs.edit().putLong("lastSyncAt", v).apply()
    var lastAttemptAt: Long
        get() = prefs.getLong("lastAttemptAt", 0)
        set(v) = prefs.edit().putLong("lastAttemptAt", v).apply()
    var lastSent: Int
        get() = prefs.getInt("lastSent", 0)
        set(v) = prefs.edit().putInt("lastSent", v).apply()
    var totalSent: Long
        get() = prefs.getLong("totalSent", 0)
        set(v) = prefs.edit().putLong("totalSent", v).apply()
    var lastError: String?
        get() = prefs.getString("lastError", null)
        set(v) = prefs.edit().putString("lastError", v).apply()
    var progress: String?
        get() = prefs.getString("progress", null)
        set(v) = prefs.edit().putString("progress", v).apply()

    /** Forget sync position so the next run backfills again (after pairing with a new dashboard, for example). */
    fun resetSync() {
        prefs.edit().remove("changesToken").remove("tokenTypes").remove("pendingToken").remove("pendingTypes")
            .remove("backfillFrom").remove("backfillCursor").remove("backfillEnd").apply()
    }
}
