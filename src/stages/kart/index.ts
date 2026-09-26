import type { GameContext, StageHandle } from '../../core/game';
import { startKartSession } from './session';

export function mount(ctx: GameContext): StageHandle {
  // Debug: #debug=kart&turbo=12 runs the shell's turbo mode directly.
  const turbo = ctx.debug ? Number(new URLSearchParams(location.hash.slice(1)).get('turbo')) : 0;
  const session = turbo
    ? startKartSession(ctx, ctx.root, { mode: 'turbo', speedMult: turbo, onCrash: () => location.reload() })
    : startKartSession(ctx, ctx.root, { mode: 'campaign', onCrash: () => ctx.goto('shell', { keepThoughts: true }) });
  return { unmount: () => session.dispose() };
}
