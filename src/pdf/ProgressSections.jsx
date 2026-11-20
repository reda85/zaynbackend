// Rapport d'avancement : synthèse, tableau des lots, planning (Gantt),
// jalons et points d'attention. Les calculs suivent ceux du web
// (lib/data/lots.js, lib/data/planning.js) pour que le rapport dise la même
// chose que l'application.
import React from "react";
import { Image, Text, View } from "@react-pdf/renderer";

const TZ = "Africa/Casablanca";
const DAY = 86400000;

// ── Dates ────────────────────────────────────────────────────────────────────
/** 'YYYY-MM-DD' d'une date simple ou d'un horodatage (échéances des tâches). */
export const toDay = (v) => {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
};
const dayNum = (iso) => (iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY : null);
const fromNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const fmtD = (iso, withYear = true) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", ...(withYear ? { year: "numeric" } : {}) }) : "—";
const fmtShort = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—");

// ── Modèle ───────────────────────────────────────────────────────────────────
const LOT_STATE = {
  done:    { label: "Terminé",   color: "#15803d", bg: "#dcfce7" },
  late:    { label: "En retard", color: "#b91c1c", bg: "#fee2e2" },
  ongoing: { label: "En cours",  color: "#1d4ed8", bg: "#dbeafe" },
  todo:    { label: "À venir",   color: "#57534e", bg: "#f5f5f4" },
};

export function buildProgress({ categories = [], pins = [], milestones = [], statuses = [], today = toDay(new Date()) }) {
  const finalId = [...statuses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).at(-1)?.id;
  const tasks = pins.map((p) => {
    const start = toDay(p.date_debut);
    const end = toDay(p.due_date);
    const done = (p.status_id && p.status_id === finalId) || (p.avancement ?? 0) >= 100;
    const progress = done ? 100 : Math.max(0, Math.min(100, p.avancement ?? 0));
    const late = Boolean(end && end < today && !done);
    return { ...p, start, end, done, progress, late, lateDays: late ? dayNum(today) - dayNum(end) : 0 };
  });

  const tasksByLot = new Map();
  for (const t of tasks) {
    const k = t.category_id ?? null;
    if (!tasksByLot.has(k)) tasksByLot.set(k, []);
    tasksByLot.get(k).push(t);
  }

  const lots = [...categories]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c) => {
      const lotTasks = tasksByLot.get(c.id) ?? [];
      const progress = Math.max(0, Math.min(100, c.avancement ?? 0));
      const done = progress >= 100 || Boolean(c.date_fin_reelle);
      const late = Boolean(c.date_fin_prevue && c.date_fin_prevue < today && !c.date_fin_reelle && progress < 100);
      const started = Boolean(c.date_debut_reelle) || progress > 0;
      const state = done ? "done" : late ? "late" : started ? "ongoing" : "todo";
      // Fin prévue en jours de retard (ou d'avance pour un lot terminé).
      const lateDays = late ? dayNum(today) - dayNum(c.date_fin_prevue) : 0;
      return {
        id: c.id, name: c.name, company: c.entreprises?.name ?? null,
        plannedStart: c.date_debut_prevue, plannedEnd: c.date_fin_prevue,
        realStart: c.date_debut_reelle, realEnd: c.date_fin_reelle,
        progress: done ? 100 : progress, state, lateDays,
        tasks: lotTasks.sort((a, b) => (a.start ?? a.end ?? "9").localeCompare(b.start ?? b.end ?? "9")),
        tasksDone: lotTasks.filter((t) => t.done).length,
      };
    })
    // Un lot sans dates ni tâches n'a rien à dire dans un rapport d'avancement.
    .filter((l) => l.plannedStart || l.plannedEnd || l.realStart || l.tasks.length);

  const orphanTasks = tasksByLot.get(null) ?? [];

  // Avancement global : moyenne des lots pondérée par leur durée prévue.
  let wSum = 0, pSum = 0;
  for (const l of lots) {
    const w = l.plannedStart && l.plannedEnd ? Math.max(1, dayNum(l.plannedEnd) - dayNum(l.plannedStart) + 1) : 0;
    wSum += w; pSum += w * l.progress;
  }
  const global = wSum ? Math.round(pSum / wSum) : lots.length ? Math.round(lots.reduce((s, l) => s + l.progress, 0) / lots.length) : null;

  const jalons = [...milestones]
    .sort((a, b) => (a.date_debut ?? "").localeCompare(b.date_debut ?? ""))
    .map((m) => {
      const done = (m.avancement ?? 0) >= 100;
      const late = !done && m.date_debut < today;
      return { ...m, date: m.date_debut, done, late, lot: categories.find((c) => c.id === m.lot_id)?.name ?? null };
    });

  const counts = Object.fromEntries(Object.keys(LOT_STATE).map((k) => [k, lots.filter((l) => l.state === k).length]));
  return {
    today, lots, orphanTasks, jalons, global, counts,
    tasks: { total: tasks.length, done: tasks.filter((t) => t.done).length, late: tasks.filter((t) => t.late) },
    nextMilestone: jalons.find((j) => !j.done && j.date >= today) ?? null,
  };
}

// ── Éléments communs ─────────────────────────────────────────────────────────
const Bar = ({ value, width = 60, color = "#44403c", height = 5 }) => (
  <View style={{ width, height, borderRadius: height / 2, backgroundColor: "#e7e5e4" }}>
    <View style={{ width: (width * Math.max(0, Math.min(100, value))) / 100, height, borderRadius: height / 2, backgroundColor: value >= 100 ? "#15803d" : color }} />
  </View>
);

const Pill = ({ state, fontFamily, children }) => {
  const s = LOT_STATE[state] ?? LOT_STATE.todo;
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 9999, paddingVertical: 2, paddingHorizontal: 6, alignSelf: "flex-start" }}>
      <Text style={{ fontSize: 7, color: s.color, fontFamily }}>{children ?? s.label}</Text>
    </View>
  );
};

export const SectionTitle = ({ title, titleStyle, sub, fontFamily }) => (
  <View minPresenceAhead={80} style={{ ...titleStyle.containerStyle, marginTop: 14 }}>
    <Text style={titleStyle.textStyle}>{title}</Text>
    {sub ? <Text style={{ fontSize: 8, color: "#78716c", marginTop: 2, fontFamily }}>{sub}</Text> : null}
  </View>
);

// Réglages des sections du rapport d'avancement (config.progressSections du
// modèle). Même table côté web (lib/data/reportKinds.js).
export const PROGRESS_SECTION_DEFAULTS = {
  summary:    { global: true, lots: true, lateLots: true, tasks: true, lateTasks: true, nextMilestone: true },
  lots:       { title: "Lots", company: true, planned: true, real: true, progress: true, tasks: true, state: true },
  attention:  { title: "Points d'attention", lots: true, tasks: true },
  milestones: { title: "Jalons", upcomingOnly: false },
  gantt:      { title: "Planning" },
  workforce:  { title: "Effectifs de site", lots: true, total: true },
  photos:     { title: "Reportage photo", perPage: 1, plan: true, caption: true },
  conclusion: { title: "Recommandations et conclusion" },
};
export const sectionOpts = (config, key) => {
  const o = { ...PROGRESS_SECTION_DEFAULTS[key], ...(config?.progressSections?.[key] || {}) };
  if ("title" in o && !String(o.title || "").trim()) o.title = PROGRESS_SECTION_DEFAULTS[key].title;
  return o;
};

// ── Synthèse ─────────────────────────────────────────────────────────────────
export const ProgressSummary = ({ model, title, period = null, primaryColor, fontFamily, backgroundColor = "#f5f5f4", show = PROGRESS_SECTION_DEFAULTS.summary, framed = false }) => {
  const Kpi = ({ label, value, sub, color }) => (
    <View style={{ flex: 1, paddingRight: 8 }}>
      <Text style={{ fontSize: 8, fontWeight: "bold", color: "#57534e", fontFamily }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: "bold", color: color ?? "#292524", marginTop: 3, fontFamily }}>{value}</Text>
      {sub ? <Text style={{ fontSize: 7.5, color: "#78716c", marginTop: 2, fontFamily }}>{sub}</Text> : null}
    </View>
  );
  const { counts, tasks, nextMilestone, global } = model;
  return (
    <View wrap={false} style={framed
      ? { padding: 12, marginBottom: 10, borderWidth: 1, borderColor: "#57534e", backgroundColor: "white" }
      : { padding: 16, borderRadius: 8, marginBottom: 8, backgroundColor }}>
      <Text style={{ fontSize: 12, fontWeight: "bold", color: primaryColor, fontFamily }}>{title}</Text>
      <Text style={{ fontSize: 8, color: "#78716c", marginTop: 2, marginBottom: 12, fontFamily }}>Situation au {fmtD(model.today)}{period ? `  ·  Période : ${period.charAt(0).toLowerCase()}${period.slice(1)}` : ""}</Text>
      {show.global !== false && <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 8, fontWeight: "bold", color: "#57534e", fontFamily }}>Avancement global</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
            <Text style={{ fontSize: 22, fontWeight: "bold", color: "#292524", fontFamily }}>{global == null ? "—" : `${global} %`}</Text>
            {global != null && <Bar value={global} width={260} height={8} color={primaryColor} />}
          </View>
          <Text style={{ fontSize: 7.5, color: "#78716c", marginTop: 3, fontFamily }}>Moyenne des lots pondérée par leur durée prévue</Text>
        </View>
      </View>}
      <View style={{ flexDirection: "row" }}>
        {show.lots !== false && <Kpi label="Lots" value={model.lots.length} sub={`${counts.done} terminé${counts.done > 1 ? "s" : ""} · ${counts.ongoing} en cours · ${counts.todo} à venir`} />}
        {show.lateLots !== false && <Kpi label="Lots en retard" value={counts.late} color={counts.late ? "#b91c1c" : undefined} />}
        {show.tasks !== false && <Kpi label="Tâches" value={`${tasks.done}/${tasks.total}`} sub="terminées" />}
        {show.lateTasks !== false && <Kpi label="Tâches en retard" value={tasks.late.length} color={tasks.late.length ? "#b91c1c" : undefined} />}
        {show.nextMilestone !== false && <Kpi
          label="Prochain jalon"
          value={nextMilestone ? fmtShort(nextMilestone.date) : "—"}
          sub={nextMilestone ? nextMilestone.libelle : model.jalons.length ? "Tous les jalons sont passés" : "Aucun jalon"}
        />}
      </View>
    </View>
  );
};

// ── Tableau des lots ─────────────────────────────────────────────────────────
const Cell = ({ w, children, header, last, fontFamily, align }) => (
  <View style={{ width: w, paddingVertical: header ? 5 : 6, paddingHorizontal: 5, ...(last ? {} : { borderRightWidth: 1, borderRightColor: "#e7e5e4" }), justifyContent: "center", alignItems: align === "right" ? "flex-end" : "flex-start" }}>
    {typeof children === "string" || typeof children === "number"
      ? <Text style={{ fontSize: header ? 7.5 : 8, fontWeight: header ? "bold" : "normal", color: header ? "#44403c" : "#292524", fontFamily }}>{String(children)}</Text>
      : children}
  </View>
);

// « 01/06/2026 / au 30/10/2026 » sur deux lignes (la police n'a pas de flèche).
const Period = ({ start, end, openEnd = null, empty, endColor, fontFamily }) => {
  if (!start && !end) return <Text style={{ fontSize: 7.5, color: "#a8a29e", fontFamily }}>{empty}</Text>;
  return (
    <View>
      <Text style={{ fontSize: 7.5, color: "#292524", fontFamily }}>{start ? `du ${fmtD(start)}` : "début non fixé"}</Text>
      <Text style={{ fontSize: 7.5, color: endColor ?? "#292524", fontFamily }}>{end ? `au ${fmtD(end)}` : openEnd ?? "fin non fixée"}</Text>
    </View>
  );
};

// Colonnes du tableau des lots : clé du réglage, en-tête, largeur relative, contenu.
const LOT_COLUMNS = [
  { key: null,       label: "Lot",        w: 22 },
  { key: "company",  label: "Entreprise", w: 16 },
  { key: "planned",  label: "Prévu",      w: 15 },
  { key: "real",     label: "Réel",       w: 15 },
  { key: "progress", label: "Avancement", w: 14 },
  { key: "tasks",    label: "Tâches",     w: 8 },
  { key: "state",    label: "État",       w: 10 },
];

export const LotsTable = ({ model, primaryColor, fontFamily, opts = PROGRESS_SECTION_DEFAULTS.lots }) => {
  if (!model.lots.length) return <Text style={{ fontSize: 9, color: "#a8a29e", fontFamily }}>Aucun lot planifié.</Text>;
  const cols = LOT_COLUMNS.filter((c) => !c.key || opts[c.key] !== false);
  const total = cols.reduce((n, c) => n + c.w, 0);
  const width = (c) => `${(c.w / total) * 100}%`;
  const cell = (c, l) => {
    switch (c.key) {
      case null: return <Text style={{ fontSize: 8.5, fontWeight: "bold", color: "#292524", fontFamily }}>{l.name}</Text>;
      case "company": return l.company ?? "—";
      case "planned": return <Period start={l.plannedStart} end={l.plannedEnd} endColor={l.state === "late" ? "#b91c1c" : undefined} empty="Non planifié" fontFamily={fontFamily} />;
      case "real": return <Period start={l.realStart} end={l.realEnd} openEnd={l.realStart ? "en cours" : null} empty="Non démarré" fontFamily={fontFamily} />;
      case "progress": return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Bar value={l.progress} width={34} color={primaryColor} />
          <Text style={{ fontSize: 7.5, color: "#292524", fontFamily }}>{l.progress} %</Text>
        </View>
      );
      case "tasks": return l.tasks.length ? `${l.tasksDone}/${l.tasks.length}` : "—";
      case "state": return <Pill state={l.state} fontFamily={fontFamily}>{l.state === "late" ? `Retard ${l.lateDays} j` : undefined}</Pill>;
      default: return null;
    }
  };
  return (
    <View style={{ marginTop: 6, borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 4 }}>
      <View style={{ flexDirection: "row", backgroundColor: "#f5f5f4", borderBottomWidth: 1, borderBottomColor: "#d6d3d1" }}>
        {cols.map((c, i) => (
          <Cell key={c.label} w={width(c)} header last={i === cols.length - 1} fontFamily={fontFamily}>{c.label}</Cell>
        ))}
      </View>
      {model.lots.map((l, i) => (
        <View key={l.id} wrap={false} style={{ flexDirection: "row", ...(i < model.lots.length - 1 ? { borderBottomWidth: 1, borderBottomColor: "#e7e5e4" } : {}), backgroundColor: i % 2 ? "#fafaf9" : "white" }}>
          {cols.map((c, ci) => (
            <Cell key={c.label} w={width(c)} last={ci === cols.length - 1} fontFamily={fontFamily}>{cell(c, l)}</Cell>
          ))}
        </View>
      ))}
    </View>
  );
};

// ── Jalons ───────────────────────────────────────────────────────────────────
export const MilestonesList = ({ model, fontFamily, upcomingOnly = false }) => {
  const jalons = upcomingOnly ? model.jalons.filter((j) => !j.done) : model.jalons;
  if (!jalons.length) return <Text style={{ fontSize: 9, color: "#a8a29e", fontFamily }}>{upcomingOnly ? "Aucun jalon à venir." : "Aucun jalon."}</Text>;
  return (
    <View style={{ marginTop: 6 }}>
      {jalons.map((j) => (
        <View key={j.id} wrap={false} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#f5f5f4" }}>
          <View style={{ width: 8, height: 8, transform: "rotate(45deg)", backgroundColor: j.done ? "#15803d" : j.late ? "#b91c1c" : "#44403c" }} />
          <Text style={{ width: 64, fontSize: 8.5, color: "#292524", fontFamily }}>{fmtD(j.date)}</Text>
          <Text style={{ flex: 1, fontSize: 8.5, fontWeight: "bold", color: "#292524", fontFamily }}>
            {j.libelle}{j.lot ? <Text style={{ fontWeight: "normal", color: "#78716c" }}>{`  ·  ${j.lot}`}</Text> : null}
          </Text>
          <Pill state={j.done ? "done" : j.late ? "late" : "todo"} fontFamily={fontFamily}>{j.done ? "Atteint" : j.late ? "Dépassé" : "À venir"}</Pill>
        </View>
      ))}
    </View>
  );
};

// ── Points d'attention ───────────────────────────────────────────────────────
export const AttentionList = ({ model, categories, fontFamily, showLots = true, showTasks = true }) => {
  const lateLots = showLots ? model.lots.filter((l) => l.state === "late") : [];
  const lateTasks = showTasks ? [...model.tasks.late].sort((a, b) => b.lateDays - a.lateDays) : [];
  if (!lateLots.length && !lateTasks.length) {
    return <Text style={{ fontSize: 9, color: "#15803d", marginTop: 4, fontFamily }}>Aucun retard à signaler au {fmtD(model.today)}.</Text>;
  }
  const Line = ({ left, mid, right }) => (
    <View wrap={false} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#f5f5f4" }}>
      <Text style={{ flex: 1, fontSize: 8.5, color: "#292524", fontFamily }}>{left}</Text>
      <Text style={{ width: 150, fontSize: 8, color: "#57534e", fontFamily }}>{mid}</Text>
      <Text style={{ width: 90, fontSize: 8, color: "#b91c1c", textAlign: "right", fontFamily }}>{right}</Text>
    </View>
  );
  return (
    <View style={{ marginTop: 6 }}>
      {lateLots.map((l) => (
        <Line key={l.id} left={`${/^lot\b/i.test(l.name) ? "" : "Lot "}${l.name}${l.company ? ` (${l.company})` : ""} : ${l.progress} %`} mid={`Fin prévue le ${fmtD(l.plannedEnd)}`} right={`${l.lateDays} j de retard`} />
      ))}
      {lateTasks.map((t) => (
        <Line
          key={t.id}
          left={`${t.name || "Tâche"} : ${t.progress} %`}
          mid={`${categories.find((c) => c.id === t.category_id)?.name ?? "Sans lot"} · échéance ${fmtD(t.end)}`}
          right={`${t.lateDays} j de retard`}
        />
      ))}
    </View>
  );
};

// ── Planning (Gantt) ─────────────────────────────────────────────────────────
// Lignes : jalons en tête, puis chaque lot (barre prévue, remplie selon
// l'avancement) suivi de ses tâches. Paginé, l'axe des dates est répété.
export function ganttRows(model, { showTasks = true } = {}) {
  const rows = [];
  if (model.jalons.length) rows.push({ kind: "jalons", key: "jalons" });
  for (const l of model.lots) {
    rows.push({ kind: "lot", key: `lot-${l.id}`, lot: l });
    if (showTasks) for (const t of l.tasks) rows.push({ kind: "task", key: `t-${t.id}`, task: t });
  }
  if (showTasks && model.orphanTasks.length) {
    rows.push({ kind: "group", key: "orphans", label: "Sans lot" });
    for (const t of model.orphanTasks) rows.push({ kind: "task", key: `t-${t.id}`, task: t });
  }
  return rows;
}

export function ganttRange(model) {
  const days = [];
  const push = (iso) => iso && days.push(dayNum(iso));
  for (const l of model.lots) { push(l.plannedStart); push(l.plannedEnd); push(l.realStart); push(l.realEnd); for (const t of l.tasks) { push(t.start); push(t.end); } }
  for (const t of model.orphanTasks) { push(t.start); push(t.end); }
  for (const j of model.jalons) push(j.date);
  push(model.today);
  if (!days.length) return null;
  let min = Math.min(...days), max = Math.max(...days);
  // Marges et début au 1er du mois pour un axe lisible.
  const start = new Date(min * DAY); start.setUTCDate(1);
  const end = new Date(max * DAY); end.setUTCMonth(end.getUTCMonth() + 1, 0);
  min = Math.floor(start.getTime() / DAY); max = Math.floor(end.getTime() / DAY) + 1;
  return { min, max };
}

const ROW_H = { jalons: 22, lot: 19, task: 14, group: 16 };

/** Découpe les lignes en pages selon la hauteur disponible. */
export function paginateGantt(rows, available) {
  const pages = [[]];
  let h = 0;
  rows.forEach((r, i) => {
    let rh = ROW_H[r.kind];
    // Un lot (ou un groupe) ne finit pas une page sans sa première tâche.
    const next = rows[i + 1];
    const keep = (r.kind === "lot" || r.kind === "group") && next?.kind === "task" ? ROW_H.task : 0;
    if (h + rh + keep > available && pages.at(-1).length) { pages.push([]); h = 0; }
    pages.at(-1).push(r); h += rh;
  });
  return pages;
}

export const Gantt = ({ rows, range, model, width, primaryColor, fontFamily }) => {
  const LABEL_W = 180;
  const chartW = width - LABEL_W;
  const span = range.max - range.min;
  const x = (iso) => ((dayNum(iso) - range.min) / span) * chartW;
  const clampX = (v) => Math.max(0, Math.min(chartW, v));

  // Graduations : mois (ou semaines sur une courte période).
  const ticks = [];
  if (span <= 70) {
    for (let d = range.min; d <= range.max; d += 7) ticks.push({ at: d, label: fmtShort(fromNum(d)) });
  } else {
    const d = new Date(range.min * DAY);
    while (d.getTime() / DAY < range.max) {
      ticks.push({ at: Math.round(d.getTime() / DAY), label: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }) });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }
  const step = Math.max(1, Math.ceil(ticks.length / 14));
  const todayX = x(model.today);
  const bodyH = rows.reduce((s, r) => s + ROW_H[r.kind], 0);

  const BarRow = ({ start, end, progress, late, done, h, strong }) => {
    if (!start && !end) return null;
    const a = clampX(x(start ?? end)), b = clampX(x(end ?? start) + chartW / span);
    const w = Math.max(3, b - a);
    const fill = done ? "#15803d" : late ? "#b91c1c" : primaryColor;
    return (
      <View style={{ position: "absolute", left: a, top: (ROW_H[strong ? "lot" : "task"] - h) / 2, width: w, height: h, borderRadius: 2, backgroundColor: strong ? "#e7e5e4" : "#f0efee", ...(late ? { borderWidth: 1, borderColor: "#b91c1c" } : {}) }}>
        <View style={{ width: (w * progress) / 100, height: "100%", borderRadius: 2, backgroundColor: fill, opacity: strong ? 1 : 0.85 }} />
      </View>
    );
  };

  return (
    <View>
      {/* Axe */}
      <View style={{ flexDirection: "row", height: 18, borderBottomWidth: 1, borderBottomColor: "#a8a29e" }}>
        <View style={{ width: LABEL_W }} />
        <View style={{ width: chartW, position: "relative" }}>
          {ticks.map((t, i) => (
            <View key={t.at} style={{ position: "absolute", left: ((t.at - range.min) / span) * chartW, top: 0, height: 18, borderLeftWidth: 0.5, borderLeftColor: "#d6d3d1", paddingLeft: 2 }}>
              {i % step === 0 ? <Text style={{ fontSize: 6.5, color: "#57534e", fontFamily }}>{t.label}</Text> : null}
            </View>
          ))}
        </View>
      </View>
      {/* Lignes */}
      <View style={{ position: "relative" }}>
        {/* Quadrillage et ligne du jour, sous les barres */}
        <View style={{ position: "absolute", left: LABEL_W, top: 0, width: chartW, height: bodyH }}>
          {ticks.map((t) => (
            <View key={t.at} style={{ position: "absolute", left: ((t.at - range.min) / span) * chartW, top: 0, height: bodyH, borderLeftWidth: 0.5, borderLeftColor: "#f0efee" }} />
          ))}
          {todayX >= 0 && todayX <= chartW && (
            <View style={{ position: "absolute", left: todayX, top: 0, height: bodyH, borderLeftWidth: 1, borderLeftColor: "#b91c1c" }} />
          )}
        </View>
        {rows.map((r) => (
          <View key={r.key} style={{ flexDirection: "row", height: ROW_H[r.kind], ...(r.kind === "task" ? {} : { borderBottomWidth: 0.5, borderBottomColor: "#e7e5e4" }) }}>
            <View style={{ width: LABEL_W, justifyContent: "center", paddingRight: 6, paddingLeft: r.kind === "task" ? 12 : 0 }}>
              {r.kind === "jalons" && <Text style={{ fontSize: 8, fontWeight: "bold", color: "#292524", fontFamily }}>Jalons</Text>}
              {r.kind === "group" && <Text style={{ fontSize: 8, fontWeight: "bold", color: "#57534e", fontFamily }}>{r.label}</Text>}
              {r.kind === "lot" && (
                <Text style={{ fontSize: 8, fontWeight: "bold", color: r.lot.state === "late" ? "#b91c1c" : "#292524", fontFamily }} >
                  {r.lot.name}<Text style={{ fontWeight: "normal", color: "#78716c" }}>{`  ${r.lot.progress} %`}</Text>
                </Text>
              )}
              {r.kind === "task" && (
                <Text style={{ fontSize: 7, color: r.task.late ? "#b91c1c" : "#44403c", fontFamily }}>{(r.task.name || "Tâche").slice(0, 42)}</Text>
              )}
            </View>
            <View style={{ width: chartW, position: "relative" }}>
              {r.kind === "lot" && (
                <BarRow start={r.lot.plannedStart} end={r.lot.plannedEnd} progress={r.lot.progress} late={r.lot.state === "late"} done={r.lot.state === "done"} h={9} strong />
              )}
              {r.kind === "task" && (
                <BarRow start={r.task.start} end={r.task.end} progress={r.task.progress} late={r.task.late} done={r.task.done} h={6} />
              )}
              {r.kind === "jalons" && model.jalons.map((j) => {
                const jx = x(j.date);
                if (jx < 0 || jx > chartW) return null;
                return (
                  <View key={j.id} style={{ position: "absolute", left: jx - 4, top: 3, alignItems: "flex-start" }}>
                    <View style={{ width: 7, height: 7, transform: "rotate(45deg)", backgroundColor: j.done ? "#15803d" : j.late ? "#b91c1c" : "#292524" }} />
                    <Text style={{ fontSize: 5.5, color: "#44403c", marginTop: 2, marginLeft: -2, fontFamily }}>{j.libelle.slice(0, 22)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      {/* Légende */}
      <View style={{ flexDirection: "row", gap: 14, marginTop: 8, alignItems: "center" }}>
        {[
          [primaryColor, "Avancement"], ["#15803d", "Terminé"], ["#b91c1c", "En retard"], ["#e7e5e4", "Durée prévue"],
        ].map(([c, l]) => (
          <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 12, height: 6, borderRadius: 2, backgroundColor: c }} />
            <Text style={{ fontSize: 7, color: "#57534e", fontFamily }}>{l}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 1, height: 10, backgroundColor: "#b91c1c" }} />
          <Text style={{ fontSize: 7, color: "#57534e", fontFamily }}>Aujourd'hui ({fmtD(model.today)})</Text>
        </View>
      </View>
    </View>
  );
};

// ── Reportage photo ──────────────────────────────────────────────────────────
// Une page par tâche : la photo la plus récente, ce qu'elle illustre (tâche,
// lot, avancement, légende, date) et, si on sait où elle a été prise, le plan
// avec l'emplacement. Comme les rapports d'état d'avancement des bureaux de
// suivi : « Les travaux de … sont achevés à 70 % ».

/** Tâches illustrées : celles qui ont au moins une photo, dans l'ordre des lots. */
export function photoReport(model) {
  const latest = (photos) =>
    [...(photos || [])]
      .filter((ph) => ph?.public_url && !ph.deleted_at)
      .sort((a, b) => String(b.date || b.created_at || "").localeCompare(String(a.date || a.created_at || "")))[0];
  const items = [];
  for (const l of model.lots) {
    for (const t of l.tasks) {
      const photo = latest(t.pins_photos);
      if (photo) items.push({ task: t, lot: l, photo });
    }
  }
  for (const t of model.orphanTasks) {
    const photo = latest(t.pins_photos);
    if (photo) items.push({ task: t, lot: null, photo });
  }
  return items;
}

/** Emplacement : celui de la photo s'il est connu, sinon celui de la tâche. */
const photoSpot = ({ photo, task }) =>
  photo.plan_id && photo.plan_x != null && photo.plan_y != null
    ? { planId: photo.plan_id, x: photo.plan_x, y: photo.plan_y }
    : task.plan_id && task.x != null && task.y != null
      ? { planId: task.plan_id, x: task.x, y: task.y }
      : null;

const fitBox = (dims, maxW, maxH) => {
  if (!dims?.width || !dims?.height) return { w: maxW, h: maxH };
  const r = dims.width / dims.height;
  return maxW / maxH > r ? { w: maxH * r, h: maxH } : { w: maxW, h: maxW / r };
};

export const PhotoProgressPage = ({ item, width, height, planImagesByPlanId = {}, planDimensionsByPlanId = {}, primaryColor, fontFamily, showPlan = true, showCaption = true }) => {
  const { task, lot, photo } = item;
  const spot = photoSpot(item);
  const planImage = showPlan && spot ? planImagesByPlanId[spot.planId] : null;
  const GAP = 16;
  const colW = planImage ? (width - GAP) / 2 : width * 0.62;
  const planBox = planImage ? fitBox(planDimensionsByPlanId[spot.planId], colW - 16, height - 16) : null;
  const photoH = showCaption ? height - 92 : height;
  const late = task.late;
  const verb = task.progress >= 100 ? "sont achevés à" : task.progress > 0 ? "sont réalisés à" : "ne sont pas encore engagés :";
  const takenOn = toDay(photo.date || photo.created_at);

  const caption = (
    <View style={{ borderTopWidth: 1, borderTopColor: "#e7e5e4", paddingTop: 8, marginTop: 8 }}>
      <Text style={{ fontSize: 10.5, color: "#292524", lineHeight: 1.4, fontFamily }}>
        {photo.description ? `${photo.description} — ` : ""}Les travaux « {task.name || "Tâche"} » {verb}{" "}
        <Text style={{ fontWeight: "bold", color: task.progress >= 100 ? "#15803d" : late ? "#b91c1c" : "#292524" }}>{task.progress}{"\u00a0%"}</Text>.
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
        <Bar value={task.progress} width={120} height={6} color={late ? "#b91c1c" : primaryColor} />
        <Text style={{ fontSize: 8, color: "#78716c", fontFamily }}>
          {lot ? `${lot.name}${lot.company ? ` · ${lot.company}` : ""}  ·  ` : ""}
          {task.start || task.end ? `du ${fmtD(task.start)} au ${fmtD(task.end)}` : ""}
          {late ? `  ·  ${task.lateDays} j de retard` : ""}
        </Text>
      </View>
      {takenOn ? <Text style={{ fontSize: 7.5, color: "#a8a29e", marginTop: 4, fontFamily }}>Photo du {fmtD(takenOn)}</Text> : null}
    </View>
  );

  return (
    <View style={{ flexDirection: "row", gap: GAP, height }}>
      {planImage ? (
        <View style={{ width: colW, height, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e7e5e4", borderRadius: 4 }}>
          <View style={{ width: planBox.w, height: planBox.h, position: "relative" }}>
            <Image src={planImage} style={{ position: "absolute", left: 0, top: 0, width: planBox.w, height: planBox.h }} />
            {/* Point de prise de vue */}
            <View style={{ position: "absolute", left: spot.x * planBox.w - 14, top: spot.y * planBox.h - 14, width: 28, height: 28, borderRadius: 14, backgroundColor: "#dc2626", opacity: 0.22 }} />
            <View style={{ position: "absolute", left: spot.x * planBox.w - 7, top: spot.y * planBox.h - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: "#dc2626", borderWidth: 2, borderColor: "white" }} />
          </View>
        </View>
      ) : null}
      <View style={{ width: colW, height }}>
        <Image src={photo.public_url} style={{ width: colW, height: photoH, objectFit: "cover", borderRadius: 4 }} />
        {showCaption ? caption : null}
      </View>
      {!planImage ? (
        <View style={{ flex: 1, paddingTop: 4 }}>
          <Text style={{ fontSize: 26, fontWeight: "bold", color: task.progress >= 100 ? "#15803d" : late ? "#b91c1c" : "#292524", fontFamily }}>{task.progress}{"\u00a0%"}</Text>
          <Text style={{ fontSize: 8, color: "#78716c", fontFamily }}>d'avancement</Text>
          {showPlan ? <Text style={{ fontSize: 8, color: "#a8a29e", marginTop: 14, fontFamily }}>Emplacement non renseigné</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

// ── Effectifs de site ────────────────────────────────────────────────────────
// Personnel présent par entreprise, saisi à la composition du rapport.
export const WorkforceTable = ({ rows = [], primaryColor, fontFamily, showLots = true, showTotal = true }) => {
  const W = showLots ? ["44%", "40%", "16%"] : ["84%", null, "16%"];
  const heads = showLots ? ["Entreprise", "Lots", "Effectif"] : ["Entreprise", "Effectif"];
  const widths = showLots ? W : [W[0], W[2]];
  const total = rows.reduce((n, r) => n + (r.count || 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.count || 0));
  return (
    <View style={{ marginTop: 6, borderWidth: 1, borderColor: "#d6d3d1", borderRadius: 4 }}>
      <View style={{ flexDirection: "row", backgroundColor: "#f5f5f4", borderBottomWidth: 1, borderBottomColor: "#d6d3d1" }}>
        {heads.map((h, i) => (
          <Cell key={h} w={widths[i]} header last={i === heads.length - 1} align={i === heads.length - 1 ? "right" : undefined} fontFamily={fontFamily}>{h}</Cell>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={`${r.name}-${i}`} wrap={false} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e7e5e4", backgroundColor: i % 2 ? "#fafaf9" : "white" }}>
          <Cell w={W[0]} fontFamily={fontFamily}><Text style={{ fontSize: 8.5, fontWeight: "bold", color: "#292524", fontFamily }}>{r.name}</Text></Cell>
          {showLots && <Cell w={W[1]} fontFamily={fontFamily}><Text style={{ fontSize: 8, color: "#57534e", fontFamily }}>{r.lots || "—"}</Text></Cell>}
          <Cell w={W[2]} last align="right" fontFamily={fontFamily}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View style={{ width: 34 * ((r.count || 0) / max), height: 5, backgroundColor: primaryColor, borderRadius: 2 }} />
              <Text style={{ fontSize: 8.5, fontWeight: "bold", color: "#292524", fontFamily }}>{String(r.count || 0)}</Text>
            </View>
          </Cell>
        </View>
      ))}
      {showTotal && <View wrap={false} style={{ flexDirection: "row", backgroundColor: "#f5f5f4" }}>
        <Cell w="84%" fontFamily={fontFamily}><Text style={{ fontSize: 8.5, fontWeight: "bold", color: "#292524", fontFamily }}>Total sur site</Text></Cell>
        <Cell w={W[2]} last align="right" fontFamily={fontFamily}><Text style={{ fontSize: 9, fontWeight: "bold", color: "#292524", fontFamily }}>{`${total} pers.`}</Text></Cell>
      </View>}
    </View>
  );
};
