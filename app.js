const els = {
  form: document.querySelector("#controls"),
  repo: document.querySelector("#repo"),
  mainBranch: document.querySelector("#mainBranch"),
  releaseBranch: document.querySelector("#releaseBranch"),
  mainLimit: document.querySelector("#mainLimit"),
  betaStop: document.querySelector("#betaStop"),
  status: document.querySelector("#status"),
  search: document.querySelector("#search"),
  graph: document.querySelector("#graph"),
  mainList: document.querySelector("#mainList"),
  releaseList: document.querySelector("#releaseList"),
  mergedCount: document.querySelector("#mergedCount"),
  pendingCount: document.querySelector("#pendingCount"),
  releaseOnlyCount: document.querySelector("#releaseOnlyCount"),
  mergeBase: document.querySelector("#mergeBase"),
  mainSubtitle: document.querySelector("#mainSubtitle"),
  releaseSubtitle: document.querySelector("#releaseSubtitle"),
  template: document.querySelector("#commitTemplate"),
};

const DATA_URL = "data/branch-flow.json";

let state = {
  mainCommits: [],
  betaCommits: [],
  pendingShas: new Set(),
  betaOnlyShas: new Set(),
  previousBetaShas: new Set(),
  mergeBaseSha: "",
  mainBranch: "main",
  releaseBranch: "release/v1.4",
  betaStopMarker: "Merge branch 'main' into release/v1.3",
  betaStopFound: false,
  previousBetaBranch: "release/v1.3",
  query: "",
  generatedAt: null,
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  refresh().catch((error) => {
    setStatus(error.message || "Could not load comparison.");
    els.form.querySelector("button").disabled = false;
  });
});

els.search.addEventListener("input", () => {
  state.query = els.search.value.trim().toLowerCase();
  render();
});

refresh().catch((error) => setStatus(error.message || "Could not load comparison."));

async function refresh() {
  try {
    els.form.querySelector("button").disabled = true;
    setStatus("Loading saved branch data...");

    const snapshot = await fetchSnapshot();
    const source = snapshot.source || {};
    const mainBranch = source.mainBranch || "main";
    const releaseBranch = source.releaseBranch || "release/v1.4";
    const betaStopMarker = source.betaStopMarker || "";

    state = {
      mainCommits: snapshot.mainCommits,
      betaCommits: snapshot.betaCommits,
      pendingShas: new Set(snapshot.pendingShas),
      betaOnlyShas: new Set(snapshot.betaOnlyShas),
      previousBetaShas: new Set(snapshot.previousBetaShas),
      mergeBaseSha: snapshot.mergeBaseSha || "",
      mainBranch,
      releaseBranch,
      betaStopMarker,
      betaStopFound: Boolean(snapshot.betaStopFound),
      previousBetaBranch: snapshot.previousBetaBranch || extractPreviousBetaBranch(betaStopMarker),
      query: els.search.value.trim().toLowerCase(),
      generatedAt: snapshot.generatedAt,
    };

    syncControls(source);
    els.mainSubtitle.textContent = `${mainBranch} newest ${state.mainCommits.length} commits`;
    els.releaseSubtitle.textContent = state.betaStopFound
      ? `${releaseBranch} history through "${betaStopMarker}" plus previous-cycle context`
      : `${releaseBranch} newest ${state.betaCommits.length} commits`;
    setStatus(statusForSnapshot(snapshot));
    render();
  } finally {
    els.form.querySelector("button").disabled = false;
  }
}

async function fetchSnapshot() {
  const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Could not load saved branch data: ${response.status} ${response.statusText}`);
  }
  validateSnapshot(data);
  return data;
}

function validateSnapshot(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Saved branch data is not valid JSON.");
  }

  const arrayFields = ["mainCommits", "betaCommits", "pendingShas", "betaOnlyShas", "previousBetaShas"];
  for (const field of arrayFields) {
    if (!Array.isArray(data[field])) {
      throw new Error(`Saved branch data is missing ${field}.`);
    }
  }
}

function syncControls(source) {
  els.repo.value = source.repo || "";
  els.mainBranch.value = source.mainBranch || "";
  els.releaseBranch.value = source.releaseBranch || "";
  els.mainLimit.value = source.mainLimit || "";
  els.betaStop.value = source.betaStopMarker || "";
}

function statusForSnapshot(snapshot) {
  if (!snapshot.generatedAt) {
    return "Saved data has not been generated yet. Run the GitHub Action to populate it.";
  }

  return `Loaded saved data generated ${new Date(snapshot.generatedAt).toLocaleString()}.`;
}

function render() {
  const mainRows = state.mainCommits.map((commit) => ({
    ...commit,
    kind: state.pendingShas.has(commit.sha) ? "pending" : "merged",
  }));
  const betaRows = state.betaCommits.map((commit) => ({
    ...commit,
    kind: classifyBetaCommit(commit),
  }));

  const filteredMain = mainRows.filter(matchesQuery);
  const filteredBeta = betaRows.filter(matchesQuery);
  const mergedCount = mainRows.filter((commit) => commit.kind === "merged").length;
  const pendingCount = mainRows.length - mergedCount;
  const betaOnlyCount = betaRows.filter((commit) => commit.kind === "release").length;

  els.mergedCount.textContent = String(mergedCount);
  els.pendingCount.textContent = String(pendingCount);
  els.releaseOnlyCount.textContent = String(betaOnlyCount);
  els.mergeBase.textContent = state.mergeBaseSha ? state.mergeBaseSha.slice(0, 7) : "-";

  renderCommitList(els.mainList, filteredMain);
  renderCommitList(els.releaseList, filteredBeta);
  renderGraph(filteredMain.slice(0, 36), filteredBeta.slice(0, 36));
}

function matchesQuery(commit) {
  if (!state.query) return true;
  return `${commit.sha} ${commit.title} ${commit.author}`.toLowerCase().includes(state.query);
}

function classifyBetaCommit(commit) {
  if (state.previousBetaShas.has(commit.sha)) return "previous";
  return state.betaOnlyShas.has(commit.sha) ? "release" : "merged";
}

function renderCommitList(container, commits) {
  container.replaceChildren();

  if (!commits.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No commits match this view.";
    container.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const commit of commits) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.href = commit.url;
    node.querySelector(".state").className = `state ${commit.kind}`;
    node.querySelector("strong").textContent = commit.title;
    node.querySelector(".meta").textContent =
      `${commit.shortSha} - ${commit.author} - ${formatDate(commit.date)} - ${labelFor(commit.kind)}`;
    const badge = node.querySelector(".badge");
    badge.className = `badge ${commit.kind}`;
    badge.textContent = badgeFor(commit.kind);
    fragment.append(node);
  }
  container.append(fragment);
}

function renderGraph(mainRows, releaseRows) {
  const rowGap = 42;
  const top = 92;
  const maxRows = Math.max(mainRows.length, releaseRows.length, 1);
  const height = Math.max(360, top + maxRows * rowGap + 96);
  const width = 1180;
  const mainLane = { x: 44, y: 58, width: 500, height: height - 116 };
  const releaseLane = { x: 636, y: 58, width: 500, height: height - 116 };
  const mainRailX = mainLane.x + 30;
  const releaseRailX = releaseLane.x + 30;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Commit lanes for stable and beta branches");

  addDefs(svg);
  addLane(svg, mainLane, "main-lane");
  addLane(svg, releaseLane, "release-lane");
  addText(svg, mainLane.x, 30, state.mainBranch, "lane-heading");
  addText(svg, mainLane.x + 86, 30, `${mainRows.length} shown`, "lane-count");
  addText(svg, releaseLane.x, 30, state.releaseBranch, "lane-heading");
  addText(svg, releaseLane.x + 132, 30, `${releaseRows.length} shown`, "lane-count");

  addLine(svg, mainRailX, top - 20, mainRailX, height - 74, "graph-line main");
  addLine(svg, releaseRailX, top - 20, releaseRailX, height - 74, "graph-line release");

  const pendingRows = mainRows.filter((commit) => commit.kind === "pending").length;
  if (pendingRows) {
    addText(svg, 558, 52, "stable-only", "connector-label");
  }

  mainRows.forEach((commit, index) => {
    const y = top + index * rowGap;
    addCircle(svg, mainRailX, y, commit.kind);
    addCommitCard(svg, mainLane.x + 52, y - 17, 410, commit);
    if (commit.kind === "pending") {
      addBridge(svg, mainLane.x + 472, y, releaseLane.x - 20, y);
    }
  });

  releaseRows.forEach((commit, index) => {
    const y = top + index * rowGap;
    addCircle(svg, releaseRailX, y, commit.kind);
    addCommitCard(svg, releaseLane.x + 52, y - 17, 410, commit);
  });

  addMergeBase(svg, width / 2, height - 44);
  addText(svg, 44, height - 18, graphNote(), "graph-note");

  els.graph.replaceChildren(svg);
}

function addDefs(svg) {
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow-pending" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#9ba6b7"></path>
    </marker>
  `;
  svg.append(defs);
}

function addLane(svg, lane, className) {
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", lane.x);
  rect.setAttribute("y", lane.y);
  rect.setAttribute("width", lane.width);
  rect.setAttribute("height", lane.height);
  rect.setAttribute("rx", 14);
  rect.setAttribute("class", `lane-bg ${className}`);
  svg.append(rect);
}

function addCommitCard(svg, x, y, width, commit) {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", `commit-card ${commit.kind}`);

  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width", width);
  rect.setAttribute("height", 34);
  rect.setAttribute("rx", 8);
  rect.setAttribute("class", "commit-card-bg");
  group.append(rect);

  const stripe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  stripe.setAttribute("x", x);
  stripe.setAttribute("y", y);
  stripe.setAttribute("width", 4);
  stripe.setAttribute("height", 34);
  stripe.setAttribute("rx", 2);
  stripe.setAttribute("class", "commit-card-stripe");
  group.append(stripe);

  addText(group, x + 14, y + 14, commit.shortSha, "commit-sha");
  addText(group, x + 84, y + 14, truncate(commit.title, 46), "commit-title");
  addText(group, x + 14, y + 27, `${commit.author} - ${formatDate(commit.date)}`, "commit-subtitle");
  addText(group, x + width - 74, y + 27, badgeFor(commit.kind), "commit-track");

  svg.append(group);
}

function addMergeBase(svg, x, y) {
  addLine(svg, x - 190, y, x + 190, y, "merge-base-line");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", x);
  circle.setAttribute("cy", y);
  circle.setAttribute("r", 9);
  circle.setAttribute("class", "merge-base-node");
  svg.append(circle);
  addText(svg, x + 18, y + 4, `merge base ${state.mergeBaseSha ? state.mergeBaseSha.slice(0, 7) : "-"}`, "merge-base-text");
}

function addCircle(svg, x, y, kind) {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", x);
  circle.setAttribute("cy", y);
  circle.setAttribute("r", 8);
  circle.setAttribute("class", `node ${kind}`);
  svg.append(circle);
}

function addLine(svg, x1, y1, x2, y2, className) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x2);
  line.setAttribute("y2", y2);
  line.setAttribute("class", className);
  svg.append(line);
}

function addBridge(svg, x1, y1, x2, y2) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const mid = x1 + (x2 - x1) / 2;
  path.setAttribute("d", `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
  path.setAttribute("class", "bridge");
  path.setAttribute("marker-end", "url(#arrow-pending)");
  svg.append(path);
}

function addText(svg, x, y, text, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.setAttribute("class", className);
  node.textContent = text;
  svg.append(node);
}

function formatDate(value) {
  if (!value) return "unknown date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function labelFor(kind) {
  if (kind === "pending") return "stable-only";
  if (kind === "release") return "beta-only";
  if (kind === "previous") return `${previousBetaLabel()} beta`;
  return "shared with beta";
}

function graphNote() {
  const stop = state.betaStopMarker
    ? state.betaStopFound
      ? `Previous-cycle context starts at "${state.betaStopMarker}".`
      : `Stop marker "${state.betaStopMarker}" was not found in the loaded beta history.`
    : "Beta history uses the newest loaded commits.";
  return `Stable = main 1.3.x. Beta = ${state.releaseBranch} 1.4.x. ${stop}`;
}

function badgeFor(kind) {
  if (kind === "pending") return "stable";
  if (kind === "release") return "beta";
  if (kind === "previous") return previousBetaLabel();
  return "shared";
}

function previousBetaLabel() {
  const match = state.previousBetaBranch.match(/v?(\d+(?:\.\d+)+)$/);
  return match ? `${match[1]} beta` : "prev beta";
}

function extractPreviousBetaBranch(marker) {
  const intoMatch = marker.match(/\binto\s+([^\s'"]+)/i);
  if (intoMatch) return intoMatch[1];

  const branchMatch = marker.match(/\brelease\/v?\d+(?:\.\d+)*/i);
  return branchMatch ? branchMatch[0] : "previous beta";
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  els.status.textContent = message;
}
