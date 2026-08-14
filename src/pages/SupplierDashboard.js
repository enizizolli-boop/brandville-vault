import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Topbar from '../components/Topbar'
import { useExchangeRate } from '../hooks/useExchangeRate'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL
const ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY

const BRANDS = [
  'A. Lange & Söhne', 'Audemars Piguet', 'Blancpain', 'Breguet', 'Breitling',
  'Bulgari', 'Cartier', 'Chopard', 'Girard-Perregaux', 'Grand Seiko',
  'Harry Winston', 'Hermès', 'Hublot', 'IWC', 'Jaeger-LeCoultre', 'Omega',
  'Other', 'Panerai', 'Patek Philippe', 'Piaget', 'Richard Mille', 'Rolex',
  'TAG Heuer', 'Tudor', 'Ulysse Nardin', 'Vacheron Constantin', 'Zenith',
]

const CONDITIONS = ['New', 'Pre-owned', 'Used']
const SCOPES = ['Watch Only', 'With Card', 'With Box', 'Card & Box']

const EMPTY_FORM = {
  brand: '', model: '', reference: '',
  condition: 'Pre-owned', scope_of_delivery: '',
  asking_price: '', asking_price_currency: 'CNY', notes: '',
}

const PRICE_CURRENCIES = [
  { value: 'CNY', label: '¥ CNY' },
  { value: 'HKD', label: 'HK$ HKD' },
  { value: 'EUR', label: '€ EUR' },
  { value: 'USD', label: '$ USD' },
]

const STATUS_CONFIG = {
  draft:          { color: '#94a3b8' },
  pending_review: { color: '#f59e0b' },
  approved:       { color: '#22c55e' },
  rejected:       { color: '#ef4444' },
  sold:           { color: '#6b7280' },
}

const TRANSLATIONS = {
  zh: {
    // Sidebar
    sidebarLabel: '列表',
    myListings: '我的商品',
    approved: '已批准',
    rejected: '已拒绝',
    needHelp: '需要帮助？',
    helpDesc: '我们的团队随时为您服务。',
    contactSupport: '联系客服 →',
    // Form
    back: '← 返回',
    newListing: '新增商品',
    brandLabel: '品牌 *',
    modelLabel: '型号 *',
    referenceLabel: '参考编号 *',
    conditionLabel: '成色',
    scopeLabel: '配件范围 *',
    askingPriceLabel: '要求价格 *',
    notesLabel: '备注',
    photosLabel: '照片 *',
    addPhotos: '+ 添加照片',
    save: '保存',
    saving: '保存中…',
    submitForReview: '提交审核',
    submitting: '提交中…',
    selectBrand: '选择品牌',
    select: '选择',
    modelPlaceholder: '例：Submariner Date',
    refPlaceholder: '例：126610LN',
    notesPlaceholder: '关于商品的任何相关信息...',
    // Validation
    errBrand: '请选择品牌。',
    errModel: '请填写型号。',
    errRef: '请填写参考编号。',
    errScope: '请选择配件范围。',
    errPrice: '请填写要求价格。',
    errPhoto: '请至少上传一张照片。',
    // Detail view
    rejectionReason: '拒绝原因：',
    photoHint: n => n > 1 ? `${n} 张照片 · 点击放大` : '点击放大',
    referenceDetail: '参考编号',
    conditionDetail: '成色',
    scopeDetail: '配件范围',
    askingPriceDetail: '要求价格',
    submittedOn: '提交日期',
    notesDetail: '备注',
    editListing: '编辑商品',
    resubmitForReview: '重新提交审核',
    markAsSold: '标记为已售',
    // List view
    myListingsTitle: '我的商品',
    items: n => `${n} 件商品`,
    newListingBtn: '+ 新增商品',
    searchPlaceholder: '搜索商品…',
    noListings: '暂无商品',
    noListingsDesc: '提交您的第一件商品以开始。',
    edit: '编辑',
    // Tabs / status labels
    tabAll: '全部',
    tabPending: '待审核',
    tabApproved: '已批准',
    tabRejected: '已拒绝',
    tabSold: '已售',
    statusDraft: '草稿',
    statusPending: '待审核',
    statusApproved: '已批准',
    statusRejected: '已拒绝',
    statusSold: '已售',
    // Confirm dialogs
    confirmSubmit: '确认提交此商品供审核？',
    confirmSold: '将此商品标记为已售？这将阻止其发布到网站。',
    // Success messages
    msgSubmitted: '商品已提交审核，代理人将与您联系。',
    msgDraft: '草稿已保存。',
    msgEdited: '商品已提交审核。',
    msgSaved: '更改已保存。',
    // Scope / condition display labels
    scopeLabels: { 'Watch Only': '仅腕表', 'With Card': '含保卡', 'With Box': '含表盒', 'Card & Box': '含保卡和表盒' },
    conditionLabels: { 'New': '全新', 'Pre-owned': '二手', 'Used': '已使用' },
  },
  en: {
    // Sidebar
    sidebarLabel: 'Listings',
    myListings: 'My Listings',
    approved: 'Approved',
    rejected: 'Rejected',
    needHelp: 'Need help?',
    helpDesc: 'Our team is here to help you.',
    contactSupport: 'Contact Support →',
    // Form
    back: '← Back',
    newListing: 'New Listing',
    brandLabel: 'Brand *',
    modelLabel: 'Model *',
    referenceLabel: 'Reference *',
    conditionLabel: 'Condition',
    scopeLabel: 'Scope *',
    askingPriceLabel: 'Asking price *',
    notesLabel: 'Notes',
    photosLabel: 'Photos *',
    addPhotos: '+ Add Photos',
    save: 'Save',
    saving: 'Saving…',
    submitForReview: 'Submit for Review',
    submitting: 'Submitting…',
    selectBrand: 'Select brand',
    select: 'Select',
    modelPlaceholder: 'e.g. Submariner Date',
    refPlaceholder: 'e.g. 126610LN',
    notesPlaceholder: 'Any relevant details about the item...',
    // Validation
    errBrand: 'Brand is required.',
    errModel: 'Model is required.',
    errRef: 'Reference is required.',
    errScope: 'Scope is required.',
    errPrice: 'Asking price is required.',
    errPhoto: 'At least one photo is required.',
    // Detail view
    rejectionReason: 'Rejection reason:',
    photoHint: n => n > 1 ? `${n} photos · click to enlarge` : 'Click to enlarge',
    referenceDetail: 'Reference',
    conditionDetail: 'Condition',
    scopeDetail: 'Scope',
    askingPriceDetail: 'Asking price',
    submittedOn: 'Submitted on',
    notesDetail: 'Notes',
    editListing: 'Edit Listing',
    resubmitForReview: 'Resubmit for Review',
    markAsSold: 'Mark as Sold',
    // List view
    myListingsTitle: 'My Listings',
    items: n => `${n} item${n !== 1 ? 's' : ''}`,
    newListingBtn: '+ New Listing',
    searchPlaceholder: 'Search listings…',
    noListings: 'No listings yet',
    noListingsDesc: 'Submit your first item to get started.',
    edit: 'Edit',
    // Tabs / status labels
    tabAll: 'All',
    tabPending: 'Pending Review',
    tabApproved: 'Approved',
    tabRejected: 'Rejected',
    tabSold: 'Sold',
    statusDraft: 'Draft',
    statusPending: 'Pending Review',
    statusApproved: 'Approved',
    statusRejected: 'Rejected',
    statusSold: 'Sold',
    // Confirm dialogs
    confirmSubmit: 'Submit this listing for agent review?',
    confirmSold: 'Mark this item as sold? This will prevent it from being posted to the website.',
    // Success messages
    msgSubmitted: 'Listing submitted for review. An agent will be in touch.',
    msgDraft: 'Draft saved.',
    msgEdited: 'Listing submitted for review.',
    msgSaved: 'Changes saved.',
    // Scope / condition display labels
    scopeLabels: { 'Watch Only': 'Watch Only', 'With Card': 'With Card', 'With Box': 'With Box', 'Card & Box': 'Card & Box' },
    conditionLabels: { 'New': 'New', 'Pre-owned': 'Pre-owned', 'Used': 'Used' },
  },
}

async function notifyAgents(listing, supplierName) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({
        action: 'supplier_submitted',
        supplier_name: supplierName,
        brand: listing.brand,
        model: listing.model,
        reference: listing.reference,
        asking_price: listing.asking_price,
      }),
    })
  } catch (e) { console.log('Notify error:', e) }
}

const fieldLabel = { color: 'var(--faint)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }
const fieldWrap = { display: 'flex', flexDirection: 'column', gap: 0 }

export default function SupplierDashboard() {
  const { user, profile } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [newImages, setNewImages] = useState([])
  const [newPreviews, setNewPreviews] = useState([])
  const [existingImgs, setExistingImgs] = useState([])
  const [removedImgIds, setRemovedImgIds] = useState([])
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [lightboxIdx, setLightboxIdx] = useState(null)
  const [lightboxImgs, setLightboxImgs] = useState([])
  const [supSearch, setSupSearch] = useState('')
  const [lang, setLang] = useState(() => localStorage.getItem('supplierLang') || 'zh')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 680)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 680)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const t = TRANSLATIONS[lang]

  const switchLang = l => { setLang(l); localStorage.setItem('supplierLang', l) }

  const statusLabel = s => ({
    draft: t.statusDraft,
    pending_review: t.statusPending,
    approved: t.statusApproved,
    rejected: t.statusRejected,
    sold: t.statusSold,
  }[s] || s)

  useEffect(() => { fetchListings() }, [])

  async function fetchListings() {
    setLoading(true)
    const { data } = await supabase
      .from('supplier_listings')
      .select('*, supplier_listing_images(id, url, position), preorder_id')
      .eq('supplier_id', user.id)
      .order('created_at', { ascending: false })
    setListings(data || [])
    setLoading(false)
  }

  function handleNewImages(e) {
    const files = Array.from(e.target.files)
    setNewImages(prev => [...prev, ...files])
    setNewPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
  }

  function removeNewImage(idx) {
    setNewImages(prev => prev.filter((_, i) => i !== idx))
    setNewPreviews(prev => prev.filter((_, i) => i !== idx))
  }

  function removeExistingImage(id) {
    setRemovedImgIds(prev => [...prev, id])
    setExistingImgs(prev => prev.filter(img => img.id !== id))
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setNewImages([])
    setNewPreviews([])
    setExistingImgs([])
    setRemovedImgIds([])
    setError('')
  }

  function enterEdit(listing) {
    setSelected(listing)
    setForm({
      brand: listing.brand || '',
      model: listing.model || '',
      reference: listing.reference || '',
      condition: listing.condition || 'Pre-owned',
      scope_of_delivery: listing.scope_of_delivery || '',
      asking_price: listing.asking_price || '',
      asking_price_currency: listing.asking_price_currency || 'CNY',
      notes: listing.notes || '',
    })
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    setExistingImgs(imgs)
    setRemovedImgIds([])
    setNewImages([])
    setNewPreviews([])
    setError('')
    setView('edit')
  }

  async function handleCreate(submitForReview = false) {
    if (!form.brand) { setError(t.errBrand); return }
    if (!form.model) { setError(t.errModel); return }
    if (!form.reference) { setError(t.errRef); return }
    if (!form.scope_of_delivery) { setError(t.errScope); return }
    if (!form.asking_price) { setError(t.errPrice); return }
    if (newImages.length === 0) { setError(t.errPhoto); return }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const { data: listing, error: lErr } = await supabase
        .from('supplier_listings')
        .insert({
          brand: form.brand,
          model: form.model,
          reference: form.reference || null,
          condition: form.condition || null,
          scope_of_delivery: form.scope_of_delivery || null,
          notes: form.notes || null,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          asking_price_currency: form.asking_price_currency || 'CNY',
          supplier_id: user.id,
          status: submitForReview ? 'pending_review' : 'draft',
        })
        .select()
        .single()
      if (lErr) throw lErr

      await uploadImages(listing.id, newImages, 0)
      if (submitForReview) await notifyAgents(listing, profile?.full_name || 'A supplier')

      setMsg(submitForReview ? t.msgSubmitted : t.msgDraft)
      resetForm()
      setView('list')
      fetchListings()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
      setSubmitting(false)
    }
  }

  async function handleEdit(submitForReview = false) {
    if (!form.brand) { setError(t.errBrand); return }
    if (!form.model) { setError(t.errModel); return }
    if (!form.reference) { setError(t.errRef); return }
    if (!form.scope_of_delivery) { setError(t.errScope); return }
    if (!form.asking_price) { setError(t.errPrice); return }
    const totalImages = existingImgs.length + newImages.length
    if (totalImages === 0) { setError(t.errPhoto); return }

    submitForReview ? setSubmitting(true) : setSaving(true)
    setError('')

    try {
      const newStatus = submitForReview ? 'pending_review' : selected.status
      const { error: uErr } = await supabase
        .from('supplier_listings')
        .update({
          brand: form.brand,
          model: form.model,
          reference: form.reference || null,
          condition: form.condition || null,
          scope_of_delivery: form.scope_of_delivery || null,
          notes: form.notes || null,
          asking_price: form.asking_price ? Number(form.asking_price) : null,
          asking_price_currency: form.asking_price_currency || 'CNY',
          status: newStatus,
        })
        .eq('id', selected.id)
      if (uErr) throw uErr

      for (const id of removedImgIds) {
        await supabase.from('supplier_listing_images').delete().eq('id', id)
      }

      await uploadImages(selected.id, newImages, existingImgs.length)

      if (submitForReview && selected.status !== 'pending_review') {
        await notifyAgents({ ...selected, ...form }, profile?.full_name || 'A supplier')
      }

      setMsg(submitForReview ? t.msgEdited : t.msgSaved)
      resetForm()
      setView('list')
      fetchListings()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
      setSubmitting(false)
    }
  }

  async function uploadImages(listingId, files, startPos) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()
      const path = `supplier_listings/${listingId}/${Date.now()}_${i}.${ext}`
      const { error: upErr } = await supabase.storage.from('watch-images').upload(path, file)
      if (upErr) continue
      const { data: { publicUrl } } = supabase.storage.from('watch-images').getPublicUrl(path)
      await supabase.from('supplier_listing_images').insert({ listing_id: listingId, url: publicUrl, position: startPos + i })
    }
  }

  async function submitDraft(listing) {
    if (!window.confirm(t.confirmSubmit)) return
    const { error } = await supabase
      .from('supplier_listings')
      .update({ status: 'pending_review' })
      .eq('id', listing.id)
    if (error) { alert('Error: ' + error.message); return }
    await notifyAgents(listing, profile?.full_name || 'A supplier')
    fetchListings()
    setSelected(prev => prev?.id === listing.id ? { ...prev, status: 'pending_review' } : prev)
  }

  function getCover(listing) {
    const imgs = (listing.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    return imgs[0]?.url || null
  }

  const { rate: eurToUsd } = useExchangeRate('EUR', 'USD')
  const { rate: usdToCny } = useExchangeRate('USD', 'CNY')
  const { rate: hkdToEur } = useExchangeRate('HKD', 'EUR')

  const PRICE_SYM = { CNY: '¥', HKD: 'HK$', EUR: '€', USD: '$' }
  const toEur = (amount, cur) => {
    if (cur === 'EUR') return null
    if (cur === 'CNY' && usdToCny && eurToUsd) return Math.round(amount / usdToCny / eurToUsd)
    if (cur === 'HKD' && hkdToEur) return Math.round(amount * hkdToEur)
    if (cur === 'USD' && eurToUsd) return Math.round(amount / eurToUsd)
    return null
  }

  const lightboxUrl = lightboxIdx !== null ? lightboxImgs[lightboxIdx] : null
  const openLightbox = (imgs, idx) => { setLightboxImgs(imgs); setLightboxIdx(idx) }
  const closeLightbox = () => { setLightboxIdx(null); setLightboxImgs([]) }
  const lightboxPrev = e => { if (e) e.stopPropagation(); setLightboxIdx(i => (i - 1 + lightboxImgs.length) % lightboxImgs.length) }
  const lightboxNext = e => { if (e) e.stopPropagation(); setLightboxIdx(i => (i + 1) % lightboxImgs.length) }

  useEffect(() => {
    if (lightboxIdx === null) return
    const handler = e => {
      if (e.key === 'ArrowRight') lightboxNext()
      else if (e.key === 'ArrowLeft') lightboxPrev()
      else if (e.key === 'Escape') closeLightbox()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightboxIdx, lightboxImgs])

  const statusCfg = s => STATUS_CONFIG[s] || STATUS_CONFIG.draft
  const canEdit = s => s === 'draft' || s === 'rejected' || s === 'pending_review'

  async function markAsSold(listing, e) {
    if (e) e.stopPropagation()
    if (!window.confirm(t.confirmSold)) return
    const { error } = await supabase.from('supplier_listings').update({ status: 'sold' }).eq('id', listing.id)
    if (error) { alert('Error: ' + error.message); return }
    fetchListings()
    setSelected(prev => prev?.id === listing.id ? { ...prev, status: 'sold' } : prev)
  }

  const fmtDate = d => {
    const dt = new Date(d)
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`
  }

  const filteredListings = listings.filter(l => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false
    if (supSearch) {
      const q = supSearch.toLowerCase()
      if (!`${l.brand} ${l.model} ${l.reference || ''}`.toLowerCase().includes(q)) return false
    }
    return true
  })

  const IconBagSB = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
  const IconCheck = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  const IconX = () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>

  const sbNav = (filter, label, icon) => {
    const isActive = filter === 'all'
      ? (view === 'list' && filterStatus === 'all') || view === 'detail' || view === 'new' || view === 'edit'
      : view === 'list' && filterStatus === filter
    return (
      <button onClick={() => { setFilterStatus(filter); setView('list'); setSelected(null); setMobileMenuOpen(false) }} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 16px',
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        borderLeft: isActive ? '2px solid #b8965a' : '2px solid transparent',
        cursor: 'pointer', textAlign: 'left',
        background: isActive ? '#faf6f0' : 'transparent',
        color: isActive ? '#b8965a' : '#374151',
        fontWeight: isActive ? 600 : 400, fontSize: 14,
        transition: 'background 0.12s, color 0.12s',
      }}>
        <span style={{ color: isActive ? '#b8965a' : '#6b7280', display: 'flex', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </button>
    )
  }

  const langToggle = (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {['zh', 'en'].map(l => (
        <button key={l} onClick={() => switchLang(l)} style={{
          padding: '2px 8px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 11,
          cursor: 'pointer', fontWeight: lang === l ? 700 : 400,
          background: lang === l ? '#1f2937' : '#fff',
          color: lang === l ? '#fff' : '#6b7280',
        }}>{l === 'zh' ? '中文' : 'EN'}</button>
      ))}
    </div>
  )

  const mobileTopBarEl = (
    <div style={{ borderBottom: '1px solid #e5e7eb', background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <button onClick={() => setMobileMenuOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: '#374151' }}>
        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      {langToggle}
    </div>
  )

  const mobileDrawerEl = mobileMenuOpen && (
    <>
      <div onClick={() => setMobileMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200 }} />
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#fff', zIndex: 201, display: 'flex', flexDirection: 'column', padding: '20px 0 16px', overflowY: 'auto', boxShadow: '4px 0 24px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af' }}>{t.sidebarLabel}</div>
          <button onClick={() => setMobileMenuOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center' }}>✕</button>
        </div>
        {sbNav('all', t.myListings, <IconBagSB />)}
        {sbNav('approved', t.approved, <IconCheck />)}
        {sbNav('rejected', t.rejected, <IconX />)}
        <div style={{ flex: 1 }} />
        <div style={{ margin: '16px 12px 0', background: '#fdf8f2', border: '1px solid #e9d8bc', borderRadius: 12, padding: '14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 50, background: '#f5ede0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" fill="none" stroke="#b8965a" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
            </div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.needHelp}</span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>{t.helpDesc}</div>
          <button style={{ width: '100%', fontSize: 13, padding: '8px 0', border: '1px solid #c8a76a', borderRadius: 8, background: 'transparent', color: '#b8965a', cursor: 'pointer', fontWeight: 500 }}>{t.contactSupport}</button>
        </div>
      </div>
    </>
  )

  const sidebarEl = (
    <aside style={{ width: 230, flexShrink: 0, borderRight: '1px solid #e5e7eb', background: '#fff', display: 'flex', flexDirection: 'column', padding: '20px 0 16px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af' }}>{t.sidebarLabel}</div>
        {langToggle}
      </div>
      {sbNav('all', t.myListings, <IconBagSB />)}
      {sbNav('approved', t.approved, <IconCheck />)}
      {sbNav('rejected', t.rejected, <IconX />)}
      <div style={{ flex: 1 }} />
      <div style={{ margin: '16px 12px 0', background: '#fdf8f2', border: '1px solid #e9d8bc', borderRadius: 12, padding: '14px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 32, height: 32, borderRadius: 50, background: '#f5ede0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" fill="none" stroke="#b8965a" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t.needHelp}</span>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.5 }}>{t.helpDesc}</div>
        <button style={{ width: '100%', fontSize: 13, padding: '8px 0', border: '1px solid #c8a76a', borderRadius: 8, background: 'transparent', color: '#b8965a', cursor: 'pointer', fontWeight: 500 }}>{t.contactSupport}</button>
      </div>
    </aside>
  )

  const lightboxEl = lightboxIdx !== null && (
    <div
      onClick={closeLightbox}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, cursor: 'zoom-out' }}
    >
      <img src={lightboxUrl} alt="" style={{ maxWidth: '82vw', maxHeight: '88vh', objectFit: 'contain', borderRadius: 10, userSelect: 'none' }} />
      {lightboxImgs.length > 1 && (
        <button onClick={lightboxPrev} style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
      )}
      {lightboxImgs.length > 1 && (
        <button onClick={lightboxNext} style={{ position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
      )}
      <button onClick={closeLightbox} style={{ position: 'absolute', top: 18, right: 22, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: '50%', width: 38, height: 38, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      {lightboxImgs.length > 1 && (
        <div style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
          {lightboxIdx + 1} / {lightboxImgs.length}
        </div>
      )}
    </div>
  )

  if (view === 'new' || view === 'edit') {
    const isEdit = view === 'edit'
    const isDraft = !isEdit || selected?.status === 'draft' || selected?.status === 'rejected'

    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Topbar />
        {lightboxEl}
        {mobileDrawerEl}
        {isMobile && mobileTopBarEl}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {!isMobile && sidebarEl}
          <main style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '28px 32px' }}>
            <div style={{ maxWidth: 520 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
                <button className="btn" onClick={() => { resetForm(); setView('list') }} style={{ fontSize: 13 }}>{t.back}</button>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                  {isEdit ? `${t.editListing} — ${selected.brand} ${selected.model}` : t.newListing}
                </h2>
              </div>

              {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.brandLabel}</div>
                  <select className="input" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}>
                    <option value="">{t.selectBrand}</option>
                    {BRANDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.modelLabel}</div>
                  <input className="input" placeholder={t.modelPlaceholder} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} />
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.referenceLabel}</div>
                  <input className="input" placeholder={t.refPlaceholder} value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                  <div style={fieldWrap}>
                    <div style={fieldLabel}>{t.conditionLabel}</div>
                    <select className="input" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{t.conditionLabels[c] || c}</option>)}
                    </select>
                  </div>
                  <div style={fieldWrap}>
                    <div style={fieldLabel}>{t.scopeLabel}</div>
                    <select className="input" value={form.scope_of_delivery} onChange={e => setForm(f => ({ ...f, scope_of_delivery: e.target.value }))}>
                      <option value="">{t.select}</option>
                      {SCOPES.map(s => <option key={s} value={s}>{t.scopeLabels[s] || s}</option>)}
                    </select>
                  </div>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.askingPriceLabel}</div>
                  <div style={{ display: 'flex', gap: 8, flexDirection: isMobile ? 'column' : 'row' }}>
                    <select className="input" value={form.asking_price_currency} onChange={e => setForm(f => ({ ...f, asking_price_currency: e.target.value }))} style={{ width: isMobile ? '100%' : 110, flexShrink: 0 }}>
                      {PRICE_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <input className="input" placeholder="0" type="number" inputMode="numeric" value={form.asking_price} onChange={e => setForm(f => ({ ...f, asking_price: e.target.value }))} style={{ flex: 1 }} />
                  </div>
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.notesLabel}</div>
                  <textarea className="input" placeholder={t.notesPlaceholder} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
                </div>

                <div style={fieldWrap}>
                  <div style={fieldLabel}>{t.photosLabel}</div>

                  {existingImgs.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {existingImgs.map(img => (
                        <div key={img.id} style={{ position: 'relative' }}>
                          <img src={img.url} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-light)' }} />
                          <button onClick={() => removeExistingImage(img.id)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {newPreviews.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {newPreviews.map((src, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img src={src} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '2px dashed var(--border-light)', opacity: 0.9 }} />
                          <button onClick={() => removeNewImage(i)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className="btn btn-full" style={{ cursor: 'pointer', textAlign: 'center' }}>
                    {t.addPhotos}
                    <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleNewImages} />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 4, paddingTop: 16, borderTop: '1px solid var(--border-light)', flexDirection: isMobile ? 'column' : 'row' }}>
                  <button className="btn btn-full" onClick={() => isEdit ? handleEdit(false) : handleCreate(false)} disabled={saving || submitting}>
                    {saving ? t.saving : t.save}
                  </button>
                  {isDraft && (
                    <button className="btn btn-dark btn-full" onClick={() => isEdit ? handleEdit(true) : handleCreate(true)} disabled={saving || submitting}>
                      {submitting ? t.submitting : t.submitForReview}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (view === 'detail' && selected) {
    const imgs = (selected.supplier_listing_images || []).sort((a, b) => a.position - b.position)
    const cfg = statusCfg(selected.status)
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <Topbar />
        {lightboxEl}
        {mobileDrawerEl}
        {isMobile && mobileTopBarEl}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {!isMobile && sidebarEl}
          <main style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '28px 32px' }}>
            <div style={{ maxWidth: 680 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                <button className="btn" onClick={() => { setView('list'); setSelected(null) }} style={{ fontSize: 13 }}>{t.back}</button>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>{selected.brand} {selected.model}</h2>
                <div style={{ padding: '4px 12px', borderRadius: 20, background: cfg.color + '20', color: cfg.color, fontSize: 12, fontWeight: 600 }}>{statusLabel(selected.status)}</div>
              </div>

              {selected.status === 'rejected' && selected.rejection_reason && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#ef4444' }}>
                  <strong>{t.rejectionReason}</strong> {selected.rejection_reason}
                </div>
              )}

              {imgs.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, WebkitOverflowScrolling: 'touch' }}>
                    {imgs.map((img, i) => (
                      <img
                        key={i}
                        src={img.url}
                        alt=""
                        onClick={() => openLightbox(imgs.map(x => x.url), i)}
                        style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', cursor: 'zoom-in', flexShrink: 0, transition: 'opacity 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{t.photoHint(imgs.length)}</div>
                </div>
              )}

              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
                {[
                  selected.reference && [t.referenceDetail, selected.reference],
                  selected.condition && [t.conditionDetail, t.conditionLabels[selected.condition] || selected.condition],
                  selected.scope_of_delivery && [t.scopeDetail, t.scopeLabels[selected.scope_of_delivery] || selected.scope_of_delivery],
                  selected.asking_price && (() => {
                    const cur = selected.asking_price_currency || 'CNY'
                    const sym = PRICE_SYM[cur] || ''
                    const eurEq = toEur(selected.asking_price, cur)
                    const display = `${sym}${Number(selected.asking_price).toLocaleString()}${eurEq ? ` (≈ €${eurEq.toLocaleString()})` : ''}`
                    return [t.askingPriceDetail, display]
                  })(),
                  selected.created_at && [t.submittedOn, fmtDate(selected.created_at)],
                ].filter(Boolean).map(([label, value], i, arr) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none', fontSize: 14 }}>
                    <span style={{ color: '#6b7280' }}>{label}</span>
                    <span style={{ fontWeight: label === t.askingPriceDetail ? 600 : 400 }}>{value}</span>
                  </div>
                ))}
              </div>

              {selected.notes && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{t.notesDetail}</div>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', fontSize: 14, color: '#4b5563', lineHeight: 1.6 }}>
                    {selected.notes}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {canEdit(selected.status) && (
                  <button className="btn btn-dark" onClick={() => enterEdit(selected)}>{t.editListing}</button>
                )}
                {selected.status === 'draft' && (
                  <button className="btn" onClick={() => submitDraft(selected)}>{t.submitForReview}</button>
                )}
                {selected.status === 'rejected' && (
                  <button className="btn" onClick={() => submitDraft(selected)}>{t.resubmitForReview}</button>
                )}
                {(selected.status === 'approved' || selected.status === 'pending_review') && (
                  <button
                    onClick={() => markAsSold(selected)}
                    style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 14, cursor: 'pointer', fontWeight: 500 }}
                  >
                    {t.markAsSold}
                  </button>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  const countByStatus = s => listings.filter(l => l.status === s).length
  const TABS = [
    { key: 'all', label: t.tabAll, count: listings.length },
    { key: 'pending_review', label: t.tabPending, count: countByStatus('pending_review') },
    { key: 'approved', label: t.tabApproved, count: countByStatus('approved') },
    { key: 'rejected', label: t.tabRejected, count: countByStatus('rejected') },
    { key: 'sold', label: t.tabSold, count: countByStatus('sold') },
  ].filter(tab => tab.key === 'all' || tab.count > 0)

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Topbar />
      {lightboxEl}
      {mobileDrawerEl}
      {isMobile && mobileTopBarEl}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {!isMobile && sidebarEl}
        <main style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '28px 32px' }}>
          <div style={{ maxWidth: 700 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: isMobile ? 18 : 20, fontWeight: 700 }}>{t.myListingsTitle}</h2>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{t.items(listings.length)}</div>
              </div>
              <button className="btn btn-dark" onClick={() => { resetForm(); setView('new') }} style={{ flexShrink: 0 }}>{t.newListingBtn}</button>
            </div>

            {msg && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '11px 16px', marginBottom: 20, fontSize: 14, color: '#15803d' }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                {msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
              {TABS.map(tab => {
                const active = filterStatus === tab.key
                return (
                  <button key={tab.key} onClick={() => setFilterStatus(tab.key)} style={{
                    padding: '6px 16px', borderRadius: 20, border: '1px solid #e5e7eb',
                    background: active ? '#1f2937' : '#fff',
                    color: active ? '#fff' : '#374151',
                    fontSize: 13, fontWeight: active ? 600 : 400,
                    cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                  }}>
                    {tab.label} {tab.count}
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  value={supSearch}
                  onChange={e => setSupSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  style={{ width: '100%', padding: '8px 12px 8px 36px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
            ) : filteredListings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 24px', color: '#9ca3af', fontSize: 14 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151', fontSize: 15 }}>{t.noListings}</div>
                <div>{t.noListingsDesc}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredListings.map(listing => {
                  const cover = getCover(listing)
                  const cfg = statusCfg(listing.status)
                  return (
                    <div
                      key={listing.id}
                      style={{
                        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 14,
                        padding: '14px 16px',
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderLeft: `3px solid ${cfg.color}`,
                        borderRadius: 12,
                        flexWrap: isMobile ? 'wrap' : 'nowrap',
                      }}
                    >
                      <div
                        onClick={() => { setSelected(listing); setView('detail') }}
                        style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer', minWidth: 0 }}
                      >
                        {cover
                          ? <img src={cover} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                          : <div style={{ width: 60, height: 60, borderRadius: 8, background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 22 }}>📷</div>
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {listing.brand} {listing.model}
                          </div>
                          {listing.reference && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>Ref. {listing.reference}</div>}
                          <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                            {listing.asking_price && (() => {
                              const cur = listing.asking_price_currency || 'CNY'
                              const sym = PRICE_SYM[cur] || ''
                              const eurEq = toEur(listing.asking_price, cur)
                              return (
                                <span style={{ fontSize: 13, fontWeight: 600 }}>
                                  {sym}{Number(listing.asking_price).toLocaleString()}
                                  {eurEq && <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>(≈ €{eurEq.toLocaleString()})</span>}
                                </span>
                              )
                            })()}
                            <span style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(listing.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: isMobile ? 'center' : 'flex-end', gap: 8, flexShrink: 0, width: isMobile ? '100%' : 'auto', flexWrap: 'wrap' }}>
                        <div style={{ padding: '3px 10px', borderRadius: 20, background: cfg.color + '18', color: cfg.color, fontSize: 11, fontWeight: 600 }}>{statusLabel(listing.status)}</div>
                        {canEdit(listing.status) && (
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: 11, padding: '3px 12px' }}
                            onClick={e => { e.stopPropagation(); enterEdit(listing) }}
                          >
                            {t.edit}
                          </button>
                        )}
                        {(listing.status === 'approved' || listing.status === 'pending_review') && (
                          <button
                            className="btn btn-sm"
                            style={{ fontSize: 11, padding: '3px 12px', color: '#6b7280', borderColor: '#d1d5db' }}
                            onClick={e => markAsSold(listing, e)}
                          >
                            {t.markAsSold}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
