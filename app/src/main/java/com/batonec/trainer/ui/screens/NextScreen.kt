package com.batonec.trainer.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.batonec.trainer.domain.workout.ProgressRange
import com.batonec.trainer.domain.workout.ProgressSummary
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NextScreen(
    modifier: Modifier = Modifier,
    viewModel: NextViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Progress") },
                actions = {
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(imageVector = Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading && uiState.summary == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        val summary = uiState.summary
        if (summary == null) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(text = uiState.error ?: "No data yet")
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(onClick = { viewModel.refresh() }) {
                        Text("Retry")
                    }
                }
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item {
                RangeSelector(
                    selectedRange = uiState.selectedRange,
                    onRangeSelected = viewModel::onRangeSelected
                )
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        title = "Workouts",
                        value = summary.totalWorkouts.toString()
                    )
                    MetricCard(
                        modifier = Modifier.weight(1f),
                        title = "Volume",
                        value = formatVolume(summary.totalVolume)
                    )
                }
            }

            item {
                MetricCard(
                    title = "Average Volume / Workout",
                    value = formatVolume(summary.averageVolumePerWorkout)
                )
            }

            summary.topExerciseByVolume?.let { top ->
                item {
                    MetricCard(
                        title = "Top Exercise",
                        value = "${top.exerciseName} (${formatVolume(top.totalVolume)})"
                    )
                }
            }

            summary.heaviestSet?.let { set ->
                item {
                    MetricCard(
                        title = "Heaviest Set",
                        value = "${set.exerciseName}: ${set.weight.toInt()} kg x ${set.reps}",
                        subtitle = formatDate(set.workoutDate)
                    )
                }
            }

            item {
                Text(
                    text = "Recent Volume Trend",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
            }

            if (summary.volumeTrend.isEmpty()) {
                item {
                    Text(
                        text = "No workouts in this range",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            } else {
                items(summary.volumeTrend) { point ->
                    VolumeTrendRow(
                        date = formatDate(point.workoutDate),
                        volume = point.volume,
                        maxVolume = summary.volumeTrend.maxOfOrNull { it.volume } ?: 0.0
                    )
                }
            }
        }
    }
}

@Composable
private fun RangeSelector(
    selectedRange: ProgressRange,
    onRangeSelected: (ProgressRange) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        ProgressRange.entries.forEach { range ->
            FilterChip(
                selected = selectedRange == range,
                onClick = { onRangeSelected(range) },
                label = { Text(range.label) }
            )
        }
    }
}

@Composable
private fun MetricCard(
    title: String,
    value: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 2.dp
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = value,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            subtitle?.let {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun VolumeTrendRow(date: String, volume: Double, maxVolume: Double) {
    val progress = if (maxVolume > 0) (volume / maxVolume).toFloat() else 0f

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = date,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = formatVolume(volume),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
        )
    }
}

private fun formatDate(raw: String): String {
    return try {
        val date = LocalDate.parse(raw, DateTimeFormatter.ISO_LOCAL_DATE)
        date.format(DateTimeFormatter.ofPattern("dd MMM", Locale.getDefault()))
    } catch (_: Exception) {
        raw
    }
}

private fun formatVolume(value: Double): String {
    return "${value.toInt()} kg"
}

@Composable
private fun PreviewText() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = "Progress"
        )
    }
}
