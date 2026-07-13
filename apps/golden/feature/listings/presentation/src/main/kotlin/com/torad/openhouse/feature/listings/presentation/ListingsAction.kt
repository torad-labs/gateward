package com.torad.openhouse.feature.listings.presentation

sealed interface ListingsAction {
    data class FavoriteToggled(val listingId: String) : ListingsAction
}
