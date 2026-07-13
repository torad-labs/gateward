package com.torad.openhouse.feature.detail.presentation

import com.torad.openhouse.core.model.Listing

data class DetailUiState(
    val listing: Listing? = null,
    val isFavorite: Boolean = false,
    val isLoading: Boolean = true,
)
