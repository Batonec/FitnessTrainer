package com.batonec.trainer.data.api

import com.batonec.trainer.data.model.ExercisesResponse
import com.batonec.trainer.data.model.WorkoutsResponse
import retrofit2.http.GET
import retrofit2.http.Query

interface WorkoutApiService {
    @GET("workouts")
    suspend fun getWorkouts(
        @Query("limit") limit: Int = 10,
        @Query("offset") offset: Int = 0
    ): WorkoutsResponse
    
    @GET("exercises")
    suspend fun getExercises(): ExercisesResponse
}

