package com.torad.openhouse.feature.listings.data

import com.torad.openhouse.core.model.Listing
import com.torad.openhouse.feature.listings.domain.ListingsRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class ListingsRepositoryImpl @Inject constructor(
    private val dataSource: ListingsDataSource,
) : ListingsRepository {
    override fun observeListings(): Flow<List<Listing>> = dataSource.observeAll()
}
