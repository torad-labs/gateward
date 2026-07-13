package com.torad.openhouse.core.model

/**
 * A single real estate listing.
 *
 * Pure data: this module has zero Android dependencies, so [Listing] can be
 * used from every layer (domain, data, presentation) without pulling in the
 * Android SDK.
 */
data class Listing(
    val id: String,
    val address: String,
    val price: Long,
    val beds: Int,
    val baths: Int,
    val sqft: Int,
    val imageRes: Int? = null,
)
