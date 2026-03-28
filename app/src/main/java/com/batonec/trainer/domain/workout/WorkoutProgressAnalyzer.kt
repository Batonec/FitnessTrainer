package com.batonec.trainer.domain.workout

import com.batonec.trainer.data.model.Workout
import java.time.LocalDate
import java.time.format.DateTimeFormatter

enum class ProgressRange(val label: String, val days: Long?) {
    DAYS_7("7D", 7),
    DAYS_30("30D", 30),
    ALL("All", null)
}

data class HeaviestSetRecord(
    val exerciseName: String,
    val weight: Double,
    val reps: Int,
    val workoutDate: String
)

data class ExerciseVolumeStat(
    val exerciseName: String,
    val totalVolume: Double
)

data class WorkoutVolumePoint(
    val workoutDate: String,
    val volume: Double
)

data class ProgressSummary(
    val totalWorkouts: Int,
    val totalVolume: Double,
    val averageVolumePerWorkout: Double,
    val topExerciseByVolume: ExerciseVolumeStat?,
    val heaviestSet: HeaviestSetRecord?,
    val volumeTrend: List<WorkoutVolumePoint>
)

object WorkoutProgressAnalyzer {
    private val isoDateFormatter: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun summarize(
        workouts: List<Workout>,
        range: ProgressRange,
        today: LocalDate = LocalDate.now()
    ): ProgressSummary {
        val filtered = workouts
            .mapNotNull { workout ->
                val date = parseDate(workout.workoutDate) ?: return@mapNotNull null
                if (!inRange(date, range, today)) return@mapNotNull null
                Pair(workout, date)
            }
            .sortedByDescending { (_, date) -> date }
            .map { (workout, _) -> workout }

        if (filtered.isEmpty()) {
            return ProgressSummary(
                totalWorkouts = 0,
                totalVolume = 0.0,
                averageVolumePerWorkout = 0.0,
                topExerciseByVolume = null,
                heaviestSet = null,
                volumeTrend = emptyList()
            )
        }

        val exerciseVolumeMap = linkedMapOf<String, Double>()
        var heaviestSet: HeaviestSetRecord? = null

        filtered.forEach { workout ->
            workout.data.exercises.forEach { exercise ->
                exercise.sets.forEach { set ->
                    if (set.weight > 0 && set.reps > 0) {
                        val setVolume = set.weight * set.reps
                        val currentExerciseVolume = exerciseVolumeMap[exercise.name] ?: 0.0
                        exerciseVolumeMap[exercise.name] = currentExerciseVolume + setVolume
                    }

                    val currentHeaviest = heaviestSet
                    if (currentHeaviest == null ||
                        set.weight > currentHeaviest.weight ||
                        (set.weight == currentHeaviest.weight && set.reps > currentHeaviest.reps)
                    ) {
                        heaviestSet = HeaviestSetRecord(
                            exerciseName = exercise.name,
                            weight = set.weight,
                            reps = set.reps,
                            workoutDate = workout.workoutDate
                        )
                    }
                }
            }
        }

        val volumeTrend = filtered
            .take(7)
            .reversed()
            .map { workout ->
                WorkoutVolumePoint(
                    workoutDate = workout.workoutDate,
                    volume = workoutVolume(workout)
                )
            }

        val totalVolume = exerciseVolumeMap.values.sum()
        val topExercise = exerciseVolumeMap.maxByOrNull { it.value }?.let { (name, volume) ->
            ExerciseVolumeStat(exerciseName = name, totalVolume = volume)
        }

        return ProgressSummary(
            totalWorkouts = filtered.size,
            totalVolume = totalVolume,
            averageVolumePerWorkout = totalVolume / filtered.size,
            topExerciseByVolume = topExercise,
            heaviestSet = heaviestSet,
            volumeTrend = volumeTrend
        )
    }

    private fun inRange(date: LocalDate, range: ProgressRange, today: LocalDate): Boolean {
        val days = range.days ?: return true
        val start = today.minusDays(days - 1)
        return !date.isBefore(start) && !date.isAfter(today)
    }

    private fun parseDate(value: String): LocalDate? {
        return try {
            LocalDate.parse(value, isoDateFormatter)
        } catch (_: Exception) {
            null
        }
    }

    private fun workoutVolume(workout: Workout): Double {
        return workout.data.exercises.sumOf { exercise ->
            exercise.sets.sumOf { set ->
                if (set.weight > 0 && set.reps > 0) set.weight * set.reps else 0.0
            }
        }
    }
}
