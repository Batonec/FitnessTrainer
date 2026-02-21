package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.ui.screens.NewWorkoutSet
import org.junit.Assert.assertEquals
import org.junit.Test

class SetGroupingTest {
    @Test
    fun `groupConsecutiveExerciseSets groups only consecutive sets with same params`() {
        val sets = listOf(
            ExerciseSet(reps = 10, notes = null, weight = 60.0, setIndex = 1),
            ExerciseSet(reps = 10, notes = null, weight = 60.0, setIndex = 2),
            ExerciseSet(reps = 10, notes = "hard", weight = 60.0, setIndex = 3),
            ExerciseSet(reps = 10, notes = "hard", weight = 60.0, setIndex = 4),
            ExerciseSet(reps = 8, notes = null, weight = 55.0, setIndex = 5),
            ExerciseSet(reps = 10, notes = null, weight = 60.0, setIndex = 6)
        )

        val groups = groupConsecutiveExerciseSets(sets)

        assertEquals(4, groups.size)
        assertEquals(2, groups[0].count)
        assertEquals(2, groups[1].count)
        assertEquals("hard", groups[1].notes)
        assertEquals(1, groups[2].count)
        assertEquals(1, groups[3].count)
    }

    @Test
    fun `groupWorkoutSetsByWeightAndReps groups consecutive identical set definitions`() {
        val sets = listOf(
            NewWorkoutSet(reps = 12, weight = 40.0),
            NewWorkoutSet(reps = 12, weight = 40.0),
            NewWorkoutSet(reps = 10, weight = 40.0),
            NewWorkoutSet(reps = 10, weight = 40.0),
            NewWorkoutSet(reps = 10, weight = 42.5)
        )

        val groups = groupWorkoutSetsByWeightAndReps(sets)

        assertEquals(3, groups.size)
        assertEquals(2, groups[0].count)
        assertEquals(2, groups[1].count)
        assertEquals(1, groups[2].count)
        assertEquals(42.5, groups[2].weight, 0.001)
    }
}
