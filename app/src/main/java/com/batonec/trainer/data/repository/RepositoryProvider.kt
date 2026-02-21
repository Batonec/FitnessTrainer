package com.batonec.trainer.data.repository

object RepositoryProvider {
    val workoutRepository: WorkoutRepository by lazy { DefaultWorkoutRepository() }
}
