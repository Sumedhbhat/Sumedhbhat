// Portfolio projection for the profile README. The portfolio repo owns the
// profile facts (data/portfolio/*.json); this file only renders them.

const REPO = "Sumedhbhat/portfolio";
const BRANCH = "master";
const COLLECTIONS = ["profile", "positions", "companies", "projects", "skills"];

export async function loadPortfolio(token) {
  const entries = await Promise.all(
    COLLECTIONS.map(async (name) => {
      const res = await fetch(`https://api.github.com/repos/${REPO}/contents/data/portfolio/${name}.json?ref=${BRANCH}`, {
        headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github.raw+json" },
      });
      if (!res.ok) throw new Error(`portfolio ${name}: ${res.status}`);
      return [name, await res.json()];
    }),
  );
  const p = Object.fromEntries(entries);
  const company = (id) => p.companies.find((c) => c.id === id);
  const current = p.positions.find((pos) => !pos.endDate) ?? p.positions[0];
  return { ...p, company, current, currentCompany: company(current.companyId) };
}

// ---------------------------------------------------------------- hero

// Tokyonight syntax colors, Moon for dark and Day for light.
const SYNTAX = {
  dark: { kw: "#c099ff", name: "#82aaff", key: "#4fd6be", str: "#c3e88d", pun: "#89ddff", cm: "#7a83b9", cursor: "#c8d3f5" },
  light: { kw: "#9854f1", name: "#2e7de9", key: "#007197", str: "#587539", pun: "#006a83", cm: "#6c76a8", cursor: "#3760bf" },
};

function heroLines(pf) {
  const str = (s) => ["str", JSON.stringify(s)];
  const prop = (key, value, comment) => [["", "  "], ["key", key], ["pun", ": "], ...value, ["pun", ","], ...(comment ? [["cm", `  // ${comment}`]] : [])];
  const building = pf.projects.find((x) => x.status === "In development");
  const shipping = pf.projects.find((x) => x.kind === "Public" && x.status === "Current");
  // "Full Stack and Applied AI" -> ["full stack", "applied AI"]; acronyms keep their case.
  const focus = pf.profile.focus.split(/\s+and\s+/i).map((f) => f.split(" ").map((w) => (w === w.toUpperCase() ? w : w.toLowerCase())).join(" "));
  const list = focus.flatMap((f, i) => [...(i ? [["pun", ", "]] : []), str(f)]);
  return [
    [["kw", "const "], ["name", "sumedh"], ["pun", " = {"]],
    prop("role", [str(pf.current.title)], `at ${pf.currentCompany.name}`),
    prop("focus", [["pun", "["], ...list, ["pun", "]"]]),
    ...(building ? [prop("building", [str(building.title)], building.status.toLowerCase())] : []),
    ...(shipping ? [prop("shipping", [str(shipping.title)], "on the side")] : []),
    prop("based", [str(pf.profile.location)]),
    prop("editor", [str("neovim")], "no going back to VS Code"),
    [["pun", "};"]],
  ];
}

// One orchestrated moment: the buffer types itself out, line by line, then the
// statusline drops from insert to normal mode. Reduced motion shows the end state.
export function heroSvg(pf, t, mode, { W, FONT, CH, esc }) {
  const s = SYNTAX[mode];
  const lines = heroLines(pf);
  const fs = 16, cw = fs * CH, lh = 27, top = 46, gutter = 64, sh = 30;
  const h = top + lines.length * lh + 20 + sh;
  const lens = lines.map((l) => l.reduce((n, [, text]) => n + text.length, 0));
  const perChar = 0.028, pause = 0.12, startAt = 0.4;
  const starts = [], ends = [];
  let clock = startAt;
  lens.forEach((n) => { starts.push(clock); clock += Math.max(0.15, n * perChar); ends.push(clock); clock += pause; });
  const total = clock;
  const at = (sec) => ((sec / total) * 100).toFixed(3);

  let css = `text{font-family:${FONT};font-size:${fs}px;white-space:pre}.ln{fill:${t.muted};font-size:13px}.kw{fill:${s.kw}}.name{fill:${s.name}}.key{fill:${s.key}}.str{fill:${s.str}}.pun{fill:${s.pun}}.cm{fill:${s.cm};font-style:italic}`;
  css += `.m{font-size:12px;fill:${t.muted}}.c{font-size:12px;font-weight:700;fill:${t.onAccent}}`;
  // End state is the un-animated default; keyframes only describe the typing.
  css += `.cv{opacity:0}.ins{opacity:0}.blink{opacity:0;animation:blink 1.1s step-end ${total}s infinite}`;
  css += `@keyframes blink{0%{opacity:1}50%{opacity:0}}`;
  css += `.ins{animation:ins ${total}s linear both}@keyframes ins{0%,99.9%{opacity:1}100%{opacity:0}}`;
  css += `.nor{animation:nor ${total}s linear both}@keyframes nor{0%,99.9%{opacity:0}100%{opacity:1}}`;

  let body = "";
  lines.forEach((parts, i) => {
    const y = top + i * lh, x0 = gutter;
    body += `<text x="${gutter - 18}" y="${y}" class="ln" text-anchor="end">${i + 1}</text>`;
    body += `<text x="${x0}" y="${y}">${parts.map(([cls, text]) => `<tspan${cls ? ` class="${cls}"` : ""}>${esc(text)}</tspan>`).join("")}</text>`;
    // A cover in the surface color slides off the line in character steps,
    // with the block cursor riding its leading edge.
    const width = lens[i] * cw, a = at(starts[i]), b = at(ends[i]);
    css += `.cv${i}{animation:cv${i} ${total}s linear both}@keyframes cv${i}{0%,${a}%{opacity:1;transform:translateX(0);animation-timing-function:steps(${lens[i]},end)}${b}%{opacity:1;transform:translateX(${width}px)}${(Number(b) + 0.001).toFixed(3)}%,100%{opacity:0;transform:translateX(${width}px)}}`;
    css += `.cv${i} .cur{animation:cur${i} ${total}s linear both}@keyframes cur${i}{0%,${a}%{opacity:0}${(Number(a) + 0.001).toFixed(3)}%,${b}%{opacity:1}${(Number(b) + 0.001).toFixed(3)}%,100%{opacity:0}}`;
    body += `<g class="cv cv${i}"><rect x="${x0}" y="${y - fs}" width="${width + cw}" height="${lh}" fill="${t.surface}"/><rect class="cur" x="${x0}" y="${y - fs + 2}" width="${cw}" height="${fs + 4}" fill="${s.cursor}"/></g>`;
  });
  const last = lines.length - 1;
  body += `<rect class="blink" x="${gutter + lens[last] * cw}" y="${top + last * lh - fs + 2}" width="${cw}" height="${fs + 4}" fill="${s.cursor}"/>`;

  const sy = h - sh;
  const block = (label, cls) => {
    const bw = 28 + label.length * 12 * CH + 14;
    return `<g class="${cls}"><path d="M0 ${sy}h${bw}l12 ${sh / 2}l-12 ${sh / 2}h-${bw}z" fill="${cls === "ins" ? s.str : t.seqA}"/><text x="28" y="${sy + 19.5}" class="c">${label}</text></g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(`${pf.profile.name}, ${pf.current.title} at ${pf.currentCompany.name}, ${pf.profile.focus}, based in ${pf.profile.location}`)}">
<style>${css}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>
<defs><clipPath id="w"><rect width="${W}" height="${h}" rx="10"/></clipPath></defs>
<g clip-path="url(#w)">
<rect width="${W}" height="${h}" fill="${t.surface}"/>
<rect y="${sy}" width="${W}" height="${sh}" fill="${t.status}"/>
${block("-- insert --", "ins")}${block("normal", "nor")}
<text x="190" y="${sy + 19.5}" class="m">sumedh.ts</text>
<text x="${W - 28}" y="${sy + 19.5}" class="m" text-anchor="end">${esc(pf.profile.location)}</text>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${h - 1}" rx="10" fill="none" stroke="${t.border}"/>
${body}
</svg>`;
}

// ---------------------------------------------------------------- markdown

// One line about me; the cards and the project list carry the rest.
export function portfolioIntro(pf) {
  const focus = pf.profile.focus.split(" ").map((w) => (w === w.toUpperCase() ? w : w.toLowerCase())).join(" ");
  return `I build ${focus} software from ${pf.profile.location}. Here's what I've built in the open.`;
}

// A short tagline: the first sentence, cut at its first clause when it runs long.
function tagline(s) {
  let t = s.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  if (t.length > 60) t = t.split(/,\s| with | that | running /)[0];
  return t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Open source projects: every public repo I own, newest push first. Portfolio
// entries supply a better title and description; otherwise the repo's own
// description is used, and repos without one are left out.
export function portfolioBody(pf, open) {
  const curated = new Map();
  for (const p of pf.projects) {
    const repo = p.links.find((l) => /^https:\/\/github\.com\//i.test(l.url));
    if (repo) curated.set(repo.url.toLowerCase(), p);
  }
  const out = [];
  for (const r of open) {
    const p = curated.get(r.url.toLowerCase());
    const desc = p?.description ?? r.description;
    if (!desc) continue;
    const text = tagline(desc);
    const extra = (p?.links ?? []).filter((l) => !/github\.com/i.test(l.url)).map((l) => ` · [${l.label.toLowerCase()}](${l.url})`).join("");
    const stars = r.stargazerCount ? ` · ★ ${r.stargazerCount}` : "";
    out.push(`- **[${p?.title ?? r.name}](${r.url})**: ${text}${extra}${stars}`);
  }
  return out.join("\n");
}
