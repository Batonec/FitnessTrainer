from __future__ import annotations

import unittest

import support  # noqa: F401 — adds backend to sys.path
from support import STATIC_DIR

import recommender


CATALOG = [
    {"id": 8, "name": "Жим ногами"},
    {"id": 9, "name": "Тяга верт."},
    {"id": 1, "name": "Жим гор."},
]


class RecommenderTests(unittest.TestCase):
    def test_load_catalog_reads_web_data(self) -> None:
        catalog = recommender.load_catalog(STATIC_DIR)
        self.assertTrue(catalog)
        self.assertTrue(all("id" in item and "name" in item for item in catalog))

    def test_build_schema_enum_lists_catalog_ids_and_requires_note(self) -> None:
        schema = recommender._build_schema(CATALOG)
        item = schema["properties"]["exercises"]["items"]
        self.assertEqual(item["properties"]["exercise_id"]["enum"], [8, 9, 1])
        self.assertIn("note", item["required"])

    def test_validate_drops_unknown_id_clamps_and_uses_catalog_name(self) -> None:
        raw = {
            "focus": "Ноги",
            "load_type": "medium",
            "rationale": "...",
            "exercises": [
                {
                    "exercise_id": 8,
                    "name": "что-то своё",
                    "note": "+вес",
                    "sets": [
                        {"reps": 11, "weight": 120},
                        {"reps": 0, "weight": 50},        # reps < 1 → dropped
                        {"reps": 10, "weight": 99999},    # weight clamped
                    ],
                },
                {  # hallucinated id → dropped
                    "exercise_id": 999,
                    "name": "выдумка",
                    "note": "n",
                    "sets": [{"reps": 5, "weight": 5}],
                },
            ],
        }
        out = recommender._validate(raw, CATALOG)
        self.assertEqual(len(out["exercises"]), 1)
        exercise = out["exercises"][0]
        self.assertEqual(exercise["exercise_id"], 8)
        self.assertEqual(exercise["name"], "Жим ногами")  # catalog name, not model echo
        self.assertEqual(exercise["note"], "+вес")
        self.assertEqual([s["reps"] for s in exercise["sets"]], [11, 10])
        self.assertEqual(exercise["sets"][1]["weight"], recommender.MAX_WEIGHT)

    def test_validate_normalizes_unknown_load_type(self) -> None:
        raw = {
            "focus": "x",
            "load_type": "crazy",
            "rationale": "r",
            "exercises": [
                {"exercise_id": 8, "name": "x", "note": "n", "sets": [{"reps": 10, "weight": 50}]}
            ],
        }
        self.assertEqual(recommender._validate(raw, CATALOG)["load_type"], "medium")

    def test_validate_raises_without_valid_exercises(self) -> None:
        raw = {
            "focus": "x",
            "load_type": "light",
            "rationale": "r",
            "exercises": [
                {"exercise_id": 999, "name": "x", "note": "n", "sets": [{"reps": 10, "weight": 50}]}
            ],
        }
        with self.assertRaises(recommender.RecommendationError):
            recommender._validate(raw, CATALOG)

    def test_serialize_history_is_oldest_first_with_effort_marks(self) -> None:
        # list_workouts() returns newest-first; the serializer flips to oldest-first.
        workouts = [
            {
                "workout_date": "2026-05-29",
                "data": {
                    "load_type": "heavy",
                    "exercises": [
                        {"name": "Жим ногами", "sets": [{"reps": 10, "weight": 120, "effort": "hard"}]}
                    ],
                },
            },
            {
                "workout_date": "2026-05-26",
                "data": {
                    "load_type": "medium",
                    "exercises": [
                        {"name": "Жим гор.", "sets": [{"reps": 8, "weight": 50, "effort": "easy"}]}
                    ],
                },
            },
        ]
        text = recommender._serialize_history(workouts, 20)
        self.assertTrue(text.splitlines()[0].startswith("2026-05-26"))
        self.assertIn("120кг×10+", text)  # hard → '+'
        self.assertIn("50кг×8-", text)    # easy → '-'

    def test_generate_requires_history(self) -> None:
        with self.assertRaises(recommender.RecommendationError):
            recommender.generate([], [], CATALOG)


if __name__ == "__main__":
    unittest.main()
