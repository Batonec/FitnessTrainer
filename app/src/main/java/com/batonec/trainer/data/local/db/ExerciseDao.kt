package com.batonec.trainer.data.local.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.batonec.trainer.data.local.entity.ExerciseEntity

@Dao
interface ExerciseDao {
    @Query("SELECT * FROM exercises ORDER BY name ASC")
    suspend fun getAll(): List<ExerciseEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(exercises: List<ExerciseEntity>)

    @Query("DELETE FROM exercises")
    suspend fun clearAll()
}
