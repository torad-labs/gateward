package com.torad.openhouse.feature.listings.data.di

import com.torad.openhouse.feature.listings.data.InMemoryListingsDataSource
import com.torad.openhouse.feature.listings.data.ListingsDataSource
import com.torad.openhouse.feature.listings.data.ListingsRepositoryImpl
import com.torad.openhouse.feature.listings.domain.ListingsRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class ListingsDataModule {

    @Binds
    @Singleton
    abstract fun bindListingsDataSource(impl: InMemoryListingsDataSource): ListingsDataSource

    @Binds
    @Singleton
    abstract fun bindListingsRepository(impl: ListingsRepositoryImpl): ListingsRepository
}
