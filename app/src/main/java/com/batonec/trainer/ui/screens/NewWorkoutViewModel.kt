package com.batonec.trainer.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.repository.RepositoryProvider
import com.batonec.trainer.data.repository.WorkoutRepository
import com.batonec.trainer.domain.workout.WorkoutHistoryAnalyzer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class NewWorkoutSet(
    val reps: Int = 12,
    val weight: Double = 0.0,
    val notes: String? = null
)

data class NewWorkoutExercise(
    val exerciseId: Int,
    val exerciseName: String,
    val sets: List<NewWorkoutSet> = emptyList()
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
    val workoutExercises: List<NewWorkoutExercise> = emptyList()
)

class NewWorkoutViewModel : ViewModel() {
    private val workoutRepository: WorkoutRepository = RepositoryProvider.workoutRepository

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
            workoutRepository.loadWorkouts(limit = 10, offset = 0)
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
        val weightFromLastWorkout = WorkoutHistoryAnalyzer.getWeightFromLastWorkout(
            workouts = workoutRepository.getCachedWorkouts(),
            exerciseId = selected.id
        )
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
        val currentExercises = _uiState.value.workoutExercises
        
        // Находим или создаем упражнение
        val exerciseIndex = currentExercises.indexOfFirst { it.exerciseId == selected.id }
        
        val updatedExercises = if (exerciseIndex >= 0) {
            // Обновляем существующее упражнение
            currentExercises.mapIndexed { index, exercise ->
                if (index != exerciseIndex) {
                    exercise
                } else {
                    exercise.copy(
                        sets = exercise.sets + NewWorkoutSet(
                            reps = _uiState.value.currentSetReps,
                            weight = _uiState.value.currentSetWeight
                        )
                    )
                }
            }
        } else {
            // Создаем новое упражнение
            currentExercises + NewWorkoutExercise(
                exerciseId = selected.id,
                exerciseName = selected.name,
                sets = listOf(
                    NewWorkoutSet(
                        reps = _uiState.value.currentSetReps,
                        weight = _uiState.value.currentSetWeight
                    )
                )
            )
        }

        _uiState.value = _uiState.value.copy(
            workoutExercises = updatedExercises,
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
        val currentExercises = _uiState.value.workoutExercises
        
        // Получаем вес из прошлой тренировки
        val weightFromLastWorkout = WorkoutHistoryAnalyzer.getWeightFromLastWorkout(
            workouts = workoutRepository.getCachedWorkouts(),
            exerciseId = selected.id
        )
        
        // Находим или создаем упражнение
        val exerciseIndex = currentExercises.indexOfFirst { it.exerciseId == selected.id }

        val updatedExercises = if (exerciseIndex >= 0) {
            // Обновляем существующее упражнение
            currentExercises.mapIndexed { index, exercise ->
                if (index != exerciseIndex) {
                    exercise
                } else {
                    exercise.copy(
                        sets = exercise.sets + NewWorkoutSet(reps = 12, weight = weightFromLastWorkout)
                    )
                }
            }
        } else {
            // Создаем новое упражнение
            currentExercises + NewWorkoutExercise(
                exerciseId = selected.id,
                exerciseName = selected.name,
                sets = listOf(NewWorkoutSet(reps = 12, weight = weightFromLastWorkout))
            )
        }
        
        _uiState.value = _uiState.value.copy(
            workoutExercises = updatedExercises,
            selectedExercise = selected
        )
    }

    /**
     * Проверить, есть ли валидные данные для упражнения в прошлых тренировках
     */
    fun hasValidWorkoutData(exerciseId: Int): Boolean {
        return WorkoutHistoryAnalyzer.hasValidWorkoutData(
            workouts = workoutRepository.getCachedWorkouts(),
            exerciseId = exerciseId
        )
    }

    fun finishWorkout() {
        // Сбрасываем состояние тренировки, но сохраняем загруженные упражнения
        _uiState.value = _uiState.value.copy(
            workoutExercises = emptyList(),
            selectedExercise = null,
            isAddingExercise = false,
            isAddingSet = false,
            currentSetReps = 12,
            currentSetWeight = 0.0
        )
    }
}
