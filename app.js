// app.js
// ------------------------
import "dotenv/config"; // Load environment variables first
import express from "express";
import cors from "cors";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "canvas";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import path from "path";
import { fileURLToPath } from "url";

// Import pdfjs-dist for Node.js - we'll use dynamic import
const pdfjsLib = await (async () => {
  try {
    // Try legacy CommonJS build first (most compatible with Node.js)
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    return require("pdfjs-dist/legacy/build/pdf.js");
  } catch (e) {
    console.error("Failed to load pdfjs-dist legacy build:", e.message);
    throw new Error("Please install pdfjs-dist: npm install pdfjs-dist@3.11.174");
  }
})();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------
// Load the JSX component - we'll load it dynamically when needed since it imports ESM packages
let PdfReportServer = null;



async function loadPdfReportComponent() {
  if (!PdfReportServer) {
    // When running with tsx, we can directly import JSX files
    const module = await import("./src/pdf/PdfReportServer.jsx");
    PdfReportServer = module.default;
  }
  return PdfReportServer;
}

// ------------------------
// Express setup
const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// ------------------------
// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ------------------------
// PDF.js worker configuration
const { createRequire } = await import("module");
const require = createRequire(import.meta.url);

try {
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
  console.log("PDF.js worker configured at:", workerPath);
} catch (e) {
  console.warn("PDF.js worker not configured properly:", e.message);
}

// ------------------------
// Render first page to canvas
async function renderPdfPage(pdfBuffer, scale = 2.5) {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: false, // Changed to false
      disableFontFace: true, // Changed to true - prevents font rendering issues
      standardFontDataUrl: null,
      verbosity: 0
    });
    
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    
    // Use scale of 2.5 for good balance
    const viewport = page.getViewport({ scale: scale });
    
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d", {
      alpha: false // Disable alpha channel for cleaner rendering
    });
    
    // Fill white background before rendering
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display',
      renderInteractiveForms: false,
      enableWebGL: false,
      background: 'white',
      annotationMode: 0, // Disable annotations
      renderTextLayer: false // Disable text layer if it's causing issues
    };
    
    const renderTask = page.render(renderContext);
    await renderTask.promise;
    
    // Clean up
    await pdf.cleanup();
    
    console.log(`PDF rendered successfully at ${viewport.width}x${viewport.height}`);
    
    return { canvas, width: viewport.width, height: viewport.height };
  } catch (error) {
    console.error("Error rendering PDF page:", error);
    throw new Error(`Failed to render PDF: ${error.message}`);
  }
}

// ------------------------
// Draw pin dot
function drawPinDot(ctx, size) {
  const center = size / 2;
  const radius = size * 0.03;
  
  // Draw white border
  ctx.fillStyle = "white";
  ctx.strokeStyle = "white";
  ctx.lineWidth = radius * 0.4;
  ctx.beginPath();
  ctx.arc(center, center, radius + ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw red dot
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
}

// ------------------------
// Crop zoomed snapshot
async function cropZoom(pdfImg, xNorm, yNorm, size = 800) {
  const { canvas, width, height } = pdfImg;
  const x = Math.floor(xNorm * width);
  const y = Math.floor(yNorm * height);
  
  // Create output canvas with no alpha for cleaner rendering
  const out = createCanvas(size, size);
  const ctx = out.getContext("2d", {
    alpha: false,
    antialias: 'subpixel'
  });
  
  // Disable image smoothing for pixel-perfect rendering
  ctx.imageSmoothingEnabled = false;
  
  // Calculate crop boundaries with bounds checking
  const cropX = Math.max(0, Math.min(x - size / 2, width - size));
  const cropY = Math.max(0, Math.min(y - size / 2, height - size));
  const cropWidth = Math.min(size, width - cropX);
  const cropHeight = Math.min(size, height - cropY);
  
  // Fill with white background first
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  
  // Draw the cropped image from the source canvas
  try {
    // Direct 1:1 pixel mapping - no scaling
    ctx.drawImage(
      canvas,
      cropX,      // source x
      cropY,      // source y
      cropWidth,  // source width
      cropHeight, // source height
      0,          // destination x
      0,          // destination y
      cropWidth,  // destination width (same as source - no scaling!)
      cropHeight  // destination height (same as source - no scaling!)
    );
    
    console.log(`Crop debug - x: ${x}, y: ${y}, cropX: ${cropX}, cropY: ${cropY}, size: ${cropWidth}x${cropHeight}`);
  } catch (error) {
    console.error("Error drawing cropped image:", error);
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "red";
    ctx.font = "20px Arial";
    ctx.fillText("Error rendering", 10, 30);
  }
  
  // Re-enable smoothing for the pin dot
  ctx.imageSmoothingEnabled = true;
  
  // Draw the pin dot
  drawPinDot(ctx, size);
  
  // Convert to base64 with maximum quality
  const buffer = out.toBuffer("image/png", {
    compressionLevel: 3,
    filters: canvas.PNG_FILTER_NONE
  });
  console.log(`Generated snapshot: ${buffer.length} bytes`);
  
  return "data:image/png;base64," + buffer.toString("base64");
}

// ------------------------
// API endpoint
app.get("/api/report", async (req, res) => {
  try {
    const { projectId, selectedIds } = req.query;
    
    if (!projectId || !selectedIds) {
      return res.status(400).json({ 
        error: "Missing required parameters: projectId and selectedIds" 
      });
    }

    const ids = selectedIds.split(",").map(id => id.trim());
    console.log(`Generating report for project ${projectId}, pins:`, ids);

    // Fetch pins with relations - INCLUDING plans.file_url for each pin's PDF
    const { data: pins, error: pinsError } = await supabase
      .from("pdf_pins")
      .select(`
        *,
        categories(*),
        Status(*),
        assigned_to(*),
        projects(*),
        pins_photos(*),
        plans(file_url)
      `)
      .eq("project_id", projectId)
      .in("id", ids);
    
    if (pinsError) {
      console.error("Supabase error fetching pins:", pinsError);
      throw pinsError;
    }
    
    if (!pins || pins.length === 0) {
      throw new Error("No pins found for the given criteria");
    }

    console.log(`Found ${pins.length} pins`);

    // Fetch categories and statuses
    const { data: categories, error: catError } = await supabase
      .from("categories")
      .select("*");
    if (catError) {
      console.error("Supabase error fetching categories:", catError);
      throw catError;
    }

    const { data: statuses, error: statusError } = await supabase
      .from("Status")
      .select("*");
    if (statusError) {
      console.error("Supabase error fetching statuses:", statusError);
      throw statusError;
    }

    // Fetch project
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single();
    if (projectError) {
      console.error("Supabase error fetching project:", projectError);
      throw projectError;
    }

    // Group pins by PDF URL and render each PDF once
    // This caches PDFs so if multiple pins share the same PDF, we only download/render once
    const pdfCache = new Map();
    
    console.log("Processing PDFs and creating snapshots...");
    
    // Process each pin - get PDF from plans.file_url
    const preparedPins = await Promise.all(
      pins.map(async (pin, index) => {
        // GET PDF PATH from plans.file_url for this specific pin
        const filePath = pin.plans?.file_url;
        
        if (!filePath) {
          console.warn(`Pin ${pin.id} has no PDF path (plans.file_url is missing), skipping snapshot`);
          return { ...pin, snapshot: null };
        }

        // Get the public URL from Supabase Storage
        const pdfUrl = supabase.storage
          .from('project-plans')
          .getPublicUrl(filePath)
          .data.publicUrl;

        console.log(`Pin ${pin.id} PDF URL: ${pdfUrl}`);

        // Check if we've already rendered this PDF (in case multiple pins use same PDF)
        let pdfImg = pdfCache.get(pdfUrl);
        
        if (!pdfImg) {
          console.log(`Downloading and rendering new PDF for pin ${pin.id}`);
          
          try {
            // Download the PDF from Supabase Storage
            const pdfResponse = await axios.get(pdfUrl, { 
              responseType: "arraybuffer",
              timeout: 30000,
              maxContentLength: 50 * 1024 * 1024
            });
            const pdfBuffer = Buffer.from(pdfResponse.data);
            console.log(`PDF downloaded for pin ${pin.id}: ${pdfBuffer.length} bytes`);
            
            // Render the first page to canvas
            pdfImg = await renderPdfPage(pdfBuffer);
            console.log(`PDF rendered for pin ${pin.id}: ${pdfImg.width}x${pdfImg.height}`);
            
            // Cache the rendered PDF for reuse
            pdfCache.set(pdfUrl, pdfImg);
          } catch (error) {
            console.error(`Failed to process PDF for pin ${pin.id} from ${pdfUrl}:`, error.message);
            return { ...pin, snapshot: null };
          }
        } else {
          console.log(`Using cached PDF for pin ${pin.id}`);
        }

        console.log(`Creating snapshot ${index + 1}/${pins.length} for pin ${pin.id}`);
        
        // Check if coordinates exist (using x and y, not x_norm and y_norm)
        if (pin.x === undefined || pin.y === undefined) {
          console.warn(`Pin ${pin.id} missing coordinates - x: ${pin.x}, y: ${pin.y}`);
          console.log(`Available pin fields:`, Object.keys(pin));
          return { ...pin, snapshot: null };
        }
        
        try {
          // Create snapshot from the pin's specific PDF using x and y coordinates
          // Using 800px size for better quality
          const snapshot = await cropZoom(pdfImg, pin.x, pin.y, 800);
          return { ...pin, snapshot };
        } catch (error) {
          console.error(`Failed to create snapshot for pin ${pin.id}:`, error.message);
          return { ...pin, snapshot: null };
        }
      })
    );

    console.log("Generating PDF report...");
    
    // Debug: Log snapshot info
    console.log("Prepared pins snapshot info:");
    preparedPins.forEach(pin => {
      console.log(`Pin ${pin.id}: snapshot exists: ${!!pin.snapshot}, length: ${pin.snapshot?.length || 0}`);
    });
    
    // Load the PDF component
    const PdfComponent = await loadPdfReportComponent();
    
    const pdfStream = await renderToStream(
      React.createElement(PdfComponent, {
        selectedPins: preparedPins,
        categories: categories || [],
        statuses: statuses || [],
        selectedProject: project
      })
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${projectId}.pdf"`);
    
    pdfStream.pipe(res);
    
    pdfStream.on("end", () => {
      console.log("PDF generation completed successfully");
    });
    
    pdfStream.on("error", (err) => {
      console.error("PDF stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF generation failed" });
      }
    });

  } catch (err) {
    console.error("PDF GENERATION ERROR:", err);
    console.error("Error stack:", err.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: err.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? err.stack : undefined
      });
    }
  }
});

// ------------------------
// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    pdfjsLoaded: !!pdfjsLib
  });
});

// ------------------------
// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "PDF Report Server",
    endpoints: {
      health: "/health",
      report: "/api/report?projectId=XXX&selectedIds=1,2,3",
      testSnapshot: "/api/test-snapshot?projectId=XXX&pinId=XXX"
    }
  });
});

// ------------------------
// Test endpoint to debug snapshot generation
app.get("/api/test-snapshot", async (req, res) => {
  try {
    const { projectId, pinId } = req.query;
    
    if (!projectId || !pinId) {
      return res.status(400).json({ 
        error: "Missing required parameters: projectId and pinId" 
      });
    }

    // Fetch single pin
    const { data: pin, error } = await supabase
      .from("pdf_pins")
      .select(`*, plans(file_url)`)
      .eq("project_id", projectId)
      .eq("id", pinId)
      .single();
    
    if (error || !pin) {
      return res.status(404).json({ error: "Pin not found" });
    }

    const filePath = pin.plans?.file_url;
    if (!filePath) {
      return res.status(400).json({ error: "No PDF file found for this pin" });
    }

    const pdfUrl = supabase.storage
      .from('project-plans')
      .getPublicUrl(filePath)
      .data.publicUrl;

    console.log(`Test snapshot - Downloading PDF: ${pdfUrl}`);
    const pdfResponse = await axios.get(pdfUrl, { 
      responseType: "arraybuffer",
      timeout: 30000
    });
    const pdfBuffer = Buffer.from(pdfResponse.data);
    
    console.log(`Test snapshot - Rendering PDF page...`);
    const pdfImg = await renderPdfPage(pdfBuffer);
    
    console.log(`Test snapshot - Creating snapshot at (${pin.x}, ${pin.y})`);
    
    // Debug: log all pin fields
    console.log("Pin data:", JSON.stringify(pin, null, 2));
    
    if (pin.x === undefined || pin.y === undefined) {
      return res.status(400).json({ 
        error: "Pin missing x or y coordinates",
        availableFields: Object.keys(pin),
        pinData: pin
      });
    }
    
    const snapshot = await cropZoom(pdfImg, pin.x, pin.y, 800);
    
    // Return the base64 image as HTML for easy viewing
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Snapshot Test</title></head>
        <body style="background: #f0f0f0; padding: 20px;">
          <h1>Snapshot Test for Pin ${pinId}</h1>
          <p>Position: (${pin.x}, ${pin.y})</p>
          <p>PDF Size: ${pdfImg.width}x${pdfImg.height}</p>
          <img src="${snapshot}" style="border: 2px solid #000; max-width: 100%;" />
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Test snapshot error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------
// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PDF report server running on port ${PORT}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Report endpoint: http://localhost:${PORT}/api/report`);
});

// ------------------------
// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});