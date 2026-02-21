package com.batonec.trainer.data.repository

import com.batonec.trainer.data.api.WorkoutApiService
import com.batonec.trainer.data.local.db.ExerciseDao
import com.batonec.trainer.data.local.db.WorkoutDao
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.model.Workout

interface WorkoutRepository {
    fun getCachedWorkouts(): List<Workout>
    suspend fun loadWorkouts(limit: Int = 10, offset: Int = 0): Result<Pair<List<Workout>, Boolean>>
    suspend fun loadExercises(forceRefresh: Boolean = false): Result<List<ApiExercise>>
    suspend fun saveWorkoutLocally(workout: Workout): Result<Unit>
}

class DefaultWorkoutRepository(
    private val apiService: WorkoutApiService,
    private val workoutDao: WorkoutDao,
    private val exerciseDao: ExerciseDao
) : WorkoutRepository {
    // In-memory cache mirrors local DB reads/writes for quick access in ViewModels.
    private var cachedWorkouts: List<Workout> = emptyList()

    override fun getCachedWorkouts(): List<Workout> = cachedWorkouts

    private fun updateCache(workouts: List<Workout>) {
        cachedWorkouts = workouts
    }

    private fun appendToCache(workouts: List<Workout>) {
        cachedWorkouts = cachedWorkouts + workouts
    }

    override suspend fun loadWorkouts(limit: Int, offset: Int): Result<Pair<List<Workout>, Boolean>> {
        return try {
            val response = apiService.getWorkouts(limit = limit, offset = offset)
            val entities = response.workouts.map { it.toEntity() }

            if (offset == 0) {
                workoutDao.clearAll()
                workoutDao.upsertAll(entities)
                updateCache(response.workouts)
            } else {
                workoutDao.upsertAll(entities)
                appendToCache(response.workouts)
            }

            Result.success(Pair(response.workouts, response.hasMore))
        } catch (e: Exception) {
            if (offset == 0) {
                val localWorkouts = workoutDao.getAll().map { it.toModel() }
                updateCache(localWorkouts)
                val limited = localWorkouts.take(limit)
                Result.success(Pair(limited, localWorkouts.size > limit))
            } else {
                Result.failure(e)
            }
        }
    }

    override suspend fun loadExercises(forceRefresh: Boolean): Result<List<ApiExercise>> {
        return try {
            val localExercises = exerciseDao.getAll().map { it.toModel() }
            if (localExercises.isNotEmpty() && !forceRefresh) {
                Result.success(localExercises)
            } else {
                val response = apiService.getExercises()
                exerciseDao.clearAll()
                exerciseDao.upsertAll(response.exercises.map { it.toEntity() })
                Result.success(response.exercises)
            }
        } catch (e: Exception) {
            val localExercises = exerciseDao.getAll().map { it.toModel() }
            if (localExercises.isNotEmpty()) {
                Result.success(localExercises)
            } else {
                Result.failure(e)
            }
        }
    }

    override suspend fun saveWorkoutLocally(workout: Workout): Result<Unit> {
        return try {
            workoutDao.upsert(workout.toEntity())
            updateCache(
                (cachedWorkouts + workout)
                    .distinctBy { it.id }
                    .sortedByDescending { it.workoutDate }
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

}
