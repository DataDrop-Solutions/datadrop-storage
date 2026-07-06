import React, { useState, useEffect } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { api } from '../lib/api.js'
import { useToastMethods } from '../components/Toast.jsx'
import { useBreakpoint } from '../lib/hooks.js'

// ── Dark design tokens ────────────────────────────────────────────────────
const S = {
  section: {
    background: '#11111E',
    border: '1px solid #1E1E32',
    borderRadius: 12,
    padding: 24,
    marginBottom: 14,
  },
  label: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.5px', color: '#55556A', marginBottom: 8, display: 'block',
  },
  input: {
    width: '100%', padding: '10px 14px',
    border: '1px solid #1E1E32', borderRadius: 10,
    fontSize: 14, outline: 'none',
    background: '#161625', color: '#EEEEF8',
    marginBottom: 12, boxSizing: 'border-box',
  },
  btn: (primary, danger) => ({
    padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
    border: danger ? '1px solid rgba(226,75,74,0.3)' : primary ? 'none' : '1px solid #1E1E32',
    background: danger ? 'rgba(226,75,74,0.1)' : primary ? '#5B5EF4' : '#161625',
    color: danger ? '#E24B4A' : primary ? '#fff' : '#8888AA',
  }),
  row: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
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
  const [wallet,    setWallet]    = useState(null)
  const [meter,     setMeter]     = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [amount,    setAmount]    = useState('')
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    if (!document.getElementById('rzp-script')) {
      const s  = document.createElement('script')
      s.id  = 'rzp-script'
      s.src = 'https://checkout.razorpay.com/v1/checkout.js'
      document.head.appendChild(s)
    }
    Promise.all([api.wallet(), api.storageMeter(), api.storageBreakdown()])
      .then(([w, m, b]) => { setWallet(w); setMeter(m); setBreakdown(b) })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function topUp() {
    const n = parseFloat(amount)
    if (!n || n < 10) { toast.error('Minimum top-up is ₹10'); return }
    try {
      const order = await api.initiateTopup({ amount: n })
      const rzp   = new window.Razorpay({
        key: order.key, order_id: order.orderId,
        amount: order.amount, currency: 'INR',
        name: 'DataDrop', description: 'Wallet top-up',
        prefill: order.prefill,
        handler: async (response) => {
          await api.confirmTopup({
            razorpayOrderId:   response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
            amount: order.amount,
          })
          const [updatedWallet, updatedMeter] = await Promise.all([api.wallet(), api.storageMeter()])
          setWallet(updatedWallet)
          setMeter(updatedMeter)
          setAmount('')
          toast.success(`₹${n} added to wallet`)
        },
        modal: { ondismiss: () => toast.info('Payment cancelled') },
      })
      rzp.open()
    } catch (e) { toast.error(e.message) }
  }

  if (loading) return (
    <div style={{ color:'#55556A', padding:40, textAlign:'center', fontSize:14 }}>Loading…</div>
  )

  const pct = Math.min(100, meter?.usedPercent || 0)
  const barColor = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#F59E0B' : '#5B5EF4'

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <h3 style={{ fontSize:16, fontWeight:700, color:'#EEEEF8' }}>Billing &amp; Usage</h3>
        {meter?.status === 'trial' && (
          <span style={{ fontSize:11, fontWeight:700, background:'rgba(245,158,11,0.15)',
                          color:'#F59E0B', padding:'3px 10px', borderRadius:100,
                          border:'1px solid rgba(245,158,11,0.3)' }}>
            Free Trial
          </span>
        )}
        {meter?.status === 'active' && (
          <span style={{ fontSize:11, fontWeight:700, background:'rgba(0,194,124,0.1)',
                          color:'#00C27C', padding:'3px 10px', borderRadius:100,
                          border:'1px solid rgba(0,194,124,0.25)' }}>
            Pay as you go
          </span>
        )}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:14, marginBottom:14, alignItems:'start' }}>

        {/* LEFT: usage + breakdown */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {meter && (
            <div style={S.section}>
              <div style={{ fontSize:11, color:'#55556A', marginBottom:4, fontWeight:700,
                             textTransform:'uppercase', letterSpacing:'.5px' }}>Current usage</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:700,
                             letterSpacing:'-0.5px', marginBottom:6, color:'#EEEEF8' }}>
                {fmtBytes(meter.storageBytes)}
                {meter.maxGb && (
                  <span style={{ fontSize:12, fontWeight:400, color:'#55556A', marginLeft:8, fontFamily:'Inter,sans-serif' }}>
                    of {meter.maxGb} GB
                  </span>
                )}
              </div>
              <div style={{ height:3, background:'#1E1E32', borderRadius:99, marginBottom:10 }}>
                <div style={{ width:`${pct}%`, height:'100%', background:barColor,
                               borderRadius:99, transition:'width .3s' }} />
              </div>
              <div style={{ fontSize:12, color:'#8888AA', display:'flex', flexDirection:'column', gap:4, lineHeight:1.6 }}>
                {meter.bill_so_far != null && (
                  <span>Charged so far: <strong style={{ color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>₹{(meter.bill_so_far || 0).toFixed(2)}</strong></span>
                )}
                {meter.projected_bill != null && (
                  <span>Projected this month: <strong style={{ color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>₹{(meter.projected_bill || 0).toFixed(2)}</strong></span>
                )}
                {meter.bill_so_far == null && (
                  <span>Est. this month: <strong style={{ color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>
                    ₹{meter.storageGb > 0 && meter.storageGb < 0.5
                      ? `${Math.max(1, meter.estimatedCost || 0).toFixed(2)} (min ₹1)`
                      : (meter.estimatedCost || 0).toFixed(2)}
                  </strong></span>
                )}
                {meter.status === 'trial' && meter.trialEndsAt && (
                  <span style={{ color:'#F59E0B', fontWeight:600 }}>
                    Trial expires {new Date(meter.trialEndsAt).toLocaleDateString('en-IN',
                      { day:'numeric', month:'short', year:'numeric' })}
                  </span>
                )}
              </div>
            </div>
          )}

          {breakdown && (
            <div style={S.section}>
              <div style={{ fontSize:13, fontWeight:600, color:'#EEEEF8', marginBottom:12 }}>Storage breakdown</div>

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                             padding:'9px 0', borderBottom:'1px solid #1E1E32', fontSize:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <PersonIcon />
                  <span style={{ fontWeight:600, color:'#EEEEF8' }}>Personal</span>
                </div>
                <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                  <span style={{ color:'#8888AA', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(breakdown.personal?.storageBytes || 0)}</span>
                  <span style={{ fontWeight:700, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EEEEF8' }}>
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
                      <div style={{ fontWeight:600, color:'#EEEEF8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.teamName}</div>
                      <div style={{ color:'#55556A', fontSize:10 }}>{t.fileCount} file{t.fileCount !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:12, alignItems:'center', flexShrink:0 }}>
                    <span style={{ color:'#8888AA', fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(t.storageBytes || 0)}</span>
                    <span style={{ fontWeight:700, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EEEEF8' }}>
                      ₹{(t.estimatedCost || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                             paddingTop:12, borderTop:'1px solid #252540', marginTop:2 }}>
                <span style={{ fontWeight:700, fontSize:13, color:'#EEEEF8' }}>Total this month</span>
                <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                  <span style={{ color:'#8888AA', fontWeight:600, fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>{fmtBytes(breakdown.total?.storageBytes || 0)}</span>
                  <span style={{ fontWeight:800, fontSize:15, minWidth:52, textAlign:'right', fontFamily:"'JetBrains Mono',monospace", color:'#EEEEF8' }}>
                    ₹{(breakdown.total?.estimatedCost || 0).toFixed(2)}
                  </span>
                </div>
              </div>
              <div style={{ fontSize:10, color:'#55556A', marginTop:8 }}>
                Minimum ₹1 when any file is stored
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: wallet + top-up */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={S.section}>
            <div style={{ fontSize:11, color:'#55556A', marginBottom:4, fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px' }}>Wallet balance</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:32, fontWeight:700,
                           letterSpacing:'-1px', marginBottom:6, color:'#00C27C' }}>
              ₹{wallet?.balance?.toFixed(2) || '0.00'}
            </div>
            <div style={{ fontSize:12, color:'#8888AA', display:'flex', flexDirection:'column', gap:3 }}>
              <span>Monthly limit: <span style={{ color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>₹{wallet?.limit?.toFixed(2) || '0.00'}</span></span>
              <span>Est. this month: <span style={{ color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>₹{wallet?.estimatedCost?.toFixed(2) || '0.00'}</span></span>
            </div>
          </div>

          <div style={S.section}>
            <div style={{ fontSize:13, fontWeight:600, color:'#EEEEF8', marginBottom:12 }}>Top up wallet</div>
            <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
              {[149, 299, 499, 999].map(v => {
                const sel = amount === String(v)
                return (
                  <button key={v} onClick={() => setAmount(String(v))}
                    style={{ padding:'7px 14px', border:`1px solid ${sel ? '#5B5EF4' : '#1E1E32'}`,
                               borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:600,
                               background:sel ? 'rgba(91,94,244,0.15)' : '#161625',
                               color:sel ? '#5B5EF4' : '#8888AA',
                               fontFamily:"'JetBrains Mono',monospace",
                               transition:'all .15s' }}>
                    ₹{v}
                  </button>
                )
              })}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input type="number" placeholder="Custom (₹)" value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{ flex:1, padding:'9px 12px', border:'1px solid #1E1E32', borderRadius:10,
                           fontSize:13, outline:'none', background:'#161625', color:'#EEEEF8',
                           fontFamily:"'JetBrains Mono',monospace" }} />
              <button onClick={topUp}
                style={{ background:'#5B5EF4', color:'#fff', border:'none', borderRadius:10,
                           padding:'9px 18px', fontWeight:600, cursor:'pointer', fontSize:13,
                           transition:'background .15s' }}
                onMouseEnter={e => e.currentTarget.style.background = '#4A4DDE'}
                onMouseLeave={e => e.currentTarget.style.background = '#5B5EF4'}>
                Pay
              </button>
            </div>
          </div>
        </div>
      </div>

      {wallet?.history?.length > 0 && (
        <div style={S.section}>
          <div style={{ fontSize:14, fontWeight:600, color:'#EEEEF8', marginBottom:16 }}>Billing history</div>
          {wallet.history.map((b, i) => (
            <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0',
                                   borderBottom: i < wallet.history.length - 1 ? '1px solid #1E1E32' : 'none',
                                   fontSize:13 }}>
              <span style={{ color:'#8888AA' }}>{b.month}</span>
              <span style={{ color:'#55556A', fontFamily:"'JetBrains Mono',monospace" }}>{b.actual_usage_gb?.toFixed(3)} GB</span>
              <span style={{ fontWeight:600, color:'#EEEEF8', fontFamily:"'JetBrains Mono',monospace" }}>₹{b.total_charged?.toFixed(2)}</span>
              <span style={{ color: b.status === 'paid' ? '#00C27C' : '#E24B4A', fontSize:11, fontWeight:600 }}>
                {b.status.toUpperCase()}
              </span>
            </div>
          ))}
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
        <h2 style={{ fontSize:20, fontWeight:700, color:'#EEEEF8',
                      fontFamily:"'Space Grotesk',sans-serif" }}>Settings</h2>
        {onClose && (
          <button onClick={onClose}
            style={{ background:'#161625', border:'1px solid #1E1E32', borderRadius:8,
                       width:32, height:32, fontSize:18, cursor:'pointer', color:'#8888AA',
                       display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:2, marginBottom:24, background:'#0F0F1A',
                     borderRadius:10, padding:3, border:'1px solid #1E1E32' }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex:1, padding:'8px 0', border:'none', borderRadius:8, fontSize:13,
                      cursor:'pointer', fontWeight:tab === k ? 600 : 400,
                      background:tab === k ? '#161625' : 'transparent',
                      color:tab === k ? '#EEEEF8' : '#8888AA',
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
                                color:'#55556A', fontSize:14, pointerEvents:'none', marginBottom:0 }}>@</span>
                <input style={{ ...S.input, paddingLeft:28, marginBottom:0 }}
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username" />
              </div>
              {me.username_changed_at && (
                <div style={{ fontSize:12, color:'#55556A', marginBottom:16 }}>
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
            Any remaining wallet balance above ₹50 will be refunded within 7 business days.
          </div>
          <button onClick={deleteAccount} style={S.btn(false, true)}>
            Delete my account and all data
          </button>
        </div>
      )}
    </div>
  )
}
