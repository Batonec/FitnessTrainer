package com.batonec.trainer.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.repository.WorkoutRepository
import com.batonec.trainer.domain.workout.ProgressRange
import com.batonec.trainer.domain.workout.ProgressSummary
import com.batonec.trainer.domain.workout.WorkoutProgressAnalyzer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProgressUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val selectedRange: ProgressRange = ProgressRange.DAYS_30,
    val summary: ProgressSummary? = null
)

@HiltViewModel
class NextViewModel @Inject constructor(
    private val workoutRepository: WorkoutRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(ProgressUiState())
    val uiState: StateFlow<ProgressUiState> = _uiState.asStateFlow()

    private var allWorkouts: List<Workout> = emptyList()

    init {
        refresh()
    }

    fun refresh() {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            val result = workoutRepository.loadWorkouts(limit = 50, offset = 0)
            result.fold(
                onSuccess = { (workouts, _) ->
                    allWorkouts = workoutRepository.getCachedWorkouts().ifEmpty { workouts }
                    updateSummary(_uiState.value.selectedRange)
                },
                onFailure = { e ->
                    allWorkouts = workoutRepository.getCachedWorkouts()
                    if (allWorkouts.isNotEmpty()) {
                        updateSummary(_uiState.value.selectedRange)
                    } else {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            error = e.message ?: "Failed to load progress data",
                            summary = null
                        )
                    }
                }
            )
        }
    }

    fun onRangeSelected(range: ProgressRange) {
        if (_uiState.value.selectedRange == range) return
        updateSummary(range)
    }

    private fun updateSummary(range: ProgressRange) {
        val summary = WorkoutProgressAnalyzer.summarize(allWorkouts, range)
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            error = null,
            selectedRange = range,
            summary = summary
        )
    }
}
