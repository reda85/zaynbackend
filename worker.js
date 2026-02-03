// backend/worker.js
// Worker BullMQ pour traiter les PDFs (ES6 version)

import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import { processPdfToTiles } from './services/pdfProcessor.js';

// Configuration Redis
const connection = new Redis({
  host: process.env.REDISHOST || 'localhost',
  port: process.env.REDISPORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

// Configuration Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Service key pour bypass RLS
);

console.log('🚀 Starting PDF Processing Worker...');
console.log('📍 Redis:', process.env.REDISHOST || 'localhost');
console.log('📍 Supabase:', process.env.SUPABASE_URL);

// Créer le worker
const worker = new Worker(
  'pdf-processing',
  async (job) => {
    const { planId, pdfBuffer, fileName, requestId, projectId } = job.data;
    
    console.log(`\n[${requestId}] 🔄 Processing started`);
    console.log(`[${requestId}] 📄 Plan ID: ${planId}`);
    console.log(`[${requestId}] 📁 File: ${fileName}`);
    console.log(`[${requestId}] 📂 Project ID: ${projectId}`);
    
    try {
      // 1. Mettre à jour le statut à "processing"
      await supabase
        .from('plans')
        .update({ 
          status: 'processing',
          processing_progress: 0 
        })
        .eq('id', planId);
      
      console.log(`[${requestId}] ✅ Status updated to "processing"`);
      
      // 2. Convertir base64 en buffer si nécessaire
      const buffer = typeof pdfBuffer === 'string' 
        ? Buffer.from(pdfBuffer, 'base64')
        : pdfBuffer;
      
      console.log(`[${requestId}] 📄 PDF size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
      
      // 3. Traiter le PDF en tiles
      const result = await processPdfToTiles({
        pdfBuffer: buffer,
        planId,
        projectId,
        fileName,
        requestId,
        onProgress: async (progress) => {
          // Mettre à jour la progression dans Supabase
          await supabase
            .from('plans')
            .update({ processing_progress: progress })
            .eq('id', planId);
          
          // Mettre à jour la progression du job
          job.updateProgress(progress);
          
          console.log(`[${requestId}] 📊 Progress: ${progress}%`);
        }
      });
      
      // Note: processPdfToTiles met déjà à jour le statut à "ready" avec width, height, tiles_path
      console.log(`[${requestId}] ✅ Processing completed!`);
      console.log(`[${requestId}] 📄 Pages: ${result.pages}`);
      
      return result;
      
    } catch (error) {
      console.error(`[${requestId}] ❌ Processing failed:`, error);
      
      // Mettre à jour le statut à "failed"
      await supabase
        .from('plans')
        .update({ 
          status: 'failed',
          error_message: error.message 
        })
        .eq('id', planId);
      
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // 2 PDFs en parallèle max
    limiter: {
      max: 5, // Max 5 jobs par minute
      duration: 60000,
    },
  }
);

// Événements du worker
worker.on('completed', (job) => {
  console.log(`\n✅ Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`\n❌ Job ${job?.id} failed:`, err.message);
});

worker.on('progress', (job, progress) => {
  console.log(`📊 Job ${job.id}: ${progress}%`);
});

worker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

// Nettoyer les vieux jobs régulièrement
import { Queue } from 'bullmq';
const queue = new Queue('pdf-processing', { connection });

setInterval(async () => {
  try {
    await queue.clean(24 * 3600 * 1000, 100, 'completed'); // Garder 24h
    await queue.clean(7 * 24 * 3600 * 1000, 500, 'failed'); // Garder 7 jours
    console.log('🧹 Queue cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}, 3600 * 1000); // Toutes les heures

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️  SIGTERM received, closing worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('⚠️  SIGINT received, closing worker...');
  await worker.close();
  await connection.quit();
  process.exit(0);
});

console.log('✅ Worker started successfully, waiting for jobs...\n');