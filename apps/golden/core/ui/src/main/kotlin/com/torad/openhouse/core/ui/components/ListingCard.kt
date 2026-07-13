package com.torad.openhouse.core.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.torad.openhouse.core.model.Listing
import com.torad.openhouse.core.ui.format.formatPrice

/**
 * The listing card shared by the Listings grid and the Favorites grid: same
 * data, same rendering, one composable so the two screens never drift apart
 * visually.
 */
@Composable
fun ListingCard(
    listing: Listing,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier.fillMaxWidth(), onClick = onClick) {
        Box {
            PlaceholderThumbnail(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
            )
            IconButton(onClick = onFavoriteClick, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(
                    imageVector = if (isFavorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                    contentDescription = "Toggle favorite",
                    tint = if (isFavorite) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        Column(modifier = Modifier.padding(12.dp)) {
            Text(text = formatPrice(listing.price), style = MaterialTheme.typography.titleMedium)
            Text(
                text = listing.address,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "${listing.beds} bd · ${listing.baths} ba · ${listing.sqft} sqft",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}
