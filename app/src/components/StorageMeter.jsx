// ============================================================
// StorageMeter
// ============================================================
import React, { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function StorageMeter({ meter }) {
  const pct   = Math.min(100, meter?.usedPercent || 0)
  const color = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#F59E0B' : '#6366F1'
  const isTrial = meter?.status === 'trial'

  function fmtTrialDate(ts) {
    if (!ts) return ''
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11,
                     color:'#8888AA', marginBottom:5 }}>
        <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>
          {fmtBytes(meter?.storageBytes)} used
          {meter?.maxGb ? ` of ${meter.maxGb} GB` : ''}
        </span>
        <span style={{ fontFamily:"'JetBrains Mono',monospace" }}>₹{meter?.estimatedCost?.toFixed(2) || '0'}</span>
      </div>
      <div style={{ height:3, background:'rgba(255,255,255,.07)', borderRadius:99 }}>
        <div style={{ width:`${pct}%`, height:'100%', background:color,
                       borderRadius:99, transition:'width .3s' }} />
      </div>
      {isTrial ? (
        <div style={{ fontSize:10, color:'#F59E0B', marginTop:4, fontWeight:600 }}>
          Free trial · expires {fmtTrialDate(meter?.trialEndsAt)}
        </div>
      ) : meter?.status === 'active' ? (
        <div style={{ fontSize:10, color:'#00C27C', marginTop:4, fontWeight:600 }}>
          Pay as you go · Wallet: ₹{meter?.walletBalance?.toFixed(2) || '0'}
        </div>
      ) : (
        <div style={{ fontSize:11, color:'#7A7AAA', marginTop:4 }}>
          Wallet: ₹{meter?.walletBalance?.toFixed(2) || '0'}
        </div>
      )}
    </div>
  )
}

export default StorageMeter

// ============================================================
// UploadZone — drag and drop overlay
// ============================================================
export function UploadZone({ children, onDrop, active }) {
  const [dragging, setDragging] = useState(false)

  const isExternalFileDrag = useCallback(e => {
    const types = Array.from(e.dataTransfer.types)
    // Browser-internal drags (img elements, links) always include text/html or text/uri-list.
    // Real OS file-system drops only have 'Files'.
    return types.includes('Files') && !types.includes('text/html') && !types.includes('text/uri-list')
  }, [])

  const handleDragOver = useCallback(e => {
    if (!active || !isExternalFileDrag(e)) return
    e.preventDefault()
    setDragging(true)
  }, [active, isExternalFileDrag])

  const handleDragLeave = useCallback(e => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
  }, [])

  const handleDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    if (!active || !isExternalFileDrag(e)) return
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    onDrop(files)
  }, [active, isExternalFileDrag, onDrop])

  return (
    <div
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
               position: 'relative', background: '#050510' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && (
        <div style={{ position:'absolute', inset:0, background:'rgba(99,102,241,0.06)',
                       border:'2px dashed #5B5EF4', borderRadius:12, zIndex:50,
                       display:'flex', alignItems:'center', justifyContent:'center',
                       pointerEvents:'none', backdropFilter:'blur(2px)' }}>
          <div style={{ fontSize:18, fontWeight:700, color:'#6366F1', letterSpacing:'-0.01em' }}>
            Drop files to upload
          </div>
        </div>
      )}
    </div>
  )
}
