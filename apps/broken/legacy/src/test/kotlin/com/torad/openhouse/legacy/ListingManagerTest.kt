package com.torad.openhouse.legacy

import org.junit.Assert.assertEquals
import org.junit.Test

class ListingManagerTest {

    @Test
    fun testFilterWorks() {
        val results = ListingManager.INSTANCE.filterByMinBeds(5)

        assertEquals(true, results.isNotEmpty())
        assertEquals(true, results.all { it.beds >= 5 })
    }

    @Test
    fun testGetListingById() {
        val all = ListingManager.INSTANCE.getAllListings()
        val first = all.first()

        val found = ListingManager.INSTANCE.getListingById(first.id)

        assertEquals(false, found.address.isEmpty())
    }
}
