// backend/routes/upload.js
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { pdfProcessingQueue } from '../queues/pdfProcessingQueue.js';
import { supabase } from '../lib/supabase.js';
const router = express.Router();


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

/**
 * POST /api/upload-pdf
 * Upload PDF et lance le traitement asynchrone
 */
router.post('/', upload.single('file'), async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  
  try {
    console.log(` 🚀 Upload received: ${req}`);
    const { projectId } = req.body;
    const file = req.file;
    
    console.log(`[${requestId}] 🚀 Upload received: ${file?.originalname}`);
    
    if (!file || !projectId) {
      return res.status(400).json({ error: 'Missing file or projectId' });
    }
    
    // Validation basique du PDF
    if (!file.buffer.toString('utf8', 0, 4).includes('%PDF')) {
      return res.status(400).json({ error: 'Invalid PDF file' });
    }
    
    //const planId = `${projectId}_${Date.now()}`;
    
    // 1️⃣ Créer l'entrée en base de données
    const { data: plan, error: dbError } = await supabase
      .from('plans')
      .insert({
        
        project_id: projectId,
        name: file.originalname,
        status: 'queued', // ✅ Statut initial
        processing_progress: 0,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    const planId = plan.id;
    if (dbError) throw dbError;
    
    // 2️⃣ Ajouter le job à la queue
    const job = await pdfProcessingQueue.add(
      'process-pdf',
      {
        pdfBuffer: file.buffer.toString('base64'), // Convertir en base64 pour le transport
        projectId,
        planId,
        fileName: file.originalname,
        requestId,
      },
      {
        attempts: 3, // Retry 3 fois en cas d'échec
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: 100, // Garder les 100 derniers jobs complétés
        removeOnFail: 500, // Garder les 500 derniers jobs échoués
      }
    );
    
    console.log(`[${requestId}] ✅ Job ${job.id} added to queue`);
    
    // 3️⃣ Répondre immédiatement au client
    res.status(202).json({
      message: 'PDF upload successful, processing started',
      planId,
      jobId: job.id,
      status: 'queued',
      estimatedTime: '5-10 minutes', // Estimation
    });
    
  } catch (error) {
    console.error(`[${requestId}] ❌ Upload error:`, error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
});

/**
 * GET /api/upload-pdf/status/:planId
 * Vérifier le statut du traitement
 */
router.get('/status/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    
    const { data, error } = await supabase
      .from('plans')
      .select('status, processing_progress, error_message, width, height, pages')
      .eq('id', planId)
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /api/upload-pdf/job/:jobId
 * Vérifier le statut d'un job spécifique
 */
router.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await pdfProcessingQueue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const state = await job.getState();
    const progress = job.progress;
    const failedReason = job.failedReason;
    
    res.json({
      id: job.id,
      state,
      progress,
      failedReason,
      attemptsMade: job.attemptsMade,
      data: job.data,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

/**
 * DELETE /api/upload-pdf/:planId
 * Annuler un traitement en cours
 */
router.delete('/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    
    // Trouver le job associé au planId
    const jobs = await pdfProcessingQueue.getJobs(['waiting', 'active', 'delayed']);
    const job = jobs.find(j => j.data.planId === planId);
    
    if (job) {
      await job.remove();
      console.log(`✅ Job ${job.id} cancelled`);
    }
    
    // Supprimer le plan de la base de données
    await supabase
      .from('plans')
      .delete()
      .eq('id', planId);
    
    res.json({ message: 'Plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

export default router;