package com.torad.openhouse.core.ui.format

import java.text.NumberFormat
import java.util.Locale

/** Formats a whole-dollar listing price as a locale-stable currency string, e.g. "$450,000". */
fun formatPrice(price: Long): String {
    val formatter = NumberFormat.getCurrencyInstance(Locale.US)
    formatter.maximumFractionDigits = 0
    return formatter.format(price)
}
