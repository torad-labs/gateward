package com.torad.openhouse.broken.detail

import androidx.lifecycle.ViewModel
import com.torad.openhouse.broken.BrokenApplication
import com.torad.openhouse.broken.data.ListingsRepository
import com.torad.openhouse.broken.domain.FavoritesStore
import com.torad.openhouse.broken.event.AppEventBus
import com.torad.openhouse.legacy.Listing
import kotlinx.coroutines.flow.MutableStateFlow

data class DetailUiState(
    val listing: Listing? = null,
    val isFavorite: Boolean = false,
    val isLoading: Boolean = true,
)

class DetailViewModel : ViewModel() {

    private val repository = ListingsRepository()
    private val favoritesStore = FavoritesStore(BrokenApplication.appContext)
    private var listingId: String = ""

    val state: MutableStateFlow<DetailUiState> = MutableStateFlow(DetailUiState())

    init {
        AppEventBus.subscribe { refreshFavorite() }
    }

    fun load(listingId: String) {
        this.listingId = listingId
        state.value = DetailUiState(
            listing = repository.getListingById(listingId),
            isFavorite = listingId in favoritesStore.getFavoriteIds(),
            isLoading = false,
        )
    }

    fun toggleFavorite() {
        favoritesStore.toggle(listingId)
        refreshFavorite()
        AppEventBus.publish()
    }

    private fun refreshFavorite() {
        if (listingId.isEmpty()) return
        state.value = state.value.copy(isFavorite = listingId in favoritesStore.getFavoriteIds())
    }
}
