package com.torad.openhouse.broken.favorites

import androidx.lifecycle.ViewModel
import com.torad.openhouse.broken.BrokenApplication
import com.torad.openhouse.broken.data.ListingsRepository
import com.torad.openhouse.broken.domain.FavoritesStore
import com.torad.openhouse.broken.event.AppEventBus
import com.torad.openhouse.legacy.Listing
import kotlinx.coroutines.flow.MutableStateFlow

data class FavoritesUiState(
    val favorites: List<Listing> = emptyList(),
    val isLoading: Boolean = true,
)

class FavoritesViewModel : ViewModel() {

    private val repository = ListingsRepository()
    private val favoritesStore = FavoritesStore(BrokenApplication.appContext)

    val state: MutableStateFlow<FavoritesUiState> = MutableStateFlow(FavoritesUiState())

    init {
        loadFavorites()
        AppEventBus.subscribe { loadFavorites() }
    }

    fun loadFavorites() {
        val favoriteIds = favoritesStore.getFavoriteIds()
        state.value = FavoritesUiState(
            favorites = repository.getListings().filter { it.id in favoriteIds },
            isLoading = false,
        )
    }

    fun toggleFavorite(listingId: String) {
        favoritesStore.toggle(listingId)
        loadFavorites()
        AppEventBus.publish()
    }
}
