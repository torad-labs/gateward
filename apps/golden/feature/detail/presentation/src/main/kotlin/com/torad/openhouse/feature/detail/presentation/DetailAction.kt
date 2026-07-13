package com.torad.openhouse.feature.detail.presentation

sealed interface DetailAction {
    data object FavoriteToggled : DetailAction
}
