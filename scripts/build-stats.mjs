// Builds the profile stat cards in assets/ and the data table in README.md.
// Counts personal AND organization repos: everything comes from the viewer's
// contributionsCollection, so any repo you committed to is included.
//
// Needs a token with `repo` + `read:org` (env GH_TOKEN), otherwise private
// and org contributions are invisible.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("Set GH_TOKEN (a PAT with repo + read:org)");

const RECENT_DAYS = 90;
const TOP_LANGS = 6;
const MAX_HISTORY_PAGES = 10; // per repo, 100 commits each
// Languages that are build/config noise rather than something you "write".
const IGNORED_LANGS = new Set(["Makefile", "Dockerfile", "Procfile", "Batchfile"]);

// Agents are matched against commit trailers and footers. Color follows the
// agent, never its rank, so each has a fixed slot; anything else is "Other".
const AGENTS = [
  { name: "Claude Code", slot: 1, re: /co-authored-by:[^\n]*(claude|anthropic)|generated with \[?claude code/i },
  { name: "GitHub Copilot", slot: 2, re: /co-authored-by:[^\n]*copilot/i },
  { name: "Codex", slot: 3, re: /co-authored-by:[^\n]*(codex|openai|chatgpt)/i },
  { name: "Cursor", slot: 4, re: /co-authored-by:[^\n]*cursor/i },
  { name: "Other", slot: 0, re: /co-authored-by:[^\n]*(gemini|jules|devin|aider|windsurf|amp|opencode|cline|roo)|^aider:/im },
];

// Tokyonight, the editor theme: Moon for dark, Day for light. Series hues are
// stepped from the theme's own and validated (dataviz skill) on each surface.
const THEMES = {
  light: {
    surface: "#e1e2e7", status: "#d0d5e3", border: "#c4c8da", grid: "#c4c8da", base: "#a8aecb",
    ink: "#3760bf", ink2: "#6172b0", muted: "#6172b0", onAccent: "#e1e2e7",
    series: ["#a8aecb", "#2e7de9", "#b15c00", "#118c74", "#9854f1"],
    seqA: "#2e7de9", seqB: "#b15c00", deemph: "#92a6d5",
  },
  dark: {
    surface: "#222436", status: "#1e2030", border: "#2f334d", grid: "#2f334d", base: "#3b4261",
    ink: "#c8d3f5", ink2: "#828bb8", muted: "#737aa2", onAccent: "#1e2030",
    series: ["#545c7e", "#5f8af5", "#dc6a3c", "#1a9e86", "#9a72e6"],
    seqA: "#5f8af5", seqB: "#dc6a3c", deemph: "#394b70",
  },
};

// ---------------------------------------------------------------- GitHub API

async function gql(query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !body.errors) return body.data;
    if (attempt >= 2) throw new Error(`GraphQL: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

const REPO_FIELDS = `
  nameWithOwner isFork
  owner { login __typename }
  languages(first: 20, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }`;

// Commits plus pull requests per repo. PRs matter for repos you don't own:
// work there often isn't on the default branch, so it never counts as a commit.
async function contributionsByRepo(from, to) {
  const d = await gql(
    `query($from: DateTime!, $to: DateTime!) { viewer { contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) { contributions { totalCount } repository { ${REPO_FIELDS} } }
      pullRequestContributionsByRepository(maxRepositories: 100) { contributions { totalCount } repository { ${REPO_FIELDS} } }
    } } }`,
    { from: from.toISOString(), to: to.toISOString() },
  );
  const { commitContributionsByRepository: commits, pullRequestContributionsByRepository: prs } = d.viewer.contributionsCollection;
  const byRepo = new Map();
  for (const e of [...commits, ...prs]) {
    const prev = byRepo.get(e.repository.nameWithOwner);
    if (!prev || prev.contributions.totalCount < e.contributions.totalCount) byRepo.set(e.repository.nameWithOwner, e);
  }
  return [...byRepo.values()];
}

// Language weight = repo's language share × your commits in that repo, so a
// huge org monorepo you touched once doesn't drown out your own work.
function weighLanguages(entries, into = new Map()) {
  for (const { contributions, repository } of entries) {
    const edges = repository.languages.edges.filter((e) => !IGNORED_LANGS.has(e.node.name));
    const total = edges.reduce((s, e) => s + e.size, 0);
    if (!total) continue;
    for (const e of edges) {
      into.set(e.node.name, (into.get(e.node.name) ?? 0) + (e.size / total) * contributions.totalCount);
    }
  }
  return into;
}

function topShares(map, n) {
  const sorted = [...map].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const head = sorted.slice(0, n).map(([name, v]) => ({ name, share: v / total }));
  const rest = sorted.slice(n).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) head.push({ name: "Other", share: rest / total, other: true });
  return head;
}

async function agentUsage(userId, repos, since) {
  const counts = new Map();
  let total = 0;
  for (const nameWithOwner of repos) {
    const [owner, name] = nameWithOwner.split("/");
    let after = null;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const d = await gql(
        `query($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp!, $after: String) {
          repository(owner: $owner, name: $name) { defaultBranchRef { target { ... on Commit {
            history(first: 100, after: $after, since: $since, author: { id: $author }) {
              pageInfo { hasNextPage endCursor } nodes { message }
            } } } } } }`,
        { owner, name, author: userId, since: since.toISOString(), after },
      ).catch(() => null);
      const history = d?.repository?.defaultBranchRef?.target?.history;
      if (!history) break;
      for (const { message } of history.nodes) {
        total++;
        const agent = AGENTS.find((a) => a.re.test(message));
        if (agent) counts.set(agent.name, (counts.get(agent.name) ?? 0) + 1);
      }
      if (!history.pageInfo.hasNextPage) break;
      after = history.pageInfo.endCursor;
    }
  }
  const agents = AGENTS.filter((a) => counts.get(a.name))
    .map((a) => ({ name: a.name, slot: a.slot, commits: counts.get(a.name) }))
    .sort((a, b) => (a.slot === 0) - (b.slot === 0) || b.commits - a.commits);
  return { agents, assisted: agents.reduce((s, a) => s + a.commits, 0), total };
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) {
    run = d.contributionCount ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today not having a contribution yet shouldn't break the current streak.
  let current = 0;
  const rev = [...days].reverse();
  if (rev[0] && !rev[0].contributionCount) rev.shift();
  for (const d of rev) { if (!d.contributionCount) break; current++; }
  return { longest, current };
}

async function collect() {
  const now = new Date();
  const yearAgo = new Date(now); yearAgo.setFullYear(now.getFullYear() - 1);
  const recentFrom = new Date(now.getTime() - RECENT_DAYS * 864e5);

  const { viewer } = await gql(`{ viewer { login id createdAt contributionsCollection {
    totalCommitContributions totalPullRequestContributions totalPullRequestReviewContributions
    restrictedContributionsCount
    contributionCalendar { totalContributions weeks { contributionDays { contributionCount date } } }
  } } }`);
  const cc = viewer.contributionsCollection;

  // contributionsCollection spans at most one year, so walk back to sign-up.
  const allTime = new Map();
  const lastYearRepos = await contributionsByRepo(yearAgo, now);
  weighLanguages(lastYearRepos, allTime);
  for (let to = yearAgo; to > new Date(viewer.createdAt); ) {
    const from = new Date(to); from.setFullYear(to.getFullYear() - 1);
    weighLanguages(await contributionsByRepo(from < new Date(viewer.createdAt) ? new Date(viewer.createdAt) : from, to), allTime);
    to = from;
  }
  const recent = weighLanguages(await contributionsByRepo(recentFrom, now));

  const outside = lastYearRepos.filter((r) => r.repository.owner.login !== viewer.login);
  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const weeks = cc.contributionCalendar.weeks.map((w) => ({
    start: w.contributionDays[0].date,
    count: w.contributionDays.reduce((s, d) => s + d.contributionCount, 0),
  }));

  return {
    login: viewer.login,
    updated: now.toISOString().slice(0, 10),
    contributions: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    private: cc.restrictedContributionsCount,
    prs: cc.totalPullRequestContributions,
    reviews: cc.totalPullRequestReviewContributions,
    reposTotal: lastYearRepos.length,
    outsideRepos: outside.length,
    owners: [...new Set(outside.map((r) => r.repository.owner.login))].sort(),
    weeks,
    ...streaks(days),
    allTime: topShares(allTime, TOP_LANGS),
    recent: topShares(recent, TOP_LANGS),
    agents: await agentUsage(viewer.id, lastYearRepos.map((r) => r.repository.nameWithOwner), yearAgo),
  };
}

// ---------------------------------------------------------------- SVG

const W = 840;
const PAD = 28;
const FONT = `'JetBrains Mono', 'Cascadia Code', 'SF Mono', ui-monospace, Menlo, Consolas, monospace`;
const CH = 0.6; // monospace advance, in em
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : n.toLocaleString("en-US"));
const pct = (x) => (x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`);
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;
const longDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const b = (s) => `<tspan class="n">${s}</tspan>`;

// Every card is a Neovim window: the content, then a lualine-style statusline
// with the command block on the left and the update date on the right.
function frame(t, h, cmd, title, updated, body) {
  const sh = 30, sy = h - sh, blockW = PAD + (cmd.length + 2) * 12 * CH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}">
<style>text{font-family:${FONT};font-size:14px;fill:${t.ink}}.h{font-size:20px}.n{font-weight:700}.s{fill:${t.ink2}}.m{font-size:12px;fill:${t.muted}}.c{font-size:12px;font-weight:700;fill:${t.onAccent}}</style>
<defs><clipPath id="w"><rect width="${W}" height="${h}" rx="10"/></clipPath></defs>
<g clip-path="url(#w)">
<rect width="${W}" height="${h}" fill="${t.surface}"/>
<rect y="${sy}" width="${W}" height="${sh}" fill="${t.status}"/>
<path d="M0 ${sy}h${blockW}l12 ${sh / 2}l-12 ${sh / 2}h-${blockW}z" fill="${t.seqA}"/>
<text x="${PAD}" y="${sy + 19.5}" class="c">:${cmd}</text>
<text x="${blockW + 28}" y="${sy + 19.5}" class="m">github.com/Sumedhbhat</text>
<text x="${W - PAD}" y="${sy + 19.5}" class="m" text-anchor="end">updated ${longDate(updated)}</text>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="10" fill="none" stroke="${t.border}"/>
${body}
</svg>`;
}

// Bar with a 4px rounded data-end and a square baseline end.
function hbar(x, y, w, h, fill) {
  if (w <= 0) return "";
  const r = Math.min(4, w);
  return `<path d="M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z" fill="${fill}"/>`;
}
function vbar(x, base, w, h, fill) {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `<path d="M${x} ${base}v-${h - r}a${r} ${r} 0 0 1 ${r} -${r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z" fill="${fill}"/>`;
}

function overviewSvg(d, t) {
  let body = `<text x="${PAD}" y="48" class="h">${b(fmt(d.contributions))} contributions across ${b(d.reposTotal)} repos this year</text>`;
  const facts = [plural(d.commits, "commit"), plural(d.prs, "pull request"), plural(d.reviews, "review")];
  if (d.private) facts.push(`${fmt(d.private)} private`);
  body += `<text x="${PAD}" y="78" class="s">${facts.join(", ")}.</text>`;
  const outside = d.outsideRepos
    ? `${plural(d.outsideRepos, "repo")} owned by ${d.owners.join(" and ")}. `
    : "";
  body += `<text x="${PAD}" y="100" class="s">${esc(outside)}Current streak ${d.current} days, best ${d.longest}.</text>`;

  // Weekly contributions; the busiest week carries the accent.
  const top = 148, ch = 76, base = top + ch, left = PAD, right = W - PAD;
  const n = d.weeks.length, slot = (right - left) / n, bw = Math.min(24, slot - 2);
  const max = Math.max(1, ...d.weeks.map((w) => w.count));
  const peak = d.weeks.findIndex((w) => w.count === max);
  body += `<line x1="${left}" y1="${top}" x2="${right}" y2="${top}" stroke="${t.grid}"/>`;
  d.weeks.forEach((w, i) => {
    body += vbar(left + i * slot + (slot - bw) / 2, base, bw, (w.count / max) * ch, i === peak ? t.seqA : t.deemph);
  });
  body += `<line x1="${left}" y1="${base}" x2="${right}" y2="${base}" stroke="${t.base}"/>`;
  // Label each month where it starts, skipping any that would touch the previous label.
  let lastMonth = "", lastX = -Infinity;
  d.weeks.forEach((w, i) => {
    const m = new Date(w.start + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const x = left + i * slot;
    if (m !== lastMonth && i < n - 2 && x - lastX > 40) {
      body += `<text x="${x}" y="${base + 18}" class="m">${m}</text>`;
      lastX = x;
    }
    lastMonth = m;
  });
  const px = left + peak * slot + slot / 2, anchor = px > right - 100 ? "end" : px < left + 100 ? "start" : "middle";
  body += `<text x="${anchor === "end" ? right : anchor === "start" ? left : px}" y="${top - 8}" class="m" text-anchor="${anchor}">busiest week, ${fmt(max)}</text>`;
  return frame(t, 284, "activity", "Contribution activity", d.updated, body);
}

function langPanel(x, w, title, sub, rows, color, t) {
  let s = `<text x="${x}" y="46" class="n">${title}</text><text x="${x}" y="68" class="m">${sub}</text>`;
  const labelW = 12 * 14 * CH, valueW = 56, barMax = w - labelW - valueW;
  const max = Math.max(...rows.map((r) => r.share), 0.0001);
  rows.forEach((r, i) => {
    const y = 92 + i * 28, bw = Math.max(2, (r.share / max) * barMax);
    s += `<text x="${x}" y="${y + 12}" class="s">${esc(r.name)}</text>`;
    s += hbar(x + labelW, y + 1, bw, 14, r.other ? t.series[0] : color);
    s += `<text x="${x + labelW + bw + 8}" y="${y + 12}">${pct(r.share)}</text>`;
  });
  return s;
}

function languagesSvg(d, t) {
  const rows = Math.max(d.allTime.length, d.recent.length, 1);
  const h = 92 + rows * 28 + 14 + 30;
  const half = (W - PAD * 2 - 40) / 2;
  const recent = d.recent.length ? d.recent : [{ name: "nothing yet", share: 0 }];
  const body =
    langPanel(PAD, half, "Writing most", "all time, weighted by my commits", d.allTime, t.seqA, t) +
    `<line x1="${W / 2}" y1="30" x2="${W / 2}" y2="${h - 44}" stroke="${t.grid}"/>` +
    langPanel(W / 2 + 20, half, "Writing lately", `last ${RECENT_DAYS} days`, recent, t.seqB, t);
  return frame(t, h, "languages", "Most used and latest languages", d.updated, body);
}

function agentsSvg(d, t) {
  const { agents, assisted, total } = d.agents;
  if (!assisted) {
    const body = `<text x="${PAD}" y="48" class="h">No agent co-authors in my commits this year</text>
<text x="${PAD}" y="76" class="s">Counted from Co-Authored-By trailers on ${plural(total, "commit")}.</text>`;
    return frame(t, 130, "agents", "Coding agents", d.updated, body);
  }
  const fav = agents.find((a) => a.slot) ?? agents[0];
  let body = `<text x="${PAD}" y="48" class="h">${esc(fav.name)} co-wrote ${b(fmt(fav.commits))} of my ${b(fmt(total))} commits this year</text>`;
  body += `<text x="${PAD}" y="78" class="s">${pct(assisted / total)} of my commits carry an agent co-author trailer.</text>`;

  // One part-to-whole bar, 2px surface gaps between segments.
  const y = 102, gap = 2, usable = W - PAD * 2 - gap * (agents.length - 1);
  let x = PAD;
  agents.forEach((a, i) => {
    const w = Math.max(4, (a.commits / assisted) * usable), r = 4;
    const lr = i === 0 ? r : 0, rr = i === agents.length - 1 ? r : 0;
    body += `<path d="M${x + lr} ${y}h${w - lr - rr}${rr ? `a${r} ${r} 0 0 1 ${r} ${r}v${16 - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}` : `v16`}h-${w - lr - rr}${lr ? `a${r} ${r} 0 0 1 -${r} -${r}v-${16 - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}` : `v-16`}z" fill="${t.series[a.slot]}"/>`;
    x += w + gap;
  });

  // The legend is the source itself: one trailer line per agent.
  const nameW = Math.max(...agents.map((a) => a.name.length));
  agents.forEach((a, i) => {
    const ly = 150 + i * 24, tx = PAD + 20, nx = tx + 16 * 14 * CH, cx = nx + (nameW + 4) * 14 * CH;
    body += `<rect x="${PAD}" y="${ly - 10}" width="10" height="10" rx="2" fill="${t.series[a.slot]}"/>`;
    body += `<text x="${tx}" y="${ly}" class="s">Co-Authored-By:</text><text x="${nx}" y="${ly}">${esc(a.name)}</text>`;
    body += `<text x="${cx}" y="${ly}" text-anchor="end" class="n">${fmt(a.commits)}</text><text x="${cx + 64}" y="${ly}" text-anchor="end" class="s">${pct(a.commits / assisted)}</text>`;
  });
  return frame(t, 150 + agents.length * 24 + 52, "agents", "Coding agents", d.updated, body);
}

// ---------------------------------------------------------------- README

function table(d) {
  const langRow = (r) => `| ${r.name} | ${pct(r.share)} |`;
  const lines = [
    `<details>`,
    `<summary>Data behind these cards (updated ${d.updated})</summary>`,
    ``,
    `| Last 12 months | |`, `|---|---|`,
    `| Contributions | ${fmt(d.contributions)} |`,
    `| Commits | ${fmt(d.commits)} |`,
    `| Pull requests / reviews | ${fmt(d.prs)} / ${fmt(d.reviews)} |`,
    `| Repositories contributed to | ${d.reposTotal} |`,
    `| Org / team repos | ${d.outsideRepos} (${d.owners.join(", ") || "none"}) |`,
    `| Private contributions | ${fmt(d.private)} |`,
    `| Current / longest streak | ${d.current}d / ${d.longest}d |`,
    ``,
    `| Language, all time | Share |`, `|---|---|`, ...d.allTime.map(langRow),
    ``,
    `| Language, last ${RECENT_DAYS} days | Share |`, `|---|---|`, ...d.recent.map(langRow),
    ``,
    `| Agent | Commits | Share |`, `|---|---|---|`,
    ...d.agents.agents.map((a) => `| ${a.name} | ${a.commits} | ${pct(a.commits / d.agents.assisted)} |`),
    ``,
    `</details>`,
  ];
  return lines.join("\n");
}

const data = await collect();
await mkdir("assets", { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  await writeFile(`assets/overview-${mode}.svg`, overviewSvg(data, t));
  await writeFile(`assets/languages-${mode}.svg`, languagesSvg(data, t));
  await writeFile(`assets/agents-${mode}.svg`, agentsSvg(data, t));
}
const readme = await readFile("README.md", "utf8");
await writeFile(
  "README.md",
  readme.replace(/<!-- STATS:START -->[\s\S]*<!-- STATS:END -->/, `<!-- STATS:START -->\n${table(data)}\n<!-- STATS:END -->`),
);
console.log(JSON.stringify({ ...data, weeks: data.weeks.length }, null, 2));
