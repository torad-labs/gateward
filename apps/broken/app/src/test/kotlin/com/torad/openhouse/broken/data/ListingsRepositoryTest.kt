package com.torad.openhouse.broken.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ListingsRepositoryTest {

    @Test
    fun testGetListingsReturnsData() {
        val repository = ListingsRepository()

        val result = repository.getListings()

        assertEquals(true, result.isNotEmpty())
    }

    @Test
    fun testGetListingByIdFindsIt() {
        val repository = ListingsRepository()
        val firstId = repository.getListings().first().id

        val found = repository.getListingById(firstId)

        assertEquals(false, found.address.isEmpty())
    }
}
