// Génération de rapports en arrière-plan.
//
// Un rapport peut prendre plusieurs minutes (rendu des plans, photos, PDF) :
// trop long pour une requête HTTP sur un réseau mobile. Le client demande donc
// la génération, reçoit un identifiant, puis interroge l'état du travail.
//
// Les travaux vivent dans la mémoire de ce processus : un redémarrage du
// serveur les fait disparaître (le client reçoit alors « introuvable » et
// relance). Suffisant tant que l'API tourne en une seule instance ; au-delà,
// il faudra une file partagée (BullMQ, déjà utilisé pour les plans).
import crypto from 'crypto';
import pLimit from 'p-limit';

const KEEP_MS = 60 * 60 * 1000;          // durée de validité du lien signé
const limit = pLimit(Number(process.env.REPORT_CONCURRENCY) || 2);
const jobs = new Map();

function sweep(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > KEEP_MS) jobs.delete(id);
  }
}

/** Lance `run` en arrière-plan et renvoie tout de suite le travail créé. */
export function startReportJob(userId, run) {
  sweep();
  const job = { id: crypto.randomUUID(), userId, status: 'queued', createdAt: Date.now(), result: null, error: null };
  jobs.set(job.id, job);
  limit(async () => {
    job.status = 'processing';
    try {
      job.result = await run();
      job.status = 'done';
    } catch (err) {
      console.error(`❌ Report job ${job.id} failed:`, err?.message);
      job.error = err?.message || 'Internal server error';
      job.status = 'failed';
    }
  });
  return job;
}

/** Travail visible par son seul demandeur. */
export function getReportJob(id, userId) {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

export function describeReportJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    ...(job.status === 'done' ? job.result : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  };
}
