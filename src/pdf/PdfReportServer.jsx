// src/pdf/PdfReportServer.jsx   ← outside app/ folder
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
//import { pdfIconsMap } from "@/utils/iconsMap";

const getBaseUrl = () => {
  if (typeof window !== 'undefined') return ''; // Browser - use relative paths
  if (process.env.VERCEL_URL) return `https://${process.env.RAILWAY_URL}`; // Vercel
  return 'http://localhost:3000'; // Development
};


export const pdfIconsMap = {
  "grid": path.join(process.cwd(), "icons/grid-white.png"),
  "zap": path.join(process.cwd(), "icons/zap-white.png"),
  "droplets": path.join(process.cwd(), "icons/droplets-white.png"),
  "paint": path.join(process.cwd(), "icons/paint-roller-white.png"),
  "fire-extinguisher": path.join(process.cwd(), "icons/fire-extinguisher-white.png"),
  "carrelage": path.join(process.cwd(), "icons/grid-white.png"),
  "Non assigne": path.join(process.cwd(), "icons/user-x-white.png"),
};

function PdfCategoryLabel({ category, status }) {
  const iconSrc = pdfIconsMap[category?.icon];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center", // align to middle with text
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
          700: "#44403c",
          800: "#292524",
        },
      },
    },
  },
});

// === YOUR ICONS (put them in public/icons/) ===
// === YOUR ICONS (use absolute URLs for server-side rendering) ===

const ICONS = {
  calendar: path.join(process.cwd(), "icons/calendar-days-stone.png"),
  map: path.join(process.cwd(), "icons/map-stone.png"),
};

// === REUSABLE CATEGORY LABEL (with icon + status color) ===


// === GROUP BY HELPER ===
const groupBy = (arr, key) =>
  arr.reduce((acc, item) => {
    const k = item[key] ?? "Autre";
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});

export default function PdfReportServer({
  selectedPins = [],
  categories = [],
  statuses = [],
  selectedProject = {},
}) {
  const pinsByStatus = groupBy(selectedPins, "status_id");

  return (
    <Document>
      <Page size="A4" style={tw("p-8 bg-white")} wrap>
        {/* === HEADER === */}
        <View style={tw("flex-row justify-between items-start mb-6")}>
          <View>
            <Text style={tw("text-stone-800 text-lg font-bold")}>Entreprise X</Text>
            <Text style={tw("text-base text-stone-800 mt-1")}>{selectedProject?.name || "Projet"}</Text>
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
                {selectedPins[0]?.due_date
                  ? new Date(selectedPins[0].due_date).toLocaleDateString("fr-FR")
                  : "-"}
              </Text>
            </View>
            <View style={tw("flex-row w-1/2")}>
              <View style={tw("w-1/3")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Total tâches</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{selectedPins.length}</Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>En retard</Text>
                <Text style={tw("text-sm font-bold mt-2")}>?</Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Plans</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{Object.keys(groupBy(selectedPins, "pdf_name")).length}</Text>
              </View>
            </View>
          </View>

          {/* Status Pills */}
          <View style={tw("mt-6")}>
            <Text style={tw("text-sm font-bold text-stone-800")}>Tâches par statut</Text>
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

        {/* === PINS LIST === */}
        {selectedPins.map((pin, index) => {
          const category = categories.find((c) => String(c.id) === String(pin.category_id));
          const status = statuses.find((s) => s.id === pin.status_id);

          return (
            <View key={pin.id || index} wrap={false}>
              <View style={tw("flex-row gap-8 my-6")} break={index > 0}>
                {/* LEFT COLUMN - TEXT */}
                <View style={{ flex: 1 }}>
                  <Text style={tw("text-lg font-bold text-stone-800")}>
                    {index + 1}. {pin.name}
                  </Text>

                  {/* Category + Status Pills */}
                  <View style={tw("flex-row items-center gap-2 mt-2")}>
                    {category && <PdfCategoryLabel category={category} status={status} />}
                    <View
                      style={[
                        tw("rounded-full px-3 py-1"),
                        { backgroundColor: status?.color || "#666" },
                      ]}
                    >
                      <Text style={tw("text-white text-xs")}>{status?.name || "Inconnu"}</Text>
                    </View>
                  </View>

                  <View style={tw("mt-3 space-y-2")}>
                    <View style={tw("flex-row")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>ID:</Text>
                      <Text style={tw("text-sm text-stone-800")}>
                        {pin.projects?.project_number}-{pin.pin_number}
                      </Text>
                    </View>
                    {pin.category_id && (
                      <View style={tw("flex-row")}>
                        <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Catégorie:</Text>
                        <Text style={tw("text-sm text-stone-800")}>{category?.name}</Text>
                      </View>
                    )}
                    <View style={tw("flex-row")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Créé par:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{pin.created_by || "-"}</Text>
                    </View>
                    <View style={tw("flex-row")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Assigné à:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{pin.assigned_to?.name || "-"}</Text>
                    </View>
                    <View style={tw("flex-row items-center gap-2")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Échéance:</Text>
                      <Image src={ICONS.calendar} style={{ width: 14, height: 14 }} />
                      <Text style={tw("text-sm text-stone-800")}>
                        {pin.due_date ? new Date(pin.due_date).toLocaleDateString("fr-FR") : "-"}
                      </Text>
                    </View>
                    <View style={tw("flex-row")}>
                      <Text style={tw("text-sm font-bold text-stone-700 w-36")}>Description:</Text>
                      <Text style={tw("text-sm text-stone-800")}>{pin.note || "-"}</Text>
                    </View>
                  </View>
                </View>

                {/* RIGHT COLUMN - IMAGES */}
                <View style={tw("items-center")}>
                  {pin.snapshot && (
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
                  {pin.pdf_name && (
                    <View style={tw("flex-row items-center gap-2 mt-3")}>
                      <Image src={ICONS.map} style={{ width: 16, height: 16 }} />
                      <Text style={tw("text-sm font-bold text-stone-800")}>{pin.pdf_name}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* PHOTOS GRID */}
              {pin.pins_photos?.length > 0 && (
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
      </Page>
    </Document>
  );
}