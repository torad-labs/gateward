@file:OptIn(ExperimentalMaterial3Api::class)

package com.torad.openhouse.feature.detail.presentation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.torad.openhouse.core.model.Listing
import com.torad.openhouse.core.ui.components.PlaceholderThumbnail
import com.torad.openhouse.core.ui.format.formatPrice

@Composable
fun DetailRoute(
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    DetailScreen(
        state = state,
        onAction = viewModel::onAction,
        onBackClick = onBackClick,
        modifier = modifier,
    )
}

@Composable
fun DetailScreen(
    state: DetailUiState,
    onAction: (DetailAction) -> Unit,
    onBackClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(state.listing?.address.orEmpty()) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (state.listing != null) {
                        IconButton(onClick = { onAction(DetailAction.FavoriteToggled) }) {
                            Icon(
                                imageVector = if (state.isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                                contentDescription = "Toggle favorite",
                            )
                        }
                    }
                },
            )
        },
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize(),
        ) {
            val listing = state.listing
            when {
                state.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                listing == null -> Text(
                    text = "Listing not found",
                    modifier = Modifier.align(Alignment.Center),
                )
                else -> DetailContent(listing = listing)
            }
        }
    }
}

@Composable
private fun DetailContent(listing: Listing, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        PlaceholderThumbnail(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text(text = formatPrice(listing.price), style = MaterialTheme.typography.headlineMedium)
        Text(text = listing.address, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(8.dp))
        Text(
            text = "${listing.beds} bd · ${listing.baths} ba · ${listing.sqft} sqft",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
