package com.torad.openhouse.feature.favorites.domain

import javax.inject.Inject

class ToggleFavoriteUseCase @Inject constructor(
    private val repository: FavoritesRepository,
) {
    suspend operator fun invoke(listingId: String) = repository.toggleFavorite(listingId)
}
