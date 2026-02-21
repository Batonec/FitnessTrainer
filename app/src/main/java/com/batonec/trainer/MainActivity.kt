package com.batonec.trainer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.batonec.trainer.ui.navigation.BottomNavItem
import com.batonec.trainer.ui.screens.NextScreen
import com.batonec.trainer.ui.screens.NewWorkoutScreen
import com.batonec.trainer.ui.screens.TrainingsScreen
import com.batonec.trainer.ui.theme.TrainerTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TrainerTheme {
                MainScreen()
            }
        }
    }
}

@Composable
fun MainScreen() {
    val navItems = listOf(
        BottomNavItem.Trainings,
        BottomNavItem.Next,
        BottomNavItem.New
    )
    
    var selectedIndex by remember { mutableIntStateOf(2) }
    
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        bottomBar = {
            NavigationBar {
                navItems.forEachIndexed { index, item ->
                    NavigationBarItem(
                        icon = { Icon(imageVector = item.icon, contentDescription = item.title) },
                        label = { Text(text = item.title) },
                        selected = selectedIndex == index,
                        onClick = { selectedIndex = index }
                    )
                }
            }
        }
    ) { innerPadding ->
        when (selectedIndex) {
            0 -> TrainingsScreen(modifier = Modifier.padding(innerPadding))
            1 -> NextScreen(modifier = Modifier.padding(innerPadding))
            2 -> NewWorkoutScreen(modifier = Modifier.padding(innerPadding))
        }
    }
}

@Composable
fun Greeting(name: String, modifier: Modifier = Modifier) {
    Text(
        text = "Hello $name!",
        modifier = modifier
    )
}

@Preview(showBackground = true)
@Composable
fun GreetingPreview() {
    TrainerTheme {
        Greeting("Android")
    }
}
