package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.Exercise
import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.data.model.Workout
import com.batonec.trainer.data.model.WorkoutData
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class WorkoutProgressAnalyzerTest {
    @Test
    fun `summarize computes core stats for selected range`() {
        val workouts = listOf(
            workout(
                id = 1,
                date = "2026-02-20",
                exerciseName = "Bench Press",
                sets = listOf(
                    set(weight = 100.0, reps = 5, index = 1),
                    set(weight = 90.0, reps = 8, index = 2)
                )
            ),
            workout(
                id = 2,
                date = "2026-02-18",
                exerciseName = "Squat",
                sets = listOf(
                    set(weight = 120.0, reps = 3, index = 1)
                )
            ),
            workout(
                id = 3,
                date = "2026-01-01",
                exerciseName = "Row",
                sets = listOf(
                    set(weight = 60.0, reps = 10, index = 1)
                )
            )
        )

        val summary = WorkoutProgressAnalyzer.summarize(
            workouts = workouts,
            range = ProgressRange.DAYS_30,
            today = LocalDate.parse("2026-02-21")
        )

        assertEquals(2, summary.totalWorkouts)
        assertEquals(1580.0, summary.totalVolume, 0.001)
        assertEquals(790.0, summary.averageVolumePerWorkout, 0.001)
        assertEquals("Bench Press", summary.topExerciseByVolume?.exerciseName)
        assertNotNull(summary.heaviestSet)
        assertEquals(120.0, summary.heaviestSet?.weight ?: 0.0, 0.001)
        assertEquals(2, summary.volumeTrend.size)
    }

    @Test
    fun `summarize returns empty summary when no workouts in range`() {
        val workouts = listOf(
            workout(
                id = 1,
                date = "2025-01-01",
                exerciseName = "Bench Press",
                sets = listOf(set(weight = 100.0, reps = 5, index = 1))
            )
        )

        val summary = WorkoutProgressAnalyzer.summarize(
            workouts = workouts,
            range = ProgressRange.DAYS_7,
            today = LocalDate.parse("2026-02-21")
        )

        assertEquals(0, summary.totalWorkouts)
        assertEquals(0.0, summary.totalVolume, 0.001)
        assertNull(summary.topExerciseByVolume)
        assertNull(summary.heaviestSet)
        assertEquals(0, summary.volumeTrend.size)
    }

    private fun workout(
        id: Int,
        date: String,
        exerciseName: String,
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
                        name = exerciseName,
                        sets = sets,
                        exerciseId = id
                    )
                ),
                loadType = null
            )
        )
    }

    private fun set(weight: Double, reps: Int, index: Int): ExerciseSet {
        return ExerciseSet(
            reps = reps,
            notes = null,
            weight = weight,
            setIndex = index
        )
    }
}
