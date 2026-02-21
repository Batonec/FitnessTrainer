package com.batonec.trainer.data.local.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.batonec.trainer.data.local.entity.WorkoutEntity

@Dao
interface WorkoutDao {
    @Query("SELECT * FROM workouts ORDER BY workout_date DESC")
    suspend fun getAll(): List<WorkoutEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(workouts: List<WorkoutEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(workout: WorkoutEntity)

    @Query("DELETE FROM workouts")
    suspend fun clearAll()
}
