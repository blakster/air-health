package com.vansh.airhealth.sync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Shown by Health Connect from its permission screen ("Read privacy policy") and from the app's footer link. */
class PrivacyPolicyActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AirTheme {
                val p = LocalPalette.current
                Column(
                    Modifier.fillMaxSize().background(p.paper).windowInsetsPadding(WindowInsets.safeDrawing)
                        .verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("Privacy", style = MaterialTheme.typography.headlineMedium)
                    Sheet {
                        Text("What it reads", style = MaterialTheme.typography.titleMedium)
                        Text("Read-only access to the Health Connect types you allow: steps, distance, calories, heart rate, resting heart rate, HRV, sleep and sleep stages, SpO\u2082, breathing rate, skin temperature, VO\u2082 max, workouts and weight. It never writes to Health Connect.")
                        Text("Where it goes", style = MaterialTheme.typography.titleMedium)
                        Text("Only to your own Air Health dashboard at the address you entered (by default your computer on your Tailscale network). Nothing is sent to the app's developer, advertisers or any other server. There is no analytics or tracking.")
                        Text("How it is protected", style = MaterialTheme.typography.titleMedium)
                        Text("The dashboard accepts data only with a device token issued at pairing. The token is encrypted on this phone with a key kept in the Android Keystore, and is excluded from backups. Traffic to the Tailscale address is encrypted by Tailscale.")
                        Text("Your control", style = MaterialTheme.typography.titleMedium)
                        Text("Revoke access any time in Health Connect settings, tap Unpair in this app, or Unpair on the dashboard's Data page. Deleting data on the dashboard does not touch Health Connect or your Google data.")
                    }
                }
            }
        }
    }
}
