package com.torad.openhouse.feature.listings.presentation

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
class ListingsViewModel @Inject constructor(
    observeListings: ObserveListingsUseCase,
    observeFavoriteIds: ObserveFavoriteIdsUseCase,
    private val toggleFavorite: ToggleFavoriteUseCase,
) : ViewModel() {

    val state: StateFlow<ListingsUiState> = combine(
        observeListings(),
        observeFavoriteIds(),
    ) { listings, favoriteIds ->
        ListingsUiState(
            listings = listings.map { listing -> ListingItem(listing, listing.id in favoriteIds) },
            isLoading = false,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = ListingsUiState(),
    )

    fun onAction(action: ListingsAction) {
        when (action) {
            is ListingsAction.FavoriteToggled -> viewModelScope.launch {
                toggleFavorite(action.listingId)
            }
        }
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
