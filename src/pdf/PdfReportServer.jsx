// src/pdf/PdfReportServer.jsx
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Go up to project root (src/pdf -> src -> project root)
const projectRoot = path.join(__dirname, '../../');

export const pdfIconsMap = {
  "grid": path.join(projectRoot, "icons/grid-white.png"),
  "zap": path.join(projectRoot, "icons/zap-white.png"),
  "droplets": path.join(projectRoot, "icons/droplets-white.png"),
  "paint": path.join(projectRoot, "icons/paint-roller-white.png"),
  "fire-extinguisher": path.join(projectRoot, "icons/fire-extinguisher-white.png"),
  "carrelage": path.join(projectRoot, "icons/grid-white.png"),
  "unassigned": path.join(projectRoot, "icons/check-white.png"),
};

const ICONS = {
  calendar: path.join(projectRoot, "icons/calendar-days-stone.png"),
  map: path.join(projectRoot, "icons/map-stone.png"),
};

function PdfCategoryLabel({ category, status }) {
  const iconSrc = pdfIconsMap[category?.icon];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
        backgroundColor: status?.color || "#666",
        borderRadius: 9999,
        paddingVertical: 2,
        paddingHorizontal: 4,
        minHeight: 18,
      }}
    >
      {iconSrc && <Image src={iconSrc} style={{ width: 12, height: 12 }} />}
    </View>
  );
}

// === CONFIGURE TAILWIND FOR PDF ===
const tw = createTw({
  theme: {
    fontFamily: {
      sans: ["Helvetica", "Arial", "sans-serif"],
    },
    extend: {
      colors: {
        stone: {
          50: "#f5f5f4",
          100: "#e7e5e4",
          700: "#44403c",
          800: "#292524",
        },
      },
    },
  },
});

// === GROUP BY HELPER ===
const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    const k = item[key] ?? "Autre";
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});

// === TABLE CELL COMPONENT ===
const TableCell = ({ children, header, width, align = "left", border = true, config }) => (
  <View
    style={{
      width: width || "auto",
      padding: config?.tableView?.compactMode ? 4 : 6,
      borderRightWidth: border ? 1 : 0,
      borderRightColor: "#d6d3d1",
      borderBottomWidth: 1,
      borderBottomColor: "#d6d3d1",
      backgroundColor: header ? (config?.tableView?.headerBackgroundColor || "#f5f5f4") : "white",
      justifyContent: "center",
      alignItems: align === "center" ? "center" : "flex-start",
    }}
  >
    {typeof children === "string" ? (
      <Text style={{ 
        fontSize: header ? 10 : 9, 
        fontWeight: header ? "bold" : "normal", 
        color: header ? "#292524" : "#44403c" 
      }}>
        {children}
      </Text>
    ) : (
      children
    )}
  </View>
);

// === TABLE VIEW COMPONENT ===
const TableView = ({ selectedPins, categories, statuses, fields, config }) => {
  const photoSizeMap = {
    small: { width: 80, height: 80 },
    medium: { width: 120, height: 120 },
    large: { width: 160, height: 160 },
  };

  const photoSize = photoSizeMap[config?.tableView?.photoSize || 'medium'];

  return (
    <View style={{ marginTop: 24 }}>
      {/* Table Header */}
      <View style={{ 
        flexDirection: "row", 
        borderTopWidth: 1, 
        borderLeftWidth: 1, 
        borderTopColor: "#d6d3d1", 
        borderLeftColor: "#d6d3d1", 
        fontSize: 8 
      }}>
        {config?.tableView?.showIndex && <TableCell config={config} header width="5%">#</TableCell>}
        <TableCell config={config} header width="30%">Tâche</TableCell>
        <TableCell config={config} header width="8%">ID</TableCell>
        {fields.category && <TableCell config={config} header width="10%">Catégorie</TableCell>}
        {fields.status && <TableCell config={config} header width="12%">Statut</TableCell>}
        {fields.assignedTo && <TableCell config={config} header width="12%">Assigné à</TableCell>}
        {fields.dueDate && <TableCell config={config} header width="12%">Échéance</TableCell>}
        {fields.snapshot && <TableCell config={config} header width="11%" border={false}>Plan</TableCell>}
      </View>

      {/* Table Rows */}
      {selectedPins.map((pin, index) => {
        const category = categories.find((c) => String(c.id) === String(pin.category_id));
        const status = statuses.find((s) => s.id === pin.status_id);
        const firstPhoto = pin.pins_photos?.[0];

        return (
          <View 
            key={pin.id || index} 
            style={{ 
              flexDirection: "row", 
              borderLeftWidth: 1, 
              borderLeftColor: "#d6d3d1",
              backgroundColor: config?.tableView?.alternateRowColors && index % 2 === 0 
                ? "white" 
                : config?.tableView?.alternateRowColors 
                  ? "#fafaf9" 
                  : "white"
            }}
            wrap={false}
          >
            {/* # */}
            {config?.tableView?.showIndex && (
              <TableCell config={config} width="5%" align="center">
                {index + 1}
              </TableCell>
            )}

            {/* Tâche avec photo en dessous */}
            <View
              style={{
                width: "30%",
                padding: config?.tableView?.compactMode ? 4 : 6,
                borderRightWidth: 1,
                borderRightColor: "#d6d3d1",
                borderBottomWidth: 1,
                borderBottomColor: "#d6d3d1",
                backgroundColor: config?.tableView?.alternateRowColors && index % 2 === 0 
                  ? "white" 
                  : config?.tableView?.alternateRowColors 
                    ? "#fafaf9" 
                    : "white",
                justifyContent: "flex-start",
              }}
            >
              <Text style={{ fontSize: 8, fontWeight: "bold", marginBottom: 6 }}>
                {pin?.name || "Sans nom"}
              </Text>
              
              {/* Photo sous le nom */}
              {config?.tableView?.showPhotosInline && fields.photos && firstPhoto && (
                <Image
                  src={firstPhoto.public_url}
                  style={{
                    width: photoSize.width,
                    height: photoSize.height,
                    objectFit: "cover",
                    borderRadius: 4,
                    border: "1pt solid #d6d3d1",
                  }}
                />
              )}
            </View>

            {/* ID */}
            <TableCell config={config} width="8%">
              <Text style={{ fontSize: 7 }}>
                {pin.projects?.project_number}-{pin.pin_number}
              </Text>
            </TableCell>

            {/* Catégorie */}
            {fields.category && (
              <TableCell config={config} width="10%">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 7 }}>{category?.name || "-"}</Text>
                </View>
              </TableCell>
            )}

            {/* Statut */}
            {fields.status && (
              <TableCell config={config} width="12%">
                <View
                  style={{
                    backgroundColor: status?.color || "#666",
                    borderRadius: 9999,
                    paddingVertical: 2,
                    paddingHorizontal: 6,
                    alignSelf: "flex-start",
                  }}
                >
                  <Text style={{ fontSize: 7, color: "white" }}>{status?.name || "Inconnu"}</Text>
                </View>
              </TableCell>
            )}

            {/* Assigné à */}
            {fields.assignedTo && (
              <TableCell config={config} width="12%">
                <Text style={{ fontSize: 7 }}>
                  {pin.assigned_to?.name || "-"}
                </Text>
              </TableCell>
            )}

            {/* Échéance */}
            {fields.dueDate && (
              <TableCell config={config} width="12%">
                <Text style={{ fontSize: 7 }}>
                  {pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}
                </Text>
              </TableCell>
            )}

            {/* Plan */}
            {fields.snapshot && (
              <TableCell config={config} width="11%" border={false}>
                <Text style={{ fontSize: 7 }}>
                  {pin.pdf_name || "-"}
                </Text>
              </TableCell>
            )}
          </View>
        );
      })}
    </View>
  );
};

// === LIST VIEW COMPONENT ===
const ListView = ({ selectedPins, categories, statuses, fields, config }) => {
  const snapshotSizeMap = {
    small: { width: 150, height: 150 },
    medium: { width: 200, height: 200 },
    large: { width: 220, height: 220 },
  };

  const snapshotSize = snapshotSizeMap[config?.listView?.snapshotSize || 'large'];
  const primaryColor = config?.primaryColor || "#44403c";

  return (
    <>
      {selectedPins.map((pin, index) => {
        const category = categories.find((c) => String(c.id) === String(pin.category_id));
        const status = statuses.find((s) => s.id === pin.status_id);

        return (
          <View key={pin.id || index} wrap={false}>
            <View style={tw("flex-row gap-8 my-6")} break={index > 0}>
              {/* LEFT COLUMN - TEXT */}
              <View style={{ width: "65%" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {config?.listView?.showIndex && (
                    <Text style={[tw("text-lg font-bold"), { color: primaryColor }]}>
                      {index + 1}.
                    </Text>
                  )}
                  <Text style={tw("text-lg font-bold text-stone-800")}>
                    {pin?.name || "Tâche sans nom"}
                  </Text>
                </View>

                {/* Category + Status Pills */}
                {(config?.listView?.showCategoryIcon || config?.listView?.showStatusPill) && (
                  <View style={tw("flex-row items-center gap-2 mt-2")}>
                    {config?.listView?.showCategoryIcon && category && (
                      <PdfCategoryLabel category={category} status={status} />
                    )}
                    {config?.listView?.showStatusPill && fields.status && (
                      <View
                        style={[
                          tw("rounded-full px-3 py-1"),
                          { backgroundColor: status?.color || "#666" },
                        ]}
                      >
                        <Text style={tw("text-white text-xs")}>{status?.name || "Inconnu"}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={tw("mt-3 my-2")}>
                  <View style={tw("flex-row my-2")}>
                    <Text style={tw("text-sm font-bold text-stone-700 w-36")}>ID:</Text>
                    <Text style={tw("text-sm text-stone-800")}>
                      {pin.projects?.project_number}-{pin.pin_number}
                    </Text>
                  </View>
                  {fields.category && pin.category_id && (
                    <View style={tw("flex-row my-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Catégorie:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{category?.name}</Text>
                    </View>
                  )}
                  {fields.createdBy && (
                    <View style={tw("flex-row my-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Créé par:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{pin.created_by?.name || "-"}</Text>
                    </View>
                  )}
                  {fields.assignedTo && (
                    <View style={tw("flex-row my-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Assigné à:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{pin.assigned_to?.name || "-"}</Text>
                    </View>
                  )}
                  {fields.dueDate && (
                    <View style={tw("flex-row items-center my-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Échéance:</Text>
                      <Image src={ICONS.calendar} style={{ width: 14, height: 14, marginRight: 4 }} />
                      <Text style={tw("text-sm text-stone-800")}>
                        {pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}
                      </Text>
                    </View>
                  )}
                  {fields.description && (
                    <View style={tw("flex-row my-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Description:</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={tw("text-sm text-stone-800")}>
                          {pin.note || "-"}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {/* RIGHT COLUMN - IMAGES */}
              <View style={{ width: "35%", alignItems: "center", flexShrink: 0 }}>
                {fields.snapshot && pin.snapshot && (
                  <Image
                    src={pin.snapshot}
                    style={{
                      width: snapshotSize.width,
                      height: snapshotSize.height,
                      objectFit: "cover",
                      border: config?.listView?.snapshotBorder 
                        ? `${config.listView.snapshotBorderWidth || 4}pt solid ${primaryColor}` 
                        : "4pt solid black",
                      borderRadius: 4,
                    }}
                  />
                )}
                {fields.snapshot && pin.pdf_name && (
                  <View style={tw("flex-row items-center gap-2 mt-3")}>
                    <Image src={ICONS.map} style={{ width: 16, height: 16 }} />
                    <Text style={tw("text-sm font-bold text-stone-800")}>{pin.pdf_name}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* PHOTOS GRID */}
            {fields.photos && pin.pins_photos?.length > 0 && (
              <View style={tw("mt-4")}>
                <Text style={tw("text-sm font-bold text-stone-700 mb-2")}>Médias</Text>
                <View style={tw("flex-row flex-wrap gap-3")}>
                  {pin.pins_photos.map((photo, i) => (
                    <Image
                      key={i}
                      src={photo.public_url}
                      style={{
                        width: 140,
                        height: 140,
                        objectFit: "cover",
                        borderRadius: 4,
                      }}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* DIVIDER */}
            {config?.listView?.showDividers && index < selectedPins.length - 1 && (
              <View
                style={{
                  height: 1,
                  backgroundColor: "#ccc",
                  marginVertical: 20,
                  width: "100%",
                }}
              />
            )}
          </View>
        );
      })}
    </>
  );
};

// === COVER PAGE COMPONENT ===
const CoverPage = ({ selectedProject, config }) => {
  if (!config?.coverPage?.enabled) return null;

  const primaryColor = config?.primaryColor || "#44403c";

  const logoSizeMap = {
    small: { width: 80, height: 56 },
    medium: { width: 112, height: 80 },
    large: { width: 144, height: 96 },
  };

  const companyLogoSize = logoSizeMap[config.coverPage.companyLogoSize || 'medium'];
  const clientLogoSize = logoSizeMap[config.coverPage.clientLogoSize || 'medium'];

  return (
    <Page size="A4" style={{ padding: 50, backgroundColor: "white" }}>
      {/* Logos */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 48 }}>
        {config.coverPage.showCompanyLogo && (
          <View style={{ 
            width: companyLogoSize.width, 
            height: companyLogoSize.height, 
            backgroundColor: "#f5f5f4",
            borderWidth: 2,
            borderColor: "#d6d3d1",
            borderStyle: "dashed",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Text style={{ fontSize: 8, color: "#a8a29e" }}>Logo</Text>
          </View>
        )}
        
        {config.coverPage.showClientLogo && (
          <View style={{ 
            width: clientLogoSize.width, 
            height: clientLogoSize.height, 
            backgroundColor: "#f5f5f4",
            borderWidth: 2,
            borderColor: "#d6d3d1",
            borderStyle: "dashed",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Text style={{ fontSize: 8, color: "#a8a29e" }}>Client</Text>
          </View>
        )}
      </View>

      {/* Title */}
      <View style={{ borderLeftWidth: 8, borderLeftColor: primaryColor, paddingLeft: 16, marginBottom: 48 }}>
        <Text style={{ fontSize: 48, fontWeight: "bold", color: primaryColor, marginBottom: 16 }}>
          {config.reportTitle || "RAPPORT DE TÂCHES"}
        </Text>
        <Text style={{ fontSize: 20, color: "#78716c" }}>
          {selectedProject?.name || "Projet"}
        </Text>
      </View>

      {/* Project Photo placeholder */}
      {config.coverPage.showProjectPhoto && (
        <View style={{ alignItems: "center", marginBottom: 40 }}>
          <View style={{
            width: config.coverPage.projectPhotoSize === 'full' ? "100%" :
                   config.coverPage.projectPhotoSize === 'large' ? "80%" :
                   config.coverPage.projectPhotoSize === 'medium' ? "66%" : "256",
            height: config.coverPage.projectPhotoSize === 'full' ? 384 :
                    config.coverPage.projectPhotoSize === 'large' ? 320 :
                    config.coverPage.projectPhotoSize === 'medium' ? 256 : 192,
            backgroundColor: "#f5f5f4",
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center"
          }}>
            <Text style={{ fontSize: 10, color: "#a8a29e" }}>Photo de projet</Text>
          </View>
        </View>
      )}

      {/* Summary */}
      {config.coverPage.showSummary && (
        <View style={{
          backgroundColor: "#f5f5f4",
          padding: 24,
          borderRadius: 16,
          borderLeftWidth: 4,
          borderLeftColor: primaryColor,
          marginBottom: 32
        }}>
          <Text style={{ fontSize: 10, fontWeight: "bold", color: primaryColor, marginBottom: 8 }}>
            RÉSUMÉ EXÉCUTIF
          </Text>
          <Text style={{ fontSize: 12, color: "#44403c", fontStyle: "italic" }}>
            "Le projet progresse conformément au planning."
          </Text>
        </View>
      )}

      {/* Participants */}
      {config.coverPage.showParticipants && (
        <View style={{ marginTop: "auto" }}>
          <Text style={{ fontSize: 10, fontWeight: "bold", color: "#a8a29e", marginBottom: 16 }}>
            ÉQUIPE PROJET
          </Text>
          <View style={config.coverPage.participantsLayout === 'grid' 
            ? { flexDirection: "row", flexWrap: "wrap", gap: 24 } 
            : { gap: 12 }
          }>
            {["Architecte", "Chef de projet", "Ingénieur", "Client"].map((role) => (
              <View key={role} style={{ 
                width: config.coverPage.participantsLayout === 'grid' ? "45%" : "100%",
                borderBottomWidth: 1, 
                borderBottomColor: "#e7e5e4", 
                paddingBottom: 12 
              }}>
                <Text style={{ fontSize: 12, fontWeight: "bold", color: "#292524" }}>{role}</Text>
                <Text style={{ fontSize: 9, color: "#78716c" }}>Nom du participant</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Footer */}
      <View style={{ 
        marginTop: "auto", 
        paddingTop: 24, 
        borderTopWidth: 1, 
        borderTopColor: "#e7e5e4",
        flexDirection: "row",
        justifyContent: "space-between"
      }}>
        <Text style={{ fontSize: 9, color: "#a8a29e" }}>
          {selectedProject?.organizations?.name || "Organisation"}
        </Text>
        <Text style={{ fontSize: 9, color: "#a8a29e" }}>Page 01</Text>
      </View>
    </Page>
  );
};

// === MAIN COMPONENT ===
export default function PdfReportServer({
  selectedPins = [],
  categories = [],
  statuses = [],
  selectedProject = {},
  fields = {},
  displayMode = "list",
  config = null, // NEW: template configuration
}) {
  // Use default config if none provided
  const templateConfig = config || {
    primaryColor: "#44403c",
    fontFamily: "helvetica",
    reportTitle: "RAPPORT DE TÂCHES",
    header: {
      showOrganizationName: true,
      showProjectName: true,
      showDate: true,
    },
    summary: {
      enabled: true,
      showPeriod: true,
      showTotalCount: true,
      showOverdueCount: true,
      showPlanCount: true,
      showStatusBreakdown: true,
      backgroundColor: "#f5f5f4",
    },
    tasks: {
      displayMode: displayMode,
      groupBy: "none",
    },
    listView: {
      showIndex: true,
      showCategoryIcon: true,
      showStatusPill: true,
      snapshotSize: "large",
      showDividers: true,
      snapshotBorder: true,
      snapshotBorderWidth: 4,
    },
    tableView: {
      showIndex: true,
      showPhotosInline: true,
      photoSize: "medium",
      compactMode: false,
      alternateRowColors: true,
      headerBackgroundColor: "#f5f5f4",
    },
    coverPage: {
      enabled: false,
    },
    footer: {
      enabled: false,
    },
  };

  const pinsByStatus = groupBy(selectedPins, "status_id");
  const actualDisplayMode = templateConfig.tasks?.displayMode || displayMode;

  return (
    <Document>
      {/* Cover Page (if enabled) */}
      <CoverPage selectedProject={selectedProject} config={templateConfig} />

      {/* Main Report Page */}
      <Page size="A4" style={tw("p-8 bg-white")} wrap>
        {/* === HEADER === */}
        {(templateConfig.header?.showOrganizationName || templateConfig.header?.showProjectName || templateConfig.header?.showDate) && (
          <View style={tw("flex-row justify-between items-start mb-6")}>
            <View>
              {templateConfig.header?.showOrganizationName && (
                <Text style={[tw("text-lg font-bold"), { color: templateConfig.primaryColor }]}>
                  {selectedProject?.organizations?.name || "Organisation"}
                </Text>
              )}
              {templateConfig.header?.showProjectName && (
                <Text style={tw("text-base text-stone-800 mt-1")}>
                  {selectedProject?.name || "Projet"}
                </Text>
              )}
            </View>
            {templateConfig.header?.showDate && (
              <Text style={tw("text-sm text-stone-800")}>
                {new Date().toLocaleDateString("fr-FR")}
              </Text>
            )}
          </View>
        )}

        {/* === SUMMARY BOX === */}
        {templateConfig.summary?.enabled && (
          <View style={[tw("p-4 rounded-lg mb-6"), { backgroundColor: templateConfig.summary.backgroundColor }]}>
            <Text style={[tw("text-base font-bold"), { color: templateConfig.primaryColor }]}>
              {templateConfig.reportTitle}
            </Text>

            <View style={tw("flex-row mt-4")}>
              {templateConfig.summary?.showPeriod && (
                <View style={tw("w-1/2")}>
                  <Text style={tw("text-xs font-bold text-stone-600 mb-2")}>Période</Text>
                  <Text style={tw("text-sm text-stone-800 mt-2")}>
                    {selectedPins.length > 0
                      ? (() => {
                          const dates = selectedPins.map((pin) => new Date(pin.created_at));
                          const earliest = new Date(Math.min(...dates));
                          const latest = new Date(Math.max(...dates));
                          return `${earliest.toLocaleDateString("fr-FR")} - ${latest.toLocaleDateString("fr-FR")}`;
                        })()
                      : "-"}
                  </Text>
                </View>
              )}
              <View style={tw("flex-row w-1/2")}>
                {templateConfig.summary?.showTotalCount && (
                  <View style={tw("w-1/3")}>
                    <Text style={tw("text-xs text-stone-800 font-bold")}>Total</Text>
                    <Text style={tw("text-sm font-bold mt-2")}>{selectedPins.length}</Text>
                  </View>
                )}
                {templateConfig.summary?.showOverdueCount && (
                  <View style={tw("w-1/3 px-2")}>
                    <Text style={tw("text-xs text-stone-800 font-bold")}>En retard</Text>
                    <Text style={tw("text-sm font-bold mt-2")}>
                      {selectedPins.filter((pin) => pin.due_date && new Date(pin.due_date) < new Date()).length}
                    </Text>
                  </View>
                )}
                {templateConfig.summary?.showPlanCount && (
                  <View style={tw("w-1/3 px-2")}>
                    <Text style={tw("text-xs text-stone-800 font-bold")}>Plans</Text>
                    <Text style={tw("text-sm font-bold mt-2")}>
                      {Object.keys(groupBy(selectedPins, "pdf_name")).length}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Status Pills */}
            {templateConfig.summary?.showStatusBreakdown && (
              <View style={tw("mt-6")}>
                <Text style={tw("text-sm font-bold text-stone-800")}>Par statut</Text>
                <View style={tw("flex-row flex-wrap gap-2 mt-3")}>
                  {Object.keys(pinsByStatus).map((statusId) => {
                    const status = statuses.find((s) => String(s.id) === String(statusId));
                    const count = pinsByStatus[statusId].length;
                    return (
                      <View
                        key={statusId}
                        style={[
                          tw("rounded-full px-3 py-1 flex-row items-center"),
                          { backgroundColor: status?.color || "#666" },
                        ]}
                      >
                        <Text style={tw("text-white text-xs")}>
                          {status?.name || "Inconnu"} ({count})
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}

        {/* === CONTENT - TABLE OR LIST === */}
        {actualDisplayMode === "table" ? (
          <TableView
            selectedPins={selectedPins}
            categories={categories}
            statuses={statuses}
            fields={fields}
            config={templateConfig}
          />
        ) : (
          <ListView
            selectedPins={selectedPins}
            categories={categories}
            statuses={statuses}
            fields={fields}
            config={templateConfig}
          />
        )}

        {/* === FOOTER === */}
        {templateConfig.footer?.enabled && (
          <View style={{ 
            marginTop: 40, 
            paddingTop: 16, 
            borderTopWidth: 1, 
            borderTopColor: "#e7e5e4",
            flexDirection: "row",
            justifyContent: "space-between"
          }}>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {templateConfig.footer?.showProjectInfo && (
                <Text style={{ fontSize: 9, color: "#78716c" }}>
                  {selectedProject?.name || "Projet"}
                </Text>
              )}
              {templateConfig.footer?.showCompanyInfo && (
                <Text style={{ fontSize: 9, color: "#78716c" }}>
                  {selectedProject?.organizations?.name || "Organisation"}
                </Text>
              )}
              {templateConfig.footer?.customText && (
                <Text style={{ fontSize: 9, color: "#78716c" }}>
                  {templateConfig.footer.customText}
                </Text>
              )}
            </View>
            {templateConfig.footer?.showPageNumbers && (
              <Text style={{ fontSize: 9, color: "#78716c" }}>Page 1</Text>
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}