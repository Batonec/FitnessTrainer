const tg = window.Telegram?.WebApp ?? null;
const root = document.getElementById("app");

const STORAGE_KEYS = {
  customWorkouts: "trainer-miniapp-custom-workouts-v1",
  draft: "trainer-miniapp-draft-v1",
  tab: "trainer-miniapp-tab-v1",
  range: "trainer-miniapp-range-v1",
  progressExercise: "trainer-miniapp-progress-exercise-v1",
  bodyWeightRange: "trainer-miniapp-body-weight-range-v1",
};

const PROGRESS_RANGES = [
  { key: "DAYS_7", label: "7D", days: 7 },
  { key: "DAYS_30", label: "30D", days: 30 },
  { key: "ALL", label: "All", days: null },
];
const ENABLE_NEXT_WORKOUT_PLAN = false;
const TELEGRAM_INITDATA_WAIT_MS = 1800;
const TELEGRAM_INITDATA_POLL_MS = 120;
const WORKOUT_SWIPE_ACTIONS_WIDTH = 148;
const WORKOUT_SWIPE_GESTURE_THRESHOLD = 8;
const WORKOUT_SWIPE_HORIZONTAL_RATIO = 0.62;
const WORKOUT_SWIPE_VERTICAL_RATIO = 1.12;
const WORKOUT_SWIPE_EDGE_START_PX = 92;
const WORKOUT_SWIPE_CLICK_GUARD_MS = 320;

const state = {
  booting: true,
  loadError: null,
  currentTab: readTextStorage(STORAGE_KEYS.tab, "trainings"),
  newFlowOriginTab: "trainings",
  scrollPositions: {
    trainings: 0,
    progress: 0,
    body: 0,
    new: 0,
  },
  pendingScrollRestoreTop: null,
  openWorkoutSwipeId: null,
  selectedRange: readTextStorage(STORAGE_KEYS.range, "DAYS_30"),
  selectedBodyWeightRange: readTextStorage(STORAGE_KEYS.bodyWeightRange, "DAYS_30"),
  selectedProgressExerciseId: readNumberStorage(STORAGE_KEYS.progressExercise, null),
  currentUser: null,
  exercises: [],
  bodyWeightEntries: [],
  bodyWeightDate: getLocalTodayIso(),
  bodyWeightValue: "",
  workoutDate: getLocalTodayIso(),
  customWorkouts: sortWorkouts(readJsonStorage(STORAGE_KEYS.customWorkouts, [])),
  appliedWorkoutPlan: null,
  selectedExerciseId: null,
  workoutExercises: [],
  editingWorkoutId: null,
  editingWorkoutClientId: null,
  activeSetEditor: null,
  isAddingExercise: false,
  showAllExerciseOptions: false,
  isAddingSet: false,
  isSavingWorkout: false,
  isSavingBodyWeight: false,
  currentSetReps: 12,
  currentSetWeight: 0,
  flashMessage: "",
};

let flashTimeoutId = null;
let devVersion = null;
let hasOpenNewHistoryEntry = false;
let workoutSwipeGesture = null;
let swipeClickGuard = null;
let pendingScreenTransition = false;

root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);
root.addEventListener("pointerdown", handleWorkoutSwipePointerDown);
window.addEventListener("pointermove", handleWorkoutSwipePointerMove, { passive: false });
window.addEventListener("pointerup", handleWorkoutSwipePointerUp);
window.addEventListener("pointercancel", handleWorkoutSwipePointerUp);
window.addEventListener("popstate", handlePopState);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.isAddingSet) {
    cancelAddingSet();
  }
});
installTestApi();

bootstrap();

async function bootstrap() {
  setupTelegramShell();
  hydrateDraft();
  normalizeCurrentTab();
  syncBrowserHistory("replace");
  startLiveReload();
  render();

  try {
    await resolveSession();
    await migrateLegacyCustomWorkouts();
    const [exercisesResponse, workoutsResponse, bodyWeightsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/api/workouts"),
      fetchJson("/api/body-weights"),
    ]);

    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.bodyWeightEntries = sortBodyWeightEntries(
      Array.isArray(bodyWeightsResponse.entries) ? bodyWeightsResponse.entries : []
    );
    state.currentUser = workoutsResponse.user || bodyWeightsResponse.user || state.currentUser;
    ensureSelectedProgressExercise();
    ensureDraftExerciseStillExists();
    ensureNewWorkoutFlow();
    syncBodyWeightComposer();
    state.booting = false;
    render();
  } catch (error) {
    state.booting = false;
    state.loadError = error.message || "Не удалось загрузить данные приложения";
    render();
  }
}

function setupTelegramShell() {
  if (!tg) {
    return;
  }

  tg.ready();
  tg.expand();
  requestTelegramImmersiveMode();
  tg.BackButton?.onClick(handleTelegramBackRequest);
  tg.onEvent?.("activated", requestTelegramImmersiveMode);
}

function requestTelegramImmersiveMode() {
  if (!tg) {
    return;
  }

  try {
    tg.disableVerticalSwipes?.();
  } catch (_error) {
    // Some clients can ignore unsupported shell methods.
  }

  try {
    if (typeof tg.requestFullscreen === "function" && tg.isFullscreen !== true) {
      tg.requestFullscreen();
    }
  } catch (_error) {
    // Older Telegram clients may not support fullscreen requests.
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function startLiveReload() {
  if (!isLocalDevHost()) {
    return;
  }

  checkDevVersion();
  window.setInterval(checkDevVersion, 1000);
}

function isLocalDevHost() {
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

async function checkDevVersion() {
  try {
    const response = await fetch(`/api/dev/version?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (!payload.version) {
      return;
    }

    if (!devVersion) {
      devVersion = payload.version;
      return;
    }

    if (devVersion !== payload.version) {
      window.location.reload();
    }
  } catch (_error) {
    // Ignore brief gaps while dev server restarts.
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    let reason = `HTTP ${response.status} while loading ${url}`;
    try {
      const payload = await response.json();
      if (payload.reason) {
        reason = String(payload.reason);
      }
    } catch (_error) {
      // Ignore non-JSON error bodies.
    }
    throw new Error(reason);
  }
  return response.json();
}

async function postJson(url, payload) {
  return sendJson(url, "POST", payload);
}

async function putJson(url, payload) {
  return sendJson(url, "PUT", payload);
}

async function deleteJson(url) {
  return sendJson(url, "DELETE");
}

async function sendJson(url, method, payload = undefined) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  let responsePayload = {};
  try {
    responsePayload = await response.json();
  } catch (_error) {
    responsePayload = {};
  }

  if (!response.ok) {
    throw new Error(responsePayload.reason || `HTTP ${response.status} while posting to ${url}`);
  }

  return responsePayload;
}

async function resolveSession() {
  const initData = await resolveTelegramInitData();
  const payload = await postJson("/api/session/resolve", {
    shell: tg ? "telegram" : "browser",
    initData,
    unsafeUser: getTelegramUnsafeUser(),
  });
  state.currentUser = payload.user || null;
}

async function resolveTelegramInitData() {
  if (!tg) {
    return "";
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt <= TELEGRAM_INITDATA_WAIT_MS) {
    const initData = String(tg.initData || "").trim();
    if (initData) {
      return initData;
    }
    await sleep(TELEGRAM_INITDATA_POLL_MS);
  }

  return String(tg.initData || "").trim();
}

function getTelegramUnsafeUser() {
  if (!tg?.initDataUnsafe?.user) {
    return null;
  }

  return {
    id: tg.initDataUnsafe.user.id,
    first_name: tg.initDataUnsafe.user.first_name,
    last_name: tg.initDataUnsafe.user.last_name,
    username: tg.initDataUnsafe.user.username,
    language_code: tg.initDataUnsafe.user.language_code,
  };
}

function handleClick(event) {
  if (shouldSuppressSwipeSurfaceClick(event)) {
    clearSwipeClickGuard();
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (
    !actionTarget &&
    state.openWorkoutSwipeId != null &&
    event.target.closest("[data-workout-swipe-actions]")
  ) {
    closeWorkoutSwipe();
    return;
  }

  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;
  switch (action) {
    case "switch-tab":
      if (actionTarget.dataset.tab === state.currentTab) {
        scrollCurrentTabToTop();
      } else {
        setCurrentTab(actionTarget.dataset.tab);
      }
      break;
    case "open-new-workout":
      openNewWorkout();
      break;
    case "close-new-workout":
      closeNewWorkout();
      break;
    case "select-range":
      selectRange(actionTarget.dataset.range);
      break;
    case "select-body-weight-range":
      selectBodyWeightRange(actionTarget.dataset.range);
      break;
    case "refresh-progress":
      refreshLocalData();
      break;
    case "save-body-weight":
      saveBodyWeight();
      break;
    case "delete-body-weight":
      deleteBodyWeightEntry(Number(actionTarget.dataset.entryId));
      break;
    case "reset-workout-draft":
      resetWorkoutDraftWithConfirmation();
      break;
    case "edit-workout":
      startEditingWorkout(Number(actionTarget.dataset.workoutId));
      break;
    case "delete-workout":
      deleteWorkout(Number(actionTarget.dataset.workoutId));
      break;
    case "continue-exercise":
      startAddingSetForExercise(Number(actionTarget.dataset.exerciseId));
      break;
    case "quick-standard-set":
      addStandardSetForExercise(Number(actionTarget.dataset.exerciseId));
      break;
    case "edit-draft-set":
      startEditingDraftSet(
        Number(actionTarget.dataset.exerciseId),
        Number(actionTarget.dataset.setIndex)
      );
      break;
    case "remove-draft-set":
      removeDraftSet(Number(actionTarget.dataset.exerciseId), Number(actionTarget.dataset.setIndex));
      break;
    case "remove-draft-exercise":
      removeDraftExercise(Number(actionTarget.dataset.exerciseId));
      break;
    case "apply-workout-plan":
      applyWorkoutPlanSuggestion();
      break;
    case "start-adding-exercise":
      state.isAddingExercise = true;
      state.showAllExerciseOptions = false;
      render();
      break;
    case "cancel-adding-exercise":
      state.isAddingExercise = false;
      state.showAllExerciseOptions = false;
      persistDraft();
      render();
      break;
    case "toggle-more-exercises":
      state.showAllExerciseOptions = !state.showAllExerciseOptions;
      persistDraft();
      render();
      break;
    case "select-exercise":
      selectExercise(Number(actionTarget.dataset.exerciseId));
      break;
    case "start-adding-set":
      startAddingSet();
      break;
    case "add-standard-set":
      addStandardSet();
      break;
    case "finish-exercise":
      finishExercise();
      break;
    case "finish-workout":
      finishWorkout();
      break;
    case "set-weight-inc":
      state.currentSetWeight += 2.5;
      render();
      break;
    case "set-weight-dec":
      state.currentSetWeight = Math.max(0, state.currentSetWeight - 2.5);
      render();
      break;
    case "set-reps-inc":
      state.currentSetReps += 1;
      render();
      break;
    case "set-reps-dec":
      state.currentSetReps = Math.max(1, state.currentSetReps - 1);
      render();
      break;
    case "set-apply":
      applySet();
      break;
    case "set-cancel":
      cancelAddingSet();
      break;
    default:
      break;
  }
}

function handleChange(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;
  switch (action) {
    case "select-progress-exercise":
      setSelectedProgressExercise(Number(actionTarget.value));
      break;
    case "change-workout-date":
      setWorkoutDate(String(actionTarget.value || ""));
      break;
    case "change-body-weight-date":
      setBodyWeightDate(String(actionTarget.value || ""));
      break;
    case "change-body-weight-value":
      setBodyWeightValue(String(actionTarget.value || ""));
      break;
    default:
      break;
  }
}

function setCurrentTab(tab) {
  if (!tab || state.currentTab === tab) {
    return;
  }

  captureScrollPosition(state.currentTab);
  state.openWorkoutSwipeId = null;
  state.currentTab = tab;
  pendingScreenTransition = true;
  writeTextStorage(STORAGE_KEYS.tab, tab);
  ensureNewWorkoutFlow();
  queueScrollRestore(tab);
  syncBrowserHistory("replace");
  render();
}

function normalizeNavTab(tab) {
  if (tab === "progress" || tab === "body") {
    return tab;
  }
  return "trainings";
}

function normalizeScrollTab(tab) {
  return tab === "progress" || tab === "body" || tab === "new" ? tab : "trainings";
}

function normalizeCurrentTab() {
  if (state.currentTab !== "new") {
    state.newFlowOriginTab = normalizeNavTab(state.currentTab);
    return;
  }

  if (hasWorkoutDraft() || state.editingWorkoutId) {
    return;
  }

  state.currentTab = "trainings";
  writeTextStorage(STORAGE_KEYS.tab, "trainings");
}

function rememberNewFlowOrigin(tab = state.currentTab) {
  if (tab === "new") {
    return;
  }

  state.newFlowOriginTab = normalizeNavTab(tab);
}

function getNewFlowReturnTab() {
  return normalizeNavTab(state.newFlowOriginTab);
}

function openNewWorkout() {
  rememberNewFlowOrigin();
  captureScrollPosition(state.currentTab);
  state.openWorkoutSwipeId = null;
  state.currentTab = "new";
  pendingScreenTransition = true;
  writeTextStorage(STORAGE_KEYS.tab, "new");
  ensureNewWorkoutFlow();
  queueScrollRestore("new", 0);
  pushNewFlowHistoryEntry();
  render();
}

function closeNewWorkout() {
  const returnTab = getNewFlowReturnTab();
  if (hasOpenNewHistoryEntry) {
    queueScrollRestore(returnTab);
    window.history.back();
    return;
  }

  setCurrentTab(returnTab);
}

function selectRange(rangeKey) {
  if (!rangeKey || state.selectedRange === rangeKey) {
    return;
  }

  state.selectedRange = rangeKey;
  writeTextStorage(STORAGE_KEYS.range, rangeKey);
  render();
}

function selectBodyWeightRange(rangeKey) {
  if (!rangeKey || state.selectedBodyWeightRange === rangeKey) {
    return;
  }

  state.selectedBodyWeightRange = rangeKey;
  writeTextStorage(STORAGE_KEYS.bodyWeightRange, rangeKey);
  render();
}

async function refreshLocalData() {
  if (state.loadError) {
    state.booting = true;
    state.loadError = null;
    render();
  } else {
    showFlash("Данные с сервера обновлены");
  }
  try {
    await resolveSession();
    const [exercisesResponse, workoutsResponse, bodyWeightsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/api/workouts"),
      fetchJson("/api/body-weights"),
    ]);
    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.bodyWeightEntries = sortBodyWeightEntries(
      Array.isArray(bodyWeightsResponse.entries) ? bodyWeightsResponse.entries : []
    );
    state.currentUser = workoutsResponse.user || bodyWeightsResponse.user || state.currentUser;
    ensureSelectedProgressExercise();
    ensureEditingWorkoutStillExists();
    state.booting = false;
    state.loadError = null;
    ensureDraftExerciseStillExists();
    syncBodyWeightComposer();
    render();
  } catch (error) {
    state.booting = false;
    state.loadError = error.message || "Не удалось обновить данные";
    showFlash(error.message || "Не удалось обновить данные");
  }
}

function hydrateDraft() {
  const draft = readJsonStorage(STORAGE_KEYS.draft, null);
  if (!draft) {
    return;
  }

  state.selectedExerciseId =
    typeof draft.selectedExerciseId === "number" ? draft.selectedExerciseId : null;
  state.workoutExercises = normalizeDraftWorkoutExercises(draft.workoutExercises);
  state.workoutDate =
    typeof draft.workoutDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.workoutDate)
      ? draft.workoutDate
      : getLocalTodayIso();
  state.editingWorkoutId =
    Number.isFinite(Number(draft.editingWorkoutId)) && Number(draft.editingWorkoutId) > 0
      ? Number(draft.editingWorkoutId)
      : null;
  state.editingWorkoutClientId =
    typeof draft.editingWorkoutClientId === "string" && draft.editingWorkoutClientId.trim()
      ? draft.editingWorkoutClientId.trim()
      : null;
  state.appliedWorkoutPlan = normalizeAppliedWorkoutPlan(draft.appliedWorkoutPlan);
}

function persistDraft() {
  if (!state.selectedExerciseId && state.workoutExercises.length === 0) {
    state.appliedWorkoutPlan = null;
    localStorage.removeItem(STORAGE_KEYS.draft);
    return;
  }

  writeJsonStorage(STORAGE_KEYS.draft, {
    selectedExerciseId: state.selectedExerciseId,
    workoutExercises: state.workoutExercises,
    workoutDate: state.workoutDate,
    editingWorkoutId: state.editingWorkoutId,
    editingWorkoutClientId: state.editingWorkoutClientId,
    appliedWorkoutPlan: state.appliedWorkoutPlan,
  });
}

function normalizeAppliedWorkoutPlan(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const generatedFromWorkoutId = Number(value.generatedFromWorkoutId);
  const generatedFromWorkoutDate = String(value.generatedFromWorkoutDate || "").trim();
  const strategy = String(value.strategy || "").trim();
  const source = String(value.source || "").trim();

  if (!strategy || !source || !/^\d{4}-\d{2}-\d{2}$/.test(generatedFromWorkoutDate)) {
    return null;
  }

  return {
    source,
    strategy,
    generatedFromWorkoutId:
      Number.isFinite(generatedFromWorkoutId) && generatedFromWorkoutId > 0
        ? generatedFromWorkoutId
        : null,
    generatedFromWorkoutDate,
  };
}

function normalizeDraftWorkoutExercises(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((exercise) => exercise && typeof exercise === "object")
    .map((exercise) => ({
      exerciseId: Number(exercise.exerciseId),
      exerciseName: String(exercise.exerciseName || exercise.name || "").trim(),
      sets: Array.isArray(exercise.sets)
        ? exercise.sets
            .filter((workoutSet) => workoutSet && typeof workoutSet === "object")
            .map((workoutSet) => ({
              reps: Math.max(1, Number(workoutSet.reps) || 1),
              weight: Math.max(0, Number(workoutSet.weight) || 0),
              notes: workoutSet.notes ?? null,
            }))
        : [],
    }))
    .filter((exercise) => Number.isFinite(exercise.exerciseId) && exercise.exerciseName);
}

function ensureDraftExerciseStillExists() {
  if (!state.selectedExerciseId) {
    return;
  }

  const exists = state.exercises.some((exercise) => exercise.id === state.selectedExerciseId);
  if (!exists) {
    state.selectedExerciseId = null;
    persistDraft();
    return;
  }

  if (!state.workoutExercises.some((exercise) => exercise.exerciseId === state.selectedExerciseId)) {
    ensureDraftExerciseEntry(state.selectedExerciseId);
    persistDraft();
  }
}

function ensureNewWorkoutFlow() {
  if (!state.exercises.length) {
    return;
  }
}

function ensureEditingWorkoutStillExists() {
  if (!state.editingWorkoutId) {
    return;
  }

  const stillExists = state.customWorkouts.some((workout) => workout.id === state.editingWorkoutId);
  if (stillExists) {
    return;
  }

  resetDraftState();
  showFlash("Редактируемая тренировка больше не найдена");
}

function hasWorkoutDraft() {
  return state.workoutExercises.length > 0 || state.selectedExerciseId !== null;
}

function hasAppliedWorkoutPlan() {
  return Boolean(state.appliedWorkoutPlan?.strategy);
}

function getNextWorkoutPlanSuggestion(workouts = getAllWorkouts()) {
  if (!ENABLE_NEXT_WORKOUT_PLAN) {
    return null;
  }
  if (state.editingWorkoutId) {
    return null;
  }
  return buildNextWorkoutPlanSuggestion(workouts);
}

function countDraftExercises() {
  return state.workoutExercises.length;
}

function getAllWorkouts() {
  return sortWorkouts(state.customWorkouts);
}

function getWorkoutById(workoutId) {
  return state.customWorkouts.find((workout) => workout.id === workoutId) || null;
}

function sortWorkouts(workouts) {
  return [...workouts].sort((left, right) => {
    if (left.workout_date === right.workout_date) {
      const createdAtDiff = (Number(right.created_at) || 0) - (Number(left.created_at) || 0);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }

      const updatedAtDiff = (Number(right.updated_at) || 0) - (Number(left.updated_at) || 0);
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }

      return (Number(right.id) || 0) - (Number(left.id) || 0);
    }
    return right.workout_date.localeCompare(left.workout_date);
  });
}

function sortBodyWeightEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.entry_date === right.entry_date) {
      const updatedAtDiff = (Number(left.updated_at) || 0) - (Number(right.updated_at) || 0);
      if (updatedAtDiff !== 0) {
        return updatedAtDiff;
      }

      return (Number(left.id) || 0) - (Number(right.id) || 0);
    }

    return left.entry_date.localeCompare(right.entry_date);
  });
}

function getBodyWeightEntryByDate(entryDate) {
  return (
    state.bodyWeightEntries.find((entry) => String(entry.entry_date || "") === String(entryDate || "")) ||
    null
  );
}

function syncBodyWeightComposer({ preferredDate = null, preserveValue = false } = {}) {
  const resolvedDate =
    typeof preferredDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
      ? preferredDate
      : /^\d{4}-\d{2}-\d{2}$/.test(state.bodyWeightDate)
        ? state.bodyWeightDate
        : getLocalTodayIso();

  state.bodyWeightDate = resolvedDate;
  if (preserveValue) {
    return;
  }

  const entryForSelectedDate = getBodyWeightEntryByDate(resolvedDate);
  if (entryForSelectedDate) {
    state.bodyWeightValue = formatBodyWeightInput(entryForSelectedDate.weight);
    return;
  }

  const latestEntry = state.bodyWeightEntries.at(-1) || null;
  state.bodyWeightValue = latestEntry ? formatBodyWeightInput(latestEntry.weight) : "";
}

function getBodyWeightEntriesInRange(entries, rangeKey) {
  const range = PROGRESS_RANGES.find((item) => item.key === rangeKey) || PROGRESS_RANGES[1];
  const today = parseIsoDate(getLocalTodayIso());

  return sortBodyWeightEntries(entries)
    .map((entry) => ({
      entry,
      date: parseIsoDate(entry.entry_date),
    }))
    .filter(({ date }) => inRange(date, range.days, today))
    .map(({ entry }) => entry);
}

function summarizeBodyWeightEntries(filteredEntries, allEntries = state.bodyWeightEntries) {
  const sortedAllEntries = sortBodyWeightEntries(allEntries);
  const sortedFilteredEntries = sortBodyWeightEntries(filteredEntries);
  const latestOverallEntry = sortedAllEntries.at(-1) || null;
  const latestEntry = sortedFilteredEntries.at(-1) || null;
  const firstEntry = sortedFilteredEntries[0] || null;

  return {
    totalEntries: sortedFilteredEntries.length,
    latestOverallEntry,
    latestEntry,
    firstEntry,
    delta: latestEntry && firstEntry ? Number(latestEntry.weight) - Number(firstEntry.weight) : 0,
  };
}

function getSelectedExercise() {
  return getExerciseDefinition(state.selectedExerciseId);
}

function getCurrentWorkoutExercise() {
  return state.workoutExercises.find(
    (exercise) => exercise.exerciseId === state.selectedExerciseId
  ) || null;
}

function getExerciseDefinition(exerciseId) {
  return state.exercises.find((exercise) => exercise.id === exerciseId) || null;
}

function ensureDraftExerciseEntry(exerciseId) {
  if (!Number.isFinite(Number(exerciseId)) || Number(exerciseId) <= 0) {
    return null;
  }

  const normalizedExerciseId = Number(exerciseId);
  const existingExercise = state.workoutExercises.find(
    (exercise) => exercise.exerciseId === normalizedExerciseId
  );
  if (existingExercise) {
    return existingExercise;
  }

  const exerciseDefinition = getExerciseDefinition(normalizedExerciseId);
  if (!exerciseDefinition) {
    return null;
  }

  const nextExercise = {
    exerciseId: normalizedExerciseId,
    exerciseName: exerciseDefinition.name,
    sets: [],
  };
  state.workoutExercises = [...state.workoutExercises, nextExercise];
  return nextExercise;
}

function getAvailableExercises() {
  const addedIds = new Set(state.workoutExercises.map((exercise) => exercise.exerciseId));
  return state.exercises.filter((exercise) => !addedIds.has(exercise.id));
}

function getExercisePickerGroups(exercises, workouts = getAllWorkouts()) {
  const available = Array.isArray(exercises) ? exercises : [];
  if (!available.length) {
    return {
      primary: [],
      secondary: [],
      primaryPoolExhausted: false,
    };
  }

  const stats = buildExerciseUsageStats(workouts);
  const catalogExercises = Array.isArray(state.exercises) && state.exercises.length
    ? state.exercises
    : available;
  const rankedCatalog = catalogExercises.map((exercise, catalogIndex) => {
    const exerciseStats = stats.get(exercise.id) || null;
    return {
      exercise,
      count: exerciseStats?.count ?? 0,
      averagePosition: exerciseStats?.averagePosition ?? Number.POSITIVE_INFINITY,
      latestWorkoutDate: exerciseStats?.latestWorkoutDate ?? "",
      catalogIndex,
    };
  });

  const rankedByImportance = [...rankedCatalog].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    if (right.latestWorkoutDate !== left.latestWorkoutDate) {
      return right.latestWorkoutDate.localeCompare(left.latestWorkoutDate);
    }
    if (left.averagePosition !== right.averagePosition) {
      return left.averagePosition - right.averagePosition;
    }
    return left.catalogIndex - right.catalogIndex;
  });

  const suggestedPool = rankedByImportance
    .filter((item) => item.count > 0)
    .slice(0, 6);

  const primaryPool = suggestedPool.length ? suggestedPool : rankedByImportance.slice(0, 6);
  const primaryIds = new Set(primaryPool.map((item) => item.exercise.id));
  const rankedAvailable = available.map((exercise, catalogIndex) => {
    const exerciseStats = stats.get(exercise.id) || null;
    return {
      exercise,
      count: exerciseStats?.count ?? 0,
      averagePosition: exerciseStats?.averagePosition ?? Number.POSITIVE_INFINITY,
      latestWorkoutDate: exerciseStats?.latestWorkoutDate ?? "",
      catalogIndex,
    };
  });

  const primary = rankedAvailable
    .filter((item) => primaryIds.has(item.exercise.id))
    .sort((left, right) => {
      if (left.averagePosition !== right.averagePosition) {
        return left.averagePosition - right.averagePosition;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.latestWorkoutDate !== left.latestWorkoutDate) {
        return right.latestWorkoutDate.localeCompare(left.latestWorkoutDate);
      }
      return left.catalogIndex - right.catalogIndex;
    })
    .map((item) => item.exercise);

  const secondary = rankedAvailable
    .filter((item) => !primaryIds.has(item.exercise.id))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      if (right.latestWorkoutDate !== left.latestWorkoutDate) {
        return right.latestWorkoutDate.localeCompare(left.latestWorkoutDate);
      }
      return left.exercise.name.localeCompare(right.exercise.name, "ru-RU");
    })
    .map((item) => item.exercise);

  return {
    primary,
    secondary,
    primaryPoolExhausted: primaryPool.length > 0 && primary.length === 0 && secondary.length > 0,
  };
}

function buildExerciseUsageStats(workouts) {
  const stats = new Map();

  sortWorkouts(workouts).forEach((workout) => {
    const exercises = Array.isArray(workout?.data?.exercises) ? workout.data.exercises : [];
    exercises.forEach((exercise, index) => {
      const exerciseId = Number(exercise.exercise_id);
      if (!Number.isFinite(exerciseId) || exerciseId <= 0) {
        return;
      }

      const current = stats.get(exerciseId) || {
        count: 0,
        totalPosition: 0,
        latestWorkoutDate: "",
      };
      current.count += 1;
      current.totalPosition += index;
      if (!current.latestWorkoutDate || workout.workout_date > current.latestWorkoutDate) {
        current.latestWorkoutDate = workout.workout_date;
      }
      stats.set(exerciseId, current);
    });
  });

  stats.forEach((value, exerciseId) => {
    stats.set(exerciseId, {
      ...value,
      averagePosition: value.count ? value.totalPosition / value.count : Number.POSITIVE_INFINITY,
    });
  });

  return stats;
}

function getProgressExercises(workouts = getAllWorkouts()) {
  const lookup = new Map();

  state.exercises.forEach((exercise) => {
    lookup.set(exercise.id, {
      id: exercise.id,
      name: exercise.name,
    });
  });

  sortWorkouts(workouts).forEach((workout) => {
    workout.data.exercises.forEach((exercise) => {
      if (!lookup.has(exercise.exercise_id)) {
        lookup.set(exercise.exercise_id, {
          id: exercise.exercise_id,
          name: exercise.name,
        });
      }
    });
  });

  return Array.from(lookup.values());
}

function ensureSelectedProgressExercise() {
  const progressExercises = getProgressExercises();
  if (!progressExercises.length) {
    state.selectedProgressExerciseId = null;
    localStorage.removeItem(STORAGE_KEYS.progressExercise);
    return;
  }

  const stillExists = progressExercises.some(
    (exercise) => exercise.id === state.selectedProgressExerciseId
  );
  if (stillExists) {
    return;
  }

  state.selectedProgressExerciseId = progressExercises[0].id;
  writeTextStorage(STORAGE_KEYS.progressExercise, String(progressExercises[0].id));
}

function focusDraftExercise(exerciseId) {
  const draftExercise = ensureDraftExerciseEntry(exerciseId);
  if (!draftExercise) {
    return null;
  }

  state.selectedExerciseId = Number(exerciseId);
  state.showAllExerciseOptions = false;
  return draftExercise;
}

function selectExercise(exerciseId, { openSetEditor = true } = {}) {
  const selectedExercise = getExerciseDefinition(Number(exerciseId));
  if (!selectedExercise) {
    return;
  }

  focusDraftExercise(selectedExercise.id);
  if (openSetEditor) {
    state.currentSetReps = 12;
    state.currentSetWeight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
    state.activeSetEditor = {
      exerciseId: selectedExercise.id,
      setIndex: null,
    };
    state.isAddingSet = true;
  } else {
    state.activeSetEditor = null;
    state.isAddingSet = false;
  }
  persistDraft();
  render();
}

function setWorkoutDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return;
  }

  state.workoutDate = value;
  persistDraft();
}

function setBodyWeightDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return;
  }

  syncBodyWeightComposer({ preferredDate: value });
  render();
}

function setBodyWeightValue(value) {
  state.bodyWeightValue = normalizeBodyWeightInput(value);
}

async function saveBodyWeight() {
  const trimmedValue = String(state.bodyWeightValue || "").trim().replace(",", ".");
  const numericWeight = Number(trimmedValue);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.bodyWeightDate)) {
    showFlash("Выбери корректную дату");
    return;
  }

  if (!trimmedValue || !Number.isFinite(numericWeight) || numericWeight <= 0) {
    showFlash("Введи корректный вес тела");
    return;
  }

  if (state.isSavingBodyWeight) {
    return;
  }

  state.isSavingBodyWeight = true;
  render();

  try {
    const response = await postJson("/api/body-weights", {
      entry_date: state.bodyWeightDate,
      weight: numericWeight,
      notes: null,
    });
    const nextEntries = state.bodyWeightEntries.filter(
      (entry) => String(entry.entry_date || "") !== String(response.entry.entry_date || "")
    );
    nextEntries.push(response.entry);
    state.bodyWeightEntries = sortBodyWeightEntries(nextEntries);
    state.currentUser = response.user || state.currentUser;
    syncBodyWeightComposer({ preferredDate: response.entry.entry_date });
    showFlash(response.created ? "Вес тела сохранён" : "Вес тела обновлён");
  } catch (error) {
    showFlash(error.message || "Не удалось сохранить вес тела");
  } finally {
    state.isSavingBodyWeight = false;
    render();
  }
}

async function deleteBodyWeightEntry(entryId) {
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return;
  }

  const entry = state.bodyWeightEntries.find((item) => Number(item.id) === entryId);
  if (!entry) {
    showFlash("Запись веса уже отсутствует");
    return;
  }

  const confirmed = window.confirm(
    `Удалить запись веса ${formatBodyWeightValue(entry.weight)} кг от ${formatLongDate(entry.entry_date)}?`
  );
  if (!confirmed) {
    return;
  }

  try {
    const payload = await deleteJson(`/api/body-weights/${entryId}`);
    state.currentUser = payload.user || state.currentUser;
    state.bodyWeightEntries = state.bodyWeightEntries.filter((item) => Number(item.id) !== entryId);
    syncBodyWeightComposer({ preferredDate: state.bodyWeightDate });
    render();
    showFlash("Запись веса удалена");
  } catch (error) {
    showFlash(error.message || "Не удалось удалить запись веса");
  }
}

function startEditingWorkout(workoutId) {
  const workout = getWorkoutById(workoutId);
  if (!workout) {
    showFlash("Тренировка для редактирования не найдена");
    return;
  }

  rememberNewFlowOrigin();
  captureScrollPosition(state.currentTab);
  state.openWorkoutSwipeId = null;
  state.currentTab = "new";
  state.workoutDate = workout.workout_date;
  state.selectedExerciseId = null;
  state.workoutExercises = workout.data.exercises.map((exercise) => ({
    exerciseId: exercise.exercise_id,
    exerciseName: exercise.name,
    sets: exercise.sets.map((workoutSet) => ({
      reps: Number(workoutSet.reps) || 1,
      weight: Number(workoutSet.weight) || 0,
      notes: workoutSet.notes ?? null,
      })),
  }));
  state.appliedWorkoutPlan = null;
  state.editingWorkoutId = workout.id;
  state.editingWorkoutClientId =
    typeof workout.client_id === "string" && workout.client_id.trim()
      ? workout.client_id.trim()
      : `workout-${workout.id}`;
  state.activeSetEditor = null;
  state.isAddingSet = false;
  state.isSavingWorkout = false;
  state.showAllExerciseOptions = false;
  writeTextStorage(STORAGE_KEYS.tab, "new");
  persistDraft();
  queueScrollRestore("new", 0);
  pushNewFlowHistoryEntry();
  render();
  showFlash("Тренировка открыта для редактирования");
}

async function deleteWorkout(workoutId) {
  const workout = getWorkoutById(workoutId);
  if (!workout) {
    showFlash("Тренировка уже отсутствует");
    return;
  }

  const confirmed = window.confirm(
    `Удалить тренировку от ${formatLongDate(workout.workout_date)}? Это действие нельзя отменить.`
  );
  if (!confirmed) {
    return;
  }

  try {
    const payload = await deleteJson(`/api/workouts/${workoutId}`);
    state.currentUser = payload.user || state.currentUser;
    state.customWorkouts = state.customWorkouts.filter((item) => item.id !== workoutId);
    if (state.openWorkoutSwipeId === workoutId) {
      state.openWorkoutSwipeId = null;
    }
    if (state.editingWorkoutId === workoutId) {
      resetDraftState();
    }
    ensureSelectedProgressExercise();
    render();
    showFlash("Тренировка удалена");
  } catch (error) {
    showFlash(error.message || "Не удалось удалить тренировку");
  }
}

function setSelectedProgressExercise(exerciseId) {
  if (!Number.isFinite(exerciseId) || exerciseId <= 0) {
    return;
  }

  state.selectedProgressExerciseId = exerciseId;
  writeTextStorage(STORAGE_KEYS.progressExercise, String(exerciseId));
  render();
}

function startAddingSet() {
  const selectedExercise = getSelectedExercise();
  if (!selectedExercise) {
    return;
  }

  startAddingSetForExercise(selectedExercise.id);
}

function startAddingSetForExercise(exerciseId) {
  const selectedExercise = getExerciseDefinition(Number(exerciseId));
  if (!selectedExercise) {
    return;
  }

  focusDraftExercise(selectedExercise.id);
  state.currentSetReps = 12;
  state.currentSetWeight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
  state.activeSetEditor = {
    exerciseId: selectedExercise.id,
    setIndex: null,
  };
  state.isAddingSet = true;
  persistDraft();
  render();
}

function cancelAddingSet() {
  state.isAddingSet = false;
  state.activeSetEditor = null;
  render();
}

function addStandardSet() {
  const selectedExercise = getSelectedExercise();
  if (!selectedExercise) {
    return;
  }

  addStandardSetForExercise(selectedExercise.id);
}

function addStandardSetForExercise(exerciseId) {
  const selectedExercise = getExerciseDefinition(Number(exerciseId));
  if (!selectedExercise) {
    return;
  }

  focusDraftExercise(selectedExercise.id);
  const weight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
  addSetToExercise(selectedExercise.id, {
    reps: 12,
    weight,
    notes: null,
  });
}

function applySet() {
  const nextSet = {
    reps: state.currentSetReps,
    weight: state.currentSetWeight,
    notes: null,
  };
  if (state.activeSetEditor && Number.isInteger(state.activeSetEditor.setIndex)) {
    updateDraftSet(
      state.activeSetEditor.exerciseId,
      state.activeSetEditor.setIndex,
      nextSet
    );
    state.selectedExerciseId = state.activeSetEditor.exerciseId;
  } else {
    addSetToExercise(state.activeSetEditor?.exerciseId, nextSet);
  }
  state.activeSetEditor = null;
  state.isAddingSet = false;
  render();
}

function addSetToExercise(exerciseId, setData) {
  const selectedExercise = getExerciseDefinition(Number(exerciseId));
  if (!selectedExercise) {
    return;
  }

  focusDraftExercise(selectedExercise.id);
  const existingIndex = state.workoutExercises.findIndex(
    (exercise) => exercise.exerciseId === selectedExercise.id
  );

  if (existingIndex === -1) {
    state.workoutExercises = [
      ...state.workoutExercises,
      {
        exerciseId: selectedExercise.id,
        exerciseName: selectedExercise.name,
        sets: [setData],
      },
    ];
  } else {
    state.workoutExercises = state.workoutExercises.map((exercise, index) =>
      index === existingIndex
        ? {
            ...exercise,
            sets: [...exercise.sets, setData],
          }
        : exercise
    );
  }

  persistDraft();
  render();
}

function startEditingDraftSet(exerciseId, setIndex) {
  const exercise = state.workoutExercises.find((item) => item.exerciseId === exerciseId);
  const workoutSet = exercise?.sets?.[setIndex];
  if (!exercise || !workoutSet) {
    showFlash("Сет для редактирования не найден");
    return;
  }

  focusDraftExercise(exerciseId);
  state.currentSetReps = Number(workoutSet.reps) || 1;
  state.currentSetWeight = Number(workoutSet.weight) || 0;
  state.activeSetEditor = { exerciseId, setIndex };
  state.isAddingSet = true;
  persistDraft();
  render();
}

function updateDraftSet(exerciseId, setIndex, nextSet) {
  state.workoutExercises = state.workoutExercises.map((exercise) => {
    if (exercise.exerciseId !== exerciseId) {
      return exercise;
    }

    return {
      ...exercise,
      sets: exercise.sets.map((workoutSet, index) =>
        index === setIndex
          ? {
              reps: nextSet.reps,
              weight: nextSet.weight,
              notes: nextSet.notes ?? null,
            }
          : workoutSet
      ),
    };
  });
  persistDraft();
}

function removeDraftSet(exerciseId, setIndex) {
  const nextExercises = [];

  state.workoutExercises.forEach((exercise) => {
    if (exercise.exerciseId !== exerciseId) {
      nextExercises.push(exercise);
      return;
    }

    const nextSets = exercise.sets.filter((_set, index) => index !== setIndex);
    if (nextSets.length) {
      nextExercises.push({
        ...exercise,
        sets: nextSets,
      });
    } else if (state.selectedExerciseId === exerciseId) {
      state.selectedExerciseId = null;
    }
  });

  state.workoutExercises = nextExercises;
  if (!state.workoutExercises.some((exercise) => exercise.exerciseId === state.selectedExerciseId)) {
    state.selectedExerciseId = state.workoutExercises.at(-1)?.exerciseId ?? null;
  }
  if (!state.workoutExercises.length && !state.selectedExerciseId) {
  }
  state.activeSetEditor = null;
  state.isAddingSet = false;
  persistDraft();
  render();
}

function removeDraftExercise(exerciseId) {
  state.workoutExercises = state.workoutExercises.filter(
    (exercise) => exercise.exerciseId !== exerciseId
  );
  if (state.selectedExerciseId === exerciseId) {
    state.selectedExerciseId = state.workoutExercises.at(-1)?.exerciseId ?? null;
  }
  state.activeSetEditor = null;
  state.isAddingSet = false;
  persistDraft();
  render();
}

function finishExercise() {
  state.isAddingSet = false;
  state.showAllExerciseOptions = false;
  persistDraft();
  render();
}

function buildDraftExercisesFromPlan(plan) {
  return (Array.isArray(plan?.data?.exercises) ? plan.data.exercises : []).map((exercise) => ({
    exerciseId: Number(exercise.exercise_id) || 0,
    exerciseName: String(exercise.name || "").trim(),
    sets: Array.isArray(exercise.sets)
      ? exercise.sets.map((set) => ({
          reps: Math.max(1, Number(set.reps) || 1),
          weight: Math.max(0, Number(set.weight) || 0),
          notes: typeof set.notes === "string" && set.notes.trim() ? set.notes.trim() : null,
        }))
      : [],
  }));
}

function applyWorkoutPlanSuggestion() {
  const plan = getNextWorkoutPlanSuggestion();
  if (!plan) {
    showFlash("План следующей тренировки пока недоступен");
    return;
  }

  state.selectedExerciseId = null;
  state.workoutExercises = buildDraftExercisesFromPlan(plan);
  state.workoutDate =
    typeof plan.workout_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan.workout_date)
      ? plan.workout_date
      : getLocalTodayIso();
  state.appliedWorkoutPlan = {
    source: String(plan.source || "heuristic"),
    strategy: String(plan.strategy || "manual"),
    generatedFromWorkoutId:
      Number.isFinite(Number(plan.generated_from_workout_id)) && Number(plan.generated_from_workout_id) > 0
        ? Number(plan.generated_from_workout_id)
        : null,
    generatedFromWorkoutDate: String(plan.generated_from_workout_date || ""),
  };
  state.showAllExerciseOptions = false;
  state.isAddingSet = false;
  state.activeSetEditor = null;
  persistDraft();
  render();
  showFlash("Черновик заполнен по плану");
}

async function finishWorkout() {
  if (!state.workoutExercises.length) {
    showFlash("Добавь хотя бы одно упражнение");
    return;
  }

  if (state.isSavingWorkout) {
    return;
  }

  state.isSavingWorkout = true;
  render();

  try {
    const editingWorkoutId = state.editingWorkoutId;
    const returnTab = getNewFlowReturnTab();
    const shouldUseHistoryBack = hasOpenNewHistoryEntry;
    const payload = editingWorkoutId
      ? await putJson(`/api/workouts/${editingWorkoutId}`, buildLocalWorkout())
      : await postJson("/api/workouts", buildLocalWorkout());
    state.currentUser = payload.user || state.currentUser;
    state.customWorkouts = sortWorkouts([
      payload.workout,
      ...state.customWorkouts.filter((workout) => workout.id !== payload.workout.id),
    ]);
    ensureSelectedProgressExercise();
    resetDraftState();
    if (shouldUseHistoryBack) {
      state.currentTab = returnTab;
      writeTextStorage(STORAGE_KEYS.tab, returnTab);
      queueScrollRestore(returnTab, editingWorkoutId ? null : 0);
      hasOpenNewHistoryEntry = false;
      window.history.back();
    } else {
      state.currentTab = returnTab;
      writeTextStorage(STORAGE_KEYS.tab, returnTab);
      queueScrollRestore(returnTab, editingWorkoutId ? null : 0);
      syncBrowserHistory("replace");
    }
    if (editingWorkoutId) {
      showFlash("Изменения в тренировке сохранены");
    } else {
      showFlash(
        state.currentUser?.is_default_debug_user
          ? "Тренировка сохранена на сервере для default user"
          : "Тренировка сохранена на сервере"
      );
    }
  } catch (error) {
    showFlash(error.message || "Не удалось сохранить тренировку");
  } finally {
    state.isSavingWorkout = false;
    render();
  }
}

function resetDraftState() {
  state.workoutDate = getLocalTodayIso();
  state.appliedWorkoutPlan = null;
  state.selectedExerciseId = null;
  state.workoutExercises = [];
  state.editingWorkoutId = null;
  state.editingWorkoutClientId = null;
  state.newFlowOriginTab = "trainings";
  hasOpenNewHistoryEntry = false;
  state.openWorkoutSwipeId = null;
  state.activeSetEditor = null;
  state.showAllExerciseOptions = false;
  state.isAddingSet = false;
  state.currentSetReps = 12;
  state.currentSetWeight = 0;
  localStorage.removeItem(STORAGE_KEYS.draft);
}

function resetWorkoutDraftWithConfirmation() {
  const confirmMessage = state.editingWorkoutId
    ? "Отменить редактирование и сбросить изменения?"
    : "Сбросить текущий черновик тренировки?";
  if (!window.confirm(confirmMessage)) {
    return;
  }

  const wasEditingWorkout = Boolean(state.editingWorkoutId);
  const returnTab = getNewFlowReturnTab();
  const shouldUseHistoryBack = hasOpenNewHistoryEntry;
  resetDraftState();
  if (wasEditingWorkout) {
    if (shouldUseHistoryBack) {
      state.currentTab = returnTab;
      writeTextStorage(STORAGE_KEYS.tab, returnTab);
      queueScrollRestore(returnTab);
      window.history.back();
    } else {
      state.currentTab = returnTab;
      writeTextStorage(STORAGE_KEYS.tab, returnTab);
      queueScrollRestore(returnTab);
      syncBrowserHistory("replace");
      render();
    }
    showFlash("Редактирование отменено");
  } else {
    showFlash("Черновик тренировки очищен");
    render();
  }
}

function buildLocalWorkout() {
  return {
    client_id: state.editingWorkoutClientId || buildWorkoutClientId(),
    workout_date: state.workoutDate,
    plan_id: null,
    data: {
      focus: null,
      notes: null,
      load_type: inferLoadType(state.workoutExercises),
      exercises: state.workoutExercises.map((exercise) => ({
        exercise_id: exercise.exerciseId,
        name: exercise.exerciseName,
        sets: exercise.sets.map((set, index) => ({
          reps: set.reps,
          notes: set.notes ?? null,
          weight: set.weight,
          set_index: index + 1,
        })),
      })),
    },
  };
}

function inferLoadType(workoutExercises) {
  const totalVolume = workoutExercises.reduce((accumulator, exercise) => {
    return (
      accumulator +
      exercise.sets.reduce((total, set) => {
        return total + (set.weight > 0 && set.reps > 0 ? set.weight * set.reps : 0);
      }, 0)
    );
  }, 0);

  if (totalVolume >= 3000) {
    return "heavy";
  }
  if (totalVolume >= 1600) {
    return "medium";
  }
  return "light";
}

function getWeightFromLastWorkout(workouts, exerciseId) {
  const sorted = sortWorkouts(workouts);
  for (const workout of sorted) {
    const exercise = workout.data.exercises.find((item) => item.exercise_id === exerciseId);
    if (!exercise) {
      continue;
    }

    const weights = exercise.sets.map((set) => set.weight || 0);
    const maxWeight = Math.max(0, ...weights);
    if (maxWeight > 0) {
      return maxWeight;
    }
  }
  return 0;
}

function hasValidWorkoutData(workouts, exerciseId) {
  const sorted = sortWorkouts(workouts);
  for (const workout of sorted) {
    const exercise = workout.data.exercises.find((item) => item.exercise_id === exerciseId);
    if (!exercise) {
      continue;
    }
    if (exercise.sets.some((set) => set.weight > 0 && set.reps > 0)) {
      return true;
    }
  }
  return false;
}

function groupConsecutiveExerciseSets(sets) {
  if (!sets.length) {
    return [];
  }

  const grouped = [];
  let current = null;

  for (const set of sets) {
    if (
      current &&
      current.weight === set.weight &&
      current.reps === set.reps &&
      current.notes === (set.notes ?? null)
    ) {
      current.count += 1;
      current.lastSetIndex = set.set_index;
    } else {
      if (current) {
        grouped.push(current);
      }
      current = {
        weight: set.weight,
        reps: set.reps,
        count: 1,
        firstSetIndex: set.set_index,
        lastSetIndex: set.set_index,
        notes: set.notes ?? null,
      };
    }
  }

  if (current) {
    grouped.push(current);
  }

  return grouped;
}

function groupWorkoutSetsByWeightAndReps(sets) {
  if (!sets.length) {
    return [];
  }

  const grouped = [];
  let current = null;

  for (const set of sets) {
    if (current && current.weight === set.weight && current.reps === set.reps) {
      current.count += 1;
    } else {
      if (current) {
        grouped.push(current);
      }
      current = {
        weight: set.weight,
        reps: set.reps,
        count: 1,
      };
    }
  }

  if (current) {
    grouped.push(current);
  }

  return grouped;
}

function summarizeProgress(workouts, rangeKey) {
  const filtered = getWorkoutsInRange(workouts, rangeKey);

  if (!filtered.length) {
    return {
      totalWorkouts: 0,
    };
  }

  return {
    totalWorkouts: filtered.length,
  };
}

function getWorkoutsInRange(workouts, rangeKey) {
  const range = PROGRESS_RANGES.find((item) => item.key === rangeKey) || PROGRESS_RANGES[1];
  const today = parseIsoDate(getLocalTodayIso());

  return workouts
    .map((workout) => {
      const date = parseIsoDate(workout.workout_date);
      return { workout, date };
    })
    .filter(({ date }) => inRange(date, range.days, today))
    .sort((left, right) => right.date - left.date)
    .map(({ workout }) => workout);
}

function buildExerciseProgressSeries(workouts, rangeKey, exerciseId) {
  return getWorkoutsInRange(workouts, rangeKey)
    .map((workout) => {
      const exercise = workout.data.exercises.find((item) => item.exercise_id === exerciseId);
      if (!exercise) {
        return null;
      }

      const heaviestSet = pickHeaviestSet(exercise.sets);
      const highestRepSet = pickHighestRepSet(exercise.sets);
      if (!heaviestSet || !highestRepSet) {
        return null;
      }

      return {
        workoutId: workout.id,
        workoutDate: workout.workout_date,
        bestWeight: Number(heaviestSet.weight) || 0,
        repsAtBestWeight: Number(heaviestSet.reps) || 0,
        bestReps: Number(highestRepSet.reps) || 0,
        weightAtBestReps: Number(highestRepSet.weight) || 0,
      };
    })
    .filter(Boolean)
    .reverse();
}

function pickHeaviestSet(sets) {
  let bestSet = null;

  for (const set of sets) {
    if (
      !bestSet ||
      set.weight > bestSet.weight ||
      (set.weight === bestSet.weight && set.reps > bestSet.reps) ||
      (set.weight === bestSet.weight &&
        set.reps === bestSet.reps &&
        (set.set_index || 0) > (bestSet.set_index || 0))
    ) {
      bestSet = set;
    }
  }

  return bestSet;
}

function pickHighestRepSet(sets) {
  let bestSet = null;

  for (const set of sets) {
    if (
      !bestSet ||
      set.reps > bestSet.reps ||
      (set.reps === bestSet.reps && set.weight > bestSet.weight) ||
      (set.reps === bestSet.reps &&
        set.weight === bestSet.weight &&
        (set.set_index || 0) > (bestSet.set_index || 0))
    ) {
      bestSet = set;
    }
  }

  return bestSet;
}

function summarizeExerciseSeries(series) {
  if (!series.length) {
    return null;
  }

  const firstPoint = series[0];
  const latestPoint = series[series.length - 1];

  return {
    firstPoint,
    latestPoint,
    weightDelta: latestPoint.bestWeight - firstPoint.bestWeight,
    repsDelta: latestPoint.bestReps - firstPoint.bestReps,
  };
}

function inRange(date, rangeDays, today) {
  if (rangeDays == null) {
    return true;
  }

  const start = new Date(today);
  start.setDate(start.getDate() - (rangeDays - 1));
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target >= start && target <= today;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getLocalTodayIso() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function buildWorkoutClientId() {
  return `workout-${Date.now()}`;
}

async function migrateLegacyCustomWorkouts() {
  const legacyWorkouts = readJsonStorage(STORAGE_KEYS.customWorkouts, []);
  if (!Array.isArray(legacyWorkouts) || !legacyWorkouts.length) {
    return;
  }

  for (const workout of legacyWorkouts) {
    const migratedWorkout = {
      ...workout,
      client_id: String(workout.id || buildWorkoutClientId()),
    };
    await postJson("/api/workouts", migratedWorkout);
  }

  localStorage.removeItem(STORAGE_KEYS.customWorkouts);
  state.customWorkouts = [];
  showFlash("Старые локальные тренировки перенесены на сервер");
}

function getScrollTop() {
  return Math.max(
    0,
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
  );
}

function captureScrollPosition(tab = state.currentTab) {
  state.scrollPositions[normalizeScrollTab(tab)] = getScrollTop();
}

function scrollCurrentTabToTop() {
  const tab = normalizeScrollTab(state.currentTab);
  state.scrollPositions[tab] = 0;
  state.pendingScrollRestoreTop = null;

  const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    ? "auto"
    : "smooth";
  window.scrollTo({
    top: 0,
    behavior,
  });
}

function queueScrollRestore(tab, top = null) {
  const restoredTop =
    top == null
      ? state.scrollPositions[normalizeScrollTab(tab)] || 0
      : Math.max(0, Number(top) || 0);
  state.pendingScrollRestoreTop = restoredTop;
}

function flushPendingScrollRestore() {
  if (state.pendingScrollRestoreTop == null) {
    return;
  }

  const top = state.pendingScrollRestoreTop;
  state.pendingScrollRestoreTop = null;
  window.requestAnimationFrame(() => {
    window.scrollTo(0, top);
  });
}

function syncBrowserHistory(mode = "replace") {
  if (!window.history?.replaceState) {
    return;
  }

  const historyState = {
    trainerMiniAppNav: true,
    trainerMiniAppTab: state.currentTab,
    trainerMiniAppOriginTab: state.newFlowOriginTab,
  };

  try {
    if (mode === "push" && window.history.pushState) {
      window.history.pushState(historyState, "");
    } else {
      window.history.replaceState(historyState, "");
    }
  } catch (_error) {
    // Some webviews can reject history mutations. Safe to ignore.
  }
}

function pushNewFlowHistoryEntry() {
  hasOpenNewHistoryEntry = true;
  syncBrowserHistory("push");
}

function armSwipeClickGuard(workoutId) {
  swipeClickGuard = {
    workoutId,
    expiresAt: Date.now() + WORKOUT_SWIPE_CLICK_GUARD_MS,
  };
}

function clearSwipeClickGuard() {
  swipeClickGuard = null;
}

function shouldSuppressSwipeSurfaceClick(event) {
  if (!swipeClickGuard) {
    return false;
  }

  if (Date.now() > swipeClickGuard.expiresAt) {
    clearSwipeClickGuard();
    return false;
  }

  const surface = event.target.closest("[data-workout-swipe-surface]");
  if (!surface) {
    return false;
  }

  const workoutId = Number(surface.dataset.workoutId);
  if (!Number.isFinite(workoutId) || workoutId !== swipeClickGuard.workoutId) {
    return false;
  }

  return true;
}

function closeWorkoutSwipe(renderAfter = true) {
  if (state.openWorkoutSwipeId == null) {
    return;
  }

  state.openWorkoutSwipeId = null;
  if (renderAfter) {
    render();
  }
}

function applyWorkoutSwipeOffset(surface, offset, withTransition = false) {
  if (!surface) {
    return;
  }

  if (withTransition) {
    surface.classList.remove("workout-card-surface-dragging");
  } else {
    surface.classList.add("workout-card-surface-dragging");
  }
  surface.style.transform = `translateX(${offset}px)`;
}

function handleWorkoutSwipePointerDown(event) {
  const swipeCard = event.target.closest("[data-workout-swipe-card]");
  if (!swipeCard) {
    if (
      state.openWorkoutSwipeId != null &&
      !event.target.closest("[data-workout-swipe-actions]")
    ) {
      if (event.target.closest("[data-action], button, a, input, select, textarea, label")) {
        return;
      }
      closeWorkoutSwipe();
    }
    return;
  }

  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  if (event.target.closest("[data-action]")) {
    return;
  }

  if (event.target.closest("a, input, select, textarea, label")) {
    return;
  }

  const surface = swipeCard.querySelector("[data-workout-swipe-surface]");
  if (!surface) {
    return;
  }

  const workoutId = Number(surface.dataset.workoutId);
  if (!Number.isFinite(workoutId)) {
    return;
  }

  const isCurrentlyOpen = state.openWorkoutSwipeId === workoutId;
  if (!isCurrentlyOpen) {
    const rect = surface.getBoundingClientRect();
    const edgeWidth = Math.min(WORKOUT_SWIPE_EDGE_START_PX, rect.width * 0.34);
    const edgeStartX = rect.right - edgeWidth;
    if (event.clientX < edgeStartX) {
      return;
    }
  }

  if (state.openWorkoutSwipeId != null && state.openWorkoutSwipeId !== workoutId) {
    closeWorkoutSwipe();
    return;
  }

  workoutSwipeGesture = {
    pointerId: event.pointerId,
    workoutId,
    surface,
    startX: event.clientX,
    startY: event.clientY,
    baseOffset: isCurrentlyOpen ? -WORKOUT_SWIPE_ACTIONS_WIDTH : 0,
    lastOffset: isCurrentlyOpen ? -WORKOUT_SWIPE_ACTIONS_WIDTH : 0,
    mode: "pending",
  };

  surface.setPointerCapture?.(event.pointerId);
}

function handleWorkoutSwipePointerMove(event) {
  if (!workoutSwipeGesture || event.pointerId !== workoutSwipeGesture.pointerId) {
    return;
  }

  const deltaX = event.clientX - workoutSwipeGesture.startX;
  const deltaY = event.clientY - workoutSwipeGesture.startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  if (workoutSwipeGesture.mode === "pending") {
    if (
      absDeltaX < WORKOUT_SWIPE_GESTURE_THRESHOLD &&
      absDeltaY < WORKOUT_SWIPE_GESTURE_THRESHOLD
    ) {
      return;
    }

    if (
      absDeltaX >= WORKOUT_SWIPE_GESTURE_THRESHOLD &&
      absDeltaX >= absDeltaY * WORKOUT_SWIPE_HORIZONTAL_RATIO
    ) {
      workoutSwipeGesture.mode = "swiping";
    } else if (
      absDeltaY >= WORKOUT_SWIPE_GESTURE_THRESHOLD &&
      absDeltaY > absDeltaX * WORKOUT_SWIPE_VERTICAL_RATIO
    ) {
      workoutSwipeGesture.mode = "scrolling";
      return;
    } else {
      return;
    }
  }

  if (workoutSwipeGesture.mode !== "swiping") {
    return;
  }

  event.preventDefault();
  const nextOffset = Math.max(
    -WORKOUT_SWIPE_ACTIONS_WIDTH,
    Math.min(0, workoutSwipeGesture.baseOffset + deltaX)
  );
  workoutSwipeGesture.lastOffset = nextOffset;
  applyWorkoutSwipeOffset(workoutSwipeGesture.surface, nextOffset, false);
}

function handleWorkoutSwipePointerUp(event) {
  if (!workoutSwipeGesture || event.pointerId !== workoutSwipeGesture.pointerId) {
    return;
  }

  const { surface, workoutId, mode, baseOffset } = workoutSwipeGesture;
  const deltaX = event.clientX - workoutSwipeGesture.startX;
  const deltaY = event.clientY - workoutSwipeGesture.startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);
  const finalOffset = Math.max(-WORKOUT_SWIPE_ACTIONS_WIDTH, Math.min(0, baseOffset + deltaX));
  const treatedAsSwipe =
    mode === "swiping" ||
    (absDeltaX >= WORKOUT_SWIPE_GESTURE_THRESHOLD &&
      absDeltaX >= absDeltaY * WORKOUT_SWIPE_HORIZONTAL_RATIO);
  surface.releasePointerCapture?.(event.pointerId);
  workoutSwipeGesture = null;

  if (treatedAsSwipe) {
    const shouldOpen = finalOffset <= -WORKOUT_SWIPE_ACTIONS_WIDTH / 2;
    state.openWorkoutSwipeId = shouldOpen ? workoutId : null;
    armSwipeClickGuard(workoutId);
    render();
    return;
  }

  if (mode === "pending" && state.openWorkoutSwipeId === workoutId) {
    closeWorkoutSwipe();
  }
}

function restoreTabFromHistory(tab, options = {}) {
  const nextTab = tab === "new" ? "new" : normalizeNavTab(tab);
  if (options.captureCurrent !== false && nextTab !== state.currentTab) {
    captureScrollPosition(state.currentTab);
  }

  state.currentTab = nextTab;
  pendingScreenTransition = true;
  writeTextStorage(STORAGE_KEYS.tab, nextTab);
  ensureNewWorkoutFlow();
  queueScrollRestore(nextTab, options.top ?? null);
  render();
}

function handlePopState(event) {
  const historyState = event.state;

  if (!historyState?.trainerMiniAppNav) {
    if (state.currentTab === "new" && hasOpenNewHistoryEntry) {
      hasOpenNewHistoryEntry = false;
      restoreTabFromHistory(getNewFlowReturnTab(), { captureCurrent: false });
    }
    return;
  }

  if (historyState.trainerMiniAppTab === "new") {
    state.newFlowOriginTab = normalizeNavTab(historyState.trainerMiniAppOriginTab);
    hasOpenNewHistoryEntry = true;
    restoreTabFromHistory("new", { top: 0 });
    return;
  }

  if (state.currentTab === "new") {
    hasOpenNewHistoryEntry = false;
  }
  state.newFlowOriginTab = normalizeNavTab(historyState.trainerMiniAppTab);
  restoreTabFromHistory(historyState.trainerMiniAppTab, { captureCurrent: false });
}

function updateTelegramBackButton() {
  if (!tg?.BackButton) {
    return;
  }

  if (state.currentTab === "new" && !state.booting && !state.loadError) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

function handleTelegramBackRequest() {
  if (state.currentTab === "new") {
    closeNewWorkout();
  }
}

function installTestApi() {
  if (!isLocalDevHost()) {
    return;
  }

  window.__trainerMiniAppTestApi = {
    openWorkoutSwipe(workoutId) {
      const normalizedId = Number(workoutId);
      if (!Number.isFinite(normalizedId)) {
        return false;
      }

      state.openWorkoutSwipeId = normalizedId;
      render();
      return true;
    },
    closeOpenWorkoutSwipe() {
      closeWorkoutSwipe();
      return true;
    },
    getBodyWeightEntries() {
      return state.bodyWeightEntries.map((entry) => ({ ...entry }));
    },
    getBodyWeightValue() {
      return state.bodyWeightValue;
    },
    deleteBodyWeightEntry(entryId) {
      return deleteBodyWeightEntry(Number(entryId));
    },
  };
}

function render() {
  if (state.booting) {
    root.innerHTML = `
      <div class="layout">
        <main class="screen loading-state">
          <section class="loading-shell" aria-live="polite" aria-busy="true">
            <div class="loading-hero">
              <div class="loading-kicker">Trainer</div>
              <div class="loading-visual" aria-hidden="true">
                <div class="loading-aura loading-aura-left"></div>
                <div class="loading-aura loading-aura-right"></div>
                <div class="loading-barbell">
                  <span class="loading-plate loading-plate-left-outer"></span>
                  <span class="loading-plate loading-plate-left-inner"></span>
                  <span class="loading-bar"></span>
                  <span class="loading-plate loading-plate-right-inner"></span>
                  <span class="loading-plate loading-plate-right-outer"></span>
                </div>
                <div class="loading-floor"></div>
              </div>
              <div class="loading-copy-block">
                <h1 class="loading-title">Собираю тренировочный зал</h1>
                <p class="loading-copy">
                  Подключаю пользователя, подтягиваю историю тренировок и готовлю экран к работе.
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    `;
    updateTelegramBackButton();
    flushPendingScrollRestore();
    return;
  }

  if (state.loadError) {
    root.innerHTML = `
      <div class="layout">
        <main class="screen empty-state">
          <div class="stack" style="justify-items:center;">
            <h1 class="topbar-title">Не удалось загрузить приложение</h1>
            <p class="muted-note">${escapeHtml(state.loadError)}</p>
            <button class="primary-button" data-action="refresh-progress">Повторить</button>
          </div>
        </main>
      </div>
    `;
    updateTelegramBackButton();
    flushPendingScrollRestore();
    return;
  }

  const topbar = renderTopbar();
  const screen = renderCurrentScreen();
  const screenStageClass = pendingScreenTransition ? "screen-stage screen-stage-enter" : "screen-stage";
  const nav = renderBottomNav();
  const fab = renderFloatingActionButton();
  const modal = state.isAddingSet ? renderSetModal() : "";
  const toast = state.flashMessage ? `<div class="toast">${escapeHtml(state.flashMessage)}</div>` : "";

  root.innerHTML = `
    <div class="layout">
      ${topbar}
      <main class="screen">
        <div class="${screenStageClass}">
          ${screen}
        </div>
      </main>
      ${fab}
      ${toast}
      ${nav}
      ${modal}
    </div>
  `;
  pendingScreenTransition = false;
  updateTelegramBackButton();
  flushPendingScrollRestore();
}

function renderTopbar() {
  const titles = {
    trainings: "Trainings",
    progress: "Progress",
    body: "Вес тела",
    new: state.editingWorkoutId ? "Редактирование" : "Новая тренировка",
  };

  const buildPills = buildTopbarPills();
  let actionMarkup = "";
  const topbarRowClass = "topbar-row topbar-row-compact topbar-row-centered";

  if (state.currentTab === "new") {
    actionMarkup = `
      <div class="topbar-action-group">
        <label
          class="pill topbar-date-button topbar-date-pill"
          title="${escapeHtml(formatLongDate(state.workoutDate))}"
        >
          <span class="topbar-date-text">${escapeHtml(formatTopbarWorkoutDate(state.workoutDate))}</span>
          <input
            id="topbar-workout-date"
            class="topbar-date-input"
            type="date"
            value="${escapeHtml(state.workoutDate)}"
            data-action="change-workout-date"
            aria-label="Дата тренировки"
          />
        </label>
      </div>
    `;
  }

  return `
    <header class="topbar topbar-compact">
      <h1 class="sr-only topbar-title">${escapeHtml(titles[state.currentTab])}</h1>
      <div class="${topbarRowClass}">
        <div class="topbar-meta topbar-meta-compact">${buildPills}</div>
        ${actionMarkup ? `<div class="topbar-actions">${actionMarkup}</div>` : ""}
      </div>
    </header>
  `;
}

function renderCurrentScreen() {
  switch (state.currentTab) {
    case "trainings":
      return renderTrainingsScreen();
    case "progress":
      return renderProgressScreen();
    case "body":
      return renderBodyWeightScreen();
    case "new":
    default:
      return renderNewWorkoutScreen();
  }
}

function renderTrainingsScreen() {
  const workouts = getAllWorkouts();
  const nextWorkoutPlan = getNextWorkoutPlanSuggestion(workouts);
  if (!workouts.length) {
    return renderEmptyState("Пока нет тренировок");
  }

  return `
    <section class="stack">
      ${nextWorkoutPlan ? renderNextWorkoutPlanCard(nextWorkoutPlan) : ""}
      ${workouts.map((workout) => renderWorkoutCard(workout)).join("")}
      <a class="debug-link" href="/stub.html">Открыть старую debug-заглушку</a>
    </section>
  `;
}

function buildNextWorkoutPlanSuggestion(workouts) {
  if (!Array.isArray(workouts) || !workouts.length) {
    return null;
  }

  const latestWorkout = workouts[0];
  const exercises = Array.isArray(latestWorkout?.data?.exercises) ? latestWorkout.data.exercises : [];
  if (!exercises.length) {
    return null;
  }

  const plannedExercises = exercises.map((exercise) => ({
    exercise_id: exercise.exercise_id,
    name: exercise.name,
    sets: Array.isArray(exercise.sets)
      ? exercise.sets.map((set, index) => ({
          reps: Math.max(1, (Number(set.reps) || 0) + 1),
          weight: Number(set.weight) || 0,
          notes: typeof set.notes === "string" && set.notes.trim() ? set.notes.trim() : null,
          set_index: index + 1,
        }))
      : [],
  }));

  return {
    source: "heuristic",
    strategy: "last_workout_plus_one_rep_v1",
    generated_from_workout_id: latestWorkout.id,
    generated_from_workout_date: latestWorkout.workout_date,
    workout_date: getLocalTodayIso(),
    explanation: "Берём последнюю тренировку и добавляем по одному повтору в каждом сете.",
    data: {
      focus: latestWorkout.data?.focus ?? null,
      notes: latestWorkout.data?.notes ?? null,
      load_type: latestWorkout.data?.load_type ?? inferLoadTypeFromApiExercises(plannedExercises),
      exercises: plannedExercises,
    },
  };
}

function inferLoadTypeFromApiExercises(exercises) {
  const draftExercises = (Array.isArray(exercises) ? exercises : []).map((exercise) => ({
    exerciseId: Number(exercise.exercise_id) || 0,
    exerciseName: String(exercise.name || ""),
    sets: Array.isArray(exercise.sets)
      ? exercise.sets.map((set) => ({
          reps: Math.max(1, Number(set.reps) || 1),
          weight: Math.max(0, Number(set.weight) || 0),
          notes: set.notes ?? null,
        }))
      : [],
  }));

  return inferLoadType(draftExercises);
}

function renderNextWorkoutPlanCard(plan) {
  return `
    <section class="card next-plan-card">
      <div class="next-plan-head">
        <div class="next-plan-copy">
          <div class="next-plan-kicker">План следующей тренировки</div>
          <div class="next-plan-subtitle">
            Основано на тренировке от ${escapeHtml(formatLongDate(plan.generated_from_workout_date))}.
          </div>
        </div>
        <div class="next-plan-badges">
          <span class="next-plan-rule">+1 повт/сет</span>
          ${renderLoadBadge(plan.data.load_type)}
        </div>
      </div>
      <div class="next-plan-list">
        ${plan.data.exercises.map((exercise) => renderNextPlanExerciseRow(exercise)).join("")}
      </div>
    </section>
  `;
}

function renderNextPlanExerciseRow(exercise) {
  const compactSets = summarizeExerciseSets(exercise.sets);
  return `
    <article class="next-plan-row">
      <div class="next-plan-row-inline">
        <span class="next-plan-row-name">${escapeHtml(exercise.name)}</span>
        <span class="next-plan-row-summary">
          ${compactSets.parts
            .map(
              (part) => `
                <span class="next-plan-row-part">${escapeHtml(part)}</span>
              `
            )
            .join("")}
        </span>
      </div>
    </article>
  `;
}

function renderWorkoutCard(workout) {
  const badge = workout.data.load_type ? renderLoadBadge(workout.data.load_type) : "";
  const isSwipeOpen = state.openWorkoutSwipeId === workout.id;
  const dateSummary = `${formatLongDate(workout.workout_date)}, ${formatWeekday(workout.workout_date)}`;
  return `
    <section
      class="workout-swipe-card ${isSwipeOpen ? "workout-swipe-card-open" : ""}"
      data-workout-swipe-card
    >
      <div class="workout-swipe-actions" data-workout-swipe-actions>
        <button
          class="workout-swipe-action workout-swipe-action-edit"
          data-action="edit-workout"
          data-workout-id="${workout.id}"
          aria-label="Редактировать тренировку"
          title="Редактировать тренировку"
        >
          ${renderSwipeActionIcon("edit")}
          <span class="sr-only">Редактировать</span>
        </button>
        <button
          class="workout-swipe-action workout-swipe-action-delete"
          data-action="delete-workout"
          data-workout-id="${workout.id}"
          aria-label="Удалить тренировку"
          title="Удалить тренировку"
        >
          ${renderSwipeActionIcon("delete")}
          <span class="sr-only">Удалить</span>
        </button>
      </div>
      <div
        class="workout-card workout-card-surface ${isSwipeOpen ? "workout-card-surface-open" : ""}"
        data-workout-swipe-surface
        data-workout-id="${workout.id}"
      >
        <div class="workout-header">
          <div class="workout-date-line">${escapeHtml(dateSummary)}</div>
          <div class="workout-header-side">
            ${badge}
          </div>
        </div>
        <div class="workout-exercise-list">
          ${workout.data.exercises.map((exercise) => renderLoggedExerciseCard(exercise)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderSwipeActionIcon(kind) {
  switch (kind) {
    case "edit":
      return `
        <svg class="workout-swipe-action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 20h3.75l10.2-10.2-3.75-3.75L4 16.25V20zm14.7-11.95a1 1 0 0 0 0-1.4l-1.35-1.35a1 1 0 0 0-1.4 0L14.9 6.35l3.75 3.75 1.05-1.05z"
            fill="currentColor"
          />
        </svg>
      `;
    case "delete":
      return `
        <svg class="workout-swipe-action-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v7h-2v-7zm4 0h2v7h-2v-7zM7 8h10l-.85 11.1A2 2 0 0 1 14.16 21H9.84a2 2 0 0 1-1.99-1.9L7 8z"
            fill="currentColor"
          />
        </svg>
      `;
    default:
      return "";
  }
}

function renderLoggedExerciseCard(exercise) {
  const compactSets = summarizeExerciseSets(exercise.sets);
  return `
    <article class="workout-exercise-row">
      <div class="workout-exercise-inline">
        <span class="workout-exercise-name">${escapeHtml(exercise.name)}</span>
        <span class="workout-set-summary-inline">
          ${compactSets.parts
            .map(
              (part) => `
                <span class="workout-set-summary-part">${escapeHtml(part)}</span>
              `
            )
            .join("")}
        </span>
      </div>
      ${
        compactSets.notes.length
          ? `<div class="set-notes-inline">${compactSets.notes
              .map((note) => escapeHtml(note))
              .join(" · ")}</div>`
          : ""
      }
    </article>
  `;
}

function summarizeExerciseSets(sets) {
  if (!Array.isArray(sets) || !sets.length) {
    return {
      parts: ["Пока нет сетов"],
      notes: [],
    };
  }

  const grouped = [];
  let current = null;

  sets.forEach((set) => {
    const weight = Number(set.weight) || 0;
    const reps = Number(set.reps) || 0;
    const note = typeof set.notes === "string" ? set.notes.trim() : "";

    if (current && current.weight === weight) {
      current.reps.push(reps);
    } else {
      if (current) {
        grouped.push(current);
      }
      current = {
        weight,
        reps: [reps],
      };
    }
  });

  if (current) {
    grouped.push(current);
  }

  return {
    parts: grouped.map((group) => `${formatWeight(group.weight)}кг ×${summarizeRepRuns(group.reps)}`),
    notes: sets
      .map((set) => (typeof set.notes === "string" ? set.notes.trim() : ""))
      .filter(Boolean),
  };
}

function summarizeRepRuns(reps) {
  if (!Array.isArray(reps) || !reps.length) {
    return "0";
  }

  const parts = [];
  let currentRep = reps[0];
  let count = 1;

  for (let index = 1; index < reps.length; index += 1) {
    const nextRep = reps[index];
    if (nextRep === currentRep) {
      count += 1;
      continue;
    }

    parts.push(count > 1 ? `${currentRep}×${count}` : String(currentRep));
    currentRep = nextRep;
    count = 1;
  }

  parts.push(count > 1 ? `${currentRep}×${count}` : String(currentRep));
  return parts.join(", ");
}

function renderProgressScreen() {
  const workouts = getAllWorkouts();
  const summary = summarizeProgress(workouts, state.selectedRange);
  const progressExercises = getProgressExercises(workouts);
  const selectedExercise =
    progressExercises.find((exercise) => exercise.id === state.selectedProgressExerciseId) || null;
  const progressSeries = selectedExercise
    ? buildExerciseProgressSeries(workouts, state.selectedRange, selectedExercise.id)
    : [];
  const exerciseSummary = summarizeExerciseSeries(progressSeries);

  return `
    <section class="stack">
      <div class="range-row">
        ${PROGRESS_RANGES.map(
          (range) => `
            <button
              class="chip ${range.key === state.selectedRange ? "active" : ""}"
              data-action="select-range"
              data-range="${range.key}"
            >
              ${range.label}
            </button>
          `
        ).join("")}
      </div>

      ${renderMetricCard(
        "Тренировок за период",
        String(summary.totalWorkouts),
        getRangeDescription(state.selectedRange)
      )}

      ${
        progressExercises.length
          ? renderProgressExercisePicker(progressExercises, selectedExercise, progressSeries.length)
          : `
            <section class="card metric-card">
              <div class="metric-label">Прогресс по упражнениям</div>
              <div class="metric-subtitle">
                Когда появятся сохранённые тренировки, здесь можно будет выбрать упражнение и посмотреть его рост по времени.
              </div>
            </section>
          `
      }

      ${
        selectedExercise
          ? renderExerciseProgressCard(selectedExercise, progressSeries, exerciseSummary)
          : ""
      }
    </section>
  `;
}

function renderBodyWeightScreen() {
  const filteredEntries = getBodyWeightEntriesInRange(
    state.bodyWeightEntries,
    state.selectedBodyWeightRange
  );
  const summary = summarizeBodyWeightEntries(filteredEntries, state.bodyWeightEntries);

  return `
    <section class="stack">
      <div class="range-row">
        ${PROGRESS_RANGES.map(
          (range) => `
            <button
              class="chip ${range.key === state.selectedBodyWeightRange ? "active" : ""}"
              data-action="select-body-weight-range"
              data-range="${range.key}"
            >
              ${range.label}
            </button>
          `
        ).join("")}
      </div>

      ${renderBodyWeightComposerCard()}

      ${renderBodyWeightStatsStrip(summary)}

      ${
        filteredEntries.length
          ? renderBodyWeightChartCard(filteredEntries, summary)
          : `
            <section class="card progress-panel body-weight-panel">
              <div class="section-title">Вес тела</div>
              <p class="muted-note">
                В этом диапазоне пока нет записей. Сохрани первое значение, и здесь появится график.
              </p>
            </section>
          `
      }
    </section>
  `;
}

function renderBodyWeightStatsStrip(summary) {
  return `
    <section class="body-weight-stats-block">
      <div class="body-weight-stats-strip">
        ${renderBodyWeightStatChip(
          "Последний",
          summary.latestOverallEntry ? `${formatWeight(summary.latestOverallEntry.weight)} кг` : "—"
        )}
        ${renderBodyWeightStatChip(
          "Дельта",
          summary.totalEntries ? formatSignedBodyWeight(summary.delta) : "—"
        )}
        ${renderBodyWeightStatChip("Записей", String(summary.totalEntries))}
      </div>
    </section>
  `;
}

function renderBodyWeightStatChip(label, value) {
  return `
    <article class="body-weight-stat-chip">
      <div class="body-weight-stat-label">${escapeHtml(label)}</div>
      <div class="body-weight-stat-value">${escapeHtml(value)}</div>
    </article>
  `;
}

function renderBodyWeightComposerCard() {
  return `
    <section class="card progress-panel body-weight-panel">
      <div class="body-weight-inline-form">
        <label
          class="pill body-weight-date-chip"
          title="${escapeHtml(formatLongDate(state.bodyWeightDate))}"
        >
          <span class="body-weight-date-text">${escapeHtml(formatTopbarWorkoutDate(state.bodyWeightDate))}</span>
          <input
            class="body-weight-date-input"
            type="date"
            value="${escapeHtml(state.bodyWeightDate)}"
            data-action="change-body-weight-date"
            aria-label="Дата веса тела"
          />
        </label>

        <div class="body-weight-input-wrap">
          <input
            id="body-weight-value"
            class="date-input body-weight-input body-weight-number-input"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            spellcheck="false"
            placeholder="82,4"
            value="${escapeHtml(state.bodyWeightValue)}"
            data-action="change-body-weight-value"
            aria-label="Вес тела"
          />
          <span class="body-weight-unit">кг</span>
        </div>
      </div>

      <button
        class="primary-button body-weight-save-button"
        data-action="save-body-weight"
        ${state.isSavingBodyWeight ? "disabled" : ""}
      >
        ${state.isSavingBodyWeight ? "Сохраняю..." : "Сохранить вес"}
      </button>
    </section>
  `;
}

function renderBodyWeightChartCard(entries, summary) {
  const values = entries.map((entry) => Number(entry.weight) || 0);
  const width = 640;
  const height = 292;
  const leftPadding = 18;
  const rightPadding = 20;
  const top = 22;
  const bottom = 36;
  const points = buildChartPointsWithInsets(
    values,
    width,
    height,
    leftPadding,
    rightPadding,
    top,
    bottom
  );
  const yAxisMarks = buildChartValueMarks(values, height, top, bottom);

  return `
    <section class="card progress-panel body-weight-panel">
      <div class="progress-panel-head">
        <div>
          <div class="section-title">График веса</div>
          <div class="metric-subtitle">
            ${summary.latestEntry
              ? `Последняя запись: ${formatBodyWeightValue(summary.latestEntry.weight)} кг • ${escapeHtml(formatShortDate(summary.latestEntry.entry_date))}`
              : "Добавляй вес регулярно, чтобы видеть динамику."}
          </div>
        </div>
      </div>

      <div class="progress-chart-wrap body-weight-chart-wrap">
        <div class="body-weight-chart-layout">
          <div class="body-weight-y-axis" aria-hidden="true">
            ${yAxisMarks
              .map(
                (mark) => `
                  <span
                    class="body-weight-y-axis-label"
                    style="top:${((mark.y / height) * 100).toFixed(3)}%;"
                  >
                    ${escapeHtml(formatBodyWeightValue(mark.value))}
                  </span>
                `
              )
              .join("")}
          </div>

          <div class="body-weight-chart-main">
            <svg class="progress-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График веса тела">
              ${yAxisMarks
                .map((mark) => {
                  return `<line class="progress-grid-line" x1="${leftPadding}" y1="${mark.y}" x2="${width - rightPadding}" y2="${mark.y}"></line>`;
                })
                .join("")}
              <polyline class="progress-line progress-line-body-weight" points="${buildPolyline(points)}"></polyline>
              ${points
                .map(
                  (point, index) => `
                    <circle
                      class="body-weight-point-hit"
                      cx="${point.x}"
                      cy="${point.y}"
                      r="18"
                      data-action="delete-body-weight"
                      data-entry-id="${entries[index].id}"
                    ></circle>
                    <circle
                      class="progress-point progress-point-body-weight"
                      cx="${point.x}"
                      cy="${point.y}"
                      r="5"
                      data-action="delete-body-weight"
                      data-entry-id="${entries[index].id}"
                    ></circle>
                    <title>${escapeHtml(
                      `${formatShortDate(entries[index].entry_date)} · ${formatBodyWeightValue(entries[index].weight)} кг`
                    )}</title>
                  `
                )
                .join("")}
            </svg>
          </div>

          <div class="progress-axis-row body-weight-axis-row">
            <span>${escapeHtml(formatShortDate(entries[0].entry_date))}</span>
            <span>${escapeHtml(formatShortDate(entries[entries.length - 1].entry_date))}</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMetricCard(title, value, subtitle = "") {
  return `
    <article class="card metric-card">
      <div class="metric-label">${escapeHtml(title)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      ${subtitle ? `<div class="metric-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    </article>
  `;
}

function renderProgressExercisePicker(progressExercises, selectedExercise, pointsCount) {
  return `
    <section class="card progress-filter-card">
      <label class="field-label" for="progress-exercise">Упражнение</label>
      <div class="select-wrap">
        <select
          id="progress-exercise"
          class="select-input"
          data-action="select-progress-exercise"
        >
          ${progressExercises
            .map(
              (exercise) => `
                <option value="${exercise.id}" ${exercise.id === selectedExercise?.id ? "selected" : ""}>
                  ${escapeHtml(exercise.name)}
                </option>
              `
            )
            .join("")}
        </select>
      </div>
      <div class="metric-subtitle">
        ${
          selectedExercise
            ? pointsCount
              ? `В выбранном диапазоне найдено ${pointsCount} тренировок с упражнением «${escapeHtml(selectedExercise.name)}».`
              : `Для упражнения «${escapeHtml(selectedExercise.name)}» в этом диапазоне пока нет тренировок.`
            : "Выбери упражнение, и покажу как по нему менялись вес и повторения."
        }
      </div>
    </section>
  `;
}

function renderExerciseProgressCard(exercise, series, summary) {
  if (!series.length || !summary) {
    return `
      <section class="card progress-panel">
        <div class="section-title">${escapeHtml(exercise.name)}</div>
        <p class="muted-note">
          В этом диапазоне нет тренировок с этим упражнением. Переключи 7D / 30D / All или выбери другое упражнение.
        </p>
      </section>
    `;
  }

  const weightValues = series.map((point) => point.bestWeight);
  const repValues = series.map((point) => point.bestReps);

  return `
    <section class="card progress-panel">
      <div class="progress-panel-head">
        <div>
          <div class="section-title">${escapeHtml(exercise.name)}</div>
          <div class="metric-subtitle">На графике: самый тяжёлый сет и сет с максимумом повторений на каждой тренировке.</div>
        </div>
        <div class="progress-legend">
          <span class="legend-item">
            <span class="legend-swatch legend-swatch-weight"></span>
            Вес
          </span>
          <span class="legend-item">
            <span class="legend-swatch legend-swatch-reps"></span>
            Повторы
          </span>
        </div>
      </div>

      <div class="progress-summary-grid">
        ${renderProgressSnapshotCard(
          "Старт",
          `${formatWeight(summary.firstPoint.bestWeight)} кг`,
          `${summary.firstPoint.bestReps} повт. • ${formatShortDate(summary.firstPoint.workoutDate)}`
        )}
        ${renderProgressSnapshotCard(
          "Сейчас",
          `${formatWeight(summary.latestPoint.bestWeight)} кг`,
          `${summary.latestPoint.bestReps} повт. • ${formatShortDate(summary.latestPoint.workoutDate)}`
        )}
        ${renderProgressSnapshotCard(
          "Изменение",
          `${formatSignedWeight(summary.weightDelta)} / ${formatSignedCount(summary.repsDelta)}`,
          "с начала выбранного периода"
        )}
      </div>

      <div class="progress-scale-row">
        <span class="scale-pill scale-pill-weight">
          Вес: ${formatWeight(Math.min(...weightValues))}-${formatWeight(Math.max(...weightValues))} кг
        </span>
        <span class="scale-pill scale-pill-reps">
          Повторы: ${Math.min(...repValues)}-${Math.max(...repValues)}
        </span>
      </div>

      ${renderExerciseProgressChart(series)}

      <div class="progress-note">
        Линии читаются каждая в своей шкале, чтобы рост веса и повторений было видно одновременно.
      </div>
    </section>
  `;
}

function renderProgressSnapshotCard(title, value, subtitle) {
  return `
    <article class="progress-mini-card">
      <div class="progress-mini-label">${escapeHtml(title)}</div>
      <div class="progress-mini-value">${escapeHtml(value)}</div>
      <div class="progress-mini-subtitle">${escapeHtml(subtitle)}</div>
    </article>
  `;
}

function renderExerciseProgressChart(series) {
  const width = 640;
  const height = 260;
  const paddingX = 24;
  const top = 18;
  const bottom = 30;
  const weightPoints = buildChartPoints(
    series.map((point) => point.bestWeight),
    width,
    height,
    paddingX,
    top,
    bottom
  );
  const repPoints = buildChartPoints(
    series.map((point) => point.bestReps),
    width,
    height,
    paddingX,
    top,
    bottom
  );

  return `
    <div class="progress-chart-wrap">
      <svg class="progress-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График прогресса">
        ${[0.2, 0.5, 0.8]
          .map((ratio) => {
            const y = top + (height - top - bottom) * ratio;
            return `<line class="progress-grid-line" x1="${paddingX}" y1="${y}" x2="${width - paddingX}" y2="${y}"></line>`;
          })
          .join("")}
        <polyline class="progress-line progress-line-weight" points="${buildPolyline(weightPoints)}"></polyline>
        <polyline class="progress-line progress-line-reps" points="${buildPolyline(repPoints)}"></polyline>
        ${weightPoints
          .map(
            (point, index) => `
              <circle class="progress-point progress-point-weight" cx="${point.x}" cy="${point.y}" r="5"></circle>
              <title>${escapeHtml(
                `${formatShortDate(series[index].workoutDate)} · Вес ${formatWeight(
                  series[index].bestWeight
                )} кг`
              )}</title>
            `
          )
          .join("")}
        ${repPoints
          .map(
            (point, index) => `
              <circle class="progress-point progress-point-reps" cx="${point.x}" cy="${point.y}" r="5"></circle>
              <title>${escapeHtml(
                `${formatShortDate(series[index].workoutDate)} · Повторы ${series[index].bestReps}`
              )}</title>
            `
          )
          .join("")}
      </svg>

      <div class="progress-axis-row">
        <span>${escapeHtml(formatShortDate(series[0].workoutDate))}</span>
        <span>${escapeHtml(formatShortDate(series[series.length - 1].workoutDate))}</span>
      </div>
    </div>
  `;
}

function buildChartPoints(values, width, height, paddingX, top, bottom) {
  return buildChartPointsWithInsets(values, width, height, paddingX, paddingX, top, bottom);
}

function buildChartPointsWithInsets(values, width, height, leftPadding, rightPadding, top, bottom) {
  const innerWidth = width - leftPadding - rightPadding;
  const innerHeight = height - top - bottom;
  const min = Math.min(...values);
  const max = Math.max(...values);

  return values.map((value, index) => {
    const x =
      values.length === 1
        ? leftPadding + innerWidth / 2
        : leftPadding + (index * innerWidth) / (values.length - 1);
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const y = top + innerHeight - ratio * innerHeight;
    return { x, y };
  });
}

function buildChartAxisMarks(min, max, width, height, leftPadding, rightPadding, top, bottom) {
  const innerHeight = height - top - bottom;
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin;
  const markValues =
    safeMax === safeMin
      ? [safeMax + 1, safeMax, Math.max(0, safeMin - 1)]
      : [safeMax, safeMin + (safeMax - safeMin) * (2 / 3), safeMin + (safeMax - safeMin) * (1 / 3), safeMin];

  return markValues.map((value) => {
    const ratio = safeMax === safeMin ? 0.5 : (value - safeMin) / (safeMax - safeMin);
    const y = top + innerHeight - ratio * innerHeight;
    return { value, y };
  });
}

function buildChartValueMarks(values, height, top, bottom) {
  const numericValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const uniqueValues = Array.from(new Set(numericValues)).sort((a, b) => b - a);
  const innerHeight = height - top - bottom;
  const safeMin = uniqueValues.length ? uniqueValues[uniqueValues.length - 1] : 0;
  const safeMax = uniqueValues.length ? uniqueValues[0] : safeMin;

  return uniqueValues.map((value) => {
    const ratio = safeMax === safeMin ? 0.5 : (value - safeMin) / (safeMax - safeMin);
    const y = top + innerHeight - ratio * innerHeight;
    return { value, y };
  });
}

function buildPolyline(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getRangeDescription(rangeKey) {
  const range = PROGRESS_RANGES.find((item) => item.key === rangeKey) || PROGRESS_RANGES[1];
  if (range.days == null) {
    return "за всю историю";
  }
  return `за последние ${range.days} дн.`;
}

function renderNewWorkoutScreen() {
  const availableExercises = getAvailableExercises();
  const nextWorkoutPlan = getNextWorkoutPlanSuggestion(getAllWorkouts());
  const shouldShowPlanSuggestion =
    !state.editingWorkoutId &&
    !hasWorkoutDraft() &&
    !state.isAddingExercise &&
    Boolean(nextWorkoutPlan);

  return `
    <section class="stack">
      ${
        shouldShowPlanSuggestion && nextWorkoutPlan
          ? renderNewWorkoutPlanSuggestionCard(nextWorkoutPlan)
          : ""
      }

      ${state.workoutExercises
        .map((exercise) =>
          renderDraftExerciseCard(exercise, {
            isSelected: exercise.exerciseId === state.selectedExerciseId,
            canUseStandard: hasValidWorkoutData(getAllWorkouts(), exercise.exerciseId),
          })
        )
        .join("")}

      ${
        availableExercises.length && !shouldShowPlanSuggestion
          ? renderExercisePicker(availableExercises)
          : ""
      }

      ${
        !availableExercises.length && state.workoutExercises.length
          ? `<p class="muted-note">Все упражнения из локальной базы уже добавлены в эту тренировку.</p>`
          : ""
      }
    </section>
  `;
}

function renderNewWorkoutPlanSuggestionCard(plan) {
  return `
    <section class="card draft-banner plan-start-banner">
      <div class="draft-banner-title">План следующей тренировки</div>
      <div class="draft-banner-text">
        Основано на тренировке от ${escapeHtml(formatLongDate(plan.generated_from_workout_date))}. 
        Текущий алгоритм просто добавляет по одному повтору к каждому сету.
      </div>
      <div class="next-plan-list next-plan-list-start">
        ${plan.data.exercises.map((exercise) => renderNextPlanExerciseRow(exercise)).join("")}
      </div>
      <div class="plan-start-actions">
        <button class="primary-button" data-action="apply-workout-plan">Заполнить по плану</button>
        <button class="text-button" data-action="start-adding-exercise">Собрать вручную</button>
      </div>
    </section>
  `;
}

function renderDraftExerciseCard(exercise, { isSelected = false, canUseStandard = false } = {}) {
  return `
    <article class="surface-card exercise-card ${isSelected ? "exercise-card-active" : ""}">
      <div class="draft-exercise-head">
        <div class="exercise-title-row">
          <div class="exercise-name">${escapeHtml(exercise.exerciseName)}</div>
        </div>
        <div class="draft-exercise-actions">
          <button
            class="draft-inline-button"
            data-action="continue-exercise"
            data-exercise-id="${exercise.exerciseId}"
          >
            + Сет
          </button>
          ${
            canUseStandard
              ? `
                <button
                  class="draft-inline-button draft-inline-button-secondary"
                  data-action="quick-standard-set"
                  data-exercise-id="${exercise.exerciseId}"
                >
                  Стандарт
                </button>
              `
              : ""
          }
          <button
            class="draft-inline-button draft-inline-button-danger"
            data-action="remove-draft-exercise"
            data-exercise-id="${exercise.exerciseId}"
          >
            Удалить упражнение
          </button>
        </div>
      </div>
      ${
        exercise.sets.length
          ? `
            <div class="set-list">
              ${exercise.sets
                .map(
                  (workoutSet, index) => `
                    <div class="set-row set-row-editable">
                      <button
                        class="set-row-main"
                        data-action="edit-draft-set"
                        data-exercise-id="${exercise.exerciseId}"
                        data-set-index="${index}"
                      >
                        <span class="set-row-index">Сет ${index + 1}</span>
                        <span>${escapeHtml(
                          `${formatWeight(workoutSet.weight)} кг × ${workoutSet.reps}`
                        )}</span>
                      </button>
                      <button
                        class="set-row-remove-button"
                        data-action="remove-draft-set"
                        data-exercise-id="${exercise.exerciseId}"
                        data-set-index="${index}"
                      >
                        Удалить
                      </button>
                    </div>
                  `
                )
                .join("")}
            </div>
          `
          : `<div class="exercise-empty">Добавь первый сет, потом можно будет чередовать это упражнение с другими.</div>`
      }
    </article>
  `;
}

function renderWorkoutMetaCard() {
  return `
    <section class="card workout-meta-card">
      <label class="field-label" for="workout-date">Дата тренировки</label>
      <input
        id="workout-date"
        class="date-input"
        type="date"
        value="${escapeHtml(state.workoutDate)}"
        data-action="change-workout-date"
      />
      <div class="metric-subtitle">${
        state.editingWorkoutId
          ? "Измени дату, если хочешь перенести эту тренировку на другой день."
          : "Новая тренировка будет сохранена именно с этой датой."
      }</div>
    </section>
  `;
}

function renderCurrentExerciseCard(exerciseName) {
  return `
    <article class="surface-card exercise-card">
      <div class="exercise-name">${escapeHtml(exerciseName)}</div>
      <div class="exercise-empty">Сетов пока нет</div>
    </article>
  `;
}

function renderExercisePicker(exercises) {
  const {
    primary: primaryExercises,
    secondary: secondaryExercises,
    primaryPoolExhausted,
  } =
    getExercisePickerGroups(exercises);
  const shouldShowMoreToggle = secondaryExercises.length > 0;
  const shouldShowSecondary = state.showAllExerciseOptions && shouldShowMoreToggle;

  return `
    <section class="card exercise-picker">
      ${
        primaryExercises.length
          ? `
            <div class="exercise-picker-group">
              ${renderExerciseTileGrid(primaryExercises)}
            </div>
          `
          : primaryPoolExhausted
            ? `
              <div class="exercise-picker-complete">
                <div class="exercise-picker-complete-title">Круто, тренировка закончена</div>
                <div class="exercise-picker-complete-text">
                  Основная плитка уже закончилась, но ниже можно раскрыть остальные упражнения.
                </div>
              </div>
            `
          : exercises.length
            ? renderExerciseTileGrid(exercises)
            : `<p class="muted-note">В локальной базе не осталось свободных упражнений.</p>`
      }
      ${
        shouldShowMoreToggle
          ? `
            <div class="exercise-picker-more">
              <button class="text-button exercise-picker-more-toggle" data-action="toggle-more-exercises">
                ${state.showAllExerciseOptions ? "Скрыть редкие упражнения" : `Ещё упражнения (${secondaryExercises.length})`}
              </button>
            </div>
          `
          : ""
      }
      ${
        shouldShowSecondary
          ? `
            <div class="exercise-picker-group exercise-picker-group-secondary">
              ${renderExerciseTileGrid(secondaryExercises, { secondary: true })}
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderExerciseTileGrid(exercises, { secondary = false } = {}) {
  if (!Array.isArray(exercises) || !exercises.length) {
    return "";
  }

  return `
    <div class="exercise-tile-grid ${secondary ? "exercise-tile-grid-secondary" : ""}">
      ${exercises.map((exercise) => renderExerciseTile(exercise, { secondary })).join("")}
    </div>
  `;
}

function renderExerciseTile(exercise, { secondary = false } = {}) {
  return `
    <button
      class="exercise-tile ${secondary ? "exercise-tile-secondary" : ""}"
      data-action="select-exercise"
      data-exercise-id="${exercise.id}"
      aria-label="${escapeHtml(exercise.name)}"
    >
      <span class="exercise-tile-icon-slot" aria-hidden="true">
        ${exerciseIconMarkup(exercise.name)}
      </span>
      <span class="exercise-tile-label">${escapeHtml(exercise.name)}</span>
    </button>
  `;
}

function renderSetModal() {
  const isEditingExistingSet = Boolean(
    state.activeSetEditor && Number.isInteger(state.activeSetEditor.setIndex)
  );
  return `
    <div class="modal-overlay">
      <section class="modal-card">
        <div class="stack">
          <div class="modal-heading">${isEditingExistingSet ? "Редактировать сет" : "Новый сет"}</div>
          <div>
            <div class="modal-section-title">Вес</div>
            <div class="value-stepper">
              <button class="stepper-button" data-action="set-weight-dec">-</button>
              <div class="value-display">${escapeHtml(formatWeight(state.currentSetWeight))} кг</div>
              <button class="stepper-button" data-action="set-weight-inc">+</button>
            </div>
          </div>

          <div>
            <div class="modal-section-title">Количество повторений</div>
            <div class="value-stepper">
              <button class="stepper-button" data-action="set-reps-dec">-</button>
              <div class="value-display">${state.currentSetReps}</div>
              <button class="stepper-button" data-action="set-reps-inc">+</button>
            </div>
          </div>

          <div class="modal-actions">
            <button class="secondary-button" data-action="set-cancel">Отмена</button>
            <button class="primary-button" data-action="set-apply">Применить</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderBottomNav() {
  const items = [
    { key: "trainings", label: "Trainings", icon: "trainings" },
    { key: "progress", label: "Progress", icon: "progress" },
    { key: "body", label: "Weight", icon: "body-weight" },
  ];

  return `
    <div class="bottom-nav-wrap">
      <nav class="bottom-nav">
        ${items
          .map(
            (item) => `
              <button
                class="nav-button ${state.currentTab === item.key ? "active" : ""}"
                data-action="switch-tab"
                data-tab="${item.key}"
              >
                ${iconMarkup(item.icon)}
                <span class="nav-label">${item.label}</span>
              </button>
            `
          )
          .join("")}
      </nav>
    </div>
  `;
}

function renderFloatingActionButton() {
  if (state.currentTab === "trainings") {
    return `
      <button class="floating-action-button" data-action="open-new-workout" aria-label="Новая тренировка">
        ${iconMarkup("new")}
      </button>
    `;
  }

  if (state.currentTab === "new") {
    const actions = [];

    if (hasWorkoutDraft()) {
      actions.push(`
        <button
          class="floating-action-button floating-action-button-secondary floating-action-button-danger"
          data-action="reset-workout-draft"
          aria-label="${state.editingWorkoutId ? "Отменить редактирование" : "Сбросить черновик"}"
        >
          ${iconMarkup("reset")}
        </button>
      `);
    }

    if (state.workoutExercises.length > 0) {
      actions.push(`
        <button
          class="floating-action-button floating-action-button-save"
          data-action="finish-workout"
          aria-label="${state.isSavingWorkout ? "Сохраняю тренировку" : "Сохранить тренировку"}"
          ${state.isSavingWorkout ? "disabled" : ""}
        >
          ${iconMarkup("save")}
        </button>
      `);
    }

    return actions.join("");
  }

  return "";
}

function renderLoadBadge(loadType) {
  const normalized = String(loadType).toLowerCase();
  const badgeClass =
    normalized === "heavy"
      ? "load-heavy"
      : normalized === "light"
        ? "load-light"
        : "load-medium";
  return `<span class="load-badge ${badgeClass}">${escapeHtml(normalized.toUpperCase())}</span>`;
}

function renderEmptyState(title) {
  return `
    <div class="empty-state">
      <div class="stack" style="justify-items:center;">
        <h2 class="topbar-title">${escapeHtml(title)}</h2>
        <p class="muted-note">Когда ты добавишь первую тренировку, она сохранится на сервере и появится здесь.</p>
      </div>
    </div>
  `;
}

function buildTopbarPills() {
  const pills = [];

  if (state.currentUser?.is_default_debug_user) {
    pills.push('<span class="pill pill-build">WEB</span>');
  } else if (state.currentUser?.auth_source === "telegram") {
    pills.push('<span class="pill pill-build">TG</span>');
  } else if (state.currentUser?.auth_source === "telegram_unsafe") {
    pills.push('<span class="pill pill-build">TG</span>');
  } else if (state.currentUser?.auth_source === "telegram_recovery") {
    pills.push('<span class="pill pill-build">TG</span>');
  }

  if (Number.isFinite(state.currentUser?.id)) {
    pills.push(`<span class="pill pill-user-id">UID ${escapeHtml(String(state.currentUser.id))}</span>`);
  }

  return pills.join("");
}

function showFlash(message) {
  state.flashMessage = message;
  clearTimeout(flashTimeoutId);
  flashTimeoutId = window.setTimeout(() => {
    state.flashMessage = "";
    render();
  }, 2200);
  render();
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parseIsoDate(value));
}

function formatWeekday(value) {
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
  }).format(parseIsoDate(value));
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(parseIsoDate(value));
}

function formatTopbarWorkoutDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(parseIsoDate(value))
    .replace(/\s?г\.$/, "");
}

function formatWeight(value) {
  const formatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
  return formatter.format(value);
}

function formatBodyWeightValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }
  return numericValue.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
    useGrouping: false,
  });
}

function formatBodyWeightInput(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }
  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
}

function normalizeBodyWeightInput(value) {
  const raw = String(value || "").replace(/[^\d.,]/g, "").replace(/,/g, ".");
  if (!raw) {
    return "";
  }

  const firstDotIndex = raw.indexOf(".");
  if (firstDotIndex === -1) {
    return raw;
  }

  const integerPart = raw.slice(0, firstDotIndex);
  const fractionPart = raw.slice(firstDotIndex + 1).replace(/\./g, "");
  if (!fractionPart && raw.endsWith(".")) {
    return `${integerPart || "0"}.`;
  }

  return `${integerPart || "0"}.${fractionPart}`;
}

function formatSignedWeight(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatWeight(value)} кг`;
}

function formatSignedBodyWeight(value) {
  if (!Number.isFinite(Number(value))) {
    return "—";
  }
  const numericValue = Number(value);
  const prefix = numericValue > 0 ? "+" : "";
  return `${prefix}${formatWeight(numericValue)} кг`;
}

function formatSignedCount(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value} повт.`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readTextStorage(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_error) {
    return fallback;
  }
}

function readNumberStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") {
      return fallback;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeTextStorage(key, value) {
  localStorage.setItem(key, value);
}

function iconMarkup(name) {
  if (name === "trainings") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
        <path d="M6 7h12"></path>
        <path d="M6 12h12"></path>
        <path d="M6 17h8"></path>
      </svg>
    `;
  }

  if (name === "progress") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 18V9"></path>
        <path d="M12 18V5"></path>
        <path d="M19 18v-6"></path>
      </svg>
    `;
  }

  if (name === "body-weight") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9A2.5 2.5 0 0 1 6.5 5z"></path>
        <path d="M9 9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 3 1.5"></path>
        <path d="M12 8v4"></path>
        <path d="M8.5 14.5h7"></path>
      </svg>
    `;
  }

  if (name === "refresh") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 11a8 8 0 1 0 2 5.4"></path>
        <path d="M20 4v7h-7"></path>
      </svg>
    `;
  }

  if (name === "save") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 12.5l4 4l8-9"></path>
      </svg>
    `;
  }

  if (name === "reset") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 7l10 10"></path>
        <path d="M17 7L7 17"></path>
      </svg>
    `;
  }

  return `
    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </svg>
  `;
}

function exerciseIconMarkup(exerciseName) {
  const name = String(exerciseName || "").toLowerCase();
  let icon = "generic";

  if (name.includes("жим ног")) {
    icon = "leg-press";
  } else if (name.includes("разгибания ног")) {
    icon = "leg-extension";
  } else if (name.includes("сгибания ног")) {
    icon = "leg-curl";
  } else if (name.includes("жим гор")) {
    icon = "bench-press";
  } else if (name.includes("жим в тренаж")) {
    icon = "chest-press";
  } else if (name.includes("тяга верт") || name.includes("подтяг")) {
    icon = "vertical-pull";
  } else if (name.includes("тяга горизонт")) {
    icon = "row";
  } else if (name.includes("дельт")) {
    icon = "shoulders";
  } else if (name.includes("бицеп")) {
    icon = "biceps";
  } else if (name.includes("трицеп")) {
    icon = "triceps";
  } else if (name.includes("бабоч")) {
    icon = "fly";
  }

  // Icons sourced from the Huge Icons collection via the official Iconify API (MIT).
  if (icon === "leg-press") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M5.002 2c2.691.314 8.897 1.896 11.64 5.746c.337.47.69.804 1.27.95c.724.18 1.324.666 1.542 1.4c.232.798.66 1.64.524 2.494c-.052.327-.212.628-.532 1.23L15.099 22"></path>
          <path d="M4.002 12c1 1.726 4.164 2.596 8 1.726a10.1 10.1 0 0 0-2.685 2.225c-.559.646-.797 1.544-.836 2.452c-.052 1.212-.232 2.53-.854 3.597"></path>
          <path d="M5.002 7s1.959.29 3.5 1.5c1 .786 2.916 1.31 3.5 1.5"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "leg-extension") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M5.002 2c2.691.314 8.897 1.896 11.64 5.746c.337.47.69.804 1.27.95c.724.18 1.324.666 1.542 1.4c.232.798.66 1.64.524 2.494c-.052.327-.212.628-.532 1.23L15.099 22"></path>
          <path d="M4.002 12c1 1.726 4.164 2.596 8 1.726a10.1 10.1 0 0 0-2.685 2.225c-.559.646-.797 1.544-.836 2.452c-.052 1.212-.232 2.53-.854 3.597"></path>
          <path d="M5.002 7s1.959.29 3.5 1.5c1 .786 2.916 1.31 3.5 1.5"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "leg-curl") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M5.002 2c2.691.314 8.897 1.896 11.64 5.746c.337.47.69.804 1.27.95c.724.18 1.324.666 1.542 1.4c.232.798.66 1.64.524 2.494c-.052.327-.212.628-.532 1.23L15.099 22"></path>
          <path d="M4.002 12c1 1.726 4.164 2.596 8 1.726a10.1 10.1 0 0 0-2.685 2.225c-.559.646-.797 1.544-.836 2.452c-.052 1.212-.232 2.53-.854 3.597"></path>
          <path d="M5.002 7s1.959.29 3.5 1.5c1 .786 2.916 1.31 3.5 1.5"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "chest-press") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M13.91 8.368c.302.233.364.621.49 1.398l.457 2.849c.163 1.008.244 1.512-.076 1.84c-.756.774-4.9.678-5.562 0c-.32-.328-.239-.832-.077-1.84L9.6 9.766c.125-.777.188-1.165.49-1.398c.62-.478 3.167-.503 3.82 0"></path>
          <path d="M7.5 19c.042-.127.063-.19.086-.246a2 2 0 0 1 1.735-1.25c.06-.004.127-.004.26-.004h4.838c.133 0 .2 0 .26.004a2 2 0 0 1 1.735 1.25c.023.056.044.12.086.246"></path>
          <path d="M12 17.5V22m0 0h7m-7 0H5"></path>
          <path d="M21 14v-3.597c0-.695 0-1.042-.113-1.363c-.113-.322-.33-.593-.764-1.136l-1.922-2.403c-.59-.737-.885-1.106-1.296-1.304C16.495 4 16.022 4 15.077 4H8.923c-.944 0-1.416 0-1.827.197c-.41.198-.706.567-1.296 1.304L3.877 7.904c-.434.543-.652.814-.764 1.136C3 9.36 3 9.708 3 10.403V14"></path>
          <path d="M3 12h3m15 0h-3m-6-4V2"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "bench-press") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <path d="M18 3v5M6 3v5m14.5-4v1.5m0 0V7m0-1.5H22M3.5 4v1.5m0 0V7m0-1.5H2m16 0H6m4 0V10m4-4.5V10m4.952 6H5.062m9.194-6h-4.05c-1.007 0-1.38.144-1.934.992l-3.013 4.612c-.186.284-.259.51-.259.854C5 18.611 5.873 19 7.847 19h8.25C18.133 19 19 18.616 19 16.408c0-.306-.057-.51-.204-.773l-2.537-4.53c-.534-.953-.918-1.105-2.003-1.105M16 19v2m-8-2v2"></path>
      </svg>
    `;
  }

  if (icon === "vertical-pull") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M15.5 10A1.5 1.5 0 0 1 14 8.5M8.5 10A1.5 1.5 0 0 0 10 8.5M14 2v.643c0 .587 0 .88.065 1.13a2 2 0 0 0 1.16 1.336c.237.1.527.141 1.108.224c1.162.166 1.743.25 2.218.45a4 4 0 0 1 2.318 2.672C21 8.954 21 9.54 21 10.714V22M10 2v.643c0 .587 0 .88-.065 1.13a2 2 0 0 1-1.16 1.336c-.237.1-.527.141-1.108.224c-1.162.166-1.743.25-2.218.45A4 4 0 0 0 3.13 8.454C3 8.954 3 9.54 3 10.714V22m9-9v9"></path>
          <path d="M18 11.5s-.545 2.864-.497 5.727C17.535 19.127 18 22 18 22M6 11.5s.545 2.864.497 5.727C6.465 19.127 6 22 6 22"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "row") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M15.5 10A1.5 1.5 0 0 1 14 8.5M8.5 10A1.5 1.5 0 0 0 10 8.5M14 2v.643c0 .587 0 .88.065 1.13a2 2 0 0 0 1.16 1.336c.237.1.527.141 1.108.224c1.162.166 1.743.25 2.218.45a4 4 0 0 1 2.318 2.672C21 8.954 21 9.54 21 10.714V22M10 2v.643c0 .587 0 .88-.065 1.13a2 2 0 0 1-1.16 1.336c-.237.1-.527.141-1.108.224c-1.162.166-1.743.25-2.218.45A4 4 0 0 0 3.13 8.454C3 8.954 3 9.54 3 10.714V22m9-9v9"></path>
          <path d="M18 11.5s-.545 2.864-.497 5.727C17.535 19.127 18 22 18 22M6 11.5s.545 2.864.497 5.727C6.465 19.127 6 22 6 22"></path>
        </g>
      </svg>
    `;
  }

  if (icon === "shoulders") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <path d="m17 7l2 .5m-11 10s-3-1.5-3-5s2.5-5 7-6.5c3-1 5-2 5-4M6 16s-.5 1.385-.5 3.23C5.5 20.616 6 22 6 22m6-7l.813 1.219A4 4 0 0 0 16.14 18H19m-1-3v.01m-5 1.49V22"></path>
      </svg>
    `;
  }

  if (icon === "biceps") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <path d="M2.018 20.305c1.129 1.615 6.041 2.882 8.362-.14c2.51 1.2 6.649.828 10.02-1.052c.468-.26.911-.59 1.183-1.054c.613-1.045.627-2.495-.491-4.634c-1.865-4.654-5.218-8.74-6.572-10.383c-.278-.253-2.051-.613-3.133-.96c-.478-.147-1.367-.245-2.43 1.157c-.505.664-2.796 2.297.11 3.394c.451.115.782.326 2.837-.049c.267-.046.935 0 1.406.826l.984 1.407a.96.96 0 0 1 .169.44c.172 1.499.166 3.375 1.002 4.326c-1.29-.934-4.664-2.042-7.206 1.112M2.002 12.94a6.714 6.714 0 0 1 8.416-.418"></path>
      </svg>
    `;
  }

  if (icon === "triceps") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <path d="M2.018 20.305c1.129 1.615 6.041 2.882 8.362-.14c2.51 1.2 6.649.828 10.02-1.052c.468-.26.911-.59 1.183-1.054c.613-1.045.627-2.495-.491-4.634c-1.865-4.654-5.218-8.74-6.572-10.383c-.278-.253-2.051-.613-3.133-.96c-.478-.147-1.367-.245-2.43 1.157c-.505.664-2.796 2.297.11 3.394c.451.115.782.326 2.837-.049c.267-.046.935 0 1.406.826l.984 1.407a.96.96 0 0 1 .169.44c.172 1.499.166 3.375 1.002 4.326c-1.29-.934-4.664-2.042-7.206 1.112M2.002 12.94a6.714 6.714 0 0 1 8.416-.418"></path>
      </svg>
    `;
  }

  if (icon === "fly") {
    return `
      <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
        <g>
          <path d="M3 3v18M21 3v18m1-15H2"></path>
          <path d="M15.5 10c1.105 0 2 .97 2 2.165c0 .283-.05.554-.142.802c-.294.798-3.489.617-3.716 0a2.3 2.3 0 0 1-.142-.802c0-1.196.895-2.165 2-2.165Zm-7 0c1.105 0 2 .97 2 2.165c0 .283-.05.554-.142.802c-.294.798-3.489.617-3.716 0a2.3 2.3 0 0 1-.142-.802c0-1.196.895-2.165 2-2.165Z"></path>
          <path d="M8.5 10V6m7 4V6"></path>
        </g>
      </svg>
    `;
  }

  return `
    <svg class="exercise-tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">
      <g>
        <path d="M10.529 8h2.942c.56 0 1.147.002 1.397.617c.176.433.176 1.333 0 1.766c-.25.615-.837.617-1.397.617H10.53c-.56 0-1.147-.002-1.397-.617c-.176-.433-.176-1.333 0-1.766C9.383 8.002 9.97 8 10.53 8"></path>
        <path d="m10.529 11h2.942c.56 0 1.147.002 1.397.617c.176.433.176 1.333 0 1.766c-.25.615-.837.617-1.397.617H10.53c-.56 0-1.147-.002-1.397-.617c-.176-.433-.176-1.333 0-1.766c.25-.615.837-.617 1.397-.617"></path>
        <path d="M7.5 19c.042-.127.063-.19.086-.246a2 2 0 0 1 1.735-1.25c.06-.004.127-.004.26-.004h4.838c.133 0 .2 0 .26.004a2 2 0 0 1 1.735 1.25c.023.056.044.12.086.246"></path>
        <path d="M12 17.5V22m0 0h7m-7 0H5"></path>
        <path d="m21 8.5l-1.204-1.405c-.884-1.03-1.325-1.546-1.922-1.82C17.277 5 16.598 5 15.24 5H8.76c-1.358 0-2.037 0-2.634.274c-.597.275-1.038.79-1.922 1.821L3 8.5m9-.5V2"></path>
      </g>
    </svg>
  `;
}
