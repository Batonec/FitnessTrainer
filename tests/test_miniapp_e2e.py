from __future__ import annotations

import re
import unittest

from support import JsonHttpClient, WEB_DIR, running_miniapp_server, sample_workout_payload

try:
    from playwright.sync_api import expect, sync_playwright

    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    expect = None
    sync_playwright = None


TELEGRAM_STUB_SCRIPT = """
window.__telegramCalls = [];
window.Telegram = {
  WebApp: {
    isFullscreen: false,
    isVerticalSwipesEnabled: true,
    ready() {
      window.__telegramCalls.push("ready");
    },
    expand() {
      window.__telegramCalls.push("expand");
    },
    disableVerticalSwipes() {
      window.__telegramCalls.push("disableVerticalSwipes");
      this.isVerticalSwipesEnabled = false;
    },
    requestFullscreen() {
      window.__telegramCalls.push("requestFullscreen");
      this.isFullscreen = true;
    },
    onEvent(name) {
      window.__telegramCalls.push(`onEvent:${name}`);
    },
    BackButton: {
      show() {},
      hide() {},
      onClick() {},
      offClick() {}
    },
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
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")

    def open_new_workout(self) -> None:
        self.page.locator('[data-action="open-new-workout"]').click()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Новая тренировка")

    def add_default_set(self) -> None:
        self.page.locator('[data-action="start-adding-set"]').click()
        self.page.locator('[data-action="set-apply"]').click()

    def reveal_workout_actions(self, card_locator, *, vertical_shift: float = 0) -> None:
        surface = card_locator.locator('[data-workout-swipe-surface]').first
        surface.scroll_into_view_if_needed()
        box = surface.bounding_box()
        self.assertIsNotNone(box)
        start_x = box["x"] + box["width"] - 18
        end_x = start_x - 150
        y = box["y"] + min(48, box["height"] / 2)
        end_y = y + vertical_shift

        self.page.mouse.move(start_x, y)
        self.page.mouse.down()
        self.page.mouse.move(end_x, end_y, steps=12)
        self.page.mouse.up()
        expect(surface).to_have_class(re.compile(r".*workout-card-surface-open.*"))

    def click_workout_action(self, card_locator, action: str) -> None:
        button = card_locator.locator(f'[data-action="{action}"]').first
        button.scroll_into_view_if_needed()
        box = button.bounding_box()
        self.assertIsNotNone(box)
        self.page.mouse.click(
            box["x"] + box["width"] / 2,
            box["y"] + box["height"] / 2,
        )

    def hide_workout_actions_with_swipe(self, card_locator) -> None:
        surface = card_locator.locator('[data-workout-swipe-surface]').first
        surface.scroll_into_view_if_needed()
        box = surface.bounding_box()
        self.assertIsNotNone(box)
        start_x = box["x"] + max(72, box["width"] * 0.38)
        end_x = min(box["x"] + box["width"] - 18, start_x + 180)
        y = box["y"] + min(48, box["height"] / 2)

        self.page.mouse.move(start_x, y)
        self.page.mouse.down()
        self.page.mouse.move(end_x, y, steps=12)
        self.page.mouse.up()
        expect(surface).not_to_have_class(re.compile(r".*workout-card-surface-open.*"))

    def tap_workout_action_background(self, card_locator) -> None:
        actions = card_locator.locator("[data-workout-swipe-actions]").first
        actions.scroll_into_view_if_needed()
        box = actions.bounding_box()
        self.assertIsNotNone(box)
        self.page.mouse.click(box["x"] + box["width"] - 26, box["y"] + 16)

    def open_workout_actions_via_test_api(self, card_locator) -> None:
        surface = card_locator.locator('[data-workout-swipe-surface]').first
        workout_id = surface.get_attribute("data-workout-id")
        self.assertIsNotNone(workout_id)
        self.page.evaluate(
            "(workoutId) => window.__trainerMiniAppTestApi.openWorkoutSwipe(workoutId)",
            workout_id,
        )
        expect(surface).to_have_class(re.compile(r".*workout-card-surface-open.*"))

    def seed_progress_workouts(self) -> None:
        client = JsonHttpClient(self.app.base_url)
        client.request_json("POST", "/api/session/resolve", {})
        client.request_json(
            "POST",
            "/api/workouts",
            sample_workout_payload(
                client_id="progress-legext-1",
                workout_date="2026-03-10",
                exercise_id=16,
                exercise_name="Разгибания ног",
                weight=120.0,
                reps=10,
            ),
        )
        client.request_json(
            "POST",
            "/api/workouts",
            sample_workout_payload(
                client_id="progress-legext-2",
                workout_date="2026-03-18",
                exercise_id=16,
                exercise_name="Разгибания ног",
                weight=140.0,
                reps=12,
            ),
        )
        client.request_json(
            "POST",
            "/api/workouts",
            sample_workout_payload(
                client_id="progress-legext-3",
                workout_date="2026-03-26",
                exercise_id=16,
                exercise_name="Разгибания ног",
                weight=150.0,
                reps=14,
            ),
        )

    def seed_single_workout(
        self,
        *,
        client_id: str,
        workout_date: str,
        exercise_id: int,
        exercise_name: str,
        weight: float,
        reps: int,
    ) -> dict:
        client = JsonHttpClient(self.app.base_url)
        client.request_json("POST", "/api/session/resolve", {})
        response = client.request_json(
            "POST",
            "/api/workouts",
            sample_workout_payload(
                client_id=client_id,
                workout_date=workout_date,
                exercise_id=exercise_id,
                exercise_name=exercise_name,
                weight=weight,
                reps=reps,
            ),
        )
        return response.payload["workout"]

    def seed_workout_history(self, count: int = 12) -> None:
        for index in range(count):
            self.seed_single_workout(
                client_id=f"history-seed-{index}",
                workout_date=f"2026-03-{index + 1:02d}",
                exercise_id=700 + index,
                exercise_name=f"История {index + 1}",
                weight=40.0 + index,
                reps=10 + (index % 4),
            )

    def test_can_create_two_same_day_workouts_and_latest_one_is_first(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим ногами").click()
        self.add_default_set()
        self.page.locator('[data-action="finish-workout"]').click()
        expect(self.page.locator(".toast")).to_contain_text("Тренировка сохранена")

        self.open_new_workout()
        self.page.locator('[data-action="select-exercise"]').filter(has_text="Тяга верт.").click()
        self.add_default_set()
        self.page.locator('[data-action="finish-workout"]').click()
        expect(self.page.locator(".toast")).to_contain_text("Тренировка сохранена")

        expect(self.page.locator(".workout-card").first).to_contain_text("Тяга верт.")

    def test_swiping_workout_card_reveals_actions(self) -> None:
        self.seed_single_workout(
            client_id="swipe-gesture-test",
            workout_date="2026-03-29",
            exercise_id=777,
            exercise_name="Свайп тест",
            weight=70.0,
            reps=10,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Свайп тест")
        self.reveal_workout_actions(target_card)
        expect(target_card.locator('[data-action="edit-workout"]')).to_be_visible()
        expect(target_card.locator('[data-action="delete-workout"]')).to_be_visible()

    def test_mild_diagonal_swipe_still_reveals_actions(self) -> None:
        self.seed_single_workout(
            client_id="swipe-diagonal-test",
            workout_date="2026-03-29",
            exercise_id=780,
            exercise_name="Диагональный свайп",
            weight=75.0,
            reps=8,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Диагональный свайп")
        self.reveal_workout_actions(target_card, vertical_shift=24)
        expect(target_card.locator('[data-action="edit-workout"]')).to_be_visible()

    def test_telegram_shell_requests_fullscreen_and_disables_vertical_swipes(self) -> None:
        self.open_app()

        calls = self.page.evaluate("window.__telegramCalls")
        self.assertIn("ready", calls)
        self.assertIn("expand", calls)
        self.assertIn("disableVerticalSwipes", calls)
        self.assertIn("requestFullscreen", calls)
        self.assertIn("onEvent:activated", calls)
        self.assertTrue(self.page.evaluate("window.Telegram.WebApp.isFullscreen"))
        self.assertFalse(self.page.evaluate("window.Telegram.WebApp.isVerticalSwipesEnabled"))

    def test_open_swipe_card_can_be_closed_by_swiping_right(self) -> None:
        self.seed_single_workout(
            client_id="swipe-close-right-test",
            workout_date="2026-03-28",
            exercise_id=778,
            exercise_name="Свайп закрытие",
            weight=72.5,
            reps=9,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Свайп закрытие")
        self.reveal_workout_actions(target_card)
        self.hide_workout_actions_with_swipe(target_card)

    def test_open_swipe_card_can_be_closed_by_tapping_free_action_area(self) -> None:
        self.seed_single_workout(
            client_id="swipe-close-background-test",
            workout_date="2026-03-27",
            exercise_id=779,
            exercise_name="Тап закрытие",
            weight=67.5,
            reps=11,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Тап закрытие")
        self.reveal_workout_actions(target_card)
        self.tap_workout_action_background(target_card)
        expect(
            target_card.locator('[data-workout-swipe-surface]').first
        ).not_to_have_class(re.compile(r".*workout-card-surface-open.*"))

    def test_restored_draft_can_be_reset_from_ui(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим гор.").click()
        self.add_default_set()
        self.page.reload(wait_until="networkidle")

        expect(self.page.locator(".draft-banner")).to_contain_text("Восстановлен черновик тренировки")
        self.page.locator('[data-action="finish-exercise"]').click()
        expect(self.page.locator(".exercise-picker")).to_contain_text("показывает только оставшиеся")

        self.page.locator('[data-action="reset-workout-draft"]').first.click()

        expect(self.page.locator(".draft-banner")).to_have_count(0)
        expect(
            self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим гор.")
        ).to_be_visible()
        expect(
            self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим ногами")
        ).to_be_visible()

    def test_can_leave_new_workout_and_resume_saved_draft(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим ногами").click()
        self.add_default_set()
        self.page.locator('[data-action="close-new-workout"]').click()

        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")
        expect(self.page.locator('[data-action="open-new-workout"]')).to_be_visible()

        self.open_new_workout()

        expect(self.page.locator(".draft-banner")).to_contain_text("Восстановлен черновик тренировки")
        expect(self.page.locator(".exercise-card").filter(has_text="Жим ногами")).to_be_visible()

    def test_returning_from_new_restores_trainings_scroll_position(self) -> None:
        self.seed_workout_history()
        self.open_app()

        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        self.page.wait_for_timeout(150)
        initial_scroll = self.page.evaluate("window.scrollY")
        self.assertGreater(initial_scroll, 300)

        self.open_new_workout()
        self.page.locator('[data-action="close-new-workout"]').click()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")
        self.page.wait_for_function(f"() => window.scrollY >= {max(0, int(initial_scroll) - 24)}")

    def test_tapping_active_trainings_tab_scrolls_back_to_top(self) -> None:
        self.seed_workout_history()
        self.open_app()

        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        self.page.wait_for_timeout(150)
        self.assertGreater(self.page.evaluate("window.scrollY"), 300)

        self.page.locator('[data-action="switch-tab"][data-tab="trainings"]').click()
        self.page.wait_for_function("() => window.scrollY <= 4")

    def test_browser_back_closes_new_workout_and_keeps_draft(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.page.locator('[data-action="select-exercise"]').filter(has_text="Жим ногами").click()
        self.add_default_set()
        self.page.go_back()

        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")
        self.open_new_workout()
        expect(self.page.locator(".draft-banner")).to_contain_text("Восстановлен черновик тренировки")

    def test_progress_screen_shows_weight_and_rep_growth_for_selected_exercise(self) -> None:
        self.seed_progress_workouts()
        self.open_app()

        self.page.locator('[data-action="switch-tab"][data-tab="progress"]').click()
        self.page.locator("#progress-exercise").select_option("16")

        expect(self.page.locator(".topbar-title")).to_have_text("Progress")
        expect(self.page.locator(".metric-card")).to_contain_text("Тренировок за период")
        expect(self.page.locator("#progress-exercise")).to_have_value("16")
        expect(self.page.locator(".progress-panel")).to_contain_text("Разгибания ног")
        expect(self.page.locator(".progress-summary-grid")).to_contain_text("Изменение")
        expect(self.page.locator(".progress-summary-grid")).to_contain_text("+30 кг / +4 повт.")
        expect(self.page.locator(".progress-chart")).to_be_visible()

    def test_topbar_shows_current_user_id_badge(self) -> None:
        self.open_app()

        expect(self.page.locator(".topbar-meta")).to_contain_text("UID 1")

    def test_swipe_does_not_block_switch_to_progress_tab(self) -> None:
        self.seed_single_workout(
            client_id="swipe-tab-bug",
            workout_date="2026-03-29",
            exercise_id=781,
            exercise_name="Тап по прогрессу",
            weight=80.0,
            reps=10,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Тап по прогрессу")
        self.reveal_workout_actions(target_card)
        self.page.locator('[data-action="switch-tab"][data-tab="progress"]').click()

        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Progress")

    def test_swipe_does_not_block_open_new_workout_button(self) -> None:
        self.seed_single_workout(
            client_id="swipe-fab-bug",
            workout_date="2026-03-29",
            exercise_id=782,
            exercise_name="Тап по плюсу",
            weight=82.5,
            reps=9,
        )
        self.open_app()

        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Тап по плюсу")
        self.reveal_workout_actions(target_card)
        self.page.locator('[data-action="open-new-workout"]').click()

        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Новая тренировка")

    def test_can_edit_workout_from_history(self) -> None:
        self.seed_single_workout(
            client_id="editable-e2e",
            workout_date="2026-03-21",
            exercise_id=915,
            exercise_name="Редактируемый тест",
            weight=120.0,
            reps=12,
        )
        self.open_app()

        self.page.locator('[data-action="switch-tab"][data-tab="trainings"]').click()
        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Редактируемый тест")
        self.open_workout_actions_via_test_api(target_card)
        self.click_workout_action(target_card, "edit-workout")

        expect(self.page.locator(".topbar-title")).to_have_text("Редактирование")
        expect(self.page.locator("#workout-date")).to_have_value("2026-03-21")

        self.page.locator('[data-action="edit-draft-set"]').first.click()
        self.page.locator('[data-action="set-weight-inc"]').click()
        self.page.locator('[data-action="set-reps-inc"]').click()
        self.page.locator('[data-action="set-apply"]').click()
        self.page.locator("#workout-date").fill("2026-03-22")
        self.page.locator('[data-action="finish-workout"]').click()

        expect(self.page.locator(".toast")).to_contain_text("Изменения в тренировке сохранены")
        expect(self.page.locator(".topbar-title")).to_have_text("Trainings")
        updated_card = self.page.locator(".workout-card").filter(has_text="Редактируемый тест")
        expect(updated_card).to_contain_text("22 марта 2026")
        expect(updated_card).to_contain_text("122,5 кг × 13")

    def test_can_delete_workout_from_history(self) -> None:
        self.seed_single_workout(
            client_id="deletable-e2e",
            workout_date="2026-03-23",
            exercise_id=998,
            exercise_name="Удаляемый тест",
            weight=55.0,
            reps=12,
        )
        self.open_app()

        self.page.locator('[data-action="switch-tab"][data-tab="trainings"]').click()
        self.page.on("dialog", lambda dialog: dialog.accept())
        target_card = self.page.locator(".workout-swipe-card").filter(has_text="Удаляемый тест")
        self.open_workout_actions_via_test_api(target_card)
        self.click_workout_action(target_card, "delete-workout")

        expect(self.page.locator(".toast")).to_contain_text("Тренировка удалена")
        expect(self.page.locator(".workout-card").filter(has_text="Удаляемый тест")).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
