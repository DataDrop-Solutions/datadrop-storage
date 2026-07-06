import React, { useState, useRef, useCallback } from 'react'
import { api, uploadFile, encryptForVault, encryptWithDEK, wrapDEKWithPublicKey } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'

// ── Image resize via Canvas ────────────────────────────────────────
async function resizeImage(file, maxDim, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (img.width <= maxDim && img.height <= maxDim) { resolve(file); return }
      const scale  = Math.min(maxDim / img.width, maxDim / img.height)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'),
                                 { type: 'image/jpeg', lastModified: file.lastModified })),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// Exactly three quality options — no medium, no per-file upgrade
const QUALITY_OPTIONS = [
  { id: 'original',      label: 'Original',                          maxDim: null, jpegQuality: 1.0 },
  { id: 'high_quality',  label: 'High Quality (2048px, 85% JPEG)',   maxDim: 2048, jpegQuality: 0.85 },
  { id: 'storage_saver', label: 'Storage Saver (1200px, 75% JPEG)',  maxDim: 1200, jpegQuality: 0.75 },
]
const DEFAULT_QUALITY = 'high_quality'

function getDateKey(file) {
  const d = new Date(file.lastModified || Date.now())
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function getDateLabel(key) {
  const [y, m] = key.split('-')
  return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-IN', { year: 'numeric', month: 'long' })
}

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function FileThumb({ file, status }) {
  const [src, setSrc] = useState(null)
  useState(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  })

  const icon = file.type.startsWith('video/') ? '🎥' : file.type.startsWith('image/') ? null : '📄'

  return (
    <div style={{ width: 60, height: 60, borderRadius: 8, background: '#f3f4f6', flexShrink: 0,
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   overflow: 'hidden', position: 'relative' }}>
      {src ? (
        <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: 24 }}>{icon || '📄'}</span>
      )}
      {status === 'done'  && <div style={{ position: 'absolute', inset: 0, background: 'rgba(22,163,74,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>✓</div>}
      {status === 'error' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(220,38,38,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>✗</div>}
    </div>
  )
}

export default function BackupView() {
  const toast = useToastMethods()
  const fileInputRef = useRef(null)

  const [files, setFiles]       = useState([])   // raw File objects
  const [quality, setQuality]   = useState(DEFAULT_QUALITY)
  const [byDate,  setByDate]    = useState(true)
  const [toVault, setToVault]   = useState(false)
  const [running,  setRunning]  = useState(false)
  const [progress, setProgress] = useState({})   // { filename: 'done'|'uploading'|'error'|'skipped' }
  const [stats, setStats]       = useState(null) // { done, skipped, error, total }

  function pickFiles(e) {
    const picked = Array.from(e.target.files || [])
    if (!picked.length) return
    e.target.value = ''
    const mediaOnly = picked.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    if (mediaOnly.length < picked.length) toast.info(`${picked.length - mediaOnly.length} non-media files skipped`)
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name + f.size))
      return [...prev, ...mediaOnly.filter(f => !names.has(f.name + f.size))]
    })
    setStats(null)
    setProgress({})
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function clearAll() {
    setFiles([])
    setProgress({})
    setStats(null)
  }

  // ── Core backup logic ─────────────────────────────────────────
  async function startBackup() {
    if (!files.length) return
    if (toVault) {
      const v1Key = sessionStorage.getItem('dd_vault_key')
      const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
      if (!v1Key && !v2Key) { toast.error('Unlock your Zero Knowledge Vault first (go to Zero Knowledge Vault view, enter PIN)'); return }
    }

    setRunning(true)
    setStats(null)
    const prog = {}
    files.forEach(f => { prog[f.name + f.size] = 'pending' })
    setProgress({ ...prog })

    // ── 1. Get or create folder structure (regular backup only — vault is flat) ──
    let targetFolders = {}  // dateKey → folderId | null

    try {
      if (byDate && !toVault) {
        // Find or create "Backups" root folder in normal storage
        const rootData    = await api.listFiles({ limit: 200 })
        const rootFolders = rootData.folders || []
        let backupsFold   = rootFolders.find(f => f.name === 'Backups')
        if (!backupsFold) {
          const { folderId } = await api.createFolder({ name: 'Backups' })
          backupsFold = { id: folderId, name: 'Backups' }
        }

        // Find or create YYYY-MM subfolders
        const dateKeys  = [...new Set(files.map(getDateKey))]
        const subData   = await api.listFiles({ folder: backupsFold.id, limit: 200 })
        const subFolders = subData.folders || []

        for (const dk of dateKeys) {
          const existing = subFolders.find(f => f.name === dk)
          if (existing) {
            targetFolders[dk] = existing.id
          } else {
            const { folderId } = await api.createFolder({ name: dk, parentId: backupsFold.id })
            targetFolders[dk] = folderId
          }
        }
      }
      // Vault backup is always flat — no folder structure in vault
    } catch (e) {
      toast.error('Could not set up backup folders: ' + e.message)
      setRunning(false)
      return
    }

    // ── 2. Upload files one by one ────────────────────────────
    const qOpt   = QUALITY_OPTIONS.find(o => o.id === quality)
    let done = 0, skipped = 0, errors = 0
    const v1VaultKey = toVault ? sessionStorage.getItem('dd_vault_key') : null
    const v2PrivKey  = toVault ? sessionStorage.getItem('dd_vault_private_key_pkcs8') : null
    let userPublicKey = null
    if (v2PrivKey && toVault) {
      try { const me = await api.me(); userPublicKey = me.user?.public_key } catch (_) {}
    }

    for (const file of files) {
      const key = file.name + file.size
      setProgress(p => ({ ...p, [key]: 'uploading' }))

      try {
        let toUpload = file

        // Resize images if quality selected — videos always upload at original quality
        if (qOpt.maxDim && file.type.startsWith('image/')) {
          toUpload = await resizeImage(file, qOpt.maxDim, qOpt.jpegQuality)
        }

        // Vault is flat — no folderId. Regular backup uses date-based folders.
        const folderId = (!toVault && byDate) ? (targetFolders[getDateKey(file)] || null) : null

        if (toVault) {
          // Encrypt before upload — store flat in vault (no folderId)
          const buf  = await toUpload.arrayBuffer()
          let encBuf, fileKeyPayload = null

          if (v2PrivKey && userPublicKey) {
            const dekBytes = crypto.getRandomValues(new Uint8Array(32))
            encBuf = await encryptWithDEK(dekBytes, buf)
            fileKeyPayload = await wrapDEKWithPublicKey(dekBytes, userPublicKey)
          } else {
            encBuf = await encryptForVault(v1VaultKey, buf)
          }

          const encFile = new File([encBuf], toUpload.name, {
            type: `encrypted:${toUpload.type || 'application/octet-stream'}`,
            lastModified: toUpload.lastModified,
          })
          const result = await uploadFile(encFile, {
            isVault: true, skipDedup: true,
            mimeType: `encrypted:${toUpload.type || 'application/octet-stream'}`,
          }, null)
          if (result.duplicate) { skipped++; setProgress(p => ({ ...p, [key]: 'skipped' })); continue }
          if (fileKeyPayload && result.fileId) {
            await api.storeVaultFileKey({ fileId: result.fileId, ...fileKeyPayload }).catch(() => {})
          }
        } else {
          const result = await uploadFile(toUpload, { folderId, quality: qOpt.id }, null)
          if (result.duplicate) { skipped++; setProgress(p => ({ ...p, [key]: 'skipped' })); continue }
        }

        done++
        setProgress(p => ({ ...p, [key]: 'done' }))
      } catch (e) {
        errors++
        setProgress(p => ({ ...p, [key]: 'error' }))
        void e
      }
    }

    setStats({ done, skipped, error: errors, total: files.length })
    setRunning(false)
    toast.success(`Backup complete: ${done} uploaded, ${skipped} duplicates skipped${errors ? `, ${errors} failed` : ''}`)
  }

  // ── Storage estimate per quality option ──────────────────────
  function estimateSize(files, qOpt) {
    if (!qOpt.maxDim) return files.reduce((s, f) => s + f.size, 0)
    return files.reduce((s, f) => {
      if (f.type.startsWith('image/')) {
        // Heuristic: resized JPEG at given quality ≈ original × (jpeg_quality × 0.3)
        // Conservative estimate: assume ~40% of original for high, ~25% for storage saver
        const factor = qOpt.id === 'storage_saver' ? 0.20 : 0.35
        return s + Math.round(f.size * factor)
      }
      return s + f.size // videos always original
    }, 0)
  }

  function estimateCost(bytes) {
    const gb = bytes / (1024 ** 3)
    // Use tier 1 price ₹1.89/GB for estimate
    return Math.max(1, gb * 1.89).toFixed(2)
  }

  // ── Group files by date for display ──────────────────────────
  const grouped = byDate
    ? files.reduce((acc, f) => {
        const k = getDateKey(f)
        if (!acc[k]) acc[k] = []
        acc[k].push(f)
        return acc
      }, {})
    : { all: files }

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const doneCount = Object.values(progress).filter(v => v === 'done').length
  const errCount  = Object.values(progress).filter(v => v === 'error').length

  return (
    <div style={{ maxWidth: 680 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Photo & Video Backup</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 22 }}>
        Upload photos and videos from your device. Duplicates are automatically skipped.
      </p>

      {/* Options panel */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>Backup Options</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
            <span style={{ width: 130, color: '#374151' }}>Image quality</span>
            <select
              value={quality}
              onChange={e => setQuality(e.target.value)}
              disabled={running}
              style={{ padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7, fontSize: 13, background: '#fff', flex: 1 }}>
              {QUALITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={byDate} onChange={e => setByDate(e.target.checked)} disabled={running}
              style={{ width: 16, height: 16 }} />
            <span>Organize into folders by date (Backups/YYYY-MM)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={toVault} onChange={e => setToVault(e.target.checked)} disabled={running}
              style={{ width: 16, height: 16 }} />
            <span>🔒 Encrypt and store in Zero Knowledge Vault</span>
          </label>

          {toVault && (
            <div style={{ fontSize: 12, color: '#7c3aed', background: '#f5f3ff', padding: '8px 12px',
                           borderRadius: 7, marginTop: -4 }}>
              Zero Knowledge Vault must be unlocked before backup. Files are encrypted locally and stored flat (no date folders).
            </div>
          )}
        </div>
      </div>

      {/* Storage estimate — shown when files are selected */}
      {files.length > 0 && !running && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10,
                       padding: 16, marginBottom: 16, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#0369a1' }}>
            {files.filter(f => f.type.startsWith('image/')).length} photos ·{' '}
            {files.filter(f => f.type.startsWith('video/')).length} videos selected
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                <th style={{ textAlign: 'left', paddingBottom: 4, fontWeight: 600 }}>Quality</th>
                <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 600 }}>Est. Size</th>
                <th style={{ textAlign: 'right', paddingBottom: 4, fontWeight: 600 }}>Est. Cost/mo</th>
              </tr>
            </thead>
            <tbody>
              {QUALITY_OPTIONS.map(opt => {
                const est = estimateSize(files, opt)
                return (
                  <tr key={opt.id} style={{ background: opt.id === quality ? '#e0f2fe' : 'transparent',
                                             borderRadius: 6 }}>
                    <td style={{ padding: '4px 6px', borderRadius: 6 }}>
                      {opt.id === quality ? <strong>{opt.label}</strong> : opt.label}
                    </td>
                    <td style={{ textAlign: 'right', padding: '4px 6px', fontVariantNumeric: 'tabular-nums' }}>
                      ~{fmtSize(est)}
                    </td>
                    <td style={{ textAlign: 'right', padding: '4px 6px', color: '#16a34a',
                                   fontVariantNumeric: 'tabular-nums' }}>
                      ₹{estimateCost(est)}/mo
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Drop / Select zone */}
      <div
        onClick={() => !running && fileInputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!running) { const f = Array.from(e.dataTransfer.files); fileInputRef.current && (fileInputRef.current.files = null); pickFiles({ target: { files: f, value: '' } }) } }}
        style={{ border: '2px dashed #e5e7eb', borderRadius: 12, padding: '28px 20px', textAlign: 'center',
                  cursor: running ? 'default' : 'pointer', marginBottom: 20, transition: 'border-color .15s',
                  background: '#fafafa' }}
        onMouseEnter={e => !running && (e.currentTarget.style.borderColor = '#6366f1')}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Select photos & videos</div>
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Click to browse or drag and drop here</div>
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*"
          style={{ display: 'none' }} onChange={pickFiles} />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px',
                         borderBottom: '1px solid #f3f4f6', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>
              {files.length} file{files.length !== 1 ? 's' : ''} — {fmtSize(totalSize)}
            </span>
            {running && (
              <span style={{ fontSize: 12, color: '#6366f1' }}>
                {doneCount}/{files.length} uploaded{errCount > 0 ? `, ${errCount} failed` : ''}
              </span>
            )}
            {!running && (
              <button onClick={clearAll}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af' }}>
                Clear all
              </button>
            )}
          </div>

          {/* Progress bar when running */}
          {running && (
            <div style={{ height: 3, background: '#e5e7eb' }}>
              <div style={{ height: '100%', background: '#6366f1', borderRadius: 2,
                             width: `${Math.round((doneCount + errCount) / files.length * 100)}%`,
                             transition: 'width .3s' }} />
            </div>
          )}

          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            {Object.entries(grouped).map(([key, groupFiles]) => (
              <div key={key}>
                {byDate && key !== 'all' && (
                  <div style={{ padding: '8px 18px', fontSize: 11, fontWeight: 700, color: '#9ca3af',
                                 textTransform: 'uppercase', letterSpacing: '.5px', background: '#f9fafb',
                                 borderBottom: '1px solid #f3f4f6' }}>
                    {getDateLabel(key)} · {groupFiles.length} files
                  </div>
                )}
                {groupFiles.map(f => {
                  const k   = f.name + f.size
                  const st  = progress[k]
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px',
                                           borderBottom: '1px solid #f9fafb' }}>
                      <FileThumb file={f} status={st} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis',
                                       whiteSpace: 'nowrap', color: '#374151' }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                          {fmtSize(f.size)}
                          {f.type.startsWith('video/') && ' · video'}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, flexShrink: 0, width: 70, textAlign: 'right' }}>
                        {st === 'uploading' && <span style={{ color: '#6366f1' }}>Uploading…</span>}
                        {st === 'done'      && <span style={{ color: '#16a34a' }}>✓ Done</span>}
                        {st === 'skipped'   && <span style={{ color: '#9ca3af' }}>Duplicate</span>}
                        {st === 'error'     && <span style={{ color: '#dc2626' }}>✗ Error</span>}
                      </div>
                      {!running && (
                        <button onClick={() => removeFile(files.indexOf(f))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d1d5db',
                                    fontSize: 16, padding: '0 4px', flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary after backup */}
      {stats && !running && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d', marginBottom: 4 }}>Backup complete</div>
          <div style={{ fontSize: 13, color: '#374151' }}>
            {stats.done} file{stats.done !== 1 ? 's' : ''} uploaded
            {stats.skipped > 0 ? ` · ${stats.skipped} duplicate${stats.skipped !== 1 ? 's' : ''} skipped` : ''}
            {stats.error   > 0 ? ` · ${stats.error} failed` : ''}
          </div>
        </div>
      )}

      {/* Start button */}
      {files.length > 0 && (
        <button
          onClick={startBackup}
          disabled={running}
          style={{ padding: '11px 28px', background: running ? '#d1d5db' : (toVault ? '#7c3aed' : '#111'),
                    color: '#fff', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700,
                    cursor: running ? 'not-allowed' : 'pointer', transition: 'background .15s' }}>
          {running
            ? `Backing up… (${doneCount}/${files.length})`
            : `${toVault ? '🔒 ' : ''}Back Up ${files.length} File${files.length !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  )
}
