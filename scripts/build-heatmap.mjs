// Renders assets/heatmap.svg: the last 12 months of contributions as a full
// heatmap, with totals and streaks, in the same theme as the rest of the profile.
// Node 20+, no dependencies. Needs GITHUB_TOKEN (or GH_TOKEN) in the environment.
// Private contributions are counted when "Include private contributions on my
// profile" is on in the GitHub profile settings.

import { writeFileSync, mkdirSync } from "node:fs";

const LOGIN = process.env.PROFILE_LOGIN || "Mohannad35";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN or GH_TOKEN is required");

const query = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-heatmap" },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);

const cal = json.data.user.contributionsCollection.contributionCalendar;
const weeks = cal.weeks;
const days = weeks.flatMap((w) => w.contributionDays);

// ---- stats -----------------------------------------------------------------
let longest = 0, run = 0, best = { date: "", count: 0 }, active = 0;
for (const d of days) {
  if (d.contributionCount > 0) { run++; active++; longest = Math.max(longest, run); } else run = 0;
  if (d.contributionCount > best.count) best = d.contributionCount ? { date: d.date, count: d.contributionCount } : best;
}
// current streak: allow today to be empty (the day is not over yet)
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue;
  else break;
}

// ---- levels (quartiles of the non-zero days, like GitHub) ------------------
const nz = days.map((d) => d.contributionCount).filter((c) => c > 0).sort((a, b) => a - b);
const q = (p) => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 1;
const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
const level = (c) => (c === 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4);
const COLORS = ["#141b2f", "#0e4f5a", "#0f8a8a", "#22c3c9", "#7cf3f0"];

// ---- layout ----------------------------------------------------------------
const W = 1000, CELL = 13, GAP = 3.4, STEP = CELL + GAP;
const gridW = weeks.length * STEP - GAP;
const X0 = Math.round((W - gridW) / 2) + 14, Y0 = 128;
const H = Y0 + 7 * STEP + 58;
const font = `'Segoe UI', -apple-system, BlinkMacSystemFont, Ubuntu, Helvetica, Arial, sans-serif`;
const mono = `'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace`;
const fmt = (n) => n.toLocaleString("en-US");
const fmtDate = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

let cells = "";
weeks.forEach((w, wi) => {
  const begin = (0.25 + wi * 0.018).toFixed(3);
  let col = "";
  for (const d of w.contributionDays) {
    const x = X0 + wi * STEP, y = Y0 + d.weekday * STEP, lv = level(d.contributionCount);
    col += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CELL}" height="${CELL}" rx="3" fill="${COLORS[lv]}"><title>${d.contributionCount} on ${d.date}</title></rect>`;
  }
  const dur = (+begin + 0.35).toFixed(3), kt = (+begin / +dur).toFixed(3);
  // Visible by default; the sweep only plays where SVG animation runs.
  cells += `<g>${col}<animate attributeName="opacity" values="0;0;1" keyTimes="0;${kt};1" dur="${dur}s" fill="freeze"/></g>`;
});

// A month is labelled at the first week that starts in it; the first column only
// when the next label is at least 3 weeks away, so labels never overlap.
const monthOf = (w) => new Date(w.contributionDays[0].date + "T00:00:00Z");
const starts = weeks.map((w, wi) => wi > 0 && monthOf(w).getUTCMonth() !== monthOf(weeks[wi - 1]).getUTCMonth());
const nextStart = starts.indexOf(true);
if (nextStart === -1 || nextStart >= 3) starts[0] = true;
let months = "";
weeks.forEach((w, wi) => {
  if (!starts[wi] || wi > weeks.length - 2) return;
  const name = monthOf(w).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  months += `<text x="${X0 + wi * STEP}" y="${Y0 - 10}">${name}</text>`;
});

const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]]
  .map(([i, t]) => `<text x="${X0 - 10}" y="${Y0 + i * STEP + CELL - 2}" text-anchor="end">${t}</text>`).join("");

const stats = [
  [fmt(cal.totalContributions), "contributions"],
  [`${longest} days`, "longest streak"],
  [`${current} days`, "current streak"],
  [`${active}`, "active days"],
  [best.count ? `${best.count}` : "0", best.count ? `best day · ${fmtDate(best.date)}` : "best day"],
];
const statW = (W - 72) / stats.length;
const statSvg = stats.map(([v, l], i) => {
  const cx = 36 + statW * i + statW / 2;
  return `<text x="${cx}" y="66" text-anchor="middle" font-size="24" font-weight="700" fill="url(#num)">${esc(v)}</text>
<text x="${cx}" y="88" text-anchor="middle" font-size="12.5" fill="#94a3b8">${esc(l)}</text>`;
}).join("");

const legendX = X0 + gridW - 5 * 17 - 4;
const legendY = Y0 + 7 * STEP + 18;
const legend = COLORS.map((c, i) => `<rect x="${legendX + i * 17}" y="${legendY}" width="12" height="12" rx="3" fill="${c}"/>`).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${fmt(cal.totalContributions)} contributions in the last year">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#070b16"/><stop offset="1" stop-color="#0d1530"/></linearGradient>
  <linearGradient id="num" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="18" fill="url(#bg)"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#1f2b4d"/>
<g font-family="${font}">
  <text x="36" y="34" font-family="${mono}" font-size="13" fill="#22d3ee">$ git log --since="1 year ago" | heatmap</text>
  ${statSvg}
  <line x1="36" y1="${Y0 - 34}" x2="${W - 36}" y2="${Y0 - 34}" stroke="#1f2b4d"/>
  <g font-size="11.5" fill="#64748b">${months}${dayLabels}</g>
  ${cells}
  <g font-size="11.5" fill="#64748b">
    <text x="${X0}" y="${legendY + 10}">public and private work · updated daily</text>
    <text x="${legendX - 8}" y="${legendY + 10}" text-anchor="end">less</text>
    ${legend}
    <text x="${legendX + 5 * 17 + 4}" y="${legendY + 10}">more</text>
  </g>
</g>
</svg>
`;

mkdirSync("assets", { recursive: true });
writeFileSync("assets/heatmap.svg", svg);
console.log(`heatmap.svg: ${cal.totalContributions} contributions, longest ${longest}, current ${current}, active ${active}, weeks ${weeks.length}`);
