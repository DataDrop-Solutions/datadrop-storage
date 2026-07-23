import React, { useState, useEffect, useRef } from 'react'
import {
  api, uploadFile, fetchFileWithAuth,
  encryptForVault, decryptFromVault,
  generateECDHKeypair, encryptPrivateKeyWithPin, decryptPrivateKeyWithPin, derivePinHash,
  wrapDEKWithPublicKey, unwrapDEKWithPrivateKey, encryptWithDEK, decryptWithDEK,
} from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'
import FilePreview from './FilePreview.jsx'
import FileGrid from './FileGrid.jsx'
import VersionHistory from './VersionHistory.jsx'
import UploadProgressPanel from './UploadProgressPanel.jsx'
import FileMoveModal from './FileMoveModal.jsx'

const ENC = new TextEncoder()

// ── Thumbnail generation (client-side, for encrypted storage) ─
async function generateThumb(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const W = 240, H = 160
      const ratio = Math.min(W / img.width, H / img.height, 1)
      const w = Math.max(1, Math.round(img.width * ratio))
      const h = Math.max(1, Math.round(img.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob || blob.size > 15360) return resolve(null)
        const reader = new FileReader()
        reader.onload = e => resolve(e.target.result)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      }, 'image/webp', 0.6)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

async function generateVideoThumb(file) {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timeout = setTimeout(() => finish(null), 10000)
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration || 0) }
    video.onseeked = () => {
      clearTimeout(timeout)
      const W = 240, H = 160
      const ratio = Math.min(W / video.videoWidth, H / video.videoHeight, 1)
      const w = Math.max(1, Math.round(video.videoWidth * ratio))
      const h = Math.max(1, Math.round(video.videoHeight * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(video, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob || blob.size > 15360) { finish(null); return }
        const reader = new FileReader()
        reader.onload = e => finish(e.target.result)
        reader.onerror = () => finish(null)
        reader.readAsDataURL(blob)
      }, 'image/webp', 0.6)
    }
    video.onerror = () => { clearTimeout(timeout); finish(null) }
    video.src = url
  })
}

// ── Legacy V1 helpers (PIN-based single vault key) ────────────
async function pbkdf2(password, salt, iterations = 310000) {
  const km = await crypto.subtle.importKey('raw', ENC.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ENC.encode(salt), iterations, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  )
}

async function aesEncrypt(key, data) {
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ENC.encode(data))
  return btoa(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(ct)))
}

async function aesDecrypt(key, b64) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))
  return new TextDecoder().decode(dec)
}

async function hashPin(pin, salt) {
  const key    = await pbkdf2(pin, salt)
  const raw    = await crypto.subtle.exportKey('raw', key)
  const digest = await crypto.subtle.digest('SHA-256', raw)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

function randomSalt() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
}

function generatePhrase() {
  const words = [
    'apple','brave','cloud','dance','eagle','flame','grace','honor',
    'ivory','jewel','karma','lunar','maple','noble','ocean','pearl',
    'queen','river','solar','tiger','ultra','vivid','water','xenon',
    'yacht','zebra','amber','bloom','crisp','delta','ember','frost',
    'globe','haste','inbox','jelly','kneel','lemon','magic','night',
    'olive','prism','quilt','raven','stone','trend','unity','valor',
    'winds','xylem','youth','zones','adapt','birth','candy','drama',
    'epoch','finch','grail','heron','input','joker','knack','lilac',
  ]
  return Array.from({ length: 12 }, () => words[Math.floor(Math.random() * words.length)]).join(' ')
}

// ── Session helpers ───────────────────────────────────────────
function isV1Unlocked() { return !!sessionStorage.getItem('dd_vault_key') }
function isV2Unlocked() { return !!sessionStorage.getItem('dd_vault_private_key_pkcs8') }
function isUnlocked()   { return isV1Unlocked() || isV2Unlocked() }

function lockVault() {
  sessionStorage.removeItem('dd_vault_key')
  sessionStorage.removeItem('dd_vault_private_key_pkcs8')
}

// ============================================================
export default function VaultSetup() {
  const toast = useToastMethods()
  const [status,  setStatus]  = useState(null)   // 'unconfigured' | 'v1' | 'v2'
  const [view,    setView]    = useState('idle')
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)

  const unlocked = isUnlocked()

  useEffect(() => {
    api.vaultStatus().then(d => {
      if (!d.configured) setStatus('unconfigured')
      else if (d.isV2)   setStatus('v2')
      else               setStatus('v1')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  function handleLock()    { lockVault(); setTick(t => t + 1) }
  function handleUnlocked(){ setTick(t => t + 1) }

  if (loading) return (
    <div style={{ color:'#7A7AAA', padding:40, textAlign:'center',
                   display:'flex', alignItems:'center', gap:10, justifyContent:'center' }}>
      <div style={{ width:14,height:14,border:'2px solid rgba(255,255,255,.07)',borderTopColor:'#6366F1',
                     borderRadius:'50%',animation:'dd-spin 0.7s linear infinite' }} />
      Loading Zero Knowledge Vault…
    </div>
  )

  if (unlocked) return <VaultBrowser onLock={handleLock} />

  if (view === 'setup')   return <SetupFlow   vaultVersion={status === 'v2' ? 'v2' : 'auto'} onDone={() => { setStatus('v2'); setView('idle') }} onBack={() => setView('idle')} />
  if (view === 'unlock')  return <UnlockFlow  vaultVersion={status} onDone={handleUnlocked} onBack={() => setView('idle')} onRecover={() => setView('recover')} />
  if (view === 'recover') return <RecoverFlow vaultVersion={status} onDone={() => setView('idle')} onReset={() => { setStatus('unconfigured'); setView('idle') }} onBack={() => setView('idle')} />

  return (
    <div style={{ width:'100%' }}>
      {/* Page heading — same structure as Workspace and Settings */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
        <h2 style={{ fontSize:20,fontWeight:700,color:'#EDEDFF',margin:0,fontFamily:"'Space Grotesk',sans-serif" }}>Vault</h2>
      </div>
      <div style={{ fontSize:12,color:'#8888AA',marginBottom:20,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
        <span style={{ background:'rgba(99,102,241,.08)',color:'#6366F1',border:'1px solid rgba(99,102,241,.2)',borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>Zero-knowledge</span>
        <span style={{ background:'rgba(99,102,241,.08)',color:'#6366F1',border:'1px solid rgba(99,102,241,.2)',borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>End-to-end encrypted</span>
        <span style={{ color:'#7A7AAA' }}>&middot; {status === 'v2' ? 'ECDH P-256 · AES-256-GCM' : 'Client-side encryption only'}</span>
      </div>

      {status === 'unconfigured' && (
        <>
          <p style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.8 }}>
            Every file is encrypted on your device with a unique key before upload.
            DataDrop never sees your encryption keys or file contents. You set a 6-digit PIN —
            and save a 12-word recovery phrase in case you forget it.
          </p>
          <button onClick={() => setView('setup')} style={btn(true)}>Set up Vault</button>
        </>
      )}

      {status === 'v1' && (
        <div style={{ marginBottom:16, padding:'12px 16px', background:'rgba(99,102,241,0.08)',
                       border:'1px solid rgba(99,102,241,0.25)', borderRadius:10 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#EDEDFF', marginBottom:4 }}>
            Upgrade required for Secured Sharing
          </div>
          <div style={{ fontSize:12, color:'#8888AA', marginBottom:12, lineHeight:1.6 }}>
            Workspace creation uses ECDH encryption (Vault V2). Your current vault is V1.
            Upgrade by setting a new PIN — your existing vault files are not affected.
          </div>
          <button onClick={() => setView('setup')} style={btn(true)}>Upgrade to V2</button>
        </div>
      )}

      {(status === 'v1' || status === 'v2') && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={() => setView('unlock')}  style={btn(true)}>Unlock Vault</button>
          <button onClick={() => setView('recover')} style={btn(false)}>Forgot PIN</button>
        </div>
      )}
    </div>
  )
}

// ---- Vault file browser ----
function VaultBrowser({ onLock }) {
  const toast          = useToastMethods()
  const [files,        setFiles]        = useState([])
  const [folders,      setFolders]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [uploading,    setUploading]    = useState([])
  const [preview,      setPreview]      = useState(null)
  const [versionsFile, setVersionsFile] = useState(null)
  const [folderStack,  setFolderStack]  = useState([])
  const [renaming,     setRenaming]     = useState(null)
  const [renameVal,    setRenameVal]    = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('')
  const [selectedIds,       setSelectedIds]       = useState(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState(new Set())
  const [showVaultMoveModal, setShowVaultMoveModal] = useState(false)
  const [showVaultCopyModal, setShowVaultCopyModal] = useState(false)
  const [vaultProgress, setVaultProgress] = useState(null)
  const [deleteConfirm,  setDeleteConfirm]  = useState(null)
  const fileInputRef        = useRef()
  const conflictResolverRef = useRef(null)
  const [conflictTarget, setConflictTarget] = useState(null)
  const folderConflictResolverRef = useRef(null)
  const [folderConflictTarget, setFolderConflictTarget] = useState(null)

  const v1Key         = sessionStorage.getItem('dd_vault_key')
  const v2PrivKeyB64  = sessionStorage.getItem('dd_vault_private_key_pkcs8')
  const isV2Session   = !!v2PrivKeyB64

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null

  async function decryptThumbnails(fileList) {
    const toDecrypt = fileList.filter(f => f.thumb_data?.startsWith('enc_thumb:'))
    if (!toDecrypt.length) return
    const updates = {}
    await Promise.all(toDecrypt.map(async file => {
      try {
        const encBytesB64 = file.thumb_data.slice(10)
        const encBytes = Uint8Array.from(atob(encBytesB64), c => c.charCodeAt(0))
        let plainBytes
        if (isV2Session) {
          const keyData = await api.getVaultFileKey(file.id)
          const dek = await unwrapDEKWithPrivateKey(keyData.encryptedDek, keyData.dekNonce, keyData.ephemeralPublicKey, v2PrivKeyB64)
          plainBytes = new Uint8Array(await decryptWithDEK(dek, encBytes.buffer))
        } else if (v1Key) {
          plainBytes = new Uint8Array(await decryptFromVault(v1Key, encBytes.buffer))
        } else return
        const blob = new Blob([plainBytes], { type: 'image/webp' })
        updates[file.id] = await new Promise((res, rej) => {
          const r = new FileReader()
          r.onload = e => res(e.target.result)
          r.onerror = rej
          r.readAsDataURL(blob)
        })
      } catch (_) {}
    }))
    if (Object.keys(updates).length) {
      setFiles(prev => prev.map(f => updates[f.id] ? { ...f, thumb_data: updates[f.id] } : f))
    }
  }

  async function loadFiles() {
    setLoading(true)
    try {
      const params = { vault: '1' }
      if (currentFolderId) params.folder = currentFolderId
      const d = await api.listFiles(params)
      const fileList = d.files || []
      setFiles(fileList)
      setFolders(d.folders || [])
      decryptThumbnails(fileList)
    } catch (_) {
      toast.error('Failed to load vault files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFiles(); setSelectedIds(new Set()) }, [currentFolderId])

  function openFolder(folder) { setFolderStack(prev => [...prev, { id: folder.id, name: folder.name }]) }
  function navigateTo(idx)    { setFolderStack(prev => idx < 0 ? [] : prev.slice(0, idx + 1)) }
  function toggleFile(id)     { setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }
  function toggleFolder(id)   { setSelectedFolderIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s }) }

  function showVaultConflict(name, existing) {
    return new Promise(resolve => {
      conflictResolverRef.current = resolve
      setConflictTarget({ name, existing })
    })
  }

  function resolveConflict(decision) {
    setConflictTarget(null)
    if (conflictResolverRef.current) {
      conflictResolverRef.current(decision)
      conflictResolverRef.current = null
    }
  }

  function showFolderConflictDialog(name) {
    return new Promise(resolve => {
      folderConflictResolverRef.current = resolve
      setFolderConflictTarget({ name })
    })
  }

  function resolveFolderConflict(result) {
    setFolderConflictTarget(null)
    if (folderConflictResolverRef.current) {
      folderConflictResolverRef.current(result)
      folderConflictResolverRef.current = null
    }
  }

  async function resolveFolderConflicts(selectedFolders, destSection, destFolderId, destTeamId) {
    let destFolders = []
    try {
      if (destSection === 'teams' && destTeamId) {
        const d = await api.listTeamFiles(destTeamId, destFolderId ? { folderId: destFolderId } : {})
        destFolders = d.folders || []
      } else if (destSection === 'vault') {
        const params = { vault: '1' }
        if (destFolderId) params.folder = destFolderId
        const d = await api.listFiles(params)
        destFolders = d.folders || []
      } else {
        const d = await api.listFiles(destFolderId ? { folder: destFolderId } : {})
        destFolders = d.folders || []
      }
    } catch (_) {}
    const destByName = new Set(destFolders.map(f => f.name))
    const decisions = new Map()
    for (const folder of selectedFolders) {
      if (destByName.has(folder.name)) {
        const result = await showFolderConflictDialog(folder.name)
        decisions.set(folder.id, result)
      }
    }
    return decisions
  }

  async function handleUpload(fileList) {
    if (!v1Key && !v2PrivKeyB64) { toast.error('Vault not unlocked'); return }

    // For V2 we need the public key to wrap the DEK
    let userPublicKey = null
    if (isV2Session) {
      try {
        const me = await api.me()
        userPublicKey = me.user?.public_key
        if (!userPublicKey) throw new Error('public_key not found')
      } catch (_) {
        toast.error('Could not retrieve encryption key — please re-unlock the vault')
        return
      }
    }

    for (const file of Array.from(fileList)) {
      let existing = files.find(f => f.filename === file.name)
      let makeVersion = false
      let uploadName = file.name
      if (existing) {
        const decision = await showVaultConflict(file.name, existing)
        if (decision === 'cancel') continue
        if (decision === 'version') {
          makeVersion = true
        } else if (decision === 'replace') {
          await api.permanentDeleteFile(existing.id)
          existing = null
        } else if (decision && decision.decision === 'keep' && decision.customName) {
          uploadName = decision.customName
          existing = null
        }
      }
      const uid = Math.random().toString(36).slice(2)
      setUploading(prev => [...prev, { uid, name: file.name, progress: 0, done: false, error: false }])
      try {
        const plainBuffer = await file.arrayBuffer()
        let encBlob, fileKeyPayload = null

        let dekBytes = null
        if (isV2Session) {
          // V2: per-file DEK, ECDH-wrapped
          dekBytes = crypto.getRandomValues(new Uint8Array(32))
          const encBuffer = await encryptWithDEK(dekBytes, plainBuffer)
          encBlob = new Blob([encBuffer])
          fileKeyPayload = await wrapDEKWithPublicKey(dekBytes, userPublicKey)
        } else {
          // V1: shared vault key
          const encBuffer = await encryptForVault(v1Key, plainBuffer)
          encBlob = new Blob([encBuffer])
        }

        const encFile = new File([encBlob], uploadName, { type: 'application/octet-stream' })

        // Generate encrypted thumbnail from original file before upload
        let thumbData = `encrypted:${file.type || 'application/octet-stream'}`
        try {
          const mime = file.type || ''
          let rawThumb = null
          if (mime.startsWith('image/')) rawThumb = await generateThumb(file)
          else if (mime.startsWith('video/')) rawThumb = await generateVideoThumb(file)
          if (rawThumb) {
            const rawBytes = Uint8Array.from(atob(rawThumb.split(',')[1]), c => c.charCodeAt(0))
            let encBuf
            if (dekBytes) encBuf = await encryptWithDEK(dekBytes, rawBytes.buffer)
            else if (v1Key) encBuf = await encryptForVault(v1Key, rawBytes.buffer)
            if (encBuf) thumbData = 'enc_thumb:' + btoa(String.fromCharCode(...new Uint8Array(encBuf)))
          }
        } catch (_) {}

        const { fileId } = await uploadFile(encFile, {
          isVault: true,
          skipDedup: true,
          folderId: currentFolderId,
          mimeType: `encrypted:${file.type || 'application/octet-stream'}`,
          thumbData,
        }, p => {
          setUploading(prev => prev.map(u => u.uid === uid ? { ...u, progress: p } : u))
        })

        // Link new upload as a version of the existing file
        if (makeVersion && existing && fileId) {
          let promoted = false
          for (let attempt = 0; attempt < 10 && !promoted; attempt++) {
            try {
              await api.updateFile(existing.id, { promoteFrom: fileId })
              promoted = true
            } catch (_) {
              if (attempt < 9) await new Promise(r => setTimeout(r, 600))
            }
          }
        }

        setUploading(prev => prev.map(u => u.uid === uid ? { ...u, done: true } : u))
        // Wait for queue consumer to insert file record into D1 (max_batch_timeout = 5s)
        // and for B2 to propagate the upload. storeVaultFileKey requires the file to exist in D1.
        await new Promise(r => setTimeout(r, 6000))

        // Store per-file DEK — must happen after D1 insert (queue-based, up to 5s delay)
        if (fileKeyPayload && fileId) {
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              await api.storeVaultFileKey({
                fileId,
                encryptedDek:       fileKeyPayload.encryptedDek,
                dekNonce:           fileKeyPayload.dekNonce,
                ephemeralPublicKey: fileKeyPayload.ephemeralPublicKey,
              })
              break
            } catch (e) {
              if (e.status !== 404 || attempt === 2) break
              await new Promise(r => setTimeout(r, 2000))
            }
          }
        }

        await loadFiles()
      } catch (e) {
        setUploading(prev => prev.map(u => u.uid === uid ? { ...u, error: true } : u))
        toast.error(`Upload failed: ${e.message}`)
      }
    }
    setTimeout(() => setUploading([]), 3000)
  }

  // Decrypt vault file and return Uint8Array
  async function decryptVaultFile(file) {
    const resp = await fetchFileWithAuth(file.id)
    const encBuffer = await resp.arrayBuffer()

    if (isV2Session) {
      try {
        const keyData = await api.getVaultFileKey(file.id)
        const dekBytes = await unwrapDEKWithPrivateKey(
          keyData.encryptedDek, keyData.dekNonce, keyData.ephemeralPublicKey, v2PrivKeyB64
        )
        return new Uint8Array(await decryptWithDEK(dekBytes, encBuffer))
      } catch (_) {
        // fallback: try V1 key in case this was a V1-era file
        if (v1Key) return new Uint8Array(await decryptFromVault(v1Key, encBuffer))
        throw new Error('Could not decrypt file')
      }
    } else {
      return new Uint8Array(await decryptFromVault(v1Key, encBuffer))
    }
  }

  async function moveVaultFolderTreeToFiles(sourceFolder, targetFolderId, onFileStart, { deleteSource = true, overrideName } = {}) {
    let newFolderId
    const folderName = overrideName || sourceFolder.name
    try {
      const res = await api.createFolder({ name: folderName, parentId: targetFolderId || null })
      newFolderId = res.folderId
    } catch (e) {
      if (e.status === 409) {
        const d = await api.listFiles(targetFolderId ? { folder: targetFolderId } : {})
        const existing = (d.folders || []).find(f => f.name === folderName)
        if (!existing) throw e
        newFolderId = existing.id
      } else throw e
    }
    const params = { vault: '1', folder: sourceFolder.id }
    const d = await api.listFiles(params)
    for (const file of (d.files || [])) {
      onFileStart(file.filename)
      try {
        const plainBytes = await decryptVaultFile(file)
        const realMime = file.mime_type?.startsWith('encrypted:') ? file.mime_type.slice(10) : (file.mime_type || 'application/octet-stream')
        let thumbData = null
        try {
          const tempFile = new File([plainBytes], file.filename, { type: realMime })
          let rawThumb = null
          if (realMime.startsWith('image/')) rawThumb = await generateThumb(tempFile)
          else if (realMime.startsWith('video/')) rawThumb = await generateVideoThumb(tempFile)
          if (rawThumb) thumbData = rawThumb
        } catch (_) {}
        const plainFile = new File([plainBytes], file.filename, { type: realMime })
        await uploadFile(plainFile, { isVault: false, skipDedup: true, thumbData, folderId: newFolderId })
        await new Promise(r => setTimeout(r, 6000))
        if (deleteSource) await api.permanentDeleteFile(file.id)
      } catch (_) {}
    }
    for (const subfolder of (d.folders || [])) {
      await moveVaultFolderTreeToFiles(subfolder, newFolderId, onFileStart, { deleteSource })
    }
    if (deleteSource) try { await api.permanentDeleteFolder(sourceFolder.id) } catch (_) {}
  }

  async function moveVaultFolderTreeToTeam(sourceFolder, teamId, teamKeyB64, teamParentFolderId, onFileStart, { deleteSource = true, overrideName } = {}) {
    let newTeamFolderId
    const folderName = overrideName || sourceFolder.name
    try {
      const res = await api.createTeamFolder(teamId, { name: folderName, parentId: teamParentFolderId || null })
      newTeamFolderId = res.folderId
    } catch (e) {
      if (e.status === 409) {
        const d = await api.listTeamFiles(teamId, teamParentFolderId ? { folderId: teamParentFolderId } : {})
        const existing = (d.folders || []).find(f => f.name === folderName)
        if (!existing) throw e
        newTeamFolderId = existing.id
      } else throw e
    }
    const d = await api.listFiles({ vault: '1', folder: sourceFolder.id })
    for (const file of (d.files || [])) {
      onFileStart(file.filename)
      try {
        const plainBytes = await decryptVaultFile(file)
        const realMime = file.mime_type?.startsWith('encrypted:') ? file.mime_type.slice(10) : (file.mime_type || 'application/octet-stream')
        const encBuf = await encryptForVault(teamKeyB64, plainBytes.buffer)
        let thumbData = null
        try {
          const tempFile = new File([plainBytes], file.filename, { type: realMime })
          let rawThumb = null
          if (realMime.startsWith('image/')) rawThumb = await generateThumb(tempFile)
          else if (realMime.startsWith('video/')) rawThumb = await generateVideoThumb(tempFile)
          if (rawThumb) {
            const rawBytes = Uint8Array.from(atob(rawThumb.split(',')[1]), c => c.charCodeAt(0))
            const encThumbBuf = await encryptForVault(teamKeyB64, rawBytes.buffer)
            thumbData = 'enc_thumb:' + btoa(String.fromCharCode(...new Uint8Array(encThumbBuf)))
          }
        } catch (_) {}
        const encFile = new File([encBuf], file.filename, { type: 'application/octet-stream' })
        const encMime = `encrypted:${realMime}`
        await uploadFile(encFile, { mimeType: encMime, folderId: newTeamFolderId, isVault: false, isEncrypted: true, teamId, skipDedup: true, thumbData })
        if (deleteSource) await api.permanentDeleteFile(file.id)
      } catch (_) {}
    }
    for (const subfolder of (d.folders || [])) {
      await moveVaultFolderTreeToTeam(subfolder, teamId, teamKeyB64, newTeamFolderId, onFileStart, { deleteSource })
    }
    if (deleteSource) try { await api.permanentDeleteFolder(sourceFolder.id) } catch (_) {}
  }

  function handleDelete(file) { setDeleteConfirm({ type: 'single', file }) }

  async function executeDelete() {
    if (!deleteConfirm) return
    const confirm = deleteConfirm
    setDeleteConfirm(null)
    if (confirm.type === 'single') {
      const file = confirm.file
      setFiles(prev => prev.filter(f => f.id !== file.id))
      try {
        await api.permanentDeleteFile(file.id)
        toast.success('Permanently deleted from Vault')
      } catch (e) {
        toast.error(e.message); loadFiles()
      }
    } else {
      const ids = confirm.ids || []
      const folderIds = confirm.folderIds || []
      setSelectedIds(new Set())
      setSelectedFolderIds(new Set())
      setFiles(prev => prev.filter(f => !ids.includes(f.id)))
      setFolders(prev => prev.filter(f => !folderIds.includes(f.id)))
      let failed = false
      try { if (ids.length) await Promise.all(ids.map(id => api.permanentDeleteFile(id))) }
      catch (_) { failed = true }
      try { if (folderIds.length) await Promise.all(folderIds.map(id => api.permanentDeleteFolder(id))) }
      catch (_) { failed = true }
      if (failed) { toast.error('Some items could not be deleted'); loadFiles() }
      else toast.success('Permanently deleted')
    }
  }

  async function handleMoveOut(file, targetFolderId = null, { deleteSource = true } = {}) {
    const isEncrypted = file.mime_type?.startsWith('encrypted:')
    if (!isEncrypted) {
      if (!deleteSource) return  // non-encrypted vault files: copy not supported without re-upload
      try {
        await api.updateFile(file.id, { isVault: false, folderId: targetFolderId })
        setFiles(prev => prev.filter(f => f.id !== file.id))
        toast.success(`"${file.filename}" moved to Files`)
      } catch (e) { toast.error(e.message) }
      return
    }

    const realMimeType = file.mime_type.slice(10)
    try {
      const plainBytes = await decryptVaultFile(file)
      const plainBlob  = new Blob([plainBytes], { type: realMimeType })
      const plainFile  = new File([plainBlob], file.filename, { type: realMimeType })
      let thumbData = null
      try {
        let rawThumb = null
        if (realMimeType.startsWith('image/')) rawThumb = await generateThumb(plainFile)
        else if (realMimeType.startsWith('video/')) rawThumb = await generateVideoThumb(plainFile)
        if (rawThumb) thumbData = rawThumb
      } catch (_) {}
      await uploadFile(plainFile, { isVault: false, skipDedup: true, thumbData, folderId: targetFolderId })
      await new Promise(r => setTimeout(r, 6000))
      if (deleteSource) {
        await api.permanentDeleteFile(file.id)
        setFiles(prev => prev.filter(f => f.id !== file.id))
      }
      toast.success(`"${file.filename}" ${deleteSource ? 'moved' : 'copied'} to Files`)
    } catch (e) {
      toast.error(`${deleteSource ? 'Move' : 'Copy'} failed: ${e.message}`)
    }
  }

  function handleBulkDelete() {
    const ids = [...selectedIds]
    const folderIds = [...selectedFolderIds]
    if (!ids.length && !folderIds.length) return
    setDeleteConfirm({ type: 'bulk', ids, folderIds })
  }

  async function handleVaultMoveModalConfirm(section, folderId, teamId = null, { deleteSource = true } = {}) {
    const selectedFiles = files.filter(f => selectedIds.has(f.id))
    const selectedFolderObjs = folders.filter(f => selectedFolderIds.has(f.id))
    setSelectedIds(new Set())
    setSelectedFolderIds(new Set())
    setShowVaultMoveModal(false)
    setShowVaultCopyModal(false)

    if (section === 'vault') {
      try {
        await Promise.all(selectedFiles.map(f => api.updateFile(f.id, { folderId: folderId ?? null })))
        if (selectedFolderObjs.length) {
          await Promise.all(selectedFolderObjs.map(f => api.renameFolder(f.id, { parentId: folderId ?? null })))
        }
        toast.success(`${deleteSource ? 'Moved' : 'Moved'} ${selectedFiles.length + selectedFolderObjs.length} item(s) within Vault`)
        loadFiles()
      } catch (e) { toast.error(e.message) }
      return
    }

    if (section === 'teams') {
      const teamKeyB64 = teamId ? sessionStorage.getItem(`team_key_${teamId}`) : null
      if (!teamKeyB64) { toast.error('Workspace is locked — open it in Secured Sharing first'); return }
      const folderConflicts = await resolveFolderConflicts(selectedFolderObjs, 'teams', folderId, teamId)
      const totalCount = selectedFiles.length + selectedFolderObjs.length
      setVaultProgress({ done: 0, total: totalCount, filename: '' })
      let done = 0, success = 0
      for (const file of selectedFiles) {
        setVaultProgress({ done: done++, total: totalCount, filename: file.filename })
        try {
          const plainBytes = await decryptVaultFile(file)
          const realMime = file.mime_type?.startsWith('encrypted:') ? file.mime_type.slice(10) : (file.mime_type || 'application/octet-stream')
          const encBuf = await encryptForVault(teamKeyB64, plainBytes.buffer)
          let thumbData = null
          try {
            const tempFile = new File([plainBytes], file.filename, { type: realMime })
            let rawThumb = null
            if (realMime.startsWith('image/')) rawThumb = await generateThumb(tempFile)
            else if (realMime.startsWith('video/')) rawThumb = await generateVideoThumb(tempFile)
            if (rawThumb) {
              const rawBytes = Uint8Array.from(atob(rawThumb.split(',')[1]), c => c.charCodeAt(0))
              const encThumbBuf = await encryptForVault(teamKeyB64, rawBytes.buffer)
              thumbData = 'enc_thumb:' + btoa(String.fromCharCode(...new Uint8Array(encThumbBuf)))
            }
          } catch (_) {}
          const encFile = new File([encBuf], file.filename, { type: 'application/octet-stream' })
          const encMime = `encrypted:${realMime}`
          await uploadFile(encFile, { mimeType: encMime, folderId, isVault: false, isEncrypted: true, teamId, skipDedup: true, thumbData })
          if (deleteSource) await api.permanentDeleteFile(file.id)
          success++
        } catch (_) {}
      }
      for (const folder of selectedFolderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        setVaultProgress({ done: done++, total: totalCount, filename: folder.name })
        try {
          const overrideName = fc?.action === 'rename' ? fc.customName : undefined
          await moveVaultFolderTreeToTeam(folder, teamId, teamKeyB64, folderId, filename => {
            setVaultProgress(p => ({ ...p, filename }))
          }, { deleteSource, overrideName })
          success++
        } catch (_) {}
      }
      setVaultProgress(null)
      if (success > 0) toast.success(`${deleteSource ? 'Moved' : 'Copied'} ${success} item(s) to workspace`)
      loadFiles()
      return
    }

    // Files section
    const folderConflicts = await resolveFolderConflicts(selectedFolderObjs, 'files', folderId, null)
    const totalCount = selectedFiles.length + selectedFolderObjs.length
    setVaultProgress({ done: 0, total: totalCount, filename: '' })
    let done = 0, success = 0
    for (const file of selectedFiles) {
      setVaultProgress({ done: done++, total: totalCount, filename: file.filename })
      try { await handleMoveOut(file, folderId, { deleteSource }); success++ } catch (_) {}
    }
    for (const folder of selectedFolderObjs) {
      const fc = folderConflicts.get(folder.id)
      if (fc?.action === 'cancel') continue
      setVaultProgress({ done: done++, total: totalCount, filename: folder.name })
      try {
        const overrideName = fc?.action === 'rename' ? fc.customName : undefined
        await moveVaultFolderTreeToFiles(folder, folderId, filename => {
          setVaultProgress(p => ({ ...p, filename }))
        }, { deleteSource, overrideName })
        success++
      } catch (_) {}
    }
    setVaultProgress(null)
    if (success > 0) toast.success(`${deleteSource ? 'Moved' : 'Copied'} ${success} item(s) to Files`)
    loadFiles()
  }

  async function submitRename() {
    if (!renameVal.trim() || !renaming) return
    try {
      await api.updateFile(renaming.id, { filename: renameVal.trim() })
      setFiles(prev => prev.map(f => f.id === renaming.id ? { ...f, filename: renameVal.trim() } : f))
      setRenaming(null)
      toast.success('Renamed')
    } catch (e) { toast.error(e.message) }
  }

  async function handleDeleteFolder(folder) {
    try {
      await api.permanentDeleteFolder(folder.id)
      setFolders(prev => prev.filter(f => f.id !== folder.id))
      toast.success('Folder permanently deleted')
    } catch (e) { toast.error(e.message) }
  }

  async function handleRenameFolder(folder, newName) {
    try {
      await api.renameFolder(folder.id, { name: newName })
      setFolders(prev => prev.map(f => f.id === folder.id ? { ...f, name: newName } : f))
      toast.success('Folder renamed')
    } catch (e) { toast.error(e.message) }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    try {
      const { folderId } = await api.createFolder({ name: newFolderName.trim(), parentId: currentFolderId, isVault: true })
      setFolders(prev => [...prev, { id: folderId, name: newFolderName.trim(), created_at: Date.now() }])
      setCreatingFolder(false)
      setNewFolderName('')
      toast.success('Folder created')
    } catch (e) { toast.error(e.message) }
  }

  function previewFile(file) {
    if (!file) return null
    if (file.mime_type?.startsWith('encrypted:')) return { ...file, mime_type: file.mime_type.slice(10) }
    return file
  }

  return (
    <div>
      {preview && (
        <FilePreview
          file={previewFile(preview)}
          onClose={() => setPreview(null)}
          vaultKey={preview.mime_type?.startsWith('encrypted:') ? v1Key : null}
          vaultPrivKeyB64={isV2Session && preview.mime_type?.startsWith('encrypted:') ? v2PrivKeyB64 : null}
        />
      )}
      {versionsFile && (
        <VersionHistory file={versionsFile} onClose={() => setVersionsFile(null)} onRestored={loadFiles}
          onPreview={v => setPreview(v)} />
      )}

      {conflictTarget && (
        <VaultConflictModal
          name={conflictTarget.name}
          existing={conflictTarget.existing}
          onDecide={resolveConflict}
        />
      )}
      {folderConflictTarget && (
        <VaultFolderConflictModal
          name={folderConflictTarget.name}
          onDecide={resolveFolderConflict}
        />
      )}

      {deleteConfirm && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#EDEDFF' }}>Delete permanently?</h3>
            <p style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.6 }}>
              These files/folders will be permanently deleted. This cannot be undone.
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={executeDelete} style={{ flex:1, ...btn(false, true) }}>Delete permanently</button>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex:1, ...btn(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {renaming && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16, color:'#EDEDFF' }}>Rename file</h3>
            <input autoFocus value={renameVal} onChange={e=>setRenameVal(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') submitRename(); if(e.key==='Escape') setRenaming(null) }}
              style={{ width:'100%',padding:'10px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,
                        fontSize:14,outline:'none',marginBottom:16,boxSizing:'border-box',
                        background:'#161625',color:'#EDEDFF' }} />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={submitRename} style={{ flex:1, ...btn(true) }}>Rename</button>
              <button onClick={()=>setRenaming(null)} style={{ flex:1, ...btn(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {creatingFolder && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ fontSize:16, fontWeight:700, marginBottom:16, color:'#EDEDFF' }}>New folder in Vault</h3>
            <input autoFocus value={newFolderName} onChange={e=>setNewFolderName(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter') handleCreateFolder(); if(e.key==='Escape'){setCreatingFolder(false);setNewFolderName('')} }}
              placeholder="Folder name"
              style={{ width:'100%',padding:'10px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,
                        fontSize:14,outline:'none',marginBottom:16,boxSizing:'border-box',
                        background:'#161625',color:'#EDEDFF' }} />
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={handleCreateFolder} style={{ flex:1, ...btn(true) }}>Create</button>
              <button onClick={()=>{setCreatingFolder(false);setNewFolderName('')}} style={{ flex:1, ...btn(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',
                     marginBottom:8,flexWrap:'wrap',gap:10 }}>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:32,height:32,borderRadius:9,flexShrink:0,
                         background:'linear-gradient(145deg,rgba(99,102,241,0.22),rgba(99,102,241,0.07))',
                         border:'1.5px solid rgba(99,102,241,0.35)',
                         display:'flex',alignItems:'center',justifyContent:'center',
                         boxShadow:'0 0 0 2px rgba(99,102,241,0.08),0 2px 10px rgba(99,102,241,0.2)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <rect x="5" y="12" width="14" height="9" rx="2.5" stroke="#6366F1" strokeWidth="1.5" fill="#6366F1" fillOpacity=".15"/>
              <path d="M8 12V9A4 4 0 0 1 16 9V12" stroke="#6366F1" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="12" cy="16.5" r="1.8" fill="#6366F1"/>
            </svg>
          </div>
          <h2 style={{ fontSize:20,fontWeight:700,color:'#EDEDFF',margin:0 }}>Vault</h2>
          <button onClick={onLock}
            style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 12px',
                      background:'transparent',border:'1px solid rgba(255,255,255,.07)',
                      borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:500,color:'#8888AA',
                      transition:'border-color 150ms,color 150ms' }}
            onMouseEnter={e=>{ e.currentTarget.style.borderColor='rgba(255,255,255,.14)'; e.currentTarget.style.color='#EDEDFF' }}
            onMouseLeave={e=>{ e.currentTarget.style.borderColor='rgba(255,255,255,.07)'; e.currentTarget.style.color='#8888AA' }}>
            <svg width={12} height={12} viewBox="0 0 14 14" fill="none">
              <rect x="2" y="6" width="10" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Lock
          </button>
        </div>
        <div style={{ display:'flex',gap:8,alignItems:'center' }}>
          <button onClick={()=>setCreatingFolder(true)} style={{ ...btn(false),padding:'8px 14px',fontSize:13 }}>+ Folder</button>
          <button onClick={()=>fileInputRef.current?.click()} style={{ ...btn(true),padding:'8px 14px',fontSize:13 }}>Upload</button>
        </div>
        <input ref={fileInputRef} type="file" multiple style={{ display:'none' }}
          onChange={e=>{ const f=Array.from(e.target.files); e.target.value=''; handleUpload(f) }} />
      </div>
      <div style={{ fontSize:12,color:'#8888AA',marginBottom:16,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
        <span style={{ background:'rgba(99,102,241,.08)',color:'#6366F1',border:'1px solid rgba(99,102,241,.2)',
                        borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>Zero-knowledge</span>
        {isV2Session && (
          <span style={{ background:'rgba(136,136,170,.07)',color:'#8888AA',border:'1px solid rgba(136,136,170,.15)',
                          borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>ECDH P-256</span>
        )}
        <span style={{ background:'rgba(136,136,170,.07)',color:'#8888AA',border:'1px solid rgba(136,136,170,.15)',
                        borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>AES-256-GCM</span>
        <span style={{ color:'#7A7AAA',fontSize:11 }}>&middot; Decrypted locally only</span>
      </div>

      {/* Breadcrumbs */}
      {folderStack.length > 0 && (
        <div style={{ display:'flex',alignItems:'center',gap:4,marginBottom:16,fontSize:13,flexWrap:'wrap' }}>
          <button onClick={()=>navigateTo(-1)}
            style={{ background:'none',border:'none',color:'#8888AA',cursor:'pointer',padding:'2px 4px',fontSize:13 }}>
            Vault
          </button>
          {folderStack.map((f, i) => (
            <React.Fragment key={f.id}>
              <span style={{ color:'#7A7AAA' }}>›</span>
              <button onClick={()=>navigateTo(i)}
                style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontSize:13,
                          color:i===folderStack.length-1?'#EDEDFF':'#8888AA',
                          fontWeight:i===folderStack.length-1?600:400 }}>
                {f.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <UploadProgressPanel uploads={uploading} />

      {/* Bulk action bar */}
      {(selectedIds.size + selectedFolderIds.size) > 0 && (
        <div style={{ padding:'10px 16px',background:'#111130',border:'1px solid rgba(255,255,255,.07)',
                       display:'flex',alignItems:'center',gap:14,fontSize:13,
                       borderRadius:10,marginBottom:14 }}>
          <span style={{ fontWeight:600,color:'#EDEDFF' }}>{selectedIds.size + selectedFolderIds.size} selected</span>
          <button onClick={()=>{setSelectedIds(new Set(files.map(f=>f.id)));setSelectedFolderIds(new Set(folders.map(f=>f.id)))}}
            style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0 }}>
            Select all
          </button>
          <div style={{ flex:1 }} />
          {(selectedIds.size + selectedFolderIds.size) > 0 && (
            <button onClick={() => setShowVaultMoveModal(true)}
              style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
              → Move
            </button>
          )}
          {(selectedIds.size + selectedFolderIds.size) > 0 && (
            <button onClick={() => setShowVaultCopyModal(true)}
              style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
              ⧉ Copy to
            </button>
          )}
          <button onClick={handleBulkDelete}
            style={{ color:'#E24B4A',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
            Delete
          </button>
          <button onClick={()=>{setSelectedIds(new Set());setSelectedFolderIds(new Set())}}
            style={{ background:'rgba(255,255,255,0.06)',color:'#8888AA',border:'none',borderRadius:7,
                       padding:'5px 10px',fontSize:12,cursor:'pointer' }}>
            Cancel
          </button>
        </div>
      )}

      <FileGrid
        files={files}
        folders={folders}
        view="files"
        loading={loading}
        onOpenFolder={openFolder}
        onPreview={f => setPreview(f)}
        onShare={null}
        onDelete={handleDelete}
        onRestore={() => {}}
        onRename={f => { setRenaming({ id: f.id, name: f.name }); setRenameVal(f.name) }}
        onVersions={f => setVersionsFile(f)}
        onMoveOutOfVault={handleMoveOut}
        onDeleteFolder={handleDeleteFolder}
        onRenameFolder={handleRenameFolder}
        selectedFileIds={selectedIds}
        selectedFolderIds={selectedFolderIds}
        onToggleFile={toggleFile}
        onToggleFolder={toggleFolder}
      />

      {vaultProgress && (
        <div style={{ position:'fixed',bottom:24,right:24,zIndex:400,background:'#111130',border:'1px solid rgba(255,255,255,.07)',
                       borderRadius:12,padding:'14px 18px',minWidth:260,boxShadow:'0 8px 32px rgba(0,0,0,.5)' }}>
          <div style={{ fontSize:13,fontWeight:600,color:'#EDEDFF',marginBottom:6 }}>
            {vaultProgress.filename || 'Processing…'}
          </div>
          <div style={{ height:4,background:'rgba(255,255,255,.07)',borderRadius:2,overflow:'hidden' }}>
            <div style={{ height:'100%',background:'#6366F1',borderRadius:2,transition:'width .3s',
                           width:vaultProgress.total ? `${Math.round((vaultProgress.done/vaultProgress.total)*100)}%` : '0%' }} />
          </div>
          <div style={{ fontSize:11,color:'#7A7AAA',marginTop:4 }}>
            {vaultProgress.done} / {vaultProgress.total}
          </div>
        </div>
      )}
      {showVaultMoveModal && (
        <FileMoveModal
          initialSection="vault"
          selectedCount={selectedIds.size + selectedFolderIds.size}
          excludeFolderIds={selectedFolderIds}
          onMove={(section, folderId, teamId) => handleVaultMoveModalConfirm(section, folderId, teamId, { deleteSource: true })}
          onClose={() => setShowVaultMoveModal(false)}
        />
      )}
      {showVaultCopyModal && (
        <FileMoveModal
          initialSection="vault"
          selectedCount={selectedIds.size + selectedFolderIds.size}
          excludeFolderIds={selectedFolderIds}
          actionLabel="Copy Here"
          onMove={(section, folderId, teamId) => handleVaultMoveModalConfirm(section, folderId, teamId, { deleteSource: false })}
          onClose={() => setShowVaultCopyModal(false)}
        />
      )}
    </div>
  )
}

// ---- VaultPinModal — exported for Dashboard use ----
export function VaultPinModal({ onUnlocked, onClose }) {
  const toast    = useToastMethods()
  const [pin,    setPin]     = useState('')
  const [loading,setLoading] = useState(false)
  const [status, setStatus]  = useState(null)

  useEffect(() => {
    api.vaultStatus().then(d => setStatus(d.isV2 ? 'v2' : d.configured ? 'v1' : null)).catch(() => {})
  }, [])

  async function unlock() {
    if (pin.length !== 6) { toast.error('Enter your 6-digit PIN'); return }
    setLoading(true)
    try {
      if (status === 'v2') {
        const cfg   = await api.vaultConfigV2()
        const pinH  = await derivePinHash(pin, cfg.pinSalt)
        if (pinH !== cfg.pinHash) throw new Error('Incorrect PIN')
        const pkcs8 = await decryptPrivateKeyWithPin(cfg.encryptedPrivateKey, cfg.privateKeyIv, cfg.privateKeySalt, pin)
        sessionStorage.setItem('dd_vault_private_key_pkcs8', pkcs8)
      } else {
        const saltRes = await api.vaultSalt()
        const pinHash = await hashPin(pin, saltRes.salt)
        const res     = await api.verifyPin({ pinHash })
        const pinKey  = await pbkdf2(pin, saltRes.salt)
        const vaultKey = await aesDecrypt(pinKey, res.encryptedVaultKey)
        sessionStorage.setItem('dd_vault_key', vaultKey)
      }
      onUnlocked()
    } catch (e) {
      toast.error(e.status === 429 ? (e.data?.error || 'Too many attempts') : 'Incorrect PIN')
    }
    setLoading(false)
  }

  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth:340 }}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:6, color:'#EDEDFF' }}>
          Vault PIN required
        </h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:18, lineHeight:1.5 }}>
          Unlock your Zero Knowledge Vault to move files in or out.
        </p>
        <PinInput value={pin} onChange={setPin} label="PIN" autoFocus />
        <div style={{ display:'flex', gap:10, marginTop:4 }}>
          <button onClick={unlock} disabled={loading}
            style={{ flex:1, ...btn(true), cursor:loading?'wait':'pointer', opacity:loading?.7:1 }}>
            {loading ? 'Unlocking…' : 'Unlock & continue'}
          </button>
          <button onClick={onClose} style={{ flex:1, ...btn(false) }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Vault conflict modal ──────────────────────────────────────────────────
function VaultConflictModal({ name, existing, onDecide }) {
  const [renameMode, setRenameMode] = useState(false)
  const [customName, setCustomName] = useState(() => {
    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name
    const ext  = dotIdx >= 0 ? name.slice(dotIdx) : ''
    return `${base} (2)${ext}`
  })
  function fmtSize(b) {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / (1024 * 1024)).toFixed(1)} MB`
  }
  const optBtn = (accent) => ({
    width:'100%', padding:'12px 16px', border:`1px solid ${accent||'rgba(255,255,255,.07)'}`,
    borderRadius:10, fontWeight:600, fontSize:13, cursor:'pointer', textAlign:'left',
    background:'#161625', color:accent||'#EDEDFF',
    display:'flex', flexDirection:'column', gap:3,
  })
  if (renameMode) return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#EDEDFF' }}>Rename and upload</h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:16 }}>Enter a name for the uploaded file:</p>
        <input autoFocus value={customName} onChange={e=>setCustomName(e.target.value)}
          onKeyDown={e=>{
            if(e.key==='Enter'&&customName.trim()) onDecide({decision:'keep',customName:customName.trim()})
            if(e.key==='Escape') setRenameMode(false)
          }}
          style={{ width:'100%',padding:'10px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,
                    fontSize:14,outline:'none',marginBottom:16,boxSizing:'border-box',
                    background:'#161625',color:'#EDEDFF' }} />
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={()=>{if(customName.trim()) onDecide({decision:'keep',customName:customName.trim()})}}
            style={{ flex:1, ...btn(true) }}>Upload</button>
          <button onClick={()=>setRenameMode(false)} style={{ flex:1, ...btn(false) }}>Back</button>
        </div>
      </div>
    </div>
  )
  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth:440 }}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:6, color:'#EDEDFF' }}>File already exists</h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:4, lineHeight:1.5 }}>
          <strong style={{ color:'#EDEDFF' }}>"{name}"</strong> already exists in your Vault
          {existing?.size_bytes ? ` · ${fmtSize(existing.size_bytes)} · ${new Date(existing.created_at).toLocaleDateString('en-IN')}` : ''}.
        </p>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:20 }}>What would you like to do?</p>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <button style={optBtn('#6366F1')} onClick={()=>onDecide('version')}>
            <span>Create new version</span>
            <span style={{ fontSize:11,fontWeight:400,color:'#8888AA' }}>Keep old file as v1 — new upload becomes current</span>
          </button>
          <button style={optBtn('#E24B4A')} onClick={()=>onDecide('replace')}>
            <span>Replace</span>
            <span style={{ fontSize:11,fontWeight:400,color:'#8888AA' }}>Permanently delete old file, replace with new upload</span>
          </button>
          <button style={optBtn()} onClick={()=>setRenameMode(true)}>
            <span>Rename and upload</span>
            <span style={{ fontSize:11,fontWeight:400,color:'#8888AA' }}>Choose a new name and upload alongside the existing file</span>
          </button>
          <button onClick={()=>onDecide('cancel')}
            style={{ background:'none',border:'none',fontSize:13,color:'#8888AA',cursor:'pointer',padding:'6px 0',fontWeight:500,marginTop:4 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Vault folder conflict modal ───────────────────────────────────────────
function VaultFolderConflictModal({ name, onDecide }) {
  const [renameMode, setRenameMode] = useState(false)
  const [customName, setCustomName] = useState(`${name} (2)`)
  const optBtn = (accent) => ({
    width:'100%', padding:'12px 16px', border:`1px solid ${accent||'rgba(255,255,255,.07)'}`,
    borderRadius:10, fontWeight:600, fontSize:13, cursor:'pointer', textAlign:'left',
    background:'#161625', color:accent||'#EDEDFF',
    display:'flex', flexDirection:'column', gap:3,
  })
  if (renameMode) return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#EDEDFF' }}>Rename folder</h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:16 }}>Enter a new name for the folder:</p>
        <input autoFocus value={customName} onChange={e=>setCustomName(e.target.value)}
          onKeyDown={e=>{
            if(e.key==='Enter'&&customName.trim()) onDecide({action:'rename',customName:customName.trim()})
            if(e.key==='Escape') setRenameMode(false)
          }}
          style={{ width:'100%',padding:'10px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,
                    fontSize:14,outline:'none',marginBottom:16,boxSizing:'border-box',
                    background:'#161625',color:'#EDEDFF' }} />
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={()=>{if(customName.trim()) onDecide({action:'rename',customName:customName.trim()})}}
            style={{ flex:1, ...btn(true) }}>Confirm</button>
          <button onClick={()=>setRenameMode(false)} style={{ flex:1, ...btn(false) }}>Back</button>
        </div>
      </div>
    </div>
  )
  return (
    <div style={overlay}>
      <div style={{ ...modal, maxWidth:440 }}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:6, color:'#EDEDFF' }}>Folder already exists</h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.5 }}>
          A folder named <strong style={{ color:'#EDEDFF' }}>"{name}"</strong> already exists in the destination.
          What would you like to do?
        </p>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <button style={optBtn()} onClick={()=>setRenameMode(true)}>
            <span>Rename and move</span>
            <span style={{ fontSize:11,fontWeight:400,color:'#8888AA' }}>Choose a new name for this folder</span>
          </button>
          <button onClick={()=>onDecide({action:'cancel'})}
            style={{ background:'none',border:'none',fontSize:13,color:'#8888AA',cursor:'pointer',padding:'6px 0',fontWeight:500,marginTop:4 }}>
            Skip this folder
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Setup flow (always V2 for new setups) ----
function SetupFlow({ onDone, onBack }) {
  const toast     = useToastMethods()
  const [step,    setStep]    = useState(1)
  const [pin,     setPin]     = useState('')
  const [pin2,    setPin2]    = useState('')
  const [phrase,  setPhrase]  = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving,  setSaving]  = useState(false)
  const [ack,     setAck]     = useState(false)

  function genPhrase() { setPhrase(generatePhrase()) }

  async function finish() {
    if (confirm.trim().toLowerCase() !== phrase.trim().toLowerCase()) {
      toast.error('Recovery phrase does not match'); return
    }
    if (!ack) { toast.error('Please acknowledge you have saved the phrase'); return }

    setSaving(true)
    try {
      // Generate ECDH P-256 keypair
      const { publicKeySpki, privateKeyPkcs8 } = await generateECDHKeypair()

      // Derive PIN salt and encrypt private key with PIN
      const pinSalt  = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      const pinHash  = await derivePinHash(pin, pinSalt)
      const { encryptedPrivateKey, iv: privateKeyIv } = await encryptPrivateKeyWithPin(privateKeyPkcs8, pin, pinSalt)

      // Encrypt private key with recovery phrase
      const phraseSalt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      const phraseHash = await derivePinHash(phrase.trim(), phraseSalt)
      const phraseIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
      const { encryptedPrivateKey: recoveryPhraseEncrypted, iv: recoveryPhraseIv } =
        await encryptPrivateKeyWithPin(privateKeyPkcs8, phrase.trim(), phraseSalt)

      await api.vaultSetupV2({
        publicKey: publicKeySpki,
        encryptedPrivateKey,
        privateKeyIv,
        privateKeySalt: pinSalt,
        pinHash,
        pinSalt,
        phraseHash,
        phraseSalt,
        recoveryPhraseEncrypted,
        recoveryPhraseIv,
        recoveryPhraseSalt: phraseSalt,
      })

      // Store private key in session
      sessionStorage.setItem('dd_vault_private_key_pkcs8', privateKeyPkcs8)
      toast.success('Vault configured!')
      onDone()
    } catch (e) {
      toast.error(e.message || 'Setup failed')
    }
    setSaving(false)
  }

  return (
    <div style={{ maxWidth:520 }}>
      <BackBtn onClick={onBack} />
      <h3 style={{ fontSize:16, fontWeight:700, marginBottom:20, color:'#EDEDFF',
                    fontFamily:"'Space Grotesk',sans-serif" }}>
        Set up Zero Knowledge Vault
      </h3>

      {step === 1 && (
        <>
          <p style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.7 }}>
            Choose a 6-digit PIN. This PIN encrypts your private key locally — it never leaves your device.
          </p>
          <PinInput value={pin}  onChange={setPin}  label="PIN" />
          <PinInput value={pin2} onChange={setPin2} label="Confirm PIN" />
          <button onClick={() => {
            if (pin.length !== 6) { toast.error('PIN must be 6 digits'); return }
            if (pin !== pin2) { toast.error('PINs do not match'); return }
            setStep(2)
          }} style={{ ...btn(true), marginTop:8 }}>Next</button>
        </>
      )}

      {step === 2 && (
        <>
          <p style={{ fontSize:13, color:'#8888AA', marginBottom:16, lineHeight:1.7 }}>
            Save this 12-word recovery phrase. If you forget your PIN, this is the <em style={{ color:'#EDEDFF' }}>only</em> way to recover your Vault.
            <strong style={{ color:'#E24B4A' }}> DataDrop cannot recover your vault without it.</strong>
          </p>
          {!phrase ? (
            <button onClick={genPhrase} style={btn(true)}>Generate phrase</button>
          ) : (
            <>
              <div style={{ background:'#111130', border:'1px solid rgba(255,255,255,.07)', borderRadius:10,
                             padding:16, fontFamily:"'JetBrains Mono',monospace", fontSize:13,
                             lineHeight:2, marginBottom:16, wordBreak:'break-all', color:'#EDEDFF' }}>
                {phrase}
              </div>
              <div style={{ display:'flex', gap:8, marginBottom:4 }}>
                <button onClick={() => navigator.clipboard.writeText(phrase).then(() => toast.success('Copied!'))}
                  style={btn(false)}>Copy</button>
                <button onClick={() => setStep(3)} style={btn(true)}>I've saved it</button>
              </div>
            </>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <p style={{ fontSize:13, color:'#8888AA', marginBottom:16, lineHeight:1.6 }}>
            Type your recovery phrase to confirm you've saved it.
          </p>
          <textarea
            value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Enter all 12 words separated by spaces…"
            style={{ width:'100%', padding:12, border:'1px solid rgba(255,255,255,.07)', borderRadius:10,
                      fontSize:13, height:80, resize:'none', marginBottom:14,
                      background:'#161625', color:'#EDEDFF', outline:'none', boxSizing:'border-box' }}
          />
          <label style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:20,
                           fontSize:13, color:'#8888AA', cursor:'pointer' }}>
            <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}
              style={{ marginTop:2, accentColor:'#6366F1' }} />
            I understand that if I lose my PIN and recovery phrase, my Vault data is permanently unrecoverable.
          </label>
          <button onClick={finish} disabled={saving} style={{ ...btn(true), opacity:saving?.7:1 }}>
            {saving ? 'Setting up…' : 'Activate Vault'}
          </button>
        </>
      )}
    </div>
  )
}

// ---- Unlock flow (handles V1 + V2) ----
function UnlockFlow({ vaultVersion, onDone, onBack, onRecover }) {
  const toast    = useToastMethods()
  const [pin,    setPin]    = useState('')
  const [loading,setLoading]= useState(false)

  async function unlock() {
    if (pin.length !== 6) { toast.error('Enter your 6-digit PIN'); return }
    setLoading(true)
    try {
      if (vaultVersion === 'v2') {
        const cfg   = await api.vaultConfigV2()
        const pinH  = await derivePinHash(pin, cfg.pinSalt)
        const res   = await api.verifyPinV2({ pinHash: pinH })
        const pkcs8 = await decryptPrivateKeyWithPin(
          res.encryptedPrivateKey, res.privateKeyIv, res.privateKeySalt, pin
        )
        sessionStorage.setItem('dd_vault_private_key_pkcs8', pkcs8)
      } else {
        const saltRes = await api.vaultSalt()
        const pinHash = await hashPin(pin, saltRes.salt)
        const res     = await api.verifyPin({ pinHash })
        const pinKey  = await pbkdf2(pin, saltRes.salt)
        const vaultKey = await aesDecrypt(pinKey, res.encryptedVaultKey)
        sessionStorage.setItem('dd_vault_key', vaultKey)
      }
      toast.success('Vault unlocked')
      onDone()
    } catch (e) {
      if (e.status === 429) toast.error(e.data?.error || 'Too many attempts')
      else toast.error('Incorrect PIN')
    }
    setLoading(false)
  }

  return (
    <div style={{ maxWidth:520 }}>
      <BackBtn onClick={onBack} />
      <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#EDEDFF',
                    fontFamily:"'Space Grotesk',sans-serif" }}>
        Unlock Vault
      </h3>
      <p style={{ fontSize:13, color:'#8888AA', marginBottom:20, lineHeight:1.5 }}>
        Enter your 6-digit vault PIN.
      </p>
      <PinInput value={pin} onChange={setPin} label="PIN" autoFocus />
      <button onClick={unlock} disabled={loading}
        style={{ ...btn(true), marginTop:8, opacity:loading?.7:1 }}>
        {loading ? 'Unlocking…' : 'Unlock'}
      </button>
      <button onClick={onRecover}
        style={{ display:'block', marginTop:14, background:'none', border:'none',
                  fontSize:13, color:'#8888AA', cursor:'pointer', padding:0,
                  textDecoration:'underline' }}>
        Forgot PIN? Use recovery phrase
      </button>
    </div>
  )
}

// ---- Vault reset confirmation modal ----
function VaultResetModal({ onConfirmed, onClose }) {
  const toast = useToastMethods()
  const [typed,   setTyped]   = useState('')
  const [loading, setLoading] = useState(false)
  const confirmed = typed.trim().toUpperCase() === 'DELETE'

  async function handleReset() {
    if (!confirmed) return
    setLoading(true)
    try {
      await api.resetVault()
      lockVault()
      toast.success('Vault reset — all vault files deleted. You can now create a new vault.')
      onConfirmed()
    } catch (e) {
      toast.error(e.message || 'Reset failed')
    }
    setLoading(false)
  }

  return (
    <div style={{ ...overlay, zIndex:500 }} onClick={onClose}>
      <div style={{ ...modal, maxWidth:420, border:'1px solid #3A1A1A' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#E24B4A',
                      fontFamily:"'Space Grotesk',sans-serif" }}>
          Reset Vault
        </h3>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:6, lineHeight:1.6 }}>
          This will <strong style={{ color:'#EDEDFF' }}>permanently delete all vault files</strong> and remove your vault encryption keys. This cannot be undone.
        </p>
        <p style={{ fontSize:13, color:'#8888AA', marginBottom:16, lineHeight:1.6 }}>
          After reset, you can create a fresh vault with a new PIN and recovery phrase.
        </p>
        <label style={{ fontSize:11, fontWeight:700, textTransform:'uppercase',
                         letterSpacing:'.5px', color:'#7A7AAA', display:'block', marginBottom:8 }}>
          Type DELETE to confirm
        </label>
        <input
          value={typed} onChange={e => setTyped(e.target.value)}
          placeholder="DELETE"
          style={{ width:'100%', padding:'10px 14px', border:`1px solid ${confirmed?'#E24B4A':'rgba(255,255,255,.07)'}`,
                    borderRadius:10, fontSize:14, outline:'none', marginBottom:16,
                    background:'#161625', color:'#EDEDFF', boxSizing:'border-box' }}
        />
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={handleReset} disabled={!confirmed || loading}
            style={{ flex:1, padding:'10px', background:confirmed?'#E24B4A':'rgba(255,255,255,.07)',
                      border:'none', color:confirmed?'#fff':'#7A7AAA', borderRadius:9,
                      fontSize:13, fontWeight:700, cursor:confirmed&&!loading?'pointer':'not-allowed',
                      opacity:loading?.7:1 }}>
            {loading ? 'Deleting…' : 'Reset Vault'}
          </button>
          <button onClick={onClose}
            style={{ flex:1, padding:'10px', background:'none', border:'1px solid rgba(255,255,255,.07)',
                      color:'#8888AA', borderRadius:9, fontSize:13, cursor:'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Recovery flow (handles V1 + V2) ----
function RecoverFlow({ vaultVersion, onDone, onReset, onBack }) {
  const toast     = useToastMethods()
  const [phrase,  setPhrase]  = useState('')
  const [newPin,  setNewPin]  = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)

  async function recover() {
    if (newPin.length !== 6) { toast.error('New PIN must be 6 digits'); return }
    if (newPin !== newPin2)  { toast.error('PINs do not match'); return }

    setLoading(true)
    try {
      if (vaultVersion === 'v2') {
        const cfg        = await api.vaultConfigV2()
        const phraseH    = await derivePinHash(phrase.trim(), cfg.recoveryPhraseSalt)
        if (phraseH !== cfg.phraseHash) throw new Error('Incorrect phrase')

        // Decrypt private key with recovery phrase
        const pkcs8 = await decryptPrivateKeyWithPin(
          cfg.recoveryPhraseEncrypted, cfg.recoveryPhraseIv, cfg.recoveryPhraseSalt, phrase.trim()
        )

        // Re-encrypt with new PIN
        const newPinSalt  = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        const newPinHash  = await derivePinHash(newPin, newPinSalt)
        const { encryptedPrivateKey: newEncKey, iv: newIv } = await encryptPrivateKeyWithPin(pkcs8, newPin, newPinSalt)

        await api.recoverVaultV2({
          phraseHash: phraseH,
          newEncryptedPrivateKey: newEncKey,
          newPrivateKeyIv: newIv,
          newPrivateKeySalt: newPinSalt,
          newPinHash,
          newPinSalt,
        })

        toast.success('Vault recovered! New PIN set.')
      } else {
        // V1 recovery
        const saltRes    = await api.vaultSalt()
        const phraseHash = await hashPin(phrase.trim(), saltRes.phraseSalt)
        const phraseKey  = await pbkdf2(phrase.trim(), saltRes.phraseSalt)

        const newSalt    = randomSalt()
        const newPinKey  = await pbkdf2(newPin, newSalt)
        const newPinHash = await hashPin(newPin, newSalt)

        const res        = await api.recoverVault({ phraseHash, newPinHash, newSalt, newEncryptedVaultKey: '' })
        const vaultKey   = await aesDecrypt(phraseKey, res.phraseEncKey)
        const newEncKey  = await aesEncrypt(newPinKey, vaultKey)
        await api.recoverVault({ phraseHash, newPinHash, newSalt, newEncryptedVaultKey: newEncKey })

        toast.success('Vault recovered! New PIN set.')
      }
      onDone()
    } catch (_) {
      toast.error('Incorrect recovery phrase')
    }
    setLoading(false)
  }

  return (
    <div style={{ maxWidth:520 }}>
      <BackBtn onClick={onBack} />
      <h3 style={{ fontSize:16, fontWeight:700, marginBottom:8, color:'#EDEDFF',
                    fontFamily:"'Space Grotesk',sans-serif" }}>
        Recover Vault
      </h3>
      <p style={{ fontSize:13, color:'#8888AA', marginBottom:16, lineHeight:1.5 }}>
        Enter your 12-word recovery phrase to set a new PIN.
      </p>
      <textarea
        value={phrase} onChange={e=>setPhrase(e.target.value)}
        placeholder="word1 word2 word3 … word12"
        style={{ width:'100%', padding:12, border:'1px solid rgba(255,255,255,.07)', borderRadius:10,
                  fontSize:13, height:72, resize:'none', marginBottom:14,
                  background:'#161625', color:'#EDEDFF', outline:'none', boxSizing:'border-box' }}
      />
      <PinInput value={newPin}  onChange={setNewPin}  label="New PIN" />
      <PinInput value={newPin2} onChange={setNewPin2} label="Confirm new PIN" />
      <button onClick={recover} disabled={loading}
        style={{ ...btn(true), marginTop:8, opacity:loading?.7:1 }}>
        {loading ? 'Recovering…' : 'Recover Vault'}
      </button>

      <div style={{ marginTop:28, paddingTop:20, borderTop:'1px solid rgba(255,255,255,.07)' }}>
        <p style={{ fontSize:12, color:'#7A7AAA', marginBottom:10 }}>
          Lost your recovery phrase too?
        </p>
        <button onClick={() => setShowReset(true)}
          style={{ background:'none', border:'1px solid #3A1A1A', color:'#E24B4A',
                    borderRadius:9, padding:'8px 16px', fontSize:12, fontWeight:600,
                    cursor:'pointer' }}>
          Reset Vault &amp; delete all vault files
        </button>
      </div>

      {showReset && <VaultResetModal onConfirmed={() => { setShowReset(false); onReset() }} onClose={() => setShowReset(false)} />}
    </div>
  )
}

// ---- Shared sub-components ----
function PinInput({ value, onChange, label, autoFocus }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                       letterSpacing: '.5px', color: '#7A7AAA', display: 'block', marginBottom: 8 }}>
        {label}
      </label>
      <input
        type="password" inputMode="numeric" maxLength={6} autoFocus={autoFocus}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="••••••"
        style={{ padding: '10px 16px', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10,
                  fontSize: 22, letterSpacing: 10, width: 160, outline: 'none',
                  background: '#161625', color: '#EDEDFF' }}
      />
    </div>
  )
}

function BackBtn({ onClick }) {
  return (
    <button onClick={onClick}
      style={{ background: 'none', border: 'none', color: '#8888AA', cursor: 'pointer',
                fontSize: 13, marginBottom: 20, padding: 0,
                display: 'flex', alignItems: 'center', gap: 6 }}>
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
        <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Back
    </button>
  )
}

function btn(primary, danger) {
  return {
    padding: '10px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
    border: danger ? '1px solid rgba(226,75,74,0.3)' : primary ? 'none' : '1px solid rgba(255,255,255,.07)',
    background: danger ? 'rgba(226,75,74,0.1)' : primary ? '#6366F1' : '#161625',
    color: danger ? '#E24B4A' : primary ? '#fff' : '#8888AA',
  }
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(8,8,26,0.88)', zIndex: 300,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  backdropFilter: 'blur(8px)',
}

const modal = {
  background: '#0D0D22', border: '1px solid rgba(255,255,255,.07)',
  borderRadius: 16, padding: 28, width: '100%', maxWidth: 380,
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
}
