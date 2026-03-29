const tg = window.Telegram?.WebApp ?? null;
const root = document.getElementById("app");

const STORAGE_KEYS = {
  customWorkouts: "trainer-miniapp-custom-workouts-v1",
  draft: "trainer-miniapp-draft-v1",
  tab: "trainer-miniapp-tab-v1",
  range: "trainer-miniapp-range-v1",
  progressExercise: "trainer-miniapp-progress-exercise-v1",
};

const PROGRESS_RANGES = [
  { key: "DAYS_7", label: "7D", days: 7 },
  { key: "DAYS_30", label: "30D", days: 30 },
  { key: "ALL", label: "All", days: null },
];
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
    new: 0,
  },
  pendingScrollRestoreTop: null,
  openWorkoutSwipeId: null,
  selectedRange: readTextStorage(STORAGE_KEYS.range, "DAYS_30"),
  selectedProgressExerciseId: readNumberStorage(STORAGE_KEYS.progressExercise, null),
  currentUser: null,
  exercises: [],
  workoutDate: getLocalTodayIso(),
  customWorkouts: sortWorkouts(readJsonStorage(STORAGE_KEYS.customWorkouts, [])),
  selectedExerciseId: null,
  workoutExercises: [],
  editingWorkoutId: null,
  editingWorkoutClientId: null,
  activeSetEditor: null,
  isAddingExercise: false,
  isAddingSet: false,
  isSavingWorkout: false,
  currentSetReps: 12,
  currentSetWeight: 0,
  flashMessage: "",
};

let flashTimeoutId = null;
let devVersion = null;
let hasOpenNewHistoryEntry = false;
let workoutSwipeGesture = null;
let swipeClickGuard = null;

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
    const [exercisesResponse, workoutsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/api/workouts"),
    ]);

    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.currentUser = workoutsResponse.user || state.currentUser;
    ensureSelectedProgressExercise();
    ensureDraftExerciseStillExists();
    ensureNewWorkoutFlow();
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
    case "refresh-progress":
      refreshLocalData();
      break;
    case "reset-workout-draft":
      {
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
      break;
    case "edit-workout":
      startEditingWorkout(Number(actionTarget.dataset.workoutId));
      break;
    case "delete-workout":
      deleteWorkout(Number(actionTarget.dataset.workoutId));
      break;
    case "continue-exercise":
      selectExercise(Number(actionTarget.dataset.exerciseId));
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
    case "start-adding-exercise":
      state.isAddingExercise = true;
      render();
      break;
    case "cancel-adding-exercise":
      state.isAddingExercise = false;
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
  writeTextStorage(STORAGE_KEYS.tab, tab);
  ensureNewWorkoutFlow();
  queueScrollRestore(tab);
  syncBrowserHistory("replace");
  render();
}

function normalizeNavTab(tab) {
  return tab === "progress" ? "progress" : "trainings";
}

function normalizeScrollTab(tab) {
  return tab === "progress" || tab === "new" ? tab : "trainings";
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
    const [exercisesResponse, workoutsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/api/workouts"),
    ]);
    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.currentUser = workoutsResponse.user || state.currentUser;
    ensureSelectedProgressExercise();
    ensureEditingWorkoutStillExists();
    state.booting = false;
    state.loadError = null;
    ensureDraftExerciseStillExists();
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
}

function persistDraft() {
  if (!state.selectedExerciseId && state.workoutExercises.length === 0) {
    localStorage.removeItem(STORAGE_KEYS.draft);
    return;
  }

  writeJsonStorage(STORAGE_KEYS.draft, {
    selectedExerciseId: state.selectedExerciseId,
    workoutExercises: state.workoutExercises,
    workoutDate: state.workoutDate,
    editingWorkoutId: state.editingWorkoutId,
    editingWorkoutClientId: state.editingWorkoutClientId,
  });
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
  }
}

function ensureNewWorkoutFlow() {
  if (!state.exercises.length) {
    return;
  }

  if (state.workoutExercises.length === 0 && !state.selectedExerciseId) {
    state.isAddingExercise = true;
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

function countDraftExercises() {
  const selectedExercise = getSelectedExercise();
  const selectedExistsInDraft =
    selectedExercise &&
    state.workoutExercises.some((exercise) => exercise.exerciseId === selectedExercise.id);

  return state.workoutExercises.length + (selectedExercise && !selectedExistsInDraft ? 1 : 0);
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

function getSelectedExercise() {
  return state.exercises.find((exercise) => exercise.id === state.selectedExerciseId) || null;
}

function getCurrentWorkoutExercise() {
  return state.workoutExercises.find(
    (exercise) => exercise.exerciseId === state.selectedExerciseId
  ) || null;
}

function getAvailableExercises() {
  const addedIds = new Set(state.workoutExercises.map((exercise) => exercise.exerciseId));
  return state.exercises.filter((exercise) => !addedIds.has(exercise.id));
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

function selectExercise(exerciseId) {
  state.selectedExerciseId = exerciseId;
  state.isAddingExercise = false;
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
  state.editingWorkoutId = workout.id;
  state.editingWorkoutClientId =
    typeof workout.client_id === "string" && workout.client_id.trim()
      ? workout.client_id.trim()
      : `workout-${workout.id}`;
  state.activeSetEditor = null;
  state.isAddingSet = false;
  state.isSavingWorkout = false;
  state.isAddingExercise = false;
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

  state.currentSetReps = 12;
  state.currentSetWeight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
  state.activeSetEditor = {
    exerciseId: selectedExercise.id,
    setIndex: null,
  };
  state.isAddingSet = true;
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

  const weight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
  addSetToCurrentExercise({
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
  } else {
    addSetToCurrentExercise(nextSet);
  }
  state.activeSetEditor = null;
  state.isAddingSet = false;
  render();
}

function addSetToCurrentExercise(setData) {
  const selectedExercise = getSelectedExercise();
  if (!selectedExercise) {
    return;
  }

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

  state.selectedExerciseId = exerciseId;
  state.isAddingExercise = false;
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
    state.selectedExerciseId = null;
  }
  if (!state.workoutExercises.length && !state.selectedExerciseId) {
    state.isAddingExercise = state.exercises.length > 0;
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
    state.selectedExerciseId = null;
  }
  if (!state.workoutExercises.length && !state.selectedExerciseId) {
    state.isAddingExercise = state.exercises.length > 0;
  }
  state.activeSetEditor = null;
  state.isAddingSet = false;
  persistDraft();
  render();
}

function finishExercise() {
  state.isAddingSet = false;
  state.isAddingExercise = true;
  persistDraft();
  render();
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
  state.selectedExerciseId = null;
  state.workoutExercises = [];
  state.editingWorkoutId = null;
  state.editingWorkoutClientId = null;
  state.newFlowOriginTab = "trainings";
  hasOpenNewHistoryEntry = false;
  state.openWorkoutSwipeId = null;
  state.activeSetEditor = null;
  state.isAddingExercise = state.exercises.length > 0;
  state.isAddingSet = false;
  state.currentSetReps = 12;
  state.currentSetWeight = 0;
  localStorage.removeItem(STORAGE_KEYS.draft);
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
  const nav = renderBottomNav();
  const fab = renderFloatingActionButton();
  const modal = state.isAddingSet ? renderSetModal() : "";
  const toast = state.flashMessage ? `<div class="toast">${escapeHtml(state.flashMessage)}</div>` : "";

  root.innerHTML = `
    <div class="layout">
      ${topbar}
      <main class="screen">
        ${screen}
      </main>
      ${fab}
      ${toast}
      ${nav}
      ${modal}
    </div>
  `;
  updateTelegramBackButton();
  flushPendingScrollRestore();
}

function renderTopbar() {
  const titles = {
    trainings: "Trainings",
    progress: "Progress",
    new: state.editingWorkoutId ? "Редактирование" : "Новая тренировка",
  };

  const buildPills = buildTopbarPills();
  let actionMarkup = "";
  if (state.currentTab === "progress") {
    actionMarkup = `
      <button class="secondary-button topbar-utility-button" data-action="refresh-progress">
        Обновить
      </button>
    `;
  }

  if (state.currentTab === "new") {
    actionMarkup = `
      <div class="topbar-action-group">
        <button class="secondary-button topbar-utility-button" data-action="close-new-workout">
          Назад
        </button>
        ${
          state.workoutExercises.length > 0
            ? `<button class="action-button topbar-primary-action" data-action="finish-workout" ${
                state.isSavingWorkout ? "disabled" : ""
              }>${state.isSavingWorkout ? "Сохраняю..." : "Сохранить"}</button>`
            : ""
        }
      </div>
    `;
  }

  return `
    <header class="topbar topbar-compact">
      <h1 class="sr-only topbar-title">${escapeHtml(titles[state.currentTab])}</h1>
      <div class="topbar-row topbar-row-compact">
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
    case "new":
    default:
      return renderNewWorkoutScreen();
  }
}

function renderTrainingsScreen() {
  const workouts = getAllWorkouts();
  if (!workouts.length) {
    return renderEmptyState("Пока нет тренировок");
  }

  return `
    <section class="stack">
      ${workouts.map((workout) => renderWorkoutCard(workout)).join("")}
      <a class="debug-link" href="/stub.html">Открыть старую debug-заглушку</a>
    </section>
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
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - top - bottom;
  const min = Math.min(...values);
  const max = Math.max(...values);

  return values.map((value, index) => {
    const x =
      values.length === 1 ? width / 2 : paddingX + (index * innerWidth) / (values.length - 1);
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    const y = top + innerHeight - ratio * innerHeight;
    return { x, y };
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
  const selectedExercise = getSelectedExercise();
  const currentExercise = getCurrentWorkoutExercise();
  const availableExercises = getAvailableExercises();
  const allWorkouts = getAllWorkouts();
  const draftExercisesCount = countDraftExercises();
  const canUseStandard =
    selectedExercise && hasValidWorkoutData(allWorkouts, selectedExercise.id);

  return `
    <section class="stack">
      ${renderWorkoutMetaCard()}

      ${
        hasWorkoutDraft()
          ? renderDraftResumeCard(draftExercisesCount, state.exercises.length)
          : ""
      }

      ${state.workoutExercises.map((exercise) => renderDraftExerciseCard(exercise)).join("")}

      ${
        selectedExercise && !currentExercise
          ? renderCurrentExerciseCard(selectedExercise.name)
          : ""
      }

      ${
        !selectedExercise &&
        state.workoutExercises.length > 0 &&
        !state.isAddingExercise &&
        availableExercises.length
          ? `<button class="primary-button" data-action="start-adding-exercise">Добавить упражнение</button>`
          : ""
      }

      ${
        state.isAddingExercise
          ? renderExercisePicker(availableExercises)
          : ""
      }

      ${
        selectedExercise && !state.isAddingSet && !state.isAddingExercise
          ? `
            <div class="button-row">
              <button class="secondary-button" data-action="start-adding-set">Добавить сет</button>
              ${
                canUseStandard
                  ? `<button class="primary-button" data-action="add-standard-set">Стандарт</button>`
                  : ""
              }
            </div>
          `
          : ""
      }

      ${
        currentExercise && currentExercise.sets.length
          ? `
            <div class="center-text">
              <button class="text-button" data-action="finish-exercise">Новое упражнение</button>
            </div>
          `
          : ""
      }

      ${
        !availableExercises.length && !selectedExercise && state.workoutExercises.length
          ? `<p class="muted-note">Все упражнения из локальной базы уже добавлены в эту тренировку.</p>`
          : ""
      }
    </section>
  `;
}

function renderDraftResumeCard(draftExercisesCount, totalExercisesCount) {
  const remainingExercisesCount = Math.max(0, totalExercisesCount - draftExercisesCount);
  return `
    <section class="card draft-banner">
      <div class="draft-banner-title">${
        state.editingWorkoutId ? "Редактирование тренировки" : "Восстановлен черновик тренировки"
      }</div>
      <div class="draft-banner-text">
        ${
          state.editingWorkoutId
            ? `Открыта тренировка от ${formatLongDate(state.workoutDate)}. Сейчас в ней ${draftExercisesCount} упражнений, добавить можно ещё ${remainingExercisesCount}.`
            : `Уже добавлено ${draftExercisesCount} из ${totalExercisesCount} упражнений. Доступно для выбора ещё ${remainingExercisesCount}.`
        }
      </div>
      <div class="draft-banner-actions">
        <button class="secondary-button" data-action="reset-workout-draft">${
          state.editingWorkoutId ? "Отменить редактирование" : "Начать заново"
        }</button>
      </div>
    </section>
  `;
}

function renderDraftExerciseCard(exercise) {
  return `
    <article class="surface-card exercise-card">
      <div class="draft-exercise-head">
        <div class="exercise-name">${escapeHtml(exercise.exerciseName)}</div>
        <div class="draft-exercise-actions">
          <button
            class="draft-inline-button"
            data-action="continue-exercise"
            data-exercise-id="${exercise.exerciseId}"
          >
            + Сет
          </button>
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
          : `<div class="exercise-empty">Сетов пока нет</div>`
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
  return `
    <section class="card exercise-picker">
      <div class="exercise-picker-title">Выберите упражнение</div>
      ${
        state.workoutExercises.length
          ? `<p class="muted-note">В этом черновике уже есть ${state.workoutExercises.length} упражнений, поэтому список ниже показывает только оставшиеся.</p>`
          : ""
      }
      ${
        exercises.length
          ? exercises
              .map(
                (exercise) => `
                  <button
                    class="exercise-option"
                    data-action="select-exercise"
                    data-exercise-id="${exercise.id}"
                  >
                    ${escapeHtml(exercise.name)}
                  </button>
                `
              )
              .join("")
          : `<p class="muted-note">В локальной базе не осталось свободных упражнений.</p>`
      }
      ${
        state.workoutExercises.length || state.selectedExerciseId
          ? `
            <div class="picker-footer">
              <button class="text-button" data-action="reset-workout-draft">Начать заново</button>
              <button class="text-button" data-action="cancel-adding-exercise">Отмена</button>
            </div>
          `
          : ""
      }
    </section>
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
  if (state.currentTab !== "trainings") {
    return "";
  }

  return `
    <button class="floating-action-button" data-action="open-new-workout" aria-label="Новая тренировка">
      ${iconMarkup("new")}
    </button>
  `;
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
    pills.push('<span class="pill pill-build">Browser debug</span>');
  } else if (state.currentUser?.auth_source === "telegram") {
    pills.push('<span class="pill pill-build">Telegram</span>');
  } else if (state.currentUser?.auth_source === "telegram_unsafe") {
    pills.push('<span class="pill pill-build">TG fallback</span>');
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

function formatWeight(value) {
  const formatter = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
  return formatter.format(value);
}

function formatSignedWeight(value) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatWeight(value)} кг`;
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

  if (name === "refresh") {
    return `
      <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 11a8 8 0 1 0 2 5.4"></path>
        <path d="M20 4v7h-7"></path>
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
