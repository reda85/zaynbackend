// backend/services/pdfProcessor.js (ES6 version)
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import pLimit from 'p-limit';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Nom de base des fichiers d'un plan dans le stockage. L'identifiant du plan en
// fait partie : deux plans importés avec le même nom de fichier dans un projet
// n'écrasent plus le PDF, les tuiles et l'aperçu l'un de l'autre. Une révision
// (routes/update-plan.js) garde l'identifiant du plan, donc le même dossier.
export function storageBase(fileName, planId) {
  const base = String(fileName || 'plan').replace(/\.pdf$/i, '').replace(/[^a-z0-9]/gi, '_').slice(0, 80);
  return `${base}_${String(planId).replace(/[^a-z0-9]/gi, '').slice(0, 8)}`;
}

/**
 * Traiter un PDF en tiles avec parallélisation
 */
async function processPdfToTiles({ 
  pdfBuffer, 
  projectId, 
  planId,
  fileName, 
  requestId,
  onProgress 
}) {
  let tmpDir;
  
  try {
    // Créer le dossier temporaire
    const osTmpDir = process.env.TMPDIR || '/tmp';
    tmpDir = path.join(osTmpDir, `zyn-${requestId}`);
    await fs.ensureDir(tmpDir);
    
    const inputPdf = path.join(tmpDir, 'input.pdf');
    const linearizedPdf = path.join(tmpDir, 'linearized.pdf');
    const pagesDir = path.join(tmpDir, 'pages');
    await fs.ensureDir(pagesDir);
    
    await fs.writeFile(inputPdf, pdfBuffer);
    
    // Upload du PDF original vers Supabase
    const safeBase = storageBase(fileName, planId);
    const pdfStoragePath = `${projectId}/${safeBase}.pdf`;
    
    console.log(`[${requestId}] 📤 Uploading PDF to: ${pdfStoragePath}`);
    const { error: pdfUploadError } = await supabase.storage
      .from('project-plans')
      .upload(pdfStoragePath, pdfBuffer, {
        contentType: 'application/pdf',
        cacheControl: '31536000',
        upsert: true
      });
    
    if (pdfUploadError) {
      console.error(`[${requestId}] ❌ PDF upload failed:`, pdfUploadError);
      throw pdfUploadError;
    }
    
    console.log(`[${requestId}] ✅ PDF uploaded successfully`);
    
    // Mettre à jour file_url
    await updatePlanStatus(planId, 'processing', 2, {
      file_url: pdfStoragePath
    });
    
    // Mettre à jour le statut
    await updatePlanStatus(planId, 'processing', 5);
    onProgress?.(5);
    
    // 1️⃣ Linearize
    console.log(`[${requestId}] ⚡ Linearizing...`);
    execSync(`qpdf "${inputPdf}" --linearize "${linearizedPdf}"`, {
      timeout: 120000, // 2 minutes max
    });
    
    const pageCount = Number(
      execSync(`qpdf --show-npages "${linearizedPdf}"`).toString().trim()
    );
    
    console.log(`[${requestId}] 📊 Pages: ${pageCount}`);
    
    await updatePlanStatus(planId, 'processing', 10);
    onProgress?.(10);
    
    // 2️⃣ Traiter les pages EN PARALLÈLE
    // Ajuster selon votre RAM : 8GB=2, 16GB=4, 32GB=8
    const limit = pLimit(4); // 4 pages en parallèle max
    
    const pagePromises = [];
    let processingComplete = false; // Flag pour arrêter les updates
    
    for (let i = 1; i <= pageCount; i++) {
      pagePromises.push(
        limit(() => processPage({
          linearizedPdf,
          pageNumber: i,
          pageCount,
          pagesDir,
          projectId,
          planId,
          fileName,
          requestId,
          supabaseClient: supabase,
          onPageProgress: (pageProgress) => {
            // Ne mettre à jour que si le traitement n'est pas terminé
            if (!processingComplete && pageProgress < 100) {
              // Calculer la progression globale
              const baseProgress = 10;
              const processingRange = 80; // 10% → 90%
              const globalProgress = baseProgress + (processingRange * pageProgress / 100);
              
              updatePlanStatus(planId, 'processing', Math.round(globalProgress));
              onProgress?.(Math.round(globalProgress));
            }
          }
        }))
      );
    }
    
    const results = await Promise.all(pagePromises);
    
    // Marquer le traitement comme terminé pour arrêter les updates asynchrones
    processingComplete = true;
    
    console.log(`[${requestId}] ✅ All pages processed`);
    
    // 3️⃣ Finaliser - Mettre à jour le plan principal
    const name = `${safeBase}-page1`; // Utiliser la première page comme référence
    const remoteTilesPath = `${projectId}/tiles/${name}`;
    
    console.log(`[${requestId}] 📊 Final update data:`);
    console.log(`[${requestId}]   - status: ready`);
    console.log(`[${requestId}]   - progress: 100`);
    console.log(`[${requestId}]   - width: ${results[0].width}`);
    console.log(`[${requestId}]   - height: ${results[0].height}`);
    console.log(`[${requestId}]   - pages: ${pageCount}`);
    console.log(`[${requestId}]   - tiles_path: ${remoteTilesPath}`);
    
    await updatePlanStatus(planId, 'ready', 100, {
      width: results[0].width,
      height: results[0].height,
      pages: pageCount,
      tiles_path: remoteTilesPath
    });
    
    console.log(`[${requestId}] ✅ Status updated to "ready"`);
    
    onProgress?.(100);
    
    // Cleanup
    await fs.remove(tmpDir);
    
    return {
      success: true,
      planId,
      pages: pageCount
    };
    
  } catch (error) {
    console.error(`[${requestId}] ❌ Processing error:`, error);
    
    await updatePlanStatus(planId, 'failed', 0, {
      error_message: error.message
    });
    
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
    
    throw error;
  }
}

/**
 * Traiter une page individuelle
 */
async function processPage({
  linearizedPdf,
  pageNumber,
  pageCount,
  pagesDir,
  projectId,
  planId,
  fileName,
  requestId,
  supabaseClient,
  onPageProgress
}) {
  const safeBase = storageBase(fileName, planId);
  const name = `${safeBase}-page${pageNumber}`;
  const pagePdf = path.join(pagesDir, `${name}.pdf`);
  const outputPng = path.join(pagesDir, `${name}.png`);
  const previewPng = path.join(pagesDir, `${name}_preview.png`);
  const tilesBaseDir = path.join(pagesDir, `${name}_tiles`);
  
  try {
    // 1. Extract page
    execSync(
      `qpdf "${linearizedPdf}" --pages "${linearizedPdf}" ${pageNumber} -- "${pagePdf}"`,
      { timeout: 60000 }
    );
    onPageProgress?.(20);
    
    // 2. Rasterize avec Ghostscript (haute résolution pour les tiles - 600 DPI)
    const gsCommand = process.platform === 'win32' ? 'gswin64c' : 'gs';
    execSync(
      `${gsCommand} -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r600 -dBufferSpace=1000000000 -sOutputFile="${outputPng}" "${pagePdf}"`,
      { 
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
        timeout: 120000 // 2 minutes max par page
      }
    );
    onPageProgress?.(40);
    
    // 2.5. Créer une version basse résolution pour l'affichage direct (150 DPI)
    console.log(`[${requestId}] 🖼️  Generating preview PNG at 150 DPI...`);
    execSync(
      `${gsCommand} -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r150 -dBufferSpace=500000000 -sOutputFile="${previewPng}" "${pagePdf}"`,
      { 
        maxBuffer: 1024 * 1024 * 50, // 50MB buffer
        timeout: 120000
      }
    );
    onPageProgress?.(50);
    
    // 2.6. Upload du PNG basse résolution vers Supabase (pour affichage)
    const previewStoragePath = `${projectId}/previews/${name}.png`;
    console.log(`[${requestId}] 📤 Uploading preview PNG (150 DPI) to: ${previewStoragePath}`);
    
    const previewBuffer = await fs.readFile(previewPng);
    console.log(`[${requestId}] 📦 Preview PNG size: ${(previewBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const { error: previewUploadError } = await supabaseClient.storage
      .from('project-plans')
      .upload(previewStoragePath, previewBuffer, {
        contentType: 'image/png',
        cacheControl: '31536000',
        upsert: true
      });
    
    if (previewUploadError) {
      console.error(`[${requestId}] ❌ Preview PNG upload failed:`, previewUploadError);
      throw previewUploadError;
    }
    
    console.log(`[${requestId}] ✅ Preview PNG uploaded successfully`);
    
    // Mettre à jour png_url pour la première page uniquement
    if (pageNumber === 1) {
      const { error: updateError } = await supabaseClient
        .from('plans')
        .update({ 
          png_url: previewStoragePath,
          processing_progress: 55
        })
        .eq('id', planId);
      
      if (updateError) {
        console.error(`[${requestId}] ❌ PNG URL update failed:`, updateError);
      }
    }
    
    // 3. Tiling avec Sharp (utilise le PNG haute résolution)
    const sharp = (await import('sharp')).default;
    
    const image = sharp(outputPng, { 
      limitInputPixels: false,
      sequentialRead: true // Optimisation mémoire
    });
    
    const metadata = await image.metadata();
    
    await image
      .tile({
        size: 512,
        layout: 'dz',
        container: 'fs',
        // ✅ JPEG par défaut (plus performant pour les plans PDF)
        // Sharp génère des .jpeg automatiquement
      })
      .toFile(tilesBaseDir);
    
    onPageProgress?.(70);
    
    // 4. Upload vers Supabase (optimisé avec batch)
    const filesDir = `${tilesBaseDir}_files`;
    const remoteTilesPath = `${projectId}/tiles/${name}`;
    
    await uploadTilesBatch(filesDir, `${remoteTilesPath}_files`, requestId);
    
    onPageProgress?.(90);
    
    // 5. Pas de création d'entrée séparée par page
    // Les tiles sont simplement uploadées et le plan principal sera mis à jour à la fin
    
    // Cleanup PNG et preview pour libérer l'espace disque
    await fs.remove(outputPng);
    await fs.remove(previewPng);
    await fs.remove(pagePdf);
    await fs.remove(tilesBaseDir);
    await fs.remove(filesDir);
    
    onPageProgress?.(100);
    
    console.log(`[${requestId}] ✅ Page ${pageNumber}/${pageCount} completed`);
    
    return { width: metadata.width, height: metadata.height };
    
  } catch (error) {
    console.error(`[${requestId}] ❌ Page ${pageNumber} failed:`, error);
    
    if (error.killed) {
      throw new Error(`Page ${pageNumber} timeout - PDF trop complexe`);
    }
    
    throw error;
  }
}

/**
 * Upload des tiles par batch (optimisé)
 */
async function uploadTilesBatch(localPath, remotePrefix, requestId) {
  console.log(`[${requestId}] 📤 Starting upload from: ${localPath}`);
  console.log(`[${requestId}] 📤 Remote prefix: ${remotePrefix}`);
  
  // Vérifier que le dossier existe
  const exists = await fs.pathExists(localPath);
  if (!exists) {
    throw new Error(`Tiles directory not found: ${localPath}`);
  }
  
  const limit = pLimit(10); // 10 uploads simultanés max
  const uploadPromises = [];
  
  const collectFiles = async (dir, prefix = '') => {
    const items = await fs.readdir(dir);
    console.log(`[${requestId}] 📂 Found ${items.length} items in ${dir}`);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const remotePath = `${remotePrefix}${prefix}/${item}`;
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory()) {
        console.log(`[${requestId}] 📁 Entering directory: ${item}`);
        await collectFiles(fullPath, `${prefix}/${item}`);
      } else {
        console.log(`[${requestId}] 📄 Queueing file: ${remotePath}`);
        uploadPromises.push(
          limit(async () => {
            const buffer = await fs.readFile(fullPath);
            console.log(`[${requestId}] ⬆️  Uploading: ${remotePath} (${buffer.length} bytes)`);
            
            const { error } = await supabase.storage
              .from('project-plans')
              .upload(remotePath, buffer, {
                contentType: item.endsWith('.jpeg') || item.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
                cacheControl: '31536000', // 1 an
                upsert: true
              });
            
            if (error) {
              console.error(`[${requestId}] ❌ Upload failed: ${remotePath}`, error.message);
              throw error;
            }
            
            console.log(`[${requestId}] ✅ Uploaded: ${remotePath}`);
          })
        );
      }
    }
  };
  
  await collectFiles(localPath);
  
  console.log(`[${requestId}]  Waiting for ${uploadPromises.length} uploads to complete...`);
  await Promise.all(uploadPromises);
  
  console.log(`[${requestId}] ✅ Uploaded ${uploadPromises.length} tiles`);
}

/**
 * Mettre à jour le statut du plan
 */
async function updatePlanStatus(planId, status, progress, extraData = {}) {
  const { data, error } = await supabase
    .from('plans')
    .update({
      status,
      processing_progress: progress,
      ...extraData,
      updated_at: new Date().toISOString()
    })
    .eq('id', planId);
  
  if (error) {
    console.error(`Failed to update plan status:`, error);
    throw error;
  }
  
  return data;
}

export { processPdfToTiles };