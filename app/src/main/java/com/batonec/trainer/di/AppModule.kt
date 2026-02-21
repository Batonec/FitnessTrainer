package com.batonec.trainer.di

import android.content.Context
import androidx.room.Room
import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.api.WorkoutApiService
import com.batonec.trainer.data.local.db.AppDatabase
import com.batonec.trainer.data.local.db.ExerciseDao
import com.batonec.trainer.data.local.db.WorkoutDao
import com.batonec.trainer.data.repository.DefaultWorkoutRepository
import com.batonec.trainer.data.repository.WorkoutRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideAppDatabase(@ApplicationContext context: Context): AppDatabase {
        return Room.databaseBuilder(
            context,
            AppDatabase::class.java,
            "trainer.db"
        ).build()
    }

    @Provides
    fun provideWorkoutDao(database: AppDatabase): WorkoutDao = database.workoutDao()

    @Provides
    fun provideExerciseDao(database: AppDatabase): ExerciseDao = database.exerciseDao()

    @Provides
    @Singleton
    fun provideWorkoutApiService(): WorkoutApiService = RetrofitClient.workoutApiService

    @Provides
    @Singleton
    fun provideWorkoutRepository(
        apiService: WorkoutApiService,
        workoutDao: WorkoutDao,
        exerciseDao: ExerciseDao
    ): WorkoutRepository {
        return DefaultWorkoutRepository(apiService, workoutDao, exerciseDao)
    }
}
