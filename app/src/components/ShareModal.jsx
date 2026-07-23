import React, { useState, useRef } from 'react'
import { api } from '../lib/api.js'

const D = {
  bg2:    '#0D0D22',
  bg3:    '#111130',
  bg4:    '#161625',
  border: 'rgba(255,255,255,.07)',
  ind:    '#6366F1',
  textP:  '#EDEDFF',
  textS:  '#8888AA',
  textT:  '#7A7AAA',
  red:    '#E24B4A',
  green:  '#00C27C',
}

export default function ShareModal({ file, files, onClose }) {
  const allFiles = files || (file ? [file] : [])
  const isMulti  = allFiles.length > 1

  const [tab,           setTab]      = useState('email')
  const [recipients,    setRecips]   = useState([])
  const [inputVal,      setInputVal] = useState('')
  const [username,      setUsername] = useState('')
  const [canDownload,   setDl]       = useState(false)
  const [canSave,       setSave]     = useState(false)
  const [deleteOnConfirm, setDoc]    = useState(false)
  const [expiryDays,    setExpiry]   = useState('')
  const [result,        setResult]   = useState(null)
  const [loading,       setLoad]     = useState(false)
  const [error,         setError]    = useState(null)
  const inputRef = useRef(null)

  function addEmail(raw) {
    const email = raw.trim().replace(/,+$/, '').replace(/;+$/, '')
    if (email && !recipients.includes(email)) {
      setRecips(prev => [...prev, email])
    }
    setInputVal('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault()
      addEmail(inputVal)
    } else if (e.key === 'Backspace' && !inputVal && recipients.length > 0) {
      setRecips(prev => prev.slice(0, -1))
    }
  }

  function handleBlur() {
    if (inputVal.trim()) addEmail(inputVal)
  }

  function removeRecip(email) {
    setRecips(prev => prev.filter(r => r !== email))
  }

  async function submit() {
    setLoad(true); setError(null)
    try {
      const expiresAt = expiryDays ? Date.now() + parseInt(expiryDays) * 86400000 : undefined

      if (tab === 'email') {
        const finalRecips = [...recipients, ...(inputVal.trim() ? [inputVal.trim()] : [])]
        if (!finalRecips.length) { setError('Add at least one email address'); setLoad(false); return }
        let successCount = 0, errorMsgs = []
        for (const f of allFiles) {
          for (const email of finalRecips) {
            try {
              await api.createShare({ fileId: f.id, canView: true, canDownload, canSave, deleteOnConfirm, expiresAt, recipientEmail: email })
              successCount++
            } catch (e) { errorMsgs.push(`${f.filename} → ${email}: ${e.message}`) }
          }
        }
        setResult({ type: 'email', successCount, total: allFiles.length * finalRecips.length, errorMsgs })

      } else if (tab === 'username') {
        if (!username.trim()) { setError('Enter a username'); setLoad(false); return }
        let successCount = 0, errorMsgs = []
        for (const f of allFiles) {
          try {
            await api.createShare({ fileId: f.id, canView: true, canDownload, canSave, deleteOnConfirm, expiresAt, recipientUsername: username.trim() })
            successCount++
          } catch (e) { errorMsgs.push(`${f.filename}: ${e.message}`) }
        }
        setResult({ type: 'username', successCount, total: allFiles.length, errorMsgs })

      } else {
        const links = []
        const linkErrors = []
        for (const f of allFiles) {
          try {
            const res = await api.createShare({ fileId: f.id, canView: true, canDownload, canSave, deleteOnConfirm, expiresAt, generateInviteLink: true })
            links.push({ filename: f.filename, url: res.inviteUrl })
          } catch (e) { linkErrors.push(e.message) }
        }
        if (links.length === 0) {
          setError(linkErrors[0] || 'Failed to generate share link')
        } else {
          setResult({ type: 'link', links })
        }
      }
    } catch (e) { setError(e.message) }
    setLoad(false)
  }

  function Toggle({ on, onToggle, label }) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <span style={{ fontSize:13, color:D.textS }}>{label}</span>
        <button onClick={() => onToggle(!on)}
          style={{ width:36, height:20, borderRadius:10, border:'none', cursor:'pointer', padding:0,
                    background: on ? D.ind : D.border, position:'relative', flexShrink:0, transition:'background 180ms' }}>
          <div style={{ position:'absolute', top:3, left: on ? 19 : 3,
                         width:14, height:14, borderRadius:'50%', background:'#fff',
                         transition:'left 180ms', boxShadow:'0 1px 3px rgba(0,0,0,.4)' }} />
        </button>
      </div>
    )
  }

  const headerTitle = isMulti
    ? `Share ${allFiles.length} files`
    : `Share "${allFiles[0]?.filename}"`

  const isEmailReady = recipients.length > 0 || inputVal.trim().length > 0
  const isDisabled = loading || (tab === 'email' && !isEmailReady) || (tab === 'username' && !username.trim())

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(7,7,13,0.72)', zIndex:100,
                   display:'flex', alignItems:'center', justifyContent:'center', padding:20,
                   backdropFilter:'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:D.bg2, border:`1px solid ${D.border}`, borderRadius:16,
                     width:'100%', maxWidth:480, maxHeight:'90vh', overflow:'auto',
                     boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ padding:'18px 22px', borderBottom:`1px solid ${D.border}`,
                       display:'flex', justifyContent:'space-between', alignItems:'center',
                       position:'sticky', top:0, background:D.bg2, zIndex:1 }}>
          <div style={{ fontSize:15, fontWeight:700, color:D.textP,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:340 }}>
            {headerTitle}
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
              {result.type === 'link' ? (
                <>
                  <div style={{ fontSize:13, color:D.textS, marginBottom:14, lineHeight:1.6 }}>
                    {result.links.length === 1 ? 'Share this link. It can only be claimed once.' : 'One-time links generated:'}
                  </div>
                  {result.links.map(l => (
                    <div key={l.url} style={{ marginBottom:10 }}>
                      {result.links.length > 1 && (
                        <div style={{ fontSize:11, color:D.textT, marginBottom:4 }}>{l.filename}</div>
                      )}
                      <div style={{ background:D.bg3, border:`1px solid ${D.border}`, borderRadius:8,
                                     padding:'10px 12px', fontSize:11, fontFamily:'JetBrains Mono,monospace',
                                     wordBreak:'break-all', color:D.textP, lineHeight:1.7, display:'flex',
                                     gap:8, alignItems:'flex-start', justifyContent:'space-between' }}>
                        <span style={{ flex:1 }}>{l.url}</span>
                        <button onClick={() => navigator.clipboard.writeText(l.url)}
                          style={{ padding:'3px 9px', borderRadius:6, fontSize:11, fontWeight:600,
                                    background:D.ind, color:'#fff', border:'none', cursor:'pointer', flexShrink:0 }}>
                          Copy
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <div style={{ fontSize:32, marginBottom:12, color:D.green }}>✓</div>
                  <div style={{ fontSize:16, fontWeight:700, color:D.textP }}>
                    {result.successCount} share{result.successCount !== 1 ? 's' : ''} sent
                  </div>
                  {result.errorMsgs?.length > 0 && (
                    <div style={{ fontSize:12, color:D.red, marginTop:10, lineHeight:1.7 }}>
                      {result.errorMsgs.map((m,i) => <div key={i}>{m}</div>)}
                    </div>
                  )}
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
              <div style={{ display:'flex', gap:3, marginBottom:20, background:D.bg3, borderRadius:9, padding:3 }}>
                {[['email','By email'],['username','By @username'],['link','Invite link']].map(([k, l]) => (
                  <button key={k} onClick={() => { setTab(k); setInputVal(''); setRecips([]); setUsername('') }}
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

              {/* Email chip input */}
              {tab === 'email' && (
                <>
                  <div
                    style={{ display:'flex', flexWrap:'wrap', gap:5, minHeight:44, padding:'7px 10px',
                               border:`1px solid ${D.border}`, borderRadius:8, background:D.bg4,
                               alignItems:'center', cursor:'text', transition:'border-color 150ms' }}
                    onClick={() => inputRef.current?.focus()}
                    onFocus={() => {}}
                  >
                    {recipients.map(r => (
                      <span key={r} style={{ display:'inline-flex', alignItems:'center', gap:4,
                                              padding:'3px 9px 3px 10px',
                                              background:'rgba(99,102,241,0.15)',
                                              border:'1px solid rgba(99,102,241,0.35)',
                                              borderRadius:20, fontSize:12, color:D.textP, lineHeight:1.4 }}>
                        {r}
                        <button onClick={() => removeRecip(r)}
                          style={{ background:'none', border:'none', color:D.textS, cursor:'pointer',
                                    padding:'0 0 0 2px', fontSize:15, lineHeight:1, display:'flex', alignItems:'center' }}>
                          ×
                        </button>
                      </span>
                    ))}
                    <input ref={inputRef}
                      style={{ flex:1, minWidth:160, border:'none', outline:'none', background:'transparent',
                                color:D.textP, fontSize:13, padding:'2px 0', fontFamily:'inherit' }}
                      placeholder={recipients.length === 0 ? 'name@example.com, another@example.com' : 'Add more…'}
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={handleBlur}
                    />
                  </div>
                  <div style={{ fontSize:11, color:D.textT, marginTop:5 }}>
                    Press Enter or comma to add each address
                  </div>
                </>
              )}

              {/* Username input */}
              {tab === 'username' && (
                <input
                  style={{ width:'100%', padding:'10px 13px', border:`1px solid ${D.border}`,
                             borderRadius:8, fontSize:13, outline:'none', marginBottom:4,
                             background:D.bg4, color:D.textP, boxSizing:'border-box', fontFamily:'inherit' }}
                  placeholder="@username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={e => { e.currentTarget.style.borderColor = D.ind }}
                  onBlur={e => { e.currentTarget.style.borderColor = D.border }}
                />
              )}

              {tab === 'link' && (
                <div style={{ fontSize:13, color:D.textS, background:D.bg3, padding:'12px 14px',
                               borderRadius:8, marginBottom:4, border:`1px solid ${D.border}`, lineHeight:1.6 }}>
                  {isMulti
                    ? `Generates ${allFiles.length} one-time links, one per file. The first person who opens each gets access.`
                    : 'Generates a one-time link. The first person who opens it gets access.'}
                </div>
              )}

              {/* Permissions */}
              <div style={{ borderTop:`1px solid ${D.border}`, paddingTop:16, marginTop:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:D.textT,
                               textTransform:'uppercase', letterSpacing:'.5px', marginBottom:14 }}>
                  Permissions
                </div>
                <Toggle on={canDownload}     onToggle={setDl}   label="Allow download" />
                <Toggle on={canSave}         onToggle={setSave}  label="Allow moving to their storage" />
                <Toggle on={deleteOnConfirm} onToggle={setDoc}   label="Delete from my storage after recipient confirms" />
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
                                background:  expiryDays === v ? 'rgba(99,102,241,0.12)' : 'transparent',
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

              <button onClick={submit} disabled={isDisabled}
                style={{ padding:'10px 0', borderRadius:8, fontSize:13, fontWeight:600,
                          border:'none', cursor: isDisabled ? 'not-allowed' : 'pointer',
                          background:D.ind, color:'#fff', width:'100%', marginTop:20,
                          opacity: isDisabled ? 0.5 : 1, transition:'opacity 120ms' }}>
                {loading ? 'Sharing…' : tab === 'link' ? 'Generate link' : 'Share'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
