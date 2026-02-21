package com.batonec.trainer.data.model

import com.google.gson.annotations.SerializedName

data class WorkoutsResponse(
    @SerializedName("workouts") val workouts: List<Workout>,
    @SerializedName("total") val total: Int,
    @SerializedName("limit") val limit: Int,
    @SerializedName("offset") val offset: Int,
    @SerializedName("has_more") val hasMore: Boolean
)

data class Workout(
    @SerializedName("id") val id: Int,
    @SerializedName("workout_date") val workoutDate: String,
    @SerializedName("plan_id") val planId: Int?,
    @SerializedName("data") val data: WorkoutData
)

data class WorkoutData(
    @SerializedName("focus") val focus: String?,
    @SerializedName("notes") val notes: String?,
    @SerializedName("exercises") val exercises: List<Exercise>,
    @SerializedName("load_type") val loadType: String?
)

data class Exercise(
    @SerializedName("name") val name: String,
    @SerializedName("sets") val sets: List<ExerciseSet>,
    @SerializedName("exercise_id") val exerciseId: Int
)

data class ExerciseSet(
    @SerializedName("reps") val reps: Int,
    @SerializedName("notes") val notes: String?,
    @SerializedName("weight") val weight: Double,
    @SerializedName("set_index") val setIndex: Int
)

