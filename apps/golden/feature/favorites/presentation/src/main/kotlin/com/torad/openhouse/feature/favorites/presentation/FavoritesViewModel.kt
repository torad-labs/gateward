package com.torad.openhouse.feature.favorites.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.torad.openhouse.feature.favorites.domain.ObserveFavoriteIdsUseCase
import com.torad.openhouse.feature.favorites.domain.ToggleFavoriteUseCase
import com.torad.openhouse.feature.listings.domain.ObserveListingsUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class FavoritesViewModel @Inject constructor(
    observeListings: ObserveListingsUseCase,
    observeFavoriteIds: ObserveFavoriteIdsUseCase,
    private val toggleFavorite: ToggleFavoriteUseCase,
) : ViewModel() {

    val state: StateFlow<FavoritesUiState> = combine(
        observeListings(),
        observeFavoriteIds(),
    ) { listings, favoriteIds ->
        FavoritesUiState(
            favorites = listings
                .filter { it.id in favoriteIds }
                .map { listing -> ListingItem(listing, isFavorite = true) },
            isLoading = false,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = FavoritesUiState(),
    )

    fun onAction(action: FavoritesAction) {
        when (action) {
            is FavoritesAction.FavoriteToggled -> viewModelScope.launch { toggleFavorite(action.listingId) }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
