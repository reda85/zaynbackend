// File d'attente de traitement des plans PDF.
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processPdfToTiles } from '../services/pdfProcessor.js';
import { supabase } from '../lib/supabase.js';
import { removePlanFiles } from '../services/planFiles.js';

const QUEUE_NAME = 'pdf-processing';
const BUCKET = 'project-plans';

const connection = new Redis({
  host: process.env.REDISHOST || 'localhost',
  port: process.env.REDISPORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

const pdfProcessingQueue = new Queue(QUEUE_NAME, { connection });

/** Emplacement temporaire du PDF déposé en attendant son traitement. */
export const pendingUploadPath = (projectId, planId, revisionId) =>
  `${projectId}/_uploads/${planId}${revisionId ? `_${revisionId}` : ''}.pdf`;

/**
 * Dépose le PDF dans le stockage et met en file un job qui ne contient que son
 * chemin. Auparavant le fichier entier (jusqu'à 100 Mo) était encodé en base64
 * dans Redis, puis exposé par le tableau de bord et la route de suivi des jobs.
 */
export async function enqueuePdf({ buffer, projectId, planId, fileName, requestId, revision = null }) {
  const pdfPath = pendingUploadPath(projectId, planId, revision?.id);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;

  return pdfProcessingQueue.add(
    'process-pdf',
    // `revision` : remplacement d'un plan existant (routes/update-plan.js),
    // avec ce qu'il faut pour revenir à l'ancienne version en cas d'échec.
    { pdfPath, projectId, planId, fileName, requestId, ...(revision ? { revision } : {}) },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );
}

async function loadPdf(data) {
  // Jobs créés avant ce changement : le PDF est encore dans le job.
  if (data.pdfBuffer) {
    return typeof data.pdfBuffer === 'string' ? Buffer.from(data.pdfBuffer, 'base64') : Buffer.from(data.pdfBuffer);
  }
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(data.pdfPath);
  if (error) throw new Error(`PDF introuvable dans le stockage (${data.pdfPath}) : ${error.message}`);
  return Buffer.from(await blob.arrayBuffer());
}

async function processJob(job) {
  const { projectId, planId, fileName, requestId, pdfPath, revision } = job.data;
  console.log(`[${requestId}] 🔄 Worker started for ${fileName}`);

  const pdfBuffer = await loadPdf(job.data);
  const result = await processPdfToTiles({
    pdfBuffer,
    projectId,
    planId,
    fileName,
    requestId,
    revision,
    onProgress: (progress) => job.updateProgress(progress).catch(() => {}),
  });

  // Remplacement réussi : les tuiles et aperçus de l'ancienne version ne servent
  // plus (l'ancien PDF est conservé, `previous_file_url` y fait référence).
  if (revision?.previous?.tiles_path && revision.previous.tiles_path !== result.tilesPath) {
    removePlanFiles({
      id: planId, project_id: projectId,
      tiles_path: revision.previous.tiles_path, pages: revision.previous.pages,
    }).catch((e) => console.error(`[${requestId}] old tiles cleanup failed:`, e.message));
  }

  // Le traitement a rangé le PDF à son emplacement définitif.
  if (pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath]).catch(() => {});

  console.log(`[${requestId}] ✅ Worker completed`);
  return result;
}

/**
 * Dernière tentative épuisée (ou traitement interrompu trop de fois) :
 * le plan ne doit pas rester « en cours » indéfiniment.
 * - premier import : le plan est marqué en échec ;
 * - remplacement : le plan redevient utilisable avec son ancienne version.
 */
async function settleFailedJob(job, err) {
  const { planId, pdfPath, revision } = job.data || {};
  if (pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath]).catch(() => {});
  if (!planId) return;

  const reason = String(err?.message || 'Traitement interrompu').slice(0, 500);
  const patch = revision
    ? {
        status: revision.previous?.status ?? 'ready',
        processing_progress: 100,
        error_message: `La nouvelle version n'a pas pu être traitée : ${reason}`,
        previous_file_url: revision.previous?.previous_file_url ?? null,
        revision_label: revision.previous?.revision_label ?? null,
      }
    : { status: 'failed', processing_progress: 0, error_message: reason };

  // Uniquement si le plan est encore en traitement : on n'écrase pas un plan
  // que quelqu'un aurait remplacé ou relancé entre-temps.
  const { error } = await supabase
    .from('plans')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .in('status', ['queued', 'processing']);
  if (error) throw error;
}

/**
 * Plans restés « en cours » alors qu'aucun job ne les traite plus (worker
 * arrêté au mauvais moment, job purgé) : ils redeviennent utilisables s'ils
 * avaient déjà des tuiles, sinon ils sont marqués en échec.
 */
export async function recoverOrphanPlans({ olderThanMs = 20 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data: stuck, error } = await supabase
    .from('plans')
    .select('id, tiles_path, updated_at, created_at')
    .in('status', ['queued', 'processing'])
    .is('deleted_at', null);
  if (error || !stuck?.length) return 0;

  const jobs = await pdfProcessingQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);
  const alive = new Set(jobs.map((j) => j?.data?.planId).filter(Boolean));
  let recovered = 0;
  for (const plan of stuck) {
    if (alive.has(plan.id)) continue;
    if ((plan.updated_at || plan.created_at || '') > cutoff) continue; // peut-être en cours de mise en file
    const patch = plan.tiles_path
      ? { status: 'ready', processing_progress: 100, error_message: 'Le traitement a été interrompu ; la version précédente est conservée.' }
      : { status: 'failed', processing_progress: 0, error_message: 'Le traitement a été interrompu. Importez le plan à nouveau.' };
    const { error: updateError } = await supabase
      .from('plans').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', plan.id).in('status', ['queued', 'processing']);
    if (!updateError) recovered++;
  }
  if (recovered) console.log(`♻️  ${recovered} plan(s) sorti(s) d'un traitement interrompu`);
  return recovered;
}

let worker = null;
let cleanupTimer = null;

/**
 * Démarre le worker (une seule fois par processus). Appelé par `app.js`, ou
 * par `worker.js` quand le traitement tourne dans un service séparé.
 */
export function startWorker() {
  if (worker) return worker;

  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    concurrency: 2,
    // qpdf et Ghostscript ne bloquent plus Node : le verrou est renouvelé
    // normalement, et un job dont le worker a disparu est repris en 2 minutes
    // au lieu de 10.
    lockDuration: 120000,
    lockRenewTime: 30000,
    limiter: { max: 5, duration: 60000 },
  });

  worker.on('completed', (job) => console.log(`✅ Job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
    if (!job) return;
    // On se fie à l'état réel du job : après une erreur, il repart en attente
    // tant qu'il reste des tentatives ; un job interrompu trop de fois (worker
    // tué) est abandonné sans les avoir toutes utilisées.
    const state = await job.getState().catch(() => 'failed');
    if (state !== 'failed') return;
    await settleFailedJob(job, err).catch((e) => console.error(`Job ${job.id} cleanup failed:`, e.message));
  });
  worker.on('error', (err) => console.error('❌ Worker error:', err.message));

  recoverOrphanPlans().catch((e) => console.error('Orphan plan recovery failed:', e.message));

  cleanupTimer = setInterval(async () => {
    try {
      await recoverOrphanPlans();
      await pdfProcessingQueue.clean(24 * 3600 * 1000, 100, 'completed');
      await pdfProcessingQueue.clean(7 * 24 * 3600 * 1000, 500, 'failed');
    } catch (error) {
      console.error('Queue cleanup error:', error.message);
    }
  }, 3600 * 1000);

  return worker;
}

export async function stopWorker() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (worker) await worker.close();
  await connection.quit().catch(() => {});
}

export { pdfProcessingQueue };
