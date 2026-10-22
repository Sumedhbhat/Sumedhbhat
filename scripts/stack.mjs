// Tech stack card: scans every non-fork repo I own (public and private) for
// languages, manifests, and config files, adds the skills from the portfolio,
// and draws one icon per technology. Icons come from skillicons.dev and are
// inlined at build time, so the README never depends on that service.

// Each technology: skillicons id, the row it sits in, and how to spot it.
// lang = GitHub language name, dep = npm/Python package, file = path regex,
// skill = portfolio skill name.
const TECH = [
  { id: "ts", row: "languages", lang: "TypeScript", skill: "TypeScript" },
  { id: "js", row: "languages", lang: "JavaScript", skill: "JavaScript" },
  { id: "py", row: "languages", lang: "Python", skill: "Python" },
  { id: "cs", row: "languages", lang: "C#", skill: "C#" },
  { id: "rust", row: "languages", lang: "Rust", file: /(^|\/)Cargo\.toml$/ },
  { id: "go", row: "languages", lang: "Go", file: /(^|\/)go\.mod$/ },
  { id: "cpp", row: "languages", lang: "C++" },
  { id: "c", row: "languages", lang: "C" },
  { id: "java", row: "languages", lang: "Java" },
  { id: "kotlin", row: "languages", lang: "Kotlin" },
  { id: "lua", row: "languages", lang: "Lua" },
  { id: "bash", row: "languages", lang: "Shell" },
  { id: "powershell", row: "languages", lang: "PowerShell" },
  { id: "solidity", row: "languages", lang: "Solidity", file: /\.sol$/ },
  { id: "html", row: "languages", lang: "HTML" },
  { id: "css", row: "languages", lang: "CSS" },
  { id: "sass", row: "languages", lang: "SCSS", dep: ["sass"] },

  { id: "react", row: "frontend", dep: ["react", "react-native"], skill: "React" },
  { id: "angular", row: "frontend", dep: ["@angular/core"], file: /(^|\/)angular\.json$/, skill: "Angular" },
  { id: "vue", row: "frontend", lang: "Vue", dep: ["vue"] },
  { id: "nuxtjs", row: "frontend", dep: ["nuxt"], skill: "Nuxt" },
  { id: "nextjs", row: "frontend", dep: ["next"] },
  { id: "svelte", row: "frontend", dep: ["svelte"] },
  { id: "reactivex", row: "frontend", dep: ["rxjs"], skill: "RxJS" },
  { id: "redux", row: "frontend", dep: ["redux", "@reduxjs/toolkit"] },
  { id: "tailwind", row: "frontend", dep: ["tailwindcss"] },
  { id: "materialui", row: "frontend", dep: ["@mui/material", "@material-ui/core"] },
  { id: "bootstrap", row: "frontend", dep: ["bootstrap", "react-bootstrap"] },
  { id: "vite", row: "frontend", dep: ["vite"] },

  { id: "nodejs", row: "backend", file: /(^|\/)package\.json$/ },
  { id: "dotnet", row: "backend", file: /\.(csproj|sln)$/, skill: ".NET" },
  { id: "express", row: "backend", dep: ["express"] },
  { id: "nestjs", row: "backend", dep: ["@nestjs/core"] },
  { id: "fastapi", row: "backend", dep: ["fastapi"], skill: "FastAPI" },
  { id: "flask", row: "backend", dep: ["flask"] },
  { id: "django", row: "backend", dep: ["django"] },
  { id: "graphql", row: "backend", dep: ["graphql"] },
  { id: "electron", row: "backend", dep: ["electron"] },
  { id: "tauri", row: "backend", dep: ["@tauri-apps/api"], file: /(^|\/)tauri\.conf\.json$/ },

  { id: "postgres", row: "data & ai", dep: ["pg", "postgres", "psycopg2", "psycopg2-binary", "psycopg"] },
  { id: "mysql", row: "data & ai", dep: ["mysql", "mysql2", "pymysql", "mysql-connector-python"] },
  { id: "sqlite", row: "data & ai", dep: ["sqlite3", "better-sqlite3"] },
  { id: "mongodb", row: "data & ai", dep: ["mongodb", "mongoose", "pymongo"] },
  { id: "redis", row: "data & ai", dep: ["redis", "ioredis"] },
  { id: "prisma", row: "data & ai", dep: ["prisma", "@prisma/client"] },
  { id: "firebase", row: "data & ai", dep: ["firebase", "firebase-admin"] },
  { id: "supabase", row: "data & ai", dep: ["@supabase/supabase-js"] },
  { id: "tensorflow", row: "data & ai", dep: ["tensorflow", "keras", "@tensorflow/tfjs"] },
  { id: "pytorch", row: "data & ai", dep: ["torch"] },
  { id: "sklearn", row: "data & ai", dep: ["scikit-learn", "sklearn"] },
  { id: "opencv", row: "data & ai", dep: ["opencv-python", "opencv-contrib-python", "opencv-python-headless"] },

  { id: "cloudflare", row: "tools", dep: ["wrangler"], file: /(^|\/)wrangler\.(toml|jsonc?)$/, skill: "Cloudflare" },
  { id: "azure", row: "tools", skill: "Azure DevOps" },
  { id: "docker", row: "tools", file: /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/ },
  { id: "githubactions", row: "tools", file: /^\.github\/workflows\/.+\.ya?ml$/, skill: "GitHub Actions" },
  { id: "vercel", row: "tools", file: /(^|\/)vercel\.json$/ },
  { id: "netlify", row: "tools", file: /(^|\/)netlify\.toml$/ },
  { id: "jest", row: "tools", dep: ["jest"] },
  { id: "vitest", row: "tools", dep: ["vitest"], skill: "Vitest" },
  { id: "cypress", row: "tools", dep: ["cypress"], skill: "Cypress" },
  { id: "neovim", row: "tools", file: /(^|\/)init\.lua$/ },
];
const ROWS = ["languages", "frontend", "backend", "data & ai", "tools"];

// A language counts once it is at least this share of a repo's code, so
// generated scaffolding (Ruby Podfiles in React Native apps) stays out.
const MIN_LANG_SHARE = 0.08;
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml)$/;
const MAX_MANIFESTS = 8;

async function rest(token, path, raw = false) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { Authorization: `bearer ${token}`, Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  return raw ? res.text() : res.json();
}

function depsOf(path, text) {
  if (path.endsWith("package.json")) {
    try {
      const j = JSON.parse(text);
      return Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies });
    } catch { return []; }
  }
  // requirements.txt lines or pyproject dependency strings: take the bare package name.
  return [...text.matchAll(/^\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)/gm)].map((m) => m[1].toLowerCase());
}

export async function scanStack(token, gql, login, skills) {
  const repos = [];
  for (let after = null; ; ) {
    const d = await gql(
      `query($after: String) { viewer { repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
        pageInfo { hasNextPage endCursor }
        nodes { name url description isPrivate stargazerCount pushedAt defaultBranchRef { name } languages(first: 20) { edges { size node { name } } } }
      } } }`,
      { after },
    );
    const page = d.viewer.repositories;
    repos.push(...page.nodes.filter((r) => r.name !== login && r.defaultBranchRef));
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  const found = new Map(); // id -> number of repos using it
  for (const repo of repos) {
    const hits = new Set();
    const edges = repo.languages.edges;
    const total = edges.reduce((s, e) => s + e.size, 0) || 1;
    const langs = new Set(edges.filter((e) => e.size / total >= MIN_LANG_SHARE).map((e) => e.node.name));

    const tree = await rest(token, `repos/${login}/${repo.name}/git/trees/${repo.defaultBranchRef.name}?recursive=1`);
    const paths = (tree?.tree ?? []).filter((f) => f.type === "blob" && !/(^|\/)(node_modules|vendor|\.venv|dist)\//.test(f.path)).map((f) => f.path);
    const deps = new Set();
    for (const path of paths.filter((p) => MANIFEST.test(p)).slice(0, MAX_MANIFESTS)) {
      const text = await rest(token, `repos/${login}/${repo.name}/contents/${path}`, true);
      if (text) depsOf(path, text).forEach((dep) => deps.add(dep.toLowerCase()));
    }

    for (const t of TECH) {
      if ((t.lang && langs.has(t.lang)) || t.dep?.some((x) => deps.has(x)) || (t.file && paths.some((p) => t.file.test(p)))) hits.add(t.id);
    }
    hits.forEach((id) => found.set(id, (found.get(id) ?? 0) + 1));
  }

  // Skills I list in the portfolio count even when the work lives in a job repo.
  const skillNames = new Set(skills.flatMap((g) => g.items));
  for (const t of TECH) if (t.skill && skillNames.has(t.skill) && !found.has(t.id)) found.set(t.id, 1);

  // Within a row, the technologies used in the most repos come first.
  const rows = ROWS.map((name) => ({
    name,
    ids: TECH.filter((t) => t.row === name && found.has(t.id)).sort((a, b) => found.get(b.id) - found.get(a.id)).map((t) => t.id),
  })).filter((r) => r.ids.length);
  const open = repos.filter((r) => !r.isPrivate).sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  return { repos: repos.length, rows, open };
}

// ---------------------------------------------------------------- card

const iconCache = new Map();
async function icon(id, mode) {
  const key = `${id}-${mode}`;
  if (!iconCache.has(key)) {
    const res = await fetch(`https://skillicons.dev/icons?i=${id}&theme=${mode}`);
    if (!res.ok) throw new Error(`skillicons ${id}: ${res.status}`);
    // The response wraps the icon's own 256x256 <svg> in a translated <g>.
    const inner = /<g transform="translate\(0, 0\)">\s*(<svg[\s\S]*<\/svg>)\s*<\/g>/.exec(await res.text());
    if (!inner) throw new Error(`skillicons ${id}: unexpected SVG`);
    // Icons share one document, so their gradient and clip ids get a prefix.
    const svg = inner[1]
      .replace(/^<svg([^>]*)>/, (_, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")}>`)
      .replace(/\bid="([^"]+)"/g, `id="${key}-$1"`)
      .replace(/url\(#([^)]+)\)/g, `url(#${key}-$1)`)
      .replace(/href="#([^"]+)"/g, `href="#${key}-$1"`);
    iconCache.set(key, svg);
  }
  return iconCache.get(key);
}

export async function stackSvg(stack, t, mode, { W, frame, esc, updated }) {
  const size = 38, gap = 10, labelW = 130, left = 28, right = W - 28;
  const perLine = Math.floor((right - left - labelW + gap) / (size + gap));
  let y = 82, body = `<text x="${left}" y="48" class="h">What I build with, from <tspan class="n">${stack.repos}</tspan> repos I've made</text>`;
  for (const row of stack.rows) {
    body += `<text x="${left}" y="${y + size / 2 + 5}" class="s">${esc(row.name)}</text>`;
    for (let i = 0; i < row.ids.length; i++) {
      const x = left + labelW + (i % perLine) * (size + gap), iy = y + Math.floor(i / perLine) * (size + gap);
      const svg = await icon(row.ids[i], mode);
      body += svg.replace(/^<svg/, `<svg x="${x}" y="${iy}" width="${size}" height="${size}"`);
    }
    y += Math.ceil(row.ids.length / perLine) * (size + gap) + 14;
  }
  return frame(t, y + 30 + 10, "stack", "Technologies I build with", updated, body);
}
