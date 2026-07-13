package com.torad.openhouse.feature.listings.domain

import com.torad.openhouse.core.model.Listing
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class ObserveListingsUseCaseTest {

    @Test
    fun `Given the repository has listings When the use case is invoked Then it emits them unchanged`() = runTest {
        val listings = listOf(
            Listing(id = "1", address = "123 Maple Street", price = 450_000, beds = 3, baths = 2, sqft = 1_850),
            Listing(id = "2", address = "456 Oak Avenue", price = 625_000, beds = 4, baths = 3, sqft = 2_400),
        )
        val useCase = ObserveListingsUseCase(FakeListingsRepository(listings))

        val result = useCase().first()

        assertEquals(listings, result)
    }

    private class FakeListingsRepository(
        private val listings: List<Listing>,
    ) : ListingsRepository {
        override fun observeListings(): Flow<List<Listing>> = flowOf(listings)
    }
}
