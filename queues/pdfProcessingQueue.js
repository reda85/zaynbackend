// backend/queues/pdfProcessingQueue.js
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { processPdfToTiles } from '../services/pdfProcessor.js';

const connection = new Redis({
  host: process.env.REDISHOST || 'localhost',
  port: process.env.REDISPORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

// Créer la queue
const pdfProcessingQueue = new Queue('pdf-processing', { connection });

// Créer le worker
const worker = new Worker(
  'pdf-processing',
  async (job) => {
    const { pdfBuffer: pdfBufferBase64, projectId, planId, fileName, requestId } = job.data;
    const pdfBuffer = Buffer.from(pdfBufferBase64, 'base64');
    console.log(`[${requestId}] 🔄 Worker started for ${fileName}`);
    
    // Importer le processeur
    
    
    // Traiter le PDF
    const result = await processPdfToTiles({
      pdfBuffer,
      projectId,
      planId,
      fileName,
      requestId,
      onProgress: (progress) => {
        // Mettre à jour la progression
        job.updateProgress(progress);
      }
    });
    
    console.log(`[${requestId}] ✅ Worker completed`);
    
    return result;
  },
  {
    connection,
    concurrency: 2, // 2 PDFs en parallèle max
     lockDuration: 600000,  // ✅ 10 minutes (au lieu de 30s par défaut)
  lockRenewTime: 15000,  // ✅ Renouveler toutes les 15 secondes
    limiter: {
      max: 5, // Max 5 jobs par minute
      duration: 60000,
    },
  }
);

// Événements du worker
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err);
});

worker.on('progress', (job, progress) => {
  console.log(`📊 Job ${job.id} progress: ${progress}%`);
});

// Nettoyer les vieux jobs régulièrement
setInterval(async () => {
  await pdfProcessingQueue.clean(24 * 3600 * 1000, 100, 'completed'); // Garder 24h
  await pdfProcessingQueue.clean(7 * 24 * 3600 * 1000, 500, 'failed'); // Garder 7 jours
  console.log('🧹 Queue cleanup completed');
}, 3600 * 1000); // Toutes les heures

export { pdfProcessingQueue, worker };