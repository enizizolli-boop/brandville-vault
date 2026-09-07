import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Missing token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // --- Validate token ---
    const { data: tokenRow, error: tokenError } = await supabase
      .from('preview_tokens')
      .select('id, label, expires_at, revoked')
      .eq('token', token)
      .single()

    if (tokenError || !tokenRow) {
      return new Response(
        JSON.stringify({ error: 'Invalid link. Please request a new one.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (tokenRow.revoked) {
      return new Response(
        JSON.stringify({ error: 'This link has been revoked.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This link has expired. Please request a new one.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // --- Fetch available products ---
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, brand, model, reference, condition, price_eur, scope_of_delivery, category, notes, year')
      .eq('status', 'available')
      .order('brand', { ascending: true })
      .order('model', { ascending: true })

    if (productsError) throw productsError

    // --- Attach ALL images per product (ordered by position) ---
    let result = products || []
    if (result.length > 0) {
      const ids = result.map((p: any) => p.id)
      const BATCH = 100
      const batches: Promise<any>[] = []
      for (let i = 0; i < ids.length; i += BATCH) {
        batches.push(
          supabase
            .from('product_images')
            .select('product_id, url, position')
            .in('product_id', ids.slice(i, i + BATCH))
            .order('position', { ascending: true })
        )
      }
      const batchResults = await Promise.all(batches)
      const allImages: Record<string, string[]> = {}
      for (const { data } of batchResults) {
        for (const img of (data || [])) {
          if (!allImages[img.product_id]) allImages[img.product_id] = []
          allImages[img.product_id].push(img.url)
        }
      }
      result = result.map((p: any) => ({
        ...p,
        image_url: allImages[p.id]?.[0] || null,
        images: allImages[p.id] || [],
      }))
    }

    return new Response(
      JSON.stringify({
        label: tokenRow.label,
        expires_at: tokenRow.expires_at,
        count: result.length,
        products: result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
