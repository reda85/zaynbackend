// Types de rapport : chacun ne garde qu'une nature d'élément (pdf_pins.type)
// et a sa présentation par défaut. Même table côté web (lib/data/reportKinds.js).
//
// - reserves   : réserves groupées par lot, bilan par statut, retards.
// - visite     : observations, uniquement photos, description et localisation.
// - avancement : tâches groupées par lot, avec début, échéance et avancement.
// - libre      : tous les éléments reçus, comme avant les types de rapport.

export const REPORT_KINDS = {
  reserves: {
    pinType: "reserve",
    label: "réserve",
    config: {
      reportTitle: "RAPPORT DE RÉSERVES",
      tasks: { title: "Réserves", groupBy: "category" },
      summary: { showOverdueCount: true, showStatusBreakdown: true },
    },
  },
  visite: {
    pinType: "observation",
    label: "observation",
    config: {
      reportTitle: "RAPPORT DE VISITE DE CHANTIER",
      tasks: { title: "Observations", groupBy: "none", displayMode: "visite" },
      summary: { showOverdueCount: false, showStatusBreakdown: false },
    },
  },
  avancement: {
    pinType: "tache",
    label: "tâche",
    config: {
      reportTitle: "RAPPORT D'AVANCEMENT",
      tasks: { title: "Détail des tâches", groupBy: "category" },
      summary: { showOverdueCount: true, showStatusBreakdown: true },
    },
  },
  libre: { pinType: null, label: "élément", config: {} },
};

export const reportKindOf = (value) => (value && REPORT_KINDS[value] ? value : "libre");

/**
 * Pose la présentation du type sous la configuration du modèle.
 * Un modèle fait pour ce type garde la main sur tout ; un modèle « libre »
 * garde son style (couleurs, en-tête, sections) mais le contenu suit le type.
 */
export function applyReportKind(config, kind, templateKind) {
  const defaults = REPORT_KINDS[kind]?.config ?? {};
  const base = config || {};
  const templateWins = reportKindOf(templateKind) === kind;
  const merge = (a = {}, b = {}) => (templateWins ? { ...a, ...b } : { ...b, ...a });
  const out = { ...base };
  if (defaults.reportTitle && (!templateWins || !base.reportTitle)) out.reportTitle = defaults.reportTitle;
  if (defaults.tasks) out.tasks = merge(defaults.tasks, base.tasks);
  if (defaults.summary) out.summary = merge(defaults.summary, base.summary);
  // Rapport de visite : sans modèle dédié, la vue « visite » s'impose ; un
  // modèle de visite peut choisir galerie ou photos localisées à la place.
  if (kind === "visite" && !templateWins) out.tasks.displayMode = "visite";
  return out;
}
