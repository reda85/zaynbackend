// src/pdf/PdfReportServer.jsx
import React from 'react';
import { pathToFileURL } from 'url'
import fs from 'fs'
import { Document, Page, Text, View, Image, Font } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.join(__dirname, '../../');

// Add this helper right after your existing __dirname / projectRoot setup:




const fontsDir = path.resolve(projectRoot, 'fonts')

// Read font as ArrayBuffer — what react-pdf actually expects internally
const loadFontBuffer = (filename) => {
  const fullPath = path.join(fontsDir, filename)
  const buffer = fs.readFileSync(fullPath)
  // Convert Node Buffer to ArrayBuffer
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}



const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'

const fontUrl = (filename) => `${BACKEND_URL}/fonts/${filename}`

const registerFont = (family, variants) => {
  try {
    Font.register({ family, fonts: variants })
    console.log(`✅ Font registered: ${family}`)
  } catch (err) {
    console.warn(`⚠️ Font ${family} failed:`, err.message)
  }
}



registerFont("Inter",           [{ src: fontUrl('Inter-Regular.woff'),           fontWeight: "normal" }, { src: fontUrl('Inter-Bold.woff'),           fontWeight: "bold" }])
registerFont("Outfit",          [{ src: fontUrl('Outfit-Regular.woff'),          fontWeight: "normal" }, { src: fontUrl('Outfit-Bold.woff'),          fontWeight: "bold" }])
registerFont("Roboto",          [{ src: fontUrl('Roboto-Regular.woff'),          fontWeight: "normal" }, { src: fontUrl('Roboto-Bold.woff'),          fontWeight: "bold" }])
registerFont("Lato",            [{ src: fontUrl('Lato-Regular.woff'),            fontWeight: "normal" }, { src: fontUrl('Lato-Bold.woff'),            fontWeight: "bold" }])
registerFont("Montserrat",      [{ src: fontUrl('Montserrat-Regular.woff'),      fontWeight: "normal" }, { src: fontUrl('Montserrat-Bold.woff'),      fontWeight: "bold" }])
registerFont("Poppins",         [{ src: fontUrl('Poppins-Regular.woff'),         fontWeight: "normal" }, { src: fontUrl('Poppins-Bold.woff'),         fontWeight: "bold" }])
registerFont("Raleway",         [{ src: fontUrl('Raleway-Regular.woff'),         fontWeight: "normal" }, { src: fontUrl('Raleway-Bold.woff'),         fontWeight: "bold" }])
registerFont("OpenSans",        [{ src: fontUrl('OpenSans-Regular.woff'),        fontWeight: "normal" }, { src: fontUrl('OpenSans-Bold.woff'),        fontWeight: "bold" }])
registerFont("PlayfairDisplay", [{ src: fontUrl('PlayfairDisplay-Regular.woff'), fontWeight: "normal" }, { src: fontUrl('PlayfairDisplay-Bold.woff'), fontWeight: "bold" }])
registerFont("DMSans",          [{ src: fontUrl('DMSans-Regular.woff'),          fontWeight: "normal" }, { src: fontUrl('DMSans-Bold.woff'),          fontWeight: "bold" }])

const fontFamilyMap = {
  helvetica:   "Helvetica",
  times:       "Times-Roman",
  courier:     "Courier",
  inter:       "Inter",
  outfit:      "Outfit",
  roboto:      "Roboto",
  lato:        "Lato",
  montserrat:  "Montserrat",
  poppins:     "Poppins",
  raleway:     "Raleway",
  opensans:    "OpenSans",
  playfair:    "PlayfairDisplay",
  dmsans:      "DMSans",
}

export const pdfIconsMap = {
  "grid":              path.join(projectRoot, "icons/grid-white.png"),
  "zap":               path.join(projectRoot, "icons/zap-white.png"),
  "droplets":          path.join(projectRoot, "icons/droplets-white.png"),
  "paint":             path.join(projectRoot, "icons/paint-roller-white.png"),
  "fire-extinguisher": path.join(projectRoot, "icons/fire-extinguisher-white.png"),
  "carrelage":         path.join(projectRoot, "icons/grid-white.png"),
  "unassigned":        path.join(projectRoot, "icons/check-white.png"),
  "doors":             path.join(projectRoot, "icons/door-white.png"),
  "snowflake":         path.join(projectRoot, "icons/snowflake-white.png"),
  "folder":            path.join(projectRoot, "icons/folder-white.png"),
  "air-vent":          path.join(projectRoot, "icons/air-vent-white.png"),
  "alarm-smoke":       path.join(projectRoot, "icons/alarm-smoke-white.png"),
  "check-circle":      path.join(projectRoot, "icons/check-circle-white.png"),
  "package":           path.join(projectRoot, "icons/package-white.png"),
  "brick-wall":        path.join(projectRoot, "icons/brick-wall-white.png"),
  "brush-cleaning":    path.join(projectRoot, "icons/brush-cleaning-white.png"),
  "construction":      path.join(projectRoot, "icons/construction-white.png"),
  "droplet-off":       path.join(projectRoot, "icons/droplet-off-white.png"),
  "door-open":         path.join(projectRoot, "icons/door-open-white.png"),
  "trending-up":       path.join(projectRoot, "icons/trending-up-white.png"),
  "flame":             path.join(projectRoot, "icons/flame-white.png"),
  "trending-down":     path.join(projectRoot, "icons/trending-down-white.png"),
  "wifi":              path.join(projectRoot, "icons/wifi-white.png"),
};

const ICONS = {
  calendar: path.join(projectRoot, "icons/calendar-days-stone.png"),
  map:      path.join(projectRoot, "icons/map-stone.png"),
};

const tw = createTw({
  theme: {
    fontFamily: { sans: ["Helvetica", "Arial", "sans-serif"] },
    extend: {
      colors: {
        stone: { 50: "#f5f5f4", 100: "#e7e5e4", 700: "#44403c", 800: "#292524" },
      },
    },
  },
});

const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    const k = item[key] ?? "Autre";
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});

const logoHeightMap = { small: 24, medium: 36, large: 52 };
const HEADER_HEIGHT = 64;

const normalizeConfig = (config, displayMode) => {
  const base = config || {}
  return {
    primaryColor: "#44403c",
    fontFamily: "inter",
    reportTitle: "RAPPORT DE TÂCHES",
    ...base,
    header: {
      showOrganizationName: true,
      showProjectName: true,
      showDate: true,
      showLogo: false,
      logoUrl: '',
      logoSize: 'medium',
      showClientLogo: false,
      clientLogoUrl: '',
      clientLogoSize: 'medium',
      layout: "horizontal",
      ...(base.header || {}),
    },
    summary: {
      enabled: true,
      showPeriod: true,
      showTotalCount: true,
      showOverdueCount: true,
      showPlanCount: true,
      showStatusBreakdown: true,
      backgroundColor: "#f5f5f4",
      ...(base.summary || {}),
    },
    tasks: {
      displayMode,
      groupBy: "none",
      sortBy: "created_at",
      ...(base.tasks || {}),
    },
    listView: {
      showIndex: true,
      showCategoryIcon: true,
      showStatusPill: true,
      snapshotSize: "large",
      showDividers: true,
      snapshotBorder: true,
      snapshotBorderWidth: 4,
      ...(base.listView || {}),
    },
    tableView: {
      showIndex: true,
      showPhotosInline: true,
      photoSize: "medium",
      compactMode: false,
      alternateRowColors: true,
      headerBackgroundColor: "#f5f5f4",
      ...(base.tableView || {}),
    },
    coverPage: {
      enabled: false,
      showCompanyLogo: false,
      companyLogoSize: 'medium',
      showClientLogo: false,
      clientLogoSize: 'medium',
      showProjectPhoto: false,
      projectPhotoSize: 'medium',
      showSummary: false,
      titleStyle: 'bold',
      titleSize: 'large',
      titleAlign: 'left',
      titleLetterSpacing: 'normal',
      titleColor: 'primary',
      titleCustomColor: '#000000',
      titleAccentBar: true,
      ...(base.coverPage || {}),
    },
    participants: {
      enabled: false,
      title: "Équipe projet",
      layout: "grid",
      showRoles: true,
      showContact: false,
      ...(base.participants || {}),
    },
    signatures: {
      enabled: false,
      title: "Signatures",
      layout: "horizontal",
      fields: [],
      ...(base.signatures || {}),
    },
    footer: {
      enabled: false,
      showPageNumbers: true,
      showProjectInfo: true,
      showCompanyInfo: false,
      customText: "",
      ...(base.footer || {}),
    },
    customSections: base.customSections || [],
    fields: base.fields || {},
  }
}

// ── PDF Category Label ────────────────────────────────────────────────────────
function PdfCategoryLabel({ category, status }) {
  const iconSrc = pdfIconsMap[category?.icon];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: status?.color || "#666", borderRadius: 9999, paddingVertical: 2, paddingHorizontal: 4, minHeight: 18 }}>
      {iconSrc && <Image src={iconSrc} style={{ width: 12, height: 12 }} />}
    </View>
  );
}

// ── Table Cell ────────────────────────────────────────────────────────────────
const TableCell = ({ children, header, width, align = "left", border = true, config, fontFamily }) => (
  <View style={{
    width: width || "auto",
    padding: config?.tableView?.compactMode ? 4 : 6,
    borderRightWidth: border ? 1 : 0,
    borderRightColor: "#d6d3d1",
    borderBottomWidth: 1,
    borderBottomColor: "#d6d3d1",
    backgroundColor: header ? (config?.tableView?.headerBackgroundColor || "#f5f5f4") : "white",
    justifyContent: "center",
    alignItems: align === "center" ? "center" : "flex-start",
  }}>
    {typeof children === "string" ? (
      <Text style={{ fontSize: header ? 10 : 9, fontWeight: header ? "bold" : "normal", color: header ? "#292524" : "#44403c", fontFamily }}>
        {children}
      </Text>
    ) : children}
  </View>
);

// ── Table View ────────────────────────────────────────────────────────────────
const TableView = ({ selectedPins, categories, statuses, fields, config, fontFamily }) => {
  const photoSizeMap = { small: { width: 80, height: 80 }, medium: { width: 120, height: 120 }, large: { width: 160, height: 160 } };
  const photoSize = photoSizeMap[config?.tableView?.photoSize || 'medium'];

  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderLeftWidth: 1, borderTopColor: "#d6d3d1", borderLeftColor: "#d6d3d1" }}>
        {config?.tableView?.showIndex && <TableCell config={config} fontFamily={fontFamily} header width="5%">#</TableCell>}
        <TableCell config={config} fontFamily={fontFamily} header width="30%">Tâche</TableCell>
        <TableCell config={config} fontFamily={fontFamily} header width="8%">ID</TableCell>
        {fields.category   && <TableCell config={config} fontFamily={fontFamily} header width="10%">Catégorie</TableCell>}
        {fields.status     && <TableCell config={config} fontFamily={fontFamily} header width="12%">Statut</TableCell>}
        {fields.assignedTo && <TableCell config={config} fontFamily={fontFamily} header width="12%">Assigné à</TableCell>}
        {fields.dueDate    && <TableCell config={config} fontFamily={fontFamily} header width="12%">Échéance</TableCell>}
        {fields.snapshot   && <TableCell config={config} fontFamily={fontFamily} header width="11%" border={false}>Plan</TableCell>}
      </View>

      {selectedPins.map((pin, index) => {
        const category   = categories.find((c) => String(c.id) === String(pin.category_id));
        const status     = statuses.find((s) => s.id === pin.status_id);
        const firstPhoto = pin.pins_photos?.[0];
        const rowBg      = config?.tableView?.alternateRowColors && index % 2 !== 0 ? "#fafaf9" : "white";

        return (
          <View key={pin.id || index} style={{ flexDirection: "row", borderLeftWidth: 1, borderLeftColor: "#d6d3d1", backgroundColor: rowBg }} wrap={false}>
            {config?.tableView?.showIndex && <TableCell config={config} fontFamily={fontFamily} width="5%" align="center">{index + 1}</TableCell>}
            <View style={{ width: "30%", padding: config?.tableView?.compactMode ? 4 : 6, borderRightWidth: 1, borderRightColor: "#d6d3d1", borderBottomWidth: 1, borderBottomColor: "#d6d3d1", backgroundColor: rowBg }}>
              <Text style={{ fontSize: 8, fontWeight: "bold", marginBottom: 6, fontFamily }}>{pin?.name || "Sans nom"}</Text>
              {config?.tableView?.showPhotosInline && fields.photos && firstPhoto && (
                <Image src={firstPhoto.public_url} style={{ width: photoSize.width, height: photoSize.height, objectFit: "cover", borderRadius: 4, border: "1pt solid #d6d3d1" }} />
              )}
            </View>
            <TableCell config={config} fontFamily={fontFamily} width="8%"><Text style={{ fontSize: 7, fontFamily }}>{pin.projects?.project_number}-{pin.pin_number}</Text></TableCell>
            {fields.category   && <TableCell config={config} fontFamily={fontFamily} width="10%"><Text style={{ fontSize: 7, fontFamily }}>{category?.name || "-"}</Text></TableCell>}
            {fields.status     && (
              <TableCell config={config} fontFamily={fontFamily} width="12%">
                <View style={{ backgroundColor: status?.color || "#666", borderRadius: 9999, paddingVertical: 2, paddingHorizontal: 6, alignSelf: "flex-start" }}>
                  <Text style={{ fontSize: 7, color: "white", fontFamily }}>{status?.name || "Inconnu"}</Text>
                </View>
              </TableCell>
            )}
            {fields.assignedTo && <TableCell config={config} fontFamily={fontFamily} width="12%"><Text style={{ fontSize: 7, fontFamily }}>{pin.assigned_to?.name || "-"}</Text></TableCell>}
            {fields.dueDate    && <TableCell config={config} fontFamily={fontFamily} width="12%"><Text style={{ fontSize: 7, fontFamily }}>{pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}</Text></TableCell>}
            {fields.snapshot   && <TableCell config={config} fontFamily={fontFamily} width="11%" border={false}><Text style={{ fontSize: 7, fontFamily }}>{pin.pdf_name || "-"}</Text></TableCell>}
          </View>
        );
      })}
    </View>
  );
};

// ── List View ─────────────────────────────────────────────────────────────────
const ListView = ({ selectedPins, categories, statuses, fields, config, fontFamily }) => {
  const snapshotSizeMap = { small: { width: 100, height: 100 }, medium: { width: 120, height: 120 }, large: { width: 140, height: 140 } };
  const snapshotSize = snapshotSizeMap[config?.listView?.snapshotSize || 'large'];
  const primaryColor = config?.primaryColor || "#44403c";

  return (
    <>
      {selectedPins.map((pin, index) => {
        const category = categories.find((c) => String(c.id) === String(pin.category_id));
        const status   = statuses.find((s) => s.id === pin.status_id);

        return (
          <View key={pin.id || index} wrap={false}>
            <View style={{ flexDirection: "row", gap: 16, marginVertical: 12 }} break={index > 0}>
              <View style={{ width: "65%" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {config?.listView?.showIndex && (
                    <Text style={{ fontSize: 12, fontWeight: "bold", color: primaryColor, fontFamily }}>{index + 1}.</Text>
                  )}
                  <Text style={{ fontSize: 12, fontWeight: "bold", color: "#292524", fontFamily }}>{pin?.name || "Tâche sans nom"}</Text>
                </View>

                {(config?.listView?.showCategoryIcon || config?.listView?.showStatusPill) && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                    {config?.listView?.showCategoryIcon && category && <PdfCategoryLabel category={category} status={status} />}
                    {config?.listView?.showStatusPill && fields.status && (
                      <View style={{ backgroundColor: status?.color || "#666", borderRadius: 9999, paddingVertical: 2, paddingHorizontal: 8 }}>
                        <Text style={{ fontSize: 8, color: "white", fontFamily }}>{status?.name || "Inconnu"}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: "row", marginVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>ID:</Text>
                    <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>{pin.projects?.project_number}-{pin.pin_number}</Text>
                  </View>
                  {fields.category && pin.category_id && (
                    <View style={{ flexDirection: "row", marginVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>Catégorie:</Text>
                      <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>{category?.name || "-"}</Text>
                    </View>
                  )}
                  {fields.createdBy && (
                    <View style={{ flexDirection: "row", marginVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>Créé par:</Text>
                      <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>{pin.created_by?.name || "-"}</Text>
                    </View>
                  )}
                  {fields.assignedTo && (
                    <View style={{ flexDirection: "row", marginVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>Assigné à:</Text>
                      <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>{pin.assigned_to?.name || "-"}</Text>
                    </View>
                  )}
                  {fields.dueDate && (
                    <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>Échéance:</Text>
                      <Image src={ICONS.calendar} style={{ width: 10, height: 10, marginRight: 3 }} />
                      <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>
                        {pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}
                      </Text>
                    </View>
                  )}
                  {fields.description && (
                    <View style={{ flexDirection: "row", marginVertical: 2 }}>
                      <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", width: 80, fontFamily }}>Description:</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>{pin.note || "-"}</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              <View style={{ width: "35%", alignItems: "center", flexShrink: 0 }}>
                {fields.snapshot && pin.snapshot && (
                  <Image
                    src={pin.snapshot}
                    style={{
                      width: snapshotSize.width,
                      height: snapshotSize.height,
                      objectFit: "cover",
                      border: config?.listView?.snapshotBorder
                        ? `${config.listView.snapshotBorderWidth || 3}pt solid ${primaryColor}`
                        : "3pt solid black",
                      borderRadius: 4,
                    }}
                  />
                )}
                {fields.snapshot && pin.pdf_name && (
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 6, maxWidth: snapshotSize.width }}>
                    <Image src={ICONS.map} style={{ width: 10, height: 10, marginTop: 1, flexShrink: 0 }} />
                    <Text style={{ fontSize: 7, color: "#292524", flexShrink: 1, flexWrap: "wrap", fontFamily }}>{pin.pdf_name}</Text>
                  </View>
                )}
              </View>
            </View>

            {fields.photos && pin.pins_photos?.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 9, fontWeight: "bold", color: "#44403c", marginBottom: 6, fontFamily }}>Médias</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {pin.pins_photos.map((photo, i) => (
                    <View key={i} style={{ alignItems: "center" }}>
                      <Image src={photo.public_url} style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 4 }} />
                      {photo.description && (
                        <Text style={{ fontSize: 7, color: "#78716c", marginTop: 3, textAlign: "center", maxWidth: 110, fontFamily }}>{photo.description}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {config?.listView?.showDividers && index < selectedPins.length - 1 && (
              <View style={{ height: 1, backgroundColor: "#e7e5e4", marginVertical: 10, width: "100%" }} />
            )}
          </View>
        );
      })}
    </>
  );
};

// ── Participants Section ───────────────────────────────────────────────────────
const ParticipantsSection = ({ participants = [], config, primaryColor, fontFamily }) => {
  const pc      = config?.participants || {};
  const isGrid  = (pc.layout || 'grid') === 'grid';
  const present = participants.filter((p) => p.present !== false);
  const absent  = participants.filter((p) => p.present === false);

  return (
    <View style={{ marginTop: 24 }}>
      <Text style={{ fontSize: 10, fontWeight: "bold", color: "#a8a29e", marginBottom: 12, letterSpacing: 1, fontFamily }}>
        {(pc.title || "Équipe projet").toUpperCase()}
      </Text>
      <View style={isGrid ? { flexDirection: "row", flexWrap: "wrap", gap: 16 } : { gap: 8 }}>
        {present.map((member, i) => (
          <View key={member.id || i} style={{ width: isGrid ? "45%" : "100%", borderBottomWidth: 1, borderBottomColor: "#e7e5e4", paddingBottom: 10, paddingTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <View style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: "#10b981", flexShrink: 0 }} />
              <Text style={{ fontSize: 10, fontWeight: "bold", color: "#292524", fontFamily }}>{member.name || "—"}</Text>
            </View>
            {pc.showRoles   && member.role  && <Text style={{ fontSize: 8, color: "#78716c", paddingLeft: 12, fontFamily }}>{member.role}</Text>}
            {pc.showContact && member.email && <Text style={{ fontSize: 8, color: "#a8a29e", paddingLeft: 12, fontFamily }}>{member.email}</Text>}
          </View>
        ))}
      </View>
      {absent.length > 0 && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontSize: 8, color: "#a8a29e", marginBottom: 8, fontWeight: "bold", fontFamily }}>ABSENTS</Text>
          <View style={isGrid ? { flexDirection: "row", flexWrap: "wrap", gap: 16 } : { gap: 8 }}>
            {absent.map((member, i) => (
              <View key={member.id || i} style={{ width: isGrid ? "45%" : "100%", borderBottomWidth: 1, borderBottomColor: "#e7e5e4", paddingBottom: 10, paddingTop: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: "#d4d4d4", flexShrink: 0 }} />
                  <Text style={{ fontSize: 10, color: "#a8a29e", fontFamily }}>{member.name || "—"}</Text>
                </View>
                {pc.showRoles && member.role && <Text style={{ fontSize: 8, color: "#d4d4d4", paddingLeft: 12, fontFamily }}>{member.role}</Text>}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

// ── Custom Sections ───────────────────────────────────────────────────────────
const CustomSectionsView = ({ customSections = [], primaryColor, fontFamily }) => {
  const enabled = customSections.filter((s) => s.content?.trim());
  if (!enabled.length) return null;

  return (
    <>
      {enabled.map((section) => {
        const titleSizeMap  = { small: 9, medium: 11, large: 14 };
        const fontSize      = titleSizeMap[section.titleSize ?? 'medium'];
        const showBar       = section.titleAccentBar ?? true;
        const showUnderline = section.titleUnderline ?? false;

        const titleContainerStyle = showBar
          ? { borderLeftWidth: 3, borderLeftColor: primaryColor, paddingLeft: 8, marginBottom: 12 }
          : { marginBottom: 12 };

        return (
          <View key={section.id} style={{ marginTop: 32 }} wrap={false}>
            <View style={titleContainerStyle}>
              <Text style={{ fontSize, fontWeight: "bold", color: primaryColor, textDecoration: showUnderline ? "underline" : "none", fontFamily }}>
                {section.title}
              </Text>
            </View>
            {section.type === 'list' ? (
              <View style={{ gap: 6 }}>
                {section.content.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <View style={{ width: 4, height: 4, borderRadius: 9999, backgroundColor: primaryColor, marginTop: 4, flexShrink: 0 }} />
                    <Text style={{ fontSize: 9, color: "#44403c", flex: 1, fontFamily }}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ backgroundColor: "#f5f5f4", padding: 12, borderRadius: 4 }}>
                <Text style={{ fontSize: 9, color: "#44403c", lineHeight: 1.6, fontFamily }}>{section.content}</Text>
              </View>
            )}
          </View>
        );
      })}
    </>
  );
};

// ── Signatures ────────────────────────────────────────────────────────────────
const SignaturesView = ({ config, primaryColor, fontFamily }) => {
  const sc = config?.signatures;
  if (!sc?.enabled) return null;
  const enabled = (sc.fields || []).filter((f) => f.enabled);
  if (!enabled.length) return null;
  return (
    <View style={{ marginTop: 40 }} wrap={false}>
      <Text style={{ fontSize: 10, fontWeight: "bold", color: "#a8a29e", marginBottom: 16, letterSpacing: 1, fontFamily }}>
        {(sc.title || "Signatures").toUpperCase()}
      </Text>
      <View style={sc.layout !== 'vertical' ? { flexDirection: "row", gap: 24 } : { gap: 24 }}>
        {enabled.map((field, i) => (
          <View key={i} style={{ flex: sc.layout !== 'vertical' ? 1 : undefined }}>
            <Text style={{ fontSize: 9, color: "#78716c", marginBottom: 8, fontFamily }}>{field.label}</Text>
            <View style={{ borderBottomWidth: 1, borderBottomColor: "#292524", height: 40, marginBottom: 4 }} />
            <Text style={{ fontSize: 8, color: "#a8a29e", fontFamily }}>Date & Signature</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ── Cover Page Title ──────────────────────────────────────────────────────────
const CoverTitle = ({ config, primaryColor, projectName, fontFamily }) => {
  const cp = config?.coverPage || {};
  const titleStyle   = cp.titleStyle   || 'bold';
  const titleSize    = cp.titleSize    || 'large';
  const titleAlign   = cp.titleAlign   || 'left';
  const titleSpacing = cp.titleLetterSpacing || 'normal';
  const showBar      = cp.titleAccentBar ?? true;
  const titleColor   = (cp.titleColor || 'primary') === 'custom'
    ? (cp.titleCustomColor || '#000000')
    : primaryColor;

  const fontSizeMap = { small: 24, medium: 32, large: 42 };
  const subSizeMap  = { small: 13, medium: 16, large: 20 };
  const spacingMap  = { tight: -1, normal: 0, wide: 2 };

  const fontSize  = fontSizeMap[titleSize];
  const subSize   = subSizeMap[titleSize];
  const spacing   = spacingMap[titleSpacing];
  const textAlignStyle  = titleAlign === 'center' ? "center" : titleAlign === 'right' ? "right" : "left";
  const itemsAlignStyle = titleAlign === 'center' ? "center" : titleAlign === 'right' ? "flex-end" : "flex-start";

  const barStyle = showBar
    ? titleAlign === 'center'
      ? { borderTopWidth: 4, borderTopColor: titleColor, paddingTop: 16 }
      : titleAlign === 'right'
        ? { borderRightWidth: 8, borderRightColor: titleColor, paddingRight: 16 }
        : { borderLeftWidth: 8, borderLeftColor: titleColor, paddingLeft: 16 }
    : {};

  const reportTitle = config.reportTitle || "RAPPORT DE TÂCHES";
  const words     = reportTitle.split(' ');
  const boldPart  = words.slice(0, 2).join(' ');
  const lightPart = words.slice(2).join(' ') || "DE VISITE";

  return (
    <View style={{ ...barStyle, marginBottom: 40, alignItems: itemsAlignStyle }}>
      {titleStyle === 'bold' && (
        <>
          <Text style={{ fontSize, fontWeight: "bold", color: titleColor, letterSpacing: spacing, textTransform: "uppercase", marginBottom: 10, textAlign: textAlignStyle, fontFamily }}>
            {reportTitle}
          </Text>
          <Text style={{ fontSize: subSize, color: "#78716c", textAlign: textAlignStyle, fontFamily }}>
            {projectName || "Projet"}
          </Text>
        </>
      )}
      {titleStyle === 'light' && (
        <>
          <Text style={{ fontSize: Math.round(fontSize * 0.9), fontWeight: "normal", color: titleColor, letterSpacing: spacing, marginBottom: 10, textAlign: textAlignStyle, fontFamily }}>
            {reportTitle}
          </Text>
          <Text style={{ fontSize: subSize, color: "#78716c", textAlign: textAlignStyle, fontFamily }}>
            {projectName || "Projet"}
          </Text>
        </>
      )}
      {titleStyle === 'boldlight' && (
        <>
          <Text style={{ fontSize, fontWeight: "bold", color: titleColor, letterSpacing: spacing, textTransform: "uppercase", marginBottom: 4, textAlign: textAlignStyle, fontFamily }}>
            {boldPart}
          </Text>
          <Text style={{ fontSize: Math.round(fontSize * 0.6), fontWeight: "normal", color: titleColor, letterSpacing: spacing, marginBottom: 10, textAlign: textAlignStyle, opacity: 0.7, fontFamily }}>
            {lightPart}
          </Text>
          <Text style={{ fontSize: subSize, color: "#78716c", textAlign: textAlignStyle, fontFamily }}>
            {projectName || "Projet"}
          </Text>
        </>
      )}
    </View>
  );
};

// ── Cover Page ────────────────────────────────────────────────────────────────
const CoverPage = ({ selectedProject, config, participants, fontFamily }) => {
  if (!config?.coverPage?.enabled) return null;

  const primaryColor    = config?.primaryColor || "#44403c";
  const logoSizeMap     = { small: { width: 80, height: 56 }, medium: { width: 112, height: 80 }, large: { width: 144, height: 96 } };
  const companyLogoSize = logoSizeMap[config.coverPage?.companyLogoSize || 'medium'];
  const clientLogoSize  = logoSizeMap[config.coverPage?.clientLogoSize  || 'medium'];
  const companyLogoUrl  = config.header?.logoUrl       || config.coverPage?.companyLogoUrl || null;
  const clientLogoUrl   = config.header?.clientLogoUrl || config.coverPage?.clientLogoUrl  || null;
  const showParticipants = config.participants?.enabled && participants?.length > 0;

  return (
    <Page size="A4" style={{ backgroundColor: "white" }}>
      <View style={{ flex: 1, padding: 50, fontFamily }}>
        {/* Logos */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 48 }}>
          {config.coverPage?.showCompanyLogo ? (
            companyLogoUrl ? (
              <Image src={companyLogoUrl} style={{ width: companyLogoSize.width, height: companyLogoSize.height, objectFit: "contain" }} />
            ) : <View style={{ width: companyLogoSize.width, height: companyLogoSize.height }} />
          ) : <View />}
          {config.coverPage?.showClientLogo ? (
            clientLogoUrl ? (
              <Image src={clientLogoUrl} style={{ width: clientLogoSize.width, height: clientLogoSize.height, objectFit: "contain" }} />
            ) : <View style={{ width: clientLogoSize.width, height: clientLogoSize.height }} />
          ) : <View />}
        </View>

        <CoverTitle config={config} primaryColor={primaryColor} projectName={selectedProject?.name} fontFamily={fontFamily} />

        {config.coverPage?.showProjectPhoto && (
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <View style={{
              width:  config.coverPage.projectPhotoSize === 'full' ? "100%" : config.coverPage.projectPhotoSize === 'large' ? "80%" : config.coverPage.projectPhotoSize === 'medium' ? "66%" : "256",
              height: config.coverPage.projectPhotoSize === 'full' ? 384   : config.coverPage.projectPhotoSize === 'large' ? 320  : config.coverPage.projectPhotoSize === 'medium' ? 256  : 192,
              backgroundColor: "#f5f5f4", borderRadius: 8, alignItems: "center", justifyContent: "center",
            }}>
              <Text style={{ fontSize: 10, color: "#a8a29e", fontFamily }}>Photo de projet</Text>
            </View>
          </View>
        )}

        {config.coverPage?.showSummary && (
          <View style={{ backgroundColor: "#f5f5f4", padding: 20, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: primaryColor, marginBottom: 24 }}>
            <Text style={{ fontSize: 9, fontWeight: "bold", color: primaryColor, marginBottom: 6, fontFamily }}>RÉSUMÉ EXÉCUTIF</Text>
            <Text style={{ fontSize: 11, color: "#44403c", fontFamily }}>
              "Le projet progresse conformément au planning."
            </Text>
          </View>
        )}

        {showParticipants && (
          <ParticipantsSection participants={participants} config={config} primaryColor={primaryColor} fontFamily={fontFamily} />
        )}

        <View style={{ marginTop: "auto", paddingTop: 20, borderTopWidth: 1, borderTopColor: "#e7e5e4", flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 9, color: "#a8a29e", fontFamily }}>{selectedProject?.organizations?.name || "Organisation"}</Text>
          <Text style={{ fontSize: 9, color: "#a8a29e", fontFamily }}>{new Date().toLocaleDateString("fr-FR")}</Text>
        </View>
      </View>
    </Page>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function PdfReportServer({
  selectedPins    = [],
  categories      = [],
  statuses        = [],
  selectedProject = {},
  fields          = {},
  displayMode     = "list",
  config          = null,
  participants    = [],
  customSections  = [],
}) {
  const templateConfig    = normalizeConfig(config, displayMode);
  const primaryColor      = templateConfig.primaryColor || "#44403c";
  const fontFamily        = fontFamilyMap[templateConfig.fontFamily] || "Helvetica";
  const pinsByStatus      = groupBy(selectedPins, "status_id");
  const actualDisplayMode = templateConfig.tasks?.displayMode || displayMode;

  const showParticipantsOnMain =
    templateConfig.participants?.enabled === true &&
    participants.length > 0 &&
    !templateConfig.coverPage?.enabled;

  const logoH       = logoHeightMap[templateConfig.header?.logoSize       || 'medium'];
  const clientLogoH = logoHeightMap[templateConfig.header?.clientLogoSize || 'medium'];
  const hasLogo       = templateConfig.header?.showLogo       && !!templateConfig.header?.logoUrl;
  const hasClientLogo = templateConfig.header?.showClientLogo && !!templateConfig.header?.clientLogoUrl;

  const showHeader =
    templateConfig.header?.showOrganizationName ||
    templateConfig.header?.showProjectName      ||
    templateConfig.header?.showDate             ||
    hasLogo || hasClientLogo;

  return (
    <Document>
      <CoverPage selectedProject={selectedProject} config={templateConfig} participants={participants} fontFamily={fontFamily} />

      <Page
        size="A4"
        style={{
          paddingHorizontal: 32,
          paddingBottom: 32,
          paddingTop: showHeader ? HEADER_HEIGHT + 16 : 32,
          backgroundColor: "white",
          fontFamily,
        }}
        wrap
      >
        {/* ── HEADER ── */}
        {showHeader && (
          <View fixed style={{
            position: "absolute", top: 0, left: 0, right: 0,
            height: HEADER_HEIGHT,
            paddingHorizontal: 32, paddingVertical: 12,
            flexDirection: "row", justifyContent: "space-between", alignItems: "center",
            backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#e7e5e4",
          }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {hasLogo && <Image src={templateConfig.header.logoUrl} style={{ height: logoH, objectFit: "contain" }} />}
              <View>
                {templateConfig.header?.showOrganizationName && (
                  <Text style={{ fontSize: 11, fontWeight: "bold", color: primaryColor, fontFamily }}>
                    {selectedProject?.organizations?.name || "Organisation"}
                  </Text>
                )}
                {templateConfig.header?.showProjectName && (
                  <Text style={{ fontSize: 9, color: "#292524", marginTop: 2, fontFamily }}>
                    {selectedProject?.name || "Projet"}
                  </Text>
                )}
              </View>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              {hasClientLogo && <Image src={templateConfig.header.clientLogoUrl} style={{ height: clientLogoH, objectFit: "contain" }} />}
              {templateConfig.header?.showDate && (
                <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>
                  {new Date().toLocaleDateString("fr-FR")}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* ── SUMMARY ── */}
        {templateConfig.summary?.enabled && (
          <View style={{ padding: 16, borderRadius: 8, marginBottom: 24, backgroundColor: templateConfig.summary.backgroundColor || "#f5f5f4" }}>
            <Text style={{ fontSize: 12, fontWeight: "bold", color: primaryColor, marginBottom: 12, fontFamily }}>
              {templateConfig.reportTitle}
            </Text>
            <View style={{ flexDirection: "row" }}>
              {templateConfig.summary?.showPeriod && (
                <View style={{ width: "50%" }}>
                  <Text style={{ fontSize: 8, fontWeight: "bold", color: "#44403c", marginBottom: 4, fontFamily }}>Période</Text>
                  <Text style={{ fontSize: 9, color: "#292524", fontFamily }}>
                    {selectedPins.length > 0
                      ? (() => {
                          const dates    = selectedPins.map((p) => new Date(p.created_at));
                          const earliest = new Date(Math.min(...dates));
                          const latest   = new Date(Math.max(...dates));
                          return `${earliest.toLocaleDateString("fr-FR")} - ${latest.toLocaleDateString("fr-FR")}`;
                        })()
                      : "-"}
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: "row", width: "50%" }}>
                {templateConfig.summary?.showTotalCount && (
                  <View style={{ width: "33%" }}>
                    <Text style={{ fontSize: 8, fontWeight: "bold", color: "#292524", fontFamily }}>Total</Text>
                    <Text style={{ fontSize: 11, fontWeight: "bold", marginTop: 4, fontFamily }}>{selectedPins.length}</Text>
                  </View>
                )}
                {templateConfig.summary?.showOverdueCount && (
                  <View style={{ width: "33%", paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 8, fontWeight: "bold", color: "#292524", fontFamily }}>En retard</Text>
                    <Text style={{ fontSize: 11, fontWeight: "bold", marginTop: 4, fontFamily }}>
                      {selectedPins.filter((p) => p.due_date && new Date(p.due_date) < new Date()).length}
                    </Text>
                  </View>
                )}
                {templateConfig.summary?.showPlanCount && (
                  <View style={{ width: "33%", paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 8, fontWeight: "bold", color: "#292524", fontFamily }}>Plans</Text>
                    <Text style={{ fontSize: 11, fontWeight: "bold", marginTop: 4, fontFamily }}>
                      {Object.keys(groupBy(selectedPins, "pdf_name")).length}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {templateConfig.summary?.showStatusBreakdown && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 9, fontWeight: "bold", color: "#292524", marginBottom: 8, fontFamily }}>Par statut</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {Object.keys(pinsByStatus).map((statusId) => {
                    const status = statuses.find((s) => String(s.id) === String(statusId));
                    const count  = pinsByStatus[statusId].length;
                    return (
                      <View key={statusId} style={{ backgroundColor: status?.color || "#666", borderRadius: 9999, paddingVertical: 3, paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 8, color: "white", fontFamily }}>{status?.name || "Inconnu"} ({count})</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}

        {showParticipantsOnMain && (
          <ParticipantsSection participants={participants} config={templateConfig} primaryColor={primaryColor} fontFamily={fontFamily} />
        )}

        {actualDisplayMode === "table" ? (
          <TableView selectedPins={selectedPins} categories={categories} statuses={statuses} fields={fields} config={templateConfig} fontFamily={fontFamily} />
        ) : (
          <ListView selectedPins={selectedPins} categories={categories} statuses={statuses} fields={fields} config={templateConfig} fontFamily={fontFamily} />
        )}

        <CustomSectionsView customSections={customSections} primaryColor={primaryColor} fontFamily={fontFamily} />
        <SignaturesView config={templateConfig} primaryColor={primaryColor} fontFamily={fontFamily} />

        {templateConfig.footer?.enabled && (
          <View style={{ marginTop: 40, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#e7e5e4", flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {templateConfig.footer?.showProjectInfo  && <Text style={{ fontSize: 9, color: "#78716c", fontFamily }}>{selectedProject?.name || "Projet"}</Text>}
              {templateConfig.footer?.showCompanyInfo  && <Text style={{ fontSize: 9, color: "#78716c", fontFamily }}>{selectedProject?.organizations?.name || "Organisation"}</Text>}
              {templateConfig.footer?.customText       && <Text style={{ fontSize: 9, color: "#78716c", fontFamily }}>{templateConfig.footer.customText}</Text>}
            </View>
            {templateConfig.footer?.showPageNumbers && (
              <Text style={{ fontSize: 9, color: "#78716c", fontFamily }}>Page 1</Text>
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}