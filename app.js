// app.js
// ------------------------
import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";
import React from "react";
import { renderToStream } from "@react-pdf/renderer";
import path from "path";
import { fileURLToPath } from "url";
import { Expo } from "expo-server-sdk";
import { execSync } from "child_process";
import multer from "multer";
import fs from "fs-extra";
import crypto from "crypto";
import os from "os";
import jwt from 'jsonwebtoken'

import { promisify } from "util";
import { exec as execCallback } from "child_process";

import uploadRoutes from "./routes/upload.js";
import tilesRoutes from "./routes/tiles.js";
import updatePlanRouter from "./routes/update-plan.js";
import { worker, pdfProcessingQueue } from "./queues/pdfProcessingQueue.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(execCallback);

console.log("QPDF VERSION:", execSync("qpdf --version").toString());

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

// ========================================================================================
// EXPO PUSH NOTIFICATIONS
// ========================================================================================
const expo = new Expo();

async function sendExpoNotifications(pushTokens, title, body, data = {}) {
  const validTokens = pushTokens.filter((token) => {
    if (!Expo.isExpoPushToken(token)) {
      console.warn(`⚠️  Invalid Expo push token, skipping: ${token}`);
      return false;
    }
    return true;
  });

  if (validTokens.length === 0) {
    return { successCount: 0, failureCount: 0, deadTokens: [] };
  }

  const messages = validTokens.map((token) => ({
    to: token, sound: "default", title, body, data,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error("Expo push chunk error:", err);
    }
  }

  let successCount = 0, failureCount = 0;
  const deadTokens = [];

  tickets.forEach((ticket, i) => {
    if (ticket.status === "ok") successCount++;
    else {
      failureCount++;
      console.error(`Expo push error for token ${validTokens[i]}:`, ticket.message, ticket.details);
      if (ticket.details?.error === "DeviceNotRegistered") deadTokens.push(validTokens[i]);
    }
  });

  if (deadTokens.length > 0) {
    console.log(`🗑  Removing ${deadTokens.length} dead token(s) from DB`);
    await supabase.from("user_fcm_tokens").delete().in("fcm_token", deadTokens);
  }

  return { successCount, failureCount, deadTokens };
}

// ========================================================================================
// PDF component loaders
let PdfReportServer = null;
let MediaComponent = null;

async function loadMediaReportComponent() {
  if (!MediaComponent) {
    const module = await import("./src/pdf/MediaReportServer.jsx");
    MediaComponent = module.default;
  }
  return MediaComponent;
}

async function loadPdfReportComponent() {
  if (!PdfReportServer) {
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
// Supabase client (service role — bypasses RLS for backend operations)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    req.token = token;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireProjectMember(paramPath) {
  return async function (req, res, next) {
    const projectId = paramPath.split('.').reduce((o, k) => o?.[k], req);
    if (!projectId) {
      return res.status(400).json({ error: `Missing projectId (expected at ${paramPath})` });
    }
    const { createClient } = await import('@supabase/supabase-js');
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${req.token}` } } }
    );
    const { data } = await userClient.from('projects').select('id').eq('id', projectId).maybeSingle();
    if (!data) return res.status(403).json({ error: 'Access denied: not a member of this project' });
    next();
  };
}

function requireSelf(paramPath) {
  return function (req, res, next) {
    const targetUserId = paramPath.split('.').reduce((o, k) => o?.[k], req);
    if (!targetUserId) return res.status(400).json({ error: `Missing userId (expected at ${paramPath})` });
    if (req.user.id !== targetUserId) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

// ------------------------
// PDF.js setup
const pdfjsLib = await (async () => {
  try {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    return require("pdfjs-dist/legacy/build/pdf.js");
  } catch (e) {
    console.error("Failed to load pdfjs-dist legacy build:", e.message);
    throw new Error("Please install pdfjs-dist: npm install pdfjs-dist@3.11.174");
  }
})();

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
// Routes
app.use("/api/upload-pdf", uploadRoutes);
app.use("/api/tiles", tilesRoutes);
app.use('/api/update-plan', updatePlanRouter);
app.use('/fonts', (req, res, next) => {
  if (req.path.endsWith('.woff'))  res.setHeader('Content-Type', 'font/woff');
  if (req.path.endsWith('.woff2')) res.setHeader('Content-Type', 'font/woff2');
  if (req.path.endsWith('.ttf'))   res.setHeader('Content-Type', 'font/ttf');
  next();
}, express.static(path.join(__dirname, 'fonts')));

app.get('/api/test-font', (req, res) => {
  const p = path.join(__dirname, 'fonts', 'Lato-Regular.ttf');
  res.json({ path: p, exists: fs.existsSync(p) });
});
console.log("🔄 PDF Processing Worker started");

// Bull Board
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");
createBullBoard({
  queues: [new BullMQAdapter(pdfProcessingQueue)],
  serverAdapter,
});
app.use("/admin/queues", serverAdapter.getRouter());

// ========================================================================================
// PDF RENDERING UTILITIES
// ========================================================================================

class SafeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }
  reset() { return; }
  destroy() { return; }
}

async function renderPdfPage(pdfBuffer, scale = 2.5) {
  let loadingTask = null, pdf = null, page = null;
  try {
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: false, disableFontFace: true, verbosity: 0,
    });
    pdf = await loadingTask.promise;
    page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale });
    const canvasFactory = new SafeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, viewport.width, viewport.height);
    const renderTask = page.render({
      canvasContext: context, viewport, canvasFactory,
      intent: "display", annotationMode: 0, renderInteractiveForms: false,
    });
    await renderTask.promise;
    const result = { canvas, width: viewport.width, height: viewport.height };
    setTimeout(async () => {
      try {
        if (page) page.cleanup().catch(() => {});
        if (pdf) { pdf.cleanup().catch(() => {}); pdf.destroy().catch(() => {}); }
        if (loadingTask) loadingTask.destroy().catch(() => {});
      } catch (e) { /* ignore */ }
    }, 100);
    return result;
  } catch (error) {
    throw error;
  }
}

async function renderPdfPageRobust(pdfBuffer, scale = 2.5) {
  const tmpDir = path.join(os.tmpdir(), `pdf-render-${crypto.randomUUID()}`);
  try {
    await fs.ensureDir(tmpDir);
    const pdfPath = path.join(tmpDir, "input.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);
    const dpi = Math.floor(72 * scale);
    const outputPath = path.join(tmpDir, "output.png");
    const gsCommand = process.platform === "win32" ? "gswin64c" : "gs";
    const cmd = `${gsCommand} -dSAFER -dBATCH -dNOPAUSE -dQUIET \
      -sDEVICE=png16m -r${dpi} -dFirstPage=1 -dLastPage=1 \
      -dTextAlphaBits=4 -dGraphicsAlphaBits=4 \
      -sOutputFile="${outputPath}" "${pdfPath}"`;
    await execAsync(cmd);
    const pngBuffer = await fs.readFile(outputPath);
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const canvas = createCanvas(info.width, info.height);
    const ctx = canvas.getContext("2d");
    const imageData = ctx.createImageData(info.width, info.height);
    for (let i = 0; i < data.length; i++) imageData.data[i] = data[i];
    ctx.putImageData(imageData, 0, 0);
    await fs.remove(tmpDir);
    return { canvas, width: info.width, height: info.height };
  } catch (error) {
    await fs.remove(tmpDir).catch(() => {});
    throw new Error(`PDF rendering failed: ${error.message}`);
  }
}

function drawPinDot(ctx, size) {
  const center = size / 2;
  const radius = size * 0.03;
  ctx.fillStyle = "white";
  ctx.strokeStyle = "white";
  ctx.lineWidth = radius * 0.4;
  ctx.beginPath();
  ctx.arc(center, center, radius + ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
}

async function cropZoom(pdfImg, xNorm, yNorm, size = 800) {
  const { canvas, width, height } = pdfImg;
  const x = Math.floor(xNorm * width);
  const y = Math.floor(yNorm * height);
  const out = createCanvas(size, size);
  const ctx = out.getContext("2d", { alpha: false, antialias: "subpixel" });
  ctx.imageSmoothingEnabled = false;
  const cropX = Math.max(0, Math.min(x - size / 2, width - size));
  const cropY = Math.max(0, Math.min(y - size / 2, height - size));
  const cropWidth = Math.min(size, width - cropX);
  const cropHeight = Math.min(size, height - cropY);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  try {
    ctx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  } catch (error) {
    console.error("Error drawing cropped image:", error);
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "red";
    ctx.font = "20px Arial";
    ctx.fillText("Error rendering", 10, 30);
  }
  ctx.imageSmoothingEnabled = true;
  drawPinDot(ctx, size);
  const buffer = out.toBuffer("image/png", { compressionLevel: 3, filters: canvas.PNG_FILTER_NONE });
  return "data:image/png;base64," + buffer.toString("base64");
}

async function cropZoomRobust(pdfImg, xNorm, yNorm, size = 800) {
  const { canvas, width, height } = pdfImg;
  const x = Math.floor(xNorm * width);
  const y = Math.floor(yNorm * height);
  const out = createCanvas(size, size);
  const ctx = out.getContext("2d");
  const cropX = Math.max(0, Math.min(x - size / 2, width - size));
  const cropY = Math.max(0, Math.min(y - size / 2, height - size));
  const cropWidth = Math.min(size, width - cropX);
  const cropHeight = Math.min(size, height - cropY);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  } catch (error) {
    console.error("Error drawing cropped image:", error);
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "red";
    ctx.font = "20px Arial";
    ctx.fillText("Rendering Error", 10, 30);
  }
  ctx.imageSmoothingEnabled = true;
  drawPinDot(ctx, size);
  const buffer = out.toBuffer("image/png", { compressionLevel: 3, filters: canvas.PNG_FILTER_NONE });
  return "data:image/png;base64," + buffer.toString("base64");
}

async function renderFullPlanSnapshot(pdfImg, pins) {
  const { canvas, width, height } = pdfImg;

  const out = createCanvas(width, height);
  const ctx = out.getContext("2d");

  // Draw the full plan at native resolution
  ctx.drawImage(canvas, 0, 0);

  const PIN_RADIUS = Math.max(18, width * 0.018);   // bigger pins
  const FONT_SIZE  = Math.max(14, PIN_RADIUS * 0.95); // bigger text relative to pin
  const BORDER     = Math.max(3,  PIN_RADIUS * 0.3);

  // ── Pass 1: draw white rings (with shadow) ──────────────────────────────
  pins.forEach((pin) => {
    if (pin.x === undefined || pin.y === undefined) return;
    const cx = pin.x * width;
    const cy = pin.y * height;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur  = PIN_RADIUS * 0.8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    ctx.arc(cx, cy, PIN_RADIUS + BORDER, 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.restore();
  });

  // ── Pass 2: red dot + number, with NO shadow whatsoever ────────────────
  pins.forEach((pin) => {
    if (pin.x === undefined || pin.y === undefined) return;
    const cx = pin.x * width;
    const cy = pin.y * height;

    // Robust label: fall back to original index if _reportIndex is missing
    const reportIdx = typeof pin._reportIndex === 'number' ? pin._reportIndex : 0;
    const label = String(reportIdx + 1);

    ctx.save();
    // Explicitly disable any inherited shadow state
    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Red disc
    ctx.beginPath();
    ctx.arc(cx, cy, PIN_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "#E53E3E";
    ctx.fill();

    // Number — try multiple font fallbacks
    ctx.font = `bold ${FONT_SIZE}px Helvetica, Arial, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = "#FFFFFF";
    ctx.fillText(label, cx, cy);
    ctx.restore();
  });

  const buffer = out.toBuffer("image/png", { compressionLevel: 3 });
  return "data:image/png;base64," + buffer.toString("base64");
}
// ========================================================================================
// REPORT ENDPOINT — uploads PDF to Storage, returns signed URL
// ========================================================================================

app.post("/api/report",
  requireAuth,
  requireProjectMember('body.projectId'),
  async (req, res) => {
    console.log("POST /api/report");
    const startTime = Date.now();

    try {
      const {
        projectId, selectedIds, fields, displayMode, templateConfig,
        reportTitle, participants, planningImages, planningObservations, customSections,
      } = req.body;

      if (!projectId || !selectedIds) {
        return res.status(400).json({ error: "Missing required parameters: projectId and selectedIds" });
      }

      const ids = selectedIds;
      console.log(`\n${"=".repeat(80)}`);
      console.log(`📊 REPORT GENERATION STARTED — Project: ${projectId}, Pins: ${ids.length}`);
      console.log(`${"=".repeat(80)}\n`);
      console.log("⏳ Step 1/5: Fetching data from database...");

      const [pinsResult, categoriesResult, statusesResult, projectResult] = await Promise.all([
        supabase
          .from("pdf_pins")
          .select(`*, categories(*), Status(*), assigned_to(*), created_by(*), projects(*), pins_photos(*), plans(file_url), comments(*, username, created_at)`)
          .eq("project_id", projectId)
          .in("id", ids),
        supabase.from("categories").select("*"),
        supabase.from("Status").select("*"),
        supabase.from("projects").select("*,organizations(*)").eq("id", projectId).single(),
      ]);

      if (pinsResult.error) throw pinsResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (statusesResult.error) throw statusesResult.error;
      if (projectResult.error) throw projectResult.error;

      const pins = pinsResult.data;
      const categories = categoriesResult.data;
      const statuses = statusesResult.data;
      const project = projectResult.data;

      if (!pins || pins.length === 0) throw new Error("No pins found for the given criteria");

      console.log(`✅ Data fetched: ${pins.length} pins\n`);
      console.log("⏳ Step 2/5: Processing PDFs...");

      const pdfCache = new Map();
      const pinsByPdf = new Map();

      for (const pin of pins) {
        const filePath = pin.plans?.file_url;
        if (!filePath) continue;
        const pdfUrl = supabase.storage.from("project-plans").getPublicUrl(filePath).data.publicUrl;
        if (!pinsByPdf.has(pdfUrl)) pinsByPdf.set(pdfUrl, []);
        pinsByPdf.get(pdfUrl).push(pin);
      }

      const BATCH_SIZE = 3;
      const pdfUrls = Array.from(pinsByPdf.keys());

      for (let i = 0; i < pdfUrls.length; i += BATCH_SIZE) {
        const batch = pdfUrls.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async (pdfUrl) => {
            try {
              const pdfResponse = await axios.get(pdfUrl, { responseType: "arraybuffer", timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
              const pdfBuffer = Buffer.from(pdfResponse.data);
              const pdfImg = await renderPdfPageRobust(pdfBuffer, 2.5);
              pdfCache.set(pdfUrl, pdfImg);
            } catch (error) {
              console.error(`   ❌ Failed to process PDF ${pdfUrl}:`, error.message);
              pdfCache.set(pdfUrl, null);
            }
          })
        );
      }

      console.log(`✅ PDFs processed: ${pdfCache.size} cached\n`);
      console.log("⏳ Step 3/5: Creating snapshots...");

      const preparedPins = await Promise.all(
        pins.map(async (pin) => {
          const filePath = pin.plans?.file_url;
          if (!filePath) return { ...pin, snapshot: null };
          const pdfUrl = supabase.storage.from("project-plans").getPublicUrl(filePath).data.publicUrl;
          const pdfImg = pdfCache.get(pdfUrl);
          if (!pdfImg || pin.x === undefined || pin.y === undefined) return { ...pin, snapshot: null };
          try {
            const snapshot = await cropZoomRobust(pdfImg, pin.x, pin.y, 800);
            return { ...pin, snapshot };
          } catch (error) {
            console.error(`   ❌ Pin ${pin.id}: Snapshot failed -`, error.message);
            return { ...pin, snapshot: null };
          }
        })
      );

      console.log(`✅ Snapshots: ${preparedPins.filter((p) => p.snapshot).length}/${pins.length}\n`);
      console.log("⏳ Step 3b/5: Building full-plan overview snapshots...");

      const pinsByPdfUrl = new Map();
      for (let i = 0; i < preparedPins.length; i++) {
        const pin = preparedPins[i];
        const filePath = pin.plans?.file_url;
        if (!filePath) continue;
        const pdfUrl = supabase.storage.from("project-plans").getPublicUrl(filePath).data.publicUrl;
        if (!pinsByPdfUrl.has(pdfUrl)) pinsByPdfUrl.set(pdfUrl, []);
        pinsByPdfUrl.get(pdfUrl).push({ ...pin, _reportIndex: i });
      }

      const fullPlanSnapshots = {};
      for (const [pdfUrl, pinsOnPlan] of pinsByPdfUrl.entries()) {
        const pdfImg = pdfCache.get(pdfUrl);
        if (!pdfImg) continue;
        try {
          const fileUrl = pinsOnPlan[0].plans.file_url;
          fullPlanSnapshots[fileUrl] = await renderFullPlanSnapshot(pdfImg, pinsOnPlan);
        } catch (err) {
          console.error(`Full-plan snapshot failed for ${pdfUrl}:`, err.message);
        }
      }

      const planNames = {};
      for (const pin of preparedPins) {
        if (pin.plans?.file_url && pin.pdf_name) {
          planNames[pin.plans.file_url] = pin.pdf_name;
        }
      }

      console.log(`✅ Full-plan snapshots: ${Object.keys(fullPlanSnapshots).length} plan(s)\n`);
      console.log("⏳ Step 4/5: Generating PDF report...");

      const resolvedConfig = templateConfig ? JSON.parse(JSON.stringify(templateConfig)) : {};
      resolvedConfig.header = resolvedConfig.header || {};
      resolvedConfig.header.logoUrl       = project?.organizations?.logo_url || '';
      resolvedConfig.header.clientLogoUrl = project?.client_logo_url         || '';

      const finalConfig = reportTitle
        ? { ...resolvedConfig, reportTitle }
        : resolvedConfig;

      // ── Normalize customSections (accept array or object form) ──
      let customSectionContents = {};
      if (customSections) {
        if (Array.isArray(customSections)) {
          customSections.forEach(s => {
            if (s.id != null) customSectionContents[s.id] = s.content;
          });
        } else if (typeof customSections === 'object') {
          customSectionContents = customSections;
        }
      }

      const templateCustomSections = finalConfig?.customSections || [];
      const enrichedCustomSections = templateCustomSections.map(s => ({
        ...s,
        content: customSectionContents[s.id] ?? customSectionContents[String(s.id)] ?? null,
      }));

      const PdfComponent = await loadPdfReportComponent();
      const pdfStream = await renderToStream(
        React.createElement(PdfComponent, {
          selectedPins:      preparedPins,
          categories:        categories || [],
          statuses:          statuses || [],
          fields:            fields || {},
          displayMode:       displayMode || "list",
          selectedProject:   project,
          config:            finalConfig,
          participants:      participants || [],
          customSections:    enrichedCustomSections,
          fullPlanSnapshots,
          planNames,
          planningImages:    planningImages || [],
          planningObservations: planningObservations || null,
          reportContent: {
            planningImages:        planningImages || [],
            planningObservations:  planningObservations || null,
            customSectionContents,
          },
        })
      );

      // ── Collect stream into a single Buffer ──
      const chunks = [];
      for await (const chunk of pdfStream) {
        chunks.push(chunk);
      }
      const pdfBuffer = Buffer.concat(chunks);
      const pdfSizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(2);
      console.log(`📦 PDF assembled: ${pdfSizeMB} MB`);

      console.log("⏳ Step 5/5: Uploading PDF to Supabase Storage...");

      const timestamp = Date.now();
      const safeProjectName = (project?.name || 'projet').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `Rapport_${safeProjectName}_${timestamp}.pdf`;
      const storagePath = `generated/${projectId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
          cacheControl: '3600',
        });

      if (uploadError) {
        console.error('❌ Upload to storage failed:', uploadError);
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      // ── Generate a 1-hour signed URL ──
      const { data: signedData, error: signedError } = await supabase.storage
        .from('reports')
        .createSignedUrl(storagePath, 3600);

      if (signedError) {
        console.error('❌ Signed URL generation failed:', signedError);
        throw new Error(`Signed URL failed: ${signedError.message}`);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ PDF uploaded and signed in ${duration}s — ${storagePath}\n`);

      res.json({
        success:     true,
        downloadUrl: signedData.signedUrl,
        fileName,
        fileSize:    pdfBuffer.length,
        storagePath,
      });
    } catch (err) {
      console.error("❌ REPORT GENERATION FAILED:", err.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: err.message || "Internal server error",
          details: process.env.NODE_ENV === "development" ? err.stack : undefined,
        });
      }
    }
  });

// ========================================================================================
// MEDIA REPORT ENDPOINT (also upgraded to upload + signed URL)
// ========================================================================================

app.get("/api/mediareport",
  requireAuth,
  requireProjectMember('query.projectId'),
  async (req, res) => {
    try {
      const { projectId, selectedIds } = req.query;
      if (!projectId || !selectedIds) {
        return res.status(400).json({ error: "Missing required parameters: projectId and selectedIds" });
      }

      const ids = selectedIds.split(",").map((id) => id.trim());

      const { data: medias, error: mediasError } = await supabase
        .from("pins_photos")
        .select(`*, projects(*), pdf_pins(*,projects(*),plans(file_url, name))`)
        .eq("project_id", projectId)
        .in("id", ids);

      if (mediasError) throw mediasError;
      if (!medias || medias.length === 0) throw new Error("No medias found for the given criteria");

      const { data: project, error: projectError } = await supabase
        .from("projects").select("*").eq("id", projectId).single();
      if (projectError) throw projectError;

      const pdfCache = new Map();

      const preparedMedias = await Promise.all(
        medias.map(async (media) => {
          const filePath = media.pdf_pins?.plans?.file_url;
          if (!filePath) return { ...media, snapshot: null };
          const pdfUrl = supabase.storage.from("project-plans").getPublicUrl(filePath).data.publicUrl;
          let pdfImg = pdfCache.get(pdfUrl);
          if (!pdfImg) {
            try {
              const pdfResponse = await axios.get(pdfUrl, { responseType: "arraybuffer", timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
              pdfImg = await renderPdfPageRobust(Buffer.from(pdfResponse.data));
              pdfCache.set(pdfUrl, pdfImg);
            } catch (error) {
              console.error(`Failed to process PDF for media ${media.id}:`, error.message);
              return { ...media, snapshot: null };
            }
          }
          if (media.pdf_pins?.x === undefined || media.pdf_pins?.y === undefined) return { ...media, snapshot: null };
          try {
            const snapshot = await cropZoom(pdfImg, media.pdf_pins.x, media.pdf_pins.y, 800);
            return { ...media, snapshot };
          } catch (error) {
            console.error(`Failed to create snapshot for media ${media.id}:`, error.message);
            return { ...media, snapshot: null };
          }
        })
      );

      const MediaReportComponent = await loadMediaReportComponent();
      const pdfStream = await renderToStream(
        React.createElement(MediaReportComponent, { selectedMedias: preparedMedias, selectedProject: project })
      );

      // Collect to buffer + upload (same pattern as /api/report)
      const chunks = [];
      for await (const chunk of pdfStream) chunks.push(chunk);
      const pdfBuffer = Buffer.concat(chunks);

      const timestamp = Date.now();
      const fileName = `MediaReport_${projectId}_${timestamp}.pdf`;
      const storagePath = `generated/${projectId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(storagePath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      const { data: signedData, error: signedError } = await supabase.storage
        .from('reports')
        .createSignedUrl(storagePath, 3600);
      if (signedError) throw new Error(`Signed URL failed: ${signedError.message}`);

      res.json({
        success: true,
        downloadUrl: signedData.signedUrl,
        fileName,
        fileSize: pdfBuffer.length,
        storagePath,
      });
    } catch (err) {
      console.error("MEDIA REPORT ERROR:", err);
      if (!res.headersSent) {
        res.status(500).json({
          error: err.message || "Internal server error",
          details: process.env.NODE_ENV === "development" ? err.stack : undefined,
        });
      }
    }
  });

// ========================================================================================
// PUSH TOKEN MANAGEMENT (unchanged)
// ========================================================================================

app.post("/api/fcm-tokens", async (req, res) => {
  try {
    const { userId, fcmToken, deviceId, deviceType } = req.body;
    if (!userId || !fcmToken) return res.status(400).json({ error: "Missing required fields" });
    if (!Expo.isExpoPushToken(fcmToken)) return res.status(400).json({ error: `Invalid Expo push token: ${fcmToken}` });
    const { data, error } = await supabase
      .from("user_fcm_tokens")
      .upsert(
        { user_id: userId, fcm_token: fcmToken, device_id: deviceId, device_type: deviceType, updated_at: new Date().toISOString() },
        { onConflict: "user_id,device_id" }
      )
      .select();
    if (error) throw error;
    res.json({ success: true, message: "Push token saved", data });
  } catch (error) {
    console.error("Error saving push token:", error);
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/fcm-tokens/:userId/:deviceId", async (req, res) => {
  try {
    const { userId, deviceId } = req.params;
    const { error } = await supabase.from("user_fcm_tokens").delete().match({ user_id: userId, device_id: deviceId });
    if (error) throw error;
    res.json({ success: true, message: "Push token deleted" });
  } catch (error) {
    console.error("Error deleting push token:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/send-to-user", async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;
    const { data: tokens, error } = await supabase.from("user_fcm_tokens").select("fcm_token").eq("user_id", userId);
    if (error) throw error;
    if (!tokens || tokens.length === 0) return res.status(404).json({ error: "No push tokens found for user" });
    const result = await sendExpoNotifications(tokens.map((t) => t.fcm_token), title, body, data || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/pins/assign", async (req, res) => {
  console.log("Assigning pin...");
  try {
    const { pinId, assignedToUserId, assignedByName } = req.body;
    const { data: tokens, error: tokensError } = await supabase
      .from("user_fcm_tokens").select("fcm_token").eq("user_id", assignedToUserId);
    if (tokensError) throw tokensError;
    if (tokens && tokens.length > 0) {
      const result = await sendExpoNotifications(
        tokens.map((t) => t.fcm_token),
        "Une nouvelle tâche a été assignée !",
        `${assignedByName} vous a assigné une tâche`,
        { type: "pin_assigned", pinId, assignedBy: assignedByName }
      );
      console.log("Notification result:", result);
    }
    res.json({ success: true, message: "Pin assigned and notification sent", pinId });
  } catch (error) {
    console.error("Error assigning pin:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/tasks/assign", async (req, res) => {
  try {
    const { taskId, taskTitle, assignedToUserId, assignedByName } = req.body;
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({ id: taskId, title: taskTitle, assigned_to: assignedToUserId, assigned_by: assignedByName })
      .select().single();
    if (taskError) throw taskError;
    const { data: tokens, error: tokensError } = await supabase
      .from("user_fcm_tokens").select("fcm_token").eq("user_id", assignedToUserId);
    if (tokensError) throw tokensError;
    if (tokens && tokens.length > 0) {
      const result = await sendExpoNotifications(
        tokens.map((t) => t.fcm_token),
        "📋 New Task Assigned!",
        `${assignedByName} assigned you: ${taskTitle}`,
        { type: "task_assigned", taskId, taskTitle, assignedBy: assignedByName }
      );
      console.log(`Task notification: ${result.successCount} sent, ${result.failureCount} failed`);
    }
    res.json({ success: true, message: "Task assigned and notification sent", task });
  } catch (error) {
    console.error("Error assigning task:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/send-bulk", async (req, res) => {
  try {
    const { userIds, title, body, data } = req.body;
    const { data: tokens, error } = await supabase.from("user_fcm_tokens").select("fcm_token").in("user_id", userIds);
    if (error) throw error;
    if (!tokens || tokens.length === 0) return res.status(404).json({ error: "No push tokens found" });
    const result = await sendExpoNotifications(tokens.map((t) => t.fcm_token), title, body, data || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending bulk notification:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/send-to-topic", async (req, res) => {
  try {
    const { topic, title, body, data } = req.body;
    const { data: tokens, error } = await supabase.from("user_fcm_tokens").select("fcm_token").contains("topics", [topic]);
    if (error) throw error;
    if (!tokens || tokens.length === 0) return res.status(404).json({ error: `No subscribers found for topic: ${topic}` });
    const result = await sendExpoNotifications(tokens.map((t) => t.fcm_token), title, body, data || {});
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error sending topic notification:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/notifications/subscribe-to-topic", async (req, res) => {
  try {
    const { userIds, topic } = req.body;
    const { error } = await supabase.rpc("append_topic_to_tokens", { p_user_ids: userIds, p_topic: topic });
    if (error) throw error;
    res.json({ success: true, message: `Subscribed ${userIds.length} user(s) to topic: ${topic}` });
  } catch (error) {
    console.error("Error subscribing to topic:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================================================================
// UTILITY ENDPOINTS
// ========================================================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    pdfjsLoaded: !!pdfjsLib,
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "PDF Report Server",
    endpoints: {
      health: "/health",
      report: "POST /api/report",
      mediaReport: "GET /api/mediareport",
      registerToken: "POST /api/fcm-tokens",
      deleteToken: "DELETE /api/fcm-tokens/:userId/:deviceId",
      sendToUser: "POST /api/notifications/send-to-user",
      sendBulk: "POST /api/notifications/send-bulk",
      sendToTopic: "POST /api/notifications/send-to-topic",
      subscribeToTopic: "POST /api/notifications/subscribe-to-topic",
      assignPin: "POST /api/pins/assign",
      assignTask: "POST /api/tasks/assign",
    },
  });
});

app.get("/api/test-snapshot", async (req, res) => {
  try {
    const { projectId, pinId } = req.query;
    if (!projectId || !pinId) return res.status(400).json({ error: "Missing required parameters: projectId and pinId" });
    const { data: pin, error } = await supabase
      .from("pdf_pins").select(`*, plans(file_url)`).eq("project_id", projectId).eq("id", pinId).single();
    if (error || !pin) return res.status(404).json({ error: "Pin not found" });
    const filePath = pin.plans?.file_url;
    if (!filePath) return res.status(400).json({ error: "No PDF file found for this pin" });
    const pdfUrl = supabase.storage.from("project-plans").getPublicUrl(filePath).data.publicUrl;
    const pdfResponse = await axios.get(pdfUrl, { responseType: "arraybuffer", timeout: 30000 });
    const pdfImg = await renderPdfPageRobust(Buffer.from(pdfResponse.data));
    if (pin.x === undefined || pin.y === undefined) {
      return res.status(400).json({ error: "Pin missing x or y coordinates", availableFields: Object.keys(pin), pinData: pin });
    }
    const snapshot = await cropZoom(pdfImg, pin.x, pin.y, 800);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Snapshot Test</title></head>
        <body style="background:#f0f0f0;padding:20px;">
          <h1>Snapshot Test — Pin ${pinId}</h1>
          <p>Position: (${pin.x}, ${pin.y}) | PDF: ${pdfImg.width}x${pdfImg.height}</p>
          <img src="${snapshot}" style="border:2px solid #000;max-width:100%;" />
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Test snapshot error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const jobCounts = await pdfProcessingQueue.getJobCounts();
    res.json(jobCounts);
  } catch (error) {
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ========================================================================================
// START
// ========================================================================================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PDF report server running on port ${PORT}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

process.on("SIGTERM", () => { console.log("SIGTERM received"); process.exit(0); });
process.on("SIGINT",  () => { console.log("SIGINT received");  process.exit(0); });