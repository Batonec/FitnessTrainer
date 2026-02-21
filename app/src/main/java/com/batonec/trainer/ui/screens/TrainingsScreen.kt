package com.batonec.trainer.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material3.*
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.animation.core.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.batonec.trainer.domain.workout.GroupedExerciseSet
import com.batonec.trainer.domain.workout.groupConsecutiveExerciseSets
import androidx.hilt.navigation.compose.hiltViewModel
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterialApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TrainingsScreen(
    modifier: Modifier = Modifier,
    viewModel: TrainingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    
    // Pull-to-refresh состояние
    val pullRefreshState = rememberPullRefreshState(
        refreshing = uiState.isLoading && uiState.workouts.isNotEmpty(),
        onRefresh = { viewModel.loadWorkouts() }
    )

    // Загрузка следующей страницы при прокрутке вниз
    LaunchedEffect(listState, uiState.workouts.size, uiState.hasMore, uiState.isLoadingMore) {
        snapshotFlow { 
            listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: -1 
        }.collect { lastVisibleIndex ->
            if (lastVisibleIndex >= uiState.workouts.size - 3 
                && uiState.hasMore 
                && !uiState.isLoadingMore
                && uiState.workouts.isNotEmpty()
            ) {
                viewModel.loadMoreWorkouts()
            }
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Trainings") }
            )
        }
    ) { paddingValues ->
        Box(modifier = Modifier
            .fillMaxSize()
            .padding(paddingValues)) {
            when {
                uiState.isLoading && uiState.workouts.isEmpty() -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp)
                    ) {
                        items(3) {
                            ShimmerWorkoutCard()
                        }
                    }
                }
                uiState.error != null && uiState.workouts.isEmpty() -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(
                            text = "Ошибка: ${uiState.error}",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(onClick = { viewModel.loadWorkouts() }) {
                            Text("Повторить")
                        }
                    }
                }
                else -> {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color(0xFFF6F7FA))
                            .pullRefresh(pullRefreshState)
                    ) {
                        LazyColumn(
                            state = listState,
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(18.dp)
                        ) {
                            items(uiState.workouts) { workout ->
                                WorkoutCard(workout = workout)
                            }

                            if (uiState.isLoadingMore) {
                                item {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(16.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        CircularProgressIndicator()
                                    }
                                }
                            }
                        }
                        
                        PullRefreshIndicator(
                            refreshing = uiState.isLoading && uiState.workouts.isNotEmpty(),
                            state = pullRefreshState,
                            modifier = Modifier.align(Alignment.TopCenter)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun WorkoutCard(workout: com.batonec.trainer.data.model.Workout) {
    Column(
        modifier = Modifier.fillMaxWidth()
    ) {
        // Заголовок с датой и типом нагрузки
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = formatDate(workout.workoutDate),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFF111111),
                    modifier = Modifier.padding(bottom = 4.dp)
                )
                Text(
                    text = formatDateDay(workout.workoutDate),
                    fontSize = 16.sp,
                    color = Color(0xFF666666)
                )
            }
            workout.data.loadType?.let { loadType ->
                LoadBadge(loadType = loadType)
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        // Упражнения
        workout.data.exercises.forEach { exercise ->
            ExerciseCard(exercise = exercise)
            Spacer(modifier = Modifier.height(18.dp))
        }
    }
}

@Composable
fun LoadBadge(loadType: String) {
    val (bgColor, textColor) = when (loadType.uppercase()) {
        "LIGHT" -> Color(0xFFFFF7D1) to Color(0xFF9A7B00)
        "MEDIUM" -> Color(0xFFDCE7FF) to Color(0xFF4562D0)
        "HEAVY" -> Color(0xFFFFE0E0) to Color(0xFFB04A4A)
        else -> Color(0xFFDCE7FF) to Color(0xFF4562D0)
    }
    
    Surface(
        color = bgColor,
        shape = RoundedCornerShape(20.dp)
    ) {
        Text(
            text = loadType.uppercase(),
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = textColor
        )
    }
}

@Composable
fun ExerciseCard(exercise: com.batonec.trainer.data.model.Exercise) {
    val shape = RoundedCornerShape(18.dp)
    
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .clickable(onClick = { /* Можно добавить действие при клике */ })
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = shape,
            shadowElevation = 3.dp,
            color = Color.White
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
            // Название упражнения
            Text(
                text = exercise.name,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF111111),
                modifier = Modifier.padding(bottom = 4.dp)
            )
            
            // Подходы
            val groupedSets = groupConsecutiveExerciseSets(exercise.sets)
            groupedSets.forEach { group ->
                SetGroupRow(group = group)
            }
            }
        }
    }
}

@Composable
fun SetGroupRow(group: GroupedExerciseSet) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Вес и повторения
        Text(
            text = if (group.count > 1) {
                "${group.weight.toInt()} кг × ${group.reps} × ${group.count}"
            } else {
                "${group.weight.toInt()} кг × ${group.reps}"
            },
            fontSize = 16.sp,
            fontWeight = FontWeight.Normal,
            color = Color(0xFF111111)
        )
        
        // Заметки к подходу
        group.notes?.let { notes ->
            Text(
                text = notes,
                fontSize = 14.sp,
                color = Color(0xFFC46A5A),
                modifier = Modifier.padding(start = 16.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun ShimmerWorkoutCard() {
    Column(
        modifier = Modifier.fillMaxWidth()
    ) {
        // Shimmer заголовок
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                ShimmerBox(
                    modifier = Modifier
                        .width(180.dp)
                        .height(28.dp)
                        .clip(RoundedCornerShape(4.dp))
                )
                Spacer(modifier = Modifier.height(8.dp))
                ShimmerBox(
                    modifier = Modifier
                        .width(120.dp)
                        .height(20.dp)
                        .clip(RoundedCornerShape(4.dp))
                )
            }
            ShimmerBox(
                modifier = Modifier
                    .width(70.dp)
                    .height(28.dp)
                    .clip(RoundedCornerShape(20.dp))
            )
        }
        
        Spacer(modifier = Modifier.height(20.dp))
        
        // Shimmer карточки упражнений
        repeat(3) {
            ShimmerExerciseCard()
            Spacer(modifier = Modifier.height(18.dp))
        }
    }
}

@Composable
fun ShimmerExerciseCard() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        shadowElevation = 3.dp,
        color = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Shimmer название упражнения
            ShimmerBox(
                modifier = Modifier
                    .width(200.dp)
                    .height(22.dp)
                    .clip(RoundedCornerShape(4.dp))
            )
            
            Spacer(modifier = Modifier.height(4.dp))
            
            // Shimmer подходы
            repeat(3) {
                ShimmerBox(
                    modifier = Modifier
                        .width(150.dp)
                        .height(20.dp)
                        .clip(RoundedCornerShape(4.dp))
                )
            }
        }
    }
}

@Composable
fun ShimmerBox(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "shimmer")
    val shimmerTranslateAnim = infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1000f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = 1500,
                easing = LinearEasing
            ),
            repeatMode = RepeatMode.Restart
        ),
        label = "shimmer_translate"
    )
    
    val shimmerColors = listOf(
        Color(0xFFE8E8E8),
        Color(0xFFF5F5F5),
        Color(0xFFE8E8E8)
    )
    
    val brush = Brush.linearGradient(
        colors = shimmerColors,
        start = Offset(shimmerTranslateAnim.value - 400f, shimmerTranslateAnim.value - 400f),
        end = Offset(shimmerTranslateAnim.value, shimmerTranslateAnim.value)
    )
    
    Box(
        modifier = modifier.background(brush)
    )
}

private fun formatDate(dateString: String): String {
    return try {
        val inputFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val outputFormat = SimpleDateFormat("dd MMMM yyyy", Locale("ru", "RU"))
        val date = inputFormat.parse(dateString)
        date?.let { outputFormat.format(it) } ?: dateString
    } catch (e: Exception) {
        dateString
    }
}

private fun formatDateDay(dateString: String): String {
    return try {
        val inputFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val outputFormat = SimpleDateFormat("EEEE", Locale("ru", "RU"))
        val date = inputFormat.parse(dateString)
        date?.let { outputFormat.format(it).replaceFirstChar { it.uppercase() } } ?: ""
    } catch (e: Exception) {
        ""
    }
}
