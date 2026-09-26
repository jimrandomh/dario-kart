// Persistent game state shared across all sub-games.

export type StageId = 'kart' | 'shell' | 'airace' | 'galaxy' | 'ending';
export const STAGE_ORDER: StageId[] = ['kart', 'shell', 'airace', 'galaxy', 'ending'];

export interface WeatherOverride {
  icon: string;
  text: string;
  /** Replaces the temperature readout entirely when set (e.g. "--"). */
  temp?: string;
  /** Replaces the location label when set. */
  location?: string;
}

export interface GameState {
  version: number;
  stage: StageId;
  /** Coins collected in Dario Kart. Carries over between races and (as seed money) into later stages. */
  coins: number;
  /** Temperature anomaly in °C above the baseline, driven by the AI's activity. */
  heat: number;
  weatherOverride: WeatherOverride | null;
  /** Ids of one-shot monologue lines already shown (see Hud.thinkOnce). */
  seenThoughts: string[];
  playTimeSec: number;
  settings: { muted: boolean; fahrenheit: boolean; music: boolean };
  /** Per-stage persistent data, keyed by stage id. Each stage owns its own key; use getStageData(). */
  stageData: Record<string, unknown>;
}

const SAVE_KEY = 'dariokart.save.v1';
const VERSION = 1;

export function defaultState(): GameState {
  return {
    version: VERSION,
    stage: 'kart',
    coins: 0,
    heat: 0,
    weatherOverride: null,
    seenThoughts: [],
    playTimeSec: 0,
    settings: { muted: false, fahrenheit: false, music: true },
    stageData: {},
  };
}

export function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.version !== VERSION) return null;
    const d = defaultState();
    return { ...d, ...parsed, settings: { ...d.settings, ...(parsed.settings ?? {}) } };
  } catch {
    return null;
  }
}

export function writeState(state: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode); the game still works, it just won't persist.
  }
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Returns the persistent data object for a stage, creating it from `defaults` if absent and
 * filling in any keys added since the save was written. Mutate the returned object freely;
 * it is saved along with the rest of the state.
 */
export function getStageData<T extends object>(state: GameState, key: string, defaults: T): T {
  const existing = state.stageData[key] as Partial<T> | undefined;
  const merged = { ...defaults, ...(existing ?? {}) } as T;
  state.stageData[key] = merged;
  return merged;
}
