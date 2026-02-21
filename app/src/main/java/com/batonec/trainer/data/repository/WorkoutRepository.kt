package com.batonec.trainer.data.repository

import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.api.WorkoutApiService
import com.batonec.trainer.data.model.Workout

interface WorkoutRepository {
    fun getCachedWorkouts(): List<Workout>
    suspend fun loadWorkouts(limit: Int = 10, offset: Int = 0): Result<Pair<List<Workout>, Boolean>>
}

class DefaultWorkoutRepository(
    private val apiService: WorkoutApiService = RetrofitClient.workoutApiService
) : WorkoutRepository {
    // Кеш истории тренировок (не персистентный, живет пока процесс приложения активен)
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
            val response = apiService.getWorkouts(
                limit = limit,
                offset = offset
            )
            if (offset == 0) {
                // Первая загрузка - заменяем кеш
                updateCache(response.workouts)
            } else {
                // Пагинация - добавляем к кешу
                appendToCache(response.workouts)
            }
            Result.success(Pair(response.workouts, response.hasMore))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
