// backend/routes/updatePlan.js (ES6)
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import { processPdfToTiles } from '../services/pdfProcessor.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post('/', upload.single('file'), async (req, res) => {
  const { planId, revisionLabel } = req.body;
  const file = req.file;

  if (!planId || !file) {
    return res.status(400).json({ error: 'planId et fichier requis' });
  }

  // 1. Récupérer le plan existant
  const { data: plan, error: fetchError } = await supabase
    .from('plans')
    .select('id, project_id, file_url, width, height, name')
    .eq('id', planId)
    .single();

  if (fetchError || !plan) {
    return res.status(404).json({ error: 'Plan introuvable' });
  }

  // 2. Snapshot des anciennes dimensions + marquer en processing
  const oldWidth = plan.width;
  const oldHeight = plan.height;

  await supabase.from('plans').update({
    status: 'processing',
    processing_progress: 0,
    previous_file_url: plan.file_url,
    revision_label: revisionLabel || null,
    updated_at: new Date().toISOString(),
  }).eq('id', planId);

  // 3. Répondre immédiatement (traitement async)
  res.json({ planId, estimatedTime: '1-3 minutes' });

  // 4. Traitement en arrière-plan
  const requestId = uuidv4();

  try {
    // On réutilise processPdfToTiles avec le même planId
    // → même path storage → upsert: true écrase les tiles existantes
    await processPdfToTiles({
      pdfBuffer: file.buffer,
      projectId: plan.project_id,
      planId,                    // ← même planId = même dossier storage
      fileName: file.originalname,
      requestId,
      onProgress: (p) => console.log(`[update-plan][${planId}] ${p}%`),
    });

    // 5. processPdfToTiles met déjà status='ready' avec width/height
    //    Il reste à vérifier si les dimensions ont changé
    const { data: updated } = await supabase
      .from('plans')
      .select('width, height')
      .eq('id', planId)
      .single();

    const dimensionsChanged =
      oldWidth && oldHeight &&
      updated &&
      (updated.width !== oldWidth || updated.height !== oldHeight);

    if (dimensionsChanged) {
      await supabase.from('plans')
        .update({ dimensions_changed: true })
        .eq('id', planId);
    }

  } catch (err) {
    console.error(`[update-plan] ❌`, err.message);
    // processPdfToTiles gère déjà le status='failed' en interne
  }
});

export default router;