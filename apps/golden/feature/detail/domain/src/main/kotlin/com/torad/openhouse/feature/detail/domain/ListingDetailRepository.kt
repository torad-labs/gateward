package com.torad.openhouse.feature.detail.domain

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow

interface ListingDetailRepository {
    fun observeListing(listingId: String): Flow<Listing?>
}
