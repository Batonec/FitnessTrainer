import XCTest
@testable import TrainerIOS

final class TrainerLogicTests: XCTestCase {
    func testSortWorkoutsUsesDateCreatedUpdatedAndIDFreshness() {
        let old = TestFixtures.workout(
            id: 1,
            date: "2026-05-01",
            createdAt: 100,
            updatedAt: 100,
            exercises: [TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [TestFixtures.set()])]
        )
        let newestSameDay = TestFixtures.workout(
            id: 4,
            date: "2026-05-03",
            createdAt: 100,
            updatedAt: 300,
            exercises: [TestFixtures.exercise(id: 12, name: "Трицепс", sets: [TestFixtures.set()])]
        )
        let createdLaterSameDay = TestFixtures.workout(
            id: 3,
            date: "2026-05-03",
            createdAt: 200,
            updatedAt: 100,
            exercises: [TestFixtures.exercise(id: 11, name: "Бицепс", sets: [TestFixtures.set()])]
        )
        let newerDate = TestFixtures.workout(
            id: 2,
            date: "2026-05-04",
            createdAt: 1,
            updatedAt: 1,
            exercises: [TestFixtures.exercise(id: 9, name: "Тяга верт.", sets: [TestFixtures.set()])]
        )

        let sorted = TrainerLogic.sortWorkouts([old, newestSameDay, newerDate, createdLaterSameDay])

        XCTAssertEqual(sorted.compactMap(\.id), [2, 3, 4, 1])
    }

    func testSummaryGroupsConsecutiveSameWeightWithEffortAndRepRuns() {
        let summary = TrainerLogic.summarizeExerciseSets([
            TestFixtures.set(index: 1, reps: 14, weight: 60, effort: .easy),
            TestFixtures.set(index: 2, reps: 14, weight: 60, effort: .easy),
            TestFixtures.set(index: 3, reps: 13, weight: 60, effort: .easy, notes: "steady"),
            TestFixtures.set(index: 4, reps: 12, weight: 90, effort: .hard)
        ])

        XCTAssertEqual(summary.parts, ["60кг ×14×2, 13 🙂", "90кг ×12 😣"])
        XCTAssertEqual(summary.notes, ["steady"])
        XCTAssertEqual(summary.segments.map(\.editSetIndex), [0, 3])
    }

    func testPlanningContextUsesLatestExerciseAndBuildsPlusOnePlanWithoutCopyingEffortOrNotes() {
        let older = TestFixtures.workout(
            id: 1,
            date: "2026-05-01",
            exercises: [
                TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                    TestFixtures.set(index: 1, reps: 10, weight: 70)
                ])
            ]
        )
        let latest = TestFixtures.workout(
            id: 2,
            date: "2026-05-04",
            exercises: [
                TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                    TestFixtures.set(index: 1, reps: 15, weight: 80, effort: .hard, notes: "last"),
                    TestFixtures.set(index: 2, reps: 13, weight: 90, effort: .ok)
                ])
            ]
        )

        let context = TrainerLogic.planningContext(workouts: [older, latest], exerciseID: 8)

        XCTAssertEqual(context?.workoutID, 2)
        XCTAssertEqual(context?.previousSummary.parts, ["80кг ×15 😣", "90кг ×13 😐"])
        XCTAssertEqual(context?.plannedSets.map(\.reps), [16, 14])
        XCTAssertEqual(context?.plannedSets.map(\.weight), [80, 90])
        XCTAssertEqual(context?.plannedSets.map(\.effort), [nil, nil])
        XCTAssertEqual(context?.plannedSets.map(\.notes), [nil, nil])
        XCTAssertEqual(context?.progressionParts.map(\.previousEffort), [.hard, .ok])
        XCTAssertEqual(context?.progressionParts.map(\.nextLabel), ["16", "14"])
    }

    func testPlannedSetFallsBackAndThenAdvancesThroughLatestPlanSequence() {
        let workout = TestFixtures.workout(
            exercises: [
                TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                    TestFixtures.set(index: 1, reps: 15, weight: 80),
                    TestFixtures.set(index: 2, reps: 13, weight: 90),
                    TestFixtures.set(index: 3, reps: 12, weight: 90)
                ])
            ]
        )

        let first = TrainerLogic.plannedSet(workouts: [workout], exerciseID: 8, draftSetIndex: 0)
        let second = TrainerLogic.plannedSet(workouts: [workout], exerciseID: 8, draftSetIndex: 1)
        let third = TrainerLogic.plannedSet(workouts: [workout], exerciseID: 8, draftSetIndex: 2)
        let beyondPlan = TrainerLogic.plannedSet(workouts: [workout], exerciseID: 8, draftSetIndex: 99)
        let fallback = TrainerLogic.plannedSet(workouts: [], exerciseID: 8, draftSetIndex: 0)

        XCTAssertEqual([first.reps, second.reps, third.reps, beyondPlan.reps], [16, 14, 13, 13])
        XCTAssertEqual([first.weight, second.weight, third.weight, beyondPlan.weight], [80, 90, 90, 90])
        XCTAssertEqual(fallback.reps, 12)
        XCTAssertEqual(fallback.weight, 0)
    }

    func testExercisePickerBuildsPrimarySixFromHistoryAndKeepsBenchPressRare() {
        let workouts = popularHistory()
        let groups = TrainerLogic.exercisePickerGroups(
            available: TestFixtures.catalog,
            catalog: TestFixtures.catalog,
            workouts: workouts,
            draftExercises: []
        )

        XCTAssertEqual(groups.primary.map(\.name), [
            "Жим ногами",
            "Бабочка",
            "Тяга верт.",
            "Дельты",
            "Бицепс",
            "Трицепс"
        ])
        XCTAssertFalse(groups.primary.map(\.id).contains(1))
        XCTAssertTrue(groups.secondary.map(\.name).contains("Жим гор."))
        XCTAssertEqual(groups.primaryPoolTotal, 6)
    }

    func testDraftDisplayCardsStartAsPrimaryPreviewsAndActualCardsReplacePreview() {
        let workouts = popularHistory()
        let draft = [
            TestFixtures.draftExercise(
                id: 8,
                name: "Жим ногами",
                sets: [TestFixtures.draftSet(reps: 16, weight: 80)]
            ),
            TestFixtures.draftExercise(
                id: 1,
                name: "Жим гор.",
                sets: [TestFixtures.draftSet(reps: 12, weight: 50)]
            )
        ]

        let cards = TrainerLogic.draftDisplayCards(
            exercises: TestFixtures.catalog,
            workouts: workouts,
            draftExercises: draft
        )

        XCTAssertEqual(cards.prefix(6).map(\.exerciseName), [
            "Жим ногами",
            "Бабочка",
            "Тяга верт.",
            "Дельты",
            "Бицепс",
            "Трицепс"
        ])
        XCTAssertEqual(cards.first?.isPreview, false)
        XCTAssertEqual(cards.first?.sets.count, 1)
        XCTAssertEqual(cards.last?.exerciseName, "Жим гор.")
        XCTAssertEqual(cards.last?.isPreview, false)
    }

    func testDraftProgressIsInvisibleUntilRealSetsAndCountsFractionalPlanProgress() {
        let workouts = popularHistory() + [
            TestFixtures.workout(
                id: 99,
                date: "2026-05-07",
                exercises: [
                    TestFixtures.exercise(id: 8, name: "Жим ногами", sets: [
                        TestFixtures.set(index: 1, reps: 15, weight: 80),
                        TestFixtures.set(index: 2, reps: 13, weight: 90),
                        TestFixtures.set(index: 3, reps: 12, weight: 90)
                    ])
                ]
            )
        ]

        XCTAssertEqual(
            TrainerLogic.draftProgressRatio(
                exercises: TestFixtures.catalog,
                workouts: workouts,
                draftExercises: [],
                editingWorkoutID: nil
            ),
            0
        )

        let oneSet = [
            TestFixtures.draftExercise(
                id: 8,
                name: "Жим ногами",
                sets: [TestFixtures.draftSet(reps: 16, weight: 80)]
            )
        ]
        let threeSets = [
            TestFixtures.draftExercise(
                id: 8,
                name: "Жим ногами",
                sets: [
                    TestFixtures.draftSet(reps: 16, weight: 80),
                    TestFixtures.draftSet(reps: 14, weight: 90),
                    TestFixtures.draftSet(reps: 13, weight: 90)
                ]
            )
        ]

        XCTAssertEqual(
            TrainerLogic.draftProgressRatio(
                exercises: TestFixtures.catalog,
                workouts: workouts,
                draftExercises: oneSet,
                editingWorkoutID: nil
            ),
            1.0 / 18.0,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            TrainerLogic.draftProgressRatio(
                exercises: TestFixtures.catalog,
                workouts: workouts,
                draftExercises: threeSets,
                editingWorkoutID: nil
            ),
            1.0 / 6.0,
            accuracy: 0.0001
        )
    }

    func testProgressSeriesUsesHeaviestSetAndHighestRepSetPerWorkoutInChronologicalOrder() {
        let workouts = [
            TestFixtures.workout(
                id: 3,
                date: DateTools.iso(from: Date()),
                exercises: [
                    TestFixtures.exercise(id: 16, name: "Разгибания ног", sets: [
                        TestFixtures.set(index: 1, reps: 12, weight: 130),
                        TestFixtures.set(index: 2, reps: 10, weight: 150)
                    ])
                ]
            ),
            TestFixtures.workout(
                id: 1,
                date: DateTools.iso(from: Calendar.current.date(byAdding: .day, value: -2, to: Date())!),
                exercises: [
                    TestFixtures.exercise(id: 16, name: "Разгибания ног", sets: [
                        TestFixtures.set(index: 1, reps: 10, weight: 120),
                        TestFixtures.set(index: 2, reps: 14, weight: 110)
                    ])
                ]
            )
        ]

        let series = TrainerLogic.buildExerciseProgressSeries(
            workouts: workouts,
            range: .days7,
            exerciseID: 16
        )
        let summary = TrainerLogic.summarizeExerciseSeries(series)

        XCTAssertEqual(series.map(\.workoutID), [1, 3])
        XCTAssertEqual(series.first?.bestWeight, 120)
        XCTAssertEqual(series.first?.bestReps, 14)
        XCTAssertEqual(series.last?.bestWeight, 150)
        XCTAssertEqual(summary?.weightDelta, 30)
        XCTAssertEqual(summary?.repsDelta, -2)
    }

    func testBodyWeightSummarySortsOldestToNewestAndPreservesPreciseValues() {
        let entries = [
            TestFixtures.bodyWeight(id: 3, date: "2026-05-03", weight: 81.95),
            TestFixtures.bodyWeight(id: 1, date: "2026-05-01", weight: 82.4),
            TestFixtures.bodyWeight(id: 2, date: "2026-05-02", weight: 82.05)
        ]

        let sorted = TrainerLogic.sortBodyWeights(entries)
        let summary = TrainerLogic.summarizeBodyWeights(filteredEntries: sorted, allEntries: entries)

        XCTAssertEqual(sorted.map(\.entryDate), ["2026-05-01", "2026-05-02", "2026-05-03"])
        XCTAssertEqual(summary.totalEntries, 3)
        XCTAssertEqual(summary.latestEntry?.weight, 81.95)
        XCTAssertEqual(summary.delta, -0.45, accuracy: 0.0001)
        XCTAssertEqual(TrainerLogic.formatBodyWeight(81.95), "81,95")
    }

    private func popularHistory() -> [Workout] {
        let core = [
            (8, "Жим ногами", 120.0, 15),
            (1, "Жим гор.", 50.0, 12),
            (9, "Тяга верт.", 60.0, 12),
            (13, "Дельты", 17.5, 15),
            (11, "Бицепс", 30.0, 12),
            (12, "Трицепс", 35.0, 12)
        ]

        let repeated = ["2026-05-01", "2026-05-03", "2026-05-05"].enumerated().map { offset, date in
            TestFixtures.workout(
                id: 10 + offset,
                clientID: "picker-core-\(offset)",
                date: date,
                exercises: core.map { item in
                    TestFixtures.exercise(
                        id: item.0,
                        name: item.1,
                        sets: [TestFixtures.set(reps: item.3, weight: item.2)]
                    )
                }
            )
        }

        let butterfly = TestFixtures.workout(
            id: 20,
            clientID: "picker-rare-butterfly",
            date: "2026-05-06",
            exercises: [
                TestFixtures.exercise(
                    id: 17,
                    name: "Бабочка",
                    sets: [TestFixtures.set(reps: 12, weight: 40)]
                )
            ]
        )

        return repeated + [butterfly]
    }
}
