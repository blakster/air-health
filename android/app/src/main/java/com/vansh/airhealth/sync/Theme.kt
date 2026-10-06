package com.vansh.airhealth.sync

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Same tokens as the dashboard's v2 stylesheet (public/styles.css). */
@Immutable
data class Palette(
    val paper: Color, val sheet: Color, val sheet2: Color, val ink: Color, val ink2: Color, val ink3: Color, val rule: Color,
    val recov: Color, val heart: Color, val pos: Color, val neg: Color, val onAccent: Color,
)

val LightPalette = Palette(
    paper = Color(0xFFE7EAE4), sheet = Color(0xFFF6F7F3), sheet2 = Color(0xFFEEF0EB), ink = Color(0xFF18201C),
    ink2 = Color(0xFF47514C), ink3 = Color(0xFF5D6862), rule = Color(0xFFD3D8D0), recov = Color(0xFF1F7A86),
    heart = Color(0xFFB8334A), pos = Color(0xFF2F6B45), neg = Color(0xFF9A4A1C), onAccent = Color(0xFFF6F7F3),
)
val DarkPalette = Palette(
    paper = Color(0xFF111513), sheet = Color(0xFF191E1B), sheet2 = Color(0xFF212723), ink = Color(0xFFE6EAE5),
    ink2 = Color(0xFFAAB3AD), ink3 = Color(0xFF8B958F), rule = Color(0xFF2B322E), recov = Color(0xFF4FB3BF),
    heart = Color(0xFFEF6B7F), pos = Color(0xFF7CC293), neg = Color(0xFFE3926A), onAccent = Color(0xFF111513),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

val Serif = FontFamily(
    Font(R.font.newsreader, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.newsreader, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.newsreader, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
)
val Sans = FontFamily(
    Font(R.font.instrument_sans, FontWeight.Normal, variationSettings = FontVariation.Settings(FontVariation.weight(400))),
    Font(R.font.instrument_sans, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.instrument_sans, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
)

@Composable
fun AirTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val p = if (dark) DarkPalette else LightPalette
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = p.ink, onPrimary = p.onAccent, background = p.paper, surface = p.sheet, onSurface = p.ink,
        onBackground = p.ink, surfaceVariant = p.sheet2, onSurfaceVariant = p.ink2, outline = p.rule, error = p.neg,
        secondary = p.recov,
    )
    val base = TextStyle(fontFamily = Sans, color = p.ink)
    val typo = MaterialTheme.typography.let { t ->
        t.copy(
            headlineMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Medium, fontSize = 32.sp, lineHeight = 38.sp, color = p.ink),
            titleMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Medium, fontSize = 21.sp, lineHeight = 26.sp, color = p.ink),
            bodyLarge = base.copy(fontSize = 16.sp, lineHeight = 23.sp),
            bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
            bodySmall = base.copy(fontSize = 12.5.sp, lineHeight = 17.sp, color = p.ink3),
            labelLarge = TextStyle(fontFamily = Sans, fontSize = 14.sp, fontWeight = FontWeight.SemiBold), // colour comes from the button
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = typo, content = content)
    }
}
