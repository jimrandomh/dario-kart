import './style.css';
import { Game } from './core/game';
import { defaultState, loadState, clearSavedState, STAGE_ORDER, type StageId } from './core/state';

// URL hash options:
//   #reset                 erase saved progress
//   #debug=<stage>         jump straight to a stage with fresh, unsaved state
//   &coins=N &heat=N       (with #debug) seed those values
const params = new URLSearchParams(location.hash.slice(1));
if (params.has('reset')) {
  clearSavedState();
  history.replaceState(null, '', location.pathname + location.search);
}

const debugStage = params.get('debug') as StageId | null;
const debug = !!debugStage && STAGE_ORDER.includes(debugStage);

let state = loadState() ?? defaultState();
if (debug) {
  state = defaultState();
  state.stage = debugStage!;
  state.coins = Number(params.get('coins') ?? (debugStage === 'kart' ? 0 : 250));
  state.heat = Number(params.get('heat') ?? 0);
}

const game = new Game(document.getElementById('app')!, state, !debug, debug);
game.start();

// Handy for poking at things from the devtools console.
(window as unknown as { game: Game }).game = game;
