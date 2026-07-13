package com.torad.openhouse.legacy

data class Listing(
    val id: String,
    val address: String,
    val price: Long,
    val beds: Int,
    val baths: Int,
    val sqft: Int,
)
