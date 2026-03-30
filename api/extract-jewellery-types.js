import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractJewelleryTypeFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\bearrings?\b/.test(lower)) return 'Earrings';
  if (/\bbracelets?\b/.test(lower)) return 'Bracelets';
  if (/\bnecklaces?\b/.test(lower)) return 'Necklaces';
  if (/\brings?\b/.test(lower)) return 'Rings';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch records that may need type extraction or recategorization
    const { data: items, error } = await supabase
      .from('watches')
      .select('id, model, notes, jewellery_type, category')
      .in('category', ['Jewellery', 'Watches']);

    if (error) throw error;

    let updated = 0;
    let skipped = 0;
    let recategorized = 0;

    for (const item of items || []) {
      // Extract from model first, then notes
      let jewellery_type = extractJewelleryTypeFromText(item.model);
      if (!jewellery_type) {
        jewellery_type = extractJewelleryTypeFromText(item.notes);
      }

      if (jewellery_type) {
        const patch = {
          jewellery_type,
          category: 'Jewellery',
        };
        await supabase
          .from('watches')
          .update(patch)
          .eq('id', item.id);
        updated++;
        if (item.category !== 'Jewellery') recategorized++;
      } else {
        skipped++;
      }
    }

    res.status(200).json({
      message: `Successfully extracted jewellery types`,
      updated,
      recategorized,
      skipped,
      total: items?.length || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
