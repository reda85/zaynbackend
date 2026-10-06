// backend/routes/tiles.js
import express from 'express';
const router = express.Router();
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePlanAccess } from '../lib/auth.js';

/**
 * GET /api/tiles/:planId/:z/:tile
 * Servir une tile depuis Supabase Storage.
 * Sans authentification : les visionneuses chargent les tuiles comme des
 * images (pas d'en-tête possible) et le bucket « project-plans » est public.
 * Format du tile: x_y.png (exemple: 0_0.png, 1_2.png)
 */
router.get('/:planId/:z/:tile', async (req, res) => {
  try {
    const { planId, z, tile } = req.params;
    
    // Format DeepZoom strict : niveau numérique, tuile « x_y.ext ».
    if (!/^\d+$/.test(z) || !/^\d+_\d+\.(png|jpe?g)$/.test(tile)) {
      return res.status(400).json({ error: 'Invalid tile format' });
    }
    
    // Récupérer le tiles_path depuis la base de données
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('tiles_path, project_id')
      .eq('id', planId)
      .single();
    
    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    // Construire le chemin de la tile
    // Format DeepZoom : {tiles_path}_files/{z}/{x_y.png}
    const tilePath = `${plan.tiles_path}_files/${z}/${tile}`;
    
    // Récupérer la tile depuis Supabase Storage
    const { data, error } = await supabase.storage
      .from('project-plans')
      .download(tilePath);
    
    if (error) {
      console.error(`❌ Tile not found: ${tilePath}`, error);
      return res.status(404).json({ error: 'Tile not found' });
    }
    
    // Convertir le Blob en Buffer
    const buffer = Buffer.from(await data.arrayBuffer());
    
    // Définir les headers de cache
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable', // Cache 1 an
      'Content-Length': buffer.length,
    });
    
    res.send(buffer);
    
  } catch (error) {
    console.error('❌ Error serving tile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/plans/:planId
 * Récupérer les métadonnées d'un plan
 */
router.get('/plans/:planId', requireAuth, requirePlanAccess('params.planId'), async (req, res) => {
  try {
    const { planId } = req.params;
    
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('❌ Error fetching plan:', error);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

export default router;