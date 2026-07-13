package com.torad.openhouse.feature.listings.presentation

import app.cash.turbine.test
import com.torad.openhouse.core.model.Listing
import com.torad.openhouse.feature.favorites.domain.FavoritesRepository
import com.torad.openhouse.feature.favorites.domain.ObserveFavoriteIdsUseCase
import com.torad.openhouse.feature.favorites.domain.ToggleFavoriteUseCase
import com.torad.openhouse.feature.listings.domain.ListingsRepository
import com.torad.openhouse.feature.listings.domain.ObserveListingsUseCase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ListingsViewModelTest {

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `Given a listing is not favorited When FavoriteToggled is sent Then it appears favorited in state`() = runTest {
        val listing = Listing(id = "listing-1", address = "1 Test Way", price = 500_000, beds = 3, baths = 2, sqft = 1_500)
        val favoritesRepository = FakeFavoritesRepository()
        val viewModel = ListingsViewModel(
            observeListings = ObserveListingsUseCase(FakeListingsRepository(listOf(listing))),
            observeFavoriteIds = ObserveFavoriteIdsUseCase(favoritesRepository),
            toggleFavorite = ToggleFavoriteUseCase(favoritesRepository),
        )

        viewModel.state.test {
            val initial = awaitItem()
            val loaded = if (initial.isLoading) awaitItem() else initial
            assertFalse(loaded.listings.single().isFavorite)

            viewModel.onAction(ListingsAction.FavoriteToggled(listing.id))

            val updated = awaitItem()
            assertTrue(updated.listings.single().isFavorite)
            cancelAndIgnoreRemainingEvents()
        }
    }

    private class FakeListingsRepository(
        private val listings: List<Listing>,
    ) : ListingsRepository {
        override fun observeListings(): Flow<List<Listing>> = flowOf(listings)
    }

    private class FakeFavoritesRepository : FavoritesRepository {
        private val favoriteIds = MutableStateFlow<Set<String>>(emptySet())
        override fun observeFavoriteIds(): Flow<Set<String>> = favoriteIds.asStateFlow()
        override suspend fun toggleFavorite(listingId: String) {
            favoriteIds.update { current ->
                if (listingId in current) current - listingId else current + listingId
            }
        }
    }
}
