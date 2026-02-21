package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.Exercise
import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.model.WorkoutData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkoutHistoryAnalyzerTest {
    @Test
    fun `getWeightFromLastWorkout returns max weight from newest workout with exercise`() {
        val workouts = listOf(
            workout(
                id = 1,
                date = "2025-01-10",
                exerciseId = 10,
                sets = listOf(
                    set(reps = 10, weight = 60.0, setIndex = 1),
                    set(reps = 8, weight = 70.0, setIndex = 2)
                )
            ),
            workout(
                id = 2,
                date = "2025-01-12",
                exerciseId = 10,
                sets = listOf(
                    set(reps = 10, weight = 55.0, setIndex = 1),
                    set(reps = 8, weight = 65.0, setIndex = 2)
                )
            )
        )

        val result = WorkoutHistoryAnalyzer.getWeightFromLastWorkout(workouts, exerciseId = 10)

        assertEquals(65.0, result, 0.001)
    }

    @Test
    fun `getWeightFromLastWorkout returns zero when no positive weights found`() {
        val workouts = listOf(
            workout(
                id = 1,
                date = "2025-01-10",
                exerciseId = 10,
                sets = listOf(set(reps = 10, weight = 0.0, setIndex = 1))
            )
        )

        val result = WorkoutHistoryAnalyzer.getWeightFromLastWorkout(workouts, exerciseId = 10)

        assertEquals(0.0, result, 0.001)
    }

    @Test
    fun `hasValidWorkoutData checks across history and returns true when valid set exists`() {
        val workouts = listOf(
            workout(
                id = 1,
                date = "2025-01-12",
                exerciseId = 10,
                sets = listOf(set(reps = 0, weight = 80.0, setIndex = 1))
            ),
            workout(
                id = 2,
                date = "2025-01-10",
                exerciseId = 10,
                sets = listOf(set(reps = 8, weight = 75.0, setIndex = 1))
            )
        )

        assertTrue(WorkoutHistoryAnalyzer.hasValidWorkoutData(workouts, exerciseId = 10))
        assertFalse(WorkoutHistoryAnalyzer.hasValidWorkoutData(workouts, exerciseId = 99))
    }

    private fun workout(
        id: Int,
        date: String,
        exerciseId: Int,
        sets: List<ExerciseSet>
    ): Workout {
        return Workout(
            id = id,
            workoutDate = date,
            planId = null,
            data = WorkoutData(
                focus = null,
                notes = null,
                exercises = listOf(
                    Exercise(
                        name = "Exercise $exerciseId",
                        sets = sets,
                        exerciseId = exerciseId
                    )
                ),
                loadType = "MEDIUM"
            )
        )
    }

    private fun set(reps: Int, weight: Double, setIndex: Int): ExerciseSet {
        return ExerciseSet(
            reps = reps,
            notes = null,
            weight = weight,
            setIndex = setIndex
        )
    }
}
