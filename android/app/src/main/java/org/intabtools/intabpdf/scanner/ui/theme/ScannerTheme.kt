package org.intabtools.intabpdf.scanner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object InTabColors {
    val BrandIndigo = Color(0xFF0B2EA8)
    val BrandIndigoLight = Color(0xFF4F63F0)
    val BrandIndigoSoftText = Color(0xFFAAB8FF)
    val DarkBackground = Color(0xFF0C0E18)
    val DarkSurface = Color(0xFF141824)
    val DarkSurfaceVariant = Color(0xFF1C2132)
    val DarkText = Color(0xFFEEF1FA)
    val DarkTextMuted = Color(0xFF9BA4C2)
    val DarkBorder = Color(0xFF2B3349)
    val LightBackground = Color(0xFFF2F4FA)
    val LightSurface = Color(0xFFFFFFFF)
    val LightSurfaceVariant = Color(0xFFE7EAF5)
    val LightText = Color(0xFF0E1330)
    val LightTextMuted = Color(0xFF5A6180)
    val LightBorder = Color(0xFFD9DDEC)
    val Success = Color(0xFF16794A)
    val Danger = Color(0xFFD13438)
    val DangerDark = Color(0xFFF87171)
}

private val LightColors = lightColorScheme(
    primary = InTabColors.BrandIndigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4E9FF),
    onPrimaryContainer = InTabColors.BrandIndigo,
    background = InTabColors.LightBackground,
    onBackground = InTabColors.LightText,
    surface = InTabColors.LightSurface,
    onSurface = InTabColors.LightText,
    surfaceVariant = InTabColors.LightSurfaceVariant,
    onSurfaceVariant = InTabColors.LightTextMuted,
    outline = InTabColors.LightBorder,
    error = InTabColors.Danger,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = InTabColors.BrandIndigoLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF1C2552),
    onPrimaryContainer = InTabColors.BrandIndigoSoftText,
    background = InTabColors.DarkBackground,
    onBackground = InTabColors.DarkText,
    surface = InTabColors.DarkSurface,
    onSurface = InTabColors.DarkText,
    surfaceVariant = InTabColors.DarkSurfaceVariant,
    onSurfaceVariant = InTabColors.DarkTextMuted,
    outline = InTabColors.DarkBorder,
    error = InTabColors.DangerDark,
    onError = InTabColors.DarkBackground,
)

@Composable
fun InTabScannerTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
