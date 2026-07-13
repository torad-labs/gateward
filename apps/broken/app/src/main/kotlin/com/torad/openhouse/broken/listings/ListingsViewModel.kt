package com.torad.openhouse.broken.listings

import androidx.lifecycle.ViewModel
import com.torad.openhouse.broken.BrokenApplication
import com.torad.openhouse.broken.data.ListingsRepository
import com.torad.openhouse.broken.domain.FavoritesStore
import com.torad.openhouse.broken.event.AppEventBus
import com.torad.openhouse.legacy.Listing
import kotlinx.coroutines.flow.*

/**
 * Backs the Listings screen. Note what is missing: no sealed action type, no
 * UseCase layer, and the repository is a concrete class this class instantiates
 * itself. State is four independent flows a caller could just as easily write
 * to directly as read from.
 */
class ListingsViewModel : ViewModel() {

    private val repository = ListingsRepository()
    private val favoritesStore = FavoritesStore(BrokenApplication.appContext)

    val listings: MutableStateFlow<List<Listing>> = MutableStateFlow(emptyList())
    val favoriteIds: MutableStateFlow<Set<String>> = MutableStateFlow(emptySet())
    val searchQuery: MutableStateFlow<String> = MutableStateFlow("")
    val isLoading: MutableStateFlow<Boolean> = MutableStateFlow(true)

    init {
        loadListings()
        AppEventBus.subscribe { refreshFavorites() }
    }

    fun loadListings() {
        listings.value = repository.getListings()
        favoriteIds.value = favoritesStore.getFavoriteIds()
        isLoading.value = false
    }

    fun setSearchQuery(query: String) {
        searchQuery.value = query
    }

    fun toggleFavorite(listingId: String) {
        favoritesStore.toggle(listingId)
        refreshFavorites()
        AppEventBus.publish()
    }

    private fun refreshFavorites() {
        favoriteIds.value = favoritesStore.getFavoriteIds()
    }
}
