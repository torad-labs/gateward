package com.torad.openhouse.feature.favorites.data

import kotlinx.coroutines.flow.Flow

interface FavoritesDataSource {
    fun observeFavoriteIds(): Flow<Set<String>>
    suspend fun toggle(listingId: String)
}
