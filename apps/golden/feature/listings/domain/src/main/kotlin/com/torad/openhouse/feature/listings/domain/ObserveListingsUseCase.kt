package com.torad.openhouse.feature.listings.domain

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class ObserveListingsUseCase @Inject constructor(
    private val repository: ListingsRepository,
) {
    operator fun invoke(): Flow<List<Listing>> = repository.observeListings()
}
