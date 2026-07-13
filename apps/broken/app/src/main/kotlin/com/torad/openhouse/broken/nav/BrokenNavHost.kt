package com.torad.openhouse.broken.nav

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.torad.openhouse.broken.detail.DetailScreen
import com.torad.openhouse.broken.favorites.FavoritesScreen
import com.torad.openhouse.broken.listings.ListingsScreen

private const val ROUTE_LISTINGS = "listings"
private const val ROUTE_FAVORITES = "favorites"
private const val ARG_LISTING_ID = "listingId"
private const val ROUTE_DETAIL = "detail/{$ARG_LISTING_ID}"

@Composable
fun BrokenNavHost() {
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = currentRoute == ROUTE_LISTINGS,
                    onClick = { navController.navigate(ROUTE_LISTINGS) },
                    icon = { Icon(Icons.Filled.Home, contentDescription = "Listings") },
                    label = { Text("Listings") },
                )
                NavigationBarItem(
                    selected = currentRoute == ROUTE_FAVORITES,
                    onClick = { navController.navigate(ROUTE_FAVORITES) },
                    icon = { Icon(Icons.Filled.Favorite, contentDescription = "Favorites") },
                    label = { Text("Favorites") },
                )
            }
        },
    ) { paddingValues ->
        NavHost(
            navController = navController,
            startDestination = ROUTE_LISTINGS,
            modifier = Modifier.padding(paddingValues),
        ) {
            composable(ROUTE_LISTINGS) {
                ListingsScreen(onListingClick = { id -> navController.navigate("detail/$id") })
            }
            composable(
                route = ROUTE_DETAIL,
                arguments = listOf(navArgument(ARG_LISTING_ID) { type = NavType.StringType }),
            ) { backStackEntry ->
                val listingId = backStackEntry.arguments?.getString(ARG_LISTING_ID)!!
                DetailScreen(listingId = listingId, onBackClick = { navController.popBackStack() })
            }
            composable(ROUTE_FAVORITES) {
                FavoritesScreen(onListingClick = { id -> navController.navigate("detail/$id") })
            }
        }
    }
}
