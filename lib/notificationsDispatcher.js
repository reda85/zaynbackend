// Envoi en push des notifications (table notifications, remplie par des
// déclencheurs SQL) et notifications d'échéance.
//
// - Toutes les 15 s : réserve les notifications pas encore envoyées
//   (claim_notification_pushes, une seule instance les prend) et les pousse
//   sur les téléphones du destinataire (user_fcm_tokens). Plusieurs
//   notifications pour une même personne partent en un seul push résumé.
// - Toutes les heures : notify_due_items() crée les « échéance demain » et
//   « en retard » (à partir de 7 h, une seule fois par élément et échéance).
//
// Tant que la migration n'est pas appliquée, les fonctions SQL n'existent
// pas : le système reste inactif et les anciennes routes gardent leurs push.

const PUSH_EVERY_MS = 15_000;
const DUE_EVERY_MS = 60 * 60_000;
const RETRY_MISSING_MS = 10 * 60_000;

let active = false;
/** Vrai quand les notifications passent par la table (migration appliquée). */
export const notificationsActive = () => active;

const PIN_KINDS = new Set(['assigned', 'status', 'comment', 'photo', 'due_soon', 'overdue']);

/** Données du push : ce qu'il faut à l'application pour ouvrir la bonne page. */
function pushData(n) {
  const target = n.target || {};
  return {
    // « pin_assigned » : les versions de l'application déjà installées savent
    // ouvrir l'élément à partir de ce type.
    type: PIN_KINDS.has(n.kind) && n.pin_id ? 'pin_assigned' : 'notification',
    kind: n.kind,
    notificationId: n.id,
    pinId: n.pin_id ?? null,
    projectId: n.project_id ?? null,
    meetingId: target.meetingId ?? null,
    documentId: target.documentId ?? null,
    reportId: target.reportId ?? null,
  };
}

const missingFunction = (error) => /function .* does not exist|Could not find the function|schema cache/i.test(error?.message ?? '');

export function startNotificationDispatcher({ supabase, sendExpoNotifications }) {
  if (process.env.NOTIFICATIONS_DISPATCHER === 'off') {
    console.log('🔕 Notifications : envoi désactivé (NOTIFICATIONS_DISPATCHER=off)');
    return () => {};
  }
  let stopped = false;
  let pushing = false;
  let pausedUntil = 0;

  async function dispatch() {
    if (stopped || pushing || Date.now() < pausedUntil) return;
    pushing = true;
    try {
      const { data: rows, error } = await supabase.rpc('claim_notification_pushes', { p_limit: 200 });
      if (error) {
        if (missingFunction(error)) {
          if (active || pausedUntil === 0) console.warn('🔕 Notifications : migration absente, nouvel essai dans 10 min');
          active = false;
          pausedUntil = Date.now() + RETRY_MISSING_MS;
          return;
        }
        throw error;
      }
      if (!active) console.log('🔔 Notifications : envoi des push actif');
      active = true;
      if (!rows?.length) return;

      const byUser = new Map();
      for (const n of rows) {
        if (!n.auth_id) continue;
        if (!byUser.has(n.auth_id)) byUser.set(n.auth_id, []);
        byUser.get(n.auth_id).push(n);
      }
      if (!byUser.size) return;

      const { data: tokens, error: tokensError } = await supabase
        .from('user_fcm_tokens').select('user_id, fcm_token').in('user_id', [...byUser.keys()]);
      if (tokensError) throw tokensError;
      const tokensByUser = new Map();
      for (const t of tokens ?? []) {
        if (!tokensByUser.has(t.user_id)) tokensByUser.set(t.user_id, []);
        tokensByUser.get(t.user_id).push(t.fcm_token);
      }

      let sent = 0;
      for (const [userId, list] of byUser) {
        const userTokens = [...new Set(tokensByUser.get(userId) ?? [])];
        if (!userTokens.length) continue;
        if (list.length === 1) {
          const [n] = list;
          await sendExpoNotifications(userTokens, n.title, n.body ?? '', pushData(n));
        } else {
          await sendExpoNotifications(
            userTokens,
            `${list.length} nouvelles notifications`,
            list.slice(0, 3).map((n) => n.title).join(' · ') + (list.length > 3 ? '…' : ''),
            { type: 'notifications', count: list.length },
          );
        }
        sent += 1;
      }
      if (sent) console.log(`🔔 Notifications : ${rows.length} notification(s), ${sent} push envoyé(s)`);
    } catch (err) {
      console.error('❌ Notifications (push) :', err.message);
    } finally {
      pushing = false;
    }
  }

  async function due() {
    if (stopped || !active) return;
    try {
      const { data, error } = await supabase.rpc('notify_due_items');
      if (error) throw error;
      if (data) console.log(`⏰ Notifications d'échéance : ${data} créée(s)`);
    } catch (err) {
      console.error('❌ Notifications (échéances) :', err.message);
    }
  }

  const pushTimer = setInterval(dispatch, PUSH_EVERY_MS);
  const dueTimer = setInterval(due, DUE_EVERY_MS);
  // Premier passage peu après le démarrage.
  const first = setTimeout(async () => { await dispatch(); await due(); }, 5_000);
  for (const t of [pushTimer, dueTimer, first]) t.unref?.();

  return () => {
    stopped = true;
    clearInterval(pushTimer);
    clearInterval(dueTimer);
    clearTimeout(first);
  };
}
