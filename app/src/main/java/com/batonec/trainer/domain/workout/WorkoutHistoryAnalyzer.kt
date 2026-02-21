package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.Workout
import java.text.SimpleDateFormat
import java.util.Locale

object WorkoutHistoryAnalyzer {
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

    fun getWeightFromLastWorkout(workouts: List<Workout>, exerciseId: Int): Double {
        val sortedWorkouts = workouts.sortedByDescending { workout ->
            try {
                dateFormat.parse(workout.workoutDate)?.time ?: 0L
            } catch (_: Exception) {
                0L
            }
        }

        for (workout in sortedWorkouts) {
            val exercise = workout.data.exercises.find { it.exerciseId == exerciseId } ?: continue
            if (exercise.sets.isNotEmpty()) {
                val maxWeight = exercise.sets.maxOf { set -> set.weight }
                if (maxWeight > 0) {
                    return maxWeight
                }
            }
        }
        return 0.0
    }

    fun hasValidWorkoutData(workouts: List<Workout>, exerciseId: Int): Boolean {
        val sortedWorkouts = workouts.sortedByDescending { workout ->
            try {
                dateFormat.parse(workout.workoutDate)?.time ?: 0L
            } catch (_: Exception) {
                0L
            }
        }

        for (workout in sortedWorkouts) {
            val exercise = workout.data.exercises.find { it.exerciseId == exerciseId } ?: continue
            if (exercise.sets.any { set -> set.weight > 0 && set.reps > 0 }) {
                return true
            }
        }
        return false
    }
}
