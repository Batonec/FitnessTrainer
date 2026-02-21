package com.batonec.trainer.ui.screens

import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.repository.WorkoutRepository
import com.batonec.trainer.testutils.MainDispatcherRule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NewWorkoutViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun `finishWorkout saves and resets state on success`() = runTest {
        val repository = FakeWorkoutRepository(
            exercisesResult = Result.success(listOf(ApiExercise(id = 1, name = "Bench Press"))),
            saveResult = Result.success(Unit)
        )
        val viewModel = NewWorkoutViewModel(repository)
        advanceUntilIdle()

        viewModel.selectExercise(ApiExercise(id = 1, name = "Bench Press"))
        viewModel.applySet()
        viewModel.finishWorkout()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(1, repository.savedWorkouts.size)
        assertTrue(state.workoutExercises.isEmpty())
        assertNull(state.selectedExercise)
        assertFalse(state.isSavingWorkout)
        assertNull(state.saveError)
    }

    @Test
    fun `finishWorkout keeps data and exposes error on save failure`() = runTest {
        val repository = FakeWorkoutRepository(
            exercisesResult = Result.success(listOf(ApiExercise(id = 1, name = "Bench Press"))),
            saveResult = Result.failure(IllegalStateException("save failed"))
        )
        val viewModel = NewWorkoutViewModel(repository)
        advanceUntilIdle()

        viewModel.selectExercise(ApiExercise(id = 1, name = "Bench Press"))
        viewModel.applySet()
        viewModel.finishWorkout()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(1, repository.savedWorkouts.size)
        assertFalse(state.workoutExercises.isEmpty())
        assertFalse(state.isSavingWorkout)
        assertNotNull(state.saveError)
        assertTrue(state.saveError!!.contains("save failed"))
    }

    private class FakeWorkoutRepository(
        private val exercisesResult: Result<List<ApiExercise>>,
        private val saveResult: Result<Unit>
    ) : WorkoutRepository {
        val savedWorkouts = mutableListOf<Workout>()

        override fun getCachedWorkouts(): List<Workout> = emptyList()

        override suspend fun loadWorkouts(limit: Int, offset: Int): Result<Pair<List<Workout>, Boolean>> {
            return Result.success(Pair(emptyList(), false))
        }

        override suspend fun loadExercises(forceRefresh: Boolean): Result<List<ApiExercise>> {
            return exercisesResult
        }

        override suspend fun saveWorkoutLocally(workout: Workout): Result<Unit> {
            savedWorkouts.add(workout)
            return saveResult
        }
    }
}
