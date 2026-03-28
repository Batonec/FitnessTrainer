from __future__ import annotations

import unittest

from support import WEB_DIR, running_miniapp_server

try:
    from playwright.sync_api import expect, sync_playwright

    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    expect = None
    sync_playwright = None


TELEGRAM_STUB_SCRIPT = """
window.Telegram = {
  WebApp: {
    ready() {},
    expand() {},
    initData: "",
    initDataUnsafe: {}
  }
};
"""


@unittest.skipUnless(HAS_PLAYWRIGHT, "Playwright is not installed")
class MiniAppE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server_context = running_miniapp_server(static_dir=WEB_DIR, allow_debug_user=True)
        cls.app = cls.server_context.__enter__()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()
        cls.server_context.__exit__(None, None, None)

    def setUp(self) -> None:
        self.context = self.browser.new_context(locale="ru-RU")
        self.page = self.context.new_page()
        self.page.route(
            "https://telegram.org/js/telegram-web-app.js*",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript",
                body=TELEGRAM_STUB_SCRIPT,
            ),
        )

    def tearDown(self) -> None:
        self.context.close()

    def open_app(self) -> None:
        self.page.goto(self.app.base_url, wait_until="networkidle")
        expect(self.page.locator(".topbar-title")).to_have_text("Новая тренировка")

    def test_can_create_two_same_day_workouts_and_latest_one_is_first(self) -> None:
        self.open_app()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Squat").click()
        self.page.locator('[data-action="add-standard-set"]').click()
        self.page.locator('[data-action="finish-workout"]').click()
        expect(self.page.locator(".toast")).to_contain_text("Тренировка сохранена")

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Pull Up").click()
        self.page.locator('[data-action="add-standard-set"]').click()
        self.page.locator('[data-action="finish-workout"]').click()
        expect(self.page.locator(".toast")).to_contain_text("Тренировка сохранена")

        self.page.locator('[data-action="switch-tab"][data-tab="trainings"]').click()
        expect(self.page.locator(".workout-card").first).to_contain_text("Pull Up")

    def test_restored_draft_can_be_reset_from_ui(self) -> None:
        self.open_app()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Bench Press").click()
        self.page.locator('[data-action="add-standard-set"]').click()
        self.page.reload(wait_until="networkidle")

        expect(self.page.locator(".draft-banner")).to_contain_text("Восстановлен черновик тренировки")
        self.page.locator('[data-action="finish-exercise"]').click()
        expect(self.page.locator(".exercise-picker")).to_contain_text("показывает только оставшиеся")

        self.page.locator('[data-action="reset-workout-draft"]').first.click()

        expect(self.page.locator(".draft-banner")).to_have_count(0)
        expect(
            self.page.locator('[data-action="select-exercise"]').filter(has_text="Bench Press")
        ).to_be_visible()
        expect(
            self.page.locator('[data-action="select-exercise"]').filter(has_text="Squat")
        ).to_be_visible()


if __name__ == "__main__":
    unittest.main()
