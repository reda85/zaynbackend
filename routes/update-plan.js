// routes/update-plan.js — remplacement du PDF d'un plan existant (nouvelle version).
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { supabase } from '../lib/supabase.js';
import { enqueuePdf } from '../queues/pdfProcessingQueue.js';
import { requireAuth, requirePlanAccess } from '../lib/auth.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

/**
 * POST /api/update-plan  (multipart : file, planId, revisionLabel?)
 *
 * La nouvelle version est traitée par la file d'attente, comme un import :
 * elle est écrite à côté de l'ancienne, et le plan ne bascule dessus qu'une
 * fois le traitement réussi. En cas d'échec le plan reste utilisable tel quel,
 * avec le motif dans `error_message`.
 */
router.post('/', requireAuth, upload.single('file'), requirePlanAccess('body.planId'), async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const planId = req.plan.id;
  const file = req.file;
  const revisionLabel = typeof req.body.revisionLabel === 'string' ? req.body.revisionLabel.trim().slice(0, 120) : '';

  try {
    if (!file) return res.status(400).json({ error: 'planId et fichier requis' });
    if (!file.buffer.subarray(0, 1024).includes('%PDF')) {
      return res.status(400).json({ error: 'Le fichier n\'est pas un PDF valide' });
    }

    const { data: plan, error: fetchError } = await supabase
      .from('plans')
      .select('id, project_id, file_url, png_url, tiles_path, width, height, pages, name, status, previous_file_url, revision_label')
      .eq('id', planId)
      .single();
    if (fetchError || !plan) return res.status(404).json({ error: 'Plan introuvable' });

    if (['queued', 'processing'].includes(plan.status)) {
      return res.status(409).json({ error: 'Ce plan est déjà en cours de traitement' });
    }

    // Le passage en « traitement » se fait avec le client de l'utilisateur : ce
    // sont les RLS qui décident s'il a le droit de modifier ce plan. La condition
    // sur le statut évite que deux envois simultanés ne se lancent tous les deux.
    const { data: claimed, error: claimError } = await req.db
      .from('plans')
      .update({
        status: 'processing',
        processing_progress: 0,
        error_message: null,
        previous_file_url: plan.file_url,
        revision_label: revisionLabel || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId)
      .eq('status', plan.status)
      .select('id');
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) {
      return res.status(403).json({ error: 'Vous n\'avez pas le droit de modifier ce plan, ou il vient d\'être modifié' });
    }

    let job;
    try {
      job = await enqueuePdf({
        buffer: file.buffer,
        projectId: plan.project_id,
        planId,
        fileName: file.originalname,
        requestId,
        revision: {
          id: crypto.randomUUID().replace(/-/g, '').slice(0, 10),
          previous: {
            tiles_path: plan.tiles_path, pages: plan.pages, width: plan.width, height: plan.height,
            previous_file_url: plan.previous_file_url, revision_label: plan.revision_label,
          },
        },
      });
    } catch (queueError) {
      // Rien n'a été lancé : le plan revient exactement à son état d'avant.
      await supabase.from('plans').update({
        status: plan.status,
        processing_progress: 100,
        previous_file_url: plan.previous_file_url,
        revision_label: plan.revision_label,
      }).eq('id', planId);
      throw queueError;
    }

    console.log(`[${requestId}] ✅ Job ${job.id} queued to update plan ${planId}`);
    res.status(202).json({ planId, jobId: job.id, status: 'processing', estimatedTime: '1-3 minutes' });
  } catch (err) {
    console.error(`[${requestId}] ❌ update-plan:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: 'La mise à jour du plan a échoué' });
  }
});

export default router;
