package com.torad.openhouse.feature.favorites.domain

import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class ObserveFavoriteIdsUseCase @Inject constructor(
    private val repository: FavoritesRepository,
) {
    operator fun invoke(): Flow<Set<String>> = repository.observeFavoriteIds()
}
