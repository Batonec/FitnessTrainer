package com.batonec.trainer.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.repository.WorkoutRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale

data class NewWorkoutSet(
    val reps: Int = 12,
    val weight: Double = 0.0,
    val notes: String? = null
)

data class NewWorkoutExercise(
    val exerciseId: Int,
    val exerciseName: String,
    val sets: MutableList<NewWorkoutSet> = mutableListOf()
)

data class NewWorkoutUiState(
    val exercises: List<ApiExercise> = emptyList(),
    val isLoadingExercises: Boolean = false,
    val error: String? = null,
    val selectedExercise: ApiExercise? = null,
    val isAddingExercise: Boolean = false,
    val isAddingSet: Boolean = false,
    val currentSetReps: Int = 12,
    val currentSetWeight: Double = 0.0,
    val workoutExercises: MutableList<NewWorkoutExercise> = mutableListOf()
)

class NewWorkoutViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(NewWorkoutUiState())
    val uiState: StateFlow<NewWorkoutUiState> = _uiState.asStateFlow()

    init {
        loadExercises()
        loadWorkouts()
    }

    fun loadExercises() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingExercises = true, error = null)
            try {
                val response = RetrofitClient.workoutApiService.getExercises()
                _uiState.value = _uiState.value.copy(
                    exercises = response.exercises,
                    isLoadingExercises = false,
                    error = null
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isLoadingExercises = false,
                    error = e.message ?: "Ошибка загрузки упражнений"
                )
            }
        }
    }

    private fun loadWorkouts() {
        viewModelScope.launch {
            // Загружаем историю тренировок и сохраняем в кеш
            WorkoutRepository.loadWorkouts(limit = 10, offset = 0)
        }
    }

    fun startAddingExercise() {
        _uiState.value = _uiState.value.copy(isAddingExercise = true)
    }

    fun selectExercise(exercise: ApiExercise) {
        _uiState.value = _uiState.value.copy(
            selectedExercise = exercise,
            isAddingExercise = false
        )
    }

    fun startExercise() {
        // Упражнение уже выбрано, просто показываем кнопку добавления сета
        // Ничего не меняем в состоянии
    }

    fun startAddingSet() {
        val selected = _uiState.value.selectedExercise ?: return
        val weightFromLastWorkout = getWeightFromLastWorkout(selected.id)
        _uiState.value = _uiState.value.copy(
            isAddingSet = true, 
            currentSetReps = 12,
            currentSetWeight = weightFromLastWorkout
        )
    }

    fun updateSetReps(reps: Int) {
        _uiState.value = _uiState.value.copy(currentSetReps = reps)
    }

    fun updateSetWeight(weight: Double) {
        _uiState.value = _uiState.value.copy(currentSetWeight = weight)
    }

    fun incrementWeight() {
        _uiState.value = _uiState.value.copy(currentSetWeight = _uiState.value.currentSetWeight + 2.5)
    }

    fun decrementWeight() {
        val current = _uiState.value.currentSetWeight
        if (current >= 2.5) {
            _uiState.value = _uiState.value.copy(currentSetWeight = current - 2.5)
        }
    }

    fun incrementReps() {
        _uiState.value = _uiState.value.copy(currentSetReps = _uiState.value.currentSetReps + 1)
    }

    fun decrementReps() {
        val current = _uiState.value.currentSetReps
        if (current > 1) {
            _uiState.value = _uiState.value.copy(currentSetReps = current - 1)
        }
    }

    fun applySet() {
        val selected = _uiState.value.selectedExercise ?: return
        val currentExercises = _uiState.value.workoutExercises.toMutableList()
        
        // Находим или создаем упражнение
        val exerciseIndex = currentExercises.indexOfFirst { it.exerciseId == selected.id }
        
        if (exerciseIndex >= 0) {
            // Обновляем существующее упражнение
            val existing = currentExercises[exerciseIndex]
            val newSets = existing.sets.toMutableList()
            newSets.add(NewWorkoutSet(
                reps = _uiState.value.currentSetReps,
                weight = _uiState.value.currentSetWeight
            ))
            currentExercises[exerciseIndex] = NewWorkoutExercise(
                existing.exerciseId,
                existing.exerciseName,
                newSets
            )
        } else {
            // Создаем новое упражнение
            val newSets = mutableListOf(NewWorkoutSet(
                reps = _uiState.value.currentSetReps,
                weight = _uiState.value.currentSetWeight
            ))
            currentExercises.add(NewWorkoutExercise(selected.id, selected.name, newSets))
        }
        
        _uiState.value = _uiState.value.copy(
            workoutExercises = currentExercises,
            isAddingSet = false,
            selectedExercise = selected
        )
    }

    fun finishExercise() {
        // Не зануляем selectedExercise, просто открываем выбор нового упражнения
        // selectedExercise останется до тех пор, пока не выберут новое упражнение
        _uiState.value = _uiState.value.copy(
            isAddingSet = false,
            isAddingExercise = true
        )
    }

    fun cancelAddingExercise() {
        // При отмене просто закрываем выбор упражнения, но не сбрасываем текущее выбранное упражнение
        _uiState.value = _uiState.value.copy(
            isAddingExercise = false
        )
    }

    fun cancelAddingSet() {
        _uiState.value = _uiState.value.copy(isAddingSet = false)
    }

    fun addStandardSet() {
        val selected = _uiState.value.selectedExercise ?: return
        val currentExercises = _uiState.value.workoutExercises.toMutableList()
        
        // Получаем вес из прошлой тренировки
        val weightFromLastWorkout = getWeightFromLastWorkout(selected.id)
        
        // Находим или создаем упражнение
        val exerciseIndex = currentExercises.indexOfFirst { it.exerciseId == selected.id }
        
        if (exerciseIndex >= 0) {
            // Обновляем существующее упражнение
            val existing = currentExercises[exerciseIndex]
            val newSets = existing.sets.toMutableList()
            newSets.add(NewWorkoutSet(reps = 12, weight = weightFromLastWorkout))
            currentExercises[exerciseIndex] = NewWorkoutExercise(
                existing.exerciseId,
                existing.exerciseName,
                newSets
            )
        } else {
            // Создаем новое упражнение
            val newSets = mutableListOf(NewWorkoutSet(reps = 12, weight = weightFromLastWorkout))
            currentExercises.add(NewWorkoutExercise(selected.id, selected.name, newSets))
        }
        
        _uiState.value = _uiState.value.copy(
            workoutExercises = currentExercises,
            selectedExercise = selected
        )
    }

    /**
     * Получить вес из последней тренировки (с самой новой датой) для данного упражнения
     */
    private fun getWeightFromLastWorkout(exerciseId: Int): Double {
        val cachedWorkouts = WorkoutRepository.getCachedWorkouts()
        
        // Парсим дату для сортировки
        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        
        // Сортируем тренировки по дате (от новых к старым)
        val sortedWorkouts = cachedWorkouts.sortedByDescending { workout ->
            try {
                dateFormat.parse(workout.workoutDate)?.time ?: 0L
            } catch (e: Exception) {
                0L
            }
        }
        
        // Ищем первую тренировку (с самой новой датой), которая содержит нужное упражнение
        for (workout in sortedWorkouts) {
            val exercise = workout.data.exercises.find { it.exerciseId == exerciseId }
            exercise?.let {
                // Берем максимальный вес из всех сетов этого упражнения
                if (it.sets.isNotEmpty()) {
                    val maxWeight = it.sets.maxOf { set -> set.weight }
                    // Проверяем, что вес валидный (больше 0)
                    if (maxWeight > 0) {
                        return maxWeight
                    }
                }
            }
        }
        
        return 0.0
    }

    /**
     * Проверить, есть ли валидные данные для упражнения в прошлых тренировках
     */
    fun hasValidWorkoutData(exerciseId: Int): Boolean {
        val cachedWorkouts = WorkoutRepository.getCachedWorkouts()
        
        // Парсим дату для сортировки
        val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        
        // Сортируем тренировки по дате (от новых к старым)
        val sortedWorkouts = cachedWorkouts.sortedByDescending { workout ->
            try {
                dateFormat.parse(workout.workoutDate)?.time ?: 0L
            } catch (e: Exception) {
                0L
            }
        }
        
        // Ищем первую тренировку (с самой новой датой), которая содержит нужное упражнение
        for (workout in sortedWorkouts) {
            val exercise = workout.data.exercises.find { it.exerciseId == exerciseId }
            exercise?.let {
                // Проверяем, что есть сеты с валидными данными
                if (it.sets.isNotEmpty()) {
                    val hasValidData = it.sets.any { set ->
                        // Проверяем, что вес и повторы валидные (больше 0)
                        set.weight > 0 && set.reps > 0
                    }
                    if (hasValidData) {
                        return true
                    }
                }
            }
        }
        
        return false
    }

    fun finishWorkout() {
        // Сбрасываем состояние тренировки, но сохраняем загруженные упражнения
        _uiState.value = _uiState.value.copy(
            workoutExercises = mutableListOf(),
            selectedExercise = null,
            isAddingExercise = false,
            isAddingSet = false,
            currentSetReps = 12,
            currentSetWeight = 0.0
        )
    }
}

