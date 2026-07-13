package com.torad.openhouse.broken.data

import com.torad.openhouse.legacy.Listing
import com.torad.openhouse.legacy.ListingManager

/**
 * No interface: every caller `new`s this concrete class directly, and it
 * reaches the shared [ListingManager] singleton statically instead of taking
 * a data source through its constructor.
 */
class ListingsRepository {
    fun getListings(): List<Listing> = ListingManager.INSTANCE.getAllListings()
    fun getListingById(id: String): Listing = ListingManager.INSTANCE.getListingById(id)
}
