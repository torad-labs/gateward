@file:OptIn(ExperimentalMaterial3Api::class)

package com.torad.openhouse.broken.listings

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
import androidx.compose.material.icons.filled.FavoriteBorder
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
fun ListingsScreen(
    onListingClick: (String) -> Unit,
    viewModel: ListingsViewModel = viewModel(),
) {
    val listings by viewModel.listings.collectAsState()
    val favoriteIds by viewModel.favoriteIds.collectAsState()
    val searchQuery by viewModel.searchQuery.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    // Business logic that belongs in a UseCase or the ViewModel, done here
    // instead: search filtering and price sorting, right inline in the screen.
    val visibleListings = listings
        .filter { it.address.contains(searchQuery, ignoreCase = true) }
        .sortedBy { it.price }

    Scaffold(
        topBar = { TopAppBar(title = { Text("OpenHouse") }) },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .padding(paddingValues)
                .fillMaxSize(),
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { viewModel.setSearchQuery(it) },
                label = { Text("Search address") },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            )
            when {
                isLoading -> Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.align(Alignment.Center))
                }
                visibleListings.isEmpty() -> Box(Modifier.fillMaxSize()) {
                    Text("No listings yet", modifier = Modifier.align(Alignment.Center))
                }
                else -> LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp)) {
                    items(visibleListings, key = { it.id }) { listing ->
                        // Price formatting, also inline instead of a shared utility.
                        val formattedPrice = NumberFormat.getCurrencyInstance(Locale.US)
                            .apply { maximumFractionDigits = 0 }
                            .format(listing.price)

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
                                    Text(formattedPrice, style = MaterialTheme.typography.titleMedium)
                                    Text(listing.address, style = MaterialTheme.typography.bodyMedium)
                                    Text(
                                        "${listing.beds} bd · ${listing.baths} ba · ${listing.sqft} sqft",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                }
                                IconButton(onClick = { viewModel.toggleFavorite(listing.id) }) {
                                    Icon(
                                        imageVector = if (listing.id in favoriteIds) {
                                            Icons.Filled.Favorite
                                        } else {
                                            Icons.Filled.FavoriteBorder
                                        },
                                        contentDescription = "Toggle favorite",
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
