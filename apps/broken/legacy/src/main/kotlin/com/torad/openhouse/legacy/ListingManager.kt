package com.torad.openhouse.legacy

import java.text.NumberFormat
import java.util.Locale

/**
 * Owns the whole property catalog for the app: seeding, lookup caching,
 * filtering, and price formatting all live here because nobody has split
 * this up since it was written. One shared instance, mutable end to end.
 */
class ListingManager private constructor() {

    private val storage: MutableList<Listing> = seedListings().toMutableList()
    private val cacheById: MutableMap<String, Listing> = mutableMapOf()
    private var cachePrimed = false

    fun getAllListings(): List<Listing> = storage

    fun getListingById(id: String): Listing {
        if (!cachePrimed) {
            storage.forEach { cacheById[it.id] = it }
            cachePrimed = true
        }
        return cacheById[id]!!
    }

    fun filterByMinBeds(minBeds: Int): List<Listing> = storage.filter { it.beds >= minBeds }

    fun formatPrice(price: Long): String {
        val formatter = NumberFormat.getCurrencyInstance(Locale.US)
        formatter.maximumFractionDigits = 0
        return formatter.format(price)
    }

    companion object {
        val INSTANCE: ListingManager = ListingManager()
    }
}

private fun seedListings(): List<Listing> = listOf(
    Listing(id = "1", address = "123 Maple Street, Springfield", price = 450_000, beds = 3, baths = 2, sqft = 1_850),
    Listing(id = "2", address = "456 Oak Avenue, Rivertown", price = 625_000, beds = 4, baths = 3, sqft = 2_400),
    Listing(id = "3", address = "789 Birch Lane, Lakeview", price = 310_000, beds = 2, baths = 1, sqft = 1_100),
    Listing(id = "4", address = "12 Cedar Court, Hillcrest", price = 895_000, beds = 5, baths = 4, sqft = 3_200),
    Listing(id = "5", address = "34 Willow Way, Brookfield", price = 525_000, beds = 3, baths = 2, sqft = 1_950),
    Listing(id = "6", address = "56 Aspen Circle, Fairview", price = 410_000, beds = 3, baths = 2, sqft = 1_700),
    Listing(id = "7", address = "78 Elm Street, Greendale", price = 750_000, beds = 4, baths = 3, sqft = 2_800),
    Listing(id = "8", address = "90 Pine Ridge Road, Meadowbrook", price = 365_000, beds = 2, baths = 2, sqft = 1_300),
    Listing(id = "9", address = "21 Birchwood Drive, Sunnyvale Heights", price = 980_000, beds = 5, baths = 5, sqft = 3_600),
    Listing(id = "10", address = "43 Chestnut Place, Oakdale", price = 475_000, beds = 3, baths = 2, sqft = 1_880),
)
