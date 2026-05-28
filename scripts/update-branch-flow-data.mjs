import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const config = {
  repo: process.env.TARGET_REPO || "scriptscat/scriptcat",
  mainBranch: process.env.MAIN_BRANCH || "main",
  releaseBranch: process.env.RELEASE_BRANCH || "release/v1.4",
  mainLimit: clamp(Number(process.env.MAIN_LIMIT) || 160, 20, 400),
  betaStopMarker: process.env.BETA_STOP_MARKER || "Merge branch 'main' into release/v1.3",
  betaMaxCommits: clamp(Number(process.env.BETA_MAX_COMMITS) || 900, 100, 1000),
  previousContextLimit: clamp(Number(process.env.PREVIOUS_CONTEXT_LIMIT) || 80, 0, 200),
  outputPath: process.env.OUTPUT_PATH || "data/branch-flow.json",
};

const [mainCommits, betaHistory, mainAhead, releaseAhead] = await Promise.all([
  fetchCommits(config.repo, config.mainBranch, config.mainLimit),
  fetchBetaHistory(
    config.repo,
    config.releaseBranch,
    config.betaStopMarker,
    config.betaMaxCommits,
    config.previousContextLimit,
  ),
  fetchCompare(config.repo, config.releaseBranch, config.mainBranch),
  fetchCompare(config.repo, config.mainBranch, config.releaseBranch),
]);

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: {
    repo: config.repo,
    mainBranch: config.mainBranch,
    releaseBranch: config.releaseBranch,
    mainLimit: config.mainLimit,
    betaStopMarker: config.betaStopMarker,
    betaMaxCommits: config.betaMaxCommits,
    previousContextLimit: config.previousContextLimit,
  },
  mainCommits,
  betaCommits: betaHistory.commits,
  pendingShas: mainAhead.commits.map((commit) => commit.sha),
  betaOnlyShas: releaseAhead.commits.map((commit) => commit.sha),
  previousBetaShas: betaHistory.previousCommits.map((commit) => commit.sha),
  mergeBaseSha: mainAhead.mergeBaseSha || releaseAhead.mergeBaseSha || "",
  betaStopFound: betaHistory.stopFound,
  previousBetaBranch: extractPreviousBetaBranch(config.betaStopMarker),
};

await mkdir(dirname(config.outputPath), { recursive: true });
await writeFile(config.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${config.outputPath} at ${snapshot.generatedAt}`);

async function fetchCompare(repo, base, head) {
  const commits = [];
  let mergeBaseSha = "";
  let page = 1;

  while (page <= 10) {
    const data = await githubJson(
      `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`,
    );
    mergeBaseSha ||= data.merge_base_commit?.sha || "";
    commits.push(...(data.commits || []));

    if (!data.commits || data.commits.length < 100) break;
    page += 1;
  }

  return { commits: commits.map(normalizeCommit), mergeBaseSha };
}

async function fetchCommits(repo, branch, limit) {
  const commits = [];
  let page = 1;

  while (commits.length < limit && page <= 4) {
    const data = await githubJson(
      `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100&page=${page}`,
    );
    commits.push(...data);
    if (!Array.isArray(data) || data.length < 100) break;
    page += 1;
  }

  return commits.slice(0, limit).map(normalizeCommit);
}

async function fetchBetaHistory(repo, branch, stopMarker, maxCommits, previousContextLimit) {
  const commits = [];
  const previousCommits = [];
  let page = 1;
  let stopFound = false;
  let previousContextCount = 0;
  const normalizedStop = stopMarker.toLowerCase();

  while (commits.length < maxCommits && page <= Math.ceil(maxCommits / 100)) {
    const data = await githubJson(
      `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=100&page=${page}`,
    );

    for (const item of data) {
      const commit = normalizeCommit(item);
      commits.push(commit);

      if (stopFound) {
        previousCommits.push(commit);
        previousContextCount += 1;
      } else if (normalizedStop && commit.title.toLowerCase().includes(normalizedStop)) {
        stopFound = true;
        previousCommits.push(commit);
      }

      if (stopFound && previousContextCount >= previousContextLimit) break;
      if (commits.length >= maxCommits) break;
    }

    if (
      (stopFound && previousContextCount >= previousContextLimit) ||
      !Array.isArray(data) ||
      data.length < 100
    ) {
      break;
    }
    page += 1;
  }

  return { commits, previousCommits, stopFound };
}

async function githubJson(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com${path}`, { headers });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.message || `${response.status} ${response.statusText}`;
    throw new Error(`GitHub API error for ${path}: ${message}`);
  }

  return data;
}

function normalizeCommit(item) {
  const commit = item.commit || {};
  const author = commit.author || item.author || {};
  const message = commit.message || "";

  return {
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    title: message.split("\n")[0] || "(no subject)",
    author: author.name || item.author?.login || "unknown",
    date: author.date || commit.committer?.date || "",
    url: item.html_url,
  };
}

function extractPreviousBetaBranch(marker) {
  const intoMatch = marker.match(/\binto\s+([^\s'"]+)/i);
  if (intoMatch) return intoMatch[1];

  const branchMatch = marker.match(/\brelease\/v?\d+(?:\.\d+)*/i);
  return branchMatch ? branchMatch[0] : "previous beta";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
