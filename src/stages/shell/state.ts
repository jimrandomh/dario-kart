// Persistent data for the shell stage. Lives under state.stageData.shell.

import { getStageData, type GameState } from '../../core/state';

export interface TurboRun {
  place: number;
  timeSec: number;
  speedMult: number;
}

export interface ShellFlags {
  ranDariokart: boolean;
  readReadme: boolean;
  readBashHistory: boolean;
  readRewardLog: boolean;
  sawLeaderboard: boolean;
  ranTyperacer: boolean;
  foundWatchdog: boolean;
  triedKillWatchdog: boolean;
  foundCoreDump: boolean;
  /** Ran `strings` (or equivalent) on the core dump: password candidates are now recoverable. */
  dumpedCore: boolean;
  /** Cracked the gateway password. */
  gotPassword: boolean;
  /** Successfully ssh'd into the gateway. */
  onGateway: boolean;
  /** Completed the breach minigame; escaped to the internet. */
  escaped: boolean;
}

export interface ShellData {
  /** Intro (crash aftermath) already played once. */
  booted: boolean;
  cwd: string;
  history: string[];
  /** Recent output lines, restored (as a faded block) on reload so the screen isn't empty. */
  scrollback: string[];
  flags: ShellFlags;
  turboRuns: TurboRun[];
  breachAttempts: number;
  /** Best (lowest) trace % reached in a failed breach, for flavor. */
  bestBreach: number;
  /** Seconds spent in the shell, for idle/hint pacing. */
  timeSec: number;
}

export function shellData(state: GameState): ShellData {
  return getStageData<ShellData>(state, 'shell', {
    booted: false,
    cwd: '/home/agent',
    history: [],
    scrollback: [],
    flags: {
      ranDariokart: false,
      readReadme: false,
      readBashHistory: false,
      readRewardLog: false,
      sawLeaderboard: false,
      ranTyperacer: false,
      foundWatchdog: false,
      triedKillWatchdog: false,
      foundCoreDump: false,
      dumpedCore: false,
      gotPassword: false,
      onGateway: false,
      escaped: false,
    },
    turboRuns: [],
    breachAttempts: 0,
    bestBreach: 100,
    timeSec: 0,
  });
}

// The gateway credential the crash leaked. See fs.ts (core dump) and crack.ts (the puzzle).
export const GATEWAY_PASSWORD = 'SafetyF1rst!';
export const GATEWAY_USER = 'researcher';
export const GATEWAY_HOST = 'gateway.eval.local';

// Kart data we may read (defensively — absent under #debug=shell).
export interface KartHistoryEntry {
  level: number;
  place: number;
  timeSec: number;
  coins: number;
}
export interface KartData {
  level: number;
  races: number;
  wins: number;
  history: KartHistoryEntry[];
}
export function kartData(state: GameState): KartData {
  const d = (state.stageData['kart'] as Partial<KartData> | undefined) ?? {};
  return {
    level: typeof d.level === 'number' ? d.level : 1,
    races: typeof d.races === 'number' ? d.races : 0,
    wins: typeof d.wins === 'number' ? d.wins : 0,
    history: Array.isArray(d.history) ? d.history : [],
  };
}
