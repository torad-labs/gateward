package com.torad.openhouse.feature.detail.domain

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class ObserveListingDetailUseCase @Inject constructor(
    private val repository: ListingDetailRepository,
) {
    operator fun invoke(listingId: String): Flow<Listing?> = repository.observeListing(listingId)
}
