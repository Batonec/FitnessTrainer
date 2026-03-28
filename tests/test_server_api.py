from __future__ import annotations

import unittest

from support import JsonHttpClient, running_miniapp_server, sample_workout_payload


class ServerApiTest(unittest.TestCase):
    def test_session_resolve_returns_debug_user_when_debug_is_enabled(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("POST", "/api/session/resolve", {})

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "debug")
            self.assertTrue(response.payload["user"]["is_default_debug_user"])
            self.assertIn("trainer_session=", response.headers.get("Set-Cookie", ""))

    def test_session_resolve_requires_auth_when_debug_is_disabled(self) -> None:
        with running_miniapp_server(allow_debug_user=False) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("POST", "/api/session/resolve", {})

            self.assertEqual(response.status, 401)
            self.assertIn("Open Mini App from Telegram", response.payload["reason"])

    def test_unsafe_telegram_user_fallback_persists_its_own_session(self) -> None:
        with running_miniapp_server(allow_debug_user=False) as app:
            client = JsonHttpClient(app.base_url)

            session_response = client.request_json(
                "POST",
                "/api/session/resolve",
                {
                    "initData": "",
                    "unsafeUser": {
                        "id": 555000111,
                        "first_name": "Telegram",
                        "last_name": "Fallback",
                        "username": "telegram_fallback",
                    },
                },
            )

            self.assertEqual(session_response.status, 200)
            self.assertEqual(session_response.payload["auth_mode"], "telegram_unsafe")

            save_response = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(
                    client_id="unsafe-telegram-workout",
                    exercise_id=4,
                    exercise_name="Pull Up",
                ),
            )
            list_response = client.request_json("GET", "/api/workouts")

            self.assertEqual(save_response.status, 201)
            self.assertEqual(list_response.status, 200)
            self.assertEqual(list_response.payload["user"]["auth_source"], "telegram_unsafe")
            self.assertEqual(list_response.payload["workouts"][0]["data"]["exercises"][0]["name"], "Pull Up")

    def test_workouts_endpoint_orders_same_day_entries_from_newest_to_oldest(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            first_save = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(
                    client_id="workout-a",
                    exercise_id=6,
                    exercise_name="Squat",
                ),
            )
            second_save = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(
                    client_id="workout-b",
                    exercise_id=4,
                    exercise_name="Pull Up",
                ),
            )
            workouts_response = client.request_json("GET", "/api/workouts")

            self.assertEqual(first_save.status, 201)
            self.assertEqual(second_save.status, 201)
            self.assertEqual(workouts_response.status, 200)
            self.assertEqual(
                [workout["data"]["exercises"][0]["name"] for workout in workouts_response.payload["workouts"]],
                ["Pull Up", "Squat"],
            )


if __name__ == "__main__":
    unittest.main()
