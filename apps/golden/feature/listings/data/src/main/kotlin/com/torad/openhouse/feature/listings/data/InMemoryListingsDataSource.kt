package com.torad.openhouse.feature.listings.data

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * The demo's fake backend: a fixed, in-memory catalog. No network, no disk —
 * seeded once per process so every screen sees the same properties.
 */
class InMemoryListingsDataSource @Inject constructor() : ListingsDataSource {

    private val listings = MutableStateFlow(seedListings())

    override fun observeAll(): Flow<List<Listing>> = listings.asStateFlow()
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
