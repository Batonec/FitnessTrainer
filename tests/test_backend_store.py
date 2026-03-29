from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from support import MINIAPP_DIR, sample_workout_payload

import sys

if str(MINIAPP_DIR) not in sys.path:
    sys.path.insert(0, str(MINIAPP_DIR))

from backend_store import MiniAppStore, normalize_workout_payload


class MiniAppStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = MiniAppStore(Path(self.temp_dir.name) / "trainer.db")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_ensure_debug_user_is_stable_by_alias(self) -> None:
        first_user = self.store.ensure_debug_user("browser-default")
        second_user = self.store.ensure_debug_user("browser-default")

        self.assertEqual(first_user["id"], second_user["id"])
        self.assertTrue(first_user["is_default_debug_user"])
        self.assertEqual(first_user["auth_source"], "debug")

    def test_ensure_debug_user_uses_custom_names_for_new_alias(self) -> None:
        user = self.store.ensure_debug_user("local-qa", first_name="Local", last_name="QA")

        self.assertEqual(user["debug_alias"], "local-qa")
        self.assertEqual(user["display_name"], "Local QA")

    def test_upsert_telegram_user_updates_existing_record(self) -> None:
        first_user = self.store.upsert_telegram_user(
            {
                "id": "777000111",
                "first_name": "Telegram",
                "last_name": "User",
                "username": "first_name",
            },
            auth_source="telegram_unsafe",
        )
        second_user = self.store.upsert_telegram_user(
            {
                "id": 777000111,
                "first_name": "Updated",
                "last_name": "Name",
                "username": "updated_name",
            },
        )

        self.assertEqual(first_user["id"], second_user["id"])
        self.assertEqual(second_user["auth_source"], "telegram")
        self.assertEqual(second_user["username"], "updated_name")
        self.assertEqual(second_user["display_name"], "Updated Name")

    def test_upsert_telegram_user_normalizes_blank_names_and_username(self) -> None:
        user = self.store.upsert_telegram_user(
            {
                "id": 888000111,
                "first_name": "   ",
                "last_name": "   ",
                "username": "   ",
            },
            auth_source="telegram_unsafe",
        )

        self.assertEqual(user["first_name"], "Telegram")
        self.assertIsNone(user["last_name"])
        self.assertIsNone(user["username"])
        self.assertEqual(user["display_name"], "Telegram")

    def test_get_user_by_id_returns_none_for_unknown_user(self) -> None:
        self.assertIsNone(self.store.get_user_by_id(9999))

    def test_save_workout_is_idempotent_per_user_and_client_id(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        first_workout, first_created = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(client_id="client-a"),
        )
        second_workout, second_created = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(client_id="client-a"),
        )

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first_workout["id"], second_workout["id"])

    def test_save_workout_allows_same_client_id_for_different_users(self) -> None:
        first_user = self.store.ensure_debug_user("browser-default")
        second_user = self.store.upsert_telegram_user(
            {"id": 901001, "first_name": "Second", "last_name": "User"}
        )

        first_workout, first_created = self.store.save_workout(
            int(first_user["id"]),
            sample_workout_payload(client_id="shared-client-id"),
        )
        second_workout, second_created = self.store.save_workout(
            int(second_user["id"]),
            sample_workout_payload(client_id="shared-client-id"),
        )

        self.assertTrue(first_created)
        self.assertTrue(second_created)
        self.assertNotEqual(first_workout["id"], second_workout["id"])

    def test_list_workouts_orders_same_day_by_newest_id(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        first_workout, _ = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(
                client_id="client-a",
                exercise_name="Squat",
                exercise_id=6,
            ),
        )
        second_workout, _ = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(
                client_id="client-b",
                exercise_name="Pull Up",
                exercise_id=4,
            ),
        )

        workouts = self.store.list_workouts(int(user["id"]))

        self.assertEqual([workouts[0]["id"], workouts[1]["id"]], [second_workout["id"], first_workout["id"]])
        self.assertIn("created_at", workouts[0])
        self.assertIn("updated_at", workouts[0])

    def test_list_workouts_orders_newer_dates_before_older_dates(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(
                client_id="older-workout",
                workout_date="2026-03-20",
                exercise_name="Older",
                exercise_id=2,
            ),
        )
        self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(
                client_id="newer-workout",
                workout_date="2026-03-28",
                exercise_name="Newer",
                exercise_id=3,
            ),
        )

        workouts = self.store.list_workouts(int(user["id"]))

        self.assertEqual(
            [workouts[0]["workout_date"], workouts[1]["workout_date"]],
            ["2026-03-28", "2026-03-20"],
        )

    def test_list_workouts_returns_empty_list_for_user_without_history(self) -> None:
        user = self.store.ensure_debug_user("browser-default")

        self.assertEqual(self.store.list_workouts(int(user["id"])), [])

    def test_save_workout_persists_normalized_notes_and_set_indexes(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        workout, created = self.store.save_workout(
            int(user["id"]),
            {
                "client_id": "normalized-workout",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": "  Session note  ",
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 5,
                            "name": "Cable Fly",
                            "sets": [
                                {"reps": 12, "weight": 25, "notes": "  "},
                                {"reps": 10, "weight": 30, "notes": " Last hard set "},
                            ],
                        }
                    ],
                },
            },
        )

        self.assertTrue(created)
        self.assertEqual(workout["data"]["notes"], "Session note")
        self.assertEqual(
            [workout_set["set_index"] for workout_set in workout["data"]["exercises"][0]["sets"]],
            [1, 2],
        )
        self.assertIsNone(workout["data"]["exercises"][0]["sets"][0]["notes"])
        self.assertEqual(workout["data"]["exercises"][0]["sets"][1]["notes"], "Last hard set")

    def test_update_workout_rewrites_payload_and_bumps_updated_at(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        created_workout, _ = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(
                client_id="editable-workout",
                workout_date="2026-03-20",
                exercise_id=1,
                exercise_name="Bench Press",
                weight=80,
                reps=10,
            ),
        )

        updated_workout = self.store.update_workout(
            int(user["id"]),
            int(created_workout["id"]),
            sample_workout_payload(
                client_id="ignored-on-update",
                workout_date="2026-03-28",
                exercise_id=1,
                exercise_name="Bench Press",
                weight=92.5,
                reps=8,
                notes=" Updated set ",
            ),
        )

        self.assertIsNotNone(updated_workout)
        self.assertEqual(updated_workout["id"], created_workout["id"])
        self.assertEqual(updated_workout["client_id"], "editable-workout")
        self.assertEqual(updated_workout["workout_date"], "2026-03-28")
        self.assertGreaterEqual(updated_workout["updated_at"], created_workout["updated_at"])
        self.assertEqual(updated_workout["data"]["exercises"][0]["sets"][0]["weight"], 92.5)
        self.assertEqual(updated_workout["data"]["exercises"][0]["sets"][0]["reps"], 8)
        self.assertEqual(updated_workout["data"]["notes"], "Updated set")

    def test_update_workout_returns_none_for_other_user(self) -> None:
        first_user = self.store.ensure_debug_user("browser-default")
        second_user = self.store.upsert_telegram_user({"id": 901002, "first_name": "Other"})
        created_workout, _ = self.store.save_workout(
            int(first_user["id"]),
            sample_workout_payload(client_id="protected-workout"),
        )

        updated_workout = self.store.update_workout(
            int(second_user["id"]),
            int(created_workout["id"]),
            sample_workout_payload(client_id="protected-workout", weight=95),
        )

        self.assertIsNone(updated_workout)
        stored_workout = self.store.get_workout_by_id(int(first_user["id"]), int(created_workout["id"]))
        self.assertIsNotNone(stored_workout)
        self.assertEqual(stored_workout["data"]["exercises"][0]["sets"][0]["weight"], 80.0)

    def test_delete_workout_removes_existing_record(self) -> None:
        user = self.store.ensure_debug_user("browser-default")
        created_workout, _ = self.store.save_workout(
            int(user["id"]),
            sample_workout_payload(client_id="delete-me"),
        )

        deleted_workout = self.store.delete_workout(int(user["id"]), int(created_workout["id"]))

        self.assertIsNotNone(deleted_workout)
        self.assertEqual(deleted_workout["id"], created_workout["id"])
        self.assertEqual(self.store.list_workouts(int(user["id"])), [])

    def test_delete_workout_returns_none_when_workout_belongs_to_other_user(self) -> None:
        first_user = self.store.ensure_debug_user("browser-default")
        second_user = self.store.upsert_telegram_user({"id": 901003, "first_name": "Other"})
        created_workout, _ = self.store.save_workout(
            int(first_user["id"]),
            sample_workout_payload(client_id="delete-protected"),
        )

        deleted_workout = self.store.delete_workout(int(second_user["id"]), int(created_workout["id"]))

        self.assertIsNone(deleted_workout)
        self.assertEqual(len(self.store.list_workouts(int(first_user["id"]))), 1)


class NormalizeWorkoutPayloadTest(unittest.TestCase):
    def test_infers_heavy_load_type_from_volume(self) -> None:
        payload, client_id = normalize_workout_payload(
            {
                "client_id": "load-heavy",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [
                                {"reps": 10, "weight": 80, "notes": None},
                                {"reps": 10, "weight": 80, "notes": None},
                                {"reps": 10, "weight": 80, "notes": None},
                                {"reps": 10, "weight": 80, "notes": None},
                            ],
                        }
                    ],
                },
            }
        )

        self.assertEqual(client_id, "load-heavy")
        self.assertEqual(payload["data"]["load_type"], "heavy")

    def test_preserves_explicit_allowed_load_type(self) -> None:
        payload, _ = normalize_workout_payload(
            {
                "client_id": "load-deload",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": "deload",
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [{"reps": 12, "weight": 20, "notes": None}],
                        }
                    ],
                },
            }
        )

        self.assertEqual(payload["data"]["load_type"], "deload")

    def test_infers_medium_load_type_from_volume(self) -> None:
        payload, _ = normalize_workout_payload(
            {
                "client_id": "load-medium",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [
                                {"reps": 10, "weight": 50, "notes": None},
                                {"reps": 10, "weight": 50, "notes": None},
                                {"reps": 10, "weight": 50, "notes": None},
                                {"reps": 10, "weight": 50, "notes": None},
                            ],
                        }
                    ],
                },
            }
        )

        self.assertEqual(payload["data"]["load_type"], "medium")

    def test_infers_light_load_type_for_zero_or_low_volume(self) -> None:
        payload, _ = normalize_workout_payload(
            {
                "client_id": "load-light",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [{"reps": 12, "weight": 0, "notes": None}],
                        }
                    ],
                },
            }
        )

        self.assertEqual(payload["data"]["load_type"], "light")

    def test_falls_back_to_payload_id_when_client_id_is_missing(self) -> None:
        payload, client_id = normalize_workout_payload(
            {
                "id": "legacy-workout-id",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [{"reps": 12, "weight": 80, "notes": None}],
                        }
                    ],
                },
            }
        )

        self.assertEqual(client_id, "legacy-workout-id")
        self.assertEqual(payload["workout_date"], "2026-03-28")

    def test_normalizes_workout_and_set_notes(self) -> None:
        payload, _ = normalize_workout_payload(
            {
                "client_id": "notes-normalized",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": "  Workout note  ",
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [{"reps": 12, "weight": 80, "notes": "  "}],
                        }
                    ],
                },
            }
        )

        self.assertEqual(payload["data"]["notes"], "Workout note")
        self.assertIsNone(payload["data"]["exercises"][0]["sets"][0]["notes"])

    def test_assigns_set_indexes_sequentially(self) -> None:
        payload, _ = normalize_workout_payload(
            {
                "client_id": "indexed-sets",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": None,
                    "exercises": [
                        {
                            "exercise_id": 1,
                            "name": "Bench Press",
                            "sets": [
                                {"reps": 12, "weight": 80, "notes": None},
                                {"reps": 10, "weight": 82.5, "notes": None},
                            ],
                        }
                    ],
                },
            }
        )

        self.assertEqual(
            [workout_set["set_index"] for workout_set in payload["data"]["exercises"][0]["sets"]],
            [1, 2],
        )

    def test_rejects_workout_without_exercises(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one exercise"):
            normalize_workout_payload(
                {
                    "client_id": "invalid",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {"notes": None, "load_type": None, "exercises": []},
                }
            )

    def test_rejects_non_object_exercise_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "Exercise payload must be an object"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-exercise-object",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {"notes": None, "load_type": None, "exercises": ["not-an-object"]},
                }
            )

    def test_rejects_non_integer_exercise_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "exercise_id must be an integer"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-exercise-id",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": "1", "name": "Bench", "sets": [{"reps": 10, "weight": 80}]}],
                    },
                }
            )

    def test_rejects_blank_exercise_name(self) -> None:
        with self.assertRaisesRegex(ValueError, "Exercise name is required"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-exercise-name",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "   ", "sets": [{"reps": 10, "weight": 80}]}],
                    },
                }
            )

    def test_rejects_exercise_without_sets(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one set"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-sets",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "Bench", "sets": []}],
                    },
                }
            )

    def test_rejects_non_numeric_set_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be numeric"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-set-values",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [
                            {
                                "exercise_id": 1,
                                "name": "Bench",
                                "sets": [{"reps": "abc", "weight": "xyz", "notes": None}],
                            }
                        ],
                    },
                }
            )

    def test_rejects_sets_with_zero_reps(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least 1"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-reps",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "Bench", "sets": [{"reps": 0, "weight": 80}]}],
                    },
                }
            )

    def test_rejects_sets_with_negative_weight(self) -> None:
        with self.assertRaisesRegex(ValueError, "zero or positive"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-weight",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "Bench", "sets": [{"reps": 10, "weight": -5}]}],
                    },
                }
            )

    def test_rejects_invalid_workout_date_format(self) -> None:
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            normalize_workout_payload(
                {
                    "client_id": "invalid-date",
                    "workout_date": "28-03-2026",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "Bench", "sets": [{"reps": 10, "weight": 80}]}],
                    },
                }
            )

    def test_requires_client_id_or_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "client_id is required"):
            normalize_workout_payload(
                {
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": None,
                        "exercises": [{"exercise_id": 1, "name": "Bench", "sets": [{"reps": 10, "weight": 80}]}],
                    },
                }
            )


if __name__ == "__main__":
    unittest.main()
