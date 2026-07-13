package com.torad.openhouse.feature.listings.domain

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow

/** The canonical source of the property catalog, shared by every screen that needs it. */
interface ListingsRepository {
    fun observeListings(): Flow<List<Listing>>
}
