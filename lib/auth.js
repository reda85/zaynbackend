// Authentification et contrôle d'accès des routes.
//
// Le backend parle à Supabase avec la clé « service role », qui contourne
// toutes les RLS. Chaque route doit donc vérifier elle-même QUI appelle et
// s'il a le droit d'agir sur le projet ou le plan visé.
import { createClient } from '@supabase/supabase-js';
import { supabase as admin } from './supabase.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Client Supabase agissant au nom de l'appelant : ses requêtes passent par les RLS. */
export function userClient(token) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * Exige un jeton Supabase valide (`Authorization: Bearer <access_token>`).
 * La vérification est déléguée à Supabase Auth : elle reste correcte après une
 * rotation des clés de signature, et un compte supprimé ou banni est refusé.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = header.slice(7).trim();
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: data.user.id, email: data.user.email };
    req.token = token;
    req.db = userClient(token);
    next();
  } catch (e) {
    console.error('requireAuth:', e.message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const read = (req, path) => path.split('.').reduce((o, k) => o?.[k], req);

/** Vrai si l'appelant voit ce projet à travers les RLS (membre de son organisation). */
export async function canAccessProject(req, projectId) {
  if (!projectId) return false;
  const { data } = await req.db.from('projects').select('id').eq('id', projectId).maybeSingle();
  return Boolean(data);
}

/** Renvoie le plan (id, project_id) si l'appelant y a accès, sinon null. */
export async function accessiblePlan(req, planId) {
  if (!planId) return null;
  const { data } = await req.db.from('plans').select('id, project_id').eq('id', planId).maybeSingle();
  return data ?? null;
}

/** Middleware : `requireProjectMember('body.projectId')`. À placer après requireAuth. */
export function requireProjectMember(paramPath) {
  return async function (req, res, next) {
    const projectId = read(req, paramPath);
    if (!projectId) return res.status(400).json({ error: `Missing projectId (expected at ${paramPath})` });
    if (!(await canAccessProject(req, projectId))) {
      return res.status(403).json({ error: 'Access denied: not a member of this project' });
    }
    next();
  };
}

/** Middleware : `requirePlanAccess('params.planId')`. Renseigne `req.plan`. */
export function requirePlanAccess(paramPath) {
  return async function (req, res, next) {
    const planId = read(req, paramPath);
    if (!planId) return res.status(400).json({ error: `Missing planId (expected at ${paramPath})` });
    const plan = await accessiblePlan(req, planId);
    if (!plan) return res.status(403).json({ error: 'Access denied: plan not found or not accessible' });
    req.plan = plan;
    next();
  };
}

/**
 * Parmi des identifiants d'authentification, ne garde que ceux des membres que
 * l'appelant a le droit de voir (même organisation), pour les notifications.
 */
export async function visibleAuthIds(req, authIds) {
  const ids = [...new Set((authIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data } = await req.db.from('members').select('auth_id').in('auth_id', ids);
  return (data || []).map((m) => m.auth_id).filter(Boolean);
}

/**
 * Parmi des identifiants de lignes d'un projet, ne garde que ceux que l'appelant
 * voit à travers les RLS. Les rapports sont produits avec la clé service : sans
 * ce filtre, un invité obtiendrait par le rapport des pins qu'il ne peut pas lire.
 */
export async function visibleIds(req, table, projectId, ids) {
  const wanted = [...new Set((ids || []).filter(Boolean).map(String))];
  const visible = new Set();
  for (let i = 0; i < wanted.length; i += 100) {
    const { data, error } = await req.db
      .from(table).select('id').eq('project_id', projectId).in('id', wanted.slice(i, i + 100));
    if (error) throw error;
    for (const row of data || []) visible.add(String(row.id));
  }
  return wanted.filter((id) => visible.has(id));
}

/**
 * Vrai si l'appelant a le droit de modifier ce projet (ni simple lecteur, ni invité).
 * Avant la migration qui crée `can_edit_project`, on s'en tient à l'accès au projet.
 */
export async function canEditProject(req, projectId) {
  if (!projectId) return false;
  const { data, error } = await req.db.rpc('can_edit_project', { proj_id: projectId });
  // PGRST202 : la fonction n'existe pas encore dans la base. Toute autre erreur
  // est un refus : un incident passager ne doit pas élargir les droits.
  if (error) return error.code === 'PGRST202' ? canAccessProject(req, projectId) : false;
  return data === true;
}

/** Middleware : comme requireProjectMember, mais exige le droit de modification. */
export function requireProjectEditor(paramPath) {
  return async function (req, res, next) {
    const projectId = read(req, paramPath);
    if (!projectId) return res.status(400).json({ error: `Missing projectId (expected at ${paramPath})` });
    if (!(await canEditProject(req, projectId))) {
      return res.status(403).json({ error: 'Access denied: you cannot modify this project' });
    }
    next();
  };
}

/** Protection par identifiant / mot de passe (tableau de bord des files d'attente). */
export function basicAuth(user, password) {
  return function (req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [u, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
      if (u === user && rest.join(':') === password) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="queues"');
    res.status(401).send('Authentication required');
  };
}
