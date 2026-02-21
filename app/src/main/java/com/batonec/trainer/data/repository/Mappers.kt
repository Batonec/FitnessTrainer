package com.batonec.trainer.data.repository

import com.batonec.trainer.data.local.entity.ExerciseEntity
import com.batonec.trainer.data.local.entity.WorkoutEntity
import com.batonec.trainer.data.model.ApiExercise
import com.batonec.trainer.data.model.Workout

fun Workout.toEntity(): WorkoutEntity {
    return WorkoutEntity(
        id = id,
        workoutDate = workoutDate,
        planId = planId,
        data = data
    )
}

fun WorkoutEntity.toModel(): Workout {
    return Workout(
        id = id,
        workoutDate = workoutDate,
        planId = planId,
        data = data
    )
}

fun ApiExercise.toEntity(): ExerciseEntity {
    return ExerciseEntity(
        id = id,
        name = name
    )
}

fun ExerciseEntity.toModel(): ApiExercise {
    return ApiExercise(
        id = id,
        name = name
    )
}
