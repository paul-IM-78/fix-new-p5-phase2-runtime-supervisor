import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SECRET_PATH_PATTERN =
  /(^|[\\/])(\.env($|\.)|.*(secret|private|mnemonic|seed|keypair).*|.*\.(pem|p12|pfx|key|keystore))$/i;

const WATCHED_PORTS = [3000, 3010, 55721, 55722, 55723, 55724];

function exec(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).replace(/[\r\n]+$/, "");
  } catch (error) {
    if (options.allowFail) {
      return "";
    }
    throw error;
  }
}

function git(args, options = {}) {
  return exec("git", args, options);
}

function splitLines(value) {
  if (!value) {
    return [];
  }
  return value.split(/\r?\n/).filter(Boolean);
}

function getRepoRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}

function getGitDir(root) {
  const raw = git(["rev-parse", "--git-dir"]);
  if (raw.match(/^[A-Za-z]:[\\/]/) || raw.startsWith("/")) {
    return raw;
  }
  return join(root, raw);
}

function getStatusEntries() {
  return splitLines(git(["status", "--short"])).map((line) => ({
    code: line.slice(0, 2),
    path: line.slice(3),
    raw: line,
  }));
}

function countStatus(entries) {
  return entries.reduce(
    (counts, entry) => {
      const indexStatus = entry.code[0];
      const worktreeStatus = entry.code[1];

      if (entry.code === "??") {
        counts.untracked += 1;
      } else {
        if (indexStatus !== " ") {
          counts.staged += 1;
        }
        if (worktreeStatus !== " ") {
          counts.unstaged += 1;
        }
      }

      return counts;
    },
    { staged: 0, unstaged: 0, untracked: 0 },
  );
}

function getUpstream() {
  return git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    allowFail: true,
  });
}

function getAheadBehind(upstream) {
  if (!upstream) {
    return null;
  }

  const raw = git(["rev-list", "--left-right", "--count", "HEAD...@{u}"], {
    allowFail: true,
  });
  const [ahead, behind] = raw.split(/\s+/).map((value) => Number(value));

  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
    return null;
  }

  return { ahead, behind };
}

function getBlockingGitStates(gitDir) {
  const states = [
    ["merge", "MERGE_HEAD"],
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
    ["revert", "REVERT_HEAD"],
    ["bisect", "BISECT_LOG"],
  ];

  return states
    .filter(([, relativePath]) => existsSync(join(gitDir, relativePath)))
    .map(([name]) => name);
}

function getLocalEnvFiles(root) {
  const topLevelFiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  return topLevelFiles
    .filter((name) => {
      if (name === ".env.example") {
        return false;
      }
      return name === ".env" || name === ".env.local" || /^\.env\..*\.local$/i.test(name);
    })
    .sort();
}

function getSecretPathCandidates(entries) {
  return entries
    .map((entry) => entry.path)
    .filter((path) => SECRET_PATH_PATTERN.test(path))
    .sort();
}

function getListeningPorts() {
  if (process.platform !== "win32") {
    return [];
  }

  const output = exec("netstat", ["-ano", "-p", "tcp"], { allowFail: true });
  const lines = splitLines(output);

  return lines
    .map((line) => line.trim())
    .filter((line) => /\bLISTENING\b/i.test(line))
    .filter((line) => WATCHED_PORTS.some((port) => line.includes(`:${port} `)))
    .sort();
}

function formatAheadBehind(aheadBehind) {
  if (!aheadBehind) {
    return "not available";
  }
  return `ahead ${aheadBehind.ahead}, behind ${aheadBehind.behind}`;
}

function printList(title, values, emptyText = "none") {
  console.log(`${title}:`);
  if (values.length === 0) {
    console.log(`  ${emptyText}`);
    return;
  }
  values.forEach((value) => console.log(`  ${value}`));
}

export function printWorkflowReport(mode) {
  const root = getRepoRoot();
  const gitDir = getGitDir(root);
  const branch = git(["branch", "--show-current"]) || "(detached HEAD)";
  const head = git(["rev-parse", "HEAD"]);
  const upstream = getUpstream();
  const aheadBehind = getAheadBehind(upstream);
  const statusEntries = getStatusEntries();
  const statusCounts = countStatus(statusEntries);
  const blockingGitStates = getBlockingGitStates(gitDir);
  const localEnvFiles = getLocalEnvFiles(root);
  const secretPathCandidates = getSecretPathCandidates(statusEntries);
  const listeningPorts = getListeningPorts();

  console.log(`Git workflow check: ${mode}`);
  console.log(`Repository: ${root}`);
  console.log(`Machine: ${process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown"}`);
  console.log(`Branch: ${branch}`);
  console.log(`HEAD: ${head}`);
  console.log(`Upstream: ${upstream || "not configured"}`);
  console.log(`Sync: ${formatAheadBehind(aheadBehind)}`);
  console.log(
    `Working tree: ${
      statusEntries.length === 0 ? "clean" : `dirty (${statusEntries.length} paths)`
    }`,
  );
  console.log(
    `Status counts: staged ${statusCounts.staged}, unstaged ${statusCounts.unstaged}, untracked ${statusCounts.untracked}`,
  );

  printList("Blocking Git operations", blockingGitStates);
  printList(
    "Changed paths",
    statusEntries.map((entry) => entry.raw),
  );
  printList("Local env files present", localEnvFiles);
  printList("Secret-like changed path candidates", secretPathCandidates);
  printList("Watched local TCP listeners", listeningPorts);

  console.log("Script actions: read-only; no files, Git refs, packages, database, or environment were changed.");

  if (mode === "start") {
    console.log("Next: resolve blockers before editing; keep existing dirty files scoped to the active task.");
  } else if (mode === "end") {
    console.log("Next: verify the task, review diffs, and wait for explicit commit or push approval.");
  } else if (mode === "handoff") {
    console.log("Next: stage only task files, re-check staged paths and secrets, then commit and push only when allowed.");
  }

  return blockingGitStates.length > 0 ? 2 : 0;
}
