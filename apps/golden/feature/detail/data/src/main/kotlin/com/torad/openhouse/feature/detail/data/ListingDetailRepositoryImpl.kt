package com.torad.openhouse.feature.detail.data

import com.torad.openhouse.core.model.Listing
import com.torad.openhouse.feature.detail.domain.ListingDetailRepository
import com.torad.openhouse.feature.listings.domain.ListingsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

/**
 * Detail has no catalog of its own — it is a view over the one the Listings
 * feature already owns, so this implementation adapts [ListingsRepository]
 * instead of wrapping a private DataSource.
 */
class ListingDetailRepositoryImpl @Inject constructor(
    private val listingsRepository: ListingsRepository,
) : ListingDetailRepository {
    override fun observeListing(listingId: String): Flow<Listing?> =
        listingsRepository.observeListings().map { listings -> listings.find { it.id == listingId } }
}
