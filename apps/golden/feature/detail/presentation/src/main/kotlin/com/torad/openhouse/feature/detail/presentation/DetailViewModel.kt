package com.torad.openhouse.feature.detail.presentation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.torad.openhouse.feature.detail.domain.ObserveListingDetailUseCase
import com.torad.openhouse.feature.favorites.domain.ObserveFavoriteIdsUseCase
import com.torad.openhouse.feature.favorites.domain.ToggleFavoriteUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DetailViewModel @Inject constructor(
    observeListingDetail: ObserveListingDetailUseCase,
    observeFavoriteIds: ObserveFavoriteIdsUseCase,
    private val toggleFavorite: ToggleFavoriteUseCase,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val listingId: String = checkNotNull(savedStateHandle[LISTING_ID_ARG])

    val state: StateFlow<DetailUiState> = combine(
        observeListingDetail(listingId),
        observeFavoriteIds(),
    ) { listing, favoriteIds ->
        DetailUiState(
            listing = listing,
            isFavorite = listing != null && listing.id in favoriteIds,
            isLoading = false,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
        initialValue = DetailUiState(),
    )

    fun onAction(action: DetailAction) {
        when (action) {
            DetailAction.FavoriteToggled -> viewModelScope.launch { toggleFavorite(listingId) }
        }
    }

    companion object {
        const val LISTING_ID_ARG = "listingId"
        private const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
