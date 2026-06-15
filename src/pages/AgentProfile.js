import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useNav } from '../hooks/useNav'
import { supabase } from '../lib/supabase'
import { toSlug } from '../lib/slug'
import Topbar from '../components/Topbar'

function getThumb(item) {
  const imgs = [...(item.preorder_images || [])].sort((a, b) => a.position - b.position)
  return imgs[0]?.url || null
}

export default function AgentProfile() {
  const { agentId } = useParams()
  const navigate = useNav()

  const [agentName, setAgentName] = useState('')
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    supabase.from('profiles').select('full_name').eq('id', agentId).single()
      .then(({ data }) => setAgentName(data?.full_name || 'Agent'))
  }, [agentId])

  const fetchListings = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('preorders')
      .select('*, preorder_images(url, position)')
      .eq('posted_by', agentId)
      .order('created_at', { ascending: false })
    if (dateFrom) q = q.gte('created_at', dateFrom)
    if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
    const { data } = await q
    setListings(data || [])
    setLoading(false)
  }, [agentId, dateFrom, dateTo])

  useEffect(() => { fetchListings() }, [fetchListings])

  const filtered = listings.filter(item => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      item.brand?.toLowerCase().includes(s) ||
      item.model?.toLowerCase().includes(s) ||
      item.reference?.toLowerCase().includes(s)
    )
  })

  const available = filtered.filter(i => i.status === 'available').length
  const sold = filtered.filter(i => i.status === 'sold').length

  return (
    <div>
      <Topbar />
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <button className="btn btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 24 }}>← Back</button>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700 }}>{agentName || '...'}</h1>
          <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#666' }}>
            <span><strong style={{ color: '#111' }}>{filtered.length}</strong> total</span>
            <span><strong style={{ color: '#388e3c' }}>{available}</strong> available</span>
            <span><strong style={{ color: '#c62828' }}>{sold}</strong> sold</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search brand, model, reference..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: '#888' }}>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: '#888' }}>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
          </div>
          {(dateFrom || dateTo || search) && (
            <button className="btn btn-sm" onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>No listings found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {filtered.map(item => {
              const thumb = getThumb(item)
              return (
                <div
                  key={item.id}
                  onClick={() => navigate(`/catalog/${toSlug(item)}`)}
                  style={{ cursor: 'pointer', border: '1px solid #eee', borderRadius: 10, overflow: 'hidden', background: '#fff', transition: 'box-shadow 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{ height: 160, background: '#f5f5f5', overflow: 'hidden' }}>
                    {thumb
                      ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc', fontSize: 12 }}>No image</div>
                    }
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{item.brand}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.model}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>€{item.price_eur?.toLocaleString()}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                        background: item.status === 'available' ? '#e8f5e9' : item.status === 'sold' ? '#fce4ec' : '#fff3e0',
                        color: item.status === 'available' ? '#388e3c' : item.status === 'sold' ? '#c62828' : '#e65100',
                      }}>
                        {item.status?.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 5 }}>
                      {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
