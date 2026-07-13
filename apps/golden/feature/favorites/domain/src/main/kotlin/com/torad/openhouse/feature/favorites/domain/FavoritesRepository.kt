package com.torad.openhouse.feature.favorites.domain

import kotlinx.coroutines.flow.Flow

/** Owns the one piece of mutable state in the app: which listing ids are favorited. */
interface FavoritesRepository {
    fun observeFavoriteIds(): Flow<Set<String>>
    suspend fun toggleFavorite(listingId: String)
}
