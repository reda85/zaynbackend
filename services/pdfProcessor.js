// backend/services/pdfProcessor.js (ES6 version)
import fs from 'fs-extra';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { removePlanFiles } from './planFiles.js';

const execFileAsync = promisify(execFile);

// qpdf et Ghostscript tournent dans leur propre processus, sans bloquer celui-ci
// (avec execSync, plus rien ne répondait pendant toute la durée d'une page), et
// sans passer par un shell : les chemins sont transmis tels quels.
async function run(command, args, { timeout = 120000, maxBuffer = 16 * 1024 * 1024, signal } = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout, maxBuffer, windowsHide: true, signal });
    return stdout;
  } catch (error) {
    // qpdf sort avec le code 3 quand il a réussi malgré des avertissements.
    if (command === 'qpdf' && error.code === 3 && !error.killed) return error.stdout || '';
    if (error.killed || error.name === 'AbortError') throw error; // délai dépassé ou traitement annulé
    // Le détail (chemins temporaires, sortie de l'outil) va dans les journaux ;
    // l'utilisateur voit un message court dans `error_message`.
    console.error(`${command} failed:`, String(error.stderr || error.message).slice(0, 2000));
    throw new Error(command === 'qpdf' ? 'PDF illisible ou endommagé' : 'Le rendu d\'une page du PDF a échoué');
  }
}

// Nom de base des fichiers d'un plan dans le stockage. L'identifiant du plan en
// fait partie : deux plans importés avec le même nom de fichier dans un projet
// n'écrasent plus le PDF, les tuiles et l'aperçu l'un de l'autre. Une révision
// (routes/update-plan.js) ajoute son propre suffixe : la nouvelle version est
// écrite à côté de l'ancienne, qui reste affichée tant que le traitement n'a
// pas abouti, et les tuiles mises en cache par les appareils ne sont pas
// confondues avec les nouvelles.
export function storageBase(fileName, planId, revision) {
  const base = String(fileName || 'plan').replace(/\.pdf$/i, '').replace(/[^a-z0-9]/gi, '_').slice(0, 80);
  const suffix = revision ? `_r${String(revision).replace(/[^a-z0-9]/gi, '').slice(0, 12)}` : '';
  return `${base}_${String(planId).replace(/[^a-z0-9]/gi, '').slice(0, 8)}${suffix}`;
}

/**
 * Traiter un PDF en tiles avec parallélisation.
 *
 * `revision` (facultatif) : { id, previous: { width, height } } pour le
 * remplacement d'un plan existant. Dans ce cas le plan garde ses fichiers
 * actuels jusqu'à la dernière étape, et un échec ne le marque pas « failed » :
 * c'est l'appelant qui décide (queues/pdfProcessingQueue.js).
 */
async function processPdfToTiles({ 
  pdfBuffer, 
  projectId, 
  planId,
  fileName, 
  requestId,
  onProgress,
  revision = null,
}) {
  let tmpDir;
  let pdfStoragePath = null;
  let pageCount = 0;
  const safeBase = storageBase(fileName, planId, revision?.id);
  const remoteTilesPath = `${projectId}/tiles/${safeBase}-page1`;
  // Les mises à jour de progression ne doivent ni interrompre le traitement ni
  // faire tomber le processus si la base est momentanément injoignable.
  // Elles s'arrêtent dès que le traitement est terminé ou a échoué, et ne
  // touchent qu'un plan encore « en cours » : une page qui finit en retard ne
  // doit pas remettre en traitement un plan déjà rendu à l'utilisateur.
  let finished = false;
  const abort = new AbortController();
  const pagePromises = [];
  const reportProgress = (progress) => {
    if (finished) return;
    updatePlanStatus(planId, 'processing', progress, {}, { onlyWhileProcessing: true }).catch((e) =>
      console.error(`[${requestId}] progress update failed:`, e.message));
  };
  
  try {
    if (!Buffer.isBuffer(pdfBuffer) || !pdfBuffer.subarray(0, 1024).includes('%PDF')) {
      throw new Error('Le fichier n\'est pas un PDF valide');
    }

    // Créer le dossier temporaire
    const osTmpDir = process.env.TMPDIR || '/tmp';
    tmpDir = path.join(osTmpDir, `zyn-${String(requestId).replace(/[^a-z0-9-]/gi, '')}-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    
    const inputPdf = path.join(tmpDir, 'input.pdf');
    const linearizedPdf = path.join(tmpDir, 'linearized.pdf');
    const pagesDir = path.join(tmpDir, 'pages');
    await fs.ensureDir(pagesDir);
    
    await fs.writeFile(inputPdf, pdfBuffer);
    
    // Upload du PDF original vers Supabase
    pdfStoragePath = `${projectId}/${safeBase}.pdf`;
    
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
    
    // Premier import : le plan pointe tout de suite sur son PDF.
    // Remplacement : il garde l'ancien jusqu'à la fin du traitement.
    await updatePlanStatus(planId, 'processing', 5, revision ? {} : { file_url: pdfStoragePath });
    onProgress?.(5);
    
    // 1️⃣ Linearize
    console.log(`[${requestId}] ⚡ Linearizing...`);
    await run('qpdf', [inputPdf, '--linearize', linearizedPdf], { timeout: 120000, signal: abort.signal });
    
    pageCount = Number((await run('qpdf', ['--show-npages', linearizedPdf], { timeout: 30000, signal: abort.signal })).toString().trim());
    if (!Number.isInteger(pageCount) || pageCount < 1) throw new Error('PDF sans page lisible');
    
    console.log(`[${requestId}] 📊 Pages: ${pageCount}`);
    
    await updatePlanStatus(planId, 'processing', 10);
    onProgress?.(10);
    
    // 2️⃣ Traiter les pages EN PARALLÈLE
    // Ajuster selon votre RAM : 8GB=2, 16GB=4, 32GB=8
    const limit = pLimit(4); // 4 pages en parallèle max
    
    
    for (let i = 1; i <= pageCount; i++) {
      pagePromises.push(
        limit(() => processPage({
          linearizedPdf,
          pageNumber: i,
          pageCount,
          pagesDir,
          projectId,
          planId,
          safeBase,
          setPreview: !revision,
          requestId,
          signal: abort.signal,
          supabaseClient: supabase,
          onPageProgress: (pageProgress) => {
            // Ne mettre à jour que si le traitement n'est pas terminé
            if (!finished && pageProgress < 100) {
              // Calculer la progression globale
              const baseProgress = 10;
              const processingRange = 80; // 10% → 90%
              const globalProgress = baseProgress + (processingRange * pageProgress / 100);
              
              reportProgress(Math.round(globalProgress));
              onProgress?.(Math.round(globalProgress));
            }
          }
        }))
      );
    }
    
    const results = await Promise.all(pagePromises);
    finished = true;
    
    console.log(`[${requestId}] ✅ All pages processed`);
    
    // 3️⃣ Finaliser - Mettre à jour le plan principal
    const previous = revision?.previous || {};
    const dimensionsChanged = Boolean(
      revision && previous.width && previous.height &&
      (previous.width !== results[0].width || previous.height !== results[0].height)
    );
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
      tiles_path: remoteTilesPath,
      error_message: null,
      // Remplacement : tout bascule d'un coup sur la nouvelle version.
      ...(revision ? {
        file_url: pdfStoragePath,
        png_url: `${projectId}/previews/${safeBase}-page1.png`,
        dimensions_changed: dimensionsChanged,
      } : {}),
    });
    
    console.log(`[${requestId}] ✅ Status updated to "ready"`);
    
    onProgress?.(100);
    
    // Le plan pointe désormais sur ces fichiers : un souci de ménage ne doit
    // pas passer pour un échec du traitement.
    await fs.remove(tmpDir).catch(() => {});
    
    return {
      success: true,
      planId,
      pages: pageCount,
      tilesPath: remoteTilesPath,
      dimensionsChanged,
    };
    
  } catch (error) {
    console.error(`[${requestId}] ❌ Processing error:`, error);
    
    // Arrête les pages encore en cours (qpdf / Ghostscript compris) et attend
    // qu'elles aient rendu la main avant de faire le ménage.
    finished = true;
    abort.abort();
    await Promise.allSettled(pagePromises);
    
    if (revision) {
      // Le plan affiche toujours l'ancienne version : on retire seulement ce
      // qui a été déposé pour la nouvelle (une nouvelle tentative le redéposera).
      await removePlanFiles({
        id: planId, project_id: projectId, file_url: pdfStoragePath,
        tiles_path: remoteTilesPath, pages: pageCount || 1,
      }).catch(() => {});
    }
    // Le plan n'est pas marqué « en échec » ici : une autre tentative peut
    // suivre. C'est la file qui tranche après la dernière (settleFailedJob).
    
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
  safeBase,
  setPreview = true,
  requestId,
  signal,
  supabaseClient,
  onPageProgress
}) {
  const stopIfAborted = () => { if (signal?.aborted) throw new Error('Traitement annulé'); };
  const name = `${safeBase}-page${pageNumber}`;
  const pagePdf = path.join(pagesDir, `${name}.pdf`);
  const outputPng = path.join(pagesDir, `${name}.png`);
  const previewPng = path.join(pagesDir, `${name}_preview.png`);
  const tilesBaseDir = path.join(pagesDir, `${name}_tiles`);
  
  try {
    // 1. Extract page
    stopIfAborted();
    await run('qpdf', [linearizedPdf, '--pages', linearizedPdf, String(pageNumber), '--', pagePdf], { timeout: 60000, signal });
    onPageProgress?.(20);
    
    // 2. Rasterize avec Ghostscript (haute résolution pour les tiles - 600 DPI)
    const gsCommand = process.platform === 'win32' ? 'gswin64c' : 'gs';
    await run(gsCommand, ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=png16m', '-r600', '-dBufferSpace=1000000000', `-sOutputFile=${outputPng}`, pagePdf], {
      maxBuffer: 1024 * 1024 * 100,
      timeout: 120000, // 2 minutes max par page
      signal,
    });
    onPageProgress?.(40);
    
    // 2.5. Créer une version basse résolution pour l'affichage direct (150 DPI)
    console.log(`[${requestId}] 🖼️  Generating preview PNG at 150 DPI...`);
    await run(gsCommand, ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=png16m', '-r150', '-dBufferSpace=500000000', `-sOutputFile=${previewPng}`, pagePdf], {
      maxBuffer: 1024 * 1024 * 50,
      timeout: 120000,
      signal,
    });
    stopIfAborted();
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
    // (pas pour un remplacement : l'ancien aperçu reste jusqu'à la bascule finale)
    if (pageNumber === 1 && setPreview) {
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
    
    stopIfAborted();
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
    
    stopIfAborted();
    await uploadTilesBatch(filesDir, `${remoteTilesPath}_files`, requestId, signal);
    
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
    
    if (error.killed && !signal?.aborted) {
      throw new Error(`Page ${pageNumber} : délai dépassé, PDF trop complexe`);
    }
    
    throw error;
  }
}

/**
 * Upload des tiles par batch (optimisé)
 */
async function uploadTilesBatch(localPath, remotePrefix, requestId, signal) {
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
            if (signal?.aborted) throw new Error('Traitement annulé');
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
async function updatePlanStatus(planId, status, progress, extraData = {}, { onlyWhileProcessing = false } = {}) {
  let query = supabase
    .from('plans')
    .update({
      status,
      processing_progress: progress,
      ...extraData,
      updated_at: new Date().toISOString()
    })
    .eq('id', planId);
  if (onlyWhileProcessing) query = query.in('status', ['queued', 'processing']);
  const { data, error } = await query;
  
  if (error) {
    console.error(`Failed to update plan status:`, error);
    throw error;
  }
  
  return data;
}

export { processPdfToTiles };