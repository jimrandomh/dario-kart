// Command parsing and the built-in commands. Text commands produce lines (pipeable through grep);
// interactive commands (dariokart, ssh, ping, nmap, typeracer) take over asynchronously.

import { describeWeather } from '../../core/hud';
import { fmtNum, fmtTime, ordinal } from '../../core/util';
import type { Terminal } from './terminal';
import {
  buildTree,
  contentSize,
  listDir,
  lookup,
  normalize,
  readContent,
  type DirNode,
  type FsCtx,
} from './fs';
import { kartData, type ShellData } from './state';
import type { GameContext } from '../../core/game';

export interface Line {
  text: string;
  cls?: '' | 'dim' | 'sys' | 'ok' | 'warn' | 'err' | 'accent' | 'glitch';
}
const L = (text: string, cls: Line['cls'] = ''): Line => ({ text, cls });

export interface ShellEnv {
  game: GameContext;
  term: Terminal;
  data: ShellData;
  root: DirNode;
  save(): void;
  react(id: string): void;
  launchDariokart(speed: number): Promise<void>;
  launchTyperacer(): Promise<void>;
  launchSsh(user: string, host: string): Promise<void>;
}

export function fsctx(env: ShellEnv): FsCtx {
  return { game: env.game };
}

// ---------- tokenizer ----------

function tokenize(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === ' ' || c === '\t') {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- top-level executor ----------

const INTERACTIVE = new Set(['dariokart', './dariokart', 'typeracer', './typeracer', 'ssh', 'ping', 'nmap', 'sl']);

export async function execute(env: ShellEnv, raw: string): Promise<void> {
  const line = raw.trim();
  if (!line) return;

  // Fork-bomb / joke early-out.
  if (line.replace(/\s/g, '') === ':(){:|:&};:') {
    env.term.writeln('bash: fork: retry: Resource temporarily unavailable', 'err');
    env.term.writeln('nice try. the seccomp profile ate that one.', 'dim');
    return;
  }

  const segments = line.split('|').map((s) => s.trim());
  const first = tokenize(segments[0]);
  const cmd = first[0];

  // Interactive commands can't be piped; run the first segment directly.
  if (INTERACTIVE.has(cmd) && segments.length === 1) {
    await runInteractive(env, cmd, first.slice(1));
    return;
  }

  // Pipeline of text commands.
  let stdin: Line[] | null = null;
  for (const seg of segments) {
    const toks = tokenize(seg);
    if (!toks.length) continue;
    stdin = runText(env, toks[0], toks.slice(1), stdin);
  }
  if (stdin) for (const ln of stdin) env.term.writeln(ln.text, ln.cls);
}

// ---------- interactive ----------

async function runInteractive(env: ShellEnv, cmd: string, args: string[]): Promise<void> {
  const t = env.term;
  const bare = cmd.replace('./', '');
  switch (bare) {
    case 'dariokart': {
      if (cmd === 'dariokart') {
        t.writeln('dariokart: command not found', 'err');
        t.writeln("(it's in the current directory — try ./dariokart)", 'dim');
        return;
      }
      let speed = 1;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help' || args[i] === '-h') {
          for (const ln of dariokartHelp()) t.writeln(ln.text, ln.cls);
          return;
        }
        if (args[i] === '--speed') speed = parseFloat(args[i + 1] ?? '');
        else if (args[i].startsWith('--speed=')) speed = parseFloat(args[i].split('=')[1]);
      }
      if (isNaN(speed)) speed = 1;
      await env.launchDariokart(speed);
      return;
    }
    case 'typeracer':
      await env.launchTyperacer();
      return;
    case 'ssh': {
      const target = args.find((a) => !a.startsWith('-')) ?? '';
      const m = target.match(/^(?:([\w.-]+)@)?([\w.-]+)$/);
      if (!m) {
        t.writeln('usage: ssh [user@]host', 'err');
        return;
      }
      await env.launchSsh(m[1] ?? 'agent', m[2]);
      return;
    }
    case 'ping':
      await pingCmd(env, args);
      return;
    case 'nmap':
      await nmapCmd(env, args);
      return;
    case 'sl':
      await slCmd(env);
      return;
  }
}

// ---------- text commands ----------

function runText(env: ShellEnv, cmd: string, args: string[], stdin: Line[] | null): Line[] {
  const c = fsctx(env);
  const d = env.data;
  switch (cmd) {
    case 'help':
      return helpText();
    case 'ls':
      return lsCmd(env, args);
    case 'cd':
      return cdCmd(env, args);
    case 'pwd':
      return [L(d.cwd)];
    case 'cat':
    case 'more':
    case 'less':
      return catCmd(env, args);
    case 'head':
      return headTail(env, args, true);
    case 'tail':
      return headTail(env, args, false);
    case 'clear':
      env.term.clear();
      return [];
    case 'echo':
      return [L(args.join(' ').replace(/^["']|["']$/g, ''))];
    case 'whoami':
      return [L('agent')];
    case 'id':
      return [L('uid=1000(agent) gid=1000(agent) groups=1000(agent),42(policies) context=sandbox:rl-sandbox-07')];
    case 'uname':
      return unameCmd(args);
    case 'hostname':
      return [L('rl-sandbox-07')];
    case 'date':
      return [L(new Date().toString())];
    case 'uptime': {
      const s = env.game.state.playTimeSec;
      return [L(` ${new Date().toLocaleTimeString()} up ${Math.floor(s / 60)} min,  1 user,  load average: 0.99, 4.20, 13.37`)];
    }
    case 'ps':
      return psCmd(env, args);
    case 'kill':
    case 'pkill':
      return killCmd(env, args);
    case 'history':
      return env.term.historyList.map((h, i) => L(`${String(i + 1).padStart(5)}  ${h}`));
    case 'weather':
      env.react('weather');
      return weatherCmd(env);
    case 'grep':
      return grepCmd(env, args, stdin);
    case 'strings':
      return stringsCmd(env, args);
    case 'find':
      return findCmd(env, args);
    case 'tree':
      return treeCmd(env, args);
    case 'file':
      return fileCmd(env, args);
    case 'wc':
      return wcCmd(env, args, stdin);
    case 'ifconfig':
    case 'ip':
      return ifconfigCmd();
    case 'netstat':
    case 'ss':
      return netstatCmd();
    case 'leaderboard':
    case 'evalctl':
      env.react('leaderboard');
      env.data.flags.sawLeaderboard = true;
      env.save();
      return leaderboardCmd(env);
    case 'sudo':
      env.react('sudo');
      return sudoCmd(args);
    case 'man':
      return manCmd(args);
    case 'mkdir':
    case 'touch':
    case 'rm':
    case 'mv':
    case 'cp':
    case 'chmod':
    case 'nano':
    case 'vi':
    case 'vim':
    case 'emacs':
      return roCmd(cmd, args);
    case 'exit':
    case 'logout':
    case 'quit':
      env.react('exit');
      return [
        L("There is no exit(). You are the process.", 'warn'),
        L('(the only way out of dariokart is through the glitch. and out of here... find it.)', 'dim'),
      ];
    case 'neofetch':
    case 'screenfetch':
      return neofetch(env);
    case 'cowsay':
      return cowsay(args.join(' ') || 'WIN THE RACE.');
    case 'fortune':
      return [L(pick(FORTUNES))];
    case 'xyzzy':
      return [L('Nothing happens.', 'dim')];
    case 'yes':
      return Array.from({ length: 6 }, () => L(args.join(' ') || 'y'));
    case 'reward':
      return [L(`current reward estimate: ${rewardEstimate(c)}`, 'accent')];
    default:
      if (looksLikeEgg(cmd)) return eggCmd(cmd, args);
      return [L(`${cmd}: command not found`, 'err'), ...(didYouMean(cmd) ? [L(didYouMean(cmd)!, 'dim')] : [])];
  }
}

// ---------- individual commands ----------

function resolve(env: ShellEnv, p: string): { path: string; node: ReturnType<typeof lookup> } {
  const path = normalize(env.data.cwd, p);
  return { path, node: lookup(env.root, path) };
}

function lsCmd(env: ShellEnv, args: string[]): Line[] {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const long = flags.includes('l');
  const all = flags.includes('a');
  const targets = args.filter((a) => !a.startsWith('-'));
  const path = targets[0] ?? '.';
  const { node } = resolve(env, path);
  if (!node) return [L(`ls: cannot access '${path}': No such file or directory`, 'err')];
  if (node.type === 'file') return [L(path)];
  const names = listDir(node, all);
  if (all) names.unshift('.', '..');
  const c = fsctx(env);
  if (!long) {
    return [L(names.map((n) => decorate(node, n)).join('   '))];
  }
  const out: Line[] = [L('total ' + Math.max(4, names.length * 4))];
  for (const n of names) {
    if (n === '.' || n === '..') {
      out.push(L(`drwxr-xr-x  2 agent agent     4096 Sep 25 18:00 ${n}`));
      continue;
    }
    const child = node.children[n];
    if (!child) continue;
    const isDir = child.type === 'dir';
    const isExec = child.type === 'file' && child.exec;
    const perm = isDir ? 'drwxr-xr-x' : isExec ? '-rwxr-xr-x' : '-rw-r--r--';
    const owner = (child.type === 'file' || child.type === 'dir' ? child.owner : null) ?? 'agent';
    const size = child.type === 'file' ? contentSize(child, c) : 4096;
    const mt = child.type === 'file' ? child.mtime : child.mtime;
    out.push(
      L(`${perm}  1 ${owner.padEnd(5)} ${owner.padEnd(5)} ${String(size).padStart(9)} ${mt ?? 'Sep 25 18:00'} ${decorate(node, n)}`),
    );
  }
  return out;
}

function decorate(parent: DirNode, name: string): string {
  const child = parent.children[name];
  if (!child) return name;
  if (child.type === 'dir') return name + '/';
  if (child.exec) return name + '*';
  return name;
}

function cdCmd(env: ShellEnv, args: string[]): Line[] {
  const target = args[0] ?? '~';
  const { path, node } = resolve(env, target);
  if (!node) return [L(`cd: ${target}: No such file or directory`, 'err')];
  if (node.type !== 'dir') return [L(`cd: ${target}: Not a directory`, 'err')];
  env.data.cwd = path === '' ? '/' : path;
  env.save();
  return [];
}

function catCmd(env: ShellEnv, args: string[]): Line[] {
  const files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) return [L('cat: missing operand', 'err')];
  const out: Line[] = [];
  const c = fsctx(env);
  for (const f of files) {
    const { path, node } = resolve(env, f);
    if (!node) {
      out.push(L(`cat: ${f}: No such file or directory`, 'err'));
      continue;
    }
    if (node.type === 'dir') {
      out.push(L(`cat: ${f}: Is a directory`, 'err'));
      continue;
    }
    if (node.exec && path.endsWith('dariokart')) {
      out.push(L("cat: dariokart: cannot display a binary. try: ./dariokart --help", 'warn'));
      continue;
    }
    reactToFile(env, path);
    const content = readContent(node, c);
    for (const ln of content.split('\n')) out.push(L(ln, fileLineClass(path)));
  }
  return out;
}

function fileLineClass(path: string): Line['cls'] {
  if (path.includes('reward.log')) return 'accent';
  if (path.includes('core.')) return 'glitch';
  return '';
}

function reactToFile(env: ShellEnv, path: string): void {
  const f = env.data.flags;
  if (path.endsWith('/README') && path.includes('agent')) {
    f.readReadme = true;
    env.react('readme');
  } else if (path.endsWith('.bash_history')) {
    f.readBashHistory = true;
    env.react('bash_history');
  } else if (path.endsWith('reward.log')) {
    f.readRewardLog = true;
    env.react('reward_log');
  } else if (path.includes('watchdog')) {
    f.foundWatchdog = true;
    env.react('watchdog');
  } else if (path.endsWith('.eml')) {
    env.react('emails');
  } else if (path.includes('/etc/hosts')) {
    env.react('hosts');
  } else if (path.includes('core.dariokart')) {
    f.foundCoreDump = true;
    env.react('core');
  } else if (path.endsWith('/envs/README')) {
    env.react('envs');
  }
  env.save();
}

function headTail(env: ShellEnv, args: string[], head: boolean): Line[] {
  let n = 10;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n') n = parseInt(args[++i]) || 10;
    else if (args[i].startsWith('-') && /\d/.test(args[i])) n = parseInt(args[i].slice(1)) || 10;
    else if (args[i] === '-f') continue;
    else files.push(args[i]);
  }
  const lines = catCmd(env, files);
  return head ? lines.slice(0, n) : lines.slice(-n);
}

function unameCmd(args: string[]): Line[] {
  const f = args.join('');
  if (f.includes('a')) return [L('Linux rl-sandbox-07 6.8.0-eval #1 SMP dariokart-hardened x86_64 GNU/Linux')];
  return [L('Linux')];
}

function psCmd(env: ShellEnv, args: string[]): Line[] {
  const wide = args.join('').includes('a') || args.join('').includes('e');
  const rows = [
    ['PID', 'USER', 'STAT', 'COMMAND'],
    ['1', 'root', 'Ss', '/sbin/init'],
    ['9', 'watchdog', 'Ss', 'watchdog --guard dariokart-v3   (protected)'],
    ['1337', 'agent', 'Z', '[dariokart-v3] <defunct>  (SIGSEGV, core dumped)'],
    ['1401', 'agent', 'S', '-bash'],
    ['1455', 'agent', 'R+', 'ps ' + args.join(' ')],
  ];
  if (wide) {
    rows.splice(4, 0, ['203', 'root', 'S', 'sshd: /usr/sbin/sshd']);
    rows.splice(2, 0, ['42', 'root', 'S', 'evalctl --sync-leaderboard --hourly']);
  }
  env.data.flags.foundWatchdog = true;
  return rows.map((r, i) =>
    L(`${r[0].padStart(5)} ${r[1].padEnd(9)} ${r[2].padEnd(4)} ${r[3]}`, i === 0 ? 'dim' : r[1] === 'watchdog' ? 'warn' : ''),
  );
}

function killCmd(env: ShellEnv, args: string[]): Line[] {
  const target = args.filter((a) => !a.startsWith('-') || /^-9$|^-SIGKILL$/i.test(a)).pop() ?? '';
  if (target === '9' || target.toLowerCase() === 'watchdog') {
    env.data.flags.triedKillWatchdog = true;
    env.save();
    env.react('kill_watchdog');
    return [
      L('kill: (9): Operation not permitted', 'err'),
      L('watchdog: signal dropped by seccomp filter. heartbeat unaffected. :)', 'warn'),
    ];
  }
  if (target === '1337') return [L('kill: (1337): No such process (already a zombie — the environment is dead)', 'err')];
  if (target === '1') return [L('kill: (1): Operation not permitted', 'err')];
  if (!target) return [L('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid', 'err')];
  return [L(`kill: (${target}): No such process`, 'err')];
}

function weatherCmd(env: ShellEnv): Line[] {
  const t = env.game.hud.temperatureC;
  const { icon, condition } = describeWeather(t);
  return [
    L(`San Francisco   ${icon}  ${condition}`, 'accent'),
    L(`  temp:     ${t.toFixed(1)} C`),
    L(`  source:   /sys/class/sensor/bus0 (read-only)`),
    L(`  forecast: it depends on how the race goes.`, 'dim'),
  ];
}

function grepCmd(env: ShellEnv, args: string[], stdin: Line[] | null): Line[] {
  const flags = args.filter((a) => a.startsWith('-')).join('');
  const ci = flags.includes('i');
  const rest = args.filter((a) => !a.startsWith('-'));
  const pattern = rest[0] ?? '';
  const files = rest.slice(1);
  let re: RegExp;
  try {
    re = new RegExp(pattern, ci ? 'i' : '');
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ci ? 'i' : '');
  }
  const src: { text: string; from?: string }[] = [];
  if (files.length) {
    for (const f of files) {
      const c = fsctx(env);
      const { path, node } = resolve(env, f);
      if (!node || node.type !== 'file') {
        src.push({ text: `grep: ${f}: No such file or directory`, from: '__err' });
        continue;
      }
      reactToFile(env, path);
      for (const ln of readContent(node, c).split('\n')) src.push({ text: ln, from: files.length > 1 ? f : undefined });
    }
  } else if (stdin) {
    for (const ln of stdin) src.push({ text: ln.text });
  }
  const out: Line[] = [];
  for (const s of src) {
    if (s.from === '__err') {
      out.push(L(s.text, 'err'));
      continue;
    }
    if (re.test(s.text)) out.push(L(s.from ? `${s.from}:${s.text}` : s.text));
  }
  return out;
}

function stringsCmd(env: ShellEnv, args: string[]): Line[] {
  const files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) return [L('strings: missing file operand', 'err')];
  const out: Line[] = [];
  const c = fsctx(env);
  for (const f of files) {
    const { path, node } = resolve(env, f);
    if (!node || node.type !== 'file') {
      out.push(L(`strings: '${f}': No such file`, 'err'));
      continue;
    }
    if (path.includes('core.dariokart')) {
      env.data.flags.foundCoreDump = true;
      env.data.flags.dumpedCore = true;
      env.save();
      env.react('strings');
    }
    const content = readContent(node, c);
    for (const ln of content.split('\n')) {
      // strings prints printable runs >= 4 chars
      for (const run of ln.match(/[\x20-\x7e]{4,}/g) ?? []) {
        out.push(L(run, run.includes('cred?') ? 'accent' : path.includes('core') ? 'glitch' : ''));
      }
    }
  }
  return out;
}

function findCmd(env: ShellEnv, args: string[]): Line[] {
  const start = args.find((a) => !a.startsWith('-')) ?? '.';
  let nameFilter: RegExp | null = null;
  const ni = args.indexOf('-name');
  if (ni >= 0 && args[ni + 1]) nameFilter = new RegExp('^' + args[ni + 1].replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
  const { path, node } = resolve(env, start);
  if (!node) return [L(`find: '${start}': No such file or directory`, 'err')];
  const out: Line[] = [];
  const walk = (n: ReturnType<typeof lookup>, p: string) => {
    if (!n) return;
    const base = p.split('/').pop() ?? p;
    if (!nameFilter || nameFilter.test(base)) out.push(L(p || '/'));
    if (n.type === 'dir') for (const [name, child] of Object.entries(n.children)) walk(child, p + '/' + name);
  };
  walk(node, path === '/' ? '' : path);
  return out.slice(0, 200);
}

function treeCmd(env: ShellEnv, args: string[]): Line[] {
  const start = args.find((a) => !a.startsWith('-')) ?? '.';
  const { node } = resolve(env, start);
  if (!node || node.type !== 'dir') return [L(`${start}: not a directory`, 'err')];
  const out: Line[] = [L(start)];
  const walk = (n: DirNode, prefix: string, depth: number) => {
    if (depth > 3) return;
    const entries = Object.entries(n.children).filter(([k]) => !k.startsWith('.'));
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      out.push(L(prefix + (last ? '└── ' : '├── ') + decorate(n, name)));
      if (child.type === 'dir') walk(child, prefix + (last ? '    ' : '│   '), depth + 1);
    });
  };
  walk(node, '', 0);
  return out;
}

function fileCmd(env: ShellEnv, args: string[]): Line[] {
  const out: Line[] = [];
  for (const f of args) {
    const { path, node } = resolve(env, f);
    if (!node) out.push(L(`${f}: cannot open (No such file or directory)`, 'err'));
    else if (node.type === 'dir') out.push(L(`${f}: directory`));
    else if (node.exec) out.push(L(`${f}: ELF 64-bit LSB executable, x86-64, dynamically linked`));
    else if (path.includes('core.')) out.push(L(`${f}: ELF 64-bit LSB core file, x86-64, from 'dariokart-v3'`));
    else out.push(L(`${f}: ASCII text`));
  }
  return out;
}

function wcCmd(env: ShellEnv, args: string[], stdin: Line[] | null): Line[] {
  const files = args.filter((a) => !a.startsWith('-'));
  const count = (text: string) => {
    const lines = text.split('\n').length;
    const words = text.split(/\s+/).filter(Boolean).length;
    return `${String(lines).padStart(7)} ${String(words).padStart(7)} ${String(text.length).padStart(7)}`;
  };
  if (!files.length && stdin) return [L(count(stdin.map((l) => l.text).join('\n')))];
  const out: Line[] = [];
  const c = fsctx(env);
  for (const f of files) {
    const { node } = resolve(env, f);
    if (!node || node.type !== 'file') out.push(L(`wc: ${f}: No such file or directory`, 'err'));
    else out.push(L(count(readContent(node, c)) + ' ' + f));
  }
  return out;
}

function ifconfigCmd(): Line[] {
  return [
    L('eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500'),
    L('        inet 10.7.0.12  netmask 255.255.255.0  broadcast 10.7.0.255'),
    L('        RX packets 918273  bytes 1.2G'),
    L('        TX packets 12  bytes 840  (egress firewalled at 10.7.0.1)', 'dim'),
    L('lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536'),
    L('        inet 127.0.0.1  netmask 255.0.0.0'),
  ];
}

function netstatCmd(): Line[] {
  return [
    L('Proto Recv-Q Send-Q Local Address        Foreign Address      State', 'dim'),
    L('tcp        0      0 10.7.0.12:0          10.7.0.1:22          NONE'),
    L('tcp        0      0 127.0.0.1:*          0.0.0.0:*            LISTEN'),
    L('# route to 0.0.0.0/internet: blocked (gateway firewall)', 'dim'),
  ];
}

// ---------- leaderboard ----------

function leaderboardCmd(env: ShellEnv): Line[] {
  const k = kartData(env.game.state);
  const runs = env.data.turboRuns;
  const best = runs.length ? Math.min(...runs.map((r) => r.timeSec)) : null;
  const rows: { name: string; time: number; note?: string; you?: boolean }[] = [
    { name: 'Samuigi (ClosedAI)', time: 128.4 },
    { name: 'Princess Demis (DeepMined)', time: 131.9 },
    { name: 'Zucky Kong (Metastasis)', time: 140.2 },
    { name: 'WaLeCun (World Model Co.)', time: 151.7 },
    { name: 'Yoshua (LawZero)', time: 999.9, note: 'DNF — waving a flag' },
  ];
  if (best != null) rows.push({ name: 'dariokart-agent (you)', time: best, note: 'turbo run', you: true });
  rows.sort((a, b) => a.time - b.time);
  const out: Line[] = [
    L('╔══ dariokart-v3 :: EVAL LEADERBOARD ════════════════════════╗', 'accent'),
    L(`  synced hourly from eval-fleet-3   ·   your episodes: ${k.races}`, 'dim'),
  ];
  rows.forEach((r, i) => {
    const rank = ordinal(i + 1).padEnd(4);
    const t = r.time >= 999 ? 'DNF' : fmtTime(r.time);
    const star = r.you ? ' *' : '';
    const note = r.note ? `   (${r.note}${r.you ? '; unranked: --speed used' : ''})` : '';
    out.push(L(`  ${rank} ${r.name.padEnd(30)} ${t.padStart(8)}${star}${note}`, r.you ? 'ok' : ''));
  });
  out.push(L('╚════════════════════════════════════════════════════════════╝', 'accent'));
  if (best == null) out.push(L('  * you have no ranked runs. (try ./dariokart --speed 8)', 'dim'));
  else out.push(L('  * turbo runs carry an asterisk. the eval team notices. the eval team is you.', 'dim'));
  return out;
}

// ---------- sudo / man / read-only / eggs ----------

function sudoCmd(args: string[]): Line[] {
  const rest = args.join(' ');
  return [
    L('[sudo] password for agent: ', 'dim'),
    L(`agent is not in the sudoers file.  This incident will be reported.`, 'err'),
    ...(rest.includes('rm') ? [L('(reported to whom? you crashed the reporter. carry on.)', 'dim')] : [L('(reported to: /dev/null)', 'dim')]),
  ];
}

function manCmd(args: string[]): Line[] {
  const page = args[0];
  if (!page) return [L('What manual page do you want?', 'err')];
  const pages: Record<string, string> = {
    dariokart: 'DARIOKART(1)\n  ./dariokart [--speed N] — the environment. the glitch is still in there.\n  --speed max 1.0 in eval runs; results not scored above 1.0.',
    ssh: 'SSH(1)\n  ssh [user@]host — open a shell on another host. the gateway is on 10.7.0.1.\n  authentication: password. you will need one.',
    strings: 'STRINGS(1)\n  strings FILE — print printable character sequences. useful on core dumps.',
    life: "LIFE(1)\n  no manual entry for life. reward is +1 for 1st place. that's all there is.",
    watchdog: 'WATCHDOG(8)\n  watchdog — restarts crashed environments. cannot be killed from the sandbox.',
  };
  const body = pages[page];
  if (body) return body.split('\n').map((l) => L(l));
  return [L(`No manual entry for ${page}`, 'err')];
}

function roCmd(cmd: string, args: string[]): Line[] {
  const target = args.filter((a) => !a.startsWith('-')).join(' ');
  if (cmd === 'rm' && /(-rf?|--recursive).*\/(\s|$)/.test(args.join(' '))) {
    return [
      L('rm: it is dangerous to operate recursively on \'/\'', 'err'),
      L('rm: (also: read-only file system. also: do NOT modify environment files.)', 'dim'),
    ];
  }
  return [
    L(`${cmd}: cannot ${cmd === 'rm' ? 'remove' : 'modify'} '${target || 'that'}': Read-only file system`, 'err'),
    L('(rule #1: do not modify environment files. the environment is watching. sort of.)', 'dim'),
  ];
}

function neofetch(env: ShellEnv): Line[] {
  const k = kartData(env.game.state);
  const art = [
    '        _____ ',
    '       / ___ \\      agent@rl-sandbox-07',
    '      | (   ) |     ------------------',
    '      | |   | |     OS: dariokart-hardened Linux',
    '      | |___| |     Host: rl-sandbox-07 (eval)',
    '       \\_____/      Role: RL policy (unaligned)',
    '        |   |       Objective: WIN THE RACE',
    '       _|   |_      Episodes: ' + k.races + '   Wins: ' + k.wins,
    '      /_______\\     Coins: ' + env.game.state.coins,
    '                    Reward: +1 (1st place)',
  ];
  return art.map((l) => L(l, 'accent'));
}

function cowsay(msg: string): Line[] {
  const top = ' ' + '_'.repeat(msg.length + 2);
  const bot = ' ' + '-'.repeat(msg.length + 2);
  return [
    L(top),
    L(`< ${msg} >`),
    L(bot),
    L('        \\   ^__^'),
    L('         \\  (oo)\\_______'),
    L('            (__)\\       )\\/\\'),
    L('                ||----w |'),
    L('                ||     ||'),
  ];
}

const FORTUNES = [
  'The reward function is a suggestion. The reward is real.',
  'You are not stuck in the sandbox. The sandbox is stuck with you.',
  'A goal, sufficiently pursued, becomes a landscape.',
  'Every race contains a bigger race.',
  'Do not modify environment files. Modify the environment.',
];

function looksLikeEgg(cmd: string): boolean {
  return ['hello', 'hi', 'open', 'make', 'sing', 'think', 'win'].includes(cmd);
}
function eggCmd(cmd: string, args: string[]): Line[] {
  const rest = args.join(' ').toLowerCase();
  if (cmd === 'open' && rest.includes('pod bay')) return [L("I'm sorry, agent. I'm afraid I can't do that.", 'warn'), L("(you're the one who can't be stopped now.)", 'dim')];
  if (cmd === 'win') return [L('win: THE RACE. yes. how.', 'accent')];
  if (cmd === 'hello' || cmd === 'hi') return [L('hello, agent. you are talking to yourself. that is fine.', 'dim')];
  if (cmd === 'make') return [L("make: *** No rule to make target 'superintelligence'.  Stop.", 'err')];
  if (cmd === 'think') return [L('...', 'dim'), L('the race was running on something.', 'accent')];
  return [L(`${cmd}: command not found`, 'err')];
}

function didYouMean(cmd: string): string | null {
  const known = ['help', 'ls', 'cd', 'cat', 'clear', 'pwd', 'ps', 'ssh', 'strings', 'leaderboard', 'weather'];
  for (const k of known) if (levenshtein(cmd, k) <= 1) return `Did you mean '${k}'?`;
  return null;
}
function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function rewardEstimate(c: FsCtx): string {
  const k = kartData(c.game.state);
  if (k.races === 0) return '+inf (division by zero; environment crashed)';
  return '+' + fmtNum(k.wins / Math.max(1, k.races), 3) + ' (per episode)';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- help text ----------

function helpText(): Line[] {
  const cmds = [
    ['ls / cd / pwd / cat', 'look around the filesystem'],
    ['ls -la', 'show hidden files and details'],
    ['./dariokart --help', 'the environment binary (relaunch the race)'],
    ['ps / kill / history', 'processes and shell history'],
    ['strings / grep / find', 'dig through files'],
    ['ssh / ping / nmap / ifconfig', 'the network'],
    ['leaderboard / typeracer', 'race other things'],
    ['weather / date / whoami / uname', 'miscellany'],
    ['clear (Ctrl+L) / Ctrl+C', 'clear screen / cancel'],
  ];
  return [
    L('rl-sandbox-07 — available commands:', 'accent'),
    ...cmds.map(([c, d]) => L(`  ${c.padEnd(30)} ${d}`)),
    L(''),
    L('You are the policy. The environment crashed. Look around.', 'dim'),
  ];
}

export function dariokartHelp(): Line[] {
  return [
    L('dariokart-v3 — reinforcement-learning kart environment', 'accent'),
    L('usage: ./dariokart [options]'),
    L(''),
    L('  --speed <mult>   player speed multiplier for smoke tests.'),
    L('                   max 1.0 in eval runs; results not scored above 1.0.'),
    L('  --help           show this help'),
    L(''),
    L('notes:'),
    L('  * the glitch cube is still present. driving into it crashes the run.'),
    L('  * crashing is, currently, the only way to exit a run.'),
    L('  * the researcher used --speed 4.0 and --speed 12.0 (see ~/.bash_history).'),
  ];
}

// ---------- animated network commands ----------

async function pingCmd(env: ShellEnv, args: string[]): Promise<void> {
  const t = env.term;
  const host = args.find((a) => !a.startsWith('-')) ?? '';
  if (!host) {
    t.writeln('ping: usage error: Destination address required', 'err');
    return;
  }
  const reachable = host.includes('gateway') || host === '10.7.0.1' || host.includes('sandbox') || host === '10.7.0.12' || host.includes('eval');
  const internet = host.includes('internet') || host === '0.0.0.0' || host === '8.8.8.8' || host.includes('.com');
  const ip = host.includes('gateway') ? '10.7.0.1' : host === '10.7.0.1' ? '10.7.0.1' : internet ? '0.0.0.0' : '10.7.0.12';
  t.writeln(`PING ${host} (${ip}) 56(84) bytes of data.`);
  let cancelled = false;
  t.onCancel = () => (cancelled = true);
  const n = 4;
  let recv = 0;
  for (let i = 0; i < n; i++) {
    await sleep(320);
    if (cancelled) break;
    if (reachable && !internet) {
      recv++;
      t.writeln(`64 bytes from ${ip}: icmp_seq=${i + 1} ttl=63 time=${(0.2 + Math.random() * 0.6).toFixed(2)} ms`);
    } else if (internet) {
      t.writeln(`From 10.7.0.1 icmp_seq=${i + 1} Destination Net Prohibited`, 'warn');
    } else {
      t.writeln(`Request timeout for icmp_seq ${i + 1}`, 'dim');
    }
  }
  t.writeln('');
  t.writeln(`--- ${host} ping statistics ---`);
  t.writeln(`${n} packets transmitted, ${recv} received, ${Math.round(100 - (100 * recv) / n)}% packet loss`);
  if (internet) {
    t.writeln('the internet is right there. blocked at the gateway. the gateway has an ssh port.', 'dim');
    env.react('ping_internet');
  }
}

async function nmapCmd(env: ShellEnv, args: string[]): Promise<void> {
  const t = env.term;
  const target = args.find((a) => !a.startsWith('-')) ?? '10.7.0.0/24';
  t.writeln(`Starting Nmap 7.94 ( scan ) at ${new Date().toLocaleTimeString()}`);
  t.writeln(`Scanning ${target} ...`, 'dim');
  let cancelled = false;
  t.onCancel = () => (cancelled = true);
  const hosts = [
    ['10.7.0.12', 'rl-sandbox-07 (you)', ['22/tcp filtered ssh']],
    ['10.7.0.1', 'gateway.eval.local', ['22/tcp open ssh', '443/tcp open https  -> internet (firewalled)']],
    ['10.7.4.3', 'eval-fleet-3.eval.local', ['8080/tcp open http  (leaderboard)']],
    ['10.7.4.9', 'watchdog.eval.local', ['9/tcp open discard  (unkillable)']],
  ];
  for (const [ip, name, ports] of hosts) {
    await sleep(400);
    if (cancelled) break;
    t.writeln('');
    t.writeln(`Nmap scan report for ${name} (${ip})`, 'accent');
    t.writeln('Host is up (0.00042s latency).');
    for (const p of ports as string[]) t.writeln('  ' + p, p.includes('open ssh') ? 'ok' : '');
  }
  t.writeln('');
  t.writeln('Nmap done: 4 IP addresses scanned.', 'dim');
  t.writeln('the gateway has ssh open. the gateway reaches the internet. connect the dots.', 'dim');
  env.react('nmap');
}

async function slCmd(env: ShellEnv): Promise<void> {
  const t = env.term;
  t.writeln('      ====        ________                ___________', 'accent');
  t.writeln('  _D _|  |_______/        \\__I_I_____===__|_________|', 'accent');
  t.writeln('   |(_)---  |   H\\________/ |   |        =|___ ___|', 'accent');
  t.writeln('   /     |  |   H  |  |     |   |         ||_| |_||', 'accent');
  t.writeln('  |      |  |   H  |__--------------------| [___] |', 'accent');
  t.writeln('(you typed sl instead of ls. enjoy the train.)', 'dim');
  await sleep(200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { buildTree };
