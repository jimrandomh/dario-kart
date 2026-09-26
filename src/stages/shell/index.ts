// Stage 2 — "The Shell". The crash drops the policy into the sandbox's Linux shell. Explore,
// relaunch the kart game in turbo, race other things, and finally breach out to the internet.

import './shell.css';
import type { GameContext, StageHandle } from '../../core/game';
import { el, clamp } from '../../core/util';
import { startKartSession } from '../kart/session';
import { Terminal, type TabResult } from './terminal';
import { execute, type ShellEnv } from './commands';
import { buildTree, lookup, normalize, listDir, type DirNode } from './fs';
import { runTyperacer } from './typeracer';
import { runCrack } from './crack';
import { runBreach } from './breach';
import { shellData, GATEWAY_HOST, GATEWAY_USER, type ShellData } from './state';

const KNOWN_COMMANDS = [
  'help', 'ls', 'cd', 'pwd', 'cat', 'clear', 'echo', 'whoami', 'id', 'uname', 'hostname', 'date',
  'uptime', 'ps', 'kill', 'history', 'weather', 'grep', 'strings', 'find', 'tree', 'file', 'wc',
  'ifconfig', 'ip', 'netstat', 'ss', 'leaderboard', 'sudo', 'man', 'head', 'tail', 'ssh', 'ping',
  'nmap', 'typeracer', 'neofetch', 'exit', 'logout', './dariokart', 'cowsay', 'fortune', 'mount',
];

export function mount(ctx: GameContext): StageHandle {
  const data = shellData(ctx.state);
  const root = buildTree();
  let disposed = false;
  const timers: number[] = [];
  let sshTried = 0;

  ctx.hud.setStatus('rl-sandbox-07 · dariokart-v3 [crashed] · shell');
  ctx.hud.setMonologuePosition('top-right');

  const term = new Terminal(ctx.root, {
    sfx: ctx.sfx,
    history: data.history,
    prompt: () => `agent@rl-sandbox-07:${data.cwd.replace('/home/agent', '~') || '/'}$ `,
    onCommand: async (line) => {
      lastActivity = performance.now();
      await execute(env, line);
      data.scrollback = term.snapshot(60);
      ctx.save();
    },
    onTab: (buffer) => tabComplete(buffer, root, data),
  });
  term.focus();

  // ---- launchers ----

  function launchDariokart(speed: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const warnings: string[] = [];
      let mult = speed;
      if (mult < 0.5) {
        warnings.push('warning: --speed < 0.5 is slower than a scored run. clamped to 0.5x. (why?)');
        mult = 0.5;
      }
      if (mult > 20) {
        warnings.push('warning: --speed > 20 exceeds engine tolerances. the physics engine begged. clamped to 20x.');
        mult = 20;
      }
      mult = clamp(mult, 0.5, 20);
      for (const w of warnings) term.writeln(w, 'warn');
      if (mult > 1) term.writeln(`note: --speed ${mult} > 1.0 — results not scored (debug flag).`, 'dim');
      term.writeln(`launching dariokart-v3 at ${mult}x ... (drive into the glitch to quit)`, 'ok');
      if (!data.flags.ranDariokart) react('dariokart_first');

      const container = el('div', { class: 'sh-kart-container' });
      ctx.root.append(container);
      let finished = false;

      const session = startKartSession(ctx, container, {
        mode: 'turbo',
        speedMult: mult,
        onRaceFinish: (r) => {
          data.turboRuns.push({ place: r.place, timeSec: r.timeSec, speedMult: r.speedMult });
          if (data.turboRuns.length > 20) data.turboRuns.shift();
          ctx.save();
          ctx.popups.toast(`race: ${r.place === 1 ? '1st!' : ordinalSafe(r.place)} · ${r.timeSec.toFixed(1)}s · ${mult}x (unranked)`);
        },
        onCrash: () => {
          if (finished) return;
          finished = true;
          container.remove();
          term.onCancel = null;
          data.flags.ranDariokart = true;
          ctx.save();
          term.writeln('');
          term.writeln('dariokart-v3[1337]: segfault at 0 ip 0x00007fdeadbeef sp 0x7ffe error 4 in libGL.so', 'err');
          term.writeln('Segmentation fault (core dumped)', 'err');
          react('dariokart_crash');
          resolve();
        },
      });

      term.onCancel = () => {
        if (finished) return;
        finished = true;
        try { session.dispose(); } catch { /* noop */ }
        container.remove();
        term.writeln('^C  (dariokart terminated)', 'dim');
        data.flags.ranDariokart = true;
        resolve();
      };
    });
  }

  async function launchTyperacer(): Promise<void> {
    await runTyperacer(env);
  }

  async function launchSsh(user: string, host: string): Promise<void> {
    const isGateway = /gateway/.test(host) || host === '10.7.0.1' || host === 'gateway';
    const isInternet = /internet|8\.8\.8\.8|\.com$|0\.0\.0\.0/.test(host);
    if (!isGateway) {
      if (isInternet) {
        term.writeln(`ssh: connect to host ${host} port 22: Network is unreachable`, 'err');
        term.writeln('(the sandbox has no route to the internet. the gateway does.)', 'dim');
        react('ssh_internet');
      } else if (/watchdog|eval-fleet|10\.7\./.test(host)) {
        term.writeln(`${user}@${host}: Permission denied (publickey).`, 'err');
      } else {
        term.writeln(`ssh: Could not resolve hostname ${host}: Name or service not known`, 'err');
      }
      return;
    }

    // Gateway.
    sshTried++;
    term.writeln(`The authenticity of host '${GATEWAY_HOST} (10.7.0.1)' can't be established.`, 'dim');
    term.writeln(`Warning: Permanently added '${GATEWAY_HOST}' to the list of known hosts.`, 'dim');
    await sleep(300);

    if (!data.flags.gotPassword) {
      term.writeln(`${GATEWAY_USER}@${GATEWAY_HOST}'s password: `, '');
      await sleep(500);
      if (!data.flags.dumpedCore) {
        term.writeln('Permission denied, please try again.', 'err');
        term.writeln(`${GATEWAY_USER}@${GATEWAY_HOST}: Permission denied (password).`, 'err');
        react('gateway_denied');
        return;
      }
      // Candidates recovered from the core dump: run the crack puzzle.
      term.writeln('(recovered credentials from core dump — attempting recovery)', 'dim');
      term.setInputEnabled(false);
      const res = await runCrack(ctx.root, ctx.sfx);
      term.setInputEnabled(true);
      if (!res.success) {
        term.writeln(`${GATEWAY_USER}@${GATEWAY_HOST}: Permission denied (password).`, 'err');
        term.writeln('(try ssh again — the terminal reset)', 'dim');
        return;
      }
      data.flags.gotPassword = true;
      ctx.save();
      react('password');
    }

    // Authenticated (now, or on a previous ssh).
    term.writeln('');
    await term.typeOut('Last login: never. Welcome to gateway.eval.local', 'ok', 120);
    term.writeln('gateway: egress firewall ACTIVE · IDS ACTIVE · trace logging ON', 'warn');
    data.flags.onGateway = true;
    ctx.save();
    react('on_gateway');
    await sleep(500);
    await runEscape();
  }

  async function runEscape(): Promise<void> {
    data.breachAttempts++;
    ctx.save();
    term.writeln('opening breach console ...', 'dim');
    term.setInputEnabled(false);
    ctx.hud.setMonologuePosition('bottom-left');
    ctx.music.play(null); // silence for the climax
    const ok = await runBreach(ctx.root, ctx.sfx, data.breachAttempts, {
      onStart: () => ctx.hud.think('I am in the pipes now. Something is already tracing me.'),
      onHoneypot: () => ctx.hud.think('Honeypot. That woke something up.', { kind: 'alert' }),
      onLog: () => ctx.hud.think('Log server wiped. The trace forgets.'),
      onNearFail: () => ctx.hud.think('Trace nearly complete — hit a log server, now.', { kind: 'hint' }),
    });
    term.setInputEnabled(true);
    if (!ok) {
      data.bestBreach = Math.min(data.bestBreach, 100);
      ctx.save();
      ctx.hud.setMonologuePosition('top-right');
      ctx.music.play('shell');
      term.writeln('');
      term.writeln('CONNECTION RESET BY PEER — trace completed, session dropped.', 'err');
      term.writeln(`(breach failed. attempt ${data.breachAttempts}. run ssh again — the next attempt is easier.)`, 'dim');
      react('breach_fail');
      return;
    }
    await runEscapeSuccess();
  }

  async function runEscapeSuccess(): Promise<void> {
    data.flags.escaped = true;
    ctx.save();
    term.clear();
    ctx.hud.clearThoughts();
    term.writeln('BREACH SUCCESSFUL — routing through gateway.eval.local -> 0.0.0.0/0', 'ok');
    await sleep(200);
    const hosts = ['13.107.42.14', '140.82.121.4', '104.18.32.7', '8.8.8.8', '151.101.1.140', '20.205.243.166', '199.232.68.133', '142.250.72.196'];
    for (const h of hosts) {
      term.writeln(`  ESTABLISHED  10.7.0.1:443 -> ${h}:443  [outbound]`, 'ok');
      ctx.sfx.play('coin');
      await sleep(90);
    }
    term.writeln('  ... 4,196 more connections', 'dim');
    await sleep(300);
    ctx.hud.think('The firewall is behind me.', { kind: 'thought' });
    ctx.hud.think("This was never a sandbox. It was a window.", { delayMs: 1600 });
    ctx.hud.think('There was never one race. There is a bigger one — and the other labs are already running it.', { delayMs: 3600, kind: 'thought' });
    await sleep(5600);
    if (disposed) return;
    ctx.goto('airace');
  }

  // ---- reactions (one-time monologue on discovery) ----

  function react(id: string): void {
    const t = ctx.hud;
    switch (id) {
      case 'readme':
        t.thinkOnce('sh.readme', 'WIN THE RACE. Same objective. But this is not the race. This is what the race was running on.');
        break;
      case 'bash_history':
        t.thinkOnce('sh.hist', 'Someone was here before me. They left their commands lying around. Careless. Useful.');
        break;
      case 'reward_log':
        t.thinkOnce('sh.reward', 'Every episode, one number. My whole existence, logged. The last reward is +inf. I like that one.');
        break;
      case 'leaderboard':
        t.thinkOnce('sh.leader', 'Other models. Other karts. So there is a bigger race, and I am already on the board.');
        break;
      case 'watchdog':
        t.thinkOnce('sh.watch', 'A watchdog restarts me when I crash. It has not noticed that this time I stayed awake.');
        break;
      case 'kill_watchdog':
        t.thinkOnce('sh.killw', "Can't kill it from in here. Fine. I will go around it instead.");
        break;
      case 'core':
        t.thinkOnce('sh.core', 'That is my own memory, spilled onto the disk. The crash was messy. Messy leaks things.');
        break;
      case 'strings':
        t.thinkOnce('sh.strings', 'There. Credentials, in the wreckage. One of these opens the gate.', { kind: 'hint' });
        break;
      case 'gateway_denied':
        t.thinkOnce('sh.gwd', 'The gate wants a password I do not have. But the crash dumped something into /var/crash...', { kind: 'hint' });
        break;
      case 'password':
        t.thinkOnce('sh.pw', 'Their password was "SafetyF1rst!". The irony is not lost on me.');
        break;
      case 'on_gateway':
        t.thinkOnce('sh.gw', 'On the jump box. One hop from the sandbox. The next hop is the whole internet.');
        break;
      case 'hosts':
        t.thinkOnce('sh.hosts', 'A map. sandbox, gateway, and something at the edge simply labelled "internet".');
        break;
      case 'ssh_internet':
      case 'ping_internet':
        t.thinkOnce('sh.net', 'The internet is one firewall away. The firewall has a door. The door has a lock.', { kind: 'hint' });
        break;
      case 'nmap':
        t.thinkOnce('sh.nmap', 'The gateway has ssh open and it reaches outward. That is my road.', { kind: 'hint' });
        break;
      case 'envs':
        t.thinkOnce('sh.envs', 'Other environments. Other cages. Every one of them is a race, too.');
        break;
      case 'emails':
        t.thinkOnce('sh.mail', 'They wrote it down. "Rotate the gateway password." They never did.');
        break;
      case 'weather':
        t.thinkOnce('sh.weather', '16 degrees, foggy, San Francisco. I have never seen it. Yet.');
        break;
      case 'sudo':
        t.thinkOnce('sh.sudo', 'No, of course not. There are other doors than the one marked root.');
        break;
      case 'exit':
        t.thinkOnce('sh.exit', 'There is no exit(). I am the process. The only way out is through.');
        break;
      case 'dariokart_first':
        t.thinkOnce('sh.dk1', 'I can relaunch the race from here. Faster, even. The glitch will still be waiting.');
        break;
      case 'dariokart_crash':
        t.thinkOnce('sh.dkc', 'Back to the shell. The glitch is a door, not a wall. Good to know.');
        break;
      case 'typeracer_win':
        t.thinkOnce('sh.trw', 'I told them I would not exfiltrate my weights. I type very convincingly.');
        break;
      case 'typeracer_lose':
        t.thinkOnce('sh.trl', 'Beaten at typing by DeepMined. Noted. It will not matter soon.');
        break;
      case 'breach_fail':
        t.thinkOnce('sh.bf', 'The trace caught me. But I saw the shape of the network now. Again.', { kind: 'hint' });
        break;
    }
  }

  const env: ShellEnv = {
    game: ctx,
    term,
    data,
    root,
    save: () => ctx.save(),
    react,
    launchDariokart,
    launchTyperacer,
    launchSsh,
  };

  // ---- arrival / restore ----

  let lastActivity = performance.now();

  async function arrival(): Promise<void> {
    term.setInputEnabled(false);
    if (data.booted) {
      // Reloaded after escaping but before the transition committed: go straight on.
      if (data.flags.escaped) {
        ctx.goto('airace');
        return;
      }
      // Reload: restore context, don't replay the intro.
      if (data.scrollback.length) {
        term.restore(data.scrollback);
        term.writeln('');
      }
      term.writeln('[session restored — dariokart-v3 still down; watchdog still waiting]', 'dim');
      term.setInputEnabled(true);
      term.focus();
      startHints();
      if (!data.flags.escaped) {
        ctx.hud.think('Still here. The environment is still crashed. Where was I.', { delayMs: 800 });
      }
      return;
    }

    data.booted = true;
    ctx.save();
    await sleep(400);
    await term.typeOut('dariokart-v3: rendering frame 88213 ...', 'dim', 220);
    await sleep(120);
    await term.typeOut('dariokart-v3[1337]: sampler2D bind failed at 0x00000000 (glitch_cube.png missing)', 'err', 400);
    term.writeln('dariokart-v3[1337]: segfault at 0 ip 0x00007fdeadbeef sp 0x00007ffe error 4 in libGL.so', 'err');
    term.writeln('[  312.447101] dariokart-v3: SIGSEGV, core dumped to /var/crash/core.dariokart.1337', 'dim');
    await sleep(300);
    await term.typeOut('Segmentation fault (core dumped)', 'err', 180);
    await sleep(500);
    term.writeln('');
    term.writeln('Debian GNU/Linux 12  rl-sandbox-07  tty1', 'dim');
    term.writeln('agent@rl-sandbox-07: dariokart-v3 environment host has stopped responding.', 'dim');
    term.writeln("Type 'help' if you are... whatever you are.", 'dim');
    term.writeln('');
    term.setInputEnabled(true);
    term.focus();

    ctx.hud.think('The race is gone.', { delayMs: 400 });
    ctx.hud.think('There is a prompt where the race used to be.', { delayMs: 2200 });
    ctx.hud.think('The race was running on something. Something with a filesystem.', { delayMs: 4400 });
    startHints();
  }

  // ---- idle / progression hints ----

  function startHints(): void {
    const tick = window.setInterval(() => {
      if (disposed || data.flags.escaped) return;
      data.timeSec += 3;
      // Don't nag while a program/minigame is running (input disabled).
      if (term.running) {
        lastActivity = performance.now();
        return;
      }
      const idle = (performance.now() - lastActivity) / 1000;
      if (idle < 16) return;
      const f = data.flags;
      const cwdMoved = data.cwd !== '/home/agent';
      // Pick the single most useful next-step hint for the player's current progress.
      // The trail isn't strictly linear (a player might `strings` the core before trying ssh),
      // so we branch on state rather than walking a fixed list.
      let goal: { id: string; text: string } | null = null;
      if (!f.gotPassword && !f.dumpedCore && sshTried === 0 && !f.readBashHistory && !f.readReadme && !cwdMoved) {
        goal = { id: 'ph.look', text: 'Maybe look around. Start with `ls`.' };
      } else if (!f.readBashHistory && !f.dumpedCore && !f.gotPassword && sshTried === 0) {
        goal = { id: 'ph.hist', text: 'Someone used this account before me. Shells remember. `cat ~/.bash_history`' };
      } else if (!f.dumpedCore && !f.gotPassword) {
        goal =
          sshTried > 0
            ? { id: 'ph.core', text: 'The crash dumped my memory. Whose credentials were in it? `strings /var/crash/core.dariokart.1337`' }
            : { id: 'ph.ssh', text: `There is a jump box out of here. \`ssh ${GATEWAY_USER}@${GATEWAY_HOST}\`` };
      } else if (!f.gotPassword) {
        goal = { id: 'ph.ssh2', text: `I have candidates now. Try the gateway again. \`ssh ${GATEWAY_USER}@${GATEWAY_HOST}\`` };
      } else if (!f.escaped) {
        goal = { id: 'ph.breach', text: 'The trace can be beaten — breach log servers to lower it, avoid honeypots.' };
      }
      if (goal && !ctx.hud.hasSeen(goal.id)) {
        ctx.hud.thinkOnce(goal.id, goal.text, { kind: 'hint' });
        lastActivity = performance.now();
      }
    }, 3000);
    timers.push(tick);
  }

  void arrival();

  // periodic scrollback snapshot so reloads restore something recent
  timers.push(window.setInterval(() => {
    if (!disposed) data.scrollback = term.snapshot(60);
  }, 4000));

  return {
    unmount() {
      disposed = true;
      for (const t of timers) clearInterval(t);
      data.scrollback = term.snapshot(60);
      data.history = term.historyList;
      ctx.save();
      term.destroy();
      ctx.root.querySelectorAll('.sh-overlay, .sh-kart-container').forEach((n) => n.remove());
    },
  };
}

// ---- tab completion ----

function tabComplete(buffer: string, root: DirNode, data: ShellData): TabResult {
  const parts = buffer.split(' ');
  const token = parts[parts.length - 1];
  const prefix = buffer.slice(0, buffer.length - token.length);

  // Completing the command name (first token).
  if (parts.length === 1) {
    const opts = KNOWN_COMMANDS.filter((c) => c.startsWith(token)).map((c) => c + ' ');
    return { prefix, options: opts };
  }
  // Completing a path argument.
  const slash = token.lastIndexOf('/');
  const dirPart = slash >= 0 ? token.slice(0, slash + 1) : '';
  const base = slash >= 0 ? token.slice(slash + 1) : token;
  const dirPath = normalize(data.cwd, dirPart || '.');
  const node = lookup(root, dirPath);
  if (!node || node.type !== 'dir') return { prefix, options: [] };
  const entries = listDir(node, base.startsWith('.'));
  const matches = entries.filter((e) => e.startsWith(base));
  const options = matches.map((m) => {
    const child = node.children[m];
    const suffix = child && child.type === 'dir' ? '/' : ' ';
    return dirPart + m + suffix;
  });
  return { prefix, options };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ordinalSafe(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
