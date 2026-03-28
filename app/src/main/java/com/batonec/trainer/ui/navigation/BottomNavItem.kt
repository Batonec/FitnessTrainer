package com.batonec.trainer.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Star
import androidx.compose.ui.graphics.vector.ImageVector

sealed class BottomNavItem(
    val route: String,
    val title: String,
    val icon: ImageVector
) {
    object Trainings : BottomNavItem(
        route = "trainings",
        title = "Trainings",
        icon = Icons.Default.List
    )

    object Next : BottomNavItem(
        route = "next",
        title = "Progress",
        icon = Icons.Default.DateRange
    )

    object New : BottomNavItem(
        route = "new",
        title = "New",
        icon = Icons.Default.Star
    )
}
