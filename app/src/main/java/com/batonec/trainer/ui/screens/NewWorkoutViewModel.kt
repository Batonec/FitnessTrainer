package com.batonec.trainer.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.model.Exercise
import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.model.WorkoutData
import com.batonec.trainer.data.repository.WorkoutRepository
import com.batonec.trainer.domain.workout.WorkoutHistoryAnalyzer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

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
    val saveError: String? = null,
    val isSavingWorkout: Boolean = false,
    val selectedExercise: ApiExercise? = null,
    val isAddingExercise: Boolean = false,
    val isAddingSet: Boolean = false,
    val currentSetReps: Int = 12,
    val currentSetWeight: Double = 0.0,
    val workoutExercises: List<NewWorkoutExercise> = emptyList()
)

@HiltViewModel
class NewWorkoutViewModel @Inject constructor(
    private val workoutRepository: WorkoutRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(NewWorkoutUiState())
    val uiState: StateFlow<NewWorkoutUiState> = _uiState.asStateFlow()

    init {
        loadExercises()
        loadWorkouts()
    }

    fun loadExercises() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingExercises = true, error = null)
            val result = workoutRepository.loadExercises()
            result.fold(
                onSuccess = { exercises ->
                    _uiState.value = _uiState.value.copy(
                        exercises = exercises,
                        isLoadingExercises = false,
                        error = null
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoadingExercises = false,
                        error = e.message ?: "Ошибка загрузки упражнений"
                    )
                }
            )
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
        val exercises = _uiState.value.workoutExercises
        if (exercises.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                selectedExercise = null,
                isAddingExercise = false,
                isAddingSet = false,
                currentSetReps = 12,
                currentSetWeight = 0.0
            )
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSavingWorkout = true, saveError = null)

            val workout = buildLocalWorkout(exercises)
            val saveResult = workoutRepository.saveWorkoutLocally(workout)

            saveResult.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        workoutExercises = emptyList(),
                        selectedExercise = null,
                        isAddingExercise = false,
                        isAddingSet = false,
                        currentSetReps = 12,
                        currentSetWeight = 0.0,
                        isSavingWorkout = false,
                        saveError = null
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isSavingWorkout = false,
                        saveError = e.message ?: "Ошибка сохранения тренировки"
                    )
                }
            )
        }
    }

    private fun buildLocalWorkout(exercises: List<NewWorkoutExercise>): Workout {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())
        val workoutId = (System.currentTimeMillis() / 1000L).toInt()

        return Workout(
            id = workoutId,
            workoutDate = date,
            planId = null,
            data = WorkoutData(
                focus = null,
                notes = null,
                exercises = exercises.map { exercise ->
                    Exercise(
                        name = exercise.exerciseName,
                        exerciseId = exercise.exerciseId,
                        sets = exercise.sets.mapIndexed { index, set ->
                            ExerciseSet(
                                reps = set.reps,
                                notes = set.notes,
                                weight = set.weight,
                                setIndex = index + 1
                            )
                        }
                    )
                },
                loadType = null
            )
        )
    }
}
