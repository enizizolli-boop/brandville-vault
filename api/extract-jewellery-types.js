import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractJewelleryTypeFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('earring')) return 'Earrings';
  if (lower.includes('bracelet')) return 'Bracelets';
  if (lower.includes('necklace')) return 'Necklaces';
  if (lower.includes('ring')) return 'Rings';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch all jewellery items that don't have a jewellery_type yet
    const { data: items, error } = await supabase
      .from('watches')
      .select('id, model, notes, jewellery_type, category')
      .eq('category', 'Jewellery')
      .is('jewellery_type', null);

    if (error) throw error;

    let updated = 0;
    let skipped = 0;

    for (const item of items || []) {
      // Extract from model first, then notes
      let jewellery_type = extractJewelleryTypeFromText(item.model);
      if (!jewellery_type) {
        jewellery_type = extractJewelleryTypeFromText(item.notes);
      }

      if (jewellery_type) {
        await supabase
          .from('watches')
          .update({ jewellery_type })
          .eq('id', item.id);
        updated++;
      } else {
        skipped++;
      }
    }

    res.status(200).json({
      message: `Successfully extracted jewellery types`,
      updated,
      skipped,
      total: items?.length || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
