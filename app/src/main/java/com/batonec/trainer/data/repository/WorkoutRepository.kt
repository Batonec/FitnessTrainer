package com.batonec.trainer.data.repository

import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.model.Workout

object WorkoutRepository {
    // Кеш истории тренировок (не персистентный)
    private var cachedWorkouts: List<Workout> = emptyList()
    
    /**
     * Получить закешированные тренировки
     */
    fun getCachedWorkouts(): List<Workout> = cachedWorkouts
    
    /**
     * Обновить кеш тренировок
     */
    fun updateCache(workouts: List<Workout>) {
        cachedWorkouts = workouts
    }
    
    /**
     * Добавить тренировки в кеш (для пагинации)
     */
    fun appendToCache(workouts: List<Workout>) {
        cachedWorkouts = cachedWorkouts + workouts
    }
    
    /**
     * Загрузить историю тренировок и обновить кеш
     */
    suspend fun loadWorkouts(limit: Int = 10, offset: Int = 0): Result<Pair<List<Workout>, Boolean>> {
        return try {
            val response = RetrofitClient.workoutApiService.getWorkouts(
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

