package com.torad.openhouse.feature.favorites.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/** Favorites held in memory only: they reset every time the process restarts. */
class InMemoryFavoritesDataSource @Inject constructor() : FavoritesDataSource {

    private val favoriteIds = MutableStateFlow<Set<String>>(emptySet())

    override fun observeFavoriteIds(): Flow<Set<String>> = favoriteIds.asStateFlow()

    override suspend fun toggle(listingId: String) {
        favoriteIds.update { current ->
            if (listingId in current) current - listingId else current + listingId
        }
    }
}
