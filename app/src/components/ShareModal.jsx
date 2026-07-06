import React, { useState } from 'react'
import { api } from '../lib/api.js'

const D = {
  bg2:    '#0F0F1A',
  bg3:    '#11111E',
  bg4:    '#161625',
  border: '#1E1E32',
  ind:    '#5B5EF4',
  textP:  '#EEEEF8',
  textS:  '#8888AA',
  textT:  '#55556A',
  red:    '#E24B4A',
  green:  '#00C27C',
}

export default function ShareModal({ file, onClose }) {
  const [tab,           setTab]    = useState('email')
  const [recipient,     setRecip]  = useState('')
  const [canDownload,   setDl]     = useState(false)
  const [canSave,       setSave]   = useState(false)
  const [deleteOnConfirm, setDoc]  = useState(false)
  const [expiryDays,    setExpiry] = useState('')
  const [result,        setResult] = useState(null)
  const [loading,       setLoad]   = useState(false)
  const [error,         setError]  = useState(null)

  async function submit() {
    setLoad(true); setError(null)
    try {
      const expiresAt = expiryDays ? Date.now() + parseInt(expiryDays) * 86400000 : undefined
      const payload = { fileId: file.id, canView: true, canDownload, canSave, deleteOnConfirm, expiresAt }
      if (tab === 'email')    payload.recipientEmail    = recipient
      if (tab === 'username') payload.recipientUsername = recipient
      if (tab === 'link')     payload.generateInviteLink = true
      const res = await api.createShare(payload)
      setResult(res)
    } catch (e) { setError(e.message) }
    setLoad(false)
  }

  function Toggle({ on, onToggle, label }) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <span style={{ fontSize:13, color:D.textS }}>{label}</span>
        <button
          onClick={() => onToggle(!on)}
          style={{ width:36, height:20, borderRadius:10, border:'none', cursor:'pointer', padding:0,
                    background: on ? D.ind : D.border, position:'relative', flexShrink:0,
                    transition:'background 180ms' }}>
          <div style={{ position:'absolute', top:3, left: on ? 19 : 3,
                         width:14, height:14, borderRadius:'50%', background:'#fff',
                         transition:'left 180ms', boxShadow:'0 1px 3px rgba(0,0,0,.4)' }} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(7,7,13,0.72)', zIndex:100,
                   display:'flex', alignItems:'center', justifyContent:'center', padding:20,
                   backdropFilter:'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:D.bg2, border:`1px solid ${D.border}`, borderRadius:16,
                     width:'100%', maxWidth:460, maxHeight:'90vh', overflow:'auto',
                     boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:`1px solid ${D.border}`,
                       display:'flex', justifyContent:'space-between', alignItems:'center',
                       position:'sticky', top:0, background:D.bg2, zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:D.textP,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:320 }}>
            Share <span style={{ color:D.textS, fontWeight:500 }}>"{file.filename}"</span>
          </div>
          <button onClick={onClose}
            style={{ background:D.bg4, border:'none', fontSize:18, cursor:'pointer', color:D.textS,
                      borderRadius:6, width:28, height:28, display:'flex', alignItems:'center',
                      justifyContent:'center', flexShrink:0 }}>
            &times;
          </button>
        </div>

        <div style={{ padding:'20px 22px' }}>
          {result ? (
            <div>
              {result.inviteUrl ? (
                <>
                  <div style={{ fontSize:13, color:D.textS, marginBottom:14, lineHeight:1.6 }}>
                    Share this link. It can only be claimed once.
                  </div>
                  <div style={{ background:D.bg3, border:`1px solid ${D.border}`, borderRadius:8,
                                 padding:'12px 14px', fontSize:12, fontFamily:'JetBrains Mono,monospace',
                                 wordBreak:'break-all', marginBottom:16, color:D.textP, lineHeight:1.7 }}>
                    {result.inviteUrl}
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(result.inviteUrl)}
                    style={{ padding:'9px 18px', borderRadius:8, fontSize:13, fontWeight:600,
                              background:D.ind, color:'#fff', border:'none', cursor:'pointer' }}>
                    Copy link
                  </button>
                </>
              ) : (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>
                    <span style={{ color:D.green }}>✓</span>
                  </div>
                  <div style={{ fontSize:16, fontWeight:700, color:D.textP }}>File shared</div>
                  <div style={{ fontSize:13, color:D.textS, marginTop:6, lineHeight:1.5 }}>
                    The recipient will receive a notification.
                  </div>
                </div>
              )}
              <button onClick={onClose}
                style={{ marginTop:18, width:'100%', padding:'9px', borderRadius:8, fontSize:13,
                          fontWeight:600, background:'transparent', border:`1px solid ${D.border}`,
                          color:D.textS, cursor:'pointer' }}>
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div style={{ display:'flex', gap:3, marginBottom:20, background:D.bg3,
                             borderRadius:9, padding:3 }}>
                {[['email','By email'],['username','By @username'],['link','Invite link']].map(([k, l]) => (
                  <button key={k}
                    onClick={() => { setTab(k); setRecip('') }}
                    style={{ flex:1, padding:'7px 0', border:'none', borderRadius:7,
                               background: tab === k ? D.bg4 : 'transparent',
                               fontWeight: tab === k ? 600 : 400, fontSize:12, cursor:'pointer',
                               color: tab === k ? D.textP : D.textS,
                               boxShadow: tab === k ? '0 1px 4px rgba(0,0,0,.35)' : 'none',
                               transition:'all 150ms' }}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Recipient input */}
              {tab !== 'link' && (
                <input
                  style={{ width:'100%', padding:'10px 13px', border:`1px solid ${D.border}`,
                             borderRadius:8, fontSize:13, outline:'none', marginBottom:4,
                             background:D.bg4, color:D.textP, boxSizing:'border-box',
                             fontFamily:'inherit' }}
                  placeholder={tab === 'email' ? 'name@example.com' : '@username'}
                  value={recipient}
                  onChange={e => setRecip(e.target.value)}
                  onFocus={e => { e.currentTarget.style.borderColor = D.ind }}
                  onBlur={e => { e.currentTarget.style.borderColor = D.border }}
                />
              )}
              {tab === 'link' && (
                <div style={{ fontSize:13, color:D.textS, background:D.bg3,
                               padding:'12px 14px', borderRadius:8, marginBottom:4,
                               border:`1px solid ${D.border}`, lineHeight:1.6 }}>
                  Generates a one-time link. The first person who opens it gets access.
                </div>
              )}

              {/* Permissions */}
              <div style={{ borderTop:`1px solid ${D.border}`, paddingTop:16, marginTop:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:D.textT,
                               textTransform:'uppercase', letterSpacing:'.5px', marginBottom:14 }}>
                  Permissions
                </div>
                <Toggle on={canDownload}   onToggle={setDl}   label="Allow download" />
                <Toggle on={canSave}       onToggle={setSave}  label="Allow moving to their storage" />
                <Toggle on={deleteOnConfirm} onToggle={setDoc} label="Delete from my storage after recipient confirms" />
              </div>

              {/* Expiry */}
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:D.textT,
                               textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>
                  Expires
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {[['','Never'],['1','1 day'],['7','7 days'],['30','30 days']].map(([v, l]) => (
                    <button key={v} onClick={() => setExpiry(v)}
                      style={{ padding:'5px 11px', border:'1px solid', borderRadius:6, fontSize:12,
                                fontWeight:600, cursor:'pointer', transition:'all 120ms',
                                borderColor: expiryDays === v ? D.ind : D.border,
                                background:  expiryDays === v ? 'rgba(91,94,244,0.12)' : 'transparent',
                                color:       expiryDays === v ? D.ind : D.textS }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div style={{ marginTop:16, padding:'10px 14px',
                               background:'rgba(226,75,74,0.08)', border:'1px solid rgba(226,75,74,0.25)',
                               borderRadius:8, fontSize:13, color:D.red, lineHeight:1.5 }}>
                  {error}
                </div>
              )}

              <button
                onClick={submit}
                disabled={loading || (tab !== 'link' && !recipient)}
                style={{ padding:'10px 0', borderRadius:8, fontSize:13, fontWeight:600,
                          border:'none', cursor: (loading || (tab !== 'link' && !recipient)) ? 'not-allowed' : 'pointer',
                          background:D.ind, color:'#fff', width:'100%', marginTop:20,
                          opacity: (loading || (tab !== 'link' && !recipient)) ? 0.5 : 1,
                          transition:'opacity 120ms' }}>
                {loading ? 'Sharing…' : tab === 'link' ? 'Generate link' : 'Share'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
