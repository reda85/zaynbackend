// File d'attente de traitement des plans PDF.
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processPdfToTiles } from '../services/pdfProcessor.js';
import { supabase } from '../lib/supabase.js';

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
export const pendingUploadPath = (projectId, planId) => `${projectId}/_uploads/${planId}.pdf`;

/**
 * Dépose le PDF dans le stockage et met en file un job qui ne contient que son
 * chemin. Auparavant le fichier entier (jusqu'à 100 Mo) était encodé en base64
 * dans Redis, puis exposé par le tableau de bord et la route de suivi des jobs.
 */
export async function enqueuePdf({ buffer, projectId, planId, fileName, requestId }) {
  const pdfPath = pendingUploadPath(projectId, planId);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, buffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw error;

  return pdfProcessingQueue.add(
    'process-pdf',
    { pdfPath, projectId, planId, fileName, requestId },
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
  const { projectId, planId, fileName, requestId, pdfPath } = job.data;
  console.log(`[${requestId}] 🔄 Worker started for ${fileName}`);

  const pdfBuffer = await loadPdf(job.data);
  const result = await processPdfToTiles({
    pdfBuffer,
    projectId,
    planId,
    fileName,
    requestId,
    onProgress: (progress) => job.updateProgress(progress),
  });

  // Le traitement a rangé le PDF à son emplacement définitif.
  if (pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath]).catch(() => {});

  console.log(`[${requestId}] ✅ Worker completed`);
  return result;
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
    lockDuration: 600000, // 10 minutes
    lockRenewTime: 15000,
    limiter: { max: 5, duration: 60000 },
  });

  worker.on('completed', (job) => console.log(`✅ Job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
    // Dernière tentative épuisée : on ne laisse pas le PDF en attente indéfiniment.
    if (job?.data?.pdfPath && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      await supabase.storage.from(BUCKET).remove([job.data.pdfPath]).catch(() => {});
    }
  });
  worker.on('error', (err) => console.error('❌ Worker error:', err.message));

  cleanupTimer = setInterval(async () => {
    try {
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
