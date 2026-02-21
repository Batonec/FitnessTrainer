package com.batonec.trainer.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewWorkoutScreen(
    modifier: Modifier = Modifier,
    viewModel: NewWorkoutViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    // Автоматически открываем выбор упражнения при первом входе или после завершения тренировки
    LaunchedEffect(uiState.workoutExercises.isEmpty(), uiState.exercises.isNotEmpty(), uiState.isLoadingExercises) {
        if (uiState.workoutExercises.isEmpty() && 
            !uiState.isAddingExercise && 
            uiState.selectedExercise == null &&
            !uiState.isLoadingExercises &&
            uiState.exercises.isNotEmpty()) {
            viewModel.startAddingExercise()
        }
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { 
                    Text("Новая тренировка")
                },
                actions = {
                    if (uiState.workoutExercises.isNotEmpty()) {
                        TextButton(onClick = { viewModel.finishWorkout() }) {
                            Text("Закончить тренировку")
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFFF6F7FA))
                .padding(paddingValues)
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Отображение добавленных упражнений
                items(uiState.workoutExercises) { exercise ->
                    ExerciseCard(exercise = exercise)
                }

                // Отображение текущего выбранного упражнения (если оно еще не в списке)
                if (uiState.selectedExercise != null) {
                    val currentExercise = uiState.workoutExercises.find { 
                        it.exerciseId == uiState.selectedExercise!!.id 
                    }
                    if (currentExercise == null) {
                        // Упражнение только что выбрано, показываем пустую карточку
                        item {
                            CurrentExerciseCard(exerciseName = uiState.selectedExercise!!.name)
                        }
                    }
                }

                // Кнопка добавления упражнения (показываем только если нет выбранного упражнения, есть уже добавленные упражнения и не все упражнения добавлены)
                item {
                    val addedExerciseIds = uiState.workoutExercises.map { it.exerciseId }.toSet()
                    val availableExercises = uiState.exercises.filter { 
                        it.id !in addedExerciseIds 
                    }
                    val allExercisesAdded = availableExercises.isEmpty() && uiState.exercises.isNotEmpty()
                    
                    // Показываем кнопку только если нет выбранного упражнения
                    if (uiState.selectedExercise == null &&
                        uiState.workoutExercises.isNotEmpty() && 
                        !uiState.isAddingExercise && 
                        !allExercisesAdded) {
                        Button(
                            onClick = { viewModel.startAddingExercise() },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp)
                        ) {
                            Text("Добавить упражнение")
                        }
                    }
                }

                // Выпадающий список упражнений
                if (uiState.isAddingExercise) {
                    item {
                        val addedExerciseIds = uiState.workoutExercises.map { it.exerciseId }.toSet()
                        val availableExercises = uiState.exercises.filter { 
                            it.id !in addedExerciseIds 
                        }
                        ExerciseDropdown(
                            exercises = availableExercises,
                            onExerciseSelected = { viewModel.selectExercise(it) },
                            onDismiss = { 
                                // Сохраняем текущее выбранное упражнение перед отменой
                                viewModel.cancelAddingExercise() 
                            },
                            showCancelButton = uiState.workoutExercises.isNotEmpty() || uiState.selectedExercise != null
                        )
                    }
                }

                // Кнопки "Добавить сет" и "Стандарт"
                uiState.selectedExercise?.let { selectedExercise ->
                    if (!uiState.isAddingSet && !uiState.isAddingExercise) {
                        item {
                            val hasValidData = viewModel.hasValidWorkoutData(selectedExercise.id)
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                OutlinedButton(
                                    onClick = { viewModel.startAddingSet() },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(16.dp)
                                ) {
                                    Text("Добавить сет")
                                }
                                if (hasValidData) {
                                    Button(
                                        onClick = { viewModel.addStandardSet() },
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(16.dp)
                                    ) {
                                        Text("Стандарт")
                                    }
                                }
                            }
                        }
                    }
                }

                val sets = uiState.workoutExercises.find { it.exerciseId == uiState.selectedExercise?.id  }?.sets
                // Кнопка "Новое упражнение"
                if (sets?.isNotEmpty() == true) {
                    item {
                        TextButton(
                            onClick = { viewModel.finishExercise() },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Новое упражнение")
                        }
                    }
                }
            }

            // Карточка добавления сета
            if (uiState.isAddingSet) {
                Dialog(onDismissRequest = { viewModel.cancelAddingSet() }) {
                    SetCard(
                        reps = uiState.currentSetReps,
                        weight = uiState.currentSetWeight,
                        onRepsChange = { viewModel.updateSetReps(it) },
                        onWeightChange = { viewModel.updateSetWeight(it) },
                        onIncrementReps = { viewModel.incrementReps() },
                        onDecrementReps = { viewModel.decrementReps() },
                        onIncrementWeight = { viewModel.incrementWeight() },
                        onDecrementWeight = { viewModel.decrementWeight() },
                        onApply = { 
                            viewModel.applySet()
                        },
                        onCancel = { viewModel.cancelAddingSet() }
                    )
                }
            }
        }
    }
}

@Composable
fun CurrentExerciseCard(exerciseName: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        shadowElevation = 3.dp,
        color = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = exerciseName,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF111111)
            )
            
            Text(
                text = "Сетов пока нет",
                fontSize = 14.sp,
                color = Color(0xFF666666),
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
fun ExerciseCard(exercise: NewWorkoutExercise) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        shadowElevation = 3.dp,
        color = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = exercise.exerciseName,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Color(0xFF111111)
            )
            
            if (exercise.sets.isEmpty()) {
                Text(
                    text = "Сетов пока нет",
                    fontSize = 14.sp,
                    color = Color(0xFF666666),
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                val groupedSets = groupSetsByWeightAndReps(exercise.sets)
                groupedSets.forEach { group ->
                    Text(
                        text = if (group.count > 1) {
                            "${group.weight.toInt()} кг × ${group.reps} × ${group.count}"
                        } else {
                            "${group.weight.toInt()} кг × ${group.reps}"
                        },
                        fontSize = 16.sp,
                        color = Color(0xFF111111)
                    )
                }
            }
        }
    }
}

@Composable
fun ExerciseDropdown(
    exercises: List<com.batonec.trainer.data.model.ApiExercise>,
    onExerciseSelected: (com.batonec.trainer.data.model.ApiExercise) -> Unit,
    onDismiss: () -> Unit,
    showCancelButton: Boolean = true
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        shadowElevation = 4.dp,
        color = Color.White
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Выберите упражнение",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            
            exercises.forEach { exercise ->
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onExerciseSelected(exercise) },
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant
                ) {
                    Text(
                        text = exercise.name,
                        modifier = Modifier.padding(16.dp),
                        fontSize = 16.sp
                    )
                }
            }
            
            if (showCancelButton) {
                Spacer(modifier = Modifier.height(8.dp))
                
                TextButton(
                    onClick = onDismiss,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Отмена")
                }
            }
        }
    }
}

@Composable
fun SetCard(
    reps: Int,
    weight: Double,
    onRepsChange: (Int) -> Unit,
    onWeightChange: (Double) -> Unit,
    onIncrementReps: () -> Unit,
    onDecrementReps: () -> Unit,
    onIncrementWeight: () -> Unit,
    onDecrementWeight: () -> Unit,
    onApply: () -> Unit,
    onCancel: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        shape = RoundedCornerShape(24.dp),
        color = Color.White,
        shadowElevation = 8.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            // Вес
            Text(
                text = "Вес",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            )
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onDecrementWeight) {
                    Text("-", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                }
                
                Text(
                    text = "${weight.toInt()} кг",
                    fontSize = 48.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 32.dp)
                )
                
                IconButton(onClick = onIncrementWeight) {
                    Text("+", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                }
            }
            
            // Повторения
            Text(
                text = "Количество повторений",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold
            )
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onDecrementReps) {
                    Text("-", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                }
                
                Text(
                    text = "$reps",
                    fontSize = 48.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 32.dp)
                )
                
                IconButton(onClick = onIncrementReps) {
                    Text("+", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                }
            }
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Отмена")
                }
                
                Button(
                    onClick = onApply,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Применить")
                }
            }
        }
    }
}

data class GroupedRepsSet(
    val weight: Double,
    val reps: Int,
    val count: Int
)

private fun groupSetsByWeightAndReps(sets: List<NewWorkoutSet>): List<GroupedRepsSet> {
    if (sets.isEmpty()) return emptyList()
    
    val grouped = mutableListOf<GroupedRepsSet>()
    var currentGroup: GroupedRepsSet? = null
    
    sets.forEach { set ->
        if (currentGroup == null) {
            // Начинаем новую группу
            currentGroup = GroupedRepsSet(
                weight = set.weight,
                reps = set.reps,
                count = 1
            )
        } else {
            // Проверяем, можно ли добавить к текущей группе
            // Группируем только если вес и reps одинаковые
            if (currentGroup.weight == set.weight && currentGroup.reps == set.reps) {
                // Добавляем к текущей группе
                currentGroup = currentGroup.copy(
                    count = currentGroup.count + 1
                )
            } else {
                // Сохраняем текущую группу и начинаем новую
                grouped.add(currentGroup)
                currentGroup = GroupedRepsSet(
                    weight = set.weight,
                    reps = set.reps,
                    count = 1
                )
            }
        }
    }
    
    // Добавляем последнюю группу
    currentGroup?.let { grouped.add(it) }
    
    return grouped
}

