package com.torad.openhouse.broken

import android.app.Application

/**
 * Holds the process-wide [Application] so any class that needs a [android.content.Context]
 * (favorites persistence, mostly) can just reach in and grab one instead of having it
 * passed down through a constructor.
 */
class BrokenApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        appContext = this
    }

    companion object {
        lateinit var appContext: Application
            private set
    }
}
