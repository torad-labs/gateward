package com.torad.openhouse.broken.event

/**
 * Hand-rolled pub/sub so screens can hear about favorites changing somewhere
 * else in the app. There is no shared reactive repository to observe instead
 * -- each screen keeps its own copy of favorite state and this bus is how
 * they nudge each other to re-read it.
 */
object AppEventBus {

    private val listeners = mutableListOf<() -> Unit>()

    fun subscribe(listener: () -> Unit) {
        listeners.add(listener)
    }

    fun publish() {
        listeners.forEach { it() }
    }
}
