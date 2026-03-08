import { useState, useEffect, useRef, useMemo } from "react";

/* ================================================================
   CONSTANTS
================================================================ */
const STAGES = ["New","Contacted","Interested","Booked Test","Completed Test","Booked Full","Completed","Dormant"];
const SOURCES = ["IG","Referral","Repeat","Other"];

const DEFAULT_SETTINGS = {
  dailyDmTarget: 5,
  dailyFollowupTarget: 5,
  weeklyHourGoal: 30,
  ratePerHour: 50,
  monthlyRevenueGoal: 6000,
  weeklyRevenueGoal: 1500,
};

const SCRIPTS = {
  newDm: { label: "New DM", text: "Yo I got openings this week — pull up for a 1-hour test session to feel the studio and knock a take. If you vibe, we lock a full block after." },
  followup: { label: "Follow-up", text: "Quick bump — you wanna do that 1-hour test this week? I can fit you in." },
  bookingQ: { label: "Booking Question", text: "Bet — what day works and what time window? (ex: today 6–9, or tomorrow afternoon)" },
  close: { label: "Two-Option Close", text: "Perfect — I can do [OPTION 1] or [OPTION 2]. Which one you want?" },
  confirm: { label: "Confirmation", text: "Locked for [DAY/TIME]. 1-hour test. Pull up 5 mins early, bring beats/refs." },
};

const MOTIVATOR = [
  { emoji: "💀", label: "BROKE MODE", sub: "Pipeline's cold. Start sliding." },
  { emoji: "🎧", label: "WARMING UP", sub: "One in. Keep the momentum." },
  { emoji: "🎵", label: "IN THE BOOTH", sub: "Two down. You're building." },
  { emoji: "🔥", label: "ON FIRE", sub: "Three DMs. You're cooking." },
  { emoji: "⚡", label: "LOCKED IN", sub: "Four. One more to drip up." },
  { emoji: "💎", label: "DRIPPED", sub: "Daily goal crushed. Respect." },
];

const STAGE_COLOR = {
  "New": "#5E5CE6",
  "Contacted": "#007AFF",
  "Interested": "#BF5AF2",
  "Booked Test": "#FF9F0A",
  "Completed Test": "#32ADE6",
  "Booked Full": "#30D158",
  "Completed": "#30D158",
  "Dormant": "#636366",
};

const SK = {
  leads: "skyline_leads",
  tasks: "skyline_tasks",
  settings: "skyline_settings",
  daily: "skyline_daily",
  sessions: "skyline_sessions",
  dmHistory: "skyline_dm_history",
};

/* ================================================================
   HELPERS
================================================================ */
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2);
const todayStr = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// Sunday-based week start (Sun–Sat), matches US convention
const getSundayWeekStart = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
};
const currentWeekStart = () => getSundayWeekStart(todayStr());

// Monday-based week start used by Studio KPIs (spec requirement)
const getMondayWeekStart = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();
  const offset = (dow + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
};
const studioWeekStart = () => getSundayWeekStart(todayStr());

// Returns month-aligned 7-day buckets starting from the 1st (e.g. Mar 1–7, Mar 8–14 …)
const getMonthWeekBuckets = (year, month) => {
  const mm = String(month).padStart(2, "0");
  const firstDay = `${year}-${mm}-01`;
  const lastDate = new Date(year, month, 0); // day 0 of next month = last day of this month
  const lastDay  = lastDate.toISOString().slice(0, 10);

  const buckets = [];
  let cursor = firstDay;
  while (cursor <= lastDay) {
    const weekEnd = addDays(cursor, 6) > lastDay ? lastDay : addDays(cursor, 6);
    buckets.push({ weekStart: cursor, weekEnd });
    cursor = addDays(cursor, 7);
  }
  return buckets;
};

/* ---- Studio KPI helpers ---- */
const fmtMoney = (n) => "$" + Math.round(n).toLocaleString();
const fmtHours = (n) => n % 1 === 0 ? `${n}h` : `${n.toFixed(1)}h`;

const groupByMonth = (sessions) => {
  const map = {};
  sessions.forEach(s => {
    const key = s.date.slice(0, 7); // YYYY-MM
    if (!map[key]) map[key] = [];
    map[key].push(s);
  });
  return map;
};

const computeKPIs = (sessions, settings) => {
  const today = todayStr();
  const weekStart = studioWeekStart();
  const weekEnd = addDays(weekStart, 6);
  const monthKey = today.slice(0, 7);
  const yearKey  = today.slice(0, 4);

  // Days left in week including today (Sun=0 … Sat=6)
  const todayDow = new Date(today + "T12:00:00").getDay(); // 0=Sun
  const daysLeftInWeek = Math.max(1, 7 - todayDow); // Sun→7 days, Mon→6, … Sat→1

  const weekSess   = sessions.filter(s => s.date >= weekStart && s.date <= weekEnd);
  const monthSess  = sessions.filter(s => s.date.startsWith(monthKey));
  const yearSess   = sessions.filter(s => s.date.startsWith(yearKey));

  const sum = (arr, key) => arr.reduce((a, s) => a + (s[key] || 0), 0);

  // Week
  const weekPaid    = sum(weekSess, "paidRevenue");
  const weekPending = sum(weekSess, "pendingRevenue");
  const weekHours   = weekSess.reduce((a, s) => a + (typeof s.hours === "number" ? s.hours : 0), 0);
  const weekGap     = Math.max(0, (settings.weeklyRevenueGoal || 1500) - weekPaid);
  const weekPct     = Math.min(weekPaid / ((settings.weeklyRevenueGoal || 1500) || 1), 1);
  const needPerDay  = daysLeftInWeek > 0 ? weekGap / daysLeftInWeek : 0;

  // Month
  const monthPaid    = sum(monthSess, "paidRevenue");
  const monthPending = sum(monthSess, "pendingRevenue");
  const monthHours   = monthSess.reduce((a, s) => a + (typeof s.hours === "number" ? s.hours : 0), 0);
  const monthCount   = monthSess.length;
  const effectiveRate = monthHours > 0 ? monthPaid / monthHours : 0;
  const avgPerSession = monthCount > 0 ? monthPaid / monthCount : 0;

  // YTD
  const ytdPaid  = sum(yearSess, "paidRevenue");
  const ytdHours = yearSess.reduce((a, s) => a + (typeof s.hours === "number" ? s.hours : 0), 0);

  // Monthly rollup — last 12 months
  const monthlyRollup = (() => {
    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today + "T12:00:00");
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const sess = sessions.filter(s => s.date.startsWith(key));
      const paid  = sum(sess, "paidRevenue");
      const hours = sess.reduce((a, s) => a + (typeof s.hours === "number" ? s.hours : 0), 0);
      result.push({
        key, label,
        paid, pending: sum(sess, "pendingRevenue"),
        hours, count: sess.length,
        effRate: hours > 0 ? Math.round(paid / hours) : 0,
      });
    }
    return result;
  })();
  const maxMonthlyPaid = Math.max(...monthlyRollup.map(m => m.paid), 1);

  // last 12 months cutoff — same window as the monthly rollup
  const twelveMonthsAgo = (() => {
    const d = new Date(today + "T12:00:00");
    d.setMonth(d.getMonth() - 11);
    return d.toISOString().slice(0, 7); // YYYY-MM
  })();
  const last12Sess = sessions.filter(s => s.date.slice(0, 7) >= twelveMonthsAgo);

  // Client health — last 12 months (same window as rollup, catches typo-year sessions)
  const clientMap = {};
  last12Sess.forEach(s => {
    const display = s.client || "Unknown";
    const key = clientKey(display);
    if (!clientMap[key]) clientMap[key] = { name: display, sessions: 0, paid: 0, pending: 0 };
    if (clientMap[key].name === "Unknown" && display !== "Unknown") clientMap[key].name = display;
    clientMap[key].sessions++;
    clientMap[key].paid += s.paidRevenue || 0;
    clientMap[key].pending += s.pendingRevenue || 0;
  });
  // All-time totals across every imported session (regardless of year)
  const allTimePaid  = sum(sessions, "paidRevenue");
  const allTimePending = sum(sessions, "pendingRevenue");
  const allTimeHours = sessions.reduce((a, s) => a + (typeof s.hours === "number" ? s.hours : 0), 0);
  const allTimeSessions = sessions.length;

  const clients = Object.values(clientMap).map(c => ({ ...c, total: c.paid + c.pending }));
  const uniqueClients = clients.length;
  const repeatClients = clients.filter(c => c.sessions >= 2).length;
  const repeatRate = uniqueClients > 0 ? Math.round((repeatClients / uniqueClients) * 100) : 0;
  // All clients sorted by total billed — no cap
  const allClients = [...clients].sort((a, b) => b.total - a.total);
  const last12Paid  = sum(last12Sess, "paidRevenue");
  const last12Total = sum(last12Sess, "paidRevenue") + sum(last12Sess, "pendingRevenue");

  // Eff rate summary — must come after last12Paid
  const activeMonths  = monthlyRollup.filter(m => m.hours > 0);
  const last12Hours   = monthlyRollup.reduce((a, m) => a + m.hours, 0);
  const last12EffRate = last12Hours > 0 ? Math.round(last12Paid / last12Hours) : 0;
  const bestEffMonth  = activeMonths.length ? activeMonths.reduce((a, b) => b.effRate > a.effRate ? b : a) : null;
  const worstEffMonth = activeMonths.length ? activeMonths.reduce((a, b) => b.effRate < a.effRate ? b : a) : null;

  return {
    weekStart, weekEnd, weekPaid, weekPending, weekHours, weekGap, weekPct, needPerDay, daysLeftInWeek,
    monthPaid, monthPending, monthHours, monthCount, effectiveRate, avgPerSession,
    ytdPaid, ytdHours,
    allTimePaid, allTimePending, allTimeHours, allTimeSessions,
    monthlyRollup, maxMonthlyPaid, last12EffRate, bestEffMonth, worstEffMonth,
    uniqueClients, repeatClients, repeatRate, allClients, last12Paid, last12Total,
  };
};

// Dedup: same date + client + amount + hours combo = same row
const mergeSessionArrays = (existing, incoming) => {
  const key = s => `${s.date}|${clientKey(s.client)}|${s.amount}|${s.hoursLabel || s.hours}`;
  const seen = new Set(existing.map(key));
  const added = incoming.filter(s => !seen.has(key(s)));
  return [...existing, ...added];
};

/* ---- Import / CSV Parsing ---- */

// Convert an Excel serial number (days since 1899-12-30) to YYYY-MM-DD
const excelSerialToDate = (serial) => {
  // Excel incorrectly treats 1900 as a leap year; serials > 59 are off by 1
  const n = serial > 59 ? serial : serial;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  epoch.setUTCDate(epoch.getUTCDate() + Math.floor(n));
  return epoch.toISOString().slice(0, 10);
};

// Accepts: Date object | Excel serial number | string in many formats
const parseDate = (raw) => {
  if (raw == null || raw === "") return null;

  // JS Date object (from SheetJS cellDates:true)
  if (raw instanceof Date) {
    if (isNaN(raw)) return null;
    // Use UTC to avoid timezone shifts
    const y = raw.getUTCFullYear(), m = raw.getUTCMonth() + 1, d = raw.getUTCDate();
    return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  // Numeric = Excel serial
  if (typeof raw === "number") {
    if (raw < 1 || raw > 2958465) return null; // sane range (1900-01-01 to 9999)
    return excelSerialToDate(raw);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;

  // MM/DD/YY  (2-digit year: 00-29 → 2000s, 30-99 → 1900s)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yr = parseInt(m[3]) < 30 ? 2000 + parseInt(m[3]) : 1900 + parseInt(m[3]);
    return `${yr}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }

  // MM-DD-YY (Excel sometimes exports with dashes)
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (m) {
    const yr = parseInt(m[3]) < 30 ? 2000 + parseInt(m[3]) : 1900 + parseInt(m[3]);
    return `${yr}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }

  // MM-DD-YYYY
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;

  // Numeric string = serial
  if (/^\d{5}$/.test(s)) {
    const serial = parseInt(s, 10);
    if (serial > 40000 && serial < 90000) return excelSerialToDate(serial);
  }

  // Fallback: JS Date parse (handles "Mar 1, 2026", "March 1 2026", etc)
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const y = dt.getFullYear(), mo = dt.getMonth() + 1, d = dt.getDate();
    if (y < 2000 || y > 2050) return null; // reject obviously wrong years
    return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  return null;
};

// Strip currency formatting and parse to float
const parseAmount = (raw) => {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return raw;
  const s = String(raw).replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

const normalizeHeader = (h) =>
  (h || "").toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_MAP = {
  date: "date",
  hours: "hours", hrs: "hours",
  // "Amount" col only — do NOT include total/revenue/paid$ (those are summary cols in the Skyline template)
  amount: "amount", fee: "amount",
  format: "format", method: "format", paymentmethod: "format",
  status: "status",
  partpaid: "partPaid", partpayment: "partPaid", partialpaid: "partPaid",
  info: "client", client: "client", name: "client", artist: "client",
  clientname: "client", artistname: "client",
};

// Summary/formula column headers to always skip (Skyline template cols H–K)
const HEADER_BLACKLIST = new Set([
  "total", "totaldollar", "total$", "paid$", "paiddollar",
  "pending$", "pendingdollar", "paidtotal", "revenue",
]);

// Normalize a client name for consistent grouping and display
// "jessica ", "JESSICA", "Jessica" → "Jessica" (title-case, trimmed)
const normalizeClientName = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return "";
  // Title-case: capitalize first letter of each word
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

// Grouping key for clients (lowercase, no whitespace)
const clientKey = (name) => (name || "").trim().toLowerCase().replace(/\s+/g, " ");

const calcPaidRevenue = (row) => {
  const status = (row.status || "").trim().toLowerCase();
  const amount = parseAmount(row.amount);
  const partPaid = parseAmount(row.partPaid);
  if (status === "paid") return amount;
  if (status === "pending" && row.partPaid != null && row.partPaid !== "" && partPaid > 0) return partPaid;
  return 0;
};

// Build a session row from a raw field map
const buildSession = (row) => {
  const date = parseDate(row.date);
  if (!date) return null;
  const yr = parseInt(date.slice(0, 4));
  const hoursRaw = row.hours;
  const hoursNum = typeof hoursRaw === "number" ? hoursRaw : parseFloat(String(hoursRaw));
  const amount = parseAmount(row.amount);
  const status = (row.status || "").trim();
  const partPaidRaw = (row.partPaid != null && row.partPaid !== "") ? parseAmount(row.partPaid) : null;

  // Compute paidRevenue and pendingRevenue up front
  const statusLc = status.toLowerCase();
  const paidRevenue = statusLc === "paid" ? amount
    : (statusLc === "pending" && partPaidRaw != null && partPaidRaw > 0) ? partPaidRaw
    : 0;
  const pendingRevenue = statusLc === "pending" ? Math.max(0, amount - paidRevenue) : 0;

  return {
    date,
    hours: isNaN(hoursNum) ? 0 : hoursNum,
    hoursLabel: isNaN(hoursNum) ? String(hoursRaw || "").trim() : null,
    amount,
    format: (row.format || "").trim(),
    status,
    partPaid: partPaidRaw,
    client: normalizeClientName(row.client),  // normalized: "Jessica", not "jessica "
    paidRevenue,
    pendingRevenue,
    _suspectYear: yr < 2024 || yr > 2030,
  };
};

const parseCSVText = (text) => {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return { sessions: [], warnings: [] };

  const parseLine = (line) => {
    const cols = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { cols.push(cur); cur = ""; continue; }
      cur += c;
    }
    cols.push(cur);
    return cols.map(c => c.trim());
  };

  const headerRow = parseLine(lines[0]);
  const colMap = {};
  const mappedFields = new Set();
  headerRow.forEach((h, i) => {
    const norm = normalizeHeader(h);
    if (HEADER_BLACKLIST.has(norm)) return;
    const field = HEADER_MAP[norm];
    if (!field || mappedFields.has(field)) return;
    colMap[i] = field;
    mappedFields.add(field);
  });
  // Fallback: col G (index 6) is always Info in the Skyline template
  if (!mappedFields.has("client") && headerRow.length > 6) { colMap[6] = "client"; mappedFields.add("client"); }

  const sessions = [], warnings = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    const row = {};
    Object.entries(colMap).forEach(([idx, field]) => { row[field] = cols[idx] ?? ""; });
    const s = buildSession(row);  // buildSession now computes paidRevenue + pendingRevenue
    if (!s) continue;
    if (s._suspectYear) warnings.push(`Row ${i+1}: date ${s.date} — check the year.`);
    sessions.push(s);
  }
  return { sessions, warnings };
};

// XLSX via SheetJS (loaded dynamically)
const parseXLSXBuffer = async (buffer) => {
  if (!window.__XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => { window.__XLSX = window.XLSX; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XL = window.__XLSX;
  const wb = XL.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XL.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (rows.length < 2) return { sessions: [], warnings: [] };

  // Find header row — first row where col A is a string containing "date"
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    if (rows[i] && normalizeHeader(String(rows[i][0] ?? "")).includes("date")) { headerIdx = i; break; }
  }

  const headerRow = rows[headerIdx];
  const colMap = {};
  const mappedFields = new Set(); // first-match-wins: once a field is claimed, ignore duplicates
  headerRow.forEach((h, i) => {
    if (h == null || typeof h === "object") return;
    const norm = normalizeHeader(String(h));
    if (HEADER_BLACKLIST.has(norm)) return;
    const field = HEADER_MAP[norm];
    if (!field) return;
    if (mappedFields.has(field)) return; // col G "Info"→client wins over col H "Client"→client
    colMap[i] = field;
    mappedFields.add(field);
  });
  // Fallback: col G (index 6) is always Info/client in the Skyline template
  if (!mappedFields.has("client") && headerRow.length > 6) { colMap[6] = "client"; mappedFields.add("client"); }

  const sessions = [], warnings = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cols = rows[i] || [];
    const row = {};
    // Never overwrite a non-null value with null — col G wins over col H's empty cells
    Object.entries(colMap).forEach(([idx, field]) => {
      const val = cols[idx] ?? null;
      if (row[field] == null || val != null) row[field] = val;
    });
    if (row.date == null) continue;
    if (typeof row.date === "string" && isNaN(new Date(row.date))) continue;
    const s = buildSession(row);
    if (!s) continue;
    if (s._suspectYear) warnings.push(`Row ${i+1}: date ${s.date} — year looks wrong (did you mean ${s.date.replace(/^\d{4}/, new Date().getFullYear())}?)`);
    sessions.push(s);
  }
  return { sessions, warnings };
};

const addDays = (d, n) => {
  const dt = new Date(d + "T12:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

const relDate = (d) => {
  if (!d) return "";
  const t = todayStr();
  if (d === t) return "Today";
  const diff = Math.round((new Date(d+"T12:00:00") - new Date(t+"T12:00:00")) / 86400000);
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  return `in ${diff}d`;
};

const isOverdue = (d) => !!d && d < todayStr();
const isDueOrOverdue = (d) => !!d && d <= todayStr();

const load = (key, fb) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const save = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };

const copyText = (text, cb) => {
  const done = () => cb && cb();
  if (navigator.clipboard) { navigator.clipboard.writeText(text).then(done).catch(done); return; }
  const t = document.createElement("textarea");
  t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
  document.body.appendChild(t); t.focus(); t.select();
  try { document.execCommand("copy"); } catch {}
  t.remove(); done();
};

const loadDaily = () => {
  const d = load(SK.daily, null);
  const t = todayStr();
  if (!d || d.date !== t) { const f = { date: t, dmSent: 0 }; save(SK.daily, f); return f; }
  return d;
};

/* ================================================================
   STYLES
================================================================ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body, #root { height: 100%; background: #0A0A0C; }
  
  :root {
    --bg: #0A0A0C;
    --surface: #141416;
    --elevated: #1C1C1F;
    --border: rgba(255,255,255,0.07);
    --text: #F2F2F7;
    --sub: #AEAEB2;
    --muted: #636366;
    --accent: #FF9F0A;
    --accent-dim: rgba(255,159,10,0.12);
    --accent-mid: rgba(255,159,10,0.25);
    --success: #30D158;
    --danger: #FF453A;
    --radius: 16px;
    --radius-sm: 10px;
    --font: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  }

  .app {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    min-height: 100%;
    max-width: 430px;
    margin: 0 auto;
    position: relative;
    overflow-x: hidden;
  }

  .screen-wrap { padding-bottom: 80px; min-height: 100vh; }

  .screen { padding: 0 0 24px; }

  /* ---- Header ---- */
  .screen-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    padding: 56px 20px 20px;
  }
  .screen-title { font-size: 28px; font-weight: 600; letter-spacing: -0.5px; }
  .screen-date { font-size: 13px; color: var(--muted); margin-top: 2px; font-weight: 400; }

  /* ---- Buttons ---- */
  .btn-circle {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--elevated); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; color: var(--text); transition: opacity 0.15s;
  }
  .btn-circle:active { opacity: 0.6; }

  .btn-primary {
    background: var(--accent); color: #000;
    border: none; border-radius: var(--radius-sm);
    padding: 12px 20px; font-size: 15px; font-weight: 600;
    cursor: pointer; font-family: var(--font);
    transition: opacity 0.15s;
  }
  .btn-primary:active { opacity: 0.75; }

  .btn-ghost {
    background: transparent; color: var(--sub);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 9px 14px; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: var(--font);
    transition: all 0.15s;
  }
  .btn-ghost:active { background: var(--elevated); }

  .btn-action {
    background: var(--accent-dim); color: var(--accent);
    border: 1px solid var(--accent-mid); border-radius: var(--radius-sm);
    padding: 9px 14px; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: var(--font);
    white-space: nowrap; transition: all 0.15s;
  }
  .btn-action:active { background: var(--accent-mid); }

  .btn-danger {
    background: rgba(255,69,58,0.1); color: var(--danger);
    border: 1px solid rgba(255,69,58,0.2); border-radius: var(--radius-sm);
    padding: 12px 20px; font-size: 15px; font-weight: 600;
    cursor: pointer; font-family: var(--font); width: 100%;
    transition: all 0.15s;
  }
  .btn-danger:active { background: rgba(255,69,58,0.2); }

  /* ---- Motivator Card ---- */
  .motivator-card {
    margin: 0 16px 8px;
    background: var(--elevated);
    border-radius: 20px;
    padding: 24px 20px;
    text-align: center;
    border: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }
  .motivator-card::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(255,159,10,0.06) 0%, transparent 70%);
    pointer-events: none;
  }
  .motivator-emoji { font-size: 52px; line-height: 1; margin-bottom: 10px; display: block; }
  .motivator-label {
    font-size: 13px; font-weight: 600; letter-spacing: 1.5px;
    color: var(--accent); margin-bottom: 4px;
  }
  .motivator-sub { font-size: 14px; color: var(--sub); margin-bottom: 18px; }
  .progress-track {
    height: 6px; background: var(--border); border-radius: 99px;
    overflow: hidden; margin-bottom: 8px;
  }
  .progress-fill {
    height: 100%; background: linear-gradient(90deg, #FF9F0A, #FFD60A);
    border-radius: 99px; transition: width 0.5s cubic-bezier(0.34,1.56,0.64,1);
  }
  .progress-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }

  /* ---- Task Sections ---- */
  .section { margin: 20px 0 0; }
  .section-header {
    display: flex; align-items: center; gap: 8px;
    padding: 0 20px 10px;
  }
  .section-title { font-size: 13px; font-weight: 600; letter-spacing: 0.3px; color: var(--sub); text-transform: uppercase; }
  .section-badge {
    background: var(--accent-dim); color: var(--accent);
    font-size: 11px; font-weight: 700; padding: 2px 7px;
    border-radius: 99px; border: 1px solid var(--accent-mid);
  }

  /* ---- Task Items ---- */
  .task-list { display: flex; flex-direction: column; gap: 1px; }
  .task-item {
    background: var(--surface);
    padding: 14px 16px;
    display: flex; align-items: center; gap: 12px;
    cursor: pointer; transition: background 0.12s;
  }
  .task-item:first-child { border-radius: var(--radius) var(--radius) 0 0; }
  .task-item:last-child { border-radius: 0 0 var(--radius) var(--radius); }
  .task-item:only-child { border-radius: var(--radius); }
  .task-item:active { background: var(--elevated); }

  .task-info { flex: 1; min-width: 0; }
  .task-handle { font-size: 15px; font-weight: 500; truncate: ellipsis; white-space: nowrap; overflow: hidden; }
  .task-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  .task-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  .pill {
    display: inline-flex; align-items: center;
    font-size: 11px; font-weight: 600; padding: 2px 8px;
    border-radius: 99px; white-space: nowrap;
  }
  .pill-stage { background: rgba(255,255,255,0.06); color: var(--sub); }
  .pill-due-overdue { background: rgba(255,69,58,0.15); color: var(--danger); }
  .pill-due-today { background: rgba(255,159,10,0.15); color: var(--accent); }
  .pill-due-soon { background: rgba(0,122,255,0.12); color: #007AFF; }

  .copy-btn {
    width: 30px; height: 30px; border-radius: 8px;
    background: var(--elevated); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: background 0.12s; flex-shrink: 0;
  }
  .copy-btn:active { background: var(--border); }
  .copy-btn.copied { background: rgba(48,209,88,0.15); }

  /* ---- Empty state ---- */
  .empty-state { text-align: center; padding: 52px 32px; }
  .empty-emoji { font-size: 40px; margin-bottom: 12px; }
  .empty-title { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
  .empty-sub { font-size: 14px; color: var(--muted); margin-bottom: 24px; }

  /* ---- Pipeline ---- */
  .pipeline-stage-group { margin-bottom: 4px; }
  .stage-header {
    padding: 16px 20px 8px;
    display: flex; align-items: center; gap: 8px;
  }
  .stage-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .stage-name { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--sub); }
  .stage-count { font-size: 12px; color: var(--muted); }

  .lead-card {
    background: var(--surface); margin: 0 16px; padding: 14px 16px;
    border-radius: var(--radius); margin-bottom: 2px; cursor: pointer;
    display: flex; align-items: center; gap: 12px;
    transition: background 0.12s;
    border: 1px solid transparent;
  }
  .lead-card:active { background: var(--elevated); border-color: var(--border); }
  .lead-avatar {
    width: 40px; height: 40px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; font-weight: 700; flex-shrink: 0;
    color: #000;
  }
  .lead-info { flex: 1; min-width: 0; }
  .lead-name { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lead-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .lead-chevron { color: var(--muted); font-size: 14px; flex-shrink: 0; }

  /* ---- Insights ---- */
  .insights-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 10px; padding: 0 16px; margin-bottom: 12px;
  }
  .metric-card {
    background: var(--surface); border-radius: var(--radius);
    padding: 16px; border: 1px solid var(--border);
  }
  .metric-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 6px; }
  .metric-value { font-size: 26px; font-weight: 600; letter-spacing: -0.5px; }
  .metric-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .metric-bar { height: 3px; background: var(--border); border-radius: 99px; margin-top: 8px; overflow: hidden; }
  .metric-bar-fill { height: 100%; border-radius: 99px; transition: width 0.6s ease; }

  .insights-section { padding: 0 16px; margin-bottom: 20px; }
  .insights-section-title { font-size: 13px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-top: 8px; }

  .settings-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .settings-row:first-child { border-radius: var(--radius) var(--radius) 0 0; }
  .settings-row:last-child { border-radius: 0 0 var(--radius) var(--radius); border-bottom: none; }
  .settings-row:only-child { border-radius: var(--radius); }
  .settings-label { font-size: 15px; color: var(--text); }
  .settings-input {
    background: transparent; border: none; outline: none;
    color: var(--accent); font-size: 15px; font-weight: 500;
    text-align: right; width: 80px; font-family: var(--font);
  }

  /* ---- Bottom Nav ---- */
  .bottom-nav {
    position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 430px;
    background: rgba(14,14,16,0.92);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-top: 1px solid var(--border);
    display: flex; padding: 8px 0 calc(8px + env(safe-area-inset-bottom, 0px));
    z-index: 100;
  }
  .nav-btn {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
    background: none; border: none; cursor: pointer; padding: 4px 0;
    position: relative; transition: opacity 0.12s;
  }
  .nav-btn:active { opacity: 0.6; }
  .nav-icon { font-size: 20px; line-height: 1; filter: grayscale(1); opacity: 0.4; transition: all 0.2s; }
  .nav-label { font-size: 10px; font-weight: 500; color: var(--muted); font-family: var(--font); transition: color 0.2s; }
  .nav-btn.active .nav-icon { filter: none; opacity: 1; }
  .nav-btn.active .nav-label { color: var(--accent); }
  .nav-badge {
    position: absolute; top: 0; right: calc(50% - 18px);
    background: var(--danger); color: #fff;
    font-size: 10px; font-weight: 700; min-width: 16px; height: 16px;
    border-radius: 99px; padding: 0 4px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--bg);
  }

  /* ---- Bottom Sheet ---- */
  .sheet-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    z-index: 200; animation: fadeIn 0.2s ease;
  }
  .sheet {
    position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 430px;
    background: var(--surface);
    border-radius: 24px 24px 0 0;
    z-index: 201;
    max-height: 92vh; overflow-y: auto;
    animation: slideUp 0.3s cubic-bezier(0.34, 1.3, 0.64, 1);
    padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .sheet-handle {
    width: 36px; height: 4px; border-radius: 99px;
    background: var(--border); margin: 12px auto 4px;
  }
  .sheet-header {
    padding: 12px 20px 16px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }
  .sheet-title { font-size: 18px; font-weight: 600; }
  .sheet-close {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--elevated); border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; color: var(--muted);
  }
  .sheet-section { padding: 16px 20px; border-bottom: 1px solid var(--border); }
  .sheet-section:last-child { border-bottom: none; }
  .sheet-section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 12px; }

  .quick-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .qa-btn {
    background: var(--elevated); border: 1px solid var(--border);
    color: var(--text); border-radius: var(--radius-sm);
    padding: 10px 14px; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: var(--font); transition: all 0.15s;
  }
  .qa-btn:active { background: var(--border); }
  .qa-btn.primary {
    background: var(--accent-dim); border-color: var(--accent-mid); color: var(--accent);
  }

  .form-row {
    display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;
  }
  .form-row:last-child { margin-bottom: 0; }
  .form-label { font-size: 12px; font-weight: 500; color: var(--muted); }
  .form-input {
    background: var(--elevated); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 11px 14px;
    color: var(--text); font-size: 15px; outline: none;
    font-family: var(--font); transition: border-color 0.15s;
    width: 100%;
  }
  .form-input:focus { border-color: var(--accent); }
  .form-select {
    background: var(--elevated); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 11px 14px;
    color: var(--text); font-size: 15px; outline: none;
    font-family: var(--font); width: 100%;
    appearance: none; cursor: pointer;
  }
  .form-select:focus { border-color: var(--accent); }

  .scripts-list { display: flex; flex-direction: column; gap: 8px; }
  .script-item {
    background: var(--elevated); border-radius: var(--radius-sm);
    padding: 12px 14px; display: flex; align-items: flex-start; gap: 10px;
  }
  .script-label { font-size: 11px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 4px; }
  .script-text { font-size: 13px; color: var(--sub); line-height: 1.5; flex: 1; }

  /* ---- Stage pipeline bar ---- */
  .stage-pipeline {
    padding: 0 20px; margin-bottom: 8px;
  }

  /* ---- Toast ---- */
  .toast-stack {
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 999; display: flex; flex-direction: column; gap: 8px;
    pointer-events: none; width: calc(100% - 32px); max-width: 380px;
  }
  .toast {
    background: var(--elevated); border: 1px solid var(--border);
    border-radius: 12px; padding: 12px 16px;
    font-size: 14px; font-weight: 500; font-family: var(--font);
    color: var(--text); text-align: center;
    animation: toastIn 0.3s cubic-bezier(0.34, 1.4, 0.64, 1);
    backdrop-filter: blur(20px);
  }
  .toast.success { border-color: rgba(48,209,88,0.3); background: rgba(48,209,88,0.1); color: var(--success); }
  .toast.error { border-color: rgba(255,69,58,0.3); background: rgba(255,69,58,0.1); color: var(--danger); }

  /* ---- Add Lead form ---- */
  .source-pills { display: flex; gap: 8px; }
  .source-pill {
    flex: 1; padding: 10px 0; border-radius: var(--radius-sm);
    background: var(--elevated); border: 1px solid var(--border);
    color: var(--sub); font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: var(--font); text-align: center;
    transition: all 0.15s;
  }
  .source-pill.selected { background: var(--accent-dim); border-color: var(--accent-mid); color: var(--accent); }

  /* ---- Divider ---- */
  .divider { height: 1px; background: var(--border); margin: 0 20px; }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateX(-50%) translateY(100%); } to { transform: translateX(-50%) translateY(0); } }
  @keyframes toastIn { from { opacity: 0; transform: scale(0.92) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }

  /* ---- Import ---- */
  .import-zone {
    border: 1.5px dashed var(--border); border-radius: var(--radius);
    padding: 28px 20px; text-align: center; cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
    position: relative;
  }
  .import-zone:hover, .import-zone.drag { border-color: var(--accent); background: var(--accent-dim); }
  .import-zone input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .import-icon { font-size: 28px; margin-bottom: 8px; }
  .import-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .import-sub { font-size: 13px; color: var(--muted); }

  .import-result {
    background: var(--elevated); border-radius: var(--radius-sm);
    padding: 14px 16px; border: 1px solid var(--border);
  }
  .import-result-row { display: flex; justify-content: space-between; padding: 5px 0; }
  .import-result-label { font-size: 13px; color: var(--muted); }
  .import-result-val { font-size: 13px; font-weight: 600; }

  .weekly-card {
    background: var(--surface); border-radius: var(--radius);
    padding: 20px; border: 1px solid var(--border); margin: 0 16px 12px;
    position: relative; overflow: hidden;
  }
  .weekly-card::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(48,209,88,0.05) 0%, transparent 70%);
    pointer-events: none;
  }
  .weekly-amount { font-size: 36px; font-weight: 600; letter-spacing: -1px; margin: 6px 0 2px; }
  .weekly-gap-pill {
    display: inline-flex; align-items: center; gap: 4px;
    background: rgba(255,69,58,0.12); color: var(--danger);
    border-radius: 99px; padding: 3px 10px; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(255,69,58,0.2);
  }
  .weekly-gap-pill.met { background: rgba(48,209,88,0.12); color: var(--success); border-color: rgba(48,209,88,0.2); }
  .weekly-sessions { display: flex; flex-direction: column; gap: 2px; margin-top: 12px; }
  .weekly-session-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 0; border-top: 1px solid var(--border); font-size: 13px;
  }
  .weekly-session-client { color: var(--sub); flex: 1; }
  .weekly-session-status { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 99px; }
  .status-paid { background: rgba(48,209,88,0.12); color: var(--success); }
  .status-pending { background: rgba(255,159,10,0.12); color: var(--accent); }
  .weekly-session-rev { font-weight: 600; color: var(--text); }

  /* ---- Studio ---- */
  .studio-section { padding: 0 16px; margin-bottom: 2px; }
  .studio-section-label {
    font-size: 10px; font-weight: 700; letter-spacing: 1.8px;
    text-transform: uppercase; color: var(--muted); padding: 20px 0 8px;
  }
  .studio-card {
    background: var(--surface); border-radius: var(--radius);
    border: 1px solid var(--border); padding: 18px;
  }
  .kpi-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
  .kpi-cell {
    background: var(--surface); padding: 14px 16px; border: 1px solid var(--border);
  }
  .kpi-cell:nth-child(1) { border-radius: var(--radius) 0 0 0; }
  .kpi-cell:nth-child(2) { border-radius: 0 var(--radius) 0 0; border-left: none; }
  .kpi-cell:nth-child(3) { border-radius: 0 0 0 var(--radius); border-top: none; }
  .kpi-cell:nth-child(4) { border-radius: 0 0 var(--radius) 0; border-top: none; border-left: none; }
  .kpi-cell-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); margin-bottom: 6px; }
  .kpi-cell-value { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
  .kpi-cell-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .month-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 0; border-top: 1px solid var(--border);
  }
  .month-row:first-child { border-top: none; }
  .month-label { font-size: 11px; font-weight: 600; color: var(--sub); width: 40px; flex-shrink: 0; }
  .month-bar-wrap { flex: 1; height: 5px; background: var(--elevated); border-radius: 99px; overflow: hidden; }
  .month-bar-fill { height: 100%; border-radius: 99px; transition: width 0.6s ease; }
  .month-paid { font-size: 12px; font-weight: 700; width: 52px; text-align: right; flex-shrink: 0; }
  .month-count { font-size: 11px; color: var(--muted); width: 28px; text-align: right; flex-shrink: 0; }
  .client-row {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 0; border-top: 1px solid var(--border);
  }
  .client-row:first-child { border-top: none; }
  .client-rank { font-size: 11px; color: var(--muted); width: 14px; text-align: center; flex-shrink: 0; }
  .client-name { font-size: 13px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .client-pct { font-size: 11px; color: var(--muted); flex-shrink: 0; }
  .client-paid { font-size: 13px; font-weight: 700; flex-shrink: 0; margin-left: 4px; }
  .studio-week-big { font-size: 38px; font-weight: 700; letter-spacing: -1.5px; line-height: 1; margin: 8px 0 4px; }
  .studio-pacing { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .studio-pacing-label { font-size: 12px; color: var(--muted); }
  .studio-pacing-val { font-size: 14px; font-weight: 700; }
  .studio-import-bar {
    margin: 0 16px 16px; padding: 14px 16px;
    background: var(--surface); border-radius: var(--radius);
    border: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px;
  }
  .studio-import-info { flex: 1; min-width: 0; }
  .studio-import-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .studio-import-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .studio-empty {
    text-align: center; padding: 60px 32px 40px;
  }
  .studio-empty-icon { font-size: 44px; margin-bottom: 14px; }
  .studio-empty-title { font-size: 18px; font-weight: 600; margin-bottom: 6px; }
  .studio-empty-sub { font-size: 14px; color: var(--muted); margin-bottom: 28px; line-height: 1.6; }
`;

/* ================================================================
   MAIN APP
================================================================ */
export default function App() {
  const [leads, setLeads] = useState(() => load(SK.leads, []));
  const [tasks, setTasks] = useState(() => load(SK.tasks, []));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...load(SK.settings, {}) }));
  const [daily, setDaily] = useState(loadDaily);
  const [sessions, setSessions] = useState(() => load(SK.sessions, []));
  const [dmHistory, setDmHistory] = useState(() => load(SK.dmHistory, {}));
  const [tab, setTab] = useState("today");
  const [sheet, setSheet] = useState(null);
  const [toasts, setToasts] = useState([]);

  useEffect(() => save(SK.leads, leads), [leads]);
  useEffect(() => save(SK.tasks, tasks), [tasks]);
  useEffect(() => save(SK.settings, settings), [settings]);
  useEffect(() => save(SK.daily, daily), [daily]);
  useEffect(() => save(SK.sessions, sessions), [sessions]);
  useEffect(() => save(SK.dmHistory, dmHistory), [dmHistory]);

  const toast = (msg, type = "default") => {
    const id = genId();
    setToasts(ts => [...ts, { id, msg, type }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 2600);
  };

  /* ---- ACTIONS ---- */
  const A = {
    dmSent(leadId) {
      const t = todayStr();
      const newCount = Math.min(daily.dmSent + 1, settings.dailyDmTarget);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : {
        ...l, stage: l.stage === "New" ? "Contacted" : l.stage,
        lastContacted: t, nextActionDate: addDays(t, 2)
      }));
      setTasks(ts => [...ts,
        { id: genId(), leadId, type: "followup", dueDate: addDays(t, 2), done: false },
        { id: genId(), leadId, type: "followup", dueDate: addDays(t, 7), done: false }
      ]);
      setDaily({ ...daily, date: t, dmSent: newCount });
      setDmHistory(h => ({ ...h, [t]: newCount })); // persist per-date for scoreboard
      if (newCount >= settings.dailyDmTarget) toast("💎 Daily goal crushed! DRIPPED.", "success");
      else toast(`DM sent ✓ (${newCount}/${settings.dailyDmTarget})`);
    },
    followupSent(leadId) {
      const t = todayStr();
      setTasks(ts => ts.map(tk =>
        tk.leadId === leadId && tk.type === "followup" && !tk.done && isDueOrOverdue(tk.dueDate)
          ? { ...tk, done: true } : tk
      ));
      setTasks(ts => [...ts, { id: genId(), leadId, type: "followup", dueDate: addDays(t, 7), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : { ...l, lastContacted: t, nextActionDate: addDays(t, 7) }));
      toast("Follow-up logged ✓");
    },
    bookedTest(leadId) {
      setTasks(ts => ts.map(tk => tk.leadId === leadId && tk.type === "followup" && !tk.done ? { ...tk, done: true } : tk));
      setTasks(ts => [...ts, { id: genId(), leadId, type: "booking_confirm", dueDate: todayStr(), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : { ...l, stage: "Booked Test", nextActionDate: todayStr() }));
      toast("Test session booked 🎯");
    },
    completedTest(leadId) {
      setTasks(ts => ts.map(tk => tk.leadId === leadId && tk.type === "followup" && !tk.done ? { ...tk, done: true } : tk));
      setTasks(ts => [...ts, { id: genId(), leadId, type: "offer_full", dueDate: addDays(todayStr(), 1), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : { ...l, stage: "Completed Test", nextActionDate: addDays(todayStr(), 1) }));
      toast("Test done — offer full block tomorrow");
    },
    offeredFull(leadId) {
      setTasks(ts => ts.map(tk => tk.leadId === leadId && tk.type === "offer_full" && !tk.done ? { ...tk, done: true } : tk));
      setTasks(ts => [...ts, { id: genId(), leadId, type: "followup", dueDate: addDays(todayStr(), 3), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : { ...l, nextActionDate: addDays(todayStr(), 3) }));
      toast("Offer logged — follow up in 3 days");
    },
    bookedFull(leadId) {
      setTasks(ts => ts.map(tk => tk.leadId === leadId && !tk.done ? { ...tk, done: true } : tk));
      setTasks(ts => [...ts, { id: genId(), leadId, type: "booking_confirm", dueDate: todayStr(), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : { ...l, stage: "Booked Full", nextActionDate: todayStr() }));
      toast("Full block booked 💪");
    },
    completed(leadId, hrs, rev) {
      setTasks(ts => [...ts, { id: genId(), leadId, type: "followup", dueDate: addDays(todayStr(), 30), done: false }]);
      setLeads(ls => ls.map(l => l.id !== leadId ? l : {
        ...l, stage: "Completed", nextActionDate: addDays(todayStr(), 30),
        completedAt: todayStr(),
        ...(hrs ? { sessionHours: Number(hrs) } : {}),
        ...(rev ? { sessionRevenue: Number(rev) } : {}),
      }));
      toast("Session complete — repeat DM in 30 days 🔄");
    },
    confirmed(leadId) {
      setTasks(ts => ts.map(tk => tk.leadId === leadId && tk.type === "booking_confirm" && !tk.done ? { ...tk, done: true } : tk));
      toast("Booking confirmed ✓");
    },
  };

  /* ---- COMPUTED ---- */
  const t = todayStr();
  const todayFollowups = tasks.filter(tk => !tk.done && tk.type === "followup" && isDueOrOverdue(tk.dueDate));
  const todayConfirms = tasks.filter(tk => !tk.done && tk.type === "booking_confirm" && isDueOrOverdue(tk.dueDate));
  const todayOffers = tasks.filter(tk => !tk.done && tk.type === "offer_full" && isDueOrOverdue(tk.dueDate));
  const dmSlotsLeft = Math.max(0, settings.dailyDmTarget - daily.dmSent);
  const newLeadsForDMs = leads.filter(l => l.stage === "New").slice(0, dmSlotsLeft);
  const totalActions = todayFollowups.length + todayConfirms.length + todayOffers.length;

  const getLead = (id) => leads.find(l => l.id === id);
  const sheetLead = sheet && sheet !== "add" ? getLead(sheet) : null;

  const addLead = (l) => {
    setLeads(ls => [...ls, { id: genId(), lastContacted: null, nextActionDate: null, bookingDateTime: null, notes: "", tags: [], sessionHours: 0, sessionRevenue: 0, completedAt: null, ...l }]);
    toast("Lead added ✓");
  };

  const removeLead = (id) => {
    setLeads(ls => ls.filter(l => l.id !== id));
    setTasks(ts => ts.filter(tk => tk.leadId !== id));
    setSheet(null);
    toast("Lead removed");
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <div className="toast-stack">
          {toasts.map(t => <ToastEl key={t.id} msg={t.msg} type={t.type} />)}
        </div>

        <div className="screen-wrap">
          {tab === "today" && (
            <TodayScreen
              daily={daily} settings={settings}
              followups={todayFollowups} confirms={todayConfirms} offers={todayOffers}
              newLeads={newLeadsForDMs} getLead={getLead}
              onSelectLead={setSheet} onAdd={() => setSheet("add")}
              actions={A} toast={toast}
              sessions={sessions}
            />
          )}
          {tab === "pipeline" && (
            <PipelineScreen
              leads={leads} tasks={tasks}
              onSelectLead={setSheet} onAdd={() => setSheet("add")}
            />
          )}
          {tab === "insights" && (
            <InsightsScreen
              leads={leads} tasks={tasks} settings={settings}
              onUpdateSettings={setSettings}
              sessions={sessions}
              dmHistory={dmHistory}
              onImport={imported => {
                const merged = mergeSessionArrays(sessions, imported);
                setSessions(merged);
                const added = merged.length - sessions.length;
                toast(`${added} new session${added !== 1 ? "s" : ""} added (${merged.length} total) ✓`, "success");
              }}
              onClearSessions={() => { setSessions([]); toast("Import cleared"); }}
            />
          )}
          {tab === "studio" && (
            <StudioScreen
              sessions={sessions}
              settings={settings}
              onImport={imported => {
                const merged = mergeSessionArrays(sessions, imported);
                setSessions(merged);
                const added = merged.length - sessions.length;
                toast(`${added} new session${added !== 1 ? "s" : ""} added ✓`, "success");
              }}
              onClearSessions={() => { setSessions([]); toast("Sessions cleared"); }}
            />
          )}
        </div>

        <nav className="bottom-nav">
          {[
            { key: "today",    icon: "⚡", label: "Today",    badge: totalActions },
            { key: "pipeline", icon: "◈", label: "Pipeline",  badge: 0 },
            { key: "studio",   icon: "◉", label: "Studio",    badge: 0 },
            { key: "insights", icon: "◎", label: "Insights",  badge: 0 },
          ].map(({ key, icon, label, badge }) => (
            <button key={key} className={`nav-btn ${tab===key?"active":""}`} onClick={() => setTab(key)}>
              <span className="nav-icon">{icon}</span>
              <span className="nav-label">{label}</span>
              {badge > 0 && <span className="nav-badge">{badge}</span>}
            </button>
          ))}
        </nav>

        {sheetLead && (
          <LeadSheet
            lead={sheetLead}
            tasks={tasks.filter(tk => tk.leadId === sheetLead.id)}
            actions={A}
            onClose={() => setSheet(null)}
            onUpdate={upd => {
              setLeads(ls => ls.map(l => l.id === sheetLead.id ? { ...l, ...upd } : l));
              setSheet(id => id); // keep open
            }}
            onDelete={() => removeLead(sheetLead.id)}
            toast={toast}
          />
        )}
        {sheet === "add" && (
          <AddLeadSheet onClose={() => setSheet(null)} onAdd={l => { addLead(l); setSheet(null); }} />
        )}
      </div>
    </>
  );
}

/* ================================================================
   TODAY SCREEN
================================================================ */
function TodayScreen({ daily, settings, followups, confirms, offers, newLeads, getLead, onSelectLead, onAdd, actions, toast, sessions }) {
  const pct = Math.min(daily.dmSent / settings.dailyDmTarget, 1);
  const mot = MOTIVATOR[Math.min(daily.dmSent, settings.dailyDmTarget)];
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const hasActions = confirms.length + followups.length + offers.length + newLeads.length > 0;

  // Weekly revenue from imported sessions
  const weekStart = currentWeekStart();
  const weekEnd = addDays(weekStart, 6);
  const weekSessions = sessions.filter(s => s.date >= weekStart && s.date <= weekEnd);
  const weeklyPaid = weekSessions.reduce((s, r) => s + r.paidRevenue, 0);
  const weeklyGoal = settings.weeklyRevenueGoal || 1500;
  const weeklyPct = Math.min(weeklyPaid / weeklyGoal, 1);
  const weeklyGap = Math.max(0, weeklyGoal - weeklyPaid);
  const weeklyMet = weeklyGap === 0;
  const hasImport = sessions.length > 0;

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Today</div>
          <div className="screen-date">{dateStr}</div>
        </div>
        <button className="btn-circle" onClick={onAdd} style={{ fontSize: 22, background: "var(--accent)", color: "#000" }}>+</button>
      </div>

      {/* Motivator */}
      <div className="motivator-card">
        <span className="motivator-emoji">{mot.emoji}</span>
        <div className="motivator-label">{mot.label}</div>
        <div className="motivator-sub">{mot.sub}</div>
        <div className="progress-track" style={{ marginBottom: 6 }}>
          <div className="progress-fill" style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="progress-meta">
          <span>{daily.dmSent} DMs sent</span>
          <span>Goal: {settings.dailyDmTarget}</span>
        </div>
      </div>

      {confirms.length > 0 && (
        <TaskSection title="Confirm Bookings" badge={confirms.length} color="#FF9F0A">
          {confirms.map(tk => {
            const lead = getLead(tk.leadId);
            if (!lead) return null;
            return (
              <TaskItem key={tk.id} lead={lead} dueLabel="Today" dueType="today"
                onOpen={() => onSelectLead(lead.id)}
                primaryLabel="Confirmed ✓" primaryScript="confirm"
                onPrimary={() => actions.confirmed(lead.id)}
                toast={toast}
              />
            );
          })}
        </TaskSection>
      )}

      {/* Offers */}
      {offers.length > 0 && (
        <TaskSection title="Offer Full Block" badge={offers.length} color="#BF5AF2">
          {offers.map(tk => {
            const lead = getLead(tk.leadId);
            if (!lead) return null;
            const overdue = isOverdue(tk.dueDate);
            return (
              <TaskItem key={tk.id} lead={lead}
                dueLabel={overdue ? `${relDate(tk.dueDate)} overdue` : "Today"}
                dueType={overdue ? "overdue" : "today"}
                onOpen={() => onSelectLead(lead.id)}
                primaryLabel="Offer Sent" primaryScript="close"
                onPrimary={() => actions.offeredFull(lead.id)}
                toast={toast}
              />
            );
          })}
        </TaskSection>
      )}

      {/* Follow-ups */}
      {followups.length > 0 && (
        <TaskSection title="Follow-ups" badge={followups.length}>
          {followups.map(tk => {
            const lead = getLead(tk.leadId);
            if (!lead) return null;
            const overdue = isOverdue(tk.dueDate);
            return (
              <TaskItem key={tk.id} lead={lead}
                dueLabel={overdue ? `${relDate(tk.dueDate)}` : "Today"}
                dueType={overdue ? "overdue" : "today"}
                onOpen={() => onSelectLead(lead.id)}
                primaryLabel="Sent ✓" primaryScript="followup"
                onPrimary={() => actions.followupSent(lead.id)}
                toast={toast}
              />
            );
          })}
        </TaskSection>
      )}

      {/* New DMs */}
      {daily.dmSent < settings.dailyDmTarget && (
        <TaskSection title="Send DMs" badge={`${daily.dmSent}/${settings.dailyDmTarget}`} color="#5E5CE6">
          {newLeads.length > 0 ? newLeads.map(lead => (
            <TaskItem key={lead.id} lead={lead} dueLabel="New" dueType="soon"
              onOpen={() => onSelectLead(lead.id)}
              primaryLabel="DM Sent" primaryScript="newDm"
              onPrimary={() => actions.dmSent(lead.id)}
              toast={toast}
            />
          )) : (
            <div style={{ padding: "16px 16px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 10 }}>No new leads queued.</div>
              <button className="btn-action" onClick={onAdd}>+ Add new lead</button>
            </div>
          )}
        </TaskSection>
      )}

      {!hasActions && daily.dmSent >= settings.dailyDmTarget && (
        <div className="empty-state">
          <div className="empty-emoji">💎</div>
          <div className="empty-title">DRIPPED for today</div>
          <div className="empty-sub">All actions cleared. Pipeline's moving.</div>
          <button className="btn-primary" onClick={onAdd}>+ Add lead</button>
        </div>
      )}

      {/* Revenue Arc Gauge — bottom of screen */}
      <RevenueArcGauge
        weeklyPaid={weeklyPaid}
        weeklyGoal={weeklyGoal}
        weeklyPct={weeklyPct}
        weeklyMet={weeklyMet}
        weeklyGap={weeklyGap}
        weekSessions={weekSessions}
        hasImport={hasImport}
        weekStart={weekStart}
      />
    </div>
  );
}

/* ================================================================
   RUNWAY GAUGE — horizontal progress bar, Apple scoreboard style
   Zero SVG, zero absolute-over-content, zero overlap risk.
================================================================ */
function RevenueArcGauge({ weeklyPaid, weeklyGoal, weeklyPct, weeklyMet, weeklyGap, weekSessions, hasImport, weekStart }) {
  const p   = Math.min(Math.max(weeklyPaid / (weeklyGoal || 1), 0), 1);
  const pct = Math.round(p * 100);

  const fmtShort  = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekLabel = `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}`;

  const msg = p >= 1    ? "Goal hit. Profit mode. 💎"
    : p >= 0.75 ? "Close it out. One more push."
    : p >= 0.5  ? "Halfway. Don't let it cool off."
    : p >= 0.25 ? "Good. Keep the wheel turning."
    :             "Pipeline's cold. Start sliding.";

  // Color ramp tied to progress
  const accent = weeklyMet ? "#30D158"
    : p > 0.75 ? "#FFD60A"
    : p > 0.5  ? "#FF9F0A"
    : p > 0.25 ? "#FF6B35"
    : "#FF453A";

  return (
    <div style={{ marginTop: 24 }}>

      {/* ── HEADER ── */}
      <div style={{ padding: "0 20px 0" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.8, color: "var(--muted)", textTransform: "uppercase", marginBottom: 12 }}>
          {weekLabel}
        </div>

        {/* Big number */}
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-2px", lineHeight: 1, color: weeklyMet ? "var(--success)" : "var(--text)", marginBottom: 4 }}>
          ${weeklyPaid.toLocaleString()}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
          of ${weeklyGoal.toLocaleString()} this week
        </div>

        {/* ── RUNWAY BAR ── */}
        {/* Outer: gives vertical breathing room so dot shadow never overlaps content below */}
        <div style={{ position: "relative", paddingTop: 10, paddingBottom: 10, marginBottom: 4 }}>

          {/* Track — clips its own fill with overflow:hidden */}
          <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
            {/* Tick marks at 25 / 50 / 75 % */}
            {[0.25, 0.5, 0.75].map(t => (
              <div key={t} style={{ position: "absolute", top: 0, bottom: 0, left: `${t * 100}%`, width: 1, background: "rgba(0,0,0,0.25)", zIndex: 2 }} />
            ))}
            {/* Animated fill */}
            <div style={{
              height: "100%",
              width: p > 0 ? `${p * 100}%` : 0,
              minWidth: p > 0 ? 10 : 0,
              borderRadius: 999,
              background: weeklyMet ? "#30D158" : `linear-gradient(90deg, rgba(255,98,0,0.4), ${accent})`,
              transition: "width 700ms cubic-bezier(0.34,1.05,0.64,1)",
            }} />
          </div>

          {/* Glow dot — sibling of track, NOT inside it, so shadow can't bleed into sessions */}
          {p > 0 && (
            <div style={{
              position: "absolute",
              top: "50%",
              left: `${p * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 18, height: 18, borderRadius: "50%",
              background: accent,
              boxShadow: `0 0 0 5px ${weeklyMet ? "rgba(48,209,88,0.2)" : "rgba(255,98,0,0.2)"}, 0 2px 12px ${weeklyMet ? "rgba(48,209,88,0.45)" : "rgba(255,98,0,0.45)"}`,
              transition: "left 700ms cubic-bezier(0.34,1.05,0.64,1), background 0.4s ease",
              zIndex: 3,
            }} />
          )}
        </div>

        {/* $0 / goal end-labels */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", fontWeight: 500, marginBottom: 18, opacity: 0.6 }}>
          <span>$0</span>
          <span>{pct}%</span>
          <span>${weeklyGoal.toLocaleString()}</span>
        </div>

        {/* Pill + motivational microcopy */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, padding: "5px 14px", borderRadius: 99, flexShrink: 0,
            background: weeklyMet ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.08)",
            color: weeklyMet ? "var(--success)" : "var(--danger)",
            border: `1px solid ${weeklyMet ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.18)"}`,
          }}>
            {weeklyMet ? "✓ Goal reached" : `$${weeklyGap.toLocaleString()} remaining`}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right", lineHeight: 1.4, flex: 1 }}>
            {msg}
          </div>
        </div>
      </div>

      {/* ── SESSION ROWS — always in flow, below the bar, never overlapping ── */}
      {weekSessions.length > 0 && (
        <div style={{ margin: "16px 20px 0" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>
            This week
          </div>
          {weekSessions.map((s, i) => {
            const dayLabel  = new Date(s.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            const typeLabel = s.hoursLabel || (s.hours > 0 ? `${s.hours}h` : s.format || "");
            const paid      = s.status?.toLowerCase() === "paid";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: paid ? "var(--success)" : "var(--accent)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.client || "Session"}{typeLabel ? ` · ${typeLabel}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{dayLabel}</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, flexShrink: 0, background: paid ? "rgba(48,209,88,0.1)" : "rgba(255,159,10,0.1)", color: paid ? "var(--success)" : "var(--accent)" }}>
                  {s.status || "—"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: s.paidRevenue > 0 ? "var(--text)" : "var(--muted)" }}>
                  ${s.paidRevenue.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!hasImport && (
        <div style={{ textAlign: "center", padding: "16px 40px 8px", fontSize: 12, color: "rgba(255,255,255,0.18)", lineHeight: 1.6 }}>
          Import your spreadsheet in Studio to see revenue here
        </div>
      )}
      {hasImport && weekSessions.length === 0 && (
        <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", padding: "16px 0 8px" }}>
          No sessions logged this week
        </div>
      )}
    </div>
  );
}

/* ---- Task Section ---- */
function TaskSection({ title, badge, color, children }) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">{title}</span>
        <span className="section-badge" style={color ? { color, background: `${color}18`, borderColor: `${color}30` } : {}}>
          {badge}
        </span>
      </div>
      <div className="task-list" style={{ margin: "0 16px" }}>
        {children}
      </div>
    </div>
  );
}

/* ---- Task Item ---- */
function TaskItem({ lead, dueLabel, dueType, onOpen, primaryLabel, primaryScript, onPrimary, toast }) {
  const [copied, setCopied] = useState(false);
  const script = SCRIPTS[primaryScript];

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!script) return;
    copyText(script.text, () => {
      setCopied(true);
      toast(`${script.label} copied ✓`);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAction = (e) => {
    e.stopPropagation();
    onPrimary();
  };

  const dueClass = dueType === "overdue" ? "pill-due-overdue" : dueType === "today" ? "pill-due-today" : "pill-due-soon";

  const initial = (lead.handleOrName || "?")[0].toUpperCase();
  const stageColor = STAGE_COLOR[lead.stage] || "#636366";

  return (
    <div className="task-item" onClick={onOpen}>
      <div className="lead-avatar" style={{ background: stageColor + "22", color: stageColor, fontSize: 14, borderRadius: 10 }}>
        {initial}
      </div>
      <div className="task-info">
        <div className="task-handle">{lead.handleOrName}</div>
        <div className="task-meta">
          <span className={`pill ${dueClass}`}>{dueLabel}</span>
          <span className="pill pill-stage">{lead.stage}</span>
        </div>
      </div>
      <div className="task-actions">
        {script && (
          <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy} title="Copy script">
            {copied ? "✓" : "⎘"}
          </button>
        )}
        <button className="btn-action" onClick={handleAction}>{primaryLabel}</button>
      </div>
    </div>
  );
}

/* ================================================================
   PIPELINE SCREEN
================================================================ */
function PipelineScreen({ leads, tasks, onSelectLead, onAdd }) {
  const grouped = useMemo(() => {
    const map = {};
    STAGES.forEach(s => { map[s] = []; });
    leads.forEach(l => { if (map[l.stage]) map[l.stage].push(l); else map["Dormant"].push(l); });
    return map;
  }, [leads]);

  const activeTasks = useMemo(() => {
    const map = {};
    tasks.filter(t => !t.done).forEach(t => { if (!map[t.leadId]) map[t.leadId] = 0; map[t.leadId]++; });
    return map;
  }, [tasks]);

  const totalLeads = leads.length;

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Pipeline</div>
          <div className="screen-date">{totalLeads} lead{totalLeads !== 1 ? "s" : ""} total</div>
        </div>
        <button className="btn-circle" onClick={onAdd} style={{ fontSize: 22, background: "var(--accent)", color: "#000" }}>+</button>
      </div>

      {totalLeads === 0 && (
        <div className="empty-state">
          <div className="empty-emoji">🎙️</div>
          <div className="empty-title">Pipeline is empty</div>
          <div className="empty-sub">Add your first lead to start the flywheel.</div>
          <button className="btn-primary" onClick={onAdd}>Add first lead</button>
        </div>
      )}

      {STAGES.map(stage => {
        const stageLeads = grouped[stage];
        if (!stageLeads || stageLeads.length === 0) return null;
        const color = STAGE_COLOR[stage];
        return (
          <div key={stage} className="pipeline-stage-group">
            <div className="stage-header">
              <div className="stage-dot" style={{ background: color }} />
              <span className="stage-name">{stage}</span>
              <span className="stage-count">({stageLeads.length})</span>
            </div>
            {stageLeads.map(lead => (
              <LeadCard key={lead.id} lead={lead} taskCount={activeTasks[lead.id] || 0} onClick={() => onSelectLead(lead.id)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, taskCount, onClick }) {
  const color = STAGE_COLOR[lead.stage] || "#636366";
  const initial = (lead.handleOrName || "?")[0].toUpperCase();
  const nextAction = lead.nextActionDate ? relDate(lead.nextActionDate) : null;
  const overdue = lead.nextActionDate && isOverdue(lead.nextActionDate);

  return (
    <div className="lead-card" onClick={onClick}>
      <div className="lead-avatar" style={{ background: color + "22", color }}>
        {initial}
      </div>
      <div className="lead-info">
        <div className="lead-name">{lead.handleOrName}</div>
        <div className="lead-meta">
          {lead.source && <span style={{ marginRight: 6 }}>{lead.source}</span>}
          {nextAction && (
            <span style={{ color: overdue ? "var(--danger)" : "var(--muted)" }}>
              {overdue ? `⚠ ${nextAction}` : `→ ${nextAction}`}
            </span>
          )}
          {taskCount > 0 && <span style={{ color: "var(--accent)", marginLeft: 4 }}>· {taskCount} task{taskCount !== 1 ? "s" : ""}</span>}
        </div>
      </div>
      <span className="lead-chevron">›</span>
    </div>
  );
}

/* ================================================================
   INSIGHTS SCREEN
================================================================ */
function InsightsScreen({ leads, tasks, settings, onUpdateSettings, sessions, dmHistory, onImport, onClearSessions }) {
  const today = todayStr();
  const now = new Date(today + "T12:00:00");
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const monthName = now.toLocaleDateString("en-US", { month: "long" });
  const monthStart = thisMonth();

  const metrics = useMemo(() => {
    const active = leads.filter(l => !["Completed", "Dormant"].includes(l.stage));
    const booked = leads.filter(l => ["Booked Test", "Completed Test", "Booked Full"].includes(l.stage));
    const completed = leads.filter(l => l.stage === "Completed");
    const allTested = leads.filter(l => ["Completed Test", "Booked Full", "Completed"].includes(l.stage));
    const convRate = allTested.length ? Math.round((completed.length / allTested.length) * 100) : 0;
    const monthCompleted = completed.filter(l => l.completedAt && l.completedAt.startsWith(monthStart));
    const monthRevenue = monthCompleted.reduce((s, l) => s + (l.sessionRevenue || 0), 0);
    const monthHours = monthCompleted.reduce((s, l) => s + (l.sessionHours || 0), 0);
    const overdueTasks = tasks.filter(tk => !tk.done && isDueOrOverdue(tk.dueDate));
    const followupsDue = overdueTasks.filter(tk => tk.type === "followup").length;
    return { active: active.length, booked: booked.length, completed: completed.length, convRate, monthRevenue, monthHours, followupsDue };
  }, [leads, tasks]);

  const sessionDateRange = useMemo(() => {
    if (!sessions.length) return null;
    const dates = sessions.map(s => s.date).sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [sessions]);

  const revenueProgress = Math.min(
    sessions.filter(s => s.date.startsWith(monthStart)).reduce((a, s) => a + s.paidRevenue, 0) / settings.monthlyRevenueGoal,
    1
  );
  const monthPaid = sessions.filter(s => s.date.startsWith(monthStart)).reduce((a, s) => a + s.paidRevenue, 0);

  const updateSetting = (key, val) => onUpdateSettings({ ...settings, [key]: Number(val) || 0 });

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Insights</div>
          <div className="screen-date">{monthName}</div>
        </div>
      </div>

      <div className="insights-grid">
        <MetricCard label="Follow-ups Due" value={metrics.followupsDue} sub="today" valueColor={metrics.followupsDue > 0 ? "var(--danger)" : "var(--text)"} />
        <MetricCard label="Active Leads" value={metrics.active} sub={`${metrics.booked} booked`} />
        <MetricCard label="Conversion" value={`${metrics.convRate}%`} sub="test → completed" valueColor={metrics.convRate > 50 ? "var(--success)" : "var(--text)"} />
        <MetricCard label="Sessions Done" value={metrics.completed} sub="all time" />
      </div>

      {/* ── MONTHLY SCOREBOARD ── */}
      <MonthlyScoreboard
        year={curYear} month={curMonth} monthName={monthName}
        sessions={sessions} dmHistory={dmHistory} settings={settings}
        monthPaid={monthPaid}
      />

      {/* Monthly Revenue bar */}
      <div style={{ padding: "0 16px", marginBottom: 16 }}>
        <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: "16px", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Monthly Revenue</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Goal: ${settings.monthlyRevenueGoal}</span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.5px", marginBottom: 8 }}>${monthPaid.toLocaleString()}</div>
          <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${revenueProgress * 100}%`, background: revenueProgress >= 1 ? "var(--success)" : "var(--accent)" }} /></div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{Math.round(revenueProgress * 100)}% of goal</div>
        </div>
      </div>

      {/* Import zone — compact always-visible */}
      <ImportZone
        sessions={sessions} dateRange={sessionDateRange}
        onImport={onImport} onClear={onClearSessions}
        weeklyGoal={settings.weeklyRevenueGoal}
        weekStart={getMondayWeekStart(today)}
      />

      {/* Settings */}
      <div className="insights-section">
        <div className="insights-section-title">Settings</div>
        <div>
          {[
            { key: "dailyDmTarget", label: "Daily DM Target", prefix: "" },
            { key: "weeklyHourGoal", label: "Weekly Hour Goal (hrs)", prefix: "" },
            { key: "weeklyRevenueGoal", label: "Weekly Revenue Goal", prefix: "$" },
            { key: "ratePerHour", label: "Rate / Hour", prefix: "$" },
            { key: "monthlyRevenueGoal", label: "Monthly Revenue Goal", prefix: "$" },
          ].map(({ key, label, prefix }, i, arr) => (
            <div key={key} className="settings-row" style={
              i === 0 ? { borderRadius: "var(--radius) var(--radius) 0 0" } :
              i === arr.length - 1 ? { borderRadius: "0 0 var(--radius) var(--radius)", borderBottom: "none" } : {}
            }>
              <span className="settings-label">{label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {prefix && <span style={{ color: "var(--muted)", fontSize: 15 }}>{prefix}</span>}
                <input className="settings-input" type="number" value={settings[key]} onChange={e => updateSetting(key, e.target.value)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MONTHLY SCOREBOARD
================================================================ */
function MonthlyScoreboard({ year, month, monthName, sessions, dmHistory, settings, monthPaid }) {
  const today = todayStr();
  const weeklyGoal = settings.weeklyRevenueGoal || 1500;
  const dailyDmTarget = settings.dailyDmTarget || 5;
  const weeklyDmGoal = dailyDmTarget * 6; // 6 working days

  const buckets = useMemo(() => getMonthWeekBuckets(year, month), [year, month]);

  const fmtShort = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const rows = buckets.map(({ weekStart, weekEnd }) => {
    const weekSess = sessions.filter(s => s.date >= weekStart && s.date <= weekEnd);
    const weekPaid = weekSess.reduce((a, s) => a + (s.paidRevenue || 0), 0);

    // Sum DMs from dmHistory for each day in the week
    let dmTotal = 0;
    let cursor = weekStart;
    while (cursor <= weekEnd) {
      dmTotal += dmHistory[cursor] || 0;
      cursor = addDays(cursor, 1);
    }

    const moneyHit = weekPaid >= weeklyGoal;
    const dmHit    = dmTotal >= weeklyDmGoal;
    const isCurrent = today >= weekStart && today <= weekEnd;
    const isPast    = weekEnd < today;

    return { weekStart, weekEnd, weekPaid, dmTotal, moneyHit, dmHit, isCurrent, isPast };
  });

  const moneyWeeksHit = rows.filter(r => (r.isPast || r.isCurrent) && r.moneyHit).length;
  const dmWeeksHit    = rows.filter(r => (r.isPast || r.isCurrent) && r.dmHit).length;
  const trackedWeeks  = rows.filter(r => r.isPast || r.isCurrent).length;
  const monthProgress = Math.min(monthPaid / (settings.monthlyRevenueGoal || 6000), 1);

  return (
    <div style={{ padding: "0 16px", marginBottom: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--muted)" }}>
            {monthName} Scoreboard
          </div>
        </div>

        {/* Week rows */}
        {rows.map((r, i) => {
          const pct = Math.min(r.weekPaid / weeklyGoal, 1);
          const isFuture = !r.isPast && !r.isCurrent;
          return (
            <div key={r.weekStart} style={{
              padding: "11px 16px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
              opacity: isFuture ? 0.4 : 1,
              background: r.isCurrent ? "rgba(255,159,10,0.04)" : "transparent",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.isCurrent || r.isPast ? 7 : 0 }}>
                {/* Week label */}
                <div style={{ flex: 1, fontSize: 12, fontWeight: r.isCurrent ? 700 : 500, color: r.isCurrent ? "var(--text)" : "var(--muted)" }}>
                  {fmtShort(r.weekStart)} – {fmtShort(r.weekEnd)}
                  {r.isCurrent && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", marginLeft: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>now</span>}
                </div>

                {/* Paid amount */}
                <div style={{ fontSize: 13, fontWeight: 700, color: r.moneyHit ? "var(--success)" : r.isPast || r.isCurrent ? "var(--text)" : "var(--muted)", minWidth: 52, textAlign: "right" }}>
                  {r.isPast || r.isCurrent ? `$${r.weekPaid.toLocaleString()}` : "—"}
                </div>

                {/* Chips */}
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {/* Money chip */}
                  <div style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                    background: r.moneyHit ? "rgba(48,209,88,0.12)" : (r.isPast || r.isCurrent) ? "rgba(255,69,58,0.08)" : "rgba(255,255,255,0.05)",
                    color: r.moneyHit ? "var(--success)" : (r.isPast || r.isCurrent) ? "var(--danger)" : "var(--muted)",
                    border: `1px solid ${r.moneyHit ? "rgba(48,209,88,0.25)" : "rgba(255,255,255,0.08)"}`,
                  }}>
                    {r.moneyHit ? "$ ✓" : "$"}
                  </div>
                  {/* DM chip */}
                  <div style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                    background: r.dmHit ? "rgba(48,209,88,0.12)" : (r.isPast || r.isCurrent) ? "rgba(255,69,58,0.08)" : "rgba(255,255,255,0.05)",
                    color: r.dmHit ? "var(--success)" : (r.isPast || r.isCurrent) ? "rgba(255,255,255,0.35)" : "var(--muted)",
                    border: `1px solid ${r.dmHit ? "rgba(48,209,88,0.25)" : "rgba(255,255,255,0.08)"}`,
                    title: `${r.dmTotal} DMs / ${weeklyDmGoal} goal`,
                  }}>
                    {r.dmHit ? "DM ✓" : `DM ${r.dmTotal}`}
                  </div>
                </div>
              </div>

              {/* Mini progress bar for current + past weeks */}
              {(r.isCurrent || r.isPast) && (
                <div style={{ height: 3, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${pct * 100}%`, borderRadius: 99,
                    background: r.moneyHit ? "var(--success)" : pct > 0.5 ? "var(--accent)" : "#FF6B35",
                    transition: "width 500ms ease",
                  }} />
                </div>
              )}
            </div>
          );
        })}

        {/* Footer summary */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Money weeks: <span style={{ color: moneyWeeksHit === trackedWeeks && trackedWeeks > 0 ? "var(--success)" : "var(--text)", fontWeight: 700 }}>{moneyWeeksHit}/{trackedWeeks}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              DM weeks: <span style={{ color: dmWeeksHit === trackedWeeks && trackedWeeks > 0 ? "var(--success)" : "var(--text)", fontWeight: 700 }}>{dmWeeksHit}/{trackedWeeks}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Month: <span style={{ color: monthProgress >= 1 ? "var(--success)" : "var(--text)", fontWeight: 700 }}>{Math.round(monthProgress * 100)}%</span>
            </div>
          </div>
          {/* Month progress bar */}
          <div style={{ height: 4, borderRadius: 99, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${monthProgress * 100}%`, borderRadius: 99,
              background: monthProgress >= 1 ? "var(--success)" : "linear-gradient(90deg, #FF6B35, var(--accent))",
              transition: "width 500ms ease",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
            ${monthPaid.toLocaleString()} of ${(settings.monthlyRevenueGoal || 6000).toLocaleString()} monthly goal
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   IMPORT ZONE (extracted from WeeklyRevenueCard)
================================================================ */
function ImportZone({ sessions, dateRange, onImport, onClear, weeklyGoal, weekStart }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true); setError(null); setImportResult(null);
    try {
      let parsed = [], warnings = [];
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        ({ sessions: parsed, warnings } = await parseXLSXBuffer(buf));
      } else {
        const text = await file.text();
        ({ sessions: parsed, warnings } = parseCSVText(text));
      }
      if (!parsed.length) throw new Error("No valid rows found. Headers needed: Date, Hours, Amount, Format, Status, Part Paid, Info.");
      const dates = parsed.map(s => s.date).sort();
      setImportResult({ count: parsed.length, from: dates[0], to: dates[dates.length - 1], sessions: parsed, warnings });
    } catch (e) {
      setError(e.message || "Parse failed");
    } finally {
      setImporting(false);
    }
  };

  const fmtDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <div style={{ padding: "0 16px", marginBottom: 16 }}>
      <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", border: "1px solid var(--border)", padding: "14px 16px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.5, color: "var(--muted)", marginBottom: 12 }}>Session Import</div>

        {/* Existing summary */}
        {sessions.length > 0 && !importResult && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              <span>{sessions.length} sessions imported</span>
              {dateRange && <span>{fmtDate(dateRange.from)} – {fmtDate(dateRange.to)}</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1 }}>
                <div className="btn-ghost" style={{ textAlign: "center", cursor: "pointer", fontSize: 12 }}>Add file</div>
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); }} />
              </label>
              <button className="btn-ghost" onClick={onClear} style={{ flex: 1, color: "var(--danger)", borderColor: "rgba(255,69,58,0.2)", fontSize: 12 }}>Clear</button>
            </div>
          </div>
        )}

        {/* Preview */}
        {importResult && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Preview</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{importResult.count} rows · {fmtDate(importResult.from)} – {fmtDate(importResult.to)}</div>
            {importResult.warnings?.length > 0 && (
              <div style={{ margin: "8px 0", padding: "8px 10px", background: "rgba(255,159,10,0.08)", borderRadius: 8, border: "1px solid rgba(255,159,10,0.2)", fontSize: 11, color: "var(--accent)" }}>
                ⚠ {importResult.warnings.length} row{importResult.warnings.length !== 1 ? "s" : ""} to check
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn-ghost" onClick={() => setImportResult(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={() => { onImport(importResult.sessions); setImportResult(null); }} style={{ flex: 2 }}>Import {importResult.count} rows</button>
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!sessions.length && !importResult && (
          <div
            className={`import-zone ${drag ? "drag" : ""}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <input type="file" accept=".csv,.xlsx,.xls" onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); }} />
            <div className="import-icon">{importing ? "⏳" : "📂"}</div>
            <div className="import-title">{importing ? "Parsing…" : "Import spreadsheet"}</div>
            <div className="import-sub">Drop CSV or XLSX · or tap to browse</div>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8, padding: "10px 14px", background: "rgba(255,69,58,0.08)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(255,69,58,0.2)" }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   WEEKLY REVENUE CARD + IMPORT (kept for reference, replaced in Insights by MonthlyScoreboard + ImportZone)
================================================================ */
function WeeklyRevenueCard({ sessions, weekSessions, weeklyPaid, weeklyGap, weeklyPct, weeklyHours, weekStart, goal, dateRange, onImport, onClear }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showSessions, setShowSessions] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true); setError(null); setImportResult(null);
    try {
      let sessions = [], warnings = [];
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        ({ sessions, warnings } = await parseXLSXBuffer(buf));
      } else {
        const text = await file.text();
        ({ sessions, warnings } = parseCSVText(text));
      }
      if (!sessions.length) throw new Error("No valid date rows found. Make sure columns A–G have headers: Date, Hours, Amount, Format, Status, Part Paid, Info.");
      const dates = sessions.map(s => s.date).sort();
      setImportResult({ count: sessions.length, from: dates[0], to: dates[dates.length - 1], sessions, warnings });
    } catch (e) {
      setError(e.message || "Parse failed");
    } finally {
      setImporting(false);
    }
  };

  const handleInputChange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); };
  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f);
  };

  const confirmImport = () => {
    onImport(importResult.sessions);
    setImportResult(null);
  };

  const hasSessions = sessions.length > 0;
  const met = weeklyGap === 0;

  const fmtDate = (d) => {
    if (!d) return "";
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Weekly Revenue Card */}
      <div className="weekly-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted)" }}>
              Week of {fmtDate(weekStart)}
            </div>
            <div className="weekly-amount" style={{ color: met ? "var(--success)" : "var(--text)" }}>
              ${weeklyPaid.toLocaleString()}
            </div>
            <div className={`weekly-gap-pill ${met ? "met" : ""}`}>
              {met ? "✓ Goal reached" : `$${weeklyGap.toLocaleString()} remaining`}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>of ${goal.toLocaleString()}</div>
            {weeklyHours > 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>{weeklyHours}h logged</div>}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 14 }}>
          <div className="progress-track" style={{ height: 5 }}>
            <div className="progress-fill" style={{
              width: `${weeklyPct * 100}%`,
              background: met ? "var(--success)" : "linear-gradient(90deg, #FF9F0A, #FFD60A)"
            }} />
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textAlign: "right" }}>
            {Math.round(weeklyPct * 100)}%
          </div>
        </div>

        {/* This week's sessions */}
        {weekSessions.length > 0 && (
          <>
            <button
              onClick={() => setShowSessions(v => !v)}
              style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 0 0", fontFamily: "var(--font)" }}
            >
              {showSessions ? "Hide" : `Show ${weekSessions.length} session${weekSessions.length !== 1 ? "s" : ""}`}
            </button>
            {showSessions && (
              <div className="weekly-sessions">
                {weekSessions.map((s, i) => (
                  <div key={i} className="weekly-session-row">
                    <span className="weekly-session-client">{s.client || "—"}</span>
                    <span className={`weekly-session-status ${s.status.toLowerCase() === "paid" ? "status-paid" : "status-pending"}`}>
                      {s.status || "—"}
                    </span>
                    <span className="weekly-session-rev" style={{ marginLeft: 10 }}>
                      ${s.paidRevenue.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!hasSessions && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            Import your spreadsheet below to track weekly revenue.
          </div>
        )}
      </div>

      {/* Import Zone */}
      <div style={{ padding: "0 16px" }}>
        {/* Existing import summary */}
        {hasSessions && !importResult && (
          <div className="import-result" style={{ marginBottom: 10 }}>
            <div className="import-result-row">
              <span className="import-result-label">Imported sessions</span>
              <span className="import-result-val">{sessions.length}</span>
            </div>
            {dateRange && (
              <div className="import-result-row">
                <span className="import-result-label">Date range</span>
                <span className="import-result-val">{fmtDate(dateRange.from)} – {fmtDate(dateRange.to)}</span>
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <label style={{ flex: 1 }}>
                <div className="btn-ghost" style={{ textAlign: "center", cursor: "pointer" }}>
                  Re-import
                </div>
                <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleInputChange} />
              </label>
              <button className="btn-ghost" onClick={onClear} style={{ flex: 1, color: "var(--danger)", borderColor: "rgba(255,69,58,0.2)" }}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Preview / confirm pending import */}
        {importResult && (
          <div className="import-result" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Preview</div>
            <div className="import-result-row">
              <span className="import-result-label">Rows detected</span>
              <span className="import-result-val" style={{ color: "var(--success)" }}>{importResult.count}</span>
            </div>
            <div className="import-result-row">
              <span className="import-result-label">Date range</span>
              <span className="import-result-val">{fmtDate(importResult.from)} – {fmtDate(importResult.to)}</span>
            </div>
            {/* Warnings (suspect years, etc) */}
            {importResult.warnings && importResult.warnings.length > 0 && (
              <div style={{ margin: "8px 0", padding: "8px 10px", background: "rgba(255,159,10,0.08)", borderRadius: 8, border: "1px solid rgba(255,159,10,0.2)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>⚠ Check these rows</div>
                {importResult.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--sub)", lineHeight: 1.5 }}>{w}</div>
                ))}
              </div>
            )}
            {(() => {
              const wk = importResult.sessions.filter(s => s.date >= weekStart && s.date <= addDays(weekStart, 6));
              const paid = wk.reduce((a, s) => a + s.paidRevenue, 0);
              const gap = Math.max(0, goal - paid);
              return (
                <>
                  <div className="import-result-row">
                    <span className="import-result-label">This week paid</span>
                    <span className="import-result-val" style={{ color: "var(--success)" }}>${paid.toLocaleString()}</span>
                  </div>
                  <div className="import-result-row">
                    <span className="import-result-label">Gap to ${goal}</span>
                    <span className="import-result-val" style={{ color: gap > 0 ? "var(--danger)" : "var(--success)" }}>
                      {gap > 0 ? `-$${gap.toLocaleString()}` : "Goal met ✓"}
                    </span>
                  </div>
                </>
              );
            })()}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setImportResult(null)} style={{ flex: 1 }}>Cancel</button>
              <button className="btn-primary" onClick={confirmImport} style={{ flex: 2 }}>Import {importResult.count} rows</button>
            </div>
          </div>
        )}

        {/* Drop zone (shown when no sessions or always if no result pending) */}
        {!hasSessions && !importResult && (
          <div
            className={`import-zone ${drag ? "drag" : ""}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
          >
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleInputChange} />
            <div className="import-icon">{importing ? "⏳" : "📂"}</div>
            <div className="import-title">{importing ? "Parsing…" : "Import spreadsheet"}</div>
            <div className="import-sub">Drop CSV or XLSX · or tap to browse</div>
          </div>
        )}

        {!hasSessions && !importResult && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
            From Excel: File → Save As → CSV. Headers needed: Date, Hours, Amount, Status, Part Paid, Info.
          </div>
        )}

        {error && (
          <div style={{ fontSize: 13, color: "var(--danger)", marginTop: 8, padding: "10px 14px", background: "rgba(255,69,58,0.08)", borderRadius: "var(--radius-sm)", border: "1px solid rgba(255,69,58,0.2)" }}>
            ⚠ {error}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, valueColor }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={valueColor ? { color: valueColor } : {}}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

/* ================================================================
   STUDIO SCREEN
================================================================ */
function StudioScreen({ sessions, settings, onImport, onClearSessions }) {
  const hasSessions = sessions.length > 0;
  const kpi = useMemo(() => hasSessions ? computeKPIs(sessions, settings) : null, [sessions, settings]);

  const dateRange = useMemo(() => {
    if (!sessions.length) return null;
    const dates = sessions.map(s => s.date).sort();
    return { from: dates[0], to: dates[dates.length - 1] };
  }, [sessions]);

  const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  const fmtMonth = d => new Date(d + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weekGoal = settings.weeklyRevenueGoal || 1500;
  const monthGoal = settings.monthlyRevenueGoal || 6000;

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-title">Studio</div>
          <div className="screen-date">
            {hasSessions && dateRange
              ? `${sessions.length} sessions · ${fmtDate(dateRange.from)} – ${fmtDate(dateRange.to)}`
              : "Import sessions to see KPIs"}
          </div>
        </div>
      </div>

      {/* Import bar — always visible */}
      <StudioImportBar
        sessions={sessions}
        onImport={onImport}
        onClear={onClearSessions}
        dateRange={dateRange}
      />

      {!hasSessions && (
        <div className="studio-empty">
          <div className="studio-empty-icon">📊</div>
          <div className="studio-empty-title">No session data yet</div>
          <div className="studio-empty-sub">
            Import your monthly logs (CSV or XLSX) to see weekly pacing, monthly totals, yearly trends, and client health.
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
            From Excel: File → Save As → CSV<br/>
            Headers needed: Date · Hours · Amount · Status · Part Paid · Info
          </div>
        </div>
      )}

      {hasSessions && kpi && (
        <>
          {/* ---- SECTION 1: THIS WEEK ---- */}
          <div className="studio-section">
            <div className="studio-section-label">This Week</div>
            <div className="studio-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" }}>
                    {new Date(kpi.weekStart + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(kpi.weekEnd + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                  <div className="studio-week-big" style={{ color: kpi.weekGap === 0 ? "var(--success)" : "var(--text)" }}>
                    {fmtMoney(kpi.weekPaid)}
                  </div>
                  <div style={{
                    display: "inline-flex", alignItems: "center",
                    fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                    background: kpi.weekGap === 0 ? "rgba(48,209,88,0.12)" : "rgba(255,69,58,0.08)",
                    color: kpi.weekGap === 0 ? "var(--success)" : "var(--danger)",
                    border: `1px solid ${kpi.weekGap === 0 ? "rgba(48,209,88,0.25)" : "rgba(255,69,58,0.18)"}`,
                  }}>
                    {kpi.weekGap === 0 ? "✓ Goal reached" : `${fmtMoney(kpi.weekGap)} to goal`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>of {fmtMoney(weekGoal)}</div>
                  {kpi.weekHours > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{fmtHours(kpi.weekHours)}</div>}
                  {kpi.weekPending > 0 && <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 3 }}>{fmtMoney(kpi.weekPending)} pending</div>}
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ marginTop: 14 }}>
                <div style={{ position: "relative", height: 6, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{
                    position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 99,
                    width: `${kpi.weekPct * 100}%`,
                    background: kpi.weekGap === 0 ? "var(--success)"
                      : kpi.weekPct > 0.66 ? "linear-gradient(90deg,#FF9F0A,#FFD60A)"
                      : kpi.weekPct > 0.33 ? "linear-gradient(90deg,#FF6B35,#FF9F0A)"
                      : "linear-gradient(90deg,#FF453A,#FF6B35)",
                    transition: "width 0.7s cubic-bezier(0.34,1.1,0.64,1)",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: "var(--muted)" }}>
                  <span>{Math.round(kpi.weekPct * 100)}% of goal</span>
                  <span>{fmtMoney(weekGoal - kpi.weekPaid > 0 ? weekGoal - kpi.weekPaid : 0)} left</span>
                </div>
              </div>

              {/* Pacing */}
              {kpi.weekGap > 0 && (
                <div className="studio-pacing">
                  <span className="studio-pacing-label">{kpi.daysLeftInWeek} day{kpi.daysLeftInWeek !== 1 ? "s" : ""} left this week</span>
                  <span className="studio-pacing-val" style={{ color: "var(--accent)" }}>
                    {fmtMoney(kpi.needPerDay)}/day needed
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ---- SECTION 2: THIS MONTH ---- */}
          <div className="studio-section">
            <div className="studio-section-label">
              {fmtMonth(todayStr().slice(0,7))}
            </div>

            <div className="kpi-grid-2">
              <div className="kpi-cell">
                <div className="kpi-cell-label">Paid</div>
                <div className="kpi-cell-value" style={{ color: "var(--success)" }}>{fmtMoney(kpi.monthPaid)}</div>
                <div className="kpi-cell-sub">{Math.round((kpi.monthPaid / monthGoal) * 100)}% of {fmtMoney(monthGoal)}</div>
              </div>
              <div className="kpi-cell">
                <div className="kpi-cell-label">Pending</div>
                <div className="kpi-cell-value" style={{ color: kpi.monthPending > 0 ? "var(--accent)" : "var(--muted)" }}>
                  {fmtMoney(kpi.monthPending)}
                </div>
                <div className="kpi-cell-sub">outstanding</div>
              </div>
              <div className="kpi-cell">
                <div className="kpi-cell-label">Sessions</div>
                <div className="kpi-cell-value">{kpi.monthCount}</div>
                <div className="kpi-cell-sub">{fmtHours(kpi.monthHours)} billed</div>
              </div>
              <div className="kpi-cell">
                <div className="kpi-cell-label">Eff. Rate</div>
                <div className="kpi-cell-value">{kpi.monthHours > 0 ? fmtMoney(kpi.effectiveRate) : "—"}</div>
                <div className="kpi-cell-sub">{kpi.monthCount > 0 ? `${fmtMoney(kpi.avgPerSession)} avg` : "per session"}</div>
              </div>
            </div>
          </div>

          {/* ---- SECTION 3: YEAR / TRENDS ---- */}
          <div className="studio-section">
            <div className="studio-section-label">Last 12 Months</div>
            <div className="studio-card">
              {/* All-imported summary — top row */}
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>All Imported · Paid</div>
                    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.8px" }}>{fmtMoney(kpi.allTimePaid)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>Hours</div>
                    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.8px" }}>{fmtHours(kpi.allTimeHours)}</div>
                  </div>
                </div>
                {/* YTD + pending sub-row */}
                <div style={{ display: "flex", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>YTD {new Date().getFullYear()} paid</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtMoney(kpi.ytdPaid)}</div>
                  </div>
                  {kpi.allTimePending > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>Pending (all time)</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>{fmtMoney(kpi.allTimePending)}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>Sessions imported</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{kpi.allTimeSessions}</div>
                  </div>
                </div>
              </div>

              {/* Monthly rollup */}
              {kpi.monthlyRollup.map((m, i) => {
                const pct = kpi.maxMonthlyPaid > 0 ? m.paid / kpi.maxMonthlyPaid : 0;
                const isCurrent = m.key === todayStr().slice(0, 7);
                const barColor = m.paid === 0 ? "var(--border)"
                  : isCurrent ? "var(--accent)"
                  : m.paid >= weekGoal * 4 ? "var(--success)"
                  : "rgba(255,159,10,0.5)";
                return (
                  <div key={m.key} className="month-row">
                    <div className="month-label" style={{ color: isCurrent ? "var(--text)" : "var(--muted)", fontWeight: isCurrent ? 700 : 600 }}>
                      {m.label}
                    </div>
                    <div className="month-bar-wrap">
                      <div className="month-bar-fill" style={{ width: `${pct * 100}%`, background: barColor }} />
                    </div>
                    <div className="month-paid" style={{ color: m.paid === 0 ? "var(--muted)" : isCurrent ? "var(--accent)" : "var(--text)" }}>
                      {m.paid > 0 ? fmtMoney(m.paid) : "—"}
                    </div>
                    <div className="month-count">
                      {m.count > 0 ? `${m.count}s` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- SECTION 3b: EFF. RATE TREND ---- */}
          {kpi.bestEffMonth && (() => {
            const months   = kpi.monthlyRollup;
            const rates    = months.map(m => m.effRate);
            const maxRate  = Math.max(...rates, 1);
            const minRate  = Math.min(...rates.filter(r => r > 0), maxRate);
            const todayKey = todayStr().slice(0, 7);

            // SVG dimensions
            const W = 320, H = 110, padL = 4, padR = 4, padT = 18, padB = 18;
            const plotW = W - padL - padR;
            const plotH = H - padT - padB;
            const step  = plotW / (months.length - 1);

            const yOf = r => {
              const span = maxRate - (minRate * 0.85) || 1;
              return padT + plotH - ((r - minRate * 0.85) / span) * plotH;
            };

            const pts = months.map((m, i) => ({
              x: padL + i * step,
              y: m.hours > 0 ? yOf(m.effRate) : H - padB, // zero months sit at baseline
              active: m.hours > 0,
              isCurrent: m.key === todayKey,
              isBest: m.key === kpi.bestEffMonth.key,
              isWorst: m.hours > 0 && m.key === kpi.worstEffMonth?.key,
              ...m,
            }));

            const linePath = pts.filter(p => p.active).reduce((acc, p, i, arr) => {
              return acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
            }, "");

            // Area fill under line
            const firstActive = pts.find(p => p.active);
            const lastActive  = [...pts].reverse().find(p => p.active);
            const areaPath = firstActive && lastActive
              ? `${linePath} L ${lastActive.x} ${H - padB} L ${firstActive.x} ${H - padB} Z`
              : "";

            return (
              <div className="studio-section">
                <div className="studio-section-label">Eff. Rate Trend · 12 Months</div>
                <div className="studio-card">

                  {/* KPI row */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                    {[
                      { label: "12-Mo Avg", val: kpi.last12EffRate > 0 ? `$${kpi.last12EffRate}/hr` : "—" },
                      { label: "Best Month", val: kpi.bestEffMonth ? `$${kpi.bestEffMonth.effRate}/hr` : "—", sub: kpi.bestEffMonth?.label, color: "var(--success)" },
                      { label: "Worst Month", val: kpi.worstEffMonth ? `$${kpi.worstEffMonth.effRate}/hr` : "—", sub: kpi.worstEffMonth?.label, color: "var(--danger)" },
                    ].map((item, i) => (
                      <div key={i} style={{ flex: 1, borderRight: i < 2 ? "1px solid var(--border)" : "none", paddingRight: 10, paddingLeft: i > 0 ? 10 : 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: item.color || "var(--text)", lineHeight: 1 }}>{item.val}</div>
                        {item.sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{item.sub}</div>}
                      </div>
                    ))}
                  </div>

                  {/* SVG Line Chart */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 8 }}>Eff. $/hr (12 months)</div>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", overflow: "visible" }}>
                      {/* Baseline */}
                      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

                      {/* Area fill */}
                      {areaPath && (
                        <path d={areaPath} fill="rgba(255,159,10,0.06)" />
                      )}

                      {/* Line */}
                      {linePath && (
                        <path d={linePath} fill="none" stroke="rgba(255,159,10,0.6)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                      )}

                      {/* Dots + labels */}
                      {pts.map((pt, i) => {
                        if (!pt.active) return null;
                        const showLabel = pt.isCurrent || pt.isBest || pt.isWorst;
                        const dotColor  = pt.isBest ? "#30D158" : pt.isWorst ? "#FF453A" : pt.isCurrent ? "var(--accent)" : "rgba(255,159,10,0.5)";
                        const labelY    = pt.y < padT + 12 ? pt.y + 14 : pt.y - 6;
                        return (
                          <g key={pt.key}>
                            <circle cx={pt.x} cy={pt.y} r={pt.isCurrent || pt.isBest || pt.isWorst ? 4 : 2.5}
                              fill={dotColor}
                              stroke={pt.isCurrent ? "var(--bg)" : "none"} strokeWidth={1.5}
                            />
                            {showLabel && (
                              <text x={pt.x} y={labelY}
                                textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}
                                style={{ fontSize: 9, fontWeight: 700, fill: dotColor, fontFamily: "sans-serif" }}>
                                ${pt.effRate}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Month labels — show every 3rd to avoid crowding */}
                      {pts.map((pt, i) => (
                        (i === 0 || i === 5 || i === 11) && (
                          <text key={`lbl-${i}`} x={pt.x} y={H}
                            textAnchor={i === 0 ? "start" : i === 11 ? "end" : "middle"}
                            style={{ fontSize: 8, fill: "rgba(255,255,255,0.3)", fontFamily: "sans-serif" }}>
                            {pt.label}
                          </text>
                        )
                      ))}
                    </svg>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* ---- SECTION 4: CLIENT HEALTH ---- */}
          {kpi.allClients.length > 0 && (
            <div className="studio-section">
              <div className="studio-section-label">Client Health · Last 12 Months</div>
              <div className="studio-card">
                {/* Stats row */}
                <div style={{ display: "flex", gap: 24, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>Unique</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.uniqueClients}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>Repeat</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{kpi.repeatClients}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 4 }}>Repeat Rate</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: kpi.repeatRate >= 50 ? "var(--success)" : "var(--text)" }}>
                      {kpi.repeatRate}%
                    </div>
                  </div>
                </div>

                {/* All clients */}
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "var(--muted)", marginBottom: 8 }}>
                  All Clients · {kpi.allClients.length}
                </div>
                {kpi.allClients.map((c, i) => {
                  const pct = kpi.last12Total > 0 ? Math.round((c.total / kpi.last12Total) * 100) : 0;
                  const hasPending = c.pending > 0;
                  const allPaid = c.paid > 0 && c.pending === 0;
                  return (
                    <div key={c.name} className="client-row" style={{ alignItems: "flex-start", padding: "12px 0" }}>
                      <div className="client-rank" style={{ color: i === 0 ? "var(--accent)" : "var(--muted)", paddingTop: 2 }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <div className="client-name" style={{ flex: "none", fontWeight: 600 }}>{c.name || "Unknown"}</div>
                          <div style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                            background: allPaid ? "rgba(48,209,88,0.1)" : hasPending ? "rgba(255,159,10,0.1)" : "rgba(255,255,255,0.06)",
                            color: allPaid ? "var(--success)" : hasPending ? "var(--accent)" : "var(--muted)",
                          }}>
                            {allPaid ? "All paid" : hasPending ? "Has pending" : "—"}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>
                          {c.sessions} session{c.sessions !== 1 ? "s" : ""} · {pct}% of total
                          {c.paid > 0 && <span style={{ color: "var(--success)" }}> · {fmtMoney(c.paid)} paid</span>}
                          {c.pending > 0 && <span style={{ color: "var(--accent)" }}> · {fmtMoney(c.pending)} pending</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, paddingTop: 2 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>
                          {fmtMoney(c.total)}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>billed</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ height: 32 }} />
        </>
      )}
    </div>
  );
}

/* ---- Studio Import Bar (compact, always visible) ---- */
function StudioImportBar({ sessions, onImport, onClear, dateRange }) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const hasSessions = sessions.length > 0;

  const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

  const handleFile = async (file) => {
    if (!file) return;
    setImporting(true); setError(null); setPreview(null);
    try {
      let parsed = [], warnings = [];
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buf = await file.arrayBuffer();
        ({ sessions: parsed, warnings } = await parseXLSXBuffer(buf));
      } else {
        const text = await file.text();
        ({ sessions: parsed, warnings } = parseCSVText(text));
      }
      if (!parsed.length) throw new Error("No valid rows found. Check headers: Date, Hours, Amount, Status, Part Paid, Info.");
      const dates = parsed.map(s => s.date).sort();
      // Compute new rows after merge
      const key = s => `${s.date}|${(s.client||"").trim().toLowerCase()}|${s.amount}|${s.hoursLabel || s.hours}`;
      const existingKeys = new Set(sessions.map(key));
      const newRows = parsed.filter(s => !existingKeys.has(key(s))).length;
      setPreview({ sessions: parsed, from: dates[0], to: dates[dates.length - 1], total: parsed.length, newRows, warnings });
    } catch (e) {
      setError(e.message || "Parse failed");
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = () => { onImport(preview.sessions); setPreview(null); };

  if (preview) {
    return (
      <div style={{ margin: "0 16px 16px", padding: "14px 16px", background: "var(--elevated)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Preview import</div>
        {[
          ["Rows in file", preview.total],
          ["New (not yet imported)", preview.newRows, preview.newRows > 0 ? "var(--success)" : "var(--muted)"],
          ["Date range", `${fmtDate(preview.from)} – ${fmtDate(preview.to)}`],
        ].map(([label, val, color]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>{label}</span>
            <span style={{ fontWeight: 600, color: color || "var(--text)" }}>{val}</span>
          </div>
        ))}
        {preview.warnings?.length > 0 && (
          <div style={{ margin: "8px 0 4px", padding: "8px 10px", background: "rgba(255,159,10,0.08)", borderRadius: 8, border: "1px solid rgba(255,159,10,0.2)", fontSize: 12, color: "var(--accent)" }}>
            ⚠ {preview.warnings[0]}{preview.warnings.length > 1 ? ` (+${preview.warnings.length - 1} more)` : ""}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn-ghost" onClick={() => setPreview(null)} style={{ flex: 1 }}>Cancel</button>
          <button className="btn-primary" onClick={confirmImport} style={{ flex: 2 }}>
            {preview.newRows === 0 ? "Import anyway" : `Add ${preview.newRows} row${preview.newRows !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-import-bar">
      <div className="studio-import-info">
        {hasSessions
          ? <div className="studio-import-title">{sessions.length} sessions imported</div>
          : <div className="studio-import-title">Import session logs</div>
        }
        <div className="studio-import-sub">
          {hasSessions && dateRange
            ? `${fmtDate(dateRange.from)} – ${fmtDate(dateRange.to)} · merge-safe`
            : "CSV or XLSX · multiple files OK"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {hasSessions && (
          <button className="btn-ghost" onClick={onClear} style={{ color: "var(--danger)", borderColor: "rgba(255,69,58,0.2)", padding: "8px 12px", fontSize: 12 }}>
            Clear
          </button>
        )}
        <label style={{ cursor: "pointer" }}>
          <div className="btn-action" style={{ padding: "8px 14px", fontSize: 13 }}>
            {importing ? "…" : hasSessions ? "Add file" : "Import"}
          </div>
          <input type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }}
            onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </label>
      </div>
      {error && (
        <div style={{ position: "absolute", top: "100%", left: 16, right: 16, marginTop: 4, padding: "8px 12px", background: "rgba(255,69,58,0.1)", borderRadius: 8, border: "1px solid rgba(255,69,58,0.2)", fontSize: 12, color: "var(--danger)" }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   LEAD SHEET
================================================================ */
function LeadSheet({ lead, tasks, actions, onClose, onUpdate, onDelete, toast }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...lead });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sessionHrs, setSessionHrs] = useState("");
  const [sessionRev, setSessionRev] = useState("");
  const [showSessionLog, setShowSessionLog] = useState(false);
  const openTasks = tasks.filter(t => !t.done);
  const doneTasks = tasks.filter(t => t.done);

  const getQuickActions = () => {
    const stage = lead.stage;
    const hasOffer = tasks.some(t => t.type === "offer_full" && !t.done);
    const allActions = [
      { key: "dmSent", label: "DM Sent", isPrimary: stage === "New", show: ["New","Contacted","Dormant"].includes(stage) },
      { key: "followupSent", label: "Follow-up Sent", isPrimary: stage === "Contacted", show: ["Contacted","Interested","Completed Test"].includes(stage) },
      { key: "bookedTest", label: "Booked Test", isPrimary: stage === "Interested", show: ["Contacted","Interested"].includes(stage) },
      { key: "completedTest", label: "Completed Test", isPrimary: stage === "Booked Test", show: stage === "Booked Test" },
      { key: "offeredFull", label: "Offered Full Block", isPrimary: stage === "Completed Test" && !hasOffer, show: stage === "Completed Test" },
      { key: "bookedFull", label: "Booked Full", isPrimary: hasOffer, show: ["Completed Test","Interested","Booked Test"].includes(stage) },
      { key: "completed", label: "Mark Completed", isPrimary: stage === "Booked Full", show: stage === "Booked Full" },
    ];
    return allActions.filter(a => a.show);
  };

  const handleAction = (key) => {
    if (key === "completed") { setShowSessionLog(true); return; }
    actions[key](lead.id);
    onClose();
  };

  const handleCompleted = () => {
    actions.completed(lead.id, sessionHrs, sessionRev);
    setShowSessionLog(false);
    onClose();
  };

  const handleSave = () => {
    onUpdate(form);
    setEditing(false);
    toast("Saved ✓");
  };

  const qas = getQuickActions();
  const stageColor = STAGE_COLOR[lead.stage] || "#636366";
  const initial = (lead.handleOrName || "?")[0].toUpperCase();

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />

        {/* Header */}
        <div className="sheet-header">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="lead-avatar" style={{ background: stageColor + "22", color: stageColor, width: 42, height: 42, borderRadius: 12, fontSize: 16 }}>
              {initial}
            </div>
            <div>
              <div className="sheet-title">{lead.handleOrName}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span className="pill" style={{ background: stageColor + "22", color: stageColor }}>{lead.stage}</span>
                {lead.source && <span className="pill pill-stage">{lead.source}</span>}
              </div>
            </div>
          </div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>

        {/* Quick Actions */}
        {qas.length > 0 && (
          <div className="sheet-section">
            <div className="sheet-section-title">Quick Actions</div>
            <div className="quick-actions">
              {qas.map(qa => (
                <button key={qa.key} className={`qa-btn ${qa.isPrimary ? "primary" : ""}`} onClick={() => handleAction(qa.key)}>
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Session log popup */}
        {showSessionLog && (
          <div className="sheet-section" style={{ background: "var(--elevated)", borderRadius: "var(--radius-sm)", margin: "0 20px" }}>
            <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 15 }}>Log session (optional)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Hours</div>
                <input className="form-input" type="number" placeholder="e.g. 3" value={sessionHrs} onChange={e => setSessionHrs(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Revenue $</div>
                <input className="form-input" type="number" placeholder="e.g. 150" value={sessionRev} onChange={e => setSessionRev(e.target.value)} />
              </div>
            </div>
            <button className="btn-primary" style={{ width: "100%" }} onClick={handleCompleted}>Mark Completed</button>
          </div>
        )}

        {/* Open tasks */}
        {openTasks.length > 0 && (
          <div className="sheet-section">
            <div className="sheet-section-title">Pending ({openTasks.length})</div>
            {openTasks.map(t => (
              <div key={t.id} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: isDueOrOverdue(t.dueDate) ? "var(--danger)" : "var(--accent)", flexShrink: 0 }} />
                <span style={{ fontSize: 14, flex: 1 }}>{t.type.replace("_", " ")}</span>
                <span style={{ fontSize: 12, color: isDueOrOverdue(t.dueDate) ? "var(--danger)" : "var(--muted)" }}>{relDate(t.dueDate)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Scripts */}
        <div className="sheet-section">
          <div className="sheet-section-title">Scripts</div>
          <div className="scripts-list">
            {Object.entries(SCRIPTS).map(([key, script]) => (
              <ScriptItem key={key} script={script} toast={toast} />
            ))}
          </div>
        </div>

        {/* Edit */}
        <div className="sheet-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div className="sheet-section-title" style={{ marginBottom: 0 }}>Details</div>
            {!editing
              ? <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>
              : <div style={{ display: "flex", gap: 8 }}><button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button><button className="btn-action" onClick={handleSave}>Save</button></div>
            }
          </div>
          {editing ? (
            <div>
              <div className="form-row">
                <div className="form-label">Name / Handle</div>
                <input className="form-input" value={form.handleOrName || ""} onChange={e => setForm(f => ({ ...f, handleOrName: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-label">Source</div>
                <select className="form-select" value={form.source || ""} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                  <option value="">Select</option>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-label">Stage</div>
                <select className="form-select" value={form.stage || "New"} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}>
                  {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-label">Next Action Date</div>
                <input className="form-input" type="date" value={form.nextActionDate || ""} onChange={e => setForm(f => ({ ...f, nextActionDate: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-label">Booking Date / Time</div>
                <input className="form-input" type="datetime-local" value={form.bookingDateTime ? form.bookingDateTime.slice(0,16) : ""} onChange={e => setForm(f => ({ ...f, bookingDateTime: e.target.value }))} />
              </div>
              <div className="form-row">
                <div className="form-label">Notes</div>
                <textarea className="form-input" rows={3} style={{ resize: "none", lineHeight: 1.5 }} value={form.notes || ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div>
              {[
                { label: "Source", val: lead.source },
                { label: "Last Contacted", val: lead.lastContacted ? relDate(lead.lastContacted) : null },
                { label: "Next Action", val: lead.nextActionDate ? relDate(lead.nextActionDate) : null },
                { label: "Booking", val: lead.bookingDateTime ? new Date(lead.bookingDateTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null },
                { label: "Notes", val: lead.notes },
              ].filter(r => r.val).map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 14, color: "var(--muted)" }}>{r.label}</span>
                  <span style={{ fontSize: 14, maxWidth: "60%", textAlign: "right" }}>{r.val}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delete */}
        <div className="sheet-section">
          {!showDeleteConfirm
            ? <button className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>Remove Lead</button>
            : (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, color: "var(--muted)", marginBottom: 12 }}>Remove {lead.handleOrName}? This can't be undone.</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                  <button className="btn-danger" style={{ flex: 1 }} onClick={onDelete}>Remove</button>
                </div>
              </div>
            )
          }
        </div>
      </div>
    </>
  );
}

function ScriptItem({ script, toast }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    copyText(script.text, () => {
      setCopied(true);
      toast(`${script.label} copied ✓`);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="script-item">
      <div style={{ flex: 1 }}>
        <div className="script-label">{script.label}</div>
        <div className="script-text">{script.text}</div>
      </div>
      <button className={`copy-btn ${copied ? "copied" : ""}`} onClick={handle}>{copied ? "✓" : "⎘"}</button>
    </div>
  );
}

/* ================================================================
   ADD LEAD SHEET
================================================================ */
function AddLeadSheet({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("IG");

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({ handleOrName: name.trim(), source, stage: "New" });
  };

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">New Lead</div>
          <button className="sheet-close" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-section">
          <div className="form-row">
            <div className="form-label">Name or Handle</div>
            <input
              className="form-input"
              placeholder="@username or Name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              autoFocus
            />
          </div>
          <div className="form-row">
            <div className="form-label">Source</div>
            <div className="source-pills">
              {SOURCES.map(s => (
                <button key={s} className={`source-pill ${source === s ? "selected" : ""}`} onClick={() => setSource(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="sheet-section">
          <button
            className="btn-primary"
            style={{ width: "100%", opacity: name.trim() ? 1 : 0.4 }}
            onClick={handleAdd}
            disabled={!name.trim()}
          >
            Add to Pipeline
          </button>
        </div>
      </div>
    </>
  );
}

/* ================================================================
   TOAST
================================================================ */
function ToastEl({ msg, type }) {
  return <div className={`toast ${type}`}>{msg}</div>;
}
