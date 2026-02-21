package com.batonec.trainer.di

import com.batonec.trainer.data.api.RetrofitClient
import com.batonec.trainer.data.api.WorkoutApiService
import com.batonec.trainer.data.repository.DefaultWorkoutRepository
import com.batonec.trainer.data.repository.WorkoutRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideWorkoutApiService(): WorkoutApiService = RetrofitClient.workoutApiService

    @Provides
    @Singleton
    fun provideWorkoutRepository(apiService: WorkoutApiService): WorkoutRepository {
        return DefaultWorkoutRepository(apiService)
    }
}
