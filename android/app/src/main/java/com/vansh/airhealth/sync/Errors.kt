package com.vansh.airhealth.sync

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Turn exceptions into one plain sentence for the screen. */
object Errors {
    fun explain(e: Throwable, server: String): String {
        val msg = e.message ?: ""
        return when {
            e is ApiException && e.status == 401 -> "This phone is no longer paired with the dashboard. Get a new pairing code on the dashboard's Data page and pair again."
            e is ApiException && e.status == 403 -> "The dashboard refused the request ($msg)."
            e is ApiException && e.status == 404 && msg.contains("code", true) -> "That pairing code isn't valid. Codes work once and expire after 10 minutes; make a new one on the Data page."
            e is ApiException && e.status == 410 -> "That pairing code has expired. Make a new one on the Data page."
            e is ApiException && e.status == 501 -> msg
            e is ApiException && e.status == 429 -> "Too many tries. Wait 15 minutes, then try again."
            e is ApiException && e.status == 413 -> "The dashboard rejected a batch as too large. It will retry on the next sync."
            e is ApiException && e.status >= 500 -> "The dashboard had a problem saving the data ($msg). It will retry on the next sync."
            e is ApiException -> "The dashboard said: $msg"
            e is SecurityException && msg.contains("background", true) -> "Health Connect blocked a background read. Open the app and grant \"Access data in the background\", or tap Sync now while the app is open."
            e is SecurityException -> "Health Connect permission is missing. Tap \"Grant permissions\" and allow the data types."
            msg.contains("quota", true) || msg.contains("rate limit", true) -> "Health Connect asked the app to slow down. It will continue automatically on the next sync."
            msg.contains("Cleartext", true) -> "Plain http is only allowed to your Tailscale address (100.64.x.x). Add it in res/xml/network_security_config.xml, or use https://."
            e is UnknownHostException || e is ConnectException || e is SocketTimeoutException ->
                "Can't reach the dashboard at $server. Check that Tailscale is on (on this phone and on the computer) and that the dashboard is running."
            e is SSLException -> "Secure connection to $server failed. Check the address."
            e is IOException -> "Network problem talking to the dashboard: $msg"
            else -> "Something went wrong: ${e.javaClass.simpleName}${if (msg.isNotEmpty()) " ($msg)" else ""}"
        }
    }
}
