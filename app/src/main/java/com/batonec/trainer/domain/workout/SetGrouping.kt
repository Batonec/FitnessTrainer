package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.ExerciseSet
import com.batonec.trainer.ui.screens.NewWorkoutSet

data class GroupedExerciseSet(
    val weight: Double,
    val reps: Int,
    val count: Int,
    val firstSetIndex: Int,
    val lastSetIndex: Int,
    val notes: String?
)

data class GroupedWorkoutSet(
    val weight: Double,
    val reps: Int,
    val count: Int
)

fun groupConsecutiveExerciseSets(sets: List<ExerciseSet>): List<GroupedExerciseSet> {
    if (sets.isEmpty()) return emptyList()

    val grouped = mutableListOf<GroupedExerciseSet>()
    var currentGroup: GroupedExerciseSet? = null

    sets.forEach { set ->
        if (currentGroup == null) {
            currentGroup = GroupedExerciseSet(
                weight = set.weight,
                reps = set.reps,
                count = 1,
                firstSetIndex = set.setIndex,
                lastSetIndex = set.setIndex,
                notes = set.notes
            )
        } else if (
            currentGroup?.weight == set.weight &&
            currentGroup?.reps == set.reps &&
            currentGroup?.notes == set.notes
        ) {
            currentGroup = currentGroup?.copy(
                count = (currentGroup?.count ?: 0) + 1,
                lastSetIndex = set.setIndex
            )
        } else {
            currentGroup?.let { grouped.add(it) }
            currentGroup = GroupedExerciseSet(
                weight = set.weight,
                reps = set.reps,
                count = 1,
                firstSetIndex = set.setIndex,
                lastSetIndex = set.setIndex,
                notes = set.notes
            )
        }
    }

    currentGroup?.let { grouped.add(it) }
    return grouped
}

fun groupWorkoutSetsByWeightAndReps(sets: List<NewWorkoutSet>): List<GroupedWorkoutSet> {
    if (sets.isEmpty()) return emptyList()

    val grouped = mutableListOf<GroupedWorkoutSet>()
    var currentGroup: GroupedWorkoutSet? = null

    sets.forEach { set ->
        if (currentGroup == null) {
            currentGroup = GroupedWorkoutSet(
                weight = set.weight,
                reps = set.reps,
                count = 1
            )
        } else if (
            currentGroup?.weight == set.weight &&
            currentGroup?.reps == set.reps
        ) {
            currentGroup = currentGroup?.copy(count = (currentGroup?.count ?: 0) + 1)
        } else {
            currentGroup?.let { grouped.add(it) }
            currentGroup = GroupedWorkoutSet(
                weight = set.weight,
                reps = set.reps,
                count = 1
            )
        }
    }

    currentGroup?.let { grouped.add(it) }
    return grouped
}
