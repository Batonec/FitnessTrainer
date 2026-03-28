from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from support import build_signed_init_data, load_server_module


class ServerUtilsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "trainer.db"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def load_module(
        self,
        *,
        bot_token: str = "server-utils-bot-token",
        session_secret: str = "server-utils-session-secret",
    ):
        return load_server_module(
            db_path=self.db_path,
            bot_token=bot_token,
            session_secret=session_secret,
        )

    def test_build_data_check_string_rejects_missing_hash(self) -> None:
        module = self.load_module()

        with self.assertRaisesRegex(ValueError, "Missing hash"):
            module.build_data_check_string("auth_date=123&user=%7B%22id%22%3A1%7D")

    def test_build_data_check_string_sorts_pairs_and_ignores_signature(self) -> None:
        module = self.load_module()

        data_check_string, received_hash, parsed_fields = module.build_data_check_string(
            "b=2&hash=abc123&signature=ignored&a=1"
        )

        self.assertEqual(data_check_string, "a=1\nb=2")
        self.assertEqual(received_hash, "abc123")
        self.assertEqual(parsed_fields, {"a": "1", "b": "2"})

    def test_validate_init_data_rejects_empty_payload(self) -> None:
        module = self.load_module()

        result = module.validate_init_data("", "token")

        self.assertFalse(result["ok"])
        self.assertIn("initData is empty", result["reason"])

    def test_validate_init_data_rejects_missing_bot_token(self) -> None:
        module = self.load_module(bot_token="")

        result = module.validate_init_data("auth_date=1&hash=abc", "")

        self.assertFalse(result["ok"])
        self.assertIn("BOT_TOKEN is not configured", result["reason"])

    def test_validate_init_data_accepts_valid_signed_payload(self) -> None:
        bot_token = "signed-bot-token"
        module = self.load_module(bot_token=bot_token)
        init_data = build_signed_init_data(
            bot_token,
            auth_date=int(time.time()),
            user={
                "id": 123456,
                "first_name": "Signed",
                "last_name": "User",
                "username": "signed_user",
            },
        )

        result = module.validate_init_data(init_data, bot_token)

        self.assertTrue(result["ok"])
        self.assertTrue(result["auth_is_fresh"])
        self.assertEqual(result["received"]["user"]["id"], 123456)
        self.assertEqual(result["received"]["user"]["username"], "signed_user")

    def test_validate_init_data_marks_old_auth_date_as_not_fresh(self) -> None:
        bot_token = "signed-bot-token"
        module = self.load_module(bot_token=bot_token)
        init_data = build_signed_init_data(
            bot_token,
            auth_date=int(time.time()) - 90000,
            user={"id": 777},
        )

        result = module.validate_init_data(init_data, bot_token)

        self.assertTrue(result["ok"])
        self.assertFalse(result["auth_is_fresh"])
        self.assertGreater(result["auth_age_seconds"], 86400)

    def test_validate_init_data_marks_invalid_auth_date_as_not_fresh(self) -> None:
        bot_token = "signed-bot-token"
        module = self.load_module(bot_token=bot_token)
        init_data = build_signed_init_data(
            bot_token,
            auth_date=int(time.time()),
            user={"id": 888},
            extra_fields={"auth_date": "not-a-number"},
        )

        result = module.validate_init_data(init_data, bot_token)

        self.assertTrue(result["ok"])
        self.assertFalse(result["auth_is_fresh"])
        self.assertIsNone(result["auth_age_seconds"])

    def test_validate_init_data_rejects_hash_mismatch(self) -> None:
        bot_token = "signed-bot-token"
        module = self.load_module(bot_token=bot_token)

        result = module.validate_init_data(
            "auth_date=123456&user=%7B%22id%22%3A1%7D&hash=definitely-invalid",
            bot_token,
        )

        self.assertFalse(result["ok"])
        self.assertIn("Hash mismatch", result["reason"])

    def test_make_session_value_roundtrips_back_to_user_id(self) -> None:
        module = self.load_module(session_secret="roundtrip-secret")

        cookie_value = module.make_session_value(42)

        self.assertEqual(module.read_session_user_id(cookie_value), 42)

    def test_read_session_user_id_rejects_tampered_signature(self) -> None:
        module = self.load_module(session_secret="roundtrip-secret")
        cookie_value = module.make_session_value(42)
        tampered_cookie = f"{cookie_value[:-1]}0"

        self.assertIsNone(module.read_session_user_id(tampered_cookie))

    def test_read_session_user_id_rejects_invalid_cookie_shape(self) -> None:
        module = self.load_module()

        self.assertIsNone(module.read_session_user_id(""))
        self.assertIsNone(module.read_session_user_id("malformed-cookie"))
        self.assertIsNone(module.read_session_user_id("not-an-int.signature"))


if __name__ == "__main__":
    unittest.main()
