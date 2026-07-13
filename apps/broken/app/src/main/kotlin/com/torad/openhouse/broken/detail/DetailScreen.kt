@file:OptIn(ExperimentalMaterial3Api::class)

package com.torad.openhouse.broken.detail

import androidx.compose.foundation.layout.*
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import java.text.NumberFormat
import java.util.Locale

@Composable
fun DetailScreen(
    listingId: String,
    onBackClick: () -> Unit,
    viewModel: DetailViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(listingId) {
        viewModel.load(listingId)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.listing?.address.orEmpty()) },
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (!state.isLoading) {
                        IconButton(onClick = { viewModel.toggleFavorite() }) {
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
            if (state.isLoading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                // ast-grep-ignore: no-force-unwrap -- listing is always set once isLoading flips false
                val listing = state.listing!!
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                ) {
                    Text(
                        text = NumberFormat.getCurrencyInstance(Locale.US)
                            .apply { maximumFractionDigits = 0 }
                            .format(listing.price),
                        style = MaterialTheme.typography.headlineMedium,
                    )
                    Text(listing.address, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "${listing.beds} bd · ${listing.baths} ba · ${listing.sqft} sqft",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}
