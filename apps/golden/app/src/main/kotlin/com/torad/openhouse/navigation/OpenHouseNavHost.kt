package com.torad.openhouse.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.torad.openhouse.feature.detail.presentation.DetailRoute
import com.torad.openhouse.feature.detail.presentation.DetailViewModel
import com.torad.openhouse.feature.favorites.presentation.FavoritesRoute
import com.torad.openhouse.feature.listings.presentation.ListingsRoute

private const val ROUTE_LISTINGS = "listings"
private const val ROUTE_FAVORITES = "favorites"
private const val ROUTE_DETAIL = "detail/{${DetailViewModel.LISTING_ID_ARG}}"

private data class TopLevelDestination(val route: String, val label: String, val icon: ImageVector)

private val topLevelDestinations = listOf(
    TopLevelDestination(ROUTE_LISTINGS, "Listings", Icons.Filled.Home),
    TopLevelDestination(ROUTE_FAVORITES, "Favorites", Icons.Filled.Favorite),
)

@Composable
fun OpenHouseNavHost(navController: NavHostController = rememberNavController()) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.hierarchy?.firstOrNull { destination ->
        topLevelDestinations.any { it.route == destination.route }
    }?.route

    Scaffold(
        bottomBar = {
            if (currentRoute != null) {
                NavigationBar {
                    topLevelDestinations.forEach { destination ->
                        NavigationBarItem(
                            selected = currentRoute == destination.route,
                            onClick = {
                                navController.navigate(destination.route) {
                                    popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(destination.icon, contentDescription = destination.label) },
                            label = { Text(destination.label) },
                        )
                    }
                }
            }
        },
    ) { paddingValues ->
        NavHost(
            navController = navController,
            startDestination = ROUTE_LISTINGS,
            modifier = Modifier.padding(paddingValues),
        ) {
            composable(ROUTE_LISTINGS) {
                ListingsRoute(onListingClick = { listingId -> navController.navigate("detail/$listingId") })
            }
            composable(
                route = ROUTE_DETAIL,
                arguments = listOf(navArgument(DetailViewModel.LISTING_ID_ARG) { type = NavType.StringType }),
            ) {
                DetailRoute(onBackClick = navController::popBackStack)
            }
            composable(ROUTE_FAVORITES) {
                FavoritesRoute(onListingClick = { listingId -> navController.navigate("detail/$listingId") })
            }
        }
    }
}
