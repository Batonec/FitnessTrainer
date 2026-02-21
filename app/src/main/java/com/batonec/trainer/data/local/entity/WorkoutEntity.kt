package com.batonec.trainer.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import com.batonec.trainer.data.model.WorkoutData

@Entity(tableName = "workouts")
data class WorkoutEntity(
    @PrimaryKey val id: Int,
    @ColumnInfo(name = "workout_date") val workoutDate: String,
    @ColumnInfo(name = "plan_id") val planId: Int?,
    @ColumnInfo(name = "data") val data: WorkoutData
)
