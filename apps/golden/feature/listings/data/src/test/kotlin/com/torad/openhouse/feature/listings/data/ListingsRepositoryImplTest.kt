package com.torad.openhouse.feature.listings.data

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class ListingsRepositoryImplTest {

    @Test
    fun `Given the data source has listings When observeListings is called Then the repository emits the same listings`() =
        runTest {
            val listings = listOf(
                Listing(id = "1", address = "123 Maple Street", price = 450_000, beds = 3, baths = 2, sqft = 1_850),
            )
            val repository = ListingsRepositoryImpl(FakeListingsDataSource(listings))

            val result = repository.observeListings().first()

            assertEquals(listings, result)
        }

    private class FakeListingsDataSource(
        private val listings: List<Listing>,
    ) : ListingsDataSource {
        override fun observeAll(): Flow<List<Listing>> = flowOf(listings)
    }
}
