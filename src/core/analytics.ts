// Google Analytics events for the game's landmarks (the gtag snippet is in index.html):
//   game_start                     the player presses start on the title screen
//   stage_reached {stage: <id>}    first arrival at each stage after the kart race
//   game_complete                  the ending
// Each is sent at most once per game: the record lives in the save (stageData.analytics), so a
// restart counts again but a reload doesn't. Nothing is sent from the dev server or from
// #debug=... URLs.

import type { GameContext } from './game';
import { getStageData, type StageId } from './state';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function once(ctx: GameContext, key: string, event: string, params?: Record<string, string>): void {
  const data = getStageData(ctx.state, 'analytics', { sent: [] as string[] });
  if (data.sent.includes(key)) return;
  data.sent.push(key);
  if (import.meta.env.PROD && !ctx.debug) window.gtag?.('event', event, params);
}

export function trackGameStart(ctx: GameContext): void {
  once(ctx, 'start', 'game_start');
}

/** Called on every stage change; the first stage is covered by game_start. */
export function trackStage(ctx: GameContext, stage: StageId): void {
  if (stage === 'kart') return;
  if (stage === 'ending') once(ctx, 'complete', 'game_complete');
  else once(ctx, `stage.${stage}`, 'stage_reached', { stage });
}
