package com.torad.openhouse.feature.listings.data

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow

interface ListingsDataSource {
    fun observeAll(): Flow<List<Listing>>
}
