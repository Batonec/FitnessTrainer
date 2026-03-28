const tg = window.Telegram?.WebApp ?? null;
const root = document.getElementById("app");

const STORAGE_KEYS = {
  customWorkouts: "trainer-miniapp-custom-workouts-v1",
  draft: "trainer-miniapp-draft-v1",
  tab: "trainer-miniapp-tab-v1",
  range: "trainer-miniapp-range-v1",
};

const PROGRESS_RANGES = [
  { key: "DAYS_7", label: "7D", days: 7 },
  { key: "DAYS_30", label: "30D", days: 30 },
  { key: "ALL", label: "All", days: null },
];
const TELEGRAM_INITDATA_WAIT_MS = 1800;
const TELEGRAM_INITDATA_POLL_MS = 120;

const state = {
  booting: true,
  loadError: null,
  currentTab: readTextStorage(STORAGE_KEYS.tab, "new"),
  selectedRange: readTextStorage(STORAGE_KEYS.range, "DAYS_30"),
  currentUser: null,
  exercises: [],
  fixtureWorkouts: [],
  customWorkouts: sortWorkouts(readJsonStorage(STORAGE_KEYS.customWorkouts, [])),
  selectedExerciseId: null,
  workoutExercises: [],
  isAddingExercise: false,
  isAddingSet: false,
  isSavingWorkout: false,
  currentSetReps: 12,
  currentSetWeight: 0,
  flashMessage: "",
};

let flashTimeoutId = null;
let devVersion = null;

root.addEventListener("click", handleClick);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.isAddingSet) {
    cancelAddingSet();
  }
});

bootstrap();

async function bootstrap() {
  setupTelegramShell();
  hydrateDraft();
  startLiveReload();
  render();

  try {
    await resolveSession();
    await migrateLegacyCustomWorkouts();
    const [exercisesResponse, fixtureWorkoutsResponse, workoutsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/data/workouts.json"),
      fetchJson("/api/workouts"),
    ]);

    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.fixtureWorkouts = sortWorkouts(
      Array.isArray(fixtureWorkoutsResponse.workouts) ? fixtureWorkoutsResponse.workouts : []
    );
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.currentUser = workoutsResponse.user || state.currentUser;
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
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
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
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;
  switch (action) {
    case "switch-tab":
      setCurrentTab(actionTarget.dataset.tab);
      break;
    case "select-range":
      selectRange(actionTarget.dataset.range);
      break;
    case "refresh-progress":
      refreshLocalData();
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

function setCurrentTab(tab) {
  if (!tab || state.currentTab === tab) {
    return;
  }

  state.currentTab = tab;
  writeTextStorage(STORAGE_KEYS.tab, tab);
  ensureNewWorkoutFlow();
  render();
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
    const [exercisesResponse, fixtureWorkoutsResponse, workoutsResponse] = await Promise.all([
      fetchJson("/data/exercises.json"),
      fetchJson("/data/workouts.json"),
      fetchJson("/api/workouts"),
    ]);
    state.exercises = Array.isArray(exercisesResponse.exercises) ? exercisesResponse.exercises : [];
    state.fixtureWorkouts = sortWorkouts(
      Array.isArray(fixtureWorkoutsResponse.workouts) ? fixtureWorkoutsResponse.workouts : []
    );
    state.customWorkouts = sortWorkouts(
      Array.isArray(workoutsResponse.workouts) ? workoutsResponse.workouts : []
    );
    state.currentUser = workoutsResponse.user || state.currentUser;
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
  state.workoutExercises = Array.isArray(draft.workoutExercises) ? draft.workoutExercises : [];
}

function persistDraft() {
  if (!state.selectedExerciseId && state.workoutExercises.length === 0) {
    localStorage.removeItem(STORAGE_KEYS.draft);
    return;
  }

  writeJsonStorage(STORAGE_KEYS.draft, {
    selectedExerciseId: state.selectedExerciseId,
    workoutExercises: state.workoutExercises,
  });
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

function getAllWorkouts() {
  return sortWorkouts([...state.customWorkouts, ...state.fixtureWorkouts]);
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

      const fixtureBiasDiff =
        (Number(Boolean(right.created_at || right.updated_at)) || 0) -
        (Number(Boolean(left.created_at || left.updated_at)) || 0);
      if (fixtureBiasDiff !== 0) {
        return fixtureBiasDiff;
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

function selectExercise(exerciseId) {
  state.selectedExerciseId = exerciseId;
  state.isAddingExercise = false;
  persistDraft();
  render();
}

function startAddingSet() {
  const selectedExercise = getSelectedExercise();
  if (!selectedExercise) {
    return;
  }

  state.currentSetReps = 12;
  state.currentSetWeight = getWeightFromLastWorkout(getAllWorkouts(), selectedExercise.id);
  state.isAddingSet = true;
  render();
}

function cancelAddingSet() {
  state.isAddingSet = false;
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
  addSetToCurrentExercise({
    reps: state.currentSetReps,
    weight: state.currentSetWeight,
    notes: null,
  });
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

function finishExercise() {
  state.isAddingSet = false;
  state.isAddingExercise = true;
  persistDraft();
  render();
}

async function finishWorkout() {
  if (!state.workoutExercises.length) {
    resetDraftState();
    render();
    return;
  }

  if (state.isSavingWorkout) {
    return;
  }

  state.isSavingWorkout = true;
  render();

  try {
    const payload = await postJson("/api/workouts", buildLocalWorkout());
    state.currentUser = payload.user || state.currentUser;
    state.customWorkouts = sortWorkouts([
      payload.workout,
      ...state.customWorkouts.filter((workout) => workout.id !== payload.workout.id),
    ]);
    resetDraftState();
    showFlash(
      state.currentUser?.is_default_debug_user
        ? "Тренировка сохранена на сервере для default user"
        : "Тренировка сохранена на сервере"
    );
  } catch (error) {
    showFlash(error.message || "Не удалось сохранить тренировку");
  } finally {
    state.isSavingWorkout = false;
    render();
  }
}

function resetDraftState() {
  state.selectedExerciseId = null;
  state.workoutExercises = [];
  state.isAddingExercise = state.exercises.length > 0;
  state.isAddingSet = false;
  state.currentSetReps = 12;
  state.currentSetWeight = 0;
  localStorage.removeItem(STORAGE_KEYS.draft);
}

function buildLocalWorkout() {
  return {
    client_id: buildWorkoutClientId(),
    workout_date: getLocalTodayIso(),
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
  const range = PROGRESS_RANGES.find((item) => item.key === rangeKey) || PROGRESS_RANGES[1];
  const today = parseIsoDate(getLocalTodayIso());

  const filtered = workouts
    .map((workout) => {
      const date = parseIsoDate(workout.workout_date);
      return { workout, date };
    })
    .filter(({ date }) => inRange(date, range.days, today))
    .sort((left, right) => right.date - left.date)
    .map(({ workout }) => workout);

  if (!filtered.length) {
    return {
      totalWorkouts: 0,
      totalVolume: 0,
      averageVolumePerWorkout: 0,
      topExerciseByVolume: null,
      heaviestSet: null,
      volumeTrend: [],
    };
  }

  const exerciseVolumes = new Map();
  let heaviestSet = null;

  filtered.forEach((workout) => {
    workout.data.exercises.forEach((exercise) => {
      exercise.sets.forEach((set) => {
        if (set.weight > 0 && set.reps > 0) {
          const currentVolume = exerciseVolumes.get(exercise.name) || 0;
          exerciseVolumes.set(exercise.name, currentVolume + set.weight * set.reps);
        }

        if (
          !heaviestSet ||
          set.weight > heaviestSet.weight ||
          (set.weight === heaviestSet.weight && set.reps > heaviestSet.reps)
        ) {
          heaviestSet = {
            exerciseName: exercise.name,
            weight: set.weight,
            reps: set.reps,
            workoutDate: workout.workout_date,
          };
        }
      });
    });
  });

  const volumeTrend = filtered
    .slice(0, 7)
    .reverse()
    .map((workout) => ({
      workoutDate: workout.workout_date,
      volume: computeWorkoutVolume(workout),
    }));

  const totalVolume = Array.from(exerciseVolumes.values()).reduce(
    (accumulator, value) => accumulator + value,
    0
  );

  let topExerciseByVolume = null;
  for (const [name, volume] of exerciseVolumes.entries()) {
    if (!topExerciseByVolume || volume > topExerciseByVolume.totalVolume) {
      topExerciseByVolume = {
        exerciseName: name,
        totalVolume: volume,
      };
    }
  }

  return {
    totalWorkouts: filtered.length,
    totalVolume,
    averageVolumePerWorkout: totalVolume / filtered.length,
    topExerciseByVolume,
    heaviestSet,
    volumeTrend,
  };
}

function computeWorkoutVolume(workout) {
  return workout.data.exercises.reduce((exerciseTotal, exercise) => {
    return (
      exerciseTotal +
      exercise.sets.reduce((setTotal, set) => {
        return setTotal + (set.weight > 0 && set.reps > 0 ? set.weight * set.reps : 0);
      }, 0)
    );
  }, 0);
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

function render() {
  if (state.booting) {
    root.innerHTML = `
      <div class="layout">
        <main class="screen loading-state">
          <div>
            <div class="loader"></div>
            <p class="muted-note">Подключаю пользователя и загружаю серверные тренировки...</p>
          </div>
        </main>
      </div>
    `;
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
    return;
  }

  const topbar = renderTopbar();
  const screen = renderCurrentScreen();
  const nav = renderBottomNav();
  const modal = state.isAddingSet ? renderSetModal() : "";
  const toast = state.flashMessage ? `<div class="toast">${escapeHtml(state.flashMessage)}</div>` : "";

  root.innerHTML = `
    <div class="layout">
      ${topbar}
      <main class="screen">
        ${screen}
      </main>
      ${toast}
      ${nav}
      ${modal}
    </div>
  `;
}

function renderTopbar() {
  const titles = {
    trainings: "Trainings",
    progress: "Progress",
    new: "Новая тренировка",
  };

  const subtitles = {
    trainings: "История тренировок из JSON-фикстур и серверного хранилища",
    progress: "Сводка по объему, лучшим упражнениям и сохраненным тренировкам",
    new: state.currentUser?.is_default_debug_user
      ? "Сохраним тренировку на backend под default browser user"
      : "Сохраним тренировку на backend для текущего пользователя",
  };

  const buildPills = buildTopbarPills();

  let actionMarkup = `<div class="topbar-meta">${buildPills}</div>`;
  if (state.currentTab === "progress") {
    actionMarkup = `
      <div class="topbar-meta">
        ${buildPills}
        <button class="icon-button" data-action="refresh-progress" aria-label="Refresh">
          ${iconMarkup("refresh")}
        </button>
      </div>
    `;
  }

  if (state.currentTab === "new" && state.workoutExercises.length > 0) {
    actionMarkup = `
      <div class="topbar-meta">
        ${buildPills}
        <button class="action-button" data-action="finish-workout" ${
          state.isSavingWorkout ? "disabled" : ""
        }>${state.isSavingWorkout ? "Сохраняю..." : "Закончить тренировку"}</button>
      </div>
    `;
  }

  return `
    <header class="topbar">
      <div class="topbar-row">
        <div>
          <h1 class="topbar-title">${escapeHtml(titles[state.currentTab])}</h1>
          <div class="topbar-subtitle">${escapeHtml(subtitles[state.currentTab])}</div>
        </div>
        ${actionMarkup}
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
  return `
    <section class="workout-card">
      <div class="workout-header">
        <div>
          <div class="workout-date">${escapeHtml(formatLongDate(workout.workout_date))}</div>
          <div class="workout-day">${escapeHtml(formatWeekday(workout.workout_date))}</div>
        </div>
        ${badge}
      </div>
      <div class="stack">
        ${workout.data.exercises.map((exercise) => renderLoggedExerciseCard(exercise)).join("")}
      </div>
    </section>
  `;
}

function renderLoggedExerciseCard(exercise) {
  const groupedSets = groupConsecutiveExerciseSets(exercise.sets);
  return `
    <article class="surface-card exercise-card">
      <div class="exercise-name">${escapeHtml(exercise.name)}</div>
      <div class="set-list">
        ${groupedSets
          .map(
            (group) => `
              <div class="set-row">
                <span>${escapeHtml(
                  group.count > 1
                    ? `${formatWeight(group.weight)} кг × ${group.reps} × ${group.count}`
                    : `${formatWeight(group.weight)} кг × ${group.reps}`
                )}</span>
                ${
                  group.notes
                    ? `<span class="set-notes">${escapeHtml(group.notes)}</span>`
                    : ""
                }
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderProgressScreen() {
  const summary = summarizeProgress(getAllWorkouts(), state.selectedRange);
  const maxVolume = Math.max(0, ...summary.volumeTrend.map((point) => point.volume));

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

      <div class="grid-2">
        ${renderMetricCard("Workouts", String(summary.totalWorkouts))}
        ${renderMetricCard("Volume", formatVolume(summary.totalVolume))}
      </div>

      ${renderMetricCard("Average Volume / Workout", formatVolume(summary.averageVolumePerWorkout))}

      ${
        summary.topExerciseByVolume
          ? renderMetricCard(
              "Top Exercise",
              `${summary.topExerciseByVolume.exerciseName} (${formatVolume(
                summary.topExerciseByVolume.totalVolume
              )})`
            )
          : ""
      }

      ${
        summary.heaviestSet
          ? renderMetricCard(
              "Heaviest Set",
              `${summary.heaviestSet.exerciseName}: ${formatWeight(
                summary.heaviestSet.weight
              )} kg x ${summary.heaviestSet.reps}`,
              formatShortDate(summary.heaviestSet.workoutDate)
            )
          : ""
      }

      <section class="stack">
        <div class="section-title">Recent Volume Trend</div>
        ${
          summary.volumeTrend.length
            ? summary.volumeTrend
                .map((point) => renderTrendRow(point, maxVolume))
                .join("")
            : `<p class="muted-note">No workouts in this range</p>`
        }
      </section>
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

function renderTrendRow(point, maxVolume) {
  const progress = maxVolume > 0 ? Math.max(0.04, point.volume / maxVolume) : 0;
  return `
    <div class="trend-row">
      <div class="trend-head">
        <span>${escapeHtml(formatShortDate(point.workoutDate))}</span>
        <span class="trend-value">${escapeHtml(formatVolume(point.volume))}</span>
      </div>
      <div class="trend-bar">
        <div class="trend-bar-fill" style="width:${progress * 100}%"></div>
      </div>
    </div>
  `;
}

function renderNewWorkoutScreen() {
  const selectedExercise = getSelectedExercise();
  const currentExercise = getCurrentWorkoutExercise();
  const availableExercises = getAvailableExercises();
  const allWorkouts = getAllWorkouts();
  const canUseStandard =
    selectedExercise && hasValidWorkoutData(allWorkouts, selectedExercise.id);

  return `
    <section class="stack">
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

function renderDraftExerciseCard(exercise) {
  const groupedSets = groupWorkoutSetsByWeightAndReps(exercise.sets);
  return `
    <article class="surface-card exercise-card">
      <div class="exercise-name">${escapeHtml(exercise.exerciseName)}</div>
      ${
        groupedSets.length
          ? `
            <div class="set-list">
              ${groupedSets
                .map(
                  (group) => `
                    <div class="set-row">
                      <span>${escapeHtml(
                        group.count > 1
                          ? `${formatWeight(group.weight)} кг × ${group.reps} × ${group.count}`
                          : `${formatWeight(group.weight)} кг × ${group.reps}`
                      )}</span>
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
              <button class="text-button" data-action="cancel-adding-exercise">Отмена</button>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderSetModal() {
  return `
    <div class="modal-overlay">
      <section class="modal-card">
        <div class="stack">
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
    { key: "new", label: "New", icon: "new" },
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
  const pills = ['<span class="pill">Server sync</span>'];

  if (state.currentUser?.is_default_debug_user) {
    pills.push('<span class="pill pill-build">Default browser user</span>');
  } else if (state.currentUser?.auth_source === "telegram") {
    pills.push('<span class="pill pill-build">Telegram user</span>');
  } else if (state.currentUser?.auth_source === "telegram_unsafe") {
    pills.push('<span class="pill pill-build">Telegram fallback</span>');
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

function formatVolume(value) {
  return `${Math.trunc(value)} kg`;
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
