// routes/upload.js — import d'un plan PDF et suivi de son traitement.
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { pdfProcessingQueue, enqueuePdf } from '../queues/pdfProcessingQueue.js';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requireProjectMember, requirePlanAccess, accessiblePlan } from '../lib/auth.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 Mo
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

/**
 * POST /api/upload-pdf
 * Crée le plan et lance son traitement asynchrone.
 */
router.post('/', requireAuth, upload.single('file'), requireProjectMember('body.projectId'), async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const { projectId } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'Missing file or projectId' });
    if (!file.buffer.toString('latin1', 0, 5).startsWith('%PDF')) {
      return res.status(400).json({ error: 'Invalid PDF file' });
    }

    const { data: plan, error: dbError } = await supabase
      .from('plans')
      .insert({
        project_id: projectId,
        name: file.originalname,
        status: 'queued',
        processing_progress: 0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (dbError || !plan) throw dbError || new Error('Plan creation failed');

    let job;
    try {
      job = await enqueuePdf({
        buffer: file.buffer,
        projectId,
        planId: plan.id,
        fileName: file.originalname,
        requestId,
      });
    } catch (queueError) {
      // Pas de plan fantôme « en attente » si la mise en file échoue.
      await supabase.from('plans').update({ status: 'failed', error_message: queueError.message }).eq('id', plan.id);
      throw queueError;
    }

    console.log(`[${requestId}] ✅ Job ${job.id} queued for plan ${plan.id}`);
    res.status(202).json({
      message: 'PDF upload successful, processing started',
      planId: plan.id,
      jobId: job.id,
      status: 'queued',
      estimatedTime: '5-10 minutes',
    });
  } catch (error) {
    console.error(`[${requestId}] ❌ Upload error:`, error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

/** GET /api/upload-pdf/status/:planId — état du traitement. */
router.get('/status/:planId', requireAuth, requirePlanAccess('params.planId'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('status, processing_progress, error_message, width, height, pages')
      .eq('id', req.plan.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/** GET /api/upload-pdf/job/:jobId — état d'un job (sans son contenu). */
router.get('/job/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await pdfProcessingQueue.getJob(req.params.jobId);
    if (!job || !(await accessiblePlan(req, job.data?.planId))) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
      id: job.id,
      state: await job.getState(),
      progress: job.progress,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      data: { planId: job.data.planId, projectId: job.data.projectId, fileName: job.data.fileName },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

/**
 * DELETE /api/upload-pdf/:planId — annule un traitement et supprime le plan.
 * La suppression passe par le client de l'utilisateur : ce sont les RLS qui
 * décident s'il en a le droit (administrateur de l'organisation).
 */
router.delete('/:planId', requireAuth, requirePlanAccess('params.planId'), async (req, res) => {
  try {
    const planId = req.plan.id;

    // À lire avant la suppression : les chemins de ses fichiers.
    const { data: files } = await supabase
      .from('plans').select('id, file_url, png_url, tiles_path, pages').eq('id', planId).maybeSingle();

    const { data: deleted, error } = await req.db.from('plans').delete().eq('id', planId).select('id');
    if (error) throw error;
    if (!deleted || deleted.length === 0) {
      return res.status(403).json({ error: 'Access denied: only an organization admin can delete a plan' });
    }

    const jobs = await pdfProcessingQueue.getJobs(['waiting', 'active', 'delayed']);
    const job = jobs.find((j) => j.data.planId === planId);
    if (job) await job.remove().catch(() => {});

    res.json({ message: 'Plan deleted successfully' });

    // Nettoyage du stockage après la réponse, sans bloquer l'utilisateur.
    if (files) removePlanFiles(files).catch((e) => console.error(`Plan ${planId} storage cleanup failed:`, e.message));
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

/**
 * Supprime du stockage le PDF, les aperçus et les tuiles d'un plan supprimé.
 * Les anciens plans importés sous le même nom de fichier partagent leurs
 * chemins : on ne supprime rien tant qu'un autre plan pointe sur les mêmes fichiers.
 */
export async function removePlanFiles(plan) {
  const bucket = supabase.storage.from('project-plans');
  const shared = async (column, value) => {
    if (!value) return true;
    const { count, error } = await supabase
      .from('plans').select('id', { count: 'exact', head: true }).eq(column, value).neq('id', plan.id);
    return Boolean(error) || (count ?? 0) > 0;      // dans le doute, on garde
  };

  if (plan.file_url && !(await shared('file_url', plan.file_url))) {
    await bucket.remove([plan.file_url]);
  }
  if (!plan.tiles_path || (await shared('tiles_path', plan.tiles_path))) return;

  // tiles_path = <projet>/tiles/<base>-page1 ; les autres pages suivent le même modèle.
  const pages = Math.max(1, Number(plan.pages) || 1);
  for (let page = 1; page <= pages; page++) {
    const pagePath = plan.tiles_path.replace(/-page1$/, `-page${page}`);
    const preview = pagePath.replace('/tiles/', '/previews/') + '.png';
    await bucket.remove([preview, `${pagePath}.dzi`]).catch(() => {});

    const root = `${pagePath}_files`;
    const { data: levels } = await bucket.list(root, { limit: 100 });
    for (const level of levels || []) {
      for (;;) {
        const { data: tiles } = await bucket.list(`${root}/${level.name}`, { limit: 1000 });
        if (!tiles || tiles.length === 0) break;
        const { error } = await bucket.remove(tiles.map((t) => `${root}/${level.name}/${t.name}`));
        if (error || tiles.length < 1000) break;
      }
    }
  }
}

export default router;
