// app.js
// ------------------------
import "dotenv/config"; // Load environment variables first
import express from "express";
import cors from "cors";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import path from "path";
import { fileURLToPath } from "url";
import admin from 'firebase-admin';
import { execSync,  execFileSync } from "child_process";
import multer from "multer";
import fs from "fs-extra";
import crypto from "crypto"; 
import { fromBuffer } from "pdf2pic";
import os from "os";


console.log("QPDF VERSION:", execSync("qpdf --version").toString())

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });


admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});


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
let MediaComponent = null;

async function loadMediaReportComponent() {
  if (!MediaComponent) {
    // When running with tsx, we can directly import JSX files
    const module = await import("./src/pdf/MediaReportServer.jsx");
    MediaComponent = module.default;
  }
  return MediaComponent;
}

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
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});
// ------------------------
// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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


/// Fixed SafeCanvasFactory - prevents the napi crash
// Fixed SafeCanvasFactory - prevents the napi crash
class SafeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  
  reset(canvasAndContext, width, height) {
    // Do nothing - avoid modifying canvas
    return;
  }
  
  destroy(canvasAndContext) {
    // ⭐ CRITICAL: Do absolutely nothing
    // Let garbage collection handle everything
    return;
  }
}
// Updated renderPdfPage function with better cleanup
async function renderPdfPage(pdfBuffer, scale = 2.5) {
  let loadingTask = null;
  let pdf = null;
  let page = null;
  
  try {
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });

    pdf = await loadingTask.promise;
    page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale });
    const canvasFactory = new SafeCanvasFactory();
    const { canvas, context } = canvasFactory.create(
      viewport.width,
      viewport.height
    );

    // Fill with white background
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, viewport.width, viewport.height);

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      canvasFactory,
      intent: "display",
      annotationMode: 0,
      renderInteractiveForms: false,
    });

    await renderTask.promise;

    const result = { canvas, width: viewport.width, height: viewport.height };
    
    // Delayed cleanup after 100ms
    setTimeout(async () => {
      try {
        if (page) page.cleanup().catch(() => {});
        if (pdf) {
          pdf.cleanup().catch(() => {});
          pdf.destroy().catch(() => {});
        }
        if (loadingTask) loadingTask.destroy().catch(() => {});
      } catch (e) {
        // Ignore
      }
    }, 100);
    
    return result;
  } catch (error) {
    throw error;
  }
}


async function renderPdfPageForWebp(pdfBuffer, scale = 2.5) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvasFactory = new SafeCanvasFactory();
  const { canvas, context } = canvasFactory.create(
    viewport.width,
    viewport.height
  );

  // Fill with white background
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, viewport.width, viewport.height);

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    canvasFactory,
    intent: "display",
    annotationMode: 0,
    renderInteractiveForms: false,
  });

  await renderTask.promise;

  // Return canvas - NO CLEANUP
  // Objects will be garbage collected automatically
  return { canvas, width: viewport.width, height: viewport.height };
}



async function renderPdfPageToWebp(pdfBuffer, scale = 2.0) {
  try {
    const { canvas } = await renderPdfPageForWebp(pdfBuffer, scale);

    // Convert to WebP buffer
    const webpBuffer = canvas.toBuffer("image/webp", {
      quality: 92,
      alphaQuality: 100,
      lossless: false,
    });

    return webpBuffer;
  } catch (error) {
    console.error("Error in renderPdfPageToWebp:", error.message);
    throw error;
  }
}

function sanitizeFilename(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 200);
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





app.post("/api/upload-pdf", upload.single("file"), async (req, res) => {
  let tmpDir;

  try {
    const { projectId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded" });
    if (!projectId) return res.status(400).json({ error: "Missing projectId" });

    // Use OS-appropriate temp directory
    const osTmpDir = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
    tmpDir = path.join(osTmpDir, crypto.randomUUID());
    await fs.ensureDir(tmpDir);

    const inputPdf = path.join(tmpDir, "input.pdf");
    const linearizedPdf = path.join(tmpDir, "linearized.pdf");
    const pagesDir = path.join(tmpDir, "pages");

    await fs.ensureDir(pagesDir);
    await fs.writeFile(inputPdf, file.buffer);

    // 1️⃣ Linearize PDF
    execSync(`qpdf "${inputPdf}" --linearize "${linearizedPdf}"`);

    // 2️⃣ Get page count
    const pageCount = Number(
      execSync(`qpdf --show-npages "${linearizedPdf}"`).toString().trim()
    );

    const originalBase = file.originalname.replace(/\.pdf$/i, "");
    const safeBase = sanitizeFilename(originalBase);

    console.log("📄 Original filename:", originalBase);
    console.log("✨ Sanitized base:", safeBase);
    console.log("📊 Total pages:", pageCount);
    console.log("🖥️  Platform:", process.platform);

    const uploaded = [];
    const errors = [];

    for (let i = 1; i <= pageCount; i++) {
      const name = `${safeBase}-page${i}`;
      const pagePdf = path.join(pagesDir, `${name}.pdf`);

      try {
        console.log(`\n📄 Processing page ${i}/${pageCount}...`);

        // Split page
        execSync(
          `qpdf "${linearizedPdf}" --pages "${linearizedPdf}" ${i} -- "${pagePdf}"`
        );

        const pdfBuffer = await fs.readFile(pagePdf);
        console.log(`  ✓ Split PDF (${pdfBuffer.length} bytes)`);

        // Upload PDF to storage
        const pdfPath = `${projectId}/${name}.pdf`;
        const { data: pdfData, error: pdfErr } = await supabase.storage
          .from("project-plans")
          .upload(pdfPath, pdfBuffer, {
            contentType: "application/pdf",
            upsert: true,
          });

        if (pdfErr) {
          console.error(`  ❌ PDF upload error:`, pdfErr);
          throw new Error(`PDF upload failed: ${pdfErr.message}`);
        }
        console.log(`  ✓ Uploaded PDF to storage`);

        // Generate WebP using Ghostscript (works everywhere)
        console.log(`  🖼️  Generating WebP...`);
        
        const tempPng = path.join(pagesDir, `${name}-%d.png`);
        const outputPng = path.join(pagesDir, `${name}-1.png`);
        
        // Use Ghostscript (cross-platform, bundled with most PDF tools)
        const gsCommand = process.platform === 'win32' ? 'gswin64c' : 'gs';
        
        try {
          execSync(
            `${gsCommand} -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${tempPng}" "${pagePdf}"`,
            { stdio: 'pipe' }
          );
          
          console.log(`  ✓ PNG generated via Ghostscript`);
        } catch (gsError) {
          // Fallback: try 'gs' command on Windows too (some installations use 'gs')
          console.log(`  ⚠️  Trying alternate Ghostscript command...`);
          execSync(
            `gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${tempPng}" "${pagePdf}"`,
            { stdio: 'pipe' }
          );
          console.log(`  ✓ PNG generated via Ghostscript (alternate)`);
        }
        
        // Convert PNG to WebP using Sharp
        const sharp = (await import('sharp')).default;
        const webpBuffer = await sharp(outputPng)
          .webp({ 
            quality: 95,      // ⭐ Qualité augmentée (85 → 95)
            effort: 6,        // ⭐ Plus d'effort de compression (4 → 6, max = 6)
            lossless: false,  // true = qualité maximale mais fichiers très lourds
            nearLossless: true, // ⭐ Quasi sans perte (meilleur compromis)
            smartSubsample: false, // ⭐ Désactiver pour meilleure qualité
          })
          .toBuffer();
        
        console.log(`  ✓ WebP generated (${webpBuffer.length} bytes)`);
        
        // Clean up temp PNG
        await fs.unlink(outputPng).catch(() => {});

        // Upload WebP to storage
        const webpStorage = `${projectId}/${name}.webp`;
        const { data: webpData, error: webpErr } = await supabase.storage
          .from("project-plans")
          .upload(webpStorage, webpBuffer, {
            contentType: "image/webp",
            upsert: true,
          });

        if (webpErr) {
          console.error(`  ❌ WebP upload error:`, webpErr);
          throw new Error(`WebP upload failed: ${webpErr.message}`);
        }
        console.log(`  ✓ Uploaded WebP to storage`);

        // Save to database
        const { error: dbErr } = await supabase.from("plans").insert({
          project_id: projectId,
          name: `${originalBase}-page${i}`,
          file_url: pdfPath,
          webp_url: webpStorage,
        });

        if (dbErr) throw new Error(`Database insert failed: ${dbErr.message}`);
        console.log(`  ✓ Saved to database`);

        uploaded.push(i);
        console.log(`✅ Page ${i}/${pageCount} completed successfully`);

      } catch (err) {
        console.error(`❌ Page ${i} failed:`, err.message);
        console.error(`   Stack:`, err.stack);
        errors.push({ page: i, error: err.message });
      }
    }

    // Cleanup temp directory
    await fs.remove(tmpDir);
    console.log("\n🧹 Cleaned up temporary files");

    if (!uploaded.length) {
      return res.status(500).json({ 
        error: "All pages failed to process", 
        errors 
      });
    }

    res.json({
      success: true,
      pageCount,
      uploaded: uploaded.length,
      failed: errors.length,
      errors: errors.length ? errors : undefined,
    });

    console.log(`\n✨ Upload complete: ${uploaded.length}/${pageCount} pages successful`);

  } catch (err) {
    console.error("\n💥 UPLOAD ERROR:", err);
    console.error("Stack:", err.stack);
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

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
        created_by(*),
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
      .select("*,organizations(*)")
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
    console.log("selectedProject", project);
    
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
// API endpoint
app.get("/api/mediareport", async (req, res) => {
  try {
    const { projectId, selectedIds } = req.query;
    
    if (!projectId || !selectedIds) {
      return res.status(400).json({ 
        error: "Missing required parameters: projectId and selectedIds" 
      });
    }

    const ids = selectedIds.split(",").map(id => id.trim());
    console.log(`Generating report for project ${projectId}, medias:`, ids);

    // Fetch pins with relations - INCLUDING plans.file_url for each pin's PDF
    const { data: medias, error: mediasError } = await supabase
      .from("pins_photos")
      .select(`
        *,
        
        projects(*),
        pdf_pins(*,projects(*),plans(file_url, name))
        
      `)
      .eq("project_id", projectId)
      .in("id", ids);
    
    if (mediasError) {
      console.error("Supabase error fetching medias:", mediasError);
      throw mediasError;
    }
    
    if (!medias || medias.length === 0) {
      throw new Error("No medias found for the given criteria");
    }

    console.log(`Found ${medias.length} medias`);

   

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
    const preparedMedias = await Promise.all(
      medias.map(async (media, index) => {
        // GET PDF PATH from plans.file_url for this specific pin
        const filePath = media.pdf_pins?.plans?.file_url;
        
        if (!filePath) {
          console.warn(`Media ${media.id} has no PDF path (plans.file_url is missing), skipping snapshot`);
          return { ...media, snapshot: null };
        }

        // Get the public URL from Supabase Storage
        const pdfUrl = supabase.storage
          .from('project-plans')
          .getPublicUrl(filePath)
          .data.publicUrl;

        console.log(`Media ${media.id} PDF URL: ${pdfUrl}`);

        // Check if we've already rendered this PDF (in case multiple pins use same PDF)
        let pdfImg = pdfCache.get(pdfUrl);
        
        if (!pdfImg) {
          console.log(`Downloading and rendering new PDF for media ${media.id}`);
          
          try {
            // Download the PDF from Supabase Storage
            const pdfResponse = await axios.get(pdfUrl, { 
              responseType: "arraybuffer",
              timeout: 30000,
              maxContentLength: 50 * 1024 * 1024
            });
            const pdfBuffer = Buffer.from(pdfResponse.data);
            console.log(`PDF downloaded for pin ${media.id}: ${pdfBuffer.length} bytes`);
            
            // Render the first page to canvas
            pdfImg = await renderPdfPage(pdfBuffer);
            console.log(`PDF rendered for pin ${media.id}: ${pdfImg.width}x${pdfImg.height}`);
            
            // Cache the rendered PDF for reuse
            pdfCache.set(pdfUrl, pdfImg);
          } catch (error) {
            console.error(`Failed to process PDF for media ${media.id} from ${pdfUrl}:`, error.message);
            return { ...media, snapshot: null };
          }
        } else {
          console.log(`Using cached PDF for media ${media.id}`);
        }

        console.log(`Creating snapshot ${index + 1}/${medias.length} for media ${media.id}`);
        
        // Check if coordinates exist (using x and y, not x_norm and y_norm)
        if (media.pdf_pins?.x === undefined || media.pdf_pins?.y === undefined) {
          console.warn(`Media ${media.id} missing coordinates - x: ${media.pdf_pins?.x}, y: ${media.pdf_pins?.y}`);
          console.log(`Available media fields:`, Object.keys(media));
          return { ...media, snapshot: null };
        }
        
        try {
          // Create snapshot from the pin's specific PDF using x and y coordinates
          // Using 800px size for better quality
          const snapshot = await cropZoom(pdfImg, media.pdf_pins?.x, media.pdf_pins?.y, 800);
          return { ...media, snapshot };
        } catch (error) {
          console.error(`Failed to create snapshot for media ${media.id}:`, error.message);
          return { ...media, snapshot: null };
        }
      })
    );

    console.log("Generating PDF report...");
    
    // Debug: Log snapshot info
    console.log("Prepared medias snapshot info:");
    preparedMedias.forEach(media => {
      console.log(`Media ${media.id}: snapshot exists: ${!!media.snapshot}, length: ${media.snapshot?.length || 0}`);
    });
    
    // Load the PDF component
    const MediaComponent = await loadMediaReportComponent();
    
    const pdfStream = await renderToStream(
      React.createElement(MediaComponent, {
        selectedMedias: preparedMedias,
       
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



app.post('/api/fcm-tokens', async (req, res) => {
  try {
    const { userId, fcmToken, deviceId, deviceType } = req.body;

    // Validate input
    if (!userId || !fcmToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save to Supabase
    const { data, error } = await supabase
      .from('user_fcm_tokens')
      .upsert(
        {
          user_id: userId,
          fcm_token: fcmToken,
          device_id: deviceId,
          device_type: deviceType,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,device_id',
        }
      )
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: 'FCM token saved',
      data,
    });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete FCM token (on logout)
app.delete('/api/fcm-tokens/:userId/:deviceId', async (req, res) => {
  try {
    const { userId, deviceId } = req.params;

    const { error } = await supabase
      .from('user_fcm_tokens')
      .delete()
      .match({ user_id: userId, device_id: deviceId });

    if (error) throw error;

    res.json({
      success: true,
      message: 'FCM token deleted',
    });
  } catch (error) {
    console.error('Error deleting FCM token:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== NOTIFICATION SENDING ENDPOINTS =====

// Send notification to specific user (all their devices)
app.post('/api/notifications/send-to-user', async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;

    // Get all FCM tokens for this user
    const { data: tokens, error } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token')
      .eq('user_id', userId);

    if (error) throw error;

    if (!tokens || tokens.length === 0) {
      return res.status(404).json({ error: 'No FCM tokens found for user' });
    }

    // Prepare notification payload
    const message = {
      notification: {
        title,
        body,
      },
      data: data || {},
      tokens: tokens.map(t => t.fcm_token),
    };

    // Send to all user's devices
    const response = await admin.messaging().sendEachForMulticast(message);

    // Handle failed tokens (invalid/expired)
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx].fcm_token);
        }
      });

      // Remove failed tokens from database
      if (failedTokens.length > 0) {
        await supabase
          .from('user_fcm_tokens')
          .delete()
          .in('fcm_token', failedTokens);
      }
    }

    res.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign task and notify
app.post('/api/tasks/assign', async (req, res) => {
  try {
    const { taskId, taskTitle, assignedToUserId, assignedByName } = req.body;

    // 1. Save task to database
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert({
        id: taskId,
        title: taskTitle,
        assigned_to: assignedToUserId,
        assigned_by: assignedByName,
      })
      .select()
      .single();

    if (taskError) throw taskError;

    // 2. Get user's FCM tokens
    const { data: tokens, error: tokensError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token')
      .eq('user_id', assignedToUserId);

    if (tokensError) throw tokensError;

    if (tokens && tokens.length > 0) {
      // 3. Send notification
      const message = {
        notification: {
          title: '📋 New Task Assigned!',
          body: `${assignedByName} assigned you: ${taskTitle}`,
        },
        data: {
          type: 'task_assigned',
          taskId,
          taskTitle,
          assignedBy: assignedByName,
        },
        tokens: tokens.map(t => t.fcm_token),
      };

      const response = await admin.messaging().sendEachForMulticast(message);
      
      console.log(`Notification sent: ${response.successCount} success, ${response.failureCount} failed`);
    }

    res.json({
      success: true,
      message: 'Task assigned and notification sent',
      task,
    });
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ error: error.message });
  }
});

// Assign pin and notify
app.post('/api/pins/assign', async (req, res) => {
  console.log('Assigning pin...');
  try {
    const { pinId, assignedToUserId, assignedByName } = req.body;

    // 1. Save pin to database
  /*  const { data: pin, error: pinError } = await supabase
      .from('pins')
      .insert({
        id: pinId,
        location: pinLocation,
        assigned_to: assignedToUserId,
        assigned_by: assignedByName,
      })
      .select()
      .single();

    if (pinError) throw pinError; */

    // 2. Get user's FCM tokens

    console.log('Assigning pin:', pinId, 'to user:', assignedToUserId);
    const { data: tokens, error: tokensError } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token')
      .eq('user_id', assignedToUserId);

    if (tokensError) throw tokensError;
console.log('Retrieved tokens:', tokens);
console.log('pinId:', pinId, 'assignedByName:', assignedByName);
  if (tokens && tokens.length > 0) {
  const message = {
    notification: {
      title: 'Une nouvelle tâche a été assignée !',
      body: `${assignedByName} vous a assigné une tâche`,
      
    },
    data: {
      type: 'pin_assigned',
      pinId,
      assignedBy: assignedByName,
    },
    tokens: tokens.map(t => t.fcm_token),
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log('Notification response:', response);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`Failed to send notification to token ${tokens[idx].fcm_token}:`, resp.error);
        }
      });
    }

    console.log(`Notification sent: ${response.successCount} success, ${response.failureCount} failed`);
  } catch (err) {
    console.error('FCM send error (exception thrown):', err);
  }
}


    res.json({
      success: true,
      message: 'Pin assigned and notification sent',
      pinId,
    });
  } catch (error) {
    console.error('Error assigning pin:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send notification to multiple users
app.post('/api/notifications/send-bulk', async (req, res) => {
  try {
    const { userIds, title, body, data } = req.body;

    // Get all FCM tokens for these users
    const { data: tokens, error } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token')
      .in('user_id', userIds);

    if (error) throw error;

    if (!tokens || tokens.length === 0) {
      return res.status(404).json({ error: 'No FCM tokens found' });
    }

    const message = {
      notification: { title, body },
      data: data || {},
      tokens: tokens.map(t => t.fcm_token),
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    res.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error('Error sending bulk notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send notification with topic subscription
app.post('/api/notifications/send-to-topic', async (req, res) => {
  try {
    const { topic, title, body, data } = req.body;

    const message = {
      notification: { title, body },
      data: data || {},
      topic,
    };

    const response = await admin.messaging().send(message);

    res.json({
      success: true,
      messageId: response,
    });
  } catch (error) {
    console.error('Error sending topic notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// Subscribe users to topic
app.post('/api/notifications/subscribe-to-topic', async (req, res) => {
  try {
    const { userIds, topic } = req.body;

    // Get FCM tokens
    const { data: tokens, error } = await supabase
      .from('user_fcm_tokens')
      .select('fcm_token')
      .in('user_id', userIds);

    if (error) throw error;

    const fcmTokens = tokens.map(t => t.fcm_token);
    const response = await admin.messaging().subscribeToTopic(fcmTokens, topic);

    res.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error) {
    console.error('Error subscribing to topic:', error);
    res.status(500).json({ error: error.message });
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