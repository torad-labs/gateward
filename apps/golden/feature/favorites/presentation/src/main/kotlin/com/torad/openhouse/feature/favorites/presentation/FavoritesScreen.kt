@file:OptIn(ExperimentalMaterial3Api::class)

package com.torad.openhouse.feature.favorites.presentation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.torad.openhouse.core.ui.components.ListingCard

@Composable
fun FavoritesRoute(
    onListingClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: FavoritesViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    FavoritesScreen(
        state = state,
        onAction = viewModel::onAction,
        onListingClick = onListingClick,
        modifier = modifier,
    )
}

@Composable
fun FavoritesScreen(
    state: FavoritesUiState,
    onAction: (FavoritesAction) -> Unit,
    onListingClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = { TopAppBar(title = { Text("Favorites") }) },
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize(),
        ) {
            when {
                state.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.favorites.isEmpty() -> Text(
                    text = "No favorites yet",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 160.dp),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.favorites, key = { it.listing.id }) { item ->
                        ListingCard(
                            listing = item.listing,
                            isFavorite = item.isFavorite,
                            onClick = { onListingClick(item.listing.id) },
                            onFavoriteClick = { onAction(FavoritesAction.FavoriteToggled(item.listing.id)) },
                        )
                    }
                }
            }
        }
    }
}
