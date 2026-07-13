package com.torad.openhouse.feature.favorites.data.di

import com.torad.openhouse.feature.favorites.data.FavoritesDataSource
import com.torad.openhouse.feature.favorites.data.FavoritesRepositoryImpl
import com.torad.openhouse.feature.favorites.data.InMemoryFavoritesDataSource
import com.torad.openhouse.feature.favorites.domain.FavoritesRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class FavoritesDataModule {

    @Binds
    @Singleton
    abstract fun bindFavoritesDataSource(impl: InMemoryFavoritesDataSource): FavoritesDataSource

    @Binds
    @Singleton
    abstract fun bindFavoritesRepository(impl: FavoritesRepositoryImpl): FavoritesRepository
}
