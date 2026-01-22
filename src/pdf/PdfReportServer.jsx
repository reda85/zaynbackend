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
const TableCell = ({ children, header, width, align = "left", border = true }) => (
  <View
    style={{
      width: width || "auto",
      padding: 6,
      borderRightWidth: border ? 1 : 0,
      borderRightColor: "#d6d3d1",
      borderBottomWidth: 1,
      borderBottomColor: "#d6d3d1",
      backgroundColor: header ? "#f5f5f4" : "white",
      justifyContent: "center",
      alignItems: align === "center" ? "center" : "flex-start",
    }}
  >
    {typeof children === "string" ? (
      <Text style={{ fontSize: header ? 10 : 9, fontWeight: header ? "bold" : "normal", color: header ? "#292524" : "#44403c" }}>
        {children}
      </Text>
    ) : (
      children
    )}
  </View>
);

// === TABLE VIEW COMPONENT ===
// === TABLE VIEW COMPONENT ===
const TableView = ({ selectedPins, categories, statuses, fields }) => {
  return (
    <View style={{ marginTop: 24 }}>
      {/* Table Header */}
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderLeftWidth: 1, borderTopColor: "#d6d3d1", borderLeftColor: "#d6d3d1", fontSize: 8 }}>
        <TableCell header width="5%">#</TableCell>
        <TableCell header width="30%">Tâche</TableCell>
        <TableCell header width="8%">ID</TableCell>
        {fields.category && <TableCell header width="10%">Catégorie</TableCell>}
        {fields.status && <TableCell header width="12%">Statut</TableCell>}
        {fields.assignedTo && <TableCell header width="12%">Assigné à</TableCell>}
        {fields.dueDate && <TableCell header width="12%">Échéance</TableCell>}
        {fields.snapshot && <TableCell header width="11%" border={false}>Plan</TableCell>}
      </View>

      {/* Table Rows */}
      {selectedPins.map((pin, index) => {
        const category = categories.find((c) => String(c.id) === String(pin.category_id));
        const status = statuses.find((s) => s.id === pin.status_id);
        const firstPhoto = pin.pins_photos?.[0]; // Première photo du pin

        return (
          <View 
            key={pin.id || index} 
            style={{ 
              flexDirection: "row", 
              borderLeftWidth: 1, 
              borderLeftColor: "#d6d3d1",
              backgroundColor: index % 2 === 0 ? "white" : "#fafaf9"
            }}
            wrap={false}
          >
            {/* # */}
            <TableCell width="5%" align="center">
              {index + 1}
            </TableCell>

            {/* Tâche avec photo en dessous */}
            <View
              style={{
                width: "30%",
                padding: 6,
                borderRightWidth: 1,
                borderRightColor: "#d6d3d1",
                borderBottomWidth: 1,
                borderBottomColor: "#d6d3d1",
                backgroundColor: index % 2 === 0 ? "white" : "#fafaf9",
                justifyContent: "flex-start",
              }}
            >
              <Text style={{ fontSize: 8, fontWeight: "bold", marginBottom: 6 }}>
                {pin?.name || "Sans nom"}
              </Text>
              
              {/* Photo sous le nom - taille doublée */}
              {fields.photos && firstPhoto && (
                <Image
                  src={firstPhoto.public_url}
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: "cover",
                    borderRadius: 4,
                    border: "1pt solid #d6d3d1",
                  }}
                />
              )}
            </View>

            {/* ID */}
            <TableCell width="8%">
              <Text style={{ fontSize: 7 }}>
                {pin.projects?.project_number}-{pin.pin_number}
              </Text>
            </TableCell>

            {/* Catégorie */}
            {fields.category && (
              <TableCell width="10%">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>

                  <Text style={{ fontSize: 7 }}>{category?.name || "-"}</Text>
                </View>
              </TableCell>
            )}

            {/* Statut */}
            {fields.status && (
              <TableCell width="12%">
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
              <TableCell width="12%">
                <Text style={{ fontSize: 7 }}>
                  {pin.assigned_to?.name || "-"}
                </Text>
              </TableCell>
            )}

            {/* Échéance */}
            {fields.dueDate && (
              <TableCell width="12%">
                <Text style={{ fontSize: 7 }}>
                  {pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}
                </Text>
              </TableCell>
            )}

            {/* Plan */}
            {fields.snapshot && (
              <TableCell width="11%" border={false}>
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
// === LIST VIEW COMPONENT (votre version actuelle) ===
const ListView = ({ selectedPins, categories, statuses, fields }) => {
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
                <Text style={tw("text-lg font-bold text-stone-800")}>
                  {index + 1}. {pin?.name || "Tâche sans nom"}
                </Text>

                {/* Category + Status Pills */}
                <View style={tw("flex-row items-center gap-2 mt-2")}>
                  {category && <PdfCategoryLabel category={category} status={status} />}
                  {fields.status && (
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
                  <View style={tw("flex-row my-2")}>
                    <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Créé par:</Text>
                    <Text style={tw("text-sm text-stone-800")}>{pin.created_by?.name || "-"}</Text>
                  </View>
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
                      width: 220,
                      height: 220,
                      objectFit: "cover",
                      border: "4pt solid black",
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
            {index < selectedPins.length - 1 && (
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

// === MAIN COMPONENT ===
export default function PdfReportServer({
  selectedPins = [],
  categories = [],
  statuses = [],
  selectedProject = {},
  fields = {},
  displayMode = "list", // "list" ou "table"
}) {
  const pinsByStatus = groupBy(selectedPins, "status_id");

  return (
    <Document>
      <Page size="A4" style={tw("p-8 bg-white")} wrap>
        {/* === HEADER === */}
        <View style={tw("flex-row justify-between items-start mb-6")}>
          <View>
            <Text style={tw("text-stone-800 text-lg font-bold")}>
              {selectedProject?.organizations?.name || "Organisation"}
            </Text>
            <Text style={tw("text-base text-stone-800 mt-1")}>
              {selectedProject?.name || "Projet"}
            </Text>
          </View>
          <Text style={tw("text-sm text-stone-800")}>
            {new Date().toLocaleDateString("fr-FR")}
          </Text>
        </View>

        {/* === SUMMARY BOX === */}
        <View style={tw("bg-stone-50 p-4 rounded-lg mb-6")}>
          <Text style={tw("text-stone-800 text-base font-bold")}>Résumé du rapport</Text>

          <View style={tw("flex-row mt-4")}>
            <View style={tw("w-1/2")}>
              <Text style={tw("text-stone-800 text-xs font-bold")}>Période</Text>
              <Text style={tw("text-sm text-stone-800 mt-2")}>
                {selectedPins.length > 0
                  ? (() => {
                      const dates = selectedPins.map((pin) => new Date(pin.created_at));
                      const earliest = new Date(Math.min(...dates));
                      const latest = new Date(Math.max(...dates));
                      return `${earliest.toLocaleDateString("fr-FR")} - ${latest.toLocaleDateString(
                        "fr-FR"
                      )}`;
                    })()
                  : "-"}
              </Text>
            </View>
            <View style={tw("flex-row w-1/2")}>
              <View style={tw("w-1/3")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Total</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{selectedPins.length}</Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>En retard</Text>
                <Text style={tw("text-sm font-bold mt-2")}>
                  {
                    selectedPins.filter(
                      (pin) => pin.due_date && new Date(pin.due_date) < new Date()
                    ).length
                  }
                </Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Plans</Text>
                <Text style={tw("text-sm font-bold mt-2")}>
                  {Object.keys(groupBy(selectedPins, "pdf_name")).length}
                </Text>
              </View>
            </View>
          </View>

          {/* Status Pills */}
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
        </View>

        {/* === CONTENT - TABLE OR LIST === */}
        {displayMode === "table" ? (
          <TableView
            selectedPins={selectedPins}
            categories={categories}
            statuses={statuses}
            fields={fields}
          />
        ) : (
          <ListView
            selectedPins={selectedPins}
            categories={categories}
            statuses={statuses}
            fields={fields}
          />
        )}
      </Page>
    </Document>
  );
}