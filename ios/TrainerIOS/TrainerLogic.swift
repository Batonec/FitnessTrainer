import Foundation

enum TrainerLogic {
    static let rareOnlyBenchPressID = 1

    static func sortWorkouts(_ workouts: [Workout]) -> [Workout] {
        workouts.sorted { left, right in
            if left.workoutDate == right.workoutDate {
                let leftCreatedAt = left.createdAt ?? 0
                let rightCreatedAt = right.createdAt ?? 0
                if leftCreatedAt != rightCreatedAt {
                    return leftCreatedAt > rightCreatedAt
                }

                let leftUpdatedAt = left.updatedAt ?? 0
                let rightUpdatedAt = right.updatedAt ?? 0
                if leftUpdatedAt != rightUpdatedAt {
                    return leftUpdatedAt > rightUpdatedAt
                }

                return (left.id ?? 0) > (right.id ?? 0)
            }

            return right.workoutDate < left.workoutDate
        }
    }

    static func sortBodyWeights(_ entries: [BodyWeightEntry]) -> [BodyWeightEntry] {
        entries.sorted { left, right in
            if left.entryDate == right.entryDate {
                let updatedDiff = (left.updatedAt ?? 0) - (right.updatedAt ?? 0)
                if updatedDiff != 0 {
                    return updatedDiff < 0
                }
                return left.id < right.id
            }
            return left.entryDate < right.entryDate
        }
    }

    static func exercisePickerGroups(
        available: [ExerciseDefinition],
        catalog: [ExerciseDefinition],
        workouts: [Workout],
        draftExercises: [DraftExercise]
    ) -> ExercisePickerGroups {
        guard !available.isEmpty else {
            return ExercisePickerGroups(
                primary: [],
                secondary: [],
                primaryPoolExhausted: false,
                primaryPoolTotal: 0,
                completedPrimaryCount: 0,
                primaryPoolIDs: []
            )
        }

        let stats = exerciseUsageStats(workouts)
        let catalogSource = catalog.isEmpty ? available : catalog
        let rankedCatalog = catalogSource.enumerated().map { index, exercise in
            RankedExercise(
                exercise: exercise,
                count: stats[exercise.id]?.count ?? 0,
                averagePosition: stats[exercise.id]?.averagePosition ?? .infinity,
                latestWorkoutDate: stats[exercise.id]?.latestWorkoutDate ?? "",
                catalogIndex: index
            )
        }

        let rankedByImportance = rankedCatalog.sorted(by: compareByImportance)
        let suggestedPool = rankedByImportance.filter { $0.count > 0 }.prefix(6)
        let primaryPool = suggestedPool.isEmpty ? Array(rankedByImportance.prefix(6)) : Array(suggestedPool)
        var primaryIDs = Set(primaryPool.map { $0.exercise.id })
        let replacement = rankedByImportance.first {
            $0.exercise.id != rareOnlyBenchPressID && !primaryIDs.contains($0.exercise.id)
        }

        if primaryIDs.contains(rareOnlyBenchPressID) {
            primaryIDs.remove(rareOnlyBenchPressID)
            if let replacement {
                primaryIDs.insert(replacement.exercise.id)
            }
        }

        let rankedAvailable = available.enumerated().map { index, exercise in
            RankedExercise(
                exercise: exercise,
                count: stats[exercise.id]?.count ?? 0,
                averagePosition: stats[exercise.id]?.averagePosition ?? .infinity,
                latestWorkoutDate: stats[exercise.id]?.latestWorkoutDate ?? "",
                catalogIndex: index
            )
        }

        let primary = rankedAvailable
            .filter { primaryIDs.contains($0.exercise.id) }
            .sorted(by: comparePrimaryDisplay)
            .map(\.exercise)

        let completedIDs = Set(
            draftExercises
                .filter { !$0.sets.isEmpty }
                .map(\.exerciseID)
        )
        let completedPrimaryCount = primaryIDs.filter { completedIDs.contains($0) }.count

        let secondary = rankedAvailable
            .filter { !primaryIDs.contains($0.exercise.id) }
            .sorted(by: compareSecondaryDisplay)
            .map(\.exercise)

        return ExercisePickerGroups(
            primary: primary,
            secondary: secondary,
            primaryPoolExhausted: !primaryPool.isEmpty && primary.isEmpty && !secondary.isEmpty,
            primaryPoolTotal: primaryIDs.count,
            completedPrimaryCount: completedPrimaryCount,
            primaryPoolIDs: Array(primaryIDs)
        )
    }

    static func draftDisplayCards(
        exercises: [ExerciseDefinition],
        workouts: [Workout],
        draftExercises: [DraftExercise]
    ) -> [DraftDisplayExercise] {
        guard !exercises.isEmpty else {
            return draftExercises.map {
                DraftDisplayExercise(
                    exerciseID: $0.exerciseID,
                    exerciseName: $0.exerciseName,
                    sets: $0.sets,
                    isPreview: false
                )
            }
        }

        let groups = exercisePickerGroups(
            available: exercises,
            catalog: exercises,
            workouts: workouts,
            draftExercises: draftExercises
        )

        guard !groups.primary.isEmpty else {
            return draftExercises.map {
                DraftDisplayExercise(
                    exerciseID: $0.exerciseID,
                    exerciseName: $0.exerciseName,
                    sets: $0.sets,
                    isPreview: false
                )
            }
        }

        let actualByID = Dictionary(uniqueKeysWithValues: draftExercises.map { ($0.exerciseID, $0) })
        var usedActualIDs = Set<Int>()
        var cards: [DraftDisplayExercise] = groups.primary.map { exercise in
            if let actual = actualByID[exercise.id] {
                usedActualIDs.insert(actual.exerciseID)
                return DraftDisplayExercise(
                    exerciseID: actual.exerciseID,
                    exerciseName: actual.exerciseName,
                    sets: actual.sets,
                    isPreview: false
                )
            }

            return DraftDisplayExercise(
                exerciseID: exercise.id,
                exerciseName: exercise.name,
                sets: [],
                isPreview: true
            )
        }

        for actual in draftExercises where !usedActualIDs.contains(actual.exerciseID) {
            cards.append(
                DraftDisplayExercise(
                    exerciseID: actual.exerciseID,
                    exerciseName: actual.exerciseName,
                    sets: actual.sets,
                    isPreview: false
                )
            )
        }

        return cards
    }

    static func availableRareExercises(
        exercises: [ExerciseDefinition],
        workouts: [Workout],
        draftExercises: [DraftExercise]
    ) -> [ExerciseDefinition] {
        let usedIDs = Set(draftExercises.map(\.exerciseID))
        let available = exercises.filter { !usedIDs.contains($0.id) }
        return exercisePickerGroups(
            available: available,
            catalog: exercises,
            workouts: workouts,
            draftExercises: draftExercises
        ).secondary
    }

    static func draftProgressRatio(
        exercises: [ExerciseDefinition],
        workouts: [Workout],
        draftExercises: [DraftExercise],
        editingWorkoutID: Int?
    ) -> Double {
        guard draftExercises.contains(where: { !$0.sets.isEmpty }) else {
            return 0
        }

        let groups = exercisePickerGroups(
            available: exercises,
            catalog: exercises,
            workouts: workouts,
            draftExercises: draftExercises
        )
        guard groups.primaryPoolTotal > 0 else {
            return 0
        }

        let actualByID = Dictionary(uniqueKeysWithValues: draftExercises.map { ($0.exerciseID, $0) })
        let total = groups.primaryPoolIDs.reduce(0.0) { partial, exerciseID in
            let context = planningContext(
                workouts: workouts,
                exerciseID: exerciseID,
                excludeWorkoutID: editingWorkoutID
            )
            let targetCount = max(1, context?.plannedSets.count ?? 0)
            let actualCount = actualByID[exerciseID]?.sets.count ?? 0
            return partial + min(Double(actualCount), Double(targetCount)) / Double(targetCount)
        }

        return max(0, min(1, total / Double(groups.primaryPoolTotal)))
    }

    static func progressExercises(catalog: [ExerciseDefinition], workouts: [Workout]) -> [ExerciseDefinition] {
        var lookup = Dictionary(uniqueKeysWithValues: catalog.map { ($0.id, $0) })
        for workout in sortWorkouts(workouts) {
            for exercise in workout.data.exercises where lookup[exercise.exerciseID] == nil {
                lookup[exercise.exerciseID] = ExerciseDefinition(id: exercise.exerciseID, name: exercise.name)
            }
        }

        var result: [ExerciseDefinition] = []
        for exercise in catalog {
            if let value = lookup.removeValue(forKey: exercise.id) {
                result.append(value)
            }
        }
        result.append(contentsOf: lookup.values.sorted { $0.name.localizedCompare($1.name) == .orderedAscending })
        return result
    }

    static func getWorkoutsInRange(_ workouts: [Workout], range: RangeOption) -> [Workout] {
        let today = Calendar.current.startOfDay(for: Date())
        return workouts
            .map { workout in
                (workout, DateTools.date(from: workout.workoutDate))
            }
            .filter { _, date in
                inRange(date: date, rangeDays: range.days, today: today)
            }
            .sorted { left, right in
                left.1 > right.1
            }
            .map(\.0)
    }

    static func summarizeProgress(workouts: [Workout], range: RangeOption) -> Int {
        getWorkoutsInRange(workouts, range: range).count
    }

    static func buildExerciseProgressSeries(
        workouts: [Workout],
        range: RangeOption,
        exerciseID: Int
    ) -> [ProgressPoint] {
        return Array(getWorkoutsInRange(workouts, range: range)
            .compactMap { workout -> ProgressPoint? in
                guard let exercise = workout.data.exercises.first(where: { $0.exerciseID == exerciseID }),
                      let heaviest = pickHeaviestSet(exercise.sets),
                      let highestReps = pickHighestRepSet(exercise.sets)
                else {
                    return nil
                }

                return ProgressPoint(
                    workoutID: workout.id ?? 0,
                    workoutDate: workout.workoutDate,
                    bestWeight: heaviest.weight,
                    repsAtBestWeight: heaviest.reps,
                    bestReps: highestReps.reps,
                    weightAtBestReps: highestReps.weight
                )
            }
            .reversed())
    }

    static func summarizeExerciseSeries(_ series: [ProgressPoint]) -> ExerciseSeriesSummary? {
        guard let first = series.first, let latest = series.last else {
            return nil
        }

        return ExerciseSeriesSummary(
            firstPoint: first,
            latestPoint: latest,
            weightDelta: latest.bestWeight - first.bestWeight,
            repsDelta: latest.bestReps - first.bestReps
        )
    }

    static func bodyWeightEntriesInRange(_ entries: [BodyWeightEntry], range: RangeOption) -> [BodyWeightEntry] {
        let today = Calendar.current.startOfDay(for: Date())
        return sortBodyWeights(entries)
            .filter { entry in
                inRange(date: DateTools.date(from: entry.entryDate), rangeDays: range.days, today: today)
            }
    }

    static func summarizeBodyWeights(
        filteredEntries: [BodyWeightEntry],
        allEntries: [BodyWeightEntry]
    ) -> BodyWeightSummary {
        let sortedAll = sortBodyWeights(allEntries)
        let sortedFiltered = sortBodyWeights(filteredEntries)
        let latestOverall = sortedAll.last
        let latest = sortedFiltered.last
        let first = sortedFiltered.first

        return BodyWeightSummary(
            totalEntries: sortedFiltered.count,
            latestOverallEntry: latestOverall,
            latestEntry: latest,
            firstEntry: first,
            delta: latest != nil && first != nil ? latest!.weight - first!.weight : 0
        )
    }

    static func planningContext(
        workouts: [Workout],
        exerciseID: Int,
        excludeWorkoutID: Int? = nil
    ) -> ExercisePlanningContext? {
        guard let source = latestExerciseSource(
            workouts: workouts,
            exerciseID: exerciseID,
            excludeWorkoutID: excludeWorkoutID
        ) else {
            return nil
        }

        let previousSets = normalizedExerciseSets(source.exercise.sets, incrementReps: 0)
        guard !previousSets.isEmpty else {
            return nil
        }

        let plannedSets = normalizedExerciseSets(
            previousSets,
            incrementReps: 1,
            preserveNotes: false,
            preserveEffort: false
        )
        .enumerated()
        .map { index, set in
            WorkoutSet(
                setIndex: index + 1,
                reps: set.reps,
                weight: set.weight,
                effort: nil,
                notes: nil
            )
        }

        let previousSummary = summarizeExerciseSets(previousSets)
        let plannedSummary = summarizeExerciseSets(plannedSets)

        return ExercisePlanningContext(
            workoutID: source.workout.id,
            workoutDate: source.workout.workoutDate,
            exerciseName: source.exercise.name,
            previousSets: previousSets,
            plannedSets: plannedSets,
            previousSummary: previousSummary,
            plannedSummary: plannedSummary,
            progressionParts: referenceProgressionParts(previousSummary: previousSummary, plannedSummary: plannedSummary),
            maxWeight: previousSets.map(\.weight).max() ?? 0
        )
    }

    static func plannedSet(
        workouts: [Workout],
        exerciseID: Int,
        draftSetIndex: Int,
        excludeWorkoutID: Int? = nil
    ) -> DraftSet {
        let index = max(0, draftSetIndex)
        guard let context = planningContext(
            workouts: workouts,
            exerciseID: exerciseID,
            excludeWorkoutID: excludeWorkoutID
        ), !context.plannedSets.isEmpty else {
            return DraftSet(reps: 12, weight: 0, effort: nil, notes: nil)
        }

        let template = context.plannedSets[min(index, context.plannedSets.count - 1)]
        return DraftSet(reps: template.reps, weight: template.weight, effort: nil, notes: nil)
    }

    static func summarizeExerciseSets(_ sets: [WorkoutSet]) -> ExerciseSetSummary {
        guard !sets.isEmpty else {
            return ExerciseSetSummary(parts: ["Пока нет сетов"], notes: [], segments: [])
        }

        var grouped: [MutableSummaryGroup] = []
        var current: MutableSummaryGroup?

        for (index, set) in sets.enumerated() {
            let note = set.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if current?.weight == set.weight && current?.effort == set.effort {
                current?.reps.append(set.reps)
                if !note.isEmpty {
                    current?.notes.append(note)
                }
            } else {
                if let current {
                    grouped.append(current)
                }
                current = MutableSummaryGroup(
                    weight: set.weight,
                    reps: [set.reps],
                    effort: set.effort,
                    notes: note.isEmpty ? [] : [note],
                    editSetIndex: index
                )
            }
        }

        if let current {
            grouped.append(current)
        }

        let segments = grouped.map { group in
            let base = "\(formatWeight(group.weight))кг ×\(summarizeRepRuns(group.reps))"
            return ExerciseSetSummarySegment(
                label: base,
                editSetIndex: group.editSetIndex,
                effort: group.effort,
                notes: group.notes,
                weight: group.weight,
                reps: group.reps
            )
        }

        return ExerciseSetSummary(
            parts: segments.map { segment in
                segment.effort == nil ? segment.label : "\(segment.label) \(segment.effort!.icon)"
            },
            notes: sets.compactMap { $0.notes?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfBlank },
            segments: segments
        )
    }

    static func summarizeDraftSets(_ sets: [DraftSet]) -> ExerciseSetSummary {
        summarizeExerciseSets(
            sets.enumerated().map { index, set in
                set.asWorkoutSet(index: index + 1)
            }
        )
    }

    static func inferLoadType(_ draftExercises: [DraftExercise]) -> String {
        let totalVolume = draftExercises.reduce(0.0) { exerciseTotal, exercise in
            exerciseTotal + exercise.sets.reduce(0.0) { setTotal, set in
                set.weight > 0 && set.reps > 0 ? setTotal + set.weight * Double(set.reps) : setTotal
            }
        }

        if totalVolume >= 3000 {
            return "heavy"
        }
        if totalVolume >= 1600 {
            return "medium"
        }
        return "light"
    }

    static func workoutPayload(from draft: DraftWorkout) -> Workout {
        let exercises = draft.exercises
            .filter { !$0.sets.isEmpty }
            .map { exercise in
                LoggedExercise(
                    exerciseID: exercise.exerciseID,
                    name: exercise.exerciseName,
                    sets: exercise.sets.enumerated().map { index, set in
                        set.asWorkoutSet(index: index + 1)
                    }
                )
            }

        return Workout(
            id: draft.editingWorkoutID,
            clientID: draft.editingClientID ?? "workout-\(Int(Date().timeIntervalSince1970 * 1000))",
            workoutDate: draft.workoutDate,
            planID: nil,
            createdAt: nil,
            updatedAt: nil,
            data: WorkoutData(
                focus: nil,
                notes: nil,
                loadType: inferLoadType(draft.exercises),
                exercises: exercises
            )
        )
    }

    static func formatWeight(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.minimumFractionDigits = value.rounded() == value ? 0 : 1
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    static func formatBodyWeight(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 20
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    static func formatBodyWeightInput(_ value: Double) -> String {
        value.rounded() == value
            ? String(Int(value))
            : String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    static func normalizeBodyWeightInput(_ value: String) -> String {
        let raw = value
            .filter { $0.isNumber || $0 == "." || $0 == "," }
            .map { $0 == "," ? "." : $0 }
        let text = String(raw)
        guard !text.isEmpty else { return "" }
        guard let firstDot = text.firstIndex(of: ".") else { return text }
        let integer = String(text[..<firstDot])
        let fractionStart = text.index(after: firstDot)
        let fraction = text[fractionStart...].filter { $0 != "." }
        if fraction.isEmpty && text.hasSuffix(".") {
            return "\(integer.isEmpty ? "0" : integer)."
        }
        return "\(integer.isEmpty ? "0" : integer).\(fraction)"
    }

    static func formatSignedWeight(_ value: Double) -> String {
        "\(value > 0 ? "+" : "")\(formatWeight(value)) кг"
    }

    static func formatSignedBodyWeight(_ value: Double) -> String {
        "\(value > 0 ? "+" : "")\(formatWeight(value)) кг"
    }

    static func formatSignedReps(_ value: Int) -> String {
        "\(value > 0 ? "+" : "")\(value) повт."
    }

    private static func latestExerciseSource(
        workouts: [Workout],
        exerciseID: Int,
        excludeWorkoutID: Int?
    ) -> (workout: Workout, exercise: LoggedExercise)? {
        for workout in sortWorkouts(workouts) {
            if let excludeWorkoutID, workout.id == excludeWorkoutID {
                continue
            }

            if let exercise = workout.data.exercises.first(where: { $0.exerciseID == exerciseID }),
               !exercise.sets.isEmpty {
                return (workout, exercise)
            }
        }

        return nil
    }

    private static func normalizedExerciseSets(
        _ sets: [WorkoutSet],
        incrementReps: Int,
        preserveNotes: Bool = true,
        preserveEffort: Bool = true
    ) -> [WorkoutSet] {
        sets.enumerated().compactMap { index, set in
            let reps = max(1, set.reps + incrementReps)
            guard reps > 0 else { return nil }
            return WorkoutSet(
                setIndex: (set.setIndex ?? 0) > 0 ? set.setIndex : index + 1,
                reps: reps,
                weight: max(0, set.weight),
                effort: preserveEffort ? set.effort : nil,
                notes: preserveNotes ? set.notes?.nilIfBlank : nil
            )
        }
    }

    private static func referenceProgressionParts(
        previousSummary: ExerciseSetSummary,
        plannedSummary: ExerciseSetSummary
    ) -> [ReferenceProgressionPart] {
        previousSummary.segments.enumerated().map { index, segment in
            let nextSegment = index < plannedSummary.segments.count ? plannedSummary.segments[index] : nil
            let nextReps = nextSegment?.reps.isEmpty == false
                ? nextSegment!.reps
                : segment.reps.map { max(1, $0 + 1) }

            return ReferenceProgressionPart(
                previousLabel: "\(formatWeight(segment.weight))кг ×\(summarizeRepRuns(segment.reps))",
                nextLabel: summarizeRepRuns(nextReps),
                previousEffort: segment.effort
            )
        }
    }

    private static func summarizeRepRuns(_ reps: [Int]) -> String {
        guard let first = reps.first else {
            return "0"
        }

        var parts: [String] = []
        var current = first
        var count = 1

        for rep in reps.dropFirst() {
            if rep == current {
                count += 1
            } else {
                parts.append(count > 1 ? "\(current)×\(count)" : "\(current)")
                current = rep
                count = 1
            }
        }

        parts.append(count > 1 ? "\(current)×\(count)" : "\(current)")
        return parts.joined(separator: ", ")
    }

    private static func pickHeaviestSet(_ sets: [WorkoutSet]) -> WorkoutSet? {
        sets.max { left, right in
            if left.weight != right.weight {
                return left.weight < right.weight
            }
            if left.reps != right.reps {
                return left.reps < right.reps
            }
            return (left.setIndex ?? 0) < (right.setIndex ?? 0)
        }
    }

    private static func pickHighestRepSet(_ sets: [WorkoutSet]) -> WorkoutSet? {
        sets.max { left, right in
            if left.reps != right.reps {
                return left.reps < right.reps
            }
            if left.weight != right.weight {
                return left.weight < right.weight
            }
            return (left.setIndex ?? 0) < (right.setIndex ?? 0)
        }
    }

    private static func inRange(date: Date, rangeDays: Int?, today: Date) -> Bool {
        guard let rangeDays else {
            return true
        }

        let calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -(rangeDays - 1), to: today) ?? today
        let target = calendar.startOfDay(for: date)
        return target >= start && target <= today
    }

    private static func exerciseUsageStats(_ workouts: [Workout]) -> [Int: ExerciseUsageStat] {
        var stats: [Int: ExerciseUsageStat] = [:]
        for workout in sortWorkouts(workouts) {
            for (index, exercise) in workout.data.exercises.enumerated() {
                var current = stats[exercise.exerciseID] ?? ExerciseUsageStat()
                current.count += 1
                current.totalPosition += index
                if current.latestWorkoutDate.isEmpty || workout.workoutDate > current.latestWorkoutDate {
                    current.latestWorkoutDate = workout.workoutDate
                }
                stats[exercise.exerciseID] = current
            }
        }

        for (exerciseID, value) in stats {
            var next = value
            next.averagePosition = value.count > 0 ? Double(value.totalPosition) / Double(value.count) : .infinity
            stats[exerciseID] = next
        }
        return stats
    }

    private static func compareByImportance(_ left: RankedExercise, _ right: RankedExercise) -> Bool {
        if left.count != right.count {
            return left.count > right.count
        }
        if left.latestWorkoutDate != right.latestWorkoutDate {
            return left.latestWorkoutDate > right.latestWorkoutDate
        }
        if left.averagePosition != right.averagePosition {
            return left.averagePosition < right.averagePosition
        }
        return left.catalogIndex < right.catalogIndex
    }

    private static func comparePrimaryDisplay(_ left: RankedExercise, _ right: RankedExercise) -> Bool {
        if left.averagePosition != right.averagePosition {
            return left.averagePosition < right.averagePosition
        }
        if left.count != right.count {
            return left.count > right.count
        }
        if left.latestWorkoutDate != right.latestWorkoutDate {
            return left.latestWorkoutDate > right.latestWorkoutDate
        }
        return left.catalogIndex < right.catalogIndex
    }

    private static func compareSecondaryDisplay(_ left: RankedExercise, _ right: RankedExercise) -> Bool {
        if left.count != right.count {
            return left.count > right.count
        }
        if left.latestWorkoutDate != right.latestWorkoutDate {
            return left.latestWorkoutDate > right.latestWorkoutDate
        }
        return left.exercise.name.localizedCompare(right.exercise.name) == .orderedAscending
    }
}

private struct ExerciseUsageStat {
    var count: Int = 0
    var totalPosition: Int = 0
    var averagePosition: Double = .infinity
    var latestWorkoutDate: String = ""
}

private struct RankedExercise {
    var exercise: ExerciseDefinition
    var count: Int
    var averagePosition: Double
    var latestWorkoutDate: String
    var catalogIndex: Int
}

private struct MutableSummaryGroup {
    var weight: Double
    var reps: [Int]
    var effort: SetEffort?
    var notes: [String]
    var editSetIndex: Int
}
