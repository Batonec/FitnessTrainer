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


if __name__ == "__main__":
    unittest.main()
