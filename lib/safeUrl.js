// Téléchargement d'images pour les rapports, limité au stockage Supabase du projet.
//
// Les adresses viennent du corps des requêtes (images de planning) ou de colonnes
// que les utilisateurs remplissent (photos, logos). Sans contrôle, le serveur
// irait chercher n'importe quelle adresse à leur place — services internes de
// l'hébergeur compris — et en collerait le contenu dans le PDF.
import axios from 'axios';
import sharp from 'sharp';

const MAX_BYTES = 50 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function supabaseOrigin() {
  try { return new URL(process.env.SUPABASE_URL).origin; } catch { return null; }
}

function extraHosts() {
  return (process.env.ALLOWED_ASSET_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** Vrai pour une adresse du stockage Supabase configuré (ou d'un hôte https autorisé explicitement). */
export function isAllowedAssetUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  if (!url.pathname.startsWith('/storage/v1/')) return false;
  if (url.origin === supabaseOrigin()) return true;
  return url.protocol === 'https:' && (!url.port || url.port === '443') && extraHosts().includes(url.hostname.toLowerCase());
}

export const isInlineImage = (value) => typeof value === 'string' && value.length < 30 * 1024 * 1024 && DATA_IMAGE.test(value);

/** Télécharge un fichier du stockage. Refuse toute autre adresse et ne suit aucune redirection. */
export async function fetchAsset(url, { timeout = 30000, maxBytes = MAX_BYTES } = {}) {
  if (!isAllowedAssetUrl(url)) throw new Error('Adresse non autorisée');
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout,
    maxContentLength: maxBytes,
    maxRedirects: 0,
  });
  return Buffer.from(resp.data);
}

/**
 * Image du stockage → data URI redimensionnée (JPEG, ou PNG pour garder la transparence d'un logo).
 * Renvoie `null` si l'adresse est refusée ou l'image illisible : l'appelant ne doit
 * jamais laisser l'adresse d'origine partir vers le moteur de rendu.
 */
export async function assetToDataUri(url, { width = 1200, quality = 72, png = false } = {}) {
  try {
    const input = isInlineImage(url)
      ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
      : await fetchAsset(url);
    const image = sharp(input).rotate().resize({ width, fit: 'inside', withoutEnlargement: true });
    const out = png ? await image.png({ compressionLevel: 9 }).toBuffer() : await image.jpeg({ quality, mozjpeg: true }).toBuffer();
    return `data:image/${png ? 'png' : 'jpeg'};base64,${out.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

let placeholder = null;
/** Vignette grise affichée à la place d'une photo refusée ou illisible. */
export async function placeholderImage() {
  if (!placeholder) {
    const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e7e5e4' } }).jpeg().toBuffer();
    placeholder = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
  return placeholder;
}
