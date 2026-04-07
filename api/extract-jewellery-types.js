import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractJewelleryTypeFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\b(?:earrings?|earings?|earing|ear-?rings?)\b/.test(lower)) return 'Earrings';
  if (/\b(?:studs?|hoops?)\b/.test(lower)) return 'Earrings';
  if (/\bbracelets?\b/.test(lower)) return 'Bracelets';
  if (/\bnecklaces?\b/.test(lower)) return 'Necklaces';
  if (/\brings?\b/.test(lower)) return 'Rings';
  return null;
}

function typeCandidates(type) {
  if (type === 'Earrings') return ['Earrings', 'Earring'];
  return [type];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Only process Jewellery rows. This endpoint must never modify Watches.
    const { data: items, error } = await supabase
      .from('products')
      .select('id, model, notes, reference, subcategory, category')
      .eq('category', 'Jewellery');

    if (error) throw error;

    let updated = 0;
    let skipped = 0;
    let constraint_skipped = 0;

    for (const item of items || []) {
      // Extract from model first, then notes
      let jewellery_type = extractJewelleryTypeFromText(item.model);
      if (!jewellery_type) {
        jewellery_type = extractJewelleryTypeFromText(item.notes);
      }
      if (!jewellery_type) {
        jewellery_type = extractJewelleryTypeFromText(item.reference);
      }

      if (jewellery_type) {
        let rowUpdated = false;
        let lastError = null;

        for (const candidate of typeCandidates(jewellery_type)) {
          const { error: updateErr } = await supabase
            .from('products')
            .update({ subcategory: candidate })
            .eq('id', item.id)
            .eq('category', 'Jewellery');

          if (!updateErr) {
            rowUpdated = true;
            break;
          }

          lastError = updateErr;
          const errMsg = String(updateErr.message || '');
          if (!errMsg.includes('products_subcategory_check') && !errMsg.includes('watches_jewellery_type_check')) {
            throw updateErr;
          }
        }

        if (rowUpdated) {
          updated++;
        } else {
          constraint_skipped++;
          console.warn('Skipping row due to subcategory constraint', { id: item.id, attempted: jewellery_type, error: lastError?.message });
        }
      } else {
        skipped++;
      }
    }

    res.status(200).json({
      message: `Successfully extracted jewellery types`,
      updated,
      skipped,
      constraint_skipped,
      total: items?.length || 0,
      scope: 'Jewellery only',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
