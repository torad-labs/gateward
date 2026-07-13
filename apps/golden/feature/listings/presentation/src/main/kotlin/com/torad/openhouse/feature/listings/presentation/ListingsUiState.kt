package com.torad.openhouse.feature.listings.presentation

import com.torad.openhouse.core.model.Listing

data class ListingsUiState(
    val listings: List<ListingItem> = emptyList(),
    val isLoading: Boolean = true,
)

data class ListingItem(
    val listing: Listing,
    val isFavorite: Boolean,
)
