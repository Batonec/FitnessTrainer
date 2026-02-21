package com.batonec.trainer.data.local.db

import androidx.room.TypeConverter
import com.batonec.trainer.data.model.WorkoutData
import com.google.gson.Gson

class DatabaseConverters {
    private val gson = Gson()

    @TypeConverter
    fun fromWorkoutData(value: WorkoutData): String = gson.toJson(value)

    @TypeConverter
    fun toWorkoutData(value: String): WorkoutData = gson.fromJson(value, WorkoutData::class.java)
}
