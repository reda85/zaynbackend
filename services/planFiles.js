// Fichiers d'un plan dans le stockage (PDF, aperçus, tuiles).
import { supabase } from '../lib/supabase.js';

const BUCKET = 'project-plans';

/**
 * Supprime du stockage le PDF, les aperçus et les tuiles d'un plan.
 *
 * - Rien n'est supprimé tant qu'un autre plan pointe sur les mêmes fichiers
 *   (anciens imports sous le même nom, plan d'exemple partagé entre projets).
 * - Si `plan.project_id` est fourni, seuls les fichiers rangés dans le dossier
 *   de ce projet sont concernés.
 * - Un champ absent (`file_url`, `tiles_path`) est simplement ignoré : on peut
 *   ainsi ne supprimer que les tuiles d'une ancienne version.
 */
export async function removePlanFiles(plan) {
  const bucket = supabase.storage.from(BUCKET);
  const own = (value) => Boolean(value) && (!plan.project_id || String(value).startsWith(`${plan.project_id}/`));
  const shared = async (column, value) => {
    const { count, error } = await supabase
      .from('plans').select('id', { count: 'exact', head: true }).eq(column, value).neq('id', plan.id);
    return Boolean(error) || (count ?? 0) > 0;      // dans le doute, on garde
  };

  if (own(plan.file_url) && !(await shared('file_url', plan.file_url))) {
    await bucket.remove([plan.file_url]);
  }
  if (!own(plan.tiles_path) || (await shared('tiles_path', plan.tiles_path))) return;

  // tiles_path = <projet>/tiles/<base>-page1 ; les autres pages suivent le même modèle.
  const pages = Math.max(1, Number(plan.pages) || 1);
  for (let page = 1; page <= pages; page++) {
    const pagePath = plan.tiles_path.replace(/-page1$/, `-page${page}`);
    const preview = pagePath.replace('/tiles/', '/previews/') + '.png';
    await bucket.remove([preview, `${pagePath}.dzi`]).catch(() => {});

    const root = `${pagePath}_files`;
    const { data: levels } = await bucket.list(root, { limit: 100 });
    for (const level of levels || []) {
      for (;;) {
        const { data: tiles } = await bucket.list(`${root}/${level.name}`, { limit: 1000 });
        if (!tiles || tiles.length === 0) break;
        const { error } = await bucket.remove(tiles.map((t) => `${root}/${level.name}/${t.name}`));
        if (error || tiles.length < 1000) break;
      }
    }
    // Fichiers posés directement à la racine des tuiles (vips-properties.xml).
    if (levels?.length) await bucket.remove(levels.map((l) => `${root}/${l.name}`)).catch(() => {});
  }
}
