// Worker de traitement des plans.
//
// Lancé automatiquement par l'API dans un processus séparé (lib/workerProcess.js),
// ou à la main avec `npm run worker` quand il tourne dans un service distinct
// (dans ce cas, lancer l'API avec PLAN_WORKER=off).
import 'dotenv/config';
import { startWorker, stopWorker } from './queues/pdfProcessingQueue.js';

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled rejection in worker:', reason?.message || reason);
});

startWorker();
console.log('✅ PDF processing worker started, waiting for jobs...');

let closing = false;
const shutdown = async (signal) => {
  if (closing) return;
  closing = true;
  console.log(`⚠️  ${signal} received, closing worker...`);
  // Un job en cours qui ne se termine pas à temps sera repris par la file.
  const force = setTimeout(() => process.exit(0), 7000);
  force.unref();
  await stopWorker().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// L'API qui nous a lancés s'est arrêtée : on ne reste pas orphelin.
process.on('disconnect', () => shutdown('disconnect'));
