import Foundation
import SwiftUI

@MainActor
final class TrainerStore: ObservableObject {
    @Published var bootState: BootState = .idle
    @Published var currentTab: TrainerTab {
        didSet { defaults.set(currentTab.rawValue, forKey: Keys.currentTab) }
    }
    @Published var selectedRange: RangeOption {
        didSet { defaults.set(selectedRange.rawValue, forKey: Keys.progressRange) }
    }
    @Published var selectedBodyWeightRange: RangeOption {
        didSet { defaults.set(selectedBodyWeightRange.rawValue, forKey: Keys.bodyWeightRange) }
    }
    @Published var selectedProgressExerciseID: Int? {
        didSet {
            if let selectedProgressExerciseID {
                defaults.set(selectedProgressExerciseID, forKey: Keys.progressExercise)
            } else {
                defaults.removeObject(forKey: Keys.progressExercise)
            }
        }
    }
    @Published var apiBaseURLString: String {
        didSet { defaults.set(apiBaseURLString, forKey: Keys.apiBaseURL) }
    }

    @Published var currentUser: TrainerUser?
    @Published var exercises: [ExerciseDefinition] = []
    @Published var workouts: [Workout] = []
    @Published var bodyWeightEntries: [BodyWeightEntry] = []
    @Published var draft: DraftWorkout {
        didSet { persistDraft() }
    }

    @Published var isWorkoutBuilderPresented = false
    @Published var isSavingWorkout = false
    @Published var isSavingBodyWeight = false
    @Published var bodyWeightDate: String
    @Published var bodyWeightValue: String = ""
    @Published var toast: String?

    private let defaults: UserDefaults
    private var toastTask: Task<Void, Never>?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.currentTab = TrainerTab(rawValue: defaults.string(forKey: Keys.currentTab) ?? "") ?? .trainings
        self.selectedRange = RangeOption(rawValue: defaults.string(forKey: Keys.progressRange) ?? "") ?? .days30
        self.selectedBodyWeightRange = RangeOption(rawValue: defaults.string(forKey: Keys.bodyWeightRange) ?? "") ?? .days30
        self.selectedProgressExerciseID = defaults.object(forKey: Keys.progressExercise) as? Int
        self.apiBaseURLString = Self.normalizedBackendURL(defaults.string(forKey: Keys.apiBaseURL))
        self.draft = Self.readDraft(defaults: defaults)
        self.bodyWeightDate = DateTools.localTodayISO()
    }

    func boot() async {
        guard bootState == .idle else { return }
        bootState = .loading
        await reload(showSuccess: false)
    }

    func reload(showSuccess: Bool = true) async {
        // Cap the whole boot at 3 seconds. The splash/loading screen sits on
        // top of this; URLSession's default request timeout is 60s which feels
        // like a hang on flaky networks. After 3s we cancel the in-flight
        // work, drop into the error screen, and let the user retry.
        let baseURL = apiBaseURLString
        let workTask = Task<Void, Error> { [weak self] in
            guard let self else { return }
            let client = APIClient(baseURLString: baseURL)
            let session = try await client.resolveSession()
            try await self.loadAuthenticatedData(
                client: client,
                session: session,
                showSuccess: showSuccess
            )
        }
        let deadlineTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            workTask.cancel()
        }

        do {
            try await workTask.value
            deadlineTask.cancel()
        } catch {
            deadlineTask.cancel()
            // A cancellation that beat the work means we ran out of time.
            let isTimeout = workTask.isCancelled
                || error is CancellationError
                || (error as? URLError)?.code == .cancelled
            if isTimeout {
                handleLoadError(TrainerAPIError.timeout)
            } else {
                handleLoadError(error)
            }
        }
    }

    func reconnect() async {
        bootState = .loading
        await reload(showSuccess: true)
    }

    func signOut() async {
        do {
            _ = try await APIClient(baseURLString: apiBaseURLString).logout()
        } catch {
            showToast(error.localizedDescription)
        }

        currentUser = nil
        workouts = []
        bodyWeightEntries = []
        bootState = .needsSignIn(nil)
    }

    func showToast(_ message: String) {
        toast = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            await MainActor.run {
                if self?.toast == message {
                    self?.toast = nil
                }
            }
        }
    }

    func openNewWorkout() {
        if !draft.hasAnyExercise && draft.editingWorkoutID == nil {
            draft.workoutDate = DateTools.localTodayISO()
        }
        isWorkoutBuilderPresented = true
    }

    func closeBuilder() {
        isWorkoutBuilderPresented = false
    }

    func resetDraft() {
        draft = .empty
    }

    func setDraftDate(_ date: Date) {
        draft.workoutDate = DateTools.iso(from: date)
    }

    func setBodyWeightDate(_ date: Date) {
        bodyWeightDate = DateTools.iso(from: date)
        syncBodyWeightComposer()
    }

    func setBodyWeightValue(_ value: String) {
        bodyWeightValue = TrainerLogic.normalizeBodyWeightInput(value)
    }

    func syncBodyWeightComposer(preserveValue: Bool = false) {
        guard !preserveValue else { return }
        if let existing = bodyWeightEntries.first(where: { $0.entryDate == bodyWeightDate }) {
            bodyWeightValue = TrainerLogic.formatBodyWeightInput(existing.weight)
            return
        }

        if let latest = bodyWeightEntries.last {
            bodyWeightValue = TrainerLogic.formatBodyWeightInput(latest.weight)
        } else {
            bodyWeightValue = ""
        }
    }

    func saveBodyWeight() async {
        let normalized = bodyWeightValue.replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value > 0 else {
            showToast("Введи корректный вес тела")
            return
        }

        isSavingBodyWeight = true
        defer { isSavingBodyWeight = false }

        do {
            let response = try await APIClient(baseURLString: apiBaseURLString)
                .saveBodyWeight(entryDate: bodyWeightDate, weight: value)
            currentUser = response.user ?? currentUser
            bodyWeightEntries.removeAll { $0.entryDate == response.entry.entryDate }
            bodyWeightEntries.append(response.entry)
            bodyWeightEntries = TrainerLogic.sortBodyWeights(bodyWeightEntries)
            syncBodyWeightComposer()
            showToast(response.created == true ? "Вес тела сохранён" : "Вес тела обновлён")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    func deleteBodyWeight(_ entry: BodyWeightEntry) async {
        do {
            let response = try await APIClient(baseURLString: apiBaseURLString)
                .deleteBodyWeight(id: entry.id)
            currentUser = response.user ?? currentUser
            bodyWeightEntries.removeAll { $0.id == entry.id }
            syncBodyWeightComposer()
            showToast("Запись веса удалена")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    func startEditing(_ workout: Workout) {
        draft = DraftWorkout(
            workoutDate: workout.workoutDate,
            exercises: workout.data.exercises.map { exercise in
                DraftExercise(
                    exerciseID: exercise.exerciseID,
                    exerciseName: exercise.name,
                    sets: exercise.sets.map {
                        DraftSet(reps: $0.reps, weight: $0.weight, effort: $0.effort, notes: $0.notes)
                    }
                )
            },
            editingWorkoutID: workout.id,
            editingClientID: workout.clientID ?? workout.id.map { "workout-\($0)" }
        )
        isWorkoutBuilderPresented = true
        showToast("Тренировка открыта для редактирования")
    }

    func deleteWorkout(_ workout: Workout) async {
        guard let id = workout.id else { return }
        do {
            let response = try await APIClient(baseURLString: apiBaseURLString).deleteWorkout(id: id)
            currentUser = response.user ?? currentUser
            workouts.removeAll { $0.id == id }
            if draft.editingWorkoutID == id {
                resetDraft()
            }
            ensureSelectedProgressExercise()
            showToast("Тренировка удалена")
        } catch {
            showToast(error.localizedDescription)
        }
    }

    func saveDraftWorkout() async {
        let payload = TrainerLogic.workoutPayload(from: draft)
        guard !payload.data.exercises.isEmpty else {
            showToast("Добавь хотя бы одно упражнение")
            return
        }

        isSavingWorkout = true
        defer { isSavingWorkout = false }

        do {
            let client = APIClient(baseURLString: apiBaseURLString)
            let response: WorkoutMutationResponse
            if let editingID = draft.editingWorkoutID {
                response = try await client.updateWorkout(id: editingID, workout: payload)
                showToast("Изменения в тренировке сохранены")
            } else {
                response = try await client.saveWorkout(payload)
                showToast(currentUser?.isDefaultDebugUser == true
                          ? "Тренировка сохранена для debug-user"
                          : "Тренировка сохранена")
            }

            currentUser = response.user ?? currentUser
            workouts.removeAll { $0.id == response.workout.id }
            workouts.append(response.workout)
            workouts = TrainerLogic.sortWorkouts(workouts)
            resetDraft()
            isWorkoutBuilderPresented = false
            ensureSelectedProgressExercise()
        } catch {
            showToast(error.localizedDescription)
        }
    }

    func addPlannedSet(exerciseID: Int) {
        guard let exercise = exerciseDefinition(id: exerciseID) else { return }
        let currentSets = draft.exercises.first(where: { $0.exerciseID == exerciseID })?.sets.count ?? 0
        let planned = TrainerLogic.plannedSet(
            workouts: workouts,
            exerciseID: exerciseID,
            draftSetIndex: currentSets,
            excludeWorkoutID: draft.editingWorkoutID
        )
        addSet(planned, to: exercise)
    }

    func applySet(_ set: DraftSet, exerciseID: Int, setIndex: Int?) {
        guard let exercise = exerciseDefinition(id: exerciseID) else { return }
        if let setIndex {
            updateSet(set, exerciseID: exerciseID, setIndex: setIndex)
        } else {
            addSet(set, to: exercise)
        }
    }

    func removeLastSet(exerciseID: Int) {
        guard let index = draft.exercises.firstIndex(where: { $0.exerciseID == exerciseID }),
              !draft.exercises[index].sets.isEmpty else {
            return
        }

        draft.exercises[index].sets.removeLast()
        if draft.exercises[index].sets.isEmpty {
            draft.exercises.remove(at: index)
        }
    }

    func removeExercise(exerciseID: Int) {
        draft.exercises.removeAll { $0.exerciseID == exerciseID }
    }

    func displayCards() -> [DraftDisplayExercise] {
        TrainerLogic.draftDisplayCards(
            exercises: exercises,
            workouts: workouts,
            draftExercises: draft.exercises
        )
    }

    func rareExercises() -> [ExerciseDefinition] {
        TrainerLogic.availableRareExercises(
            exercises: exercises,
            workouts: workouts,
            draftExercises: draft.exercises
        )
    }

    func exerciseGroups() -> ExercisePickerGroups {
        TrainerLogic.exercisePickerGroups(
            available: exercises,
            catalog: exercises,
            workouts: workouts,
            draftExercises: draft.exercises
        )
    }

    func draftProgressRatio() -> Double {
        TrainerLogic.draftProgressRatio(
            exercises: exercises,
            workouts: workouts,
            draftExercises: draft.exercises,
            editingWorkoutID: draft.editingWorkoutID
        )
    }

    func planningContext(for exerciseID: Int) -> ExercisePlanningContext? {
        TrainerLogic.planningContext(
            workouts: workouts,
            exerciseID: exerciseID,
            excludeWorkoutID: draft.editingWorkoutID
        )
    }

    func plannedSetForEditor(exerciseID: Int) -> DraftSet {
        let currentSets = draft.exercises.first(where: { $0.exerciseID == exerciseID })?.sets.count ?? 0
        return TrainerLogic.plannedSet(
            workouts: workouts,
            exerciseID: exerciseID,
            draftSetIndex: currentSets,
            excludeWorkoutID: draft.editingWorkoutID
        )
    }

    func exerciseDefinition(id: Int) -> ExerciseDefinition? {
        exercises.first { $0.id == id }
    }

    func progressExerciseOptions() -> [ExerciseDefinition] {
        TrainerLogic.progressExercises(catalog: exercises, workouts: workouts)
    }

    func progressSeries() -> [ProgressPoint] {
        guard let selectedProgressExerciseID else { return [] }
        return TrainerLogic.buildExerciseProgressSeries(
            workouts: workouts,
            range: selectedRange,
            exerciseID: selectedProgressExerciseID
        )
    }

    func bodyWeightEntriesForSelectedRange() -> [BodyWeightEntry] {
        TrainerLogic.bodyWeightEntriesInRange(bodyWeightEntries, range: selectedBodyWeightRange)
    }

    func bodyWeightSummary() -> BodyWeightSummary {
        TrainerLogic.summarizeBodyWeights(
            filteredEntries: bodyWeightEntriesForSelectedRange(),
            allEntries: bodyWeightEntries
        )
    }

    private func loadAuthenticatedData(
        client: APIClient,
        session: SessionResolveResponse,
        showSuccess: Bool
    ) async throws {
        async let exerciseResponse = client.fetchExercises()
        async let workoutsResponse = client.fetchWorkouts()
        async let weightsResponse = client.fetchBodyWeights()

        let (exercisePayload, workoutPayload, weightPayload) = try await (
            exerciseResponse,
            workoutsResponse,
            weightsResponse
        )

        currentUser = workoutPayload.user ?? weightPayload.user ?? session.user ?? currentUser
        exercises = exercisePayload.exercises
        workouts = TrainerLogic.sortWorkouts(workoutPayload.workouts)
        bodyWeightEntries = TrainerLogic.sortBodyWeights(weightPayload.entries)
        ensureSelectedProgressExercise()
        ensureDraftExerciseDefinitions()
        syncBodyWeightComposer()
        bootState = .loaded
        if showSuccess {
            showToast("Данные обновлены")
        }
    }

    private func handleLoadError(_ error: Error) {
        let message = error.localizedDescription
        if (error as? TrainerAPIError)?.statusCode == 401 {
            bootState = .needsSignIn(message)
        } else {
            bootState = .failed(message)
        }
        showToast(message)
    }

    private func addSet(_ set: DraftSet, to exercise: ExerciseDefinition) {
        if let index = draft.exercises.firstIndex(where: { $0.exerciseID == exercise.id }) {
            draft.exercises[index].sets.append(set)
        } else {
            draft.exercises.append(
                DraftExercise(
                    exerciseID: exercise.id,
                    exerciseName: exercise.name,
                    sets: [set]
                )
            )
        }
    }

    private func updateSet(_ set: DraftSet, exerciseID: Int, setIndex: Int) {
        guard let exerciseIndex = draft.exercises.firstIndex(where: { $0.exerciseID == exerciseID }),
              draft.exercises[exerciseIndex].sets.indices.contains(setIndex) else {
            return
        }
        draft.exercises[exerciseIndex].sets[setIndex] = set
    }

    private func ensureSelectedProgressExercise() {
        let options = progressExerciseOptions()
        guard !options.isEmpty else {
            selectedProgressExerciseID = nil
            return
        }

        if let selectedProgressExerciseID,
           options.contains(where: { $0.id == selectedProgressExerciseID }) {
            return
        }

        selectedProgressExerciseID = options[0].id
    }

    private func ensureDraftExerciseDefinitions() {
        guard !exercises.isEmpty else { return }
        draft.exercises = draft.exercises.compactMap { draftExercise in
            guard let definition = exerciseDefinition(id: draftExercise.exerciseID) else {
                return nil
            }
            return DraftExercise(
                exerciseID: draftExercise.exerciseID,
                exerciseName: definition.name,
                sets: draftExercise.sets
            )
        }
    }

    private func persistDraft() {
        if !draft.hasAnyExercise && draft.editingWorkoutID == nil {
            defaults.removeObject(forKey: Keys.draft)
            return
        }

        if let data = try? JSONEncoder().encode(draft) {
            defaults.set(data, forKey: Keys.draft)
        }
    }

    private static func readDraft(defaults: UserDefaults) -> DraftWorkout {
        guard let data = defaults.data(forKey: Keys.draft),
              let draft = try? JSONDecoder().decode(DraftWorkout.self, from: data) else {
            return .empty
        }
        return draft
    }

    private static func normalizedBackendURL(_ storedURL: String?) -> String {
        let localDevelopmentURL = "http://127.0.0.1:8080"
        let localHostURL = "http://localhost:8080"
        let legacyProductionURL = "https://trainer.89.124.83.32.nip.io:8443"
        let productionURL = "https://trainer.superbatonec.org"
        var value = storedURL?.trimmingCharacters(in: .whitespacesAndNewlines)
        while value?.hasSuffix("/") == true {
            value?.removeLast()
        }
        guard let value, !value.isEmpty,
              value != localDevelopmentURL,
              value != localHostURL,
              value != legacyProductionURL else {
            return productionURL
        }
        return value
    }
}

private enum Keys {
    static let apiBaseURL = "trainer-ios-api-base-url-v1"
    static let draft = "trainer-ios-draft-v1"
    static let currentTab = "trainer-ios-tab-v1"
    static let progressRange = "trainer-ios-progress-range-v1"
    static let bodyWeightRange = "trainer-ios-body-weight-range-v1"
    static let progressExercise = "trainer-ios-progress-exercise-v1"
}
