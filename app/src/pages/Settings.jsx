import React, { useState, useEffect } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { api } from '../lib/api.js'
import { useToastMethods } from '../components/Toast.jsx'
import { useBreakpoint } from '../lib/hooks.js'
import LimitUpgradeModal from '../components/LimitUpgradeModal.jsx'

// ── Dark design tokens ────────────────────────────────────────────────────
const S = {
  section: {
    background: '#111130',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 14,
  },
  label: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.5px', color: '#7A7AAA', marginBottom: 8, display: 'block',
  },
  input: {
    width: '100%', padding: '10px 14px',
    border: '1px solid rgba(255,255,255,.07)', borderRadius: 10,
    fontSize: 14, outline: 'none',
    background: '#161625', color: '#EDEDFF',
    marginBottom: 12, boxSizing: 'border-box',
  },
  btn: (primary, danger) => ({
    padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
    border: danger ? '1px solid rgba(226,75,74,0.3)' : primary ? 'none' : '1px solid rgba(255,255,255,.07)',
    background: danger ? 'rgba(226,75,74,0.1)' : primary ? '#6366F1' : '#161625',
    color: danger ? '#E24B4A' : primary ? '#fff' : '#8888AA',
  }),
  row: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
}

function fmtCapacityGb(gb) {
  if (gb === null || gb === undefined || !isFinite(gb)) return '—'
  const rounded = Math.round(gb)
  const value = Math.abs(gb - rounded) < 0.01 ? rounded : parseFloat(gb.toFixed(1))
  return `${value} GB`
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function PersonIcon() {
  return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><circle cx="7" cy="4.5" r="2.5" stroke="#8888AA" strokeWidth="1.3"/><path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="#8888AA" strokeWidth="1.3" strokeLinecap="round"/></svg>
}
function TeamIcon() {
  return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><circle cx="5" cy="4.5" r="2" stroke="#8888AA" strokeWidth="1.3"/><circle cx="9.5" cy="4.5" r="2" stroke="#8888AA" strokeWidth="1.3"/><path d="M1 12c0-2.2 1.8-3.5 4-3.5m8 0c0-2.2-1.8-3.5-4-3.5" stroke="#8888AA" strokeWidth="1.3" strokeLinecap="round"/></svg>
}

function BillingTab() {
  const toast = useToastMethods()
  const { isMobile } = useBreakpoint()
  const [wallet,       setWallet]       = useState(null)
  const [meter,        setMeter]        = useState(null)
  const [breakdown,    setBreakdown]    = useState(null)
  const [mandate,      setMandate]      = useState(undefined) // undefined = loading, null = none
  const [loading,      setLoading]      = useState(true)
  const [setupLimit,   setSetupLimit]   = useState('')
  const [setupBusy,    setSetupBusy]    = useState(false)
  const [invoices,     setInvoices]     = useState([])
  const [recovery,     setRecovery]     = useState(null)
  const [payBusy,      setPayBusy]      = useState(false)
  const [pendingUrl,   setPendingUrl]   = useState(null)
  const [cancelBusy,   setCancelBusy]   = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  useEffect(() => {
    if (!document.getElementById('rzp-script')) {
      const s = document.createElement('script')
      s.id  = 'rzp-script'
      s.src = 'https://checkout.razorpay.com/v1/checkout.js'
      document.head.appendChild(s)
    }
    Promise.all([api.wallet(), api.storageMeter(), api.storageBreakdown()])
      .then(([w, m, b]) => { setWallet(w); setMeter(m); setBreakdown(b) })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
    api.getMandate()
      .then(r => setMandate(r?.mandate || null))
      .catch(() => setMandate(null))
    api.billingHistory()
      .then(r => setInvoices(r?.invoices || []))
      .catch(() => {})
    api.billingRecovery()
      .then(r => { if (r?.inRecovery) setRecovery(r) })
      .catch(() => {})
  }, [])

  async function payNowHandler() {
    if (!window.Razorpay) { toast.error('Payment script not loaded — please refresh'); return }
    setPayBusy(true)
    try {
      const order = await api.initiatePayNow()
      const rzp = new window.Razorpay({
        key:         order.keyId,
        order_id:    order.orderId,
        amount:      Math.round(order.amount * 100),
        currency:    order.currency || 'INR',
        name:        'DataDrop',
        description: `Payment for ${recovery?.month || 'outstanding invoice'}`,
        prefill:     order.prefill || {},
        handler: async (response) => {
          try {
            await api.confirmPayNow({
              invoiceId:          order.invoiceId,
              razorpayPaymentId:  response.razorpay_payment_id,
              razorpayOrderId:    response.razorpay_order_id,
              razorpaySignature:  response.razorpay_signature,
            })
            toast.success('Payment successful! Account restored.')
            setRecovery(null)
            const r = await api.billingHistory()
            setInvoices(r?.invoices || [])
          } catch (e) {
            toast.error(e.message || 'Payment verification failed')
          }
        },
        modal: { ondismiss: () => setPayBusy(false) },
      })
      rzp.open()
    } catch (e) {
      toast.error(e.message || 'Could not initiate payment')
      setPayBusy(false)
    }
  }

  async function setupAutoPayHandler() {
    const limit = Math.floor(parseFloat(setupLimit))
    if (!limit || limit < 49) { toast.error('Minimum monthly limit is ₹49'); return }
    setSetupBusy(true)
    try {
      const order = await api.createMandate({ protectionLimit: limit })
      const rzp = new window.Razorpay({
        key:         order.key,
        order_id:    order.orderId,
        customer_id: order.customerId,
        recurring:   true,
        amount:      order.amount,
        currency:    order.currency,
        name:        'DataDrop',
        description: `AutoPay setup — ₹${limit}/month max`,
        prefill:     { ...order.prefill },
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay via UPI',
                instruments: [{ method: 'upi', flows: ['vpa', 'qr', 'intent'] }],
              },
            },
            sequence: ['block.upi'],
            preferences: { show_default_blocks: false },
          },
        },
        handler: async (response) => {
          try {
            await api.confirmMandate({
              razorpayOrderId:   response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            setMandate({ status: 'active', protection_limit: limit })
            setWallet(w => ({ ...w, limit, balance: (w?.balance || 0) + 1 }))
            toast.success('AutoPay mandate activated')
          } catch (e) {
            toast.error(e.message)
          }
          setSetupBusy(false)
        },
        modal: {
          ondismiss: async () => {
            await api.cancelMandate().catch(() => {})
            setMandate(null)
            setSetupBusy(false)
            toast.info('AutoPay setup cancelled')
          },
        },
      })
      // Inject a stylesheet rule to zoom the Razorpay modal 1.35x so the QR
      // is large enough to scan. A stylesheet !important rule beats Razorpay's
      // own inline style overrides. zoom (vs transform:scale) resizes the
      // actual layout box so all buttons stay clickable at their visual positions.
      if (!document.getElementById('rzp-zoom-style')) {
        const s = document.createElement('style')
        s.id = 'rzp-zoom-style'
        s.textContent = '.razorpay-checkout-frame { zoom: 1.35 !important; }'
        document.head.appendChild(s)
      }
      rzp.open()
    } catch (e) {
      toast.error(e.message)
      setSetupBusy(false)
    }
  }

  async function cancelAutoPayHandler() {
    setConfirmCancel(false)
    setCancelBusy(true)
    try {
      await api.cancelMandate()
      setMandate(null)
      toast.success('AutoPay mandate cancelled')
    } catch (e) {
      toast.error(e.message)
    }
    setCancelBusy(false)
  }

  if (loading) return (
    <div style={{ color:'#7A7AAA', padding:40, textAlign:'center', fontSize:14 }}>Loading…</div>
  )

  const pct = Math.min(100, meter?.usedPercent || 0)
  const barColor = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#F59E0B' : '#6366F1'

  // ── Storage capacity meter values ─────────────────────────
  const billSoFar    = meter?.bill_so_far || 0
  const limitRs      = (mandate?.status === 'active' ? mandate.protection_limit : null) || wallet?.limit || 0
  // Use API-provided capacity (from shared helper) — fall back to inline only if API is old
  const capacityGb   = meter?.capacity_gb ?? (limitRs > 0 ? limitRs / 1.49 : null)
  const storageGb    = meter?.storageGb || 0
  const availableGb  = capacityGb !== null ? Math.max(0, capacityGb - storageGb) : null
  const storagePct   = capacityGb ? Math.min(100, (storageGb / capacityGb) * 100) : 0
  const storageColor = storagePct >= 100 ? '#E24B4A' : storagePct >= 95 ? '#F97316' : storagePct >= 80 ? '#F59E0B' : '#6366F1'
  const nextBillDate = (() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1)
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
  })()

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <h3 style={{ fontSize:16, fontWeight:700, color:'#EDEDFF' }}>Billing &amp; Usage</h3>
        {meter?.status === 'trial' && mandate?.status !== 'active' && (
          <span style={{ fontSize:11, fontWeight:700, background:'rgba(245,158,11,0.15)',
                          color:'#F59E0B', padding:'3px 10px', borderRadius:100,
                          border:'1px solid rgba(245,158,11,0.3)' }}>
            Free Trial
          </span>
        )}
        {mandate?.status === 'active' && (
          <span style={{ fontSize:11, fontWeight:700, background:'rgba(0,194,124,0.1)',
                          color:'#00C27C', padding:'3px 10px', borderRadius:100,
                          border:'1px solid rgba(0,194,124,0.25)' }}>
            AutoPay Active
          </span>
        )}
      </div>

      {/* ── Storage capacity meter ───────────────────────────── */}
      {limitRs > 0 && (
        <div style={{ ...S.section, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#EDEDFF', marginBottom:16 }}>Storage Capacity</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap:16, marginBottom:18 }}>
            <div>
              <div style={S.label}>Storage Used</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color:'#EDEDFF' }}>
                {storageGb.toFixed(1)} GB
              </div>
              {capacityGb && <div style={{ fontSize:11, color:'#7A7AAA', marginTop:2 }}>of {fmtCapacityGb(capacityGb)}</div>}
            </div>
            <div>
              <div style={S.label}>Available</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700,
                             color: availableGb !== null && availableGb < capacityGb * 0.1 ? '#E24B4A' : '#00C27C' }}>
                {availableGb !== null ? `${availableGb.toFixed(1)} GB` : '—'}
              </div>
            </div>
            <div>
              <div style={S.label}>Monthly Limit</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color:'#EDEDFF' }}>
                ₹{limitRs.toFixed(0)}
              </div>
              {capacityGb && <div style={{ fontSize:11, color:'#7A7AAA', marginTop:2 }}>{fmtCapacityGb(capacityGb)} capacity</div>}
            </div>
            <div>
              <div style={S.label}>Current Charges</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700, color:'#EDEDFF' }}>
                ₹{billSoFar.toFixed(2)}
              </div>
              <div style={{ fontSize:11, color:'#7A7AAA', marginTop:2 }}>next bill {nextBillDate}</div>
            </div>
          </div>
          {/* Storage progress bar */}
          <div style={{ marginBottom:6 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#7A7AAA', marginBottom:5 }}>
              <span>{storageGb.toFixed(1)} GB used</span>
              <span style={{ color: storageColor, fontWeight:600 }}>{storagePct.toFixed(0)}%</span>
              <span>{capacityGb ? `${fmtCapacityGb(capacityGb)} max` : ''}</span>
            </div>
            <div style={{ height:6, background:'rgba(255,255,255,.06)', borderRadius:99 }}>
              <div style={{ width:`${storagePct}%`, height:'100%', background:storageColor,
                             borderRadius:99, transition:'width .4s' }} />
            </div>
          </div>
          {storagePct >= 80 && (
            <div style={{ marginTop:10, padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:500,
                           background: storagePct >= 100 ? 'rgba(226,75,74,0.08)' : 'rgba(245,158,11,0.08)',
                           border: `1px solid ${storagePct >= 100 ? 'rgba(226,75,74,0.2)' : 'rgba(245,158,11,0.2)'}`,
                           color: storagePct >= 100 ? '#E24B4A' : '#F59E0B' }}>
              {storagePct >= 100
                ? 'Storage capacity reached — uploads paused. Increase your limit or delete files to continue.'
                : `${storagePct.toFixed(0)}% of capacity used — uploads will pause when full.`}
            </div>
          )}
          <div style={{ fontSize:11, color:'#7A7AAA', marginTop:10, lineHeight:1.6 }}>
            ₹1.49/GB/mo · ₹{limitRs.toFixed(0)}/mo limit = {fmtCapacityGb(capacityGb)} max storage · bill calculated by the second
          </div>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:14, marginBottom:14, alignItems:'start' }}>

        {/* LEFT: storage breakdown */}
        {breakdown && (
          <div style={S.section}>
            <div style={{ fontSize:13, fontWeight:600, color:'#EDEDFF', marginBottom:12 }}>Storage breakdown</div>

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                           padding:'9px 0', borderBottom:'1px solid #1E1E32', fontSize:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <PersonIcon />
                <span style={{ fontWeight:600, color:'#EDEDFF' }}>Personal</span>
              </div>
              <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                <span style={{ color:'#8888AA', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(breakdown.personal?.storageBytes || 0)}</span>
                <span style={{ fontWeight:700, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EDEDFF' }}>
                  ₹{(breakdown.personal?.estimatedCost || 0).toFixed(2)}
                </span>
              </div>
            </div>

            {(breakdown.teams || []).map(t => (
              <div key={t.teamId} style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                                            padding:'9px 0', borderBottom:'1px solid #1E1E32', fontSize:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                  <TeamIcon />
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, color:'#EDEDFF', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.teamName}</div>
                    <div style={{ color:'#7A7AAA', fontSize:10 }}>{t.fileCount} file{t.fileCount !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:12, alignItems:'center', flexShrink:0 }}>
                  <span style={{ color:'#8888AA', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(t.storageBytes || 0)}</span>
                  <span style={{ fontWeight:700, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EDEDFF' }}>
                    ₹{(t.estimatedCost || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                           paddingTop:12, borderTop:'1px solid #252540', marginTop:2 }}>
              <span style={{ fontWeight:700, fontSize:13, color:'#EDEDFF' }}>Total this month</span>
              <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                <span style={{ color:'#8888AA', fontWeight:600, fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(breakdown.total?.storageBytes || 0)}</span>
                <span style={{ fontWeight:800, fontSize:15, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EDEDFF' }}>
                  ₹{(breakdown.total?.estimatedCost || 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div style={{ fontSize:10, color:'#7A7AAA', marginTop:8 }}>Minimum ₹1 when any file is stored</div>
          </div>
        )}

            {/* RIGHT: AutoPay — 3 states */}
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={S.section}>
                <div style={{ fontSize:11, color:'#7A7AAA', fontWeight:700, textTransform:'uppercase',
                               letterSpacing:'.5px', marginBottom:16 }}>
                  {mandate?.status === 'active' ? 'AutoPay Plan' : 'Set up Monthly AutoPay'}
                </div>

                {/* STATE 1: No mandate — setup form */}
                {!mandate && (
                  <>
                    {meter?.status === 'trial' ? (
                      <div style={{ fontSize:13, color:'#8888AA', lineHeight:1.7, marginBottom:18 }}>
                        You're on a free trial.{' '}
                        <strong style={{ color:'#EDEDFF' }}>Set up AutoPay before your trial ends</strong>{' '}
                        so your files stay accessible. Set a monthly limit — you'll{' '}
                        <strong style={{ color:'#EDEDFF' }}>never be charged more</strong> than that.
                      </div>
                    ) : (
                      <div style={{ fontSize:13, color:'#8888AA', lineHeight:1.7, marginBottom:18 }}>
                        Set up UPI AutoPay to automatically deduct your monthly bill at month end.
                        Set a protection limit — you will <strong style={{ color:'#EDEDFF' }}>never be charged more</strong> than this amount.
                      </div>
                    )}
                    <div style={{ fontSize:11, color:'#7A7AAA', fontWeight:600, marginBottom:6, textTransform:'uppercase', letterSpacing:'.4px' }}>
                      Monthly limit (₹)
                    </div>
                    <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                      {[149, 299, 499, 999].map(v => {
                        const sel = setupLimit === String(v)
                        return (
                          <button key={v} onClick={() => setSetupLimit(String(v))}
                            style={{ padding:'7px 14px', border:`1px solid ${sel ? '#6366F1' : 'rgba(255,255,255,.07)'}`,
                                       borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                                       background:sel ? 'rgba(99,102,241,0.15)' : '#161625',
                                       color:sel ? '#6366F1' : '#8888AA',
                                       fontFamily:"'JetBrains Mono',monospace" }}>
                            ₹{v}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display:'flex', gap:8, marginBottom:6 }}>
                      <input type="number" placeholder="Custom amount (₹)" value={setupLimit}
                        min="49" step="1"
                        onChange={e => setSetupLimit(e.target.value ? String(Math.floor(Number(e.target.value))) : '')}
                        style={{ flex:1, padding:'9px 12px', border:'1px solid #1E1E32', borderRadius:10,
                                   fontSize:13, outline:'none', background:'#161625', color:'#EDEDFF',
                                   fontFamily:"'JetBrains Mono',monospace" }} />
                    </div>
                    {setupLimit && parseFloat(setupLimit) >= 49 && (
                      <div style={{ fontSize:11, color:'#7A7AAA', marginBottom:12 }}>
                        ≈ store up to{' '}
                        <span style={{ color:'#8888AA' }}>
                          {(() => {
                            const gb = Math.floor(parseFloat(setupLimit)) / 1.49
                            return `~${gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)} GB`
                          })()}
                        </span>
                      </div>
                    )}
                    <button onClick={setupAutoPayHandler} disabled={setupBusy}
                      style={{ width:'100%', padding:'11px 0', background:'#6366F1', color:'#fff',
                                 border:'none', borderRadius:10, fontWeight:600, fontSize:14,
                                 cursor: setupBusy ? 'not-allowed' : 'pointer', opacity: setupBusy ? .7 : 1 }}>
                      {setupBusy ? 'Setting up…' : 'Set up AutoPay →'}
                    </button>
                    <div style={{ fontSize:11, color:'#7A7AAA', marginTop:10, lineHeight:1.6 }}>
                      You'll be redirected to approve the UPI mandate in your bank app. Nothing is charged during setup.
                    </div>
                  </>
                )}

                {/* STATE 2: Mandate created, awaiting UPI approval */}
                {mandate?.status === 'created' && (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:'#F59E0B', flexShrink:0 }} />
                      <span style={{ fontSize:13, color:'#F59E0B', fontWeight:600 }}>Awaiting UPI approval</span>
                    </div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:28, fontWeight:700,
                                   color:'#EDEDFF', marginBottom:4 }}>
                      ₹{(mandate.protection_limit || 0).toFixed(2)}
                      <span style={{ fontSize:13, fontWeight:400, color:'#7A7AAA', fontFamily:'Inter,sans-serif', marginLeft:4 }}>/mo limit</span>
                    </div>
                    <div style={{ fontSize:13, color:'#8888AA', lineHeight:1.7, marginBottom:16 }}>
                      Open your UPI app or bank app to approve the AutoPay mandate. AutoPay activates once you approve.
                    </div>
                    {(pendingUrl || mandate.short_url) && (
                      <a href={pendingUrl || mandate.short_url} target="_blank" rel="noopener noreferrer"
                        style={{ display:'block', textAlign:'center', padding:'10px 0', background:'rgba(245,158,11,0.1)',
                                   border:'1px solid rgba(245,158,11,0.3)', borderRadius:10, color:'#F59E0B',
                                   fontWeight:600, fontSize:13, textDecoration:'none', marginBottom:10 }}>
                        Re-open approval link ↗
                      </a>
                    )}
                    {confirmCancel ? (
                      <div style={{ background:'rgba(226,75,74,0.07)', border:'1px solid rgba(226,75,74,0.2)',
                                    borderRadius:10, padding:'14px 16px' }}>
                        <div style={{ fontSize:13, color:'#EDEDFF', fontWeight:600, marginBottom:6 }}>Cancel AutoPay setup?</div>
                        <div style={{ fontSize:12, color:'#8888AA', marginBottom:14, lineHeight:1.6 }}>
                          Your monthly bill will no longer be auto-deducted.
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button onClick={cancelAutoPayHandler} disabled={cancelBusy}
                            style={{ flex:1, padding:'9px 0', background:'rgba(226,75,74,0.15)',
                                     border:'1px solid rgba(226,75,74,0.3)', borderRadius:8,
                                     color:'#E24B4A', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                            {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
                          </button>
                          <button onClick={() => setConfirmCancel(false)}
                            style={{ flex:1, padding:'9px 0', background:'transparent',
                                     border:'1px solid rgba(255,255,255,.07)', borderRadius:8,
                                     color:'#8888AA', fontWeight:500, fontSize:13, cursor:'pointer' }}>
                            Keep setup
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmCancel(true)} disabled={cancelBusy}
                        style={{ width:'100%', padding:'9px 0', background:'transparent', border:'1px solid rgba(226,75,74,0.2)',
                                   borderRadius:10, color:'#E24B4A', fontWeight:500, fontSize:13,
                                   cursor: cancelBusy ? 'not-allowed' : 'pointer', opacity: cancelBusy ? .6 : 1 }}>
                        {cancelBusy ? 'Cancelling…' : 'Cancel setup'}
                      </button>
                    )}
                  </>
                )}

                {/* STATE 3: Mandate active */}
                {mandate?.status === 'active' && (
                  <>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:'#00C27C', flexShrink:0 }} />
                      <span style={{ fontSize:13, color:'#00C27C', fontWeight:600 }}>UPI AutoPay active</span>
                    </div>
                    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:32, fontWeight:700,
                                   color:'#EDEDFF', marginBottom:4 }}>
                      ₹{(mandate.protection_limit || 0).toFixed(2)}
                      <span style={{ fontSize:13, fontWeight:400, color:'#7A7AAA', fontFamily:'Inter,sans-serif', marginLeft:4 }}>/mo limit</span>
                    </div>
                    {capacityGb && (
                      <div style={{ fontSize:12, color:'#8888AA', marginBottom:12 }}>
                        Store up to <span style={{ color:'#EDEDFF', fontWeight:600 }}>
                          {fmtCapacityGb(capacityGb)}
                        </span> at this limit
                      </div>
                    )}
                    <div style={{ fontSize:12, color:'#7A7AAA', lineHeight:1.65, marginBottom:16 }}>
                      Your exact monthly bill is deducted automatically at month end via UPI. You will never be charged more than your set limit.
                    </div>
                    {confirmCancel ? (
                      <div style={{ background:'rgba(226,75,74,0.07)', border:'1px solid rgba(226,75,74,0.2)',
                                    borderRadius:10, padding:'14px 16px' }}>
                        <div style={{ fontSize:13, color:'#EDEDFF', fontWeight:600, marginBottom:6 }}>Cancel UPI AutoPay?</div>
                        <div style={{ fontSize:12, color:'#8888AA', marginBottom:14, lineHeight:1.6 }}>
                          Your monthly bill will no longer be auto-deducted at month end.
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          <button onClick={cancelAutoPayHandler} disabled={cancelBusy}
                            style={{ flex:1, padding:'9px 0', background:'rgba(226,75,74,0.15)',
                                     border:'1px solid rgba(226,75,74,0.3)', borderRadius:8,
                                     color:'#E24B4A', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                            {cancelBusy ? 'Cancelling…' : 'Yes, cancel'}
                          </button>
                          <button onClick={() => setConfirmCancel(false)}
                            style={{ flex:1, padding:'9px 0', background:'transparent',
                                     border:'1px solid rgba(255,255,255,.07)', borderRadius:8,
                                     color:'#8888AA', fontWeight:500, fontSize:13, cursor:'pointer' }}>
                            Keep AutoPay
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => setShowUpgradeModal(true)} disabled={cancelBusy}
                          style={{ width:'100%', padding:'9px 0', background:'rgba(99,102,241,0.1)',
                                     border:'1px solid rgba(99,102,241,0.3)', borderRadius:10,
                                     color:'#A5B4FC', fontWeight:600, fontSize:13,
                                     cursor: cancelBusy ? 'not-allowed' : 'pointer',
                                     opacity: cancelBusy ? .6 : 1, marginBottom:8 }}>
                          Change Limit
                        </button>
                        <button onClick={() => setConfirmCancel(true)} disabled={cancelBusy}
                          style={{ width:'100%', padding:'9px 0', background:'transparent',
                                     border:'1px solid rgba(226,75,74,0.2)', borderRadius:10,
                                     color:'#E24B4A', fontWeight:500, fontSize:13,
                                     cursor: cancelBusy ? 'not-allowed' : 'pointer', opacity: cancelBusy ? .6 : 1 }}>
                          {cancelBusy ? 'Cancelling…' : 'Cancel AutoPay'}
                        </button>
                      </>
                    )}
                  </>
                )}
                {showUpgradeModal && mandate?.status === 'active' && (
                  <LimitUpgradeModal
                    currentLimit={mandate.protection_limit}
                    onSuccess={(newLimit) => {
                      setMandate(m => ({ ...m, protection_limit: newLimit }))
                      setWallet(w => ({ ...w, limit: newLimit }))
                      api.storageMeter().then(m => setMeter(m)).catch(() => {})
                      setShowUpgradeModal(false)
                    }}
                    onClose={() => setShowUpgradeModal(false)}
                  />
                )}
              </div>
            </div>
          </div>

      {/* Payment Recovery Banner */}
      {recovery?.inRecovery && (
        <div style={{ ...S.section, background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.25)', borderRadius:12 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:'#fca5a5', marginBottom:6 }}>
                ⚠ Payment Required — ₹{recovery.amountDue?.toFixed(2)}
              </div>
              <div style={{ fontSize:13, color:'#f87171', lineHeight:1.5 }}>
                AutoPay could not be completed for <strong style={{ color:'#fca5a5' }}>{recovery.month}</strong>.
                File uploads and write operations are paused.
              </div>
              <div style={{ fontSize:12, color:'#ef4444', marginTop:6, fontWeight:600 }}>
                {recovery.daysRemaining > 0
                  ? `${recovery.daysRemaining} day${recovery.daysRemaining !== 1 ? 's' : ''} remaining before permanent data deletion.`
                  : 'Data deletion is imminent — pay immediately.'}
              </div>
              {recovery.retryCount > 0 && (
                <div style={{ fontSize:11, color:'#7A7AAA', marginTop:4 }}>
                  AutoPay retried {recovery.retryCount} time{recovery.retryCount !== 1 ? 's' : ''}.
                  {recovery.nextRetryAt && ` Next retry: ${new Date(recovery.nextRetryAt).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}.`}
                </div>
              )}
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0 }}>
              <button
                onClick={payNowHandler}
                disabled={payBusy}
                style={{ padding:'8px 18px', background:'#DC2626', color:'#fff', border:'none',
                           borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap',
                           opacity: payBusy ? 0.6 : 1 }}>
                {payBusy ? 'Opening…' : `Pay ₹${recovery.amountDue?.toFixed(2)} Now`}
              </button>
            </div>
          </div>
          <div style={{ fontSize:11, color:'#7A7AAA', marginTop:10, lineHeight:1.6 }}>
            <strong style={{ color:'#8888AA' }}>What you can still do:</strong> Browse files · Download · Preview · Stream · Delete files · Change AutoPay<br/>
            <strong style={{ color:'#8888AA' }}>What is paused:</strong> Upload files · Create folders · Rename · Move · Share files · Restore versions
          </div>
        </div>
      )}

      {/* Billing History */}
      {invoices.length > 0 && (
        <div style={S.section}>
          <div style={{ fontSize:14, fontWeight:600, color:'#EDEDFF', marginBottom:16 }}>Invoice History</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid #1E1E32' }}>
                  {['Month','Storage (GB)','Amount','Method','Status','Date'].map(h => (
                    <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'#7A7AAA', fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:'.5px', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => (
                  <React.Fragment key={inv.id}>
                    <tr style={{ borderBottom:'1px solid rgba(255,255,255,.04)' }}>
                      <td style={{ padding:'9px 10px', color:'#8888AA', fontFamily:"'JetBrains Mono',monospace" }}>{inv.month}</td>
                      <td style={{ padding:'9px 10px', color:'#7A7AAA', fontFamily:"'JetBrains Mono',monospace" }}>{inv.actual_usage_gb?.toFixed(3) ?? '—'}</td>
                      <td style={{ padding:'9px 10px', fontWeight:700, color:'#EDEDFF', fontFamily:"'JetBrains Mono',monospace" }}>₹{inv.total_charged?.toFixed(2)}</td>
                      <td style={{ padding:'9px 10px', color:'#8888AA', textTransform:'uppercase', fontSize:10 }}>{inv.payment_method || '—'}</td>
                      <td style={{ padding:'9px 10px' }}>
                        <span style={{
                          display:'inline-block', padding:'2px 7px', borderRadius:99, fontSize:10, fontWeight:700,
                          background: inv.status === 'paid' ? 'rgba(0,194,124,.12)' : 'rgba(220,38,38,.12)',
                          color:      inv.status === 'paid' ? '#00C27C' : '#E24B4A',
                          border:     inv.status === 'paid' ? '1px solid rgba(0,194,124,.25)' : '1px solid rgba(220,38,38,.25)',
                        }}>
                          {inv.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding:'9px 10px', color:'#7A7AAA', fontSize:11 }}>
                        {inv.paid_at ? new Date(inv.paid_at).toLocaleDateString('en-IN', { year:'numeric', month:'short', day:'numeric' }) : '—'}
                      </td>
                    </tr>
                    {inv.status === 'failed' && (
                      <tr style={{ borderBottom:'1px solid rgba(255,255,255,.04)', background:'rgba(220,38,38,.04)' }}>
                        <td colSpan={6} style={{ padding:'6px 10px 10px', fontSize:11, color:'#f87171' }}>
                          {inv.last_failure_reason && <span>Reason: {inv.last_failure_reason} · </span>}
                          {inv.retry_count > 0 && <span>Retried {inv.retry_count}× · </span>}
                          {inv.days_remaining != null && <span style={{ fontWeight:700 }}>{inv.days_remaining} day{inv.days_remaining !== 1 ? 's' : ''} remaining · </span>}
                          {inv.next_retry_at && <span>Next retry: {new Date(inv.next_retry_at).toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' })}</span>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings({ onClose }) {
  const { user }  = useUser()
  const { signOut } = useClerk()
  const toast = useToastMethods()
  const { isMobile } = useBreakpoint()

  const [me,          setMe]          = useState(null)
  const [displayName, setDisplayName] = useState('')
  const [username,    setUsername]    = useState('')
  const [saving,      setSaving]      = useState(false)
  const [tab,         setTab]         = useState('profile')

  useEffect(() => {
    api.me().then(d => {
      setMe(d.user)
      setDisplayName(d.user.display_name || '')
      setUsername(d.user.username || '')
    })
  }, [])

  async function saveProfile() {
    setSaving(true)
    try {
      await api.updateMe({ displayName, username })
      toast.success('Profile updated')
    } catch (e) {
      toast.error(e.message)
    }
    setSaving(false)
  }

  async function toggleAdFree() {
    try {
      if (me.adfree_active) {
        await api.cancelAdFree()
        setMe(m => ({ ...m, adfree_active: false }))
        toast.info('Ad-free video cancelled')
      } else {
        await api.subscribeAdFree()
        setMe(m => ({ ...m, adfree_active: true }))
        toast.success('Ad-free video activated — ₹49/month locked')
      }
    } catch (e) {
      toast.error(e.message)
    }
  }

  async function deleteAccount() {
    const confirmed = window.confirm(
      'This will permanently delete ALL your files and close your account.\nThis cannot be undone.\n\nClick OK to continue.'
    )
    if (!confirmed) return
    try {
      await api.deleteAccount()
      toast.info('Account deletion scheduled. You will receive a confirmation email.')
      setTimeout(() => signOut(), 2000)
    } catch (e) {
      toast.error(e.message)
    }
  }

  const TABS = [['profile', 'Profile'], ['billing', 'Billing'], ['danger', 'Danger zone']]

  return (
    <div style={{ maxWidth: isMobile ? '100%' : 820, width:'100%' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <h2 style={{ fontSize:20, fontWeight:700, color:'#EDEDFF',
                      fontFamily:"'Space Grotesk',sans-serif" }}>Settings</h2>
        {onClose && (
          <button onClick={onClose}
            style={{ background:'#161625', border:'1px solid #1E1E32', borderRadius:8,
                       width:32, height:32, fontSize:18, cursor:'pointer', color:'#8888AA',
                       display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:2, marginBottom:24, background:'#0D0D22',
                     borderRadius:10, padding:3, border:'1px solid #1E1E32' }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex:1, padding:'8px 0', border:'none', borderRadius:8, fontSize:13,
                      cursor:'pointer', fontWeight:tab === k ? 600 : 400,
                      background:tab === k ? '#161625' : 'transparent',
                      color:tab === k ? '#EDEDFF' : '#8888AA',
                      boxShadow:tab === k ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                      transition:'background .15s, color .15s' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {tab === 'profile' && me && (
        <>
          <div style={S.section}>
            <div style={{ marginBottom:16 }}>
              <label style={S.label}>Display name</label>
              <input style={S.input} value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name" />
              <label style={S.label}>Username</label>
              <div style={{ position:'relative', marginBottom:12 }}>
                <span style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)',
                                color:'#7A7AAA', fontSize:14, pointerEvents:'none', marginBottom:0 }}>@</span>
                <input style={{ ...S.input, paddingLeft:28, marginBottom:0 }}
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username" />
              </div>
              {me.username_changed_at && (
                <div style={{ fontSize:12, color:'#7A7AAA', marginBottom:16 }}>
                  Username can be changed again after{' '}
                  {new Date(me.username_changed_at + 90 * 86400000).toLocaleDateString('en-IN')}
                </div>
              )}
            </div>
            <button onClick={saveProfile} disabled={saving}
              style={{ ...S.btn(true), opacity: saving ? .7 : 1 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>

        </>
      )}

      {/* Billing tab */}
      {tab === 'billing' && <BillingTab />}

      {/* Danger zone */}
      {tab === 'danger' && (
        <div style={{ ...S.section, borderColor:'rgba(226,75,74,0.25)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#E24B4A', marginBottom:8 }}>Delete account</div>
          <div style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.7 }}>
            All your files will be permanently deleted. This cannot be undone.
          </div>
          <button onClick={deleteAccount} style={S.btn(false, true)}>
            Delete my account and all data
          </button>
        </div>
      )}
    </div>
  )
}
