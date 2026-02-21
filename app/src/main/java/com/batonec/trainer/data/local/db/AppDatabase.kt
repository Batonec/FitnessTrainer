package com.batonec.trainer.data.local.db

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.batonec.trainer.data.local.entity.ExerciseEntity
import com.batonec.trainer.data.local.entity.WorkoutEntity

@Database(
    entities = [WorkoutEntity::class, ExerciseEntity::class],
    version = 1,
    exportSchema = false
)
@TypeConverters(DatabaseConverters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun workoutDao(): WorkoutDao
    abstract fun exerciseDao(): ExerciseDao
}
