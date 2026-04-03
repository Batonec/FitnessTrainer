from __future__ import annotations

import time
import unittest

from support import (
    JsonHttpClient,
    build_signed_init_data,
    running_miniapp_server,
    sample_body_weight_payload,
    sample_workout_payload,
)


class ServerApiTest(unittest.TestCase):
    def provision_recovery_user(
        self,
        app,
        *,
        telegram_user_id: int = 555000444,
        first_name: str = "Telegram",
        last_name: str = "Recovered",
        username: str = "telegram_recovered",
    ) -> dict[str, object]:
        client = JsonHttpClient(app.base_url)
        response = client.request_json(
            "POST",
            "/api/session/resolve",
            {
                "shell": "telegram",
                "initData": "",
                "unsafeUser": {
                    "id": telegram_user_id,
                    "first_name": first_name,
                    "last_name": last_name,
                    "username": username,
                },
            },
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(response.payload["auth_mode"], "telegram_unsafe")
        app.module.RECOVERY_TELEGRAM_USER_ID = response.payload["user"]["id"]
        return response.payload["user"]

    def test_health_endpoint_reports_runtime_flags(self) -> None:
        with running_miniapp_server(allow_debug_user=True, dev_mode=True, bot_token="token-123") as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("GET", "/api/health")

            self.assertEqual(response.status, 200)
            self.assertTrue(response.payload["ok"])
            self.assertTrue(response.payload["bot_token_configured"])
            self.assertTrue(response.payload["debug_user_enabled"])
            self.assertIn("trainer.db", response.payload["db_path"])

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

    def test_session_resolve_reuses_existing_cookie_when_initdata_is_missing(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            first_response = client.request_json("POST", "/api/session/resolve", {})
            second_response = client.request_json("POST", "/api/session/resolve", {})

            self.assertEqual(first_response.status, 200)
            self.assertEqual(second_response.status, 200)
            self.assertEqual(first_response.payload["user"]["id"], second_response.payload["user"]["id"])
            self.assertNotIn("auth_mode", second_response.payload)

    def test_session_resolve_prefers_debug_user_over_existing_non_debug_cookie_in_browser_mode(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            unsafe_response = client.request_json(
                "POST",
                "/api/session/resolve",
                {
                    "initData": "",
                    "unsafeUser": {
                        "id": 555000333,
                        "first_name": "Telegram",
                        "last_name": "Session",
                        "username": "telegram_session",
                    },
                },
            )
            self.assertEqual(unsafe_response.status, 200)
            self.assertEqual(unsafe_response.payload["auth_mode"], "telegram_unsafe")

            browser_response = client.request_json("POST", "/api/session/resolve", {"shell": "browser"})

            self.assertEqual(browser_response.status, 200)
            self.assertEqual(browser_response.payload["auth_mode"], "debug")
            self.assertEqual(browser_response.payload["user"]["auth_source"], "debug")
            self.assertEqual(browser_response.payload["user"]["debug_alias"], "browser-default")

    def test_session_resolve_telegram_shell_does_not_stick_to_debug_user(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            debug_response = client.request_json("POST", "/api/session/resolve", {})
            self.assertEqual(debug_response.status, 200)
            self.assertEqual(debug_response.payload["auth_mode"], "debug")

            telegram_response = client.request_json(
                "POST",
                "/api/session/resolve",
                {
                    "shell": "telegram",
                    "initData": "",
                    "unsafeUser": {
                        "id": 555000444,
                        "first_name": "Telegram",
                        "last_name": "Recovered",
                        "username": "telegram_recovered",
                    },
                },
            )

            self.assertEqual(telegram_response.status, 200)
            self.assertEqual(telegram_response.payload["auth_mode"], "telegram_unsafe")
            self.assertEqual(telegram_response.payload["user"]["auth_source"], "telegram_unsafe")
            self.assertEqual(telegram_response.payload["user"]["telegram_user_id"], 555000444)

    def test_session_resolve_telegram_shell_without_payload_rejects_debug_cookie_when_no_recovery(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            debug_response = client.request_json("POST", "/api/session/resolve", {"shell": "browser"})
            self.assertEqual(debug_response.status, 200)
            self.assertEqual(debug_response.payload["auth_mode"], "debug")

            telegram_response = client.request_json("POST", "/api/session/resolve", {"shell": "telegram"})

            self.assertEqual(telegram_response.status, 401)
            self.assertIn("Open Mini App from Telegram", telegram_response.payload["reason"])

    def test_session_resolve_telegram_shell_without_payload_uses_configured_recovery_user(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            recovery_user = self.provision_recovery_user(
                app,
                telegram_user_id=555000445,
                username="telegram_recovery_empty",
            )

            fresh_client = JsonHttpClient(app.base_url)
            response = fresh_client.request_json("POST", "/api/session/resolve", {"shell": "telegram"})

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "telegram_recovery")
            self.assertEqual(response.payload["user"]["id"], recovery_user["id"])
            self.assertEqual(response.payload["user"]["telegram_user_id"], 555000445)
            self.assertEqual(response.payload["user"]["auth_source"], "telegram_unsafe")

    def test_session_resolve_telegram_shell_prefers_recovery_user_over_existing_debug_cookie(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            recovery_user = self.provision_recovery_user(
                app,
                telegram_user_id=555000446,
                username="telegram_recovery_cookie",
            )

            client = JsonHttpClient(app.base_url)
            debug_response = client.request_json("POST", "/api/session/resolve", {"shell": "browser"})
            self.assertEqual(debug_response.status, 200)
            self.assertEqual(debug_response.payload["auth_mode"], "debug")

            recovery_response = client.request_json("POST", "/api/session/resolve", {"shell": "telegram"})

            self.assertEqual(recovery_response.status, 200)
            self.assertEqual(recovery_response.payload["auth_mode"], "telegram_recovery")
            self.assertEqual(recovery_response.payload["user"]["id"], recovery_user["id"])
            self.assertEqual(recovery_response.payload["user"]["auth_source"], "telegram_unsafe")

    def test_invalid_initdata_without_unsafe_user_can_use_configured_recovery_user(self) -> None:
        with running_miniapp_server(allow_debug_user=False, bot_token="valid-test-token") as app:
            recovery_user = self.provision_recovery_user(
                app,
                telegram_user_id=555000447,
                username="telegram_recovery_invalid",
            )

            client = JsonHttpClient(app.base_url)
            response = client.request_json(
                "POST",
                "/api/session/resolve",
                {
                    "shell": "telegram",
                    "initData": "user=%7B%22id%22%3A1%7D&auth_date=123456&hash=definitely-invalid",
                },
            )

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "telegram_recovery")
            self.assertEqual(response.payload["user"]["id"], recovery_user["id"])

    def test_valid_signed_initdata_takes_precedence_over_configured_recovery_user(self) -> None:
        bot_token = "server-valid-bot-token"
        init_data = build_signed_init_data(
            bot_token,
            auth_date=int(time.time()),
            user={"id": 900101, "first_name": "Signed", "last_name": "Priority", "username": "signed_priority"},
        )
        with running_miniapp_server(allow_debug_user=True, bot_token=bot_token) as app:
            self.provision_recovery_user(
                app,
                telegram_user_id=555000448,
                username="telegram_recovery_signed",
            )

            client = JsonHttpClient(app.base_url)
            response = client.request_json(
                "POST",
                "/api/session/resolve",
                {"shell": "telegram", "initData": init_data},
            )

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "telegram")
            self.assertEqual(response.payload["user"]["telegram_user_id"], 900101)

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

    def test_invalid_initdata_can_fall_back_to_unsafe_telegram_user(self) -> None:
        with running_miniapp_server(allow_debug_user=False, bot_token="valid-test-token") as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json(
                "POST",
                "/api/session/resolve",
                {
                    "initData": "user=%7B%22id%22%3A1%7D&auth_date=123456&hash=definitely-invalid",
                    "unsafeUser": {
                        "id": 555000222,
                        "first_name": "Telegram",
                        "last_name": "Recovered",
                        "username": "telegram_recovered",
                    },
                },
            )

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "telegram_unsafe")
            self.assertIn("Hash mismatch", response.payload["validation_reason"])
            self.assertEqual(response.payload["user"]["auth_source"], "telegram_unsafe")

    def test_invalid_initdata_without_fallback_returns_bad_request(self) -> None:
        with running_miniapp_server(allow_debug_user=False, bot_token="valid-test-token") as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json(
                "POST",
                "/api/session/resolve",
                {"initData": "user=%7B%22id%22%3A1%7D&auth_date=123456&hash=definitely-invalid"},
            )

            self.assertEqual(response.status, 400)
            self.assertIn("Hash mismatch", response.payload["reason"])

    def test_session_resolve_accepts_valid_signed_initdata(self) -> None:
        bot_token = "server-valid-bot-token"
        init_data = build_signed_init_data(
            bot_token,
            auth_date=int(time.time()),
            user={"id": 900100, "first_name": "Signed", "last_name": "User", "username": "signed_user"},
        )
        with running_miniapp_server(allow_debug_user=False, bot_token=bot_token) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("POST", "/api/session/resolve", {"initData": init_data})

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["auth_mode"], "telegram")
            self.assertEqual(response.payload["user"]["telegram_user_id"], 900100)
            self.assertEqual(response.payload["user"]["display_name"], "Signed User")

    def test_get_workouts_uses_debug_fallback_cookie_when_enabled(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("GET", "/api/workouts")

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["user"]["auth_source"], "debug")
            self.assertIn("trainer_session=", response.headers.get("Set-Cookie", ""))

    def test_get_workouts_requires_session_when_debug_is_disabled(self) -> None:
        with running_miniapp_server(allow_debug_user=False) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("GET", "/api/workouts")

            self.assertEqual(response.status, 401)
            self.assertIn("No active session", response.payload["reason"])

    def test_get_body_weights_uses_debug_fallback_cookie_when_enabled(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("GET", "/api/body-weights")

            self.assertEqual(response.status, 200)
            self.assertEqual(response.payload["user"]["auth_source"], "debug")
            self.assertEqual(response.payload["entries"], [])

    def test_get_body_weights_requires_session_when_debug_is_disabled(self) -> None:
        with running_miniapp_server(allow_debug_user=False) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("GET", "/api/body-weights")

            self.assertEqual(response.status, 401)
            self.assertIn("No active session", response.payload["reason"])

    def test_workouts_endpoint_rejects_invalid_payload(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            response = client.request_json(
                "POST",
                "/api/workouts",
                {
                    "client_id": "invalid-workout",
                    "workout_date": "2026-03-28",
                    "plan_id": None,
                    "data": {"notes": None, "load_type": None, "exercises": []},
                },
            )

            self.assertEqual(response.status, 400)
            self.assertIn("at least one exercise", response.payload["reason"])

    def test_workouts_endpoint_is_idempotent_via_api_for_same_client_id(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            first_response = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(client_id="api-idempotent"),
            )
            second_response = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(client_id="api-idempotent"),
            )
            workouts_response = client.request_json("GET", "/api/workouts")

            self.assertEqual(first_response.status, 201)
            self.assertEqual(second_response.status, 200)
            self.assertFalse(second_response.payload["created"])
            self.assertEqual(first_response.payload["workout"]["id"], second_response.payload["workout"]["id"])
            self.assertEqual(len(workouts_response.payload["workouts"]), 1)

    def test_workouts_endpoint_updates_existing_workout_via_put(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            created_response = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(
                    client_id="editable-api-workout",
                    workout_date="2026-03-18",
                    exercise_id=4,
                    exercise_name="Pull Up",
                    weight=10,
                    reps=8,
                ),
            )

            updated_response = client.request_json(
                "PUT",
                f"/api/workouts/{created_response.payload['workout']['id']}",
                sample_workout_payload(
                    client_id="ignored-client-id",
                    workout_date="2026-03-27",
                    exercise_id=4,
                    exercise_name="Pull Up",
                    weight=20,
                    reps=10,
                    notes=" Updated pull-up day ",
                ),
            )

            workouts_response = client.request_json("GET", "/api/workouts")

            self.assertEqual(updated_response.status, 200)
            self.assertEqual(updated_response.payload["workout"]["client_id"], "editable-api-workout")
            self.assertEqual(updated_response.payload["workout"]["workout_date"], "2026-03-27")
            self.assertEqual(updated_response.payload["workout"]["data"]["notes"], "Updated pull-up day")
            self.assertEqual(workouts_response.payload["workouts"][0]["data"]["exercises"][0]["sets"][0]["weight"], 20)

    def test_workouts_endpoint_returns_not_found_for_missing_update(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            response = client.request_json(
                "PUT",
                "/api/workouts/9999",
                sample_workout_payload(client_id="missing-update"),
            )

            self.assertEqual(response.status, 404)
            self.assertIn("Workout not found", response.payload["reason"])

    def test_workouts_endpoint_deletes_existing_workout_via_delete(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            created_response = client.request_json(
                "POST",
                "/api/workouts",
                sample_workout_payload(
                    client_id="delete-api-workout",
                    exercise_id=6,
                    exercise_name="Squat",
                ),
            )

            delete_response = client.request_json(
                "DELETE",
                f"/api/workouts/{created_response.payload['workout']['id']}",
            )
            workouts_response = client.request_json("GET", "/api/workouts")

            self.assertEqual(delete_response.status, 200)
            self.assertTrue(delete_response.payload["deleted"])
            self.assertEqual(delete_response.payload["workout"]["id"], created_response.payload["workout"]["id"])
            self.assertEqual(workouts_response.payload["workouts"], [])

    def test_workouts_endpoint_returns_not_found_for_missing_delete(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            response = client.request_json("DELETE", "/api/workouts/9999")

            self.assertEqual(response.status, 404)
            self.assertIn("Workout not found", response.payload["reason"])

    def test_body_weights_endpoint_saves_and_updates_entries_via_api(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            created_response = client.request_json(
                "POST",
                "/api/body-weights",
                sample_body_weight_payload(entry_date="2026-03-27", weight=82.4),
            )
            updated_response = client.request_json(
                "POST",
                "/api/body-weights",
                sample_body_weight_payload(entry_date="2026-03-27", weight=81.9, notes=" Updated "),
            )
            list_response = client.request_json("GET", "/api/body-weights")

            self.assertEqual(created_response.status, 201)
            self.assertTrue(created_response.payload["created"])
            self.assertEqual(updated_response.status, 200)
            self.assertFalse(updated_response.payload["created"])
            self.assertEqual(updated_response.payload["entry"]["weight"], 81.9)
            self.assertEqual(updated_response.payload["entry"]["notes"], "Updated")
            self.assertEqual(len(list_response.payload["entries"]), 1)

    def test_body_weights_endpoint_rejects_invalid_payload(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            response = client.request_json(
                "POST",
                "/api/body-weights",
                {
                    "entry_date": "2026-03-28",
                    "weight": 0,
                },
            )

            self.assertEqual(response.status, 400)
            self.assertIn("greater than 0", response.payload["reason"])

    def test_body_weights_endpoint_deletes_entry_via_api(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            created_response = client.request_json(
                "POST",
                "/api/body-weights",
                sample_body_weight_payload(entry_date="2026-03-27", weight=82.4),
            )
            delete_response = client.request_json(
                "DELETE",
                f"/api/body-weights/{created_response.payload['entry']['id']}",
            )
            list_response = client.request_json("GET", "/api/body-weights")

            self.assertEqual(delete_response.status, 200)
            self.assertTrue(delete_response.payload["deleted"])
            self.assertEqual(delete_response.payload["entry"]["entry_date"], "2026-03-27")
            self.assertEqual(list_response.payload["entries"], [])

    def test_body_weights_endpoint_returns_not_found_for_missing_delete(self) -> None:
        with running_miniapp_server(allow_debug_user=True) as app:
            client = JsonHttpClient(app.base_url)
            client.request_json("POST", "/api/session/resolve", {})

            response = client.request_json("DELETE", "/api/body-weights/999999")

            self.assertEqual(response.status, 404)
            self.assertIn("not found", response.payload["reason"].lower())

    def test_telegram_auth_endpoint_reports_empty_initdata(self) -> None:
        with running_miniapp_server(allow_debug_user=False) as app:
            client = JsonHttpClient(app.base_url)

            response = client.request_json("POST", "/api/telegram/auth", {"initData": ""})

            self.assertEqual(response.status, 400)
            self.assertIn("initData is empty", response.payload["reason"])

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
