from __future__ import annotations

import io
import unittest
import urllib.error

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


class CoachContextTests(unittest.TestCase):
    def _workout(self, when: str, exercise_id: int, sets: int, with_snapshot: bool = False):
        workout = {
            "workout_date": when,
            "data": {
                "load_type": "medium",
                "exercises": [
                    {
                        "exercise_id": exercise_id,
                        "name": "X",
                        "sets": [{"reps": 10, "weight": 50} for _ in range(sets)],
                    }
                ],
            },
        }
        if with_snapshot:
            workout["data"]["recommendation"] = {
                "schema": 1,
                "exercises": [
                    {"exercise_id": exercise_id, "name": "X", "sets": [{"reps": 10, "weight": 50}] * 3},
                    {"exercise_id": 15, "name": "Сгибания ног", "sets": [{"reps": 12, "weight": 40}] * 2},
                ],
            }
        return workout

    def test_sets_per_group_respects_window_and_mapping(self) -> None:
        from datetime import date

        today = date(2026, 6, 12)
        workouts = [
            self._workout("2026-06-10", 18, 3),   # грудь, inside 7d
            self._workout("2026-06-01", 17, 4),   # грудь, inside 28d only
            self._workout("2026-04-01", 18, 5),   # outside both windows
            self._workout("2026-06-11", 8, 2),    # квадрицепс
        ]

        week = recommender._sets_per_group(workouts, today, 7)
        month = recommender._sets_per_group(workouts, today, 28)

        self.assertEqual(week["грудь"], 3)
        self.assertEqual(month["грудь"], 7)
        self.assertEqual(week["квадрицепс/ягодичные"], 2)
        self.assertEqual(week["бицепс бедра"], 0)

    def test_volume_report_lists_every_group(self) -> None:
        from datetime import date

        report = recommender._volume_report([], date(2026, 6, 12))
        for group in recommender.MUSCLE_GROUPS:
            self.assertIn(group, report)

    def test_body_weight_report_includes_weekly_trend(self) -> None:
        from datetime import date

        entries = [
            {"entry_date": "2026-05-15", "weight": 78.0},
            {"entry_date": "2026-05-29", "weight": 77.5},
            {"entry_date": "2026-06-10", "weight": 77.0},
        ]
        report = recommender._body_weight_report(entries, date(2026, 6, 12))
        self.assertIn("77кг", report)
        self.assertIn("Тренд:", report)
        self.assertIn("-0.27", report)  # -1.0 kg over 26 days ≈ -0.27/week

    def test_plan_adherence_report_compares_fact_vs_plan(self) -> None:
        workouts = [self._workout("2026-06-10", 18, 3, with_snapshot=True)]
        report = recommender._plan_adherence_report(workouts)
        self.assertIn("3/5", report)            # 3 of 5 planned sets done
        self.assertIn("пропущено", report)      # hamstring exercise skipped

    def test_plan_adherence_none_without_snapshots(self) -> None:
        self.assertIsNone(recommender._plan_adherence_report([self._workout("2026-06-10", 18, 3)]))

    def test_body_weight_report_drops_garbage_and_flags_stale(self) -> None:
        from datetime import date

        entries = [
            {"entry_date": "2026-05-01", "weight": 22.0},   # logging noise → dropped
            {"entry_date": "2026-05-05", "weight": 77.5},
            {"entry_date": "2026-05-10", "weight": 77.2},
        ]
        report = recommender._body_weight_report(entries, date(2026, 6, 12))
        self.assertNotIn("22", report)
        self.assertIn("отброшено неправдоподобных записей: 1", report)
        self.assertIn("ДАННЫЕ УСТАРЕЛИ", report)   # 33 days since last plausible

        only_garbage = [{"entry_date": "2026-06-10", "weight": 23.0}]
        self.assertIsNone(recommender._body_weight_report(only_garbage, date(2026, 6, 12)))


class ProfileTests(unittest.TestCase):
    def test_load_profile_reads_valid_file(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "coach_profile.json"
            path.write_text(
                '{"schema":1,"blocks":{"Цель":"lean bulk до 84"}}', "utf-8"
            )
            profile = recommender.load_profile(path)
            self.assertIsNotNone(profile)
            self.assertIn("Цель", profile["blocks"])

    def test_load_profile_tolerates_missing_or_garbage(self) -> None:
        import tempfile
        from pathlib import Path

        self.assertIsNone(recommender.load_profile(None))
        self.assertIsNone(recommender.load_profile("/nonexistent/coach_profile.json"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text("{not json", "utf-8")
            self.assertIsNone(recommender.load_profile(path))
            path.write_text('{"blocks":{}}', "utf-8")
            self.assertIsNone(recommender.load_profile(path))

    def test_system_prompt_embeds_profile_semantics_and_policy(self) -> None:
        profile = {"schema": 1, "blocks": {"Цель": "lean bulk, потолок 84 кг"}}
        prompt = recommender._build_system_prompt(CATALOG, profile)
        self.assertIn("lean bulk, потолок 84 кг", prompt)
        self.assertIn("широчайшие", prompt)              # catalog semantics
        self.assertIn("ТРЕНЕРСКАЯ ПОЛИТИКА", prompt)
        self.assertIn("rationale", prompt)

    def test_system_prompt_without_profile_uses_fallback(self) -> None:
        prompt = recommender._build_system_prompt(CATALOG)
        self.assertIn("Профиль атлета не настроен", prompt)

    def test_user_prompt_contains_volumes_and_weekday(self) -> None:
        from datetime import date

        workouts = [
            {
                "workout_date": "2026-06-10",
                "data": {
                    "load_type": "heavy",
                    "exercises": [
                        {"exercise_id": 8, "name": "Жим ногами", "sets": [{"reps": 10, "weight": 100}]}
                    ],
                },
            }
        ]
        prompt = recommender._build_user_prompt(workouts, [], date(2026, 6, 12), 20)
        self.assertIn("пятница", prompt)
        self.assertIn("Рабочие подходы по группам", prompt)
        self.assertIn("квадрицепс/ягодичные: 1 подходов за 7 дней", prompt)


class RestDaysTests(unittest.TestCase):
    def _raw(self, **extra):
        base = {
            "focus": "f",
            "load_type": "medium",
            "rationale": "r",
            "exercises": [
                {"exercise_id": 8, "name": "Жим ногами", "note": "n", "sets": [{"reps": 10, "weight": 100}]}
            ],
        }
        base.update(extra)
        return base

    def test_validate_defaults_rest_days_when_missing(self) -> None:
        self.assertEqual(recommender._validate(self._raw(), CATALOG)["rest_days"], 1)

    def test_validate_clamps_and_coerces_rest_days(self) -> None:
        self.assertEqual(recommender._validate(self._raw(rest_days=99), CATALOG)["rest_days"], recommender.MAX_REST_DAYS)
        self.assertEqual(recommender._validate(self._raw(rest_days=-3), CATALOG)["rest_days"], 0)
        self.assertEqual(recommender._validate(self._raw(rest_days="2"), CATALOG)["rest_days"], 2)

    def test_schema_requires_rest_days(self) -> None:
        schema = recommender._build_schema(CATALOG)
        self.assertIn("rest_days", schema["properties"])
        self.assertIn("rest_days", schema["required"])

    def test_generate_resolves_next_workout_date(self) -> None:
        import os
        from datetime import date

        os.environ["ANTHROPIC_API_KEY"] = "test-key"
        self.addCleanup(lambda: os.environ.pop("ANTHROPIC_API_KEY", None))
        orig = recommender._call_anthropic
        self.addCleanup(lambda: setattr(recommender, "_call_anthropic", orig))
        recommender._call_anthropic = lambda *a, **k: (self._raw(rest_days=2), {"input_tokens": 1, "output_tokens": 1})

        rec, _usage, _model = recommender.generate(
            [{"workout_date": "2026-06-01", "data": {"exercises": []}}],
            [],
            CATALOG,
            today=date(2026, 6, 12),
        )
        self.assertEqual(rec["rest_days"], 2)
        self.assertEqual(rec["next_workout_date"], "2026-06-14")


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> bool:
        return False

    def read(self) -> bytes:
        return self._body


def _http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("http://x", code, "msg", None, io.BytesIO(b"detail"))


class FetchRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig = recommender.urllib.request.urlopen
        self.addCleanup(lambda: setattr(recommender.urllib.request, "urlopen", self._orig))
        self.slept: list[float] = []

    def _fetch(self, max_retries: int = 2):
        return recommender._fetch_anthropic(
            object(),
            timeout=1,
            max_retries=max_retries,
            backoff=0.5,
            sleep=self.slept.append,
        )

    def _patch(self, sequence) -> list[int]:
        calls = {"n": 0}
        it = iter(sequence)

        def fake_urlopen(request, timeout=None):
            calls["n"] += 1
            item = next(it)
            if isinstance(item, Exception):
                raise item
            return _FakeResponse(item)

        recommender.urllib.request.urlopen = fake_urlopen
        return calls

    def test_retries_transient_then_succeeds(self) -> None:
        calls = self._patch([_http_error(503), b"ok"])
        self.assertEqual(self._fetch(), "ok")
        self.assertEqual(calls["n"], 2)
        self.assertEqual(self.slept, [0.5])  # one backoff before the 2nd try

    def test_permanent_error_is_not_retried(self) -> None:
        calls = self._patch([_http_error(400)])
        with self.assertRaises(recommender.RecommendationError):
            self._fetch()
        self.assertEqual(calls["n"], 1)
        self.assertEqual(self.slept, [])

    def test_exhausts_retries_on_persistent_transient(self) -> None:
        calls = self._patch([_http_error(529), _http_error(529), _http_error(529)])
        with self.assertRaisesRegex(recommender.RecommendationError, "529"):
            self._fetch(max_retries=2)
        self.assertEqual(calls["n"], 3)  # initial + 2 retries
        self.assertEqual(self.slept, [0.5, 1.0])  # exponential backoff

    def test_url_error_retried_then_raised(self) -> None:
        calls = self._patch([urllib.error.URLError("conn reset"), b"ok"])
        self.assertEqual(self._fetch(), "ok")
        self.assertEqual(calls["n"], 2)


if __name__ == "__main__":
    unittest.main()
