package com.torad.openhouse.feature.favorites.presentation

sealed interface FavoritesAction {
    data class FavoriteToggled(val listingId: String) : FavoritesAction
}
