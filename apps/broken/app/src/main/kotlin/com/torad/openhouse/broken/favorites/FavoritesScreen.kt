@file:OptIn(ExperimentalMaterial3Api::class)

package com.torad.openhouse.broken.favorites

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import java.text.NumberFormat
import java.util.Locale

@Composable
fun FavoritesScreen(
    onListingClick: (String) -> Unit,
    viewModel: FavoritesViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Favorites") }) },
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize(),
        ) {
            when {
                state.isLoading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                state.favorites.isEmpty() -> Text("No favorites yet", modifier = Modifier.align(Alignment.Center))
                else -> LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    items(state.favorites, key = { it.id }) { listing ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                            onClick = { onListingClick(listing.id) },
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = NumberFormat.getCurrencyInstance(Locale.US)
                                            .apply { maximumFractionDigits = 0 }
                                            .format(listing.price),
                                        style = MaterialTheme.typography.titleMedium,
                                    )
                                    Text(listing.address, style = MaterialTheme.typography.bodyMedium)
                                }
                                IconButton(onClick = { viewModel.toggleFavorite(listing.id) }) {
                                    Icon(Icons.Filled.Favorite, contentDescription = "Remove favorite")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
