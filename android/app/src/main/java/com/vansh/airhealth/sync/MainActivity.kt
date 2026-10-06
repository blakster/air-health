package com.vansh.airhealth.sync

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.work.WorkInfo
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val deepLink = mutableStateOf<Pair<String, String>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handle(intent)
        setContent { AirTheme { SyncScreen(deepLink) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        val u = i?.data ?: return
        if (u.scheme == "airhealth" && u.host == "pair") {
            val code = u.getQueryParameter("code") ?: return
            deepLink.value = (u.getQueryParameter("server") ?: SyncState(this).server) to code
        }
    }
}

private val IST: ZoneId = ZoneId.of("Asia/Kolkata")
private val istFmt: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM, HH:mm", Locale.ENGLISH).withZone(IST)
fun fmtIst(ms: Long): String = if (ms <= 0) "Never" else istFmt.format(Instant.ofEpochMilli(ms)) + " IST"
private fun fmtN(n: Long) = String.format(Locale.forLanguageTag("en-IN"), "%,d", n)

/** Snapshot of everything the screen shows. */
data class HcView(
    val sdk: Int = HealthConnectClient.SDK_UNAVAILABLE,
    val granted: Set<String> = emptySet(),
    val bgAvailable: Boolean = false,
    val historyAvailable: Boolean = false,
    val unavailableTypes: Set<String> = emptySet(),
)

private suspend fun loadHc(ctx: Context): HcView = withContext(Dispatchers.IO) {
    val sdk = HealthConnectClient.getSdkStatus(ctx)
    if (sdk != HealthConnectClient.SDK_AVAILABLE) return@withContext HcView(sdk)
    val c = HealthConnectClient.getOrCreate(ctx)
    fun on(f: Int) = try { c.features.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE } catch (e: Throwable) { false }
    HcView(
        sdk, c.permissionController.getGrantedPermissions(),
        on(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND), on(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY),
        HcTypes.ALL.filter { it.feature != null && !on(it.feature) }.map { it.key }.toSet(),
    )
}

fun requestedPermissions(v: HcView): Set<String> = buildSet {
    HcTypes.ALL.filter { it.key !in v.unavailableTypes }.forEach { add(it.permission) }
    if (v.bgAvailable) add(HcTypes.BACKGROUND)
    if (v.historyAvailable) add(HcTypes.HISTORY)
}

@Composable
fun SyncScreen(deepLink: MutableState<Pair<String, String>?>) {
    val ctx = LocalContext.current
    val p = LocalPalette.current
    val scope = rememberCoroutineScope()
    val state = remember { SyncState(ctx) }
    val vault = remember { TokenVault(ctx) }

    var tick by remember { mutableIntStateOf(0) }
    DisposableEffect(Unit) {
        val l = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> tick++ }
        state.prefs.registerOnSharedPreferenceChangeListener(l)
        onDispose { state.prefs.unregisterOnSharedPreferenceChangeListener(l) }
    }
    var server by rememberSaveable { mutableStateOf(state.server) }
    var code by rememberSaveable { mutableStateOf("") }
    var pairMsg by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    var pairing by remember { mutableStateOf(false) }
    var hc by remember { mutableStateOf(HcView()) }
    var remote by remember { mutableStateOf<String?>(null) }
    val paired = remember(tick) { state.paired }

    val refresh: () -> Unit = {
        scope.launch {
            hc = try { loadHc(ctx) } catch (e: Throwable) { HcView() }
            if (state.paired) {
                val t = vault.load()
                remote = try {
                    withContext(Dispatchers.IO) {
                        val j = Api(state.server).status(t ?: "")
                        val last = j.optLong("lastIngestAt", 0)
                        val days = j.optInt("days", 0)
                        if (last > 0) "Dashboard last received data ${fmtIst(last)} · $days days from this phone" else "Dashboard is waiting for the first sync"
                    }
                } catch (e: Throwable) { Errors.explain(e, state.server) }
            }
        }
    }
    LifecycleResumeEffect(Unit) { refresh(); onPauseOrDispose { } }

    val permLauncher = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        refresh()
        if (state.paired && granted.isNotEmpty()) SyncWorker.syncNow(ctx)
    }

    val work by remember { WorkManager.getInstance(ctx).getWorkInfosForUniqueWorkFlow(SyncWorker.NOW) }.collectAsState(initial = emptyList())
    val running = work.any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED }
    val progress = work.firstOrNull { it.state == WorkInfo.State.RUNNING }?.progress?.getString("progress") ?: remember(tick) { state.progress }

    // Refresh the dashboard's view once a sync finishes.
    LaunchedEffect(running) { if (!running) refresh() }

    fun doPair(srv: String, c: String) {
        val s = srv.trim().trimEnd('/')
        val cc = c.trim().uppercase().replace(" ", "")
        val bad = urlProblem(s)
        if (bad != null) { pairMsg = false to bad; return }
        if (cc.length < 6) { pairMsg = false to "Enter the pairing code shown on the dashboard's Data page."; return }
        pairing = true; pairMsg = null
        scope.launch {
            try {
                val token = withContext(Dispatchers.IO) { Api(s).claim(cc, SyncEngine.deviceLabel()) }
                vault.save(token)
                state.server = s; state.resetSync(); state.lastError = null; state.paired = true
                SyncWorker.schedule(ctx)
                code = ""
                pairMsg = true to "Paired. Data will sync about every 15 minutes."
                val v = loadHc(ctx); hc = v
                if (v.granted.isNotEmpty()) SyncWorker.syncNow(ctx)
                refresh()
            } catch (e: Throwable) {
                pairMsg = false to Errors.explain(e, s)
            } finally { pairing = false }
        }
    }

    LaunchedEffect(deepLink.value) {
        deepLink.value?.let { (s, c) -> server = s; code = c; deepLink.value = null; doPair(s, c) }
    }

    Column(
        Modifier.fillMaxSize().background(p.paper).windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("AIR HEALTH", style = MaterialTheme.typography.bodySmall.copy(letterSpacing = 1.4.sp, fontWeight = FontWeight.SemiBold))
        Column {
            Text("Phone sync", style = MaterialTheme.typography.headlineMedium)
            Text("Sends your Health Connect data from this phone to your Air Health dashboard.", style = MaterialTheme.typography.bodyMedium.copy(color = p.ink2))
        }

        // ---- Dashboard / pairing ----
        Sheet {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Dashboard", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (paired) Pill("Paired", p.pos) else Pill("Not paired", p.ink3)
            }
            Field("Server address", server, { server = it }, enabled = !paired, keyboard = KeyboardType.Uri)
            if (!paired) {
                Field("Pairing code", code, { code = it.uppercase() }, keyboard = KeyboardType.Ascii, caps = true, onDone = { doPair(server, code) })
                Text("On the dashboard, open Data › Phone sync › Pair phone. Type the code, or scan its QR code with the camera.", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Primary(if (pairing) "Pairing…" else "Pair", enabled = !pairing) { doPair(server, code) }
                    Ghost("Open dashboard") { openUrl(ctx, server) }
                }
            } else {
                remote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Primary("Open dashboard") { openUrl(ctx, state.server) }
                    Ghost("Unpair") {
                        vault.clear(); state.paired = false; state.resetSync(); SyncWorker.cancel(ctx); remote = null
                        pairMsg = true to "Unpaired on this phone. To revoke it on the dashboard too, use Unpair on the Data page."
                    }
                }
            }
            pairMsg?.let { (ok, m) -> Text(m, style = MaterialTheme.typography.bodyMedium.copy(color = if (ok) p.pos else p.neg)) }
        }

        // ---- Health Connect permissions ----
        Sheet {
            Text("Health Connect", style = MaterialTheme.typography.titleMedium)
            when (hc.sdk) {
                HealthConnectClient.SDK_AVAILABLE -> {
                    val missing = requestedPermissions(hc) - hc.granted
                    Text(
                        if (missing.isEmpty()) "All data types are allowed." else "Allow the data types you want on the dashboard. Read-only; nothing is written back.",
                        style = MaterialTheme.typography.bodyMedium.copy(color = p.ink2),
                    )
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(1.dp, p.rule, RoundedCornerShape(10.dp))) {
                        HcTypes.ALL.forEachIndexed { i, t ->
                            val st = when {
                                t.key in hc.unavailableTypes -> "Needs newer Health Connect" to p.ink3
                                t.permission in hc.granted -> "Allowed" to p.pos
                                else -> "Not allowed" to p.neg
                            }
                            PermRow(t.label, st.first, st.second, i > 0)
                        }
                        PermRow("Background access", when { !hc.bgAvailable -> "Not on this phone"; HcTypes.BACKGROUND in hc.granted -> "Allowed"; else -> "Not allowed" },
                            when { !hc.bgAvailable -> p.ink3; HcTypes.BACKGROUND in hc.granted -> p.pos; else -> p.neg }, true)
                        PermRow("Data older than 30 days", when { !hc.historyAvailable -> "Not on this phone"; HcTypes.HISTORY in hc.granted -> "Allowed"; else -> "Not allowed" },
                            when { !hc.historyAvailable -> p.ink3; HcTypes.HISTORY in hc.granted -> p.pos; else -> p.ink3 }, true)
                    }
                    if (!hc.bgAvailable || HcTypes.BACKGROUND !in hc.granted)
                        Text("Without background access, automatic syncs only work while this app is open. Tap Sync now after opening it.", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (missing.isNotEmpty()) Primary("Grant permissions") { permLauncher.launch(requestedPermissions(hc)) }
                        Ghost("Health Connect settings") {
                            try { ctx.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)) } catch (e: ActivityNotFoundException) { openUrl(ctx, "market://details?id=com.google.android.apps.healthdata") }
                        }
                    }
                }
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                    Text("Health Connect needs to be installed or updated from the Play Store.", style = MaterialTheme.typography.bodyMedium)
                    Primary("Get Health Connect") { openUrl(ctx, "market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding") }
                }
                else -> Text("Health Connect isn't available on this phone.", style = MaterialTheme.typography.bodyMedium.copy(color = p.neg))
            }
            Text("The Air's data reaches Health Connect through the Google Health app: open it, tap Connections › Partner apps › Sync your favorite health apps › Set up, and allow all. Check in Health Connect settings › App permissions › Health that it may write data.", style = MaterialTheme.typography.bodySmall)
        }

        // ---- Sync ----
        Sheet {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Sync", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (running) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = p.recov)
            }
            val s = remember(tick) { Triple(state.lastSyncAt, state.lastSent, state.totalSent) }
            val err = remember(tick) { state.lastError }
            Stat("Last sync", fmtIst(s.first))
            Stat("Records sent last time", fmtN(s.second.toLong()))
            Stat("Records sent in total", fmtN(s.third))
            progress?.let { Text(it, style = MaterialTheme.typography.bodyMedium.copy(color = p.recov)) }
            err?.let { Text(it, style = MaterialTheme.typography.bodyMedium.copy(color = p.neg)) }
            Primary(if (running) "Syncing…" else "Sync now", enabled = paired && !running && hc.granted.isNotEmpty()) { SyncWorker.syncNow(ctx) }
            Text("Syncs about every 15 minutes when the phone has a network. The first sync sends the last 30 days (a year if past data is allowed), day by day.", style = MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick = { ctx.startActivity(Intent(ctx, PrivacyPolicyActivity::class.java)) }) {
            Text("Privacy: what this app reads and where it goes", style = MaterialTheme.typography.bodySmall.copy(color = p.ink2))
        }
    }
}

fun urlProblem(s: String): String? {
    val u = try { Uri.parse(s) } catch (e: Exception) { null }
    if (u == null || u.host.isNullOrEmpty() || (u.scheme != "http" && u.scheme != "https")) return "Enter the dashboard address, like http://100.64.0.1:4870 (your Tailscale IP)"
    val host = u.host!!
    val okHttp = host == "YOUR_TAILSCALE_IP" || host.startsWith("100.64.") || (BuildConfig.DEBUG && host == "10.0.2.2")
    if (u.scheme == "http" && !okHttp) return "Plain http only works for Tailscale addresses (100.64.x.x). Use that, or an https:// address."
    return null
}

fun openUrl(ctx: Context, url: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: ActivityNotFoundException) { }
}

@Composable
fun Sheet(content: @Composable ColumnScope.() -> Unit) {
    val p = LocalPalette.current
    Surface(shape = RoundedCornerShape(14.dp), color = p.sheet, border = BorderStroke(1.dp, p.rule.copy(alpha = 0.7f)), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

@Composable
fun Pill(text: String, color: Color) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).clip(RoundedCornerShape(50)).background(color))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.bodySmall.copy(color = color, fontWeight = FontWeight.SemiBold))
    }
}

@Composable
fun PermRow(label: String, status: String, color: Color, divider: Boolean) {
    val p = LocalPalette.current
    if (divider) HorizontalDivider(color = p.rule.copy(alpha = 0.7f))
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(status, style = MaterialTheme.typography.bodySmall.copy(color = color, fontWeight = FontWeight.Medium))
    }
}

@Composable
fun Stat(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium.copy(color = LocalPalette.current.ink2), modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold))
    }
}

@Composable
fun Field(label: String, value: String, onChange: (String) -> Unit, enabled: Boolean = true, keyboard: KeyboardType = KeyboardType.Text, caps: Boolean = false, onDone: (() -> Unit)? = null) {
    val p = LocalPalette.current
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, enabled = enabled, singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = if (caps) KeyboardCapitalization.Characters else KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = if (onDone != null) ImeAction.Done else ImeAction.Next),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        shape = RoundedCornerShape(10.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = p.ink, unfocusedBorderColor = p.rule, focusedLabelColor = p.ink2, unfocusedLabelColor = p.ink3,
            disabledTextColor = p.ink2, disabledBorderColor = p.rule, disabledLabelColor = p.ink3, cursorColor = p.ink,
            focusedContainerColor = p.sheet, unfocusedContainerColor = p.sheet, disabledContainerColor = p.sheet2,
        ),
    )
}

@Composable
fun Primary(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Button(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = p.ink, contentColor = p.onAccent, disabledContainerColor = p.rule, disabledContentColor = p.ink3)) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun Ghost(text: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    OutlinedButton(onClick = onClick, shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, p.rule), colors = ButtonDefaults.outlinedButtonColors(contentColor = p.ink)) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}
