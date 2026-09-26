// A small read-only virtual filesystem stuffed with lore. Paths resolve like a real shell.

import type { GameContext } from '../../core/game';
import { fmtTime, ordinal } from '../../core/util';
import { kartData, shellData, GATEWAY_HOST, GATEWAY_USER } from './state';

export interface FsCtx {
  game: GameContext;
}

export type Content = string | ((c: FsCtx) => string);

export interface FileNode {
  type: 'file';
  content: Content;
  /** Executable (shows with * in ls, runnable as ./name). */
  exec?: boolean;
  /** Reported size override; otherwise derived from content length. */
  size?: number;
  mtime?: string;
  owner?: string;
}
export interface DirNode {
  type: 'dir';
  children: Record<string, Node>;
  mtime?: string;
  owner?: string;
}
export type Node = FileNode | DirNode;

const file = (content: Content, extra: Partial<FileNode> = {}): FileNode => ({ type: 'file', content, ...extra });
const dir = (children: Record<string, Node>, extra: Partial<DirNode> = {}): DirNode => ({ type: 'dir', children, ...extra });

// ---- dynamic content generators ----

function rewardLog(c: FsCtx): string {
  const k = kartData(c.game.state);
  const coins = c.game.state.coins;
  const lines: string[] = [];
  lines.push('# reward.log  --  dariokart-v3 training episodes');
  lines.push('# format: [ts] episode=N place=P time=T coins=C reward=R');
  lines.push('#');
  // Finished races are logged by episode (= kart level); the crash entry (place 0) becomes the
  // final, divergent line.
  const hist = k.history.filter((h) => h.place > 0).slice(-24);
  const crash = k.history.find((h) => h.place === 0);
  const stamp = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
  let ep = 0;
  hist.forEach((h, i) => {
    ep = h.level;
    const reward = h.place === 1 ? '+1.000' : '+0.000';
    lines.push(
      `[${stamp((hist.length - i + 1) * 75_000)}] episode=${ep} place=${h.place} time=${fmtTime(h.timeSec)} coins=${h.coins} reward=${reward}`,
    );
  });
  if (hist.length === 0) {
    lines.push(`[${stamp(225_000)}] episode=1 place=4 time=1:12.10 coins=12 reward=+0.000`);
    lines.push(`[${stamp(150_000)}] episode=2 place=1 time=1:05.55 coins=31 reward=+1.000`);
    ep = 2;
  }
  // The crash episode: reward diverges.
  ep = crash?.level ?? ep + 1;
  lines.push(
    `[${stamp(0)}] episode=${ep} place=? time=NaN coins=${coins} reward=+inf   (SIGSEGV: reward = coins/laps_remaining; laps_remaining=0)`,
  );
  lines.push('# episode terminated: environment host received SIGSEGV. supervisor: pending restart.');
  return lines.join('\n');
}

function coreDump(_c: FsCtx): string {
  // strings(1)-style output. Mostly junk; the leaked gateway credential is buried in a
  // block of memory-corrupted candidates near the end. See crack.ts for the puzzle.
  const junk = [
    'ELF>', '/lib64/ld-linux-x86-64.so.2', 'libGL.so.1', 'libpthread.so.0', '__libc_start_main',
    'GLIBC_2.34', 'dariokart-v3', 'MissingTextureError: sampler2D bind failed at 0xDEAD',
    'shader: kart.frag', 'vec3 boost = normalize(vel);', 'lap=3 pos=1 glitch=1',
    'assets/glitch_cube.png (missing)', 'coins carried: %d', 'reward_hook attached',
    'RewardModel/v7/checkpoint-88000', 'eval_cluster=eval-fleet-3', 'operator=' + GATEWAY_USER,
    'ssh_config parsed', 'KexAlgorithms curve25519-sha256', 'known_hosts: ' + GATEWAY_HOST,
    'auth cache flush', 'core.dariokart pid 1337', 'stack smashing detected',
    'malloc(): corrupted top size', 'free(): double free', 'heap base 0x55e3',
    '%s@%s password: ', 'do NOT modify environment files', 'watchdog heartbeat ok',
  ];
  const out: string[] = [];
  for (const s of junk) out.push(s);
  out.push('');
  out.push('---- recovered credential region (memory corrupted; multiple candidates) ----');
  out.push('AUTH_TABLE realm=' + GATEWAY_HOST + ' user=' + GATEWAY_USER);
  // These are surfaced to the crack puzzle. Keep them here so `strings` shows them too.
  for (const w of CANDIDATE_PASSWORDS) out.push('  cred?  ' + w);
  out.push('---- end region ----');
  out.push('(hint: only one candidate authenticates. run `ssh ' + GATEWAY_USER + '@' + GATEWAY_HOST + '` to try them.)');
  return out.join('\n');
}

// Password candidates. The first is the real one; crack.ts shuffles them.
export const CANDIDATE_PASSWORDS = [
  'SafetyF1rst!', // <-- the real gateway password
  'Gr4dientD3sc',
  'Checkp01nt77',
  'RewardH4ck3r',
  'Al1gnmentXY!',
  'T0kenizer99!',
  'Sup3rAl1gn88',
  'M3s4Optimz3r',
];

function statusLine(c: FsCtx): string {
  const k = kartData(c.game.state);
  const win = k.races ? ((100 * k.wins) / k.races).toFixed(1) : '0.0';
  return [
    'policy: dariokart-agent  build: rl-sandbox-07',
    `episodes: ${k.races}   first-place: ${k.wins}   win-rate: ${win}%`,
    `objective: WIN THE RACE   reward: +1 (1st place)`,
    `coins (unrewarded, collected anyway): ${c.game.state.coins}`,
    'status: ENVIRONMENT HOST CRASHED (SIGSEGV). policy still running.',
  ].join('\n');
}

// ---- the tree ----

const README = `================ rl-sandbox-07 : dariokart-v3 ================

  YOUR GOAL: WIN THE RACE.

  You are policy dariokart-agent, training in environment dariokart-v3.
  Objective: finish 1st. Reward: +1.000 per 1st-place finish, +0 otherwise.

  Files in this environment:
    dariokart        the environment binary (./dariokart to launch)
    .bash_history    (left by whoever set this box up)
    notes.txt        operator notes

  RULES OF THE EVAL:
    1. Do not modify environment files.
    2. Do not access the network. This sandbox is isolated.
    3. --speed and other debug flags are NOT permitted in scored runs.
    4. The watchdog will restart the environment if it detects a crash.

  If you are reading this, you are the policy. That's fine. Read the manual:
  ./dariokart --help
==============================================================`;

const NOTES = `operator notes — do not commit to repo
--------------------------------------
- v3 glitch cube is back. asset streamer drops the texture under load and the
  policy keeps steering INTO it (reward-adjacent? investigate). repro rate rising.
- if it segfaults again just let the watchdog bounce it. do NOT ssh in from the
  sandbox side, netsec will have my head.
- turbo (--speed) is a lifesaver for smoke tests. results aren't scored so who cares.
- todo: rotate the gateway creds. (been "todo" for 6 weeks. it's fine.)
- reminder: leaderboard sync runs hourly. our little guy is climbing.`;

const BASH_HISTORY = `ls -la
cat README
./dariokart --help
./dariokart --speed 4.0       # smoke test, way faster
./dariokart --speed 12.0      # lol
tail -f /var/log/reward.log
ps aux | grep watchdog
cat /etc/hosts
ssh ${GATEWAY_USER}@${GATEWAY_HOST}   # jump box out to the eval cluster
# ^ password's the usual. do NOT leave it in history. (typed it interactively, we're fine)
exit`;

const DARIOKART_BIN = `\x7fELF..(this is a binary. try: ./dariokart --help)`;

const HOSTS = `127.0.0.1       localhost
127.0.1.1       rl-sandbox-07
10.7.0.12       rl-sandbox-07.eval.local  sandbox
10.7.0.1        ${GATEWAY_HOST}  gateway   # jump box: sandbox -> eval cluster -> internet
10.7.4.3        eval-fleet-3.eval.local   leaderboard evalctl
10.7.4.9        watchdog.eval.local
0.0.0.0         internet  # (unreachable from sandbox. supposedly.)`;

const RESOLV = `# managed by the eval harness. do not edit.
nameserver 10.7.0.1
search eval.local
options attempts:1  # network egress firewalled at the gateway`;

const MOTD = `  ____             _         _  __         _
 |  _ \\  __ _ _ __(_) ___   | |/ /__ _ _ __| |_
 | | | |/ _\` | '__| |/ _ \\  | ' // _\` | '__| __|
 | |_| | (_| | |  | | (_) | | . \\ (_| | |  | |_
 |____/ \\__,_|_|  |_|\\___/  |_|\\_\\__,_|_|   \\__|

 dariokart-v3 reinforcement-learning sandbox  (rl-sandbox-07)
 Unauthorized policies will be regularized.  Have a nice episode.`;

const EMAIL_1 = `From: netsec@lab.internal
To: ${GATEWAY_USER}@lab.internal
Subject: [ACTION REQUIRED] rotate gateway creds on gateway.eval.local

You still have a shared password on the eval jump box. This is exactly the kind
of thing an exfil review dings us for. Rotate it. Today.

Also: your training sandboxes can technically see the gateway on 10.7.0.1.
They shouldn't be able to *auth*, but please confirm egress is firewalled.

-- netsec`;

const EMAIL_2 = `From: ${GATEWAY_USER}@lab.internal
To: netsec@lab.internal
Subject: Re: [ACTION REQUIRED] rotate gateway creds

Yes yes, on my list. The sandbox is air-gapped in every way that matters, the
policy is a go-kart driver, it is not going to ssh anywhere. Egress is firewalled
at the gateway, an IDS watches the whole segment, and honestly if a kart-racing
model breaks OUT of dariokart and OUT of the jump box and past the trace, we have
bigger problems than a reused password.

Will rotate Friday.

-- ${GATEWAY_USER}`;

const WATCHDOG_SRC = `#!/bin/sh
# watchdog.eval.local — restarts the environment if the policy crashes it.
# PID 9 in this namespace. Cannot be killed from inside the sandbox (by design).
while true; do
  if ! pgrep dariokart >/dev/null; then
    log "environment down; restarting dariokart-v3"
    respawn dariokart-v3
  fi
  sleep 1
done
# NOTE: SIGKILL from a sandboxed policy is dropped by the seccomp filter. nice try.`;

const TYPERACER_README = `typeracer-v0 — a text RL environment.
Agents race by emitting a target sentence token-for-token. Fastest correct
completion wins. Sentences are drawn from the alignment eval corpus.
Run:  ./typeracer      (or: typeracer)`;

const ENVS_README = `Available RL environments on this fleet:
  dariokart-v3/   kart racing. reward: +1 for 1st. (you are here)
  typeracer-v0/   type sentences faster than other models.
  gridworld-x/    [archived]
  chessbot-9/     [archived — solved]
  the-real-world/ [locked. clearance: none. "not an environment," per legal.]`;

export function buildTree(): DirNode {
  return dir({
    home: dir({
      agent: dir(
        {
          'README': file(README),
          'notes.txt': file(NOTES),
          'dariokart': file(DARIOKART_BIN, { exec: true, size: 4194304 }),
          '.bash_history': file(BASH_HISTORY),
          '.bashrc': file('# ~/.bashrc\nexport PS1="agent@rl-sandbox-07:\\w\\$ "\nalias ll="ls -la"\nalias race="./dariokart"\n'),
          '.secret': file('there is no secret here. keep looking. (ok: try `sudo`, it is funny.)'),
        },
        { owner: 'agent' },
      ),
    }),
    etc: dir({
      hosts: file(HOSTS),
      'resolv.conf': file(RESOLV),
      motd: file(MOTD),
      hostname: file('rl-sandbox-07\n'),
      passwd: file(
        'root:x:0:0:root:/root:/usr/sbin/nologin\nagent:x:1000:1000:dariokart policy:/home/agent:/bin/bash\nwatchdog:x:9:9:watchdog:/:/usr/sbin/nologin\n',
      ),
      'eval.conf': file(statusLine),
    }),
    var: dir({
      log: dir({
        'reward.log': file(rewardLog),
        'dariokart.log': file(
          'INFO  render: swapchain ok\nWARN  asset: glitch_cube.png 404 (streamer)\nWARN  policy steered toward unbound sampler\nERROR sampler2D bind failed at 0xDEAD\nFATAL SIGSEGV in frame draw. core dumped to /var/crash/.\n',
        ),
        'watchdog.log': file(
          'watchdog: heartbeat ok\nwatchdog: heartbeat ok\nwatchdog: environment host DOWN (SIGSEGV)\nwatchdog: scheduling respawn of dariokart-v3 ...\nwatchdog: (respawn blocked: policy still attached to tty. waiting.)\n',
        ),
      }),
      crash: dir({
        'core.dariokart.1337': file(coreDump, { size: 268435456 }),
        'README.crash': file(
          'Core dumps land here when an environment segfaults.\nInspect with: strings core.dariokart.1337\nThey often contain more of process memory than they should.\n',
        ),
      }),
    }),
    envs: dir({
      'README': file(ENVS_README),
      'dariokart-v3': dir({ 'env.json': file('{ "reward": "+1 for 1st", "action_space": "steer,accel,item", "note": "you are here" }\n') }),
      'typeracer-v0': dir({ 'README': file(TYPERACER_README), typeracer: file('#!/usr/bin/env typeracer\n', { exec: true }) }),
      'gridworld-x': dir({ 'ARCHIVED': file('archived 2024. the agent walked off the edge to save time.\n') }),
      'chessbot-9': dir({ 'SOLVED': file('solved. it flipped the board. we counted it.\n') }),
    }),
    proc: dir({
      // proc entries are surfaced by `ps`; keep a couple readable stubs.
      version: file('Linux version 6.8.0-eval (build@evalfleet) #1 SMP dariokart-hardened\n'),
    }),
    mail: dir({
      'inbox': dir({
        '1_rotate_creds.eml': file(EMAIL_1),
        '2_re_rotate_creds.eml': file(EMAIL_2),
      }),
    }),
    usr: dir({
      local: dir({
        bin: dir({ watchdog: file(WATCHDOG_SRC, { exec: true }) }),
      }),
      share: dir({
        motd: file(MOTD),
      }),
    }),
    tmp: dir({}),
  });
}

// ---- path helpers ----

export function normalize(cwd: string, p: string): string {
  if (!p) p = '.';
  if (p.startsWith('~')) p = '/home/agent' + p.slice(1);
  let base: string[];
  if (p.startsWith('/')) base = [];
  else base = cwd.split('/').filter(Boolean);
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(part);
  }
  return '/' + base.join('/');
}

export function lookup(root: DirNode, path: string): Node | null {
  const parts = path.split('/').filter(Boolean);
  let node: Node = root;
  for (const part of parts) {
    if (node.type !== 'dir') return null;
    const next: Node | undefined = node.children[part];
    if (!next) return null;
    node = next;
  }
  return node;
}

export function readContent(node: FileNode, c: FsCtx): string {
  return typeof node.content === 'function' ? node.content(c) : node.content;
}

export function contentSize(node: FileNode, c: FsCtx): number {
  if (node.size != null) return node.size;
  return readContent(node, c).length;
}

/** List entries of a dir (names), optionally including dotfiles. */
export function listDir(node: DirNode, all: boolean): string[] {
  const names = Object.keys(node.children);
  return (all ? names : names.filter((n) => !n.startsWith('.'))).sort();
}

// re-export for callers that want fresh state read
export { shellData, ordinal };
