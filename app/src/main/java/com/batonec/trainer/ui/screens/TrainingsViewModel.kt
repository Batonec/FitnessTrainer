package com.batonec.trainer.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.repository.WorkoutRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TrainingsUiState(
    val workouts: List<Workout> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = true,
    val isLoadingMore: Boolean = false
)

class TrainingsViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(TrainingsUiState())
    val uiState: StateFlow<TrainingsUiState> = _uiState.asStateFlow()

    private var currentOffset = 0
    private val limit = 10

    init {
        loadWorkouts()
    }

    fun loadWorkouts() {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            val result = WorkoutRepository.loadWorkouts(limit = limit, offset = 0)
            result.fold(
                onSuccess = { (workouts, hasMore) ->
                    currentOffset = 0
                    _uiState.value = _uiState.value.copy(
                        workouts = workouts,
                        isLoading = false,
                        hasMore = hasMore,
                        error = null
                    )
                },
                onFailure = { e ->
                    val errorMessage = when {
                        e.message?.contains("Connection reset") == true -> "Соединение разорвано. Проверьте подключение к интернету."
                        e.message?.contains("Failed to connect") == true -> "Не удалось подключиться к серверу."
                        e.message?.contains("timeout") == true -> "Превышено время ожидания."
                        else -> e.message ?: "Ошибка загрузки данных"
                    }
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = errorMessage
                    )
                }
            )
        }
    }

    fun loadMoreWorkouts() {
        if (_uiState.value.isLoadingMore || !_uiState.value.hasMore) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingMore = true)
            val nextOffset = currentOffset + limit
            val result = WorkoutRepository.loadWorkouts(limit = limit, offset = nextOffset)
            result.fold(
                onSuccess = { (workouts, hasMore) ->
                    currentOffset = nextOffset
                    _uiState.value = _uiState.value.copy(
                        workouts = _uiState.value.workouts + workouts,
                        isLoadingMore = false,
                        hasMore = hasMore
                    )
                },
                onFailure = { e ->
                    val errorMessage = when {
                        e.message?.contains("Connection reset") == true -> "Соединение разорвано. Проверьте подключение к интернету."
                        e.message?.contains("Failed to connect") == true -> "Не удалось подключиться к серверу."
                        e.message?.contains("timeout") == true -> "Превышено время ожидания."
                        else -> e.message ?: "Ошибка загрузки данных"
                    }
                    _uiState.value = _uiState.value.copy(
                        isLoadingMore = false,
                        error = errorMessage
                    )
                }
            )
        }
    }
}

