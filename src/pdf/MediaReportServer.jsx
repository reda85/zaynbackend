// src/pdf/PdfReportServer.jsx   ← outside app/ folder
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { createTw } from "react-pdf-tailwind";
import path from 'path';
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

export default function MediaReportServer({
  selectedMedias = [],

  selectedProject = {},
}) {
 // const pinsByStatus = groupBy(selectedPins, "status_id");

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
                {
  selectedMedias.length > 0
    ? (() => {
        const dates = selectedMedias.map(media => new Date(media.pdf_pins?.created_at));
        const earliest = new Date(Math.min(...dates));
        const latest = new Date(Math.max(...dates));
        return `${earliest.toLocaleDateString("fr-FR")} - ${latest.toLocaleDateString("fr-FR")}`;
      })()
    : "-"
}
              </Text>
            </View>
            <View style={tw("flex-row w-1/2")}>
              <View style={tw("w-1/3")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Total Photos</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{selectedMedias.length}</Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Total Pins</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{
  selectedMedias.length > 0
    ? (() => {
        const uniquePins = new Set(
          selectedMedias
            .map(media => media.pdf_pins?.id) // récupère l'id du pin
            .filter(Boolean) // ignore les valeurs null/undefined
        );
        return uniquePins.size; // nombre de pins uniques
      })()
    : 0
}</Text>
              </View>
              <View style={tw("w-1/3 px-2")}>
                <Text style={tw("text-xs text-stone-800 font-bold")}>Total Plans</Text>
                <Text style={tw("text-sm font-bold mt-2")}>{Object.keys(groupBy(selectedMedias, "pdf_name")).length}</Text>
              </View>
            </View>
          </View>


        </View>

        {/* === MEDIAS LIST === */}
        {selectedMedias.map((media, index) => {
          

          return (
            <View key={media.id || index} wrap={false}>
   <Text style={tw("text-lg font-bold text-stone-800")}>
                                    {index  + 1}. {media.pdf_pins?.name || "Photo sans nom"}
                                  </Text>            
<View style={tw("flex-row justify-between items-start")}>

                  {/* PHOTOS GRID */}
              {selectedMedias?.length > 0 && (
                <View style={tw("mt-4")}>
                {/* <Text style={tw("text-sm font-bold text-stone-700 mb-2")}>Médias</Text> */}
                
                                 
                  <View style={tw("flex-row flex-wrap gap-3")}>
                   
                      <Image
                        key={index}
                        src={media.public_url}
                        style={{
                          width: 280,
                          height: 280,
                          objectFit: "cover",
                          borderRadius: 4,
                        }}
                      />
                   
                  </View>
                </View>
              )}

                {/* RIGHT COLUMN - IMAGES */}
                <View style={tw("items-center")}>
                  {media.snapshot && (
                    <Image
                      src={media.snapshot}
                      style={{
                        width: 110,
                        height: 110,
                        objectFit: "cover",
                        border: "4pt solid black",
                        borderRadius: 4,
                      }}
                    />
                  )}
                  {media.pin_pdf?.pdf_name && (
                    <View style={tw("flex-row items-center gap-2 mt-3")}>
                      <Image src={ICONS.map} style={{ width: 16, height: 16 }} />
                      <Text style={tw("text-sm font-bold text-stone-800")}>{media.pdf_pins?.plans?.name}</Text>
                    </View>
                  )}
                </View>
              


</View>
<View style={tw("mt-2 mb-4")}>
     <Text style={tw("text-base font-bold text-stone-700")}>
                                   Description
                                  </Text> 
                  <Text style={tw("text-sm text-stone-800")}>
                    {media.description || "Aucune description fournie."}
                  </Text>
                </View>
              {/* DIVIDER */}
              {index < selectedMedias.length - 1 && (
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