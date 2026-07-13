package com.torad.openhouse.feature.favorites.data

import com.torad.openhouse.feature.favorites.domain.FavoritesRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class FavoritesRepositoryImpl @Inject constructor(
    private val dataSource: FavoritesDataSource,
) : FavoritesRepository {
    override fun observeFavoriteIds(): Flow<Set<String>> = dataSource.observeFavoriteIds()
    override suspend fun toggleFavorite(listingId: String) = dataSource.toggle(listingId)
}
