import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'

const D = {
  bg:      '#08081A',
  bg2:     '#0D0D22',
  bg3:     '#111130',
  border:  'rgba(255,255,255,.07)',
  border2: 'rgba(255,255,255,.14)',
  ind:     '#6366F1',
  red:     '#E24B4A',
  textP:   '#EDEDFF',
  textS:   '#8888AA',
  textT:   '#7A7AAA',
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function Btn({ onClick, disabled, variant = 'ghost', children }) {
  const base = {
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer', border: '1px solid',
    opacity: disabled ? 0.5 : 1, transition: 'all 120ms',
  }
  const styles = {
    ghost:   { ...base, background: 'transparent', borderColor: D.border, color: D.textS },
    primary: { ...base, background: D.ind, borderColor: D.ind, color: '#fff' },
    danger:  { ...base, background: 'rgba(226,75,74,0.08)', borderColor: 'rgba(226,75,74,0.25)', color: D.red },
  }
  return <button onClick={onClick} disabled={disabled} style={styles[variant]}>{children}</button>
}

function FileThumbnail({ v }) {
  const thumb = v.thumb_data?.startsWith('data:') ? v.thumb_data : null
  if (thumb) return (
    <img src={thumb} alt="" style={{ width: 48, height: 34, objectFit: 'cover',
      borderRadius: 5, flexShrink: 0, border: `1px solid ${D.border}` }} />
  )
  const icon = v.mime_type?.startsWith('encrypted:')
    ? <path d="M7 3L2 5.5V9C2 12.3 4.5 15.4 7 16C9.5 15.4 12 12.3 12 9V5.5L7 3Z M7 7v2M7 11h.01" stroke={D.textT} strokeWidth="1.3" strokeLinecap="round"/>
    : v.mime_type?.startsWith('image/')
    ? <><rect x="2" y="3" width="12" height="10" rx="1.5" stroke={D.textT} strokeWidth="1.3"/><circle cx="5.5" cy="6.5" r="1" fill={D.textT}/><path d="M2 10l3-3 3 3 2-2 2 2" stroke={D.textT} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>
    : <><path d="M3 2h7l4 4v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke={D.textT} strokeWidth="1.3"/><path d="M10 2v4h4" stroke={D.textT} strokeWidth="1.3"/></>
  return (
    <div style={{ width: 48, height: 34, borderRadius: 5, flexShrink: 0,
      border: `1px solid ${D.border}`, background: D.bg3,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={16} height={16} viewBox="0 0 16 16" fill="none">{icon}</svg>
    </div>
  )
}

export default function VersionHistory({ file, onClose, onRestored, onPreview }) {
  const toast = useToastMethods()
  const [versions,         setVersions]         = useState([])
  const [loading,          setLoading]          = useState(true)
  const [confirmId,        setConfirmId]        = useState(null)
  const [restoring,        setRestoring]        = useState(null)
  const [deleteConfirmId,  setDeleteConfirmId]  = useState(null)
  const [deleting,         setDeleting]         = useState(null)

  function loadVersions() {
    setLoading(true)
    api.getVersions(file.id)
      .then(d => setVersions(d.versions || []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadVersions() }, [file.id])

  async function restore(versionId) {
    setRestoring(versionId)
    setConfirmId(null)
    try {
      await api.updateFile(file.id, { restoreVersionId: versionId })
      toast.success('Version restored')
      if (onRestored) onRestored()
      onClose()
    } catch (e) {
      toast.error(e.message)
    }
    setRestoring(null)
  }

  async function deleteVer(versionId, isCurrent) {
    setDeleting(versionId)
    setDeleteConfirmId(null)
    try {
      await api.deleteVersion(file.id, versionId)
      toast.success('Version deleted')
      if (isCurrent) { if (onRestored) onRestored(); onClose() }
      else setVersions(prev => prev.filter(v => v.id !== versionId))
    } catch (e) {
      toast.error(e.message)
    }
    setDeleting(null)
  }

  const busy = !!restoring || !!deleting

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(7,7,13,0.7)', zIndex:200,
                   display:'flex', alignItems:'center', justifyContent:'center', padding:20,
                   backdropFilter:'blur(4px)' }}
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:D.bg2, border:`1px solid ${D.border}`, borderRadius:14,
                     width:'100%', maxWidth:520, maxHeight:'80vh', display:'flex',
                     flexDirection:'column', boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${D.border}`,
                       display:'flex', alignItems:'center', justifyContent:'space-between',
                       flexShrink:0 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:D.textP, fontFamily:"'Space Grotesk',sans-serif" }}>
              Version history
            </div>
            <div style={{ fontSize:12, color:D.textT, marginTop:2,
                           overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:340 }}>
              {file.filename}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:D.textT, fontSize:20,
                      cursor:'pointer', lineHeight:1, padding:'2px 4px', transition:'color 120ms' }}
            onMouseEnter={e=>{ e.currentTarget.style.color=D.textP }}
            onMouseLeave={e=>{ e.currentTarget.style.color=D.textT }}>
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY:'auto', flex:1 }}>
          {loading && (
            <div style={{ color:D.textT, textAlign:'center', padding:40, fontSize:14 }}>Loading…</div>
          )}

          {!loading && versions.length === 0 && (
            <div style={{ color:D.textT, textAlign:'center', padding:40, fontSize:14 }}>
              No previous versions saved yet.
            </div>
          )}

          {versions.map((v, idx) => {
            const isCurrent        = v.id === file.id
            const isRestoring      = restoring === v.id
            const isDeleting       = deleting  === v.id
            const showRestoreConfirm = confirmId === v.id
            const showDeleteConfirm  = deleteConfirmId === v.id

            return (
              <div key={v.id} style={{ padding:'14px 20px',
                                        borderBottom: idx < versions.length - 1 ? `1px solid ${D.border}` : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                  {/* Thumb + meta */}
                  <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
                    <FileThumbnail v={v} />
                    <div style={{ minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                        <span style={{ fontSize:13, fontWeight:600, color:D.textP }}>
                          Version {v.version_number}
                        </span>
                        {isCurrent && (
                          <span style={{ fontSize:10, fontWeight:600, background:'rgba(99,102,241,0.15)',
                                          color:D.ind, border:`1px solid rgba(99,102,241,0.3)`,
                                          padding:'1px 7px', borderRadius:99, letterSpacing:'.04em' }}>
                            Current
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:11, color:D.textT }}>
                        {fmtSize(v.size_bytes)} · {new Date(v.created_at).toLocaleString('en-IN', {
                          day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {!showRestoreConfirm && !showDeleteConfirm && (
                    <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                      {onPreview && (
                        <Btn onClick={() => onPreview(v)} disabled={busy} variant="ghost">
                          View
                        </Btn>
                      )}
                      {!isCurrent && (
                        <Btn onClick={() => setConfirmId(v.id)} disabled={busy} variant="ghost">
                          {isRestoring ? 'Restoring…' : 'Restore'}
                        </Btn>
                      )}
                      <Btn onClick={() => setDeleteConfirmId(v.id)} disabled={busy} variant="danger">
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </Btn>
                    </div>
                  )}
                </div>

                {showRestoreConfirm && (
                  <div style={{ marginTop:10, padding:'12px 14px',
                                 background:'rgba(99,102,241,0.06)', border:`1px solid rgba(99,102,241,0.2)`,
                                 borderRadius:8 }}>
                    <div style={{ fontSize:12, color:D.textS, marginBottom:10 }}>
                      Restore Version {v.version_number}? Current file will be replaced.
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <Btn onClick={() => restore(v.id)} variant="primary">Yes, restore</Btn>
                      <Btn onClick={() => setConfirmId(null)} variant="ghost">Cancel</Btn>
                    </div>
                  </div>
                )}

                {showDeleteConfirm && (
                  <div style={{ marginTop:10, padding:'12px 14px',
                                 background:'rgba(226,75,74,0.06)', border:`1px solid rgba(226,75,74,0.2)`,
                                 borderRadius:8 }}>
                    <div style={{ fontSize:12, color:'rgba(226,75,74,0.8)', marginBottom:10 }}>
                      {isCurrent
                        ? 'Delete current version? The next version will become current.'
                        : `Delete Version ${v.version_number}? This cannot be undone.`}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <Btn onClick={() => deleteVer(v.id, isCurrent)} variant="danger">Yes, delete</Btn>
                      <Btn onClick={() => setDeleteConfirmId(null)} variant="ghost">Cancel</Btn>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
