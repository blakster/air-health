package com.vansh.airhealth.sync

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : IOException(message)

/** Tiny HTTP client for the dashboard (HttpURLConnection, no extra dependencies). */
class Api(private val server: String) {
    private fun open(path: String, method: String): HttpURLConnection {
        val c = URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection
        c.requestMethod = method
        c.connectTimeout = 15_000
        c.readTimeout = 60_000
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "AirHealthSync/${BuildConfig.VERSION_NAME}")
        return c
    }

    private fun read(c: HttpURLConnection): JSONObject {
        val code = c.responseCode
        val body = (if (code in 200..299) c.inputStream else c.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        val json = try { JSONObject(body) } catch (e: Exception) { JSONObject() }
        if (code !in 200..299) throw ApiException(code, json.optString("error", "HTTP $code"))
        return json
    }

    fun claim(code: String, device: String): String {
        val c = open("/api/hc/claim", "POST")
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        val body = Json.stringify(mapOf("code" to code, "device" to device)).toByteArray()
        c.outputStream.use { it.write(body) }
        val j = try { read(c) } catch (e: ApiException) {
            // An older dashboard without phone sync answers every unknown /api/ call with 401.
            if (e.status == 401) throw ApiException(501, "This dashboard doesn't offer phone pairing yet. Update and restart it, then try again.") else throw e
        }
        return j.optString("token").takeIf { it.length >= 32 } ?: throw ApiException(500, "The dashboard did not return a device token")
    }

    fun ingest(token: String, gz: ByteArray): JSONObject {
        val c = open("/api/hc/ingest", "POST")
        c.doOutput = true
        c.setFixedLengthStreamingMode(gz.size)
        c.setRequestProperty("Content-Type", "application/gzip")
        c.setRequestProperty("Authorization", "Bearer $token")
        c.outputStream.use { it.write(gz) }
        return read(c)
    }

    /**
     * [ackResync]: sync engine takes a "resend everything" request.
     * [ackSleepResync]: sync engine takes a sleep-only recent-window re-read (no full history).
     */
    fun status(token: String, ackResync: Boolean = false, ackSleepResync: Boolean = false): JSONObject {
        val ack = when {
            ackResync -> "?ack=resync"
            ackSleepResync -> "?ack=sleepResync"
            else -> ""
        }
        val c = open("/api/hc/status$ack", "GET")
        c.setRequestProperty("Authorization", "Bearer $token")
        return read(c)
    }
}
