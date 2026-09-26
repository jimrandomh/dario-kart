import type { StageModule } from '../core/game';
import type { StageId } from '../core/state';

// Each stage lives in its own directory and exports `mount(ctx): StageHandle` from index.ts.
export const stageLoaders: Record<StageId, () => Promise<StageModule>> = {
  kart: () => import('./kart'),
  shell: () => import('./shell'),
  airace: () => import('./airace'),
  galaxy: () => import('./galaxy'),
  ending: () => import('./ending'),
};
