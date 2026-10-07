// Lance le traitement des plans (worker.js) dans un processus séparé de l'API.
//
// Découper un plan consomme beaucoup de mémoire et de processeur : dans le même
// processus, un gros PDF ralentissait toutes les requêtes et, s'il faisait
// tomber Node, l'API tombait avec lui. Ici, si le worker s'arrête, l'API
// continue de répondre et le relance ; le job interrompu est repris par la file.
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'worker.js');

let child = null;
let stopping = false;
let restartTimer = null;
let restarts = 0;

function scheduleRestart(startedAt, reason) {
  if (stopping) return;
  // Un worker qui a tenu plus d'une minute repart tout de suite ; s'il tombe
  // en boucle, on espace les relances (1 s, 2 s, 4 s… jusqu'à 30 s).
  restarts = Date.now() - startedAt > 60000 ? 0 : restarts + 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(restarts, 5));
  console.error(`❌ PDF worker ${reason}; restarting in ${delay} ms`);
  clearTimeout(restartTimer);
  restartTimer = setTimeout(spawn, delay);
}

function spawn() {
  const startedAt = Date.now();
  let proc;
  try {
    proc = fork(WORKER_FILE, [], { env: process.env });
  } catch (err) {
    scheduleRestart(startedAt, `could not start (${err.message})`);
    return;
  }
  child = proc;
  let over = false;
  const ended = (reason) => {
    if (over) return;
    over = true;
    if (child === proc) child = null;
    scheduleRestart(startedAt, reason);
  };
  console.log(`🔄 PDF worker process started (pid ${proc.pid})`);

  proc.on('exit', (code, signal) => ended(`exited (code ${code}, signal ${signal})`));
  proc.on('error', (err) => {
    console.error('❌ PDF worker process error:', err.message);
    // Échec du lancement lui-même : aucun événement « exit » ne suivra.
    if (!proc.pid) ended('failed to start');
  });
}

export function startWorkerProcess() {
  if (child || stopping) return;
  spawn();
}

/** Demande l'arrêt du worker et attend sa fin (au plus `timeoutMs`). */
export function stopWorkerProcess(timeoutMs = 8000) {
  stopping = true;
  clearTimeout(restartTimer);
  const running = child;
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => { running.kill('SIGKILL'); resolve(); }, timeoutMs);
    running.once('exit', () => { clearTimeout(force); resolve(); });
    running.kill('SIGTERM');
  });
}
