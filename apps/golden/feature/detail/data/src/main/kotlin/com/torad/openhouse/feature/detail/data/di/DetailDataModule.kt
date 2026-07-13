package com.torad.openhouse.feature.detail.data.di

import com.torad.openhouse.feature.detail.data.ListingDetailRepositoryImpl
import com.torad.openhouse.feature.detail.domain.ListingDetailRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class DetailDataModule {

    @Binds
    @Singleton
    abstract fun bindListingDetailRepository(impl: ListingDetailRepositoryImpl): ListingDetailRepository
}
