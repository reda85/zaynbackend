// Worker autonome : `npm run worker`.
// À utiliser quand le traitement des plans tourne dans un service séparé de
// l'API ; dans ce cas, lancer l'API avec DISABLE_INLINE_WORKER=1.
// La logique est la même que celle du worker intégré (queues/pdfProcessingQueue.js).
import 'dotenv/config';
import { startWorker, stopWorker } from './queues/pdfProcessingQueue.js';

startWorker();
console.log('✅ PDF processing worker started, waiting for jobs...');

const shutdown = async (signal) => {
  console.log(`⚠️  ${signal} received, closing worker...`);
  await stopWorker();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
