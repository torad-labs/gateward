package com.torad.openhouse.broken.domain

import android.content.Context

/**
 * Reads and writes favorited listing ids straight out of SharedPreferences.
 * Nobody ever pulled this behind an interface, so every screen that cares
 * about favorites just constructs one of these directly with the app Context.
 */
class FavoritesStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getFavoriteIds(): Set<String> = prefs.getStringSet(KEY_FAVORITE_IDS, emptySet())!!

    fun toggle(listingId: String) {
        val current = getFavoriteIds().toMutableSet()
        if (listingId in current) current.remove(listingId) else current.add(listingId)
        prefs.edit().putStringSet(KEY_FAVORITE_IDS, current).apply()
    }

    private companion object {
        const val PREFS_NAME = "openhouse_favorites"
        const val KEY_FAVORITE_IDS = "favorite_ids"
    }
}
