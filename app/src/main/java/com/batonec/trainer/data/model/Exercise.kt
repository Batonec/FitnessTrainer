package com.batonec.trainer.data.model

import com.google.gson.annotations.SerializedName

data class ExercisesResponse(
    @SerializedName("exercises") val exercises: List<ApiExercise>
)

data class ApiExercise(
    @SerializedName("id") val id: Int,
    @SerializedName("name") val name: String
)

