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
    initDataUnsafe: {
      user: {
        id: 56575086,
        first_name: "Alexander",
        last_name: "Makushev",
        username: "batonec",
        language_code: "ru"
      }
    }
  }
};
"""

TELEGRAM_TEST_USER = {
    "id": 56575086,
    "first_name": "Alexander",
    "last_name": "Makushev",
    "username": "batonec",
    "language_code": "ru",
}


@unittest.skipUnless(HAS_PLAYWRIGHT, "Playwright is not installed")
class MiniAppE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self) -> None:
        self.server_context = running_miniapp_server(static_dir=WEB_DIR, allow_debug_user=True)
        self.app = self.server_context.__enter__()
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
        self.server_context.__exit__(None, None, None)

    def open_app(self) -> None:
        self.page.goto(self.app.base_url, wait_until="networkidle")
        expect(self.page.locator('.bottom-nav [data-action="switch-tab"][data-tab="trainings"]')).to_have_count(1)

    def telegram_seed_client(self) -> JsonHttpClient:
        client = JsonHttpClient(self.app.base_url)
        client.request_json(
            "POST",
            "/api/session/resolve",
            {
                "shell": "telegram",
                "initData": "",
                "unsafeUser": dict(TELEGRAM_TEST_USER),
            },
        )
        return client

    def open_new_workout(self) -> None:
        self.page.locator('[data-action="open-new-workout"]').click()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Новая тренировка")
        if self.page.locator(".plan-start-banner").count():
            self.page.locator(".plan-start-banner [data-action=\"start-adding-exercise\"]").click()

    def open_new_workout_with_plan(self) -> None:
        self.page.locator('[data-action="open-new-workout"]').click()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Новая тренировка")
        expect(self.page.locator(".plan-start-banner")).to_be_visible()

    def leave_new_workout(self) -> None:
        self.page.go_back()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")

    def respond_to_next_dialog(self, *, accept: bool, contains: str | None = None) -> None:
        def handler(dialog) -> None:
            if contains is not None:
                self.assertIn(contains, dialog.message)
            if accept:
                dialog.accept()
            else:
                dialog.dismiss()

        self.page.once("dialog", handler)

    def add_default_set(self) -> None:
        if self.page.locator(".modal-card").count() == 0:
            self.page.locator('[data-action="start-adding-set"]').click()
        self.page.locator('[data-action="set-apply"]').click()

    def select_exercise_by_name(self, name: str) -> None:
        target = self.page.locator('[data-action="select-exercise"]').filter(has_text=name)
        if target.count() == 0 and self.page.locator('[data-action="toggle-more-exercises"]').count():
            self.page.locator('[data-action="toggle-more-exercises"]').click()
        target = self.page.locator('[data-action="select-exercise"]').filter(has_text=name)
        if target.count():
            target.click()
            return

        card = self.page.locator(".exercise-card").filter(has_text=name).first
        expect(card).to_have_count(1)
        exercise_id = card.get_attribute("data-draft-exercise-id")
        self.assertIsNotNone(exercise_id)
        self.page.evaluate(
            "(exerciseId) => window.__trainerMiniAppTestApi.openDraftExerciseEditor(exerciseId)",
            exercise_id,
        )

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
        client = self.telegram_seed_client()
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
        client = self.telegram_seed_client()
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

    def seed_multi_exercise_workout(
        self,
        *,
        client_id: str,
        workout_date: str,
        exercises: list[dict],
    ) -> dict:
        client = self.telegram_seed_client()
        response = client.request_json(
            "POST",
            "/api/workouts",
            {
                "client_id": client_id,
                "workout_date": workout_date,
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": "medium",
                    "exercises": exercises,
                },
            },
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

    def seed_next_workout_plan_source(self) -> None:
        client = self.telegram_seed_client()
        client.request_json(
            "POST",
            "/api/workouts",
            {
                "client_id": "older-plan-seed",
                "workout_date": "2026-03-21",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": "light",
                    "exercises": [
                        {
                            "exercise_id": 401,
                            "name": "Старый план",
                            "sets": [
                                {
                                    "reps": 8,
                                    "weight": 50,
                                }
                            ],
                        }
                    ],
                },
            },
        )
        client.request_json(
            "POST",
            "/api/workouts",
            {
                "client_id": "latest-plan-seed",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": "medium",
                    "exercises": [
                        {
                            "exercise_id": 11,
                            "name": "Жим ногами",
                            "sets": [
                                {
                                    "reps": 15,
                                    "weight": 80,
                                },
                                {
                                    "reps": 15,
                                    "weight": 80,
                                },
                                {
                                    "reps": 15,
                                    "weight": 80,
                                },
                            ],
                        },
                        {
                            "exercise_id": 12,
                            "name": "Тяга верт.",
                            "sets": [
                                {
                                    "reps": 12,
                                    "weight": 60,
                                },
                                {
                                    "reps": 10,
                                    "weight": 65,
                                },
                            ],
                        },
                    ],
                },
            },
        )

    def seed_popular_exercise_picker_history(self) -> None:
        client = self.telegram_seed_client()

        base_exercises = [
            (8, "Жим ногами", 120, 15),
            (1, "Жим гор.", 50, 12),
            (9, "Тяга верт.", 60, 12),
            (13, "Дельты", 17.5, 15),
            (11, "Бицепс", 30, 12),
            (12, "Трицепс", 35, 12),
        ]

        for offset, workout_date in enumerate(["2026-03-18", "2026-03-22", "2026-03-26"]):
            client.request_json(
                "POST",
                "/api/workouts",
                {
                    "client_id": f"picker-core-{offset}",
                    "workout_date": workout_date,
                    "plan_id": None,
                    "data": {
                        "notes": None,
                        "load_type": "medium",
                        "exercises": [
                            {
                                "exercise_id": exercise_id,
                                "name": exercise_name,
                                "sets": [
                                    {
                                        "reps": reps,
                                        "weight": weight,
                                    }
                                ],
                            }
                            for exercise_id, exercise_name, weight, reps in base_exercises
                        ],
                    },
                },
            )

        client.request_json(
            "POST",
            "/api/workouts",
            {
                "client_id": "picker-rare-butterfly",
                "workout_date": "2026-03-28",
                "plan_id": None,
                "data": {
                    "notes": None,
                    "load_type": "light",
                    "exercises": [
                        {
                            "exercise_id": 17,
                            "name": "Бабочка",
                            "sets": [
                                {
                                    "reps": 12,
                                    "weight": 40,
                                }
                            ],
                        }
                    ],
                },
            },
        )

    def test_can_create_two_same_day_workouts_and_latest_one_is_first(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.locator('[data-action="finish-workout"]').click()
        expect(self.page.locator(".toast")).to_contain_text("Тренировка сохранена")

        self.open_new_workout()
        self.select_exercise_by_name("Тяга верт.")
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

    def test_trainings_screen_hides_next_workout_plan_when_feature_disabled(self) -> None:
        self.seed_next_workout_plan_source()

        self.open_app()

        expect(self.page.locator(".next-plan-card")).to_have_count(0)
        expect(self.page.locator(".workout-card").filter(has_text="Жим ногами")).to_be_visible()
        expect(self.page.locator(".workout-card").filter(has_text="Тяга верт.")).to_be_visible()
        expect(self.page.locator(".workout-card .load-badge")).to_have_count(0)

    def test_new_workout_does_not_prefill_from_next_workout_plan_when_feature_disabled(self) -> None:
        self.seed_next_workout_plan_source()
        self.open_app()

        self.open_new_workout()

        expect(self.page.locator(".plan-start-banner")).to_have_count(0)
        expect(self.page.locator(".exercise-card").first).to_be_visible()
        expect(self.page.locator('[data-action="toggle-more-exercises"]')).to_have_count(1)

    def test_exercise_picker_prioritizes_main_history_block_and_hides_rest_under_more(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        for exercise_name in [
            "Жим ногами",
            "Тяга верт.",
            "Дельты",
            "Бицепс",
            "Трицепс",
            "Бабочка",
        ]:
            expect(self.page.locator(".exercise-card").filter(has_text=exercise_name)).to_have_count(1)

        expect(self.page.locator(".exercise-card").filter(has_text="Жим гор.")).to_have_count(0)
        expect(self.page.locator(".exercise-card").filter(has_text="Жим в тренажере")).to_have_count(0)
        self.page.locator('[data-action="toggle-more-exercises"]').click()
        expect(self.page.locator('[data-action="toggle-more-exercises"]')).to_have_text("Скрыть")
        expect(self.page.locator(".exercise-picker-group-secondary .exercise-picker-group-title")).to_have_count(0)
        expect(self.page.locator(".exercise-picker-group-secondary")).to_contain_text("Жим гор.")
        expect(self.page.locator(".exercise-picker-group-secondary")).to_contain_text("Жим в тренажере")

    def test_exercise_picker_returns_empty_selection_back_to_picker_on_cancel(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.page.locator(".modal-overlay").click(position={"x": 16, "y": 16})

        leg_press_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(leg_press_card).to_have_count(1)
        expect(leg_press_card.locator(".set-row")).to_have_count(0)
        expect(self.page.locator(".exercise-card").filter(has_text="Трицепс")).to_have_count(1)
        expect(self.page.locator(".exercise-card").filter(has_text="Бабочка")).to_have_count(1)
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

    def test_set_modal_closes_on_overlay_tap(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        expect(self.page.locator(".modal-card")).to_be_visible()

        self.page.locator(".modal-overlay").click(position={"x": 16, "y": 16})

        expect(self.page.locator(".modal-card")).to_have_count(0)
        expect(self.page.locator(".exercise-card").filter(has_text="Жим ногами")).to_have_count(1)
        expect(self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(".set-row")).to_have_count(0)

    def test_primary_preview_card_turns_into_real_draft_after_first_set(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        leg_press_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(leg_press_card).to_be_visible()
        expect(leg_press_card.locator(".set-row")).to_have_count(1)
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(1)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(1)

    def test_draft_exercise_card_uses_compact_inline_action_icons(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(card.locator(".draft-exercise-icon-slot svg")).to_have_count(1)
        title_row_classes = self.page.evaluate(
            """
            () => Array.from(
              document.querySelector('.exercise-card .draft-exercise-title-row').children
            ).map((node) => node.className)
            """
        )
        self.assertEqual(title_row_classes[0], "exercise-name")
        self.assertEqual(title_row_classes[1], "draft-exercise-icon-slot")
        expect(card.locator(".draft-primary-add-button")).to_have_attribute(
            "data-longpress-action", "continue-exercise"
        )
        expect(card.locator(".draft-primary-add-button")).to_have_attribute(
            "data-action", "quick-standard-set"
        )
        expect(card.locator(".draft-primary-add-button")).to_have_attribute(
            "title", "Тап: сет по плану · удержание: свой сет"
        )
        expect(card.locator(".draft-primary-add-button svg")).to_have_count(1)
        expect(card.locator('[data-action="remove-last-draft-set"]')).to_have_count(0)
        expect(card.locator('[data-action="remove-draft-exercise"]')).to_have_count(0)
        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(8)")
        expect(self.page.locator('.draft-card-action-sheet [data-action="remove-last-draft-set"]')).to_have_attribute("data-exercise-id", "8")
        expect(self.page.locator('.draft-card-action-sheet [data-action="remove-draft-exercise"]')).to_have_attribute("data-exercise-id", "8")
        expect(card.locator(".set-row-remove-button")).to_have_count(0)

    def test_draft_exercise_card_shows_compact_progression_reference_line(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="draft-reference-summary",
            workout_date="2026-03-28",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 15, "weight": 80},
                        {"reps": 15, "weight": 80},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        reference = card.locator(".draft-exercise-reference-line")
        expect(reference).to_contain_text("80кг ×15×3")
        expect(reference).to_contain_text("→")
        expect(reference).to_contain_text("16×3")
        self.assertEqual(
            self.page.evaluate(
                "() => getComputedStyle(document.querySelector('.draft-exercise-reference-line')).flexWrap"
            ),
            "wrap",
        )

    def test_set_modal_shows_last_workout_reference_and_plus_one_target(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="draft-reference-modal",
            workout_date="2026-03-30",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 15, "weight": 80},
                        {"reps": 15, "weight": 80},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")

        reference = self.page.locator(".draft-set-reference-card")
        expect(self.page.locator(".modal-heading")).to_have_count(0)
        expect(self.page.locator('[data-action="set-cancel"]')).to_have_count(0)
        expect(reference.locator(".draft-set-reference-title-row")).to_contain_text("Жим ногами")
        expect(reference.locator(".draft-set-reference-line")).to_contain_text("80кг ×15×3")
        expect(reference.locator(".draft-set-reference-line")).to_contain_text("→")
        expect(reference.locator(".draft-set-reference-line")).to_contain_text("16×3")
        expect(self.page.locator(".value-display-number").first).to_have_text("80")
        expect(self.page.locator(".value-display-number").nth(1)).to_have_text("16")
        expect(self.page.locator(".value-display-compact").first).to_contain_text("кг")
        expect(self.page.locator(".value-display-compact").nth(1)).to_contain_text("ПТ")
        expect(self.page.locator(".set-stepper-button svg")).to_have_count(4)
        stepper_columns = self.page.evaluate(
            """
            () => Array.from(document.querySelectorAll('.set-value-stepper')).map(
              (node) => getComputedStyle(node).gridTemplateColumns
            )
            """
        )
        self.assertEqual(len(set(stepper_columns)), 1)
        self.assertIn("58px", stepper_columns[0])
        self.assertGreaterEqual(
            self.page.evaluate(
                "() => parseFloat(getComputedStyle(document.querySelector('.set-stepper-button')).width)"
            ),
            56,
        )
        self.assertGreaterEqual(
            self.page.evaluate(
                "() => parseFloat(getComputedStyle(document.querySelector('.set-value-stepper')).columnGap)"
            ),
            16,
        )
        self.assertEqual(
            self.page.evaluate(
                "() => getComputedStyle(document.querySelector('.draft-set-reference-line')).flexWrap"
            ),
            "wrap",
        )

    def test_draft_exercise_card_can_remove_last_set_from_header_action(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(
            ".draft-primary-add-button"
        ).click()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(card.locator(".set-row")).to_have_count(1)
        expect(card.locator(".draft-set-summary-value")).to_contain_text("×2")

        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(8)")
        self.page.locator('.draft-card-action-sheet [data-action="remove-last-draft-set"]').click()
        expect(card.locator(".set-row")).to_have_count(1)
        expect(card.locator(".draft-set-summary-value")).not_to_contain_text("×2")

    def test_quick_add_uses_next_planned_set_values_from_last_workout(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="draft-quick-plan-seed",
            workout_date="2026-03-30",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 13, "weight": 90},
                        {"reps": 12, "weight": 90},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        card.locator(".draft-primary-add-button").click()

        expect(card.locator(".draft-set-summary-value")).to_have_text("80кг ×16")

    def test_quick_add_advances_through_planned_set_sequence(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="draft-quick-plan-sequence",
            workout_date="2026-03-31",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 13, "weight": 90},
                        {"reps": 12, "weight": 90},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        card.locator(".draft-primary-add-button").click()
        card.locator(".draft-primary-add-button").click()
        card.locator(".draft-primary-add-button").click()

        expect(card.locator(".draft-set-summary-value")).to_contain_text("80кг ×16")
        expect(card.locator(".draft-set-summary-value")).to_contain_text("90кг ×14, 13")

    def test_set_modal_uses_same_planned_sequence_as_quick_add(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="draft-plan-shared-sequence",
            workout_date="2026-04-01",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 13, "weight": 90},
                        {"reps": 12, "weight": 90},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        card.locator(".draft-primary-add-button").click()
        expect(card.locator(".draft-set-summary-value")).to_have_text("80кг ×16")

        self.select_exercise_by_name("Жим ногами")

        expect(self.page.locator(".value-display-number").first).to_have_text("90")
        expect(self.page.locator(".value-display-number").nth(1)).to_have_text("14")

    def test_exercise_picker_shows_completion_message_when_primary_tiles_are_exhausted(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        for exercise_name in [
            "Жим ногами",
            "Тяга верт.",
            "Дельты",
            "Бицепс",
            "Трицепс",
            "Бабочка",
        ]:
            self.select_exercise_by_name(exercise_name)
            self.add_default_set()

        picker = self.page.locator(".exercise-picker")
        expect(picker.locator(".exercise-picker-complete-title")).to_contain_text("Круто, тренировка закончена")
        expect(picker.locator(".exercise-picker-complete")).not_to_contain_text(
            "Основная плитка уже закончилась"
        )
        expect(picker.locator(".exercise-picker-more-toggle")).to_contain_text("Ещё упражнения")
        expect(picker).not_to_contain_text("Жим гор.")
        expect(picker).not_to_contain_text("Жим в тренажере")

        self.page.locator('[data-action="toggle-more-exercises"]').click()
        expect(picker).to_contain_text("Скрыть")
        expect(picker).to_contain_text("Жим гор.")
        expect(picker).to_contain_text("Жим в тренажере")

    def test_newly_added_exercise_scrolls_above_fab_on_small_viewport(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.open_app()
        self.open_new_workout()

        for exercise_name in ["Жим ногами", "Тяга верт.", "Дельты", "Бицепс"]:
            self.select_exercise_by_name(exercise_name)
            self.add_default_set()
            self.page.wait_for_timeout(150)

        self.select_exercise_by_name("Трицепс")
        self.add_default_set()
        self.page.wait_for_timeout(500)

        last_card = self.page.locator('[data-draft-exercise-id="12"]').first
        fab = self.page.locator('.floating-action-button-save').first
        picker = self.page.locator(".exercise-picker").first

        last_card_box = last_card.bounding_box()
        fab_box = fab.bounding_box()
        picker_box = picker.bounding_box()

        self.assertIsNotNone(last_card_box)
        self.assertIsNotNone(fab_box)
        self.assertIsNotNone(picker_box)
        self.assertLess(last_card_box["y"] + last_card_box["height"], fab_box["y"] - 8)
        self.assertLess(picker_box["y"], fab_box["y"] - 8)

    def test_new_workout_fabs_appear_only_after_first_real_set(self) -> None:
        self.open_app()
        self.open_new_workout()

        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

        self.select_exercise_by_name("Жим ногами")
        expect(self.page.locator(".modal-card")).to_be_visible()
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

        self.page.locator(".modal-overlay").click(position={"x": 16, "y": 16})
        expect(self.page.locator(".exercise-card")).to_have_count(6)
        expect(
            self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(".set-row")
        ).to_have_count(0)
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(1)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(1)

    def test_workout_progress_ring_updates_only_for_exercises_with_sets(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.page.wait_for_timeout(100)
        self.assertEqual(
            self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()"),
            0,
        )
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)

        self.page.locator(".modal-overlay").click(position={"x": 16, "y": 16})
        self.page.wait_for_timeout(100)
        self.assertEqual(
            self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()"),
            0,
        )

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > 0"
        )
        first_ratio = self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()")
        self.assertAlmostEqual(first_ratio, 1 / 6, delta=0.02)
        expect(self.page.locator('[data-action="open-new-workout"].has-progress')).to_have_count(0)

        self.leave_new_workout()
        expect(self.page.locator('[data-action="open-new-workout"].has-progress')).to_have_count(1)

        self.open_new_workout()
        self.select_exercise_by_name("Тяга верт.")
        self.add_default_set()
        self.page.wait_for_function(
            f"() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > {first_ratio + 0.01}"
        )
        second_ratio = self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()")
        self.assertAlmostEqual(second_ratio, 2 / 6, delta=0.02)

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

    def test_body_weight_screen_can_save_entry_and_render_chart(self) -> None:
        self.open_app()

        self.page.locator('[data-action="switch-tab"][data-tab="body"]').click()
        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Вес тела")

        self.page.locator('[data-action="change-body-weight-value"]').fill("82.4")
        self.page.locator('[data-action="save-body-weight"]').click()

        expect(self.page.locator(".toast")).to_contain_text("Вес тела сохранён")
        expect(self.page.locator(".body-weight-stats-strip")).to_contain_text("82,4 кг")
        expect(self.page.locator(".body-weight-chart-wrap")).to_be_visible()

    def test_body_weight_screen_prefills_existing_entry_for_selected_date(self) -> None:
        client = self.telegram_seed_client()
        client.request_json(
            "POST",
            "/api/body-weights",
            {
                "entry_date": "2026-03-28",
                "weight": 81.3,
                "notes": None,
            },
        )

        self.open_app()
        self.page.locator('[data-action="switch-tab"][data-tab="body"]').click()
        self.page.locator('[data-action="change-body-weight-date"]').fill("2026-03-28")

        expect(self.page.locator('[data-action="change-body-weight-value"]')).to_have_value("81.3")

    def test_body_weight_chart_flow_can_delete_entry_after_confirmation(self) -> None:
        self.telegram_seed_client().request_json(
            "POST",
            "/api/body-weights",
            {
                "entry_date": "2026-03-28",
                "weight": 81.3,
                "notes": None,
            },
        )

        self.open_app()
        self.page.locator('[data-action="switch-tab"][data-tab="body"]').click()
        expect(self.page.locator(".body-weight-chart-wrap")).to_be_visible()

        entry_id = self.page.evaluate("window.__trainerMiniAppTestApi.getBodyWeightEntries()[0].id")
        self.respond_to_next_dialog(accept=True, contains="Удалить запись веса")
        self.page.evaluate(
            "(entryId) => window.__trainerMiniAppTestApi.deleteBodyWeightEntry(entryId)",
            entry_id,
        )

        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getBodyWeightEntries().length === 0"
        )
        self.assertEqual(
            self.page.evaluate("window.__trainerMiniAppTestApi.getBodyWeightEntries()"),
            [],
        )
        self.assertEqual(
            self.page.evaluate("window.__trainerMiniAppTestApi.getBodyWeightValue()"),
            "",
        )

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

        self.select_exercise_by_name("Жим гор.")
        self.add_default_set()
        self.page.reload(wait_until="networkidle")

        expect(self.page.locator(".exercise-card").filter(has_text="Жим гор.")).to_be_visible()
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_be_visible()
        self.respond_to_next_dialog(accept=True, contains="Сбросить текущий черновик")
        self.page.locator('[data-action="reset-workout-draft"]').first.click()

        expect(self.page.locator(".exercise-card")).to_have_count(6)
        expect(self.page.locator(".exercise-picker")).to_be_visible()
        expect(
            self.page.locator('[data-action="toggle-more-exercises"]')
        ).to_be_visible()
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

    def test_reset_draft_fab_keeps_draft_when_dialog_is_dismissed(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим гор.")
        self.add_default_set()

        expect(self.page.locator(".exercise-card").filter(has_text="Жим гор.")).to_be_visible()
        self.respond_to_next_dialog(accept=False, contains="Сбросить текущий черновик")
        self.page.locator('[data-action="reset-workout-draft"]').first.click()

        expect(self.page.locator(".exercise-card").filter(has_text="Жим гор.")).to_be_visible()
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_be_visible()

    def test_can_leave_new_workout_and_resume_saved_draft(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.leave_new_workout()

        expect(self.page.locator('[data-action="open-new-workout"]')).to_be_visible()

        self.open_new_workout()

        expect(self.page.locator(".exercise-card").filter(has_text="Жим ногами")).to_be_visible()
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_be_visible()

    def test_resuming_saved_draft_morphs_plus_icon_without_replaying_save_fab_enter(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.leave_new_workout()

        trainings_fab = self.page.locator('[data-action="open-new-workout"]').first
        expect(trainings_fab).to_have_count(1)
        expect(trainings_fab).to_have_class(re.compile(r".*has-progress.*"))

        self.open_new_workout()

        save_fab = self.page.locator('[data-action="finish-workout"]').first
        fab_group = self.page.locator(".new-workout-fab-group").first
        expect(save_fab).to_have_class(re.compile(r".*is-icon-morph.*"))
        expect(fab_group).not_to_have_class(re.compile(r".*is-enter.*"))
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_be_visible()

    def test_fresh_new_workout_flow_does_not_apply_saved_draft_icon_morph(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        save_fab = self.page.locator('[data-action="finish-workout"]').first
        expect(save_fab).not_to_have_class(re.compile(r".*is-icon-morph.*"))

    def test_new_workout_save_fab_has_loading_state_while_saving(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.evaluate("() => window.__trainerMiniAppTestApi.setSavingWorkout(true)")

        save_fab = self.page.locator('[data-action="finish-workout"]').first
        expect(save_fab).to_have_class(re.compile(r".*is-saving.*"))
        expect(save_fab.locator(".save-loading-icon")).to_have_count(1)
        expect(save_fab.locator(".fab-saving-shimmer")).to_have_count(1)

    def test_workout_progress_ring_first_step_uses_true_linear_ratio(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getDisplayedFabProgressRatio() > 0.15"
        )
        logical_ratio = self.page.evaluate(
            "window.__trainerMiniAppTestApi.getDisplayedFabProgressRatio()"
        )
        visible_ratio = self.page.evaluate(
            "window.__trainerMiniAppTestApi.getDisplayedVisibleFabProgressRatio()"
        )

        self.assertAlmostEqual(logical_ratio, 1 / 6, delta=0.02)
        self.assertAlmostEqual(visible_ratio, logical_ratio, delta=0.02)

    def test_workout_progress_ring_counts_partial_progress_within_multi_set_plan(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.seed_multi_exercise_workout(
            client_id="progress-fractional-plan",
            workout_date="2026-04-01",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80},
                        {"reps": 13, "weight": 90},
                        {"reps": 12, "weight": 90},
                    ],
                }
            ],
        )

        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > 0"
        )
        first_ratio = self.page.evaluate(
            "window.__trainerMiniAppTestApi.getTargetFabProgressRatio()"
        )
        self.assertAlmostEqual(first_ratio, 1 / 18, delta=0.02)

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        card.locator(".draft-primary-add-button").click()
        self.page.wait_for_function(
            f"() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > {first_ratio + 0.01}"
        )
        second_ratio = self.page.evaluate(
            "window.__trainerMiniAppTestApi.getTargetFabProgressRatio()"
        )
        self.assertAlmostEqual(second_ratio, 2 / 18, delta=0.02)

        card.locator(".draft-primary-add-button").click()
        self.page.wait_for_function(
            f"() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > {second_ratio + 0.01}"
        )
        third_ratio = self.page.evaluate(
            "window.__trainerMiniAppTestApi.getTargetFabProgressRatio()"
        )
        self.assertAlmostEqual(third_ratio, 3 / 18, delta=0.02)

    def test_workout_progress_ring_recedes_by_one_step_when_exercise_is_removed(self) -> None:
        self.seed_popular_exercise_picker_history()
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > 0.15"
        )
        self.select_exercise_by_name("Тяга верт.")
        self.add_default_set()
        self.page.wait_for_function(
            "() => window.__trainerMiniAppTestApi.getTargetFabProgressRatio() > 0.3"
        )

        second_ratio = self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()")
        self.assertAlmostEqual(second_ratio, 2 / 6, delta=0.02)

        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(9)")
        self.page.locator('.draft-card-action-sheet [data-action="remove-draft-exercise"]').click()
        self.page.wait_for_function(
            "() => Math.abs(window.__trainerMiniAppTestApi.getTargetFabProgressRatio() - (1 / 6)) < 0.02"
        )

        first_ratio = self.page.evaluate("window.__trainerMiniAppTestApi.getTargetFabProgressRatio()")
        self.assertAlmostEqual(first_ratio, 1 / 6, delta=0.02)

        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(8)")
        self.page.locator('.draft-card-action-sheet [data-action="remove-draft-exercise"]').click()
        expect(self.page.locator('[data-action="finish-workout"]')).to_have_count(0)
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_have_count(0)

    def test_new_workout_supports_alternating_superset_sets(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        self.select_exercise_by_name("Тяга верт.")
        self.add_default_set()

        leg_press_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        pull_down_card = self.page.locator(".exercise-card").filter(has_text="Тяга верт.")

        expect(leg_press_card.locator(".set-row")).to_have_count(1)
        expect(pull_down_card.locator(".set-row")).to_have_count(1)

        leg_press_card.locator(".draft-primary-add-button").click()

        expect(leg_press_card.locator(".set-row")).to_have_count(1)
        expect(leg_press_card.locator(".draft-set-summary-value")).to_contain_text("×2")
        expect(leg_press_card).to_have_class(re.compile(r".*exercise-card-active.*"))
        expect(pull_down_card.locator(".set-row")).to_have_count(1)

    def test_draft_set_rows_use_same_compact_summary_rules_as_history(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()

        first_set = self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(".set-row").first
        expect(first_set.locator(".draft-set-summary-value")).to_contain_text("кг ×")
        expect(first_set.locator(".set-row-index")).to_have_count(0)
        expect(first_set).not_to_contain_text("Сет 1")
        self.assertEqual(
            self.page.evaluate(
                """
                () => getComputedStyle(
                  document.querySelector('.draft-set-summary-value')
                ).flexWrap
                """
            ),
            "wrap",
        )

        self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(
            ".draft-primary-add-button"
        ).click()
        expect(first_set.locator(".draft-set-summary-value")).to_contain_text("×2")

    def test_mobile_ui_disables_selection_on_surfaces_but_keeps_inputs_editable(self) -> None:
        self.open_app()
        self.page.locator('[data-action="switch-tab"][data-tab="body"]').click()
        expect(self.page.locator(".body-weight-number-input")).to_have_count(1)

        styles = self.page.evaluate(
            """
            () => {
              const bodyStyle = getComputedStyle(document.body);
              const cardStyle = getComputedStyle(document.querySelector('.body-weight-panel'));
              const inputStyle = getComputedStyle(document.querySelector('.body-weight-number-input'));
              return {
                bodyUserSelect: bodyStyle.userSelect,
                bodyTouchCallout: bodyStyle.webkitTouchCallout,
                cardUserSelect: cardStyle.userSelect,
                cardTouchCallout: cardStyle.webkitTouchCallout,
                inputUserSelect: inputStyle.userSelect,
                inputTouchCallout: inputStyle.webkitTouchCallout,
              };
            }
            """
        )

        self.assertEqual(styles["bodyUserSelect"], "none")
        self.assertIn(styles["bodyTouchCallout"], {"none", None})
        self.assertEqual(styles["cardUserSelect"], "none")
        self.assertIn(styles["cardTouchCallout"], {"none", None})
        self.assertIn(styles["inputUserSelect"], {"auto", "text"})
        self.assertIn(styles["inputTouchCallout"], {"default", "none", "auto", None})

    def test_draft_set_summary_only_taps_on_text_and_edits_latest_set(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.locator(".exercise-card").filter(has_text="Жим ногами").locator(
            ".draft-primary-add-button"
        ).click()

        card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        summary_button = card.locator(".draft-set-summary-button").first
        summary_value = card.locator(".draft-set-summary-value").first

        card_box = card.bounding_box()
        button_box = summary_button.bounding_box()
        self.assertIsNotNone(card_box)
        self.assertIsNotNone(button_box)
        self.assertLess(button_box["width"], card_box["width"] - 40)

        before_text = re.sub(r"\s+", " ", summary_value.text_content() or "").strip()
        match = re.search(r"^([0-9]+(?:,[0-9]+)?)кг ×([0-9]+)", before_text)
        self.assertIsNotNone(match)
        weight_text = match.group(1)
        reps_value = int(match.group(2))

        summary_button.click()
        self.page.locator('[data-action="set-reps-dec"]').click()
        self.page.locator('[data-action="set-apply"]').click()

        expect(summary_value).to_have_text(f"{weight_text}кг ×{reps_value}, {reps_value - 1}")

    def test_set_modal_can_save_effort_and_history_renders_it(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        expect(self.page.locator(".modal-card")).to_be_visible()
        hard_button = self.page.locator('[data-action="set-effort"][data-effort="hard"]')
        hard_button.click()
        expect(hard_button).to_have_attribute("aria-pressed", "true")
        self.page.locator('[data-action="set-apply"]').click()

        draft_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(draft_card.locator(".draft-set-summary-value")).to_contain_text("😣")

        self.page.locator('[data-action="finish-workout"]').click()
        history_card = self.page.locator(".workout-card").filter(has_text="Жим ногами")
        expect(history_card).to_contain_text("😣")

    def test_new_workout_reference_line_reuses_previous_set_effort(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="effort-reference-seed",
            workout_date="2026-03-27",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80, "effort": "hard", "notes": None},
                        {"reps": 13, "weight": 90, "effort": "ok", "notes": None},
                    ],
                }
            ],
        )
        self.open_app()
        self.open_new_workout()

        draft_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(draft_card.locator(".draft-exercise-reference-line")).to_contain_text("😣")
        expect(draft_card.locator(".draft-exercise-reference-line")).to_contain_text("😐")
        expect(draft_card.locator(".exercise-reference-effort-slot")).to_have_count(2)

        draft_card.locator(".draft-primary-add-button").click()
        expect(draft_card.locator(".draft-set-summary-value")).not_to_contain_text("😣")
        expect(draft_card.locator(".draft-set-summary-value")).not_to_contain_text("😐")

    def test_new_workout_reference_line_without_effort_renders_no_emoji_slot_gap(self) -> None:
        self.seed_multi_exercise_workout(
            client_id="effort-reference-none",
            workout_date="2026-03-27",
            exercises=[
                {
                    "exercise_id": 8,
                    "name": "Жим ногами",
                    "sets": [
                        {"reps": 15, "weight": 80, "notes": None},
                        {"reps": 13, "weight": 90, "notes": None},
                    ],
                }
            ],
        )
        self.open_app()
        self.open_new_workout()

        draft_card = self.page.locator(".exercise-card").filter(has_text="Жим ногами")
        expect(draft_card.locator(".draft-exercise-reference-line")).to_contain_text("→")
        expect(draft_card.locator(".exercise-reference-effort-slot")).to_have_count(0)

    def test_draft_card_action_sheet_shows_remove_actions(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(8)")

        sheet = self.page.locator(".draft-card-action-sheet")
        expect(sheet).to_be_visible()
        expect(sheet.locator(".draft-card-action-sheet-title")).to_have_text("Жим ногами")
        expect(sheet).not_to_contain_text("Карточка упражнения")
        expect(sheet).to_contain_text("Удалить сет")
        expect(sheet).to_contain_text("Удалить упражнение")
        geometry = self.page.evaluate(
            """
            () => {
              const sheet = document.querySelector(".draft-card-action-sheet");
              if (!sheet) {
                return null;
              }
              const rect = sheet.getBoundingClientRect();
              return {
                centerX: rect.left + rect.width / 2,
                centerY: rect.top + rect.height / 2,
                viewportCenterX: window.innerWidth / 2,
                viewportCenterY: window.innerHeight / 2,
              };
            }
            """
        )
        self.assertIsNotNone(geometry)
        self.assertLess(abs(geometry["centerX"] - geometry["viewportCenterX"]), 40)
        self.assertLess(abs(geometry["centerY"] - geometry["viewportCenterY"]), 80)

    def test_draft_card_action_sheet_dismisses_on_overlay_tap(self) -> None:
        self.open_app()
        self.open_new_workout()

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.evaluate("() => window.__trainerMiniAppTestApi.openDraftExerciseActionSheet(8)")

        expect(self.page.locator(".draft-card-action-sheet")).to_be_visible()
        self.page.locator(".draft-card-menu-overlay").click(position={"x": 12, "y": 12})
        expect(self.page.locator(".draft-card-action-sheet")).to_have_count(0)

    def test_returning_from_new_restores_trainings_scroll_position(self) -> None:
        self.seed_workout_history()
        self.open_app()

        self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        self.page.wait_for_timeout(150)
        initial_scroll = self.page.evaluate("window.scrollY")
        self.assertGreater(initial_scroll, 300)

        self.open_new_workout()
        self.leave_new_workout()
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

        self.select_exercise_by_name("Жим ногами")
        self.add_default_set()
        self.page.go_back()

        expect(self.page.locator("header .sr-only.topbar-title")).to_have_text("Trainings")
        self.open_new_workout()
        expect(self.page.locator(".exercise-card").filter(has_text="Жим ногами")).to_be_visible()
        expect(self.page.locator('[data-action="reset-workout-draft"]')).to_be_visible()

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
        expect(self.page.locator(".progress-summary-grid")).to_contain_text("+10 кг / +2 повт.")
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
        expect(self.page.locator("#topbar-workout-date")).to_have_value("2026-03-21")

        self.page.locator('[data-action="edit-draft-set"]').first.click()
        self.page.locator('[data-action="set-weight-inc"]').click()
        self.page.locator('[data-action="set-reps-inc"]').click()
        self.page.locator('[data-action="set-apply"]').click()
        self.page.locator("#topbar-workout-date").fill("2026-03-22")
        self.page.locator('[data-action="finish-workout"]').click()

        expect(self.page.locator(".toast")).to_contain_text("Изменения в тренировке сохранены")
        expect(self.page.locator(".topbar-title")).to_have_text("Trainings")
        updated_card = self.page.locator(".workout-card").filter(has_text="Редактируемый тест")
        expect(updated_card).to_contain_text("22 марта 2026")
        expect(updated_card).to_contain_text("122,5кг ×13")

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
