package com.batonec.trainer.data.repository

import com.batonec.trainer.data.api.WorkoutApiService
import com.batonec.trainer.data.local.db.ExerciseDao
import com.batonec.trainer.data.local.db.WorkoutDao
import com.batonec.trainer.data.local.entity.ExerciseEntity
import com.batonec.trainer.data.local.entity.WorkoutEntity
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.model.Exercise
import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.data.model.ExercisesResponse
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.model.WorkoutData
import com.batonec.trainer.data.model.WorkoutsResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DefaultWorkoutRepositoryTest {
    @Test
    fun `loadWorkouts falls back to local data on initial remote failure`() = runTest {
        val workoutDao = FakeWorkoutDao().apply {
            stored = mutableListOf(
                workoutEntity(id = 2, date = "2025-01-12"),
                workoutEntity(id = 1, date = "2025-01-10")
            )
        }
        val exerciseDao = FakeExerciseDao()
        val api = FakeWorkoutApiService(throwWorkouts = true)
        val repository = DefaultWorkoutRepository(api, workoutDao, exerciseDao)

        val result = repository.loadWorkouts(limit = 1, offset = 0)
        val (workouts, hasMore) = result.getOrThrow()

        assertEquals(1, workouts.size)
        assertEquals(2, workouts.first().id)
        assertTrue(hasMore)
        assertEquals(2, repository.getCachedWorkouts().size)
    }

    @Test
    fun `loadExercises returns local cache when forced refresh fails`() = runTest {
        val workoutDao = FakeWorkoutDao()
        val exerciseDao = FakeExerciseDao().apply {
            stored = mutableListOf(ExerciseEntity(id = 11, name = "Pull Up"))
        }
        val api = FakeWorkoutApiService(throwExercises = true)
        val repository = DefaultWorkoutRepository(api, workoutDao, exerciseDao)

        val result = repository.loadExercises(forceRefresh = true)
        val exercises = result.getOrThrow()

        assertEquals(1, exercises.size)
        assertEquals(11, exercises.first().id)
        assertEquals("Pull Up", exercises.first().name)
    }

    private class FakeWorkoutApiService(
        private val throwWorkouts: Boolean = false,
        private val throwExercises: Boolean = false
    ) : WorkoutApiService {
        override suspend fun getWorkouts(limit: Int, offset: Int): WorkoutsResponse {
            if (throwWorkouts) throw IllegalStateException("remote workouts failed")
            return WorkoutsResponse(
                workouts = emptyList(),
                total = 0,
                limit = limit,
                offset = offset,
                hasMore = false
            )
        }

        override suspend fun getExercises(): ExercisesResponse {
            if (throwExercises) throw IllegalStateException("remote exercises failed")
            return ExercisesResponse(exercises = emptyList())
        }
    }

    private class FakeWorkoutDao : WorkoutDao {
        var stored: MutableList<WorkoutEntity> = mutableListOf()

        override suspend fun getAll(): List<WorkoutEntity> = stored.toList()

        override suspend fun upsertAll(workouts: List<WorkoutEntity>) {
            val merged = (stored + workouts).associateBy { it.id }.values.toMutableList()
            stored = merged
        }

        override suspend fun upsert(workout: WorkoutEntity) {
            stored = (stored + workout).associateBy { it.id }.values.toMutableList()
        }

        override suspend fun clearAll() {
            stored.clear()
        }
    }

    private class FakeExerciseDao : ExerciseDao {
        var stored: MutableList<ExerciseEntity> = mutableListOf()

        override suspend fun getAll(): List<ExerciseEntity> = stored.toList()

        override suspend fun upsertAll(exercises: List<ExerciseEntity>) {
            stored = (stored + exercises).associateBy { it.id }.values.toMutableList()
        }

        override suspend fun clearAll() {
            stored.clear()
        }
    }

    private fun workoutEntity(id: Int, date: String): WorkoutEntity {
        return WorkoutEntity(
            id = id,
            workoutDate = date,
            planId = null,
            data = WorkoutData(
                focus = null,
                notes = null,
                exercises = listOf(
                    Exercise(
                        name = "Bench Press",
                        exerciseId = 1,
                        sets = listOf(
                            ExerciseSet(reps = 10, notes = null, weight = 60.0, setIndex = 1)
                        )
                    )
                ),
                loadType = null
            )
        )
    }
}
