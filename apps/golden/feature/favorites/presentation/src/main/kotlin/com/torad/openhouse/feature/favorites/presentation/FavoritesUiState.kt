package com.torad.openhouse.feature.favorites.presentation

import com.torad.openhouse.core.model.Listing

data class FavoritesUiState(
    val favorites: List<ListingItem> = emptyList(),
    val isLoading: Boolean = true,
)

/**
 * Presentation-local pairing of a listing with its favorite flag. Kept local
 * rather than shared with `:feature:listings:presentation` so the two
 * features' presentation modules never depend on each other.
 */
data class ListingItem(
    val listing: Listing,
    val isFavorite: Boolean,
)
