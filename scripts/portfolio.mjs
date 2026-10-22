// Portfolio projection for the profile README. The portfolio repo owns the
// career facts (data/portfolio/*.json); this file only renders them.

const REPO = "Sumedhbhat/portfolio";
const BRANCH = "master";
const COLLECTIONS = ["profile", "positions", "companies", "projects", "skills", "recognition", "education", "professional-work"];

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
  return { ...p, work: p["professional-work"], company, current, currentCompany: company(current.companyId) };
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

// ---------------------------------------------------------------- timeline

const yearFrac = (iso) => {
  const d = new Date(iso + "T00:00:00Z");
  return d.getUTCFullYear() + d.getUTCMonth() / 12 + (d.getUTCDate() - 1) / 365;
};

// Career path: study and roles as bars, recognition as dots. It is a real
// sequence, so it reads left to right on one time axis.
export function timelineSvg(pf, t, { W, CH, frame, hbar, esc, updated }) {
  const now = yearFrac(updated);
  const initials = (name) => name.split(" ").filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("");
  const edu = pf.education.map((e) => ({ label: `${e.shortDegree.split(",")[0]} at ${initials(e.institution)}`, from: e.startYear + 7 / 12, to: e.endYear + 5 / 12 }));
  const roles = [...pf.positions].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((p) => ({
    label: p.title.replace("Software Engineer", "SWE").replace("Product Developer Intern", "Intern"),
    sub: pf.company(p.companyId).name,
    from: yearFrac(p.startDate),
    to: p.endDate ? yearFrac(p.endDate) : now,
    current: !p.endDate,
  }));
  const marks = pf.recognition
    .filter((r) => /^\d{4}$/.test(r.year))
    .map((r) => {
      const q = /Q([1-4])\s+(\d{4})/.exec(r.note ?? "");
      return { label: r.title.replace(/\s+—\s+/, ", "), at: q ? Number(q[2]) + (Number(q[1]) - 1) / 4 + 0.125 : Number(r.year) + 0.5 };
    })
    .sort((a, b) => a.at - b.at);

  const minYear = Math.floor(Math.min(...edu.map((e) => e.from), ...roles.map((r) => r.from)));
  const left = 28, right = W - 28, x = (yr) => left + ((yr - minYear) / (now - minYear)) * (right - left);

  // Greedy rows: an item takes the first row where its span [start, end]
  // clears the previous item in that row by a gap.
  const placer = (rowYs) => {
    const ends = rowYs.map(() => -Infinity);
    return (start, end) => {
      const row = Math.max(0, ends.findIndex((e) => start > e + 16));
      ends[row] = end;
      return rowYs[row];
    };
  };
  // A label starting at x0, flipped to end at x0 when it would run off the card.
  const fit = (x0, chars, px, pad = 0) => {
    const w = chars * px * CH;
    return x0 + pad + w > right ? { x: x0 - pad, anchor: "end", start: x0 - pad - w, end: x0 } : { x: x0 + pad, anchor: "start", start: x0, end: x0 + pad + w };
  };

  const studyY = 92, workY = 132, markY = 212, axisY = 270;
  let body = `<text x="28" y="48" class="h">From ${esc(edu.length ? `${initials(pf.education[0].institution)} in ${minYear}` : minYear)} to <tspan class="n">${esc(roles.at(-1).label)}</tspan> at ${esc(roles.at(-1).sub)}</text>`;
  for (let yr = minYear; yr <= Math.floor(now); yr++) {
    body += `<line x1="${x(yr)}" y1="72" x2="${x(yr)}" y2="${axisY - 16}" stroke="${t.grid}"/><text x="${x(yr) + 4}" y="${axisY}" class="m">${yr}</text>`;
  }
  edu.forEach((e) => {
    body += hbar(x(e.from), studyY, x(e.to) - x(e.from), 14, t.series[0]);
    body += `<text x="${x(e.from)}" y="${studyY - 8}" class="m">${esc(e.label)}</text>`;
  });

  const roleLabel = placer([workY + 34, workY + 54]);
  roles.forEach((r) => {
    body += hbar(x(r.from) + 1, workY, Math.max(4, x(r.to) - x(r.from) - 2), 14, r.current ? t.seqA : t.deemph);
    const text = `${r.label} ${r.sub}`;
    const f = fit(x(r.from) + 1, text.length, 13);
    const y = roleLabel(f.start, f.end);
    const endX = f.anchor === "end" ? right : f.x;
    body += `<line x1="${x(r.from) + 1}" y1="${workY + 16}" x2="${x(r.from) + 1}" y2="${y - 12}" stroke="${t.base}"/>`;
    body += `<text x="${endX}" y="${y}" text-anchor="${f.anchor}" class="${r.current ? "n" : "s"}" style="font-size:13px">${esc(r.label)} <tspan class="m" style="font-weight:400">${esc(r.sub)}</tspan></text>`;
  });

  // Recognition: a ringed dot with its label beside it; dot and label share a row.
  const markRow = placer([markY, markY + 22]);
  marks.forEach((m) => {
    const cx = x(m.at), f = fit(cx, m.label.length, 12, 12);
    const y = markRow(Math.min(f.start, cx - 6), Math.max(f.end, cx + 6));
    body += `<circle cx="${cx}" cy="${y - 4}" r="5" fill="${t.seqB}" stroke="${t.surface}" stroke-width="2"/>`;
    body += `<text x="${f.x}" y="${y}" text-anchor="${f.anchor}" class="m">${esc(m.label)}</text>`;
  });
  return frame(t, axisY + 46, "career", "Career timeline", updated, body);
}

// ---------------------------------------------------------------- markdown

const mdEsc = (s) => String(s).replace(/\|/g, "\\|");

export function portfolioIntro(pf) {
  return [
    pf.profile.summary,
    "",
    `Right now I'm a **${pf.current.title}** at **${pf.currentCompany.name}** in ${pf.profile.location}. I ${pf.current.description.charAt(0).toLowerCase()}${pf.current.description.slice(1)}`,
  ].join("\n");
}

export function portfolioBody(pf) {
  const out = [];
  const live = pf.projects.filter((p) => ["In development", "Current"].includes(p.status));
  out.push("### What I'm building", "");
  for (const p of live) {
    const link = p.links[0] ? ` ([${p.links[0].label.toLowerCase()}](${p.links[0].url}))` : "";
    const where = p.kind === "Professional" ? ` at ${p.year}` : link;
    out.push(`- **${p.title}**${where}: ${p.description.split(/(?<=\.)\s/)[0]} \`${p.tags.join("` `")}\``);
  }

  out.push("", "### Shipped at work", "", "| What | Impact |", "|---|---|");
  for (const w of pf.work.filter((w) => w.status === "Delivered" && w.companyId === pf.current.companyId)) {
    out.push(`| **${mdEsc(w.title)}**<br><sub>${w.tags.map(mdEsc).join(", ")}</sub> | ${mdEsc(w.impact)} |`);
  }

  const archive = pf.projects.filter((p) => !live.includes(p) && p.links.length);
  out.push("", "### Earlier projects", "");
  for (const p of archive) {
    const links = p.links.map((l) => `[${l.label.toLowerCase()}](${l.url})`).join(", ");
    out.push(`- **${p.title}** (${p.year}, ${links}): ${p.description.split(/(?<=\.)\s/)[0]}`);
  }

  out.push("", "### Recognition", "");
  for (const r of pf.recognition) out.push(`- **${r.title.replace(/\s+—\s+/, ", ")}**: ${r.note}`);

  out.push("", "### Toolbox", "", "| | |", "|---|---|");
  for (const g of pf.skills) out.push(`| **${mdEsc(g.group)}** | ${g.items.map(mdEsc).join(", ")} |`);
  return out.join("\n");
}
