import XCTest
@testable import TrainerIOS

@MainActor
final class TrainerStoreTests: XCTestCase {
    func testStoreDefaultsMatchREADMEInitialState() {
        let store = TrainerStore(defaults: .isolatedTestDefaults())

        XCTAssertEqual(store.currentTab, .trainings)
        XCTAssertEqual(store.selectedRange, .days30)
        XCTAssertEqual(store.selectedBodyWeightRange, .days30)
        XCTAssertEqual(store.apiBaseURLString, "https://trainer.superbatonec.org")
        XCTAssertFalse(store.draft.hasAnyExercise)
        XCTAssertFalse(store.isWorkoutBuilderPresented)
    }

    func testStoreMigratesLegacyLocalBackendURLToProduction() {
        let defaults = UserDefaults.isolatedTestDefaults()
        defaults.set("http://127.0.0.1:8080/", forKey: "trainer-ios-api-base-url-v1")

        let store = TrainerStore(defaults: defaults)

        XCTAssertEqual(store.apiBaseURLString, "https://trainer.superbatonec.org")
    }

    func testAddPlannedSetCreatesRealDraftAndPersistsAcrossStoreInstances() {
        let defaults = UserDefaults.isolatedTestDefaults()
        let store = TrainerStore(defaults: defaults)
        store.exercises = TestFixtures.catalog
        store.workouts = [
            TestFixtures.workout(
                exercises: [
                    TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                        TestFixtures.set(index: 1, reps: 15, weight: 80, effort: .hard)
                    ])
                ]
            )
        ]

        store.addPlannedSet(exerciseID: 8)
        let restored = TrainerStore(defaults: defaults)

        XCTAssertTrue(store.draft.hasRealSets)
        XCTAssertEqual(store.draft.exercises.first?.sets.first?.reps, 16)
        XCTAssertEqual(store.draft.exercises.first?.sets.first?.weight, 80)
        XCTAssertNil(store.draft.exercises.first?.sets.first?.effort)
        XCTAssertEqual(restored.draft.exercises.first?.exerciseName, "Жим ногами")
        XCTAssertEqual(restored.draft.exercises.first?.sets.first?.reps, 16)
    }

    func testApplySetCanEditLatestSetAndRemoveLastSetDropsEmptyExercise() {
        let store = configuredStore()

        store.applySet(TestFixtures.draftSet(reps: 12, weight: 70), exerciseID: 8, setIndex: nil)
        store.applySet(TestFixtures.draftSet(reps: 13, weight: 75, effort: .ok), exerciseID: 8, setIndex: nil)
        store.applySet(TestFixtures.draftSet(reps: 11, weight: 77.5, effort: .hard), exerciseID: 8, setIndex: 1)

        XCTAssertEqual(store.draft.exercises.first?.sets.map(\.reps), [12, 11])
        XCTAssertEqual(store.draft.exercises.first?.sets.last?.weight, 77.5)
        XCTAssertEqual(store.draft.exercises.first?.sets.last?.effort, .hard)

        store.removeLastSet(exerciseID: 8)
        store.removeLastSet(exerciseID: 8)

        XCTAssertTrue(store.draft.exercises.isEmpty)
        XCTAssertFalse(store.draft.hasRealSets)
    }

    func testResetDraftClearsPersistedDraft() {
        let defaults = UserDefaults.isolatedTestDefaults()
        let store = configuredStore(defaults: defaults)

        store.addPlannedSet(exerciseID: 8)
        XCTAssertTrue(TrainerStore(defaults: defaults).draft.hasRealSets)

        store.resetDraft()

        XCTAssertFalse(store.draft.hasAnyExercise)
        XCTAssertFalse(TrainerStore(defaults: defaults).draft.hasAnyExercise)
    }

    func testStartEditingPreservesServerIDClientIDDateAndSets() {
        let store = configuredStore()
        let workout = TestFixtures.workout(
            id: 77,
            clientID: "editable-client",
            date: "2026-05-03",
            exercises: [
                TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                    TestFixtures.set(index: 1, reps: 12, weight: 90, effort: .easy)
                ])
            ]
        )

        store.startEditing(workout)

        XCTAssertTrue(store.isWorkoutBuilderPresented)
        XCTAssertEqual(store.draft.editingWorkoutID, 77)
        XCTAssertEqual(store.draft.editingClientID, "editable-client")
        XCTAssertEqual(store.draft.workoutDate, "2026-05-03")
        XCTAssertEqual(store.draft.exercises.first?.sets.first?.effort, .easy)
    }

    func testBodyWeightComposerPrefillsExistingSelectedDateThenLatestOverall() {
        let store = configuredStore()
        store.bodyWeightEntries = TrainerLogic.sortBodyWeights([
            TestFixtures.bodyWeight(id: 1, date: "2026-05-01", weight: 82.4),
            TestFixtures.bodyWeight(id: 2, date: "2026-05-03", weight: 81.9)
        ])

        store.bodyWeightDate = "2026-05-01"
        store.syncBodyWeightComposer()
        XCTAssertEqual(store.bodyWeightValue, "82.4")

        store.bodyWeightDate = "2026-05-02"
        store.syncBodyWeightComposer()
        XCTAssertEqual(store.bodyWeightValue, "81.9")

        store.setBodyWeightValue("82,45 кг")
        XCTAssertEqual(store.bodyWeightValue, "82.45")
    }

    func testSelectedProgressExerciseFallsBackToRealHistoryAndPersists() {
        let defaults = UserDefaults.isolatedTestDefaults()
        let store = TrainerStore(defaults: defaults)
        store.exercises = []
        store.workouts = [
            TestFixtures.workout(
                exercises: [
                    TestFixtures.exercise(id: 777, name: "История", sets: [TestFixtures.set()])
                ]
            )
        ]

        XCTAssertEqual(store.progressExerciseOptions().map(\.name), ["История"])
        store.selectedProgressExerciseID = 777

        let restored = TrainerStore(defaults: defaults)
        XCTAssertEqual(restored.selectedProgressExerciseID, 777)
    }

    private func configuredStore(defaults: UserDefaults = .isolatedTestDefaults()) -> TrainerStore {
        let store = TrainerStore(defaults: defaults)
        store.exercises = TestFixtures.catalog
        store.workouts = [
            TestFixtures.workout(
                exercises: [
                    TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                        TestFixtures.set(index: 1, reps: 15, weight: 80)
                    ])
                ]
            )
        ]
        return store
    }
}
