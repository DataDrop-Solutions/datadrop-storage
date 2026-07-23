import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser, useClerk } from '@clerk/clerk-react'
import { api, uploadFile, fetchFileWithAuth, encryptForVault, encryptWithDEK, wrapDEKWithPublicKey, downloadZip } from '../lib/api.js'
import { useToastMethods } from '../components/Toast.jsx'
import FileGrid from '../components/FileGrid.jsx'
import { UploadZone } from '../components/StorageMeter.jsx'
import ShareModal from '../components/ShareModal.jsx'
import FilePreview from '../components/FilePreview.jsx'
import VersionHistory from '../components/VersionHistory.jsx'
import Settings from './Settings.jsx'
import VaultSetup, { VaultPinModal } from '../components/VaultSetup.jsx'
import TeamsView from '../components/TeamsView.jsx'
import ReportModal from '../components/ReportModal.jsx'
import UploadProgressPanel from '../components/UploadProgressPanel.jsx'
import FileMoveModal from '../components/FileMoveModal.jsx'
import LimitUpgradeModal from '../components/LimitUpgradeModal.jsx'

function isVaultUpload(file) {
  return file.name?.startsWith('encrypted:') || file.type === 'application/octet-stream'
}

// Generate 240×160 WebP thumbnail client-side (max 15 KB stored in D1, no B2 cost)
async function generateThumb(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const W = 240, H = 160
      const ratio = Math.min(W / img.width, H / img.height, 1)
      const w = Math.max(1, Math.round(img.width  * ratio))
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

// Generate 240×160 WebP thumbnail from video frame at 1s
async function generateVideoThumb(file) {
  return new Promise(resolve => {
    const video = document.createElement('video')
    const url   = URL.createObjectURL(file)
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timeout = setTimeout(() => finish(null), 10000)
    video.preload = 'metadata'
    video.muted   = true
    video.playsInline = true
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration || 0)
    }
    video.onseeked = () => {
      clearTimeout(timeout)
      const W = 240, H = 160
      const ratio = Math.min(W / video.videoWidth, H / video.videoHeight, 1)
      const w = Math.max(1, Math.round(video.videoWidth  * ratio))
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
    video.onerror = () => finish(null)
    video.src = url
  })
}

// ---- Main Dashboard ----
export default function Dashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const toast = useToastMethods()
  const fileInputRef = useRef()
  const conflictResolverRef = useRef(null)
  const folderConflictResolverRef = useRef(null)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const [view,          setView]          = useState('files')
  const [files,         setFiles]         = useState([])
  const [folders,       setFolders]       = useState([])
  const [currentFolder,     setCurrentFolder]     = useState(null)
  const [currentFolderName, setCurrentFolderName] = useState(null)
  const [folderPath,        setFolderPath]        = useState([])
  const [meter,         setMeter]         = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [uploading,     setUploading]     = useState([])
  const [shareTarget,   setShareTarget]   = useState(null)
  const [preview,       setPreview]       = useState(null)
  const [versionFile,   setVersionFile]   = useState(null)
  const [search,        setSearch]        = useState('')
  const [sidebarOpen,   setSidebarOpen]   = useState(false)
  const [renameTarget,  setRenameTarget]  = useState(null)
  const [deleteTarget,  setDeleteTarget]  = useState(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [selectedFileIds,   setSelectedFileIds]   = useState(new Set())
  const [selectedFolderIds, setSelectedFolderIds] = useState(new Set())
  const [showMoveModal,    setShowMoveModal]    = useState(false)
  const [showCopyModal,    setShowCopyModal]    = useState(false)
  const [bulkShareFiles,   setBulkShareFiles]   = useState(null)
  const [conflictTarget,       setConflictTarget]       = useState(null)
  const [folderConflictTarget, setFolderConflictTarget] = useState(null)
  const [pinPending,           setPinPending]           = useState(null)  // function to run after vault unlock
  const [vaultProgress,     setVaultProgress]     = useState(null)  // { done, total, filename }
  const [userProfile,       setUserProfile]       = useState(null)  // from api.me()
  const [editShareTarget,   setEditShareTarget]   = useState(null)  // share to edit permissions
  const [reportTarget,      setReportTarget]      = useState(null)  // file to report (received view)
  const [sharedFolderView,  setSharedFolderView]  = useState(null)  // { shareId, folderName, rootFolderId }
  const [sharedFolderPath,  setSharedFolderPath]  = useState([])   // breadcrumb for browsing shared folders
  const [sharedFolderFolderId, setSharedFolderFolderId] = useState(null) // current subfolder being browsed
  const [largeFilesWarning,  setLargeFilesWarning]  = useState(null) // { proceed: fn, names: string[] }
  const [limitExceededBlock, setLimitExceededBlock] = useState(null) // blocked upload info
  const [showLimitUpgrade,   setShowLimitUpgrade]   = useState(false)
  const [recoveryStatus,     setRecoveryStatus]     = useState(null) // payment recovery banner data
  const syncTimerRef = useRef(null)

  // Load content. silent=true: no loading spinner, keeps pending optimistic files not yet in D1.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      if (view === 'files') {
        const d = await api.listFiles(currentFolder ? { folder: currentFolder } : {})
        const serverFiles = d.files || []
        if (silent) {
          const serverIds = new Set(serverFiles.map(f => f.id))
          setFiles(prev => {
            const pending = prev.filter(f => f._optimistic && !serverIds.has(f.id))
            return [...serverFiles, ...pending]
          })
        } else {
          setFiles(serverFiles)
        }
        setFolders(d.folders || [])
      } else if (view === 'shared') {
        const d = await api.listShares()
        setFiles(d.shares || [])
        setFolders([])
      } else if (view === 'received') {
        if (sharedFolderView) {
          const d = await api.listSharedFolder(sharedFolderView.shareId, sharedFolderFolderId)
          setFiles(d.files || [])
          setFolders(d.folders || [])
        } else {
          const d = await api.listReceived()
          setFiles(d.shares || [])
          setFolders([])
        }
      } else if (view === 'trash') {
        const d = await api.listFiles({ trash: 1 })
        setFiles(d.files || [])
        setFolders([])
      }
    } catch (e) { if (!silent) toast.error(`Failed to load: ${e.message || e.status || 'network error'}`) }
    if (!silent) setLoading(false)
  }, [view, currentFolder, sharedFolderView, sharedFolderFolderId])

  useEffect(() => { load() }, [load])

  // Clear selection and shared folder view when switching tabs
  useEffect(() => {
    setSelectedFileIds(new Set())
    setSelectedFolderIds(new Set())
    setSharedFolderView(null)
    setSharedFolderPath([])
    setSharedFolderFolderId(null)
  }, [view])

  // Load trial status once
  useEffect(() => { api.storageMeter().then(setMeter).catch(() => {}) }, [])

  // Fetch display name once
  useEffect(() => { api.me().then(setUserProfile).catch(() => {}) }, [])

  // Load payment recovery status for banner
  useEffect(() => {
    api.billingRecovery().then(r => { if (r.inRecovery) setRecoveryStatus(r) }).catch(() => {})
  }, [])


  function openFolder(folder) {
    if (currentFolder !== null) {
      setFolderPath(prev => [...prev, { id: currentFolder, label: currentFolderName }])
    }
    setCurrentFolder(folder.id)
    setCurrentFolderName(folder.name)
    setSearch('')
  }

  function navigateBreadcrumb(idx) {
    if (idx < 0) {
      setFolderPath([])
      setCurrentFolder(null)
      setCurrentFolderName(null)
    } else {
      const target = folderPath[idx]
      setFolderPath(prev => prev.slice(0, idx))
      setCurrentFolder(target.id)
      setCurrentFolderName(target.label)
    }
    setSearch('')
  }

  function showConflictDialog(name, existing) {
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

  function showFolderConflictDialog(name, itemType = 'folder') {
    return new Promise(resolve => {
      folderConflictResolverRef.current = resolve
      setFolderConflictTarget({ name, itemType })
    })
  }

  function resolveFolderConflict(result) {
    setFolderConflictTarget(null)
    if (folderConflictResolverRef.current) {
      folderConflictResolverRef.current(result)
      folderConflictResolverRef.current = null
    }
  }

  async function handleUpload(fileList) {
    const newItems = Array.from(fileList).map(f => ({
      id: Math.random(), name: f.name, progress: 0, done: false, error: null, file: f,
    }))
    setUploading(prev => [...prev, ...newItems])

    for (const item of newItems) {
      // Reject 0-byte files before hitting the API
      if (item.file.size === 0) {
        toast.error(`"${item.name}" is empty and cannot be uploaded`)
        setUploading(prev => prev.filter(u => u.id !== item.id))
        continue
      }
      try {
        // Check for filename conflict in current folder
        const existing = files.find(f => f.filename === item.name)
        let decision = 'keep'
        if (existing) {
          decision = await showConflictDialog(item.name, existing)
        }

        const decisionStr = typeof decision === 'object' ? decision.decision : decision

        if (decisionStr === 'cancel') {
          setUploading(prev => prev.filter(u => u.id !== item.id))
          continue
        }

        // For replace: permanently delete old file BEFORE uploading so dedup doesn't match it
        if (decisionStr === 'replace' && existing) {
          await api.permanentDeleteFile(existing.id)
          setFiles(prev => prev.filter(f => f.id !== existing.id))
        }

        // Hoist before try so catch block can reference them for LIMIT_EXCEEDED retry
        let fileToUpload = item.file
        let thumbData    = null
        let skipDedup    = false

        // Rename — use custom name if provided, otherwise auto-generate "file (2).txt"
        if (decisionStr === 'keep' && existing) {
          let newName
          if (decision?.customName) {
            newName = decision.customName
          } else {
            const dotIdx = item.name.lastIndexOf('.')
            const base   = dotIdx >= 0 ? item.name.slice(0, dotIdx) : item.name
            const ext    = dotIdx >= 0 ? item.name.slice(dotIdx) : ''
            let n = 2
            while (files.some(f => f.filename === `${base} (${n})${ext}`)) n++
            newName = `${base} (${n})${ext}`
          }
          fileToUpload = new File([item.file], newName, { type: item.file.type })
          setUploading(prev => prev.map(u => u.id === item.id ? { ...u, name: newName } : u))
        }

        // Skip dedup for rename, version, or replace — content match is intentional or old file already deleted
        const isRename  = decisionStr === 'keep' && !!existing
        const isVersion = decisionStr === 'version'
        const isReplace = decisionStr === 'replace'
        skipDedup = isRename || isVersion || isReplace

        // Generate thumbnail before upload so it ships with confirmUpload (no extra API call)
        if (!isVaultUpload(fileToUpload)) {
          try {
            if (fileToUpload.type.startsWith('image/')) thumbData = await generateThumb(fileToUpload)
            else if (fileToUpload.type.startsWith('video/')) thumbData = await generateVideoThumb(fileToUpload)
          } catch (_) {}
        }

        const result = await uploadFile(fileToUpload, {
          folderId: currentFolder, skipDedup,
          thumbData: thumbData || null,
        }, pct => {
          setUploading(prev => prev.map(u => u.id === item.id ? { ...u, progress: pct } : u))
        })

        if (result.duplicate && !isVersion) {
          toast.success(`"${item.name}" already exists`)
          setUploading(prev => prev.filter(u => u.id !== item.id))
          continue
        }

        if (decisionStr === 'replace') {
          toast.success(`"${item.name}" replaced`)
          setFiles(prev => [...prev, {
            id: result.fileId, filename: fileToUpload.name,
            size_bytes: fileToUpload.size, mime_type: fileToUpload.type,
            created_at: Date.now(), version_number: 1, _optimistic: true,
          }])
        } else if (existing && decisionStr === 'version') {
          // Skip promotion if dedup returned the canonical file itself (same content, no new record)
          if (result.fileId !== existing.id) {
            let promoted = false
            for (let i = 0; i < 10 && !promoted; i++) {
              try {
                await api.updateFile(existing.id, { promoteFrom: result.fileId })
                promoted = true
              } catch (e) {
                if (i < 9 && e.message.includes('Source file not found')) {
                  await new Promise(r => setTimeout(r, 600))
                } else throw e
              }
            }
          }
          toast.success(`New version of "${item.name}" saved`)
          setFiles(prev => prev.map(f =>
            f.id === existing.id ? { ...f, version_number: (f.version_number || 1) + 1 } : f
          ))
        } else {
          setFiles(prev => [...prev, {
            id: result.fileId, filename: fileToUpload.name,
            size_bytes: fileToUpload.size, mime_type: fileToUpload.type,
            created_at: Date.now(), version_number: 1, _optimistic: true,
          }])
          if (!existing) toast.success(`"${fileToUpload.name}" uploaded`)
        }

        setUploading(prev => prev.map(u => u.id === item.id ? { ...u, done: true, progress: 100 } : u))
      } catch (err) {
        if (err.data?.code === 'LIMIT_EXCEEDED') {
          setLimitExceededBlock({
            fileToUpload, folderId: currentFolder, skipDedup, thumbData,
            itemId: item.id,
            capacityGb: (err.data.capacityBytes || 0) / (1024 ** 3),
            limitRs: err.data.limit || 0,
          })
          setShowLimitUpgrade(true)
          break
        }
        setUploading(prev => prev.map(u => u.id === item.id ? { ...u, error: err.message } : u))
        if (err.data?.code === 'TRIAL_ENDED') {
          toast.error('Trial ended — go to Settings → Billing to add storage credit')
        } else if (err.data?.code === 'WALLET_LOW') {
          toast.error('Insufficient balance — top up your wallet in Settings → Billing')
        } else if (err.data?.code === 'TRIAL_LIMIT') {
          toast.error('Trial storage limit reached — upgrade to continue')
        } else {
          toast.error(`Upload failed: ${err.message}`)
        }
      }
    }
    // Cancel any previous stale timer, then schedule a single background D1 sync
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => load(true), 6000)
    setTimeout(() => setUploading(prev => prev.filter(u => !u.done && !u.error)), 3000)
  }

  async function retryBlockedUpload(block) {
    if (!block) return
    setLimitExceededBlock(null)
    setShowLimitUpgrade(false)
    const tempId = block.itemId
    setUploading(prev => prev.map(u => u.id === tempId ? { ...u, error: null, progress: 0 } : u))
    try {
      const result = await uploadFile(block.fileToUpload, {
        folderId: block.folderId, skipDedup: block.skipDedup,
        thumbData: block.thumbData || null,
      }, pct => {
        setUploading(prev => prev.map(u => u.id === tempId ? { ...u, progress: pct } : u))
      })
      if (!result.duplicate) {
        setFiles(prev => [...prev, {
          id: result.fileId, filename: block.fileToUpload.name,
          size_bytes: block.fileToUpload.size, mime_type: block.fileToUpload.type,
          created_at: Date.now(), version_number: 1, _optimistic: true,
        }])
        toast.success(`"${block.fileToUpload.name}" uploaded`)
      }
      setUploading(prev => prev.map(u => u.id === tempId ? { ...u, done: true, progress: 100 } : u))
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncTimerRef.current = setTimeout(() => load(true), 6000)
      setTimeout(() => setUploading(prev => prev.filter(u => !u.done && !u.error)), 3000)
    } catch (err) {
      setUploading(prev => prev.map(u => u.id === tempId ? { ...u, error: err.message } : u))
      toast.error(`Upload failed: ${err.message}`)
    }
  }

  function handleDelete(file) {
    setDeleteTarget(file)
  }

  async function doPermanentDelete() {
    const item = deleteTarget
    if (!item) return
    try {
      if (item.item_type === 'folder') {
        await api.permanentDeleteFolder(item.id)
        setFolders(prev => prev.filter(f => f.id !== item.id))
      } else {
        await api.permanentDeleteFile(item.id)
        setFiles(prev => prev.filter(f => f.id !== item.id))
      }
      toast.success('Permanently deleted')
    } catch (e) { toast.error(e.message) }
    setDeleteTarget(null)
  }

  async function handleRename(fileId, newName) {
    try {
      await api.updateFile(fileId, { filename: newName })
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, filename: newName } : f))
      toast.success('Renamed')
      setRenameTarget(null)
    } catch (e) { toast.error(e.message) }
  }

  async function handleRevokeShare(share) {
    try {
      await api.revokeShare(share.id)
      setFiles(prev => prev.filter(f => f.id !== share.id))
      toast.success('Access revoked')
    } catch (e) { toast.error(e.message) }
  }

  async function encryptAndMoveToVault(file, targetFolderId = null, { deleteSource = true, overrideName } = {}) {
    const v1Key        = sessionStorage.getItem('dd_vault_key')
    const v2PrivKeyB64 = sessionStorage.getItem('dd_vault_private_key_pkcs8')

    try {
      const resp = await fetchFileWithAuth(file.id)
      const plainBuffer = await resp.arrayBuffer()

      let encBuffer, fileKeyPayload = null, dekBytes = null

      if (v2PrivKeyB64) {
        const me = await api.me()
        if (!me.user?.public_key) throw new Error('ECDH public key not found — please re-unlock the Vault')
        dekBytes = crypto.getRandomValues(new Uint8Array(32))
        encBuffer = await encryptWithDEK(dekBytes, plainBuffer)
        fileKeyPayload = await wrapDEKWithPublicKey(dekBytes, me.user.public_key)
      } else {
        encBuffer = await encryptForVault(v1Key, plainBuffer)
      }

      const uploadName = overrideName || file.filename
      const encBlob = new Blob([encBuffer])
      const encFile = new File([encBlob], uploadName, { type: 'application/octet-stream' })

      const realMime = file.mime_type || 'application/octet-stream'
      let thumbData = `encrypted:${realMime}`
      try {
        const tempFile = new File([plainBuffer], uploadName, { type: realMime })
        let rawThumb = null
        if (realMime.startsWith('image/')) rawThumb = await generateThumb(tempFile)
        else if (realMime.startsWith('video/')) rawThumb = await generateVideoThumb(tempFile)
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
        folderId: targetFolderId,
        mimeType: `encrypted:${realMime}`,
        thumbData,
      })

      // Wait for queue consumer to insert file record into D1 before storing DEK
      await new Promise(r => setTimeout(r, 6000))

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

      if (deleteSource) {
        await api.permanentDeleteFile(file.id)
        setFiles(prev => prev.filter(f => f.id !== file.id))
      }
      return fileId
    } catch (e) {
      toast.error(`${deleteSource ? 'Move' : 'Copy'} to Vault failed: ${e.message}`)
      throw e
    }
  }

  async function handleMoveToVault(file) {
    const v1Key = sessionStorage.getItem('dd_vault_key')
    const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
    if (!v1Key && !v2Key) {
      setPinPending(() => () => handleMoveToVault(file))
      return
    }
    try {
      await encryptAndMoveToVault(file)
      toast.success(`"${file.filename}" moved to Vault`)
    } catch (_) {}
  }

  async function collectFolderFiles(folderId) {
    const d = await api.listFiles({ folder: folderId })
    let allFiles = [...(d.files || [])]
    for (const subfolder of (d.folders || [])) {
      const sub = await collectFolderFiles(subfolder.id)
      allFiles = [...allFiles, ...sub]
    }
    return allFiles
  }

  async function deleteFolderTree(folderId) {
    const d = await api.listFiles({ folder: folderId })
    for (const subfolder of (d.folders || [])) {
      await deleteFolderTree(subfolder.id)
    }
    try { await api.permanentDeleteFolder(folderId) } catch (_) {}
  }

  // Recursively mirror a Files folder into Vault, preserving structure.
  // onFileStart(filename) is called just before each file is encrypted.
  async function moveFolderTreeToVault(sourceFolder, vaultParentFolderId, onFileStart, { deleteSource = true, overrideName } = {}) {
    let newVaultFolderId
    const folderName = overrideName || sourceFolder.name
    try {
      const res = await api.createFolder({ name: folderName, parentId: vaultParentFolderId, isVault: true })
      newVaultFolderId = res.folderId
    } catch (e) {
      if (e.status === 409) {
        const d = await api.listFiles(vaultParentFolderId ? { folder: vaultParentFolderId, vault: '1' } : { vault: '1' })
        const existing = (d.folders || []).find(f => f.name === folderName)
        if (!existing) throw e
        newVaultFolderId = existing.id
      } else throw e
    }
    const d = await api.listFiles({ folder: sourceFolder.id })
    for (const file of (d.files || [])) {
      onFileStart(file.filename)
      try { await encryptAndMoveToVault(file, newVaultFolderId, { deleteSource }) } catch (_) {}
    }
    for (const subfolder of (d.folders || [])) {
      await moveFolderTreeToVault(subfolder, newVaultFolderId, onFileStart, { deleteSource })
    }
    if (deleteSource) try { await api.permanentDeleteFolder(sourceFolder.id) } catch (_) {}
  }

  async function handleMoveFolderToVault(folder) {
    const v1Key = sessionStorage.getItem('dd_vault_key')
    const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
    if (!v1Key && !v2Key) {
      setPinPending(() => () => handleMoveFolderToVault(folder))
      return
    }
    try {
      const allFiles = await collectFolderFiles(folder.id)
      let done = 0
      setVaultProgress({ done: 0, total: allFiles.length, filename: '' })
      await moveFolderTreeToVault(folder, null, filename => {
        setVaultProgress({ done: done++, total: allFiles.length, filename })
      })
      setVaultProgress(null)
      toast.success(`"${folder.name}" moved to Vault (${allFiles.length} file${allFiles.length !== 1 ? 's' : ''})`)
      load()
    } catch (e) {
      setVaultProgress(null)
      toast.error(e.message)
    }
  }

  function handleDeleteFolder(folder) {
    setDeleteTarget({ ...folder, item_type: 'folder' })
  }

  async function handleRenameFolder(folder, newName) {
    try {
      await api.renameFolder(folder.id, { name: newName })
      setFolders(prev => prev.map(f => f.id === folder.id ? { ...f, name: newName } : f))
      toast.success('Folder renamed')
    } catch (e) { toast.error(e.message) }
  }

  async function createFolder(name) {
    try {
      await api.createFolder({ name: name.trim(), parentId: currentFolder })
      toast.success('Folder created')
      load()
    } catch (e) { toast.error(e.message) }
    setFolderModalOpen(false)
  }

  // ---- Selection ----
  function toggleFile(id) {
    setSelectedFileIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleFolder(id) {
    setSelectedFolderIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function handleMoveFolderClick(folder) {
    setSelectedFolderIds(new Set([folder.id]))
    setSelectedFileIds(new Set())
    setShowMoveModal(true)
  }
  function clearSelection() {
    setSelectedFileIds(new Set())
    setSelectedFolderIds(new Set())
  }

  function bulkDelete() {
    setBulkDeleteConfirm(true)
  }

  async function executeBulkDelete() {
    setBulkDeleteConfirm(false)
    const fileIds = [...selectedFileIds]
    const folderIds = [...selectedFolderIds]
    const total = fileIds.length + folderIds.length
    setFiles(prev => prev.filter(f => !fileIds.includes(f.id)))
    setFolders(prev => prev.filter(f => !folderIds.includes(f.id)))
    clearSelection()
    let failed = false
    try { await Promise.all(fileIds.map(id => api.permanentDeleteFile(id))) }
    catch (_) { failed = true }
    try { await Promise.all(folderIds.map(id => api.permanentDeleteFolder(id))) }
    catch (_) { failed = true }
    if (failed) {
      toast.error('Some items could not be deleted')
      load()
    } else {
      toast.success('Permanently deleted')
    }
  }

  async function bulkMoveToVault() {
    const v1Key = sessionStorage.getItem('dd_vault_key')
    const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
    if (!v1Key && !v2Key) {
      setPinPending(() => () => bulkMoveToVault())
      return
    }
    const selectedFiles = files.filter(f => selectedFileIds.has(f.id))
    setSelectedFileIds(new Set())
    if (!selectedFiles.length) return
    setVaultProgress({ done: 0, total: selectedFiles.length, filename: '' })
    let success = 0
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]
      setVaultProgress({ done: i, total: selectedFiles.length, filename: file.filename })
      try { await encryptAndMoveToVault(file); success++ } catch (_) {}
    }
    setVaultProgress(null)
    if (success > 0) toast.success(`${success} file(s) moved to Vault`)
  }

  async function handleEditShare(share, updates) {
    try {
      await api.updateShare(share.share_id || share.id, updates)
      toast.success('Share permissions updated')
      load()
    } catch (e) { toast.error(e.message) }
  }

  async function handleAcceptMove(file) {
    try {
      await api.acceptMove(file.share_id)
      toast.success(`"${file.filename}" moved to your storage`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  async function bulkDownload() {
    let toDownload = files.filter(f => selectedFileIds.has(f.id))
    if (view === 'received') {
      const skipped = toDownload.filter(f => f.can_download === false)
      if (skipped.length) toast.error(`Skipping ${skipped.length} file(s) — download disabled by sharer`)
      toDownload = toDownload.filter(f => f.can_download !== false)
    } else if (view === 'shared') {
      toDownload = toDownload.map(f => ({ ...f, id: f.file_id }))
    }
    if (!toDownload.length) { toast.error('No downloadable files selected'); return }
    try { await downloadZip(toDownload) }
    catch(e) { toast.error(e.message || 'Download failed') }
  }


  async function encryptAndMoveToTeam(file, teamId, teamKeyB64, targetFolderId, { deleteSource = true, overrideName } = {}) {
    const resp    = await fetchFileWithAuth(file.id)
    const rawBuf  = await resp.arrayBuffer()
    const realMime = file.mime_type || 'application/octet-stream'
    const encBuf  = await encryptForVault(teamKeyB64, rawBuf)
    const encMime = `encrypted:${realMime}`
    const uploadName = overrideName || file.filename
    let thumbData = null
    try {
      const tempFile = new File([rawBuf], uploadName, { type: realMime })
      let rawThumb = null
      if (realMime.startsWith('image/')) rawThumb = await generateThumb(tempFile)
      else if (realMime.startsWith('video/')) rawThumb = await generateVideoThumb(tempFile)
      if (rawThumb) {
        const rawBytes = Uint8Array.from(atob(rawThumb.split(',')[1]), c => c.charCodeAt(0))
        const encThumbBuf = await encryptForVault(teamKeyB64, rawBytes.buffer)
        thumbData = 'enc_thumb:' + btoa(String.fromCharCode(...new Uint8Array(encThumbBuf)))
      }
    } catch (_) {}
    const encFile = new File([encBuf], uploadName, { type: 'application/octet-stream' })
    const { fileId } = await uploadFile(encFile, { mimeType: encMime, folderId: targetFolderId, isVault: false, isEncrypted: true, teamId, skipDedup: true, thumbData })
    if (deleteSource) await api.permanentDeleteFile(file.id)
    return fileId
  }

  async function moveFolderTreeToTeam(sourceFolder, teamId, teamKeyB64, teamParentFolderId, onFileStart, { deleteSource = true, overrideName } = {}) {
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
    const d = await api.listFiles({ folder: sourceFolder.id })
    for (const file of (d.files || [])) {
      onFileStart(file.filename)
      try { await encryptAndMoveToTeam(file, teamId, teamKeyB64, newTeamFolderId, { deleteSource }) } catch (_) {}
    }
    for (const subfolder of (d.folders || [])) {
      await moveFolderTreeToTeam(subfolder, teamId, teamKeyB64, newTeamFolderId, onFileStart, { deleteSource })
    }
    if (deleteSource) try { await api.permanentDeleteFolder(sourceFolder.id) } catch (_) {}
  }

  async function copyFileToFiles(file, targetFolderId, { overrideName } = {}) {
    const resp = await fetchFileWithAuth(file.id)
    const rawBuf = await resp.arrayBuffer()
    const mime = file.mime_type || 'application/octet-stream'
    const uploadName = overrideName || file.filename
    let thumbData = null
    try {
      const tempFile = new File([rawBuf], uploadName, { type: mime })
      if (mime.startsWith('image/')) thumbData = await generateThumb(tempFile)
      else if (mime.startsWith('video/')) thumbData = await generateVideoThumb(tempFile)
    } catch (_) {}
    const copyFile = new File([rawBuf], uploadName, { type: mime })
    const { fileId } = await uploadFile(copyFile, { mimeType: mime, folderId: targetFolderId, skipDedup: true, thumbData })
    return fileId
  }

  async function copyFolderTreeToFiles(sourceFolder, targetFolderId, onFileStart, { overrideName } = {}) {
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
    const d = await api.listFiles({ folder: sourceFolder.id })
    for (const file of (d.files || [])) {
      onFileStart(file.filename)
      try { await copyFileToFiles(file, newFolderId) } catch (_) {}
    }
    for (const subfolder of (d.folders || [])) {
      await copyFolderTreeToFiles(subfolder, newFolderId, onFileStart)
    }
  }

  async function resolveFileConflicts(selectedFiles, destSection, destFolderId, destTeamId) {
    let destFiles = []
    try {
      if (destSection === 'teams' && destTeamId) {
        const d = await api.listTeamFiles(destTeamId, destFolderId ? { folderId: destFolderId } : {})
        destFiles = d.files || []
      } else {
        const params = {}
        if (destSection === 'vault') params.vault = '1'
        if (destFolderId) params.folder = destFolderId
        const d = await api.listFiles(params)
        destFiles = d.files || []
      }
    } catch (_) {}
    const destNames = new Set(destFiles.map(f => f.filename))
    const decisions = new Map()
    for (const file of selectedFiles) {
      if (destNames.has(file.filename)) {
        const result = await showFolderConflictDialog(file.filename, 'file')
        decisions.set(file.id, result)
      }
    }
    return decisions
  }

  async function resolveFolderConflicts(selectedFolders, destSection, destFolderId, destTeamId) {
    let destFolders = []
    try {
      if (destSection === 'teams' && destTeamId) {
        const d = await api.listTeamFiles(destTeamId, destFolderId ? { folderId: destFolderId } : {})
        destFolders = d.folders || []
      } else {
        const params = {}
        if (destSection === 'vault') params.vault = '1'
        if (destFolderId) params.folder = destFolderId
        const d = await api.listFiles(params)
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

  async function handleMoveModalConfirm_teams(fileIds, folderObjs, teamId, teamKeyB64, folderId) {
    const selectedFiles = files.filter(f => fileIds.includes(f.id))
    const conflicts = await resolveFileConflicts(selectedFiles, 'teams', folderId, teamId)
    const folderConflicts = await resolveFolderConflicts(folderObjs, 'teams', folderId, teamId)
    const folderFileLists = await Promise.all(folderObjs.map(f => collectFolderFiles(f.id)))
    const totalFileCount = selectedFiles.length + folderFileLists.reduce((n, fl) => n + fl.length, 0)
    setVaultProgress({ done: 0, total: totalFileCount, filename: '' })
    let done = 0, success = 0
    for (const file of selectedFiles) {
      setVaultProgress({ done: done++, total: totalFileCount, filename: file.filename })
      const conf = conflicts.get(file.id)
      if (conf?.action === 'cancel') continue
      try {
        const overrideName = conf?.action === 'rename' ? conf.customName : undefined
        await encryptAndMoveToTeam(file, teamId, teamKeyB64, folderId, { overrideName })
        success++
        setFiles(prev => prev.filter(f => f.id !== file.id))
      } catch (e) {
        toast.error(`Failed to move "${file.filename}": ${e.message || 'unknown error'}`)
      }
    }
    for (const folder of folderObjs) {
      const fc = folderConflicts.get(folder.id)
      if (fc?.action === 'cancel') continue
      try {
        const overrideName = fc?.action === 'rename' ? fc.customName : undefined
        await moveFolderTreeToTeam(folder, teamId, teamKeyB64, folderId, filename => {
          setVaultProgress({ done: done++, total: totalFileCount, filename })
        }, { overrideName })
        success++
      } catch (e) {
        toast.error(`Failed to move folder: ${e.message || 'unknown error'}`)
      }
    }
    setVaultProgress(null)
    if (success > 0) toast.success(`Moved ${success} item(s) to workspace`)
    load()
  }

  async function handleMoveModalConfirm(section, folderId, teamId = null) {
    const fileIds    = [...selectedFileIds]
    const folderObjs = folders.filter(f => selectedFolderIds.has(f.id))
    clearSelection()
    setShowMoveModal(false)

    if (section === 'teams') {
      const teamKeyB64 = teamId ? sessionStorage.getItem(`team_key_${teamId}`) : null
      if (!teamKeyB64) {
        toast.error('Workspace is locked — open it in Secured Sharing first, then try again')
        setSelectedFileIds(new Set(fileIds))
        return
      }
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const largeOnes = selectedFiles.filter(f => (f.size_bytes || 0) > 50 * 1024 * 1024)
      if (largeOnes.length > 0) {
        setLargeFilesWarning({ names: largeOnes.map(f => f.filename), proceed: () => handleMoveModalConfirm_teams(fileIds, folderObjs, teamId, teamKeyB64, folderId) })
        return
      }
      await handleMoveModalConfirm_teams(fileIds, folderObjs, teamId, teamKeyB64, folderId)
      return
    }

    if (section === 'vault') {
      const v1Key = sessionStorage.getItem('dd_vault_key')
      const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
      if (!v1Key && !v2Key) {
        toast.error('Vault is locked — unlock it first, then try again')
        setSelectedFileIds(new Set(fileIds))
        return
      }
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const conflicts = await resolveFileConflicts(selectedFiles, 'vault', folderId, null)
      const folderConflicts = await resolveFolderConflicts(folderObjs, 'vault', folderId, null)
      // Count all files upfront (files + files inside selected folders) for the progress bar
      const folderFileLists = await Promise.all(folderObjs.map(f => collectFolderFiles(f.id)))
      const totalFileCount  = selectedFiles.length + folderFileLists.reduce((n, fl) => n + fl.length, 0)
      let done = 0
      setVaultProgress({ done: 0, total: totalFileCount, filename: '' })
      let success = 0
      for (const file of selectedFiles) {
        setVaultProgress({ done: done++, total: totalFileCount, filename: file.filename })
        const conf = conflicts.get(file.id)
        if (conf?.action === 'cancel') continue
        try {
          const overrideName = conf?.action === 'rename' ? conf.customName : undefined
          await encryptAndMoveToVault(file, folderId, { overrideName })
          success++
        } catch (_) {}
      }
      for (const folder of folderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        try {
          const overrideName = fc?.action === 'rename' ? fc.customName : undefined
          await moveFolderTreeToVault(folder, folderId, filename => {
            setVaultProgress({ done: done++, total: totalFileCount, filename })
          }, { overrideName })
          success += folderFileLists[folderObjs.indexOf(folder)].length
        } catch (_) {}
      }
      setVaultProgress(null)
      if (success > 0) toast.success(`${success} item(s) moved to Vault`)
      load()
    } else {
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const conflicts = await resolveFileConflicts(selectedFiles, 'files', folderId, null)
      const folderConflicts = await resolveFolderConflicts(folderObjs, 'files', folderId, null)
      let success = 0
      for (const file of selectedFiles) {
        const conf = conflicts.get(file.id)
        if (conf?.action === 'cancel') continue
        try {
          const newName = conf?.action === 'rename' ? conf.customName : undefined
          await api.updateFile(file.id, { folderId: folderId ?? null, ...(newName ? { filename: newName } : {}) })
          success++
        } catch(e) { toast.error(e.message || 'Move failed') }
      }
      for (const folder of folderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        try {
          const newName = fc?.action === 'rename' ? fc.customName : undefined
          await api.renameFolder(folder.id, { parentId: folderId ?? null, ...(newName ? { name: newName } : {}) })
          success++
        } catch(e) { toast.error(e.message || 'Move failed') }
      }
      if (success > 0) { toast.success(`Moved ${success} item(s)`); load(true) }
      else load()
    }
  }

  async function handleCopyModalConfirm(section, folderId, teamId = null) {
    const fileIds    = [...selectedFileIds]
    const folderObjs = folders.filter(f => selectedFolderIds.has(f.id))
    setShowCopyModal(false)

    if (section === 'teams') {
      const teamKeyB64 = teamId ? sessionStorage.getItem(`team_key_${teamId}`) : null
      if (!teamKeyB64) { toast.error('Workspace is locked — open it in Secured Sharing first'); return }
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const conflicts = await resolveFileConflicts(selectedFiles, 'teams', folderId, teamId)
      const folderConflicts = await resolveFolderConflicts(folderObjs, 'teams', folderId, teamId)
      const folderFileLists = await Promise.all(folderObjs.map(f => collectFolderFiles(f.id)))
      const totalFileCount = selectedFiles.length + folderFileLists.reduce((n, fl) => n + fl.length, 0)
      setVaultProgress({ done: 0, total: totalFileCount, filename: '' })
      let done = 0, success = 0
      for (const file of selectedFiles) {
        setVaultProgress({ done: done++, total: totalFileCount, filename: file.filename })
        const conf = conflicts.get(file.id)
        if (conf?.action === 'cancel') continue
        try {
          const overrideName = conf?.action === 'rename' ? conf.customName : undefined
          await encryptAndMoveToTeam(file, teamId, teamKeyB64, folderId, { deleteSource: false, overrideName })
          success++
        } catch (_) {}
      }
      for (const folder of folderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        try {
          const overrideName = fc?.action === 'rename' ? fc.customName : undefined
          await moveFolderTreeToTeam(folder, teamId, teamKeyB64, folderId, filename => {
            setVaultProgress({ done: done++, total: totalFileCount, filename })
          }, { deleteSource: false, overrideName })
          success++
        } catch (_) {}
      }
      setVaultProgress(null)
      if (success > 0) toast.success(`Copied ${success} item(s) to workspace`)
      return
    }

    if (section === 'vault') {
      const v1Key = sessionStorage.getItem('dd_vault_key')
      const v2Key = sessionStorage.getItem('dd_vault_private_key_pkcs8')
      if (!v1Key && !v2Key) { toast.error('Vault is locked — unlock it first'); return }
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const conflicts = await resolveFileConflicts(selectedFiles, 'vault', folderId, null)
      const folderConflicts = await resolveFolderConflicts(folderObjs, 'vault', folderId, null)
      const folderFileLists = await Promise.all(folderObjs.map(f => collectFolderFiles(f.id)))
      const totalFileCount = selectedFiles.length + folderFileLists.reduce((n, fl) => n + fl.length, 0)
      let done = 0
      setVaultProgress({ done: 0, total: totalFileCount, filename: '' })
      let success = 0
      for (const file of selectedFiles) {
        setVaultProgress({ done: done++, total: totalFileCount, filename: file.filename })
        const conf = conflicts.get(file.id)
        if (conf?.action === 'cancel') continue
        try {
          const overrideName = conf?.action === 'rename' ? conf.customName : undefined
          await encryptAndMoveToVault(file, folderId, { deleteSource: false, overrideName })
          success++
        } catch (_) {}
      }
      for (const folder of folderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        try {
          const overrideName = fc?.action === 'rename' ? fc.customName : undefined
          await moveFolderTreeToVault(folder, folderId, filename => {
            setVaultProgress({ done: done++, total: totalFileCount, filename })
          }, { deleteSource: false, overrideName })
          success++
        } catch (_) {}
      }
      setVaultProgress(null)
      if (success > 0) toast.success(`Copied ${success} item(s) to Vault`)
    } else {
      const selectedFiles = files.filter(f => fileIds.includes(f.id))
      const conflicts = await resolveFileConflicts(selectedFiles, 'files', folderId, null)
      const folderConflicts = await resolveFolderConflicts(folderObjs, 'files', folderId, null)
      const folderFileLists = await Promise.all(folderObjs.map(f => collectFolderFiles(f.id)))
      const totalFileCount = selectedFiles.length + folderFileLists.reduce((n, fl) => n + fl.length, 0)
      let done = 0
      setVaultProgress({ done: 0, total: totalFileCount, filename: '' })
      let success = 0
      for (const file of selectedFiles) {
        setVaultProgress({ done: done++, total: totalFileCount, filename: file.filename })
        const conf = conflicts.get(file.id)
        if (conf?.action === 'cancel') continue
        try {
          const overrideName = conf?.action === 'rename' ? conf.customName : undefined
          await copyFileToFiles(file, folderId, { overrideName })
          success++
        } catch (_) {}
      }
      for (const folder of folderObjs) {
        const fc = folderConflicts.get(folder.id)
        if (fc?.action === 'cancel') continue
        try {
          const overrideName = fc?.action === 'rename' ? fc.customName : undefined
          await copyFolderTreeToFiles(folder, folderId, filename => {
            setVaultProgress({ done: done++, total: totalFileCount, filename })
          }, { overrideName })
          success++
        } catch (_) {}
      }
      setVaultProgress(null)
      if (success > 0) { toast.success(`Copied ${success} item(s)`); load() }
    }
  }

  async function handleConfirmReceipt(file) {
    try {
      const res = await api.confirmReceipt(file.share_id)
      if (res.deleted) {
        toast.success('Receipt confirmed — file deleted from sender\'s storage')
      } else {
        toast.success('Receipt confirmed')
      }
      load()
    } catch (e) { toast.error(e.message) }
  }

  async function handleDismissShare(file) {
    try {
      await api.dismissShare(file.share_id)
      toast.success(`Removed "${file.filename || file.folder_name}" from shared with me`)
      load()
    } catch (e) { toast.error(e.message) }
  }

  function handleOpenSharedFolder(item) {
    setSharedFolderView({ shareId: item.share_id, folderName: item.folder_name })
    setSharedFolderPath([])
    setSharedFolderFolderId(null)
    setSearch('')
  }

  function navigateSharedFolder(subfolder) {
    setSharedFolderPath(prev => [...prev, { id: sharedFolderFolderId, name: subfolder.name }])
    setSharedFolderFolderId(subfolder.id)
    setSearch('')
  }

  function sharedFolderBack(idx) {
    if (idx < 0) {
      setSharedFolderPath([])
      setSharedFolderFolderId(null)
    } else {
      const target = sharedFolderPath[idx]
      setSharedFolderPath(prev => prev.slice(0, idx))
      setSharedFolderFolderId(target.id)
    }
  }

  const navItems = [
    { key: 'files',    Icon: IcoFiles,    label: 'Files',            desc: 'Shareable · versioned · encrypted in transit' },
    { key: 'vault',    Icon: IcoVault,    label: 'Vault',            desc: 'E2EE · encrypted before leaving device' },
    { key: 'teams',    Icon: IcoTeams,    label: 'Secured Sharing',  desc: 'E2EE · account-to-account only' },
  ]

  const filtered = (search
    ? files.filter(f => (f.filename || f.folder_name || f.name || '').toLowerCase().includes(search.toLowerCase()))
    : files
  ).filter(f => view !== 'files' || !f.is_vault)

  const filteredFolders = search
    ? folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : folders

  // ── Avatar initials helper ──────────────────────────────────────────────
  const displayName = userProfile?.display_name || user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || '?'
  const userEmail   = user?.emailAddresses?.[0]?.emailAddress

  // Sidebar content (reused for mobile drawer + desktop static)
  function SidebarContent({ onNavigate }) {
    const usedGb   = meter ? (meter.storageBytes || 0) / (1024**3) : 0
    const limitGb  = meter?.maxGb || 5
    const pct      = Math.min(100, (usedGb / limitGb) * 100)
    const barColor = pct >= 100 ? '#E24B4A' : pct >= 80 ? '#F59E0B' : '#6366F1'
    const cost     = meter?.estimatedCost?.toFixed(2) || '0.00'

    return (
      <div style={{ display:'flex',flexDirection:'column',height:'100%' }}>
        {/* Logo */}
        <div style={{ padding:'18px 16px 20px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display:'flex',alignItems:'center',gap:10 }}>
            <svg width={22} height={22} viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="7" fill="#6366F1"/>
              <path d="M11 4h6v10h4l-7 8-7-8h4z" fill="white"/>
            </svg>
            <span style={{ fontFamily:"'Space Grotesk',sans-serif",fontSize:22,fontWeight:800,letterSpacing:'-0.04em',lineHeight:1 }}>
              <span style={{ color:'#EDEDFF' }}>Data</span><span style={{ color:'#6366F1' }}>Drop</span>
            </span>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex:1,padding:'0 8px',display:'flex',flexDirection:'column',gap:1 }}>
          {navItems.map(n => {
            const active = n.key === 'files' ? ['files','shared','received'].includes(view) : view === n.key
            return (
              <button key={n.key}
                onClick={() => { setView(n.key); onNavigate?.() }}
                style={{ display:'flex',alignItems:'flex-start',gap:9,padding:'6px 12px',
                          color:active?'#EDEDFF':'#8888AA',
                          background:active?'rgba(99,102,241,0.1)':'transparent',
                          borderRadius:8,cursor:'pointer',
                          border:'none',
                          width:'100%',textAlign:'left',transition:'color 120ms,background 120ms' }}
                onMouseEnter={e=>{ if(!active){e.currentTarget.style.color='#EDEDFF';e.currentTarget.style.background='rgba(255,255,255,0.04)'} }}
                onMouseLeave={e=>{ if(!active){e.currentTarget.style.color='#8888AA';e.currentTarget.style.background='transparent'} }}>
                <span style={{ opacity:active?1:0.7, flexShrink:0, marginTop:3 }}><n.Icon /></span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex',alignItems:'center',gap:4 }}>
                    <span style={{ fontSize:14,fontWeight:active?600:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }}>{n.label}</span>
                    {active && <div style={{ width:4,height:4,borderRadius:'50%',background:'#6366F1',flexShrink:0 }} />}
                  </div>
                  <div style={{ fontSize:10,color:active?'rgba(238,238,248,0.4)':'#7A7AAA',marginTop:1,fontWeight:400,lineHeight:1.4 }}>{n.desc}</div>
                </div>
              </button>
            )
          })}

        </div>

        {/* Settings button — standalone above user section */}
        <div style={{ borderTop:'1px solid rgba(255,255,255,.07)', padding:'8px 8px' }}>
          <button
            onClick={() => { setView('settings'); onNavigate?.() }}
            style={{ display:'flex',alignItems:'center',gap:9,padding:'8px 12px',
                      fontSize:14,fontWeight:view==='settings'?600:500,
                      color:view==='settings'?'#EDEDFF':'#8888AA',
                      background:view==='settings'?'rgba(99,102,241,0.1)':'transparent',
                      borderRadius:8,cursor:'pointer',border:'none',
                      width:'100%',textAlign:'left',transition:'color 120ms,background 120ms' }}
            onMouseEnter={e=>{ if(view!=='settings'){e.currentTarget.style.color='#EDEDFF';e.currentTarget.style.background='rgba(255,255,255,0.04)'} }}
            onMouseLeave={e=>{ if(view!=='settings'){e.currentTarget.style.color='#8888AA';e.currentTarget.style.background='transparent'} }}>
            <span style={{ opacity: view==='settings' ? 1 : 0.7 }}><IcoGear /></span>
            Settings & Billing
            {view==='settings' && <div style={{ marginLeft:'auto', width:4, height:4, borderRadius:'50%', background:'#6366F1', flexShrink:0 }} />}
          </button>
        </div>

        {/* User section */}
        <div style={{ padding:'12px 16px',borderTop:'1px solid rgba(255,255,255,.07)',display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ width:32,height:32,borderRadius:'50%',flexShrink:0,
                         background:'linear-gradient(135deg,#6366F1,#6366F1)',
                         display:'flex',alignItems:'center',justifyContent:'center',
                         fontSize:13,fontWeight:700,color:'#fff' }}>
            {displayName[0].toUpperCase()}
          </div>
          <div style={{ flex:1,minWidth:0 }}>
            <div style={{ fontSize:12,fontWeight:600,color:'#EDEDFF',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
              {userEmail || displayName}
            </div>
            <button onClick={() => signOut()}
              style={{ fontSize:11,fontWeight:500,color:'#7A7AAA',background:'none',
                        border:'none',cursor:'pointer',padding:0,marginTop:2,
                        display:'block',textAlign:'left',transition:'color 150ms' }}
              onMouseEnter={e=>{ e.currentTarget.style.color='#E24B4A' }}
              onMouseLeave={e=>{ e.currentTarget.style.color='#7A7AAA' }}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  const totalSel = selectedFileIds.size + selectedFolderIds.size

  return (
    <div style={{ display:'flex',height:'100vh',overflow:'hidden',background:'#08081A' }}>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div style={{ position:'fixed',inset:0,background:'rgba(8,8,26,0.7)',zIndex:40,backdropFilter:'blur(4px)' }}
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile sidebar drawer */}
      {isMobile && (
        <div style={{ position:'fixed',left:sidebarOpen?0:-260,top:0,bottom:0,zIndex:50,width:248,
                       background:'#0D0D22',borderRight:'1px solid rgba(255,255,255,.07)',
                       transition:'left .25s cubic-bezier(0.4,0,0.2,1)',overflow:'hidden' }}>
          <SidebarContent onNavigate={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Desktop static sidebar */}
      {!isMobile && (
        <div style={{ width:248,minWidth:248,flexShrink:0,height:'100vh',
                       background:'#0D0D22',borderRight:'1px solid rgba(255,255,255,.07)',
                       display:'flex',flexDirection:'column' }}>
          <SidebarContent />
        </div>
      )}

      {/* Main content area */}
      <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0 }}>

        {/* Topbar — hidden for vault/teams on desktop (nothing to show there) */}
        {(!['vault','teams'].includes(view) || isMobile) && <div style={{ display:'flex',alignItems:'center',gap:10,padding:'12px 20px',
                       background:'#0D0D22',borderBottom:'1px solid rgba(255,255,255,.07)',flexShrink:0 }}>
          {isMobile && (
            <button onClick={() => setSidebarOpen(true)}
              style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 6px 2px 0',
                        color:'#8888AA',flexShrink:0,display:'flex',alignItems:'center' }}>
              <IcoHamburger />
            </button>
          )}

          {/* View title on mobile / breadcrumb on desktop */}
          {!['settings','vault','teams'].includes(view) && (
            <>
              {view === 'files' && currentFolder !== null ? (
                <div style={{ display:'flex',alignItems:'center',gap:6,fontSize:13,color:'#8888AA',flexWrap:'wrap',flex:1,minWidth:0 }}>
                  <span style={{ cursor:'pointer',color:'#EDEDFF',fontWeight:500 }} onClick={() => navigateBreadcrumb(-1)}>Files</span>
                  {folderPath.map((f,i) => (
                    <React.Fragment key={i}>
                      <span style={{ color:'#7A7AAA' }}>›</span>
                      <span style={{ cursor:'pointer',color:'#8888AA' }} onClick={() => navigateBreadcrumb(i)}>{f.label}</span>
                    </React.Fragment>
                  ))}
                  <span style={{ color:'#7A7AAA' }}>›</span>
                  <span style={{ color:'#EDEDFF',fontWeight:600 }}>{currentFolderName}</span>
                </div>
              ) : (
                <div style={{ flex:1,minWidth:0,position:'relative',display:'flex',alignItems:'center' }}>
                  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" style={{ position:'absolute',left:12,pointerEvents:'none' }}>
                    <circle cx="7" cy="7" r="4.5" stroke="#7A7AAA" strokeWidth="1.4"/>
                    <path d="M10.5 10.5L13 13" stroke="#7A7AAA" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <input
                    style={{ width:'100%',padding:'9px 14px 9px 34px',border:'1px solid rgba(255,255,255,.07)',
                               borderRadius:10,fontSize:13,outline:'none',
                               background:'#111130',color:'#EDEDFF',transition:'border-color 150ms' }}
                    placeholder={`Search ${view === 'shared' ? 'shared' : view === 'received' ? 'received' : view}…`}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onFocus={e => e.target.style.borderColor='#6366F1'}
                    onBlur={e => e.target.style.borderColor='rgba(255,255,255,.07)'}
                  />
                </div>
              )}
            </>
          )}


          {/* Action buttons */}
          {view === 'files' && (
            <div style={{ display:'flex',gap:8,flexShrink:0 }}>
              {!isMobile && (
                <button onClick={() => setFolderModalOpen(true)}
                  style={{ padding:'8px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:9,
                             background:'transparent',fontSize:13,fontWeight:500,cursor:'pointer',
                             color:'#8888AA',whiteSpace:'nowrap',transition:'border-color 150ms,color 150ms' }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,.14)';e.currentTarget.style.color='#EDEDFF'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,.07)';e.currentTarget.style.color='#8888AA'}}>
                  + Folder
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()}
                style={{ padding:'8px 18px',background:'#6366F1',color:'#fff',border:'none',
                           borderRadius:9,fontSize:13,fontWeight:600,cursor:'pointer',
                           whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:7,
                           transition:'background 150ms' }}
                onMouseEnter={e=>e.currentTarget.style.background='#4A4DDE'}
                onMouseLeave={e=>e.currentTarget.style.background='#6366F1'}>
                <IcoUpload />
                Upload
              </button>
              <input ref={fileInputRef} type="file" multiple style={{ display:'none' }}
                onChange={e => { const f = Array.from(e.target.files); e.target.value=''; handleUpload(f) }} />
            </div>
          )}
        </div>}

        {/* Files section sub-tabs */}
        {['files','shared','received'].includes(view) && (
          <div style={{ display:'flex',padding:'0 12px',background:'#0D0D22',
                         borderBottom:'1px solid rgba(255,255,255,.07)',flexShrink:0 }}>
            {[
              { key:'files',    label:'Your Files' },
              { key:'shared',   label:'Shared with You' },
              { key:'received', label:'Received' },
            ].map(t => {
              const active = view === t.key
              return (
                <button key={t.key} onClick={() => setView(t.key)}
                  style={{ padding:'9px 16px',fontSize:13,fontWeight:active?600:500,
                             color:active?'#EDEDFF':'#8888AA',background:'none',border:'none',
                             borderBottom:active?'2px solid #6366F1':'2px solid transparent',
                             cursor:'pointer',transition:'color 120ms,border-color 120ms',
                             marginBottom:'-1px' }}>
                  {t.label}
                </button>
              )
            })}
          </div>
        )}

        <UploadProgressPanel uploads={uploading} />

        {/* Vault encryption progress — fixed bottom-right panel */}
        {vaultProgress && (
          <div style={{
            position:'fixed', bottom:20, right:20, width:320,
            background:'#0D0D22', border:'1px solid rgba(255,255,255,.07)',
            borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,.6)', zIndex:601,
            overflow:'hidden', fontFamily:'inherit',
          }}>
            <div style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'10px 14px', background:'#111130',
              borderBottom: vaultProgress.filename ? '1px solid rgba(255,255,255,.07)' : 'none',
            }}>
              <div style={{
                width:14, height:14, border:'2px solid rgba(99,102,241,.3)',
                borderTopColor:'#6366F1', borderRadius:'50%', flexShrink:0,
                animation:'dd-spin 0.7s linear infinite',
              }} />
              <span style={{ fontSize:13, fontWeight:600, color:'#EDEDFF', flex:1 }}>
                Encrypting {vaultProgress.done} of {vaultProgress.total} file{vaultProgress.total !== 1 ? 's' : ''}…
              </span>
            </div>
            {vaultProgress.filename && (
              <div style={{ padding:'6px 14px 8px' }}>
                <div style={{
                  fontSize:12, color:'#8888AA',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                }}>
                  {vaultProgress.filename}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Payment Recovery Banner */}
        {recoveryStatus?.inRecovery && (
          <div style={{
            background:'rgba(220,38,38,0.1)', borderBottom:'1px solid rgba(220,38,38,0.25)',
            padding:'10px 20px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap',
            flexShrink:0,
          }}>
            <span style={{ fontSize:13, color:'#fca5a5', fontWeight:600 }}>⚠ Payment Required</span>
            <span style={{ fontSize:12, color:'#f87171', flex:1 }}>
              AutoPay could not be completed. Upload and write operations are paused.
              {recoveryStatus.daysRemaining > 0
                ? ` ${recoveryStatus.daysRemaining} day${recoveryStatus.daysRemaining !== 1 ? 's' : ''} remaining before permanent deletion.`
                : ' Data deletion is imminent.'}
            </span>
            <button
              onClick={() => setView('settings')}
              style={{ padding:'5px 14px', background:'#DC2626', color:'#fff', border:'none',
                         borderRadius:7, fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
              Pay ₹{recoveryStatus.amountDue?.toFixed(2)} Now
            </button>
            <button
              onClick={() => setView('settings')}
              style={{ padding:'5px 14px', background:'transparent', color:'#fca5a5',
                         border:'1px solid rgba(220,38,38,0.4)', borderRadius:7, fontSize:12,
                         fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
              Change AutoPay
            </button>
          </div>
        )}

        {/* Main scrollable content */}
        <UploadZone onDrop={handleUpload} active={view === 'files'}>
          <div style={{ flex:1,overflow:'auto',padding:24,background:'#050510' }}>

            {/* Shared folder breadcrumb */}
            {view === 'received' && sharedFolderView && (
              <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:20,fontSize:13,flexWrap:'wrap' }}>
                <span style={{ cursor:'pointer',color:'#8888AA',fontWeight:500 }}
                  onClick={() => { setSharedFolderView(null); setSharedFolderPath([]); setSharedFolderFolderId(null) }}>
                  Shared with me
                </span>
                <span style={{ color:'#7A7AAA' }}>›</span>
                <span style={{ cursor:'pointer',color:'#8888AA' }}
                  onClick={() => sharedFolderBack(-1)}>{sharedFolderView.folderName}</span>
                {sharedFolderPath.map((seg,i) => (
                  <React.Fragment key={i}>
                    <span style={{ color:'#7A7AAA' }}>›</span>
                    <span style={{ cursor:'pointer',color:'#8888AA' }} onClick={() => sharedFolderBack(i)}>{seg.name}</span>
                  </React.Fragment>
                ))}
              </div>
            )}

            {view === 'settings' && <Settings />}
            {view === 'vault'    && <VaultSetup />}
            {view === 'teams'    && <TeamsView currentUserId={userProfile?.id || user?.id} onGoToVault={() => setView('vault')} />}

            {/* Bulk selection action bar */}
            {totalSel > 0 && ['files','received','shared'].includes(view) && (
              <div style={{ padding:'10px 16px',background:'#111130',border:'1px solid rgba(255,255,255,.07)',
                             display:'flex',alignItems:'center',gap:14,fontSize:13,
                             borderRadius:10,marginBottom:14,flexWrap:'wrap' }}>
                <span style={{ fontWeight:600,color:'#EDEDFF' }}>{totalSel} item{totalSel !== 1 ? 's' : ''} selected</span>
                {view === 'files' && (
                  <button onClick={() => { setSelectedFileIds(new Set(filtered.map(f=>f.id))); setSelectedFolderIds(new Set(filteredFolders.map(f=>f.id))) }}
                    style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,padding:0 }}>
                    Select all
                  </button>
                )}
                <div style={{ flex:1 }} />
                {selectedFileIds.size > 0 && (
                  <button onClick={bulkDownload}
                    style={{ color:'#818CF8',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
                    ↓ Download
                  </button>
                )}
                {view === 'files' && totalSel > 0 && (
                  <button onClick={() => setShowMoveModal(true)}
                    style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:5 }}>
                    <svg width={13} height={13} viewBox="0 0 14 14" fill="none"><path d="M1 7h10M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Move
                  </button>
                )}
                {view === 'files' && totalSel > 0 && (
                  <button onClick={() => setShowCopyModal(true)}
                    style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
                    ⧉ Copy to
                  </button>
                )}
                {view === 'files' && totalSel > 0 && (
                  <button onClick={() => {
                    const fileItems   = files.filter(f => selectedFileIds.has(f.id))
                    const folderItems = filteredFolders.filter(f => selectedFolderIds.has(f.id)).map(f => ({ id: f.id, filename: f.name }))
                    setBulkShareFiles([...fileItems, ...folderItems])
                  }}
                    style={{ color:'#8888AA',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500,display:'flex',alignItems:'center',gap:5 }}>
                    <svg width={12} height={12} viewBox="0 0 14 14" fill="none"><circle cx="10.5" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="3.5" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="10.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4.9 6.2l4.2-2M4.9 7.8l4.2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    Share
                  </button>
                )}
                {view === 'files' && (
                  <button onClick={bulkDelete}
                    style={{ color:'#E24B4A',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:500 }}>
                    Delete
                  </button>
                )}
                <button onClick={clearSelection}
                  style={{ background:'rgba(255,255,255,0.06)',color:'#8888AA',border:'none',borderRadius:7,
                             padding:'5px 10px',fontSize:12,cursor:'pointer' }}>
                  Cancel
                </button>
              </div>
            )}

            {!['settings','vault','teams'].includes(view) && (
              <FileGrid
                files={filtered}
                folders={view === 'files' ? filteredFolders : (view === 'received' && sharedFolderView ? folders : [])}
                view={view}
                loading={loading}
                onOpenFolder={view === 'received' && sharedFolderView ? navigateSharedFolder : openFolder}
                onPreview={setPreview}
                onShare={setShareTarget}
                onDelete={handleDelete}
                onRename={setRenameTarget}
                onVersions={setVersionFile}
                onDeleteFolder={handleDeleteFolder}
                onRenameFolder={handleRenameFolder}
                onRevokeShare={handleRevokeShare}
                onEditShare={view === 'shared' ? setEditShareTarget : undefined}
                onOpenSharedFolder={view === 'received' && !sharedFolderView ? handleOpenSharedFolder : undefined}
                onMoveToVault={view === 'files' ? handleMoveToVault : undefined}
                onMoveFolderToVault={view === 'files' ? handleMoveFolderToVault : undefined}
                onMoveFolder={view === 'files' ? handleMoveFolderClick : undefined}
                onReport={view === 'received' ? setReportTarget : undefined}
                onAcceptMove={view === 'received' ? handleAcceptMove : undefined}
                onConfirmReceipt={view === 'received' ? handleConfirmReceipt : undefined}
                onDismissShare={view === 'received' ? handleDismissShare : undefined}
                selectedFileIds={selectedFileIds}
                selectedFolderIds={selectedFolderIds}
                onToggleFile={['files','received','shared'].includes(view) ? toggleFile : undefined}
                onToggleFolder={view === 'files' ? toggleFolder : undefined}
                onShareFolder={view === 'files' ? f => setShareTarget({ id:f.id, filename:f.name }) : undefined}
              />
            )}
          </div>
        </UploadZone>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {renameTarget && (
        <RenameModal
          initial={renameTarget.name}
          onConfirm={name => handleRename(renameTarget.id, name)}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {shareTarget   && <ShareModal files={[shareTarget]} onClose={() => { setShareTarget(null); load() }} />}
      {bulkShareFiles && <ShareModal files={bulkShareFiles} onClose={() => { setBulkShareFiles(null); load() }} />}
      {preview       && <FilePreview file={preview} onClose={() => setPreview(null)} canDownload={view === 'received' ? !!preview.can_download : true} />}
      {versionFile   && <VersionHistory
        file={versionFile}
        onClose={() => { setVersionFile(null); load(true) }}
        onRestored={() => { setVersionFile(null); load(true) }}
        onPreview={v => setPreview(v)}
      />}
      {deleteTarget && (
        <DeleteConfirmModal
          file={deleteTarget}
          onDelete={doPermanentDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {bulkDeleteConfirm && (
        <BulkDeleteConfirmModal
          count={selectedFileIds.size + selectedFolderIds.size}
          onDelete={executeBulkDelete}
          onClose={() => setBulkDeleteConfirm(false)}
        />
      )}
      {folderModalOpen && (
        <NewFolderModal onConfirm={createFolder} onClose={() => setFolderModalOpen(false)} />
      )}
      {conflictTarget && (
        <FileConflictModal
          name={conflictTarget.name}
          existing={conflictTarget.existing}
          onDecide={resolveConflict}
        />
      )}
      {folderConflictTarget && (
        <FolderConflictModal
          name={folderConflictTarget.name}
          itemType={folderConflictTarget.itemType || 'folder'}
          onDecide={resolveFolderConflict}
        />
      )}
      {pinPending && (
        <VaultPinModal
          onUnlocked={() => { const fn = pinPending; setPinPending(null); fn() }}
          onClose={() => setPinPending(null)}
        />
      )}
      {editShareTarget && (
        <EditShareModal
          share={editShareTarget}
          onSave={async (updates) => { await handleEditShare(editShareTarget, updates); setEditShareTarget(null) }}
          onClose={() => setEditShareTarget(null)}
        />
      )}
      {reportTarget && (
        <ReportModal file={reportTarget} onClose={() => setReportTarget(null)} />
      )}
      {showMoveModal && (
        <FileMoveModal
          initialSection="files"
          selectedCount={totalSel}
          excludeFolderIds={selectedFolderIds}
          onMove={handleMoveModalConfirm}
          onClose={() => setShowMoveModal(false)}
        />
      )}
      {showCopyModal && (
        <FileMoveModal
          initialSection="files"
          selectedCount={totalSel}
          excludeFolderIds={selectedFolderIds}
          actionLabel="Copy Here"
          onMove={handleCopyModalConfirm}
          onClose={() => setShowCopyModal(false)}
        />
      )}
      {largeFilesWarning && (
        <LargeFilesWarningModal
          names={largeFilesWarning.names}
          onProceed={() => { const fn = largeFilesWarning.proceed; setLargeFilesWarning(null); fn() }}
          onClose={() => setLargeFilesWarning(null)}
        />
      )}
      {limitExceededBlock && !showLimitUpgrade && (
        <LimitExceededModal
          capacityGb={limitExceededBlock.capacityGb}
          limitRs={limitExceededBlock.limitRs}
          filename={limitExceededBlock.fileToUpload?.name}
          onIncrease={() => setShowLimitUpgrade(true)}
          onClose={() => { setLimitExceededBlock(null); setShowLimitUpgrade(false) }}
        />
      )}
      {showLimitUpgrade && limitExceededBlock && (
        <LimitUpgradeModal
          currentLimit={limitExceededBlock.limitRs}
          onSuccess={() => retryBlockedUpload(limitExceededBlock)}
          onClose={() => { setShowLimitUpgrade(false); setLimitExceededBlock(null) }}
        />
      )}
    </div>
  )
}

// ── SVG Nav Icons ──────────────────────────────────────────────────────────
function IcoFiles()    { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none"><path d="M3 8a2 2 0 012-2h5l1.5 1.5H19a2 2 0 012 2v8.5a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".1" strokeLinejoin="round"/></svg> }
function IcoVault()    { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none"><rect x="5" y="12" width="14" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity=".1"/><path d="M8 12V9A4 4 0 0 1 16 9V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="12" cy="16.5" r="1.8" fill="currentColor"/></svg> }
function IcoTeams()    { return <svg width={20} height={20} viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" fill="currentColor" fillOpacity=".12"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="16.5" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.3" fill="currentColor" fillOpacity=".12"/><path d="M17 15.5c3 .5 5.5 2.5 5.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function IcoShareOut() { return <svg width={15} height={15} viewBox="0 0 16 16" fill="none"><circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="4" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 7l5-2M5.5 9l5 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function IcoShareIn()  { return <svg width={15} height={15} viewBox="0 0 16 16" fill="none"><path d="M13 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M8 6v4M6 8.5l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IcoTrash()    { return <svg width={15} height={15} viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M4 5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L12 5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M6.5 8v3M9.5 8v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function IcoGear()     { return <svg width={15} height={15} viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IcoUpload()   { return <svg width={13} height={13} viewBox="0 0 14 14" fill="none"><path d="M7 2v8M4 5l3-3 3 3M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IcoHamburger(){ return <svg width={18} height={18} viewBox="0 0 18 18" fill="none"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> }

// ── Dark overlay backdrop ──────────────────────────────────────────────────
const DarkOverlay = ({ onClick, blur = false }) => (
  <div style={{ position:'fixed',inset:0,background:'rgba(8,8,26,0.85)',zIndex:200,
                 backdropFilter:blur?'blur(8px)':'none' }}
    onClick={onClick} />
)

// ── Shared modal card style ────────────────────────────────────────────────
const MC = {
  bg:     '#0D0D22',
  border: '1px solid rgba(255,255,255,.07)',
  radius: 16,
  pad:    28,
  textP:  '#EDEDFF',
  textS:  '#8888AA',
  input:  { width:'100%',padding:'10px 14px',border:'1px solid rgba(255,255,255,.07)',borderRadius:10,
             fontSize:14,outline:'none',background:'#161625',color:'#EDEDFF',boxSizing:'border-box' },
  btnP:   { padding:'10px 20px',background:'#6366F1',color:'#fff',border:'none',
             borderRadius:10,fontWeight:600,fontSize:14,cursor:'pointer' },
  btnS:   { padding:'10px 20px',background:'#161625',color:'#8888AA',border:'1px solid rgba(255,255,255,.07)',
             borderRadius:10,fontWeight:600,fontSize:14,cursor:'pointer' },
  btnD:   { padding:'10px 20px',background:'rgba(226,75,74,0.1)',color:'#E24B4A',
             border:'1px solid rgba(226,75,74,0.25)',borderRadius:10,fontWeight:600,fontSize:14,cursor:'pointer' },
}

function DeleteConfirmModal({ file, onDelete, onClose }) {
  const name = file.filename || file.name || 'this item'
  const isFolder = file.item_type === 'folder'
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,
                       width:'100%',maxWidth:400,boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:8 }}>Delete permanently?</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:20,lineHeight:1.5 }}>
            {isFolder
              ? `"${name}" and all its contents will be permanently deleted. This cannot be undone.`
              : `"${name}" will be permanently deleted. This cannot be undone.`}
          </p>
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={onDelete} style={MC.btnD}>Delete</button>
            <button onClick={onClose} style={MC.btnS}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )
}

function BulkDeleteConfirmModal({ count, onDelete, onClose }) {
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,
                       width:'100%',maxWidth:400,boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:8 }}>
            Delete permanently?
          </h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:20,lineHeight:1.5 }}>
            These files/folders will be permanently deleted. This cannot be undone.
          </p>
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={onDelete} style={MC.btnD}>Delete</button>
            <button onClick={onClose} style={MC.btnS}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )
}

function LargeFilesWarningModal({ names, onProceed, onClose }) {
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,
                       width:'100%',maxWidth:460,boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:8 }}>Large file detected</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:8,lineHeight:1.6 }}>
            Re-encrypting large files can take a long time. We recommend downloading
            the file and re-uploading it directly in the destination instead.
          </p>
          <ul style={{ margin:'0 0 16px 0',padding:'0 0 0 16px',fontSize:12,color:'#8888AA',lineHeight:1.8 }}>
            {names.map(n => <li key={n}>{n}</li>)}
          </ul>
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={onClose} style={MC.btnP}>Download &amp; re-upload instead</button>
            <button onClick={onProceed} style={MC.btnS}>Move anyway</button>
          </div>
        </div>
      </div>
    </>
  )
}

function LimitExceededModal({ capacityGb, limitRs, filename, onIncrease, onClose }) {
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 8900, padding: 16,
  }
  const card = {
    background: '#13132A', border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 16, padding: 28, width: '100%', maxWidth: 400,
    boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
  }
  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={card}>
        <div style={{ fontSize: 32, marginBottom: 12, textAlign: 'center' }}>📦</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#EDEDFF', marginBottom: 8, textAlign: 'center' }}>
          Storage Capacity Reached
        </div>
        <div style={{ fontSize: 13, color: '#8888AA', lineHeight: 1.6, marginBottom: 20, textAlign: 'center' }}>
          {filename ? <><strong style={{ color: '#EDEDFF' }}>{filename}</strong><br /></> : null}
          Your {capacityGb > 0 ? `${capacityGb.toFixed(1)} GB` : ''} storage capacity is full.
          Increase your monthly limit (currently ₹{limitRs}/mo) to upload more.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px 0', background: 'transparent',
                     border: '1px solid rgba(255,255,255,.08)', borderRadius: 10,
                     color: '#8888AA', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onIncrease}
            style={{ flex: 2, padding: '10px 0', background: '#6366F1', borderRadius: 10,
                     color: '#fff', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            Increase Limit
          </button>
        </div>
      </div>
    </div>
  )
}

function NewFolderModal({ onConfirm, onClose }) {
  const [name, setName]             = useState('')
  const [submitting, setSubmitting] = useState(false)
  async function submit() {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try { await onConfirm(name) } finally { setSubmitting(false) }
  }
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,
                       width:'100%',maxWidth:360,boxShadow:'0 24px 64px rgba(0,0,0,0.6)' }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:20 }}>New Folder</h3>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={e=>{ if(e.key==='Enter') submit(); if(e.key==='Escape') onClose() }}
            style={{ ...MC.input,marginBottom:16 }} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={submit} disabled={submitting || !name.trim()}
              style={{ ...MC.btnP,flex:1,opacity:(!name.trim()||submitting)?.6:1 }}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button onClick={onClose} style={{ ...MC.btnS,flex:1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )
}

function FileConflictModal({ name, existing, onDecide }) {
  const [renameMode, setRenameMode] = React.useState(false)
  const [customName, setCustomName] = React.useState(() => {
    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name
    const ext  = dotIdx >= 0 ? name.slice(dotIdx) : ''
    return `${base} (2)${ext}`
  })
  function fmtSize(b) {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`
    return `${(b/(1024*1024)).toFixed(1)} MB`
  }
  const optBtn = (accent) => ({
    width:'100%',padding:'12px 16px',border:`1px solid ${accent||'rgba(255,255,255,.07)'}`,borderRadius:10,
    fontWeight:600,fontSize:13,cursor:'pointer',textAlign:'left',
    background:'#161625',color:accent||MC.textP,
    display:'flex',flexDirection:'column',gap:3,transition:'background 150ms,border-color 150ms',
  })
  if (renameMode) return (
    <>
      <DarkOverlay onClick={() => setRenameMode(false)} blur />
      <div style={{ position:'fixed',inset:0,zIndex:301,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:420 }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:8 }}>Rename and upload</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:16 }}>Enter a name for the uploaded file:</p>
          <input autoFocus value={customName} onChange={e=>setCustomName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter'&&customName.trim()) onDecide({decision:'keep',customName:customName.trim()}); if(e.key==='Escape') setRenameMode(false) }}
            style={{ ...MC.input,marginBottom:16 }} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={()=>{ if(customName.trim()) onDecide({decision:'keep',customName:customName.trim()}) }}
              style={{ ...MC.btnP,flex:1 }}>Upload</button>
            <button onClick={()=>setRenameMode(false)} style={{ ...MC.btnS,flex:1 }}>Back</button>
          </div>
        </div>
      </div>
    </>
  )
  return (
    <>
      <DarkOverlay blur />
      <div style={{ position:'fixed',inset:0,zIndex:301,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:440 }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:6 }}>File already exists</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:4,lineHeight:1.5 }}>
            <strong style={{ color:MC.textP }}>"{name}"</strong> already exists
            {existing?.size_bytes ? ` · ${fmtSize(existing.size_bytes)} · ${new Date(existing.created_at).toLocaleDateString('en-IN')}` : ''}.
          </p>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:20 }}>What would you like to do?</p>
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            <button style={optBtn('#6366F1')} onClick={()=>onDecide('version')}>
              <span>Create new version</span>
              <span style={{ fontSize:11,fontWeight:400,color:MC.textS }}>Keep old file as v1 — new upload becomes current</span>
            </button>
            <button style={optBtn('#E24B4A')} onClick={()=>onDecide('replace')}>
              <span>Replace</span>
              <span style={{ fontSize:11,fontWeight:400,color:MC.textS }}>Move old file to trash, replace with new upload</span>
            </button>
            <button style={optBtn()} onClick={()=>setRenameMode(true)}>
              <span>Rename and upload</span>
              <span style={{ fontSize:11,fontWeight:400,color:MC.textS }}>Choose a new name and upload alongside the existing file</span>
            </button>
            <button onClick={()=>onDecide('cancel')}
              style={{ background:'none',border:'none',fontSize:13,color:MC.textS,cursor:'pointer',padding:'6px 0',fontWeight:500,marginTop:4 }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function FolderConflictModal({ name, itemType = 'folder', onDecide }) {
  const [renameMode, setRenameMode] = React.useState(false)
  const label = itemType === 'file' ? 'file' : 'folder'
  const [customName, setCustomName] = React.useState(() => {
    if (itemType === 'file') {
      const dotIdx = name.lastIndexOf('.')
      const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name
      const ext  = dotIdx >= 0 ? name.slice(dotIdx) : ''
      return `${base} (2)${ext}`
    }
    return `${name} (2)`
  })
  const optBtn = (accent) => ({
    width:'100%', padding:'12px 16px', border:`1px solid ${accent||'rgba(255,255,255,.07)'}`, borderRadius:10,
    fontWeight:600, fontSize:13, cursor:'pointer', textAlign:'left',
    background:'#161625', color:accent||MC.textP,
    display:'flex', flexDirection:'column', gap:3, transition:'background 150ms,border-color 150ms',
  })
  if (renameMode) return (
    <>
      <DarkOverlay onClick={() => setRenameMode(false)} blur />
      <div style={{ position:'fixed',inset:0,zIndex:301,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:420 }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:8 }}>Rename {label}</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:16 }}>Enter a new name for the {label}:</p>
          <input autoFocus value={customName} onChange={e=>setCustomName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter'&&customName.trim()) onDecide({action:'rename',customName:customName.trim()}); if(e.key==='Escape') setRenameMode(false) }}
            style={{ ...MC.input,marginBottom:16 }} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={()=>{ if(customName.trim()) onDecide({action:'rename',customName:customName.trim()}) }}
              style={{ ...MC.btnP,flex:1 }}>Confirm</button>
            <button onClick={()=>setRenameMode(false)} style={{ ...MC.btnS,flex:1 }}>Back</button>
          </div>
        </div>
      </div>
    </>
  )
  return (
    <>
      <DarkOverlay blur />
      <div style={{ position:'fixed',inset:0,zIndex:301,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:440 }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:6 }}>{label.charAt(0).toUpperCase()+label.slice(1)} already exists</h3>
          <p style={{ fontSize:13,color:MC.textS,marginBottom:20,lineHeight:1.5 }}>
            A {label} named <strong style={{ color:MC.textP }}>"{name}"</strong> already exists in the destination.
            What would you like to do?
          </p>
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            <button style={optBtn()} onClick={()=>setRenameMode(true)}>
              <span>Rename and move</span>
              <span style={{ fontSize:11,fontWeight:400,color:MC.textS }}>Choose a new name for this {label}</span>
            </button>
            <button onClick={()=>onDecide({action:'cancel'})}
              style={{ background:'none',border:'none',fontSize:13,color:MC.textS,cursor:'pointer',padding:'6px 0',fontWeight:500,marginTop:4 }}>
              Skip this {label}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function RenameModal({ initial, onConfirm, onClose }) {
  const [name, setName] = useState(initial)
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:360 }}>
          <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP,marginBottom:16 }}>Rename file</h3>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') onConfirm(name); if(e.key==='Escape') onClose() }}
            style={{ ...MC.input,marginBottom:16 }} />
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={()=>onConfirm(name)} style={{ ...MC.btnP,flex:1 }}>Rename</button>
            <button onClick={onClose} style={{ ...MC.btnS,flex:1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )
}

function EditShareModal({ share, onSave, onClose }) {
  const [canView,     setCanView]     = useState(!!share.can_view)
  const [canDownload, setCanDownload] = useState(!!share.can_download)
  const [canSave,     setCanSave]     = useState(!!share.can_save)
  const [expiresAt,   setExpiresAt]   = useState(
    share.expires_at ? new Date(share.expires_at).toISOString().slice(0,16) : ''
  )
  const [saving, setSaving] = useState(false)
  async function handleSave() {
    setSaving(true)
    try { await onSave({ canView, canDownload, canSave, expiresAt: expiresAt ? new Date(expiresAt).getTime() : null }) }
    finally { setSaving(false) }
  }
  const Toggle = ({ label, val, set }) => (
    <label style={{ display:'flex',alignItems:'center',gap:12,padding:'11px 0',cursor:'pointer',
                     borderBottom:'1px solid rgba(255,255,255,.07)' }}>
      <input type="checkbox" checked={val} onChange={e=>set(e.target.checked)}
        style={{ width:16,height:16,cursor:'pointer',accentColor:'#6366F1' }} />
      <span style={{ fontSize:14,color:MC.textP }}>{label}</span>
    </label>
  )
  return (
    <>
      <DarkOverlay onClick={onClose} blur />
      <div style={{ position:'fixed',inset:0,zIndex:201,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
        <div style={{ background:MC.bg,border:MC.border,borderRadius:MC.radius,padding:MC.pad,width:'100%',maxWidth:380 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
            <h3 style={{ fontSize:16,fontWeight:700,color:MC.textP }}>Share permissions</h3>
            <button onClick={onClose} style={{ background:'#161625',border:'1px solid rgba(255,255,255,.07)',borderRadius:8,
                                                 width:32,height:32,fontSize:18,cursor:'pointer',color:MC.textS,
                                                 display:'flex',alignItems:'center',justifyContent:'center' }}>×</button>
          </div>
          <div style={{ fontSize:12,color:MC.textS,marginBottom:16,lineHeight:1.5 }}>
            {share.filename || share.folder_name || 'File'}
            {share.recipient_display_name || share.recipient_email
              ? ` → ${share.recipient_display_name || share.recipient_email}` : ''}
          </div>
          <Toggle label="Can view" val={canView} set={setCanView} />
          <Toggle label="Can download" val={canDownload} set={setCanDownload} />
          <Toggle label="Can save to their storage" val={canSave} set={setCanSave} />
          <div style={{ padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,.07)' }}>
            <label style={{ fontSize:13,fontWeight:600,display:'block',marginBottom:8,color:MC.textP }}>Expiry</label>
            <input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)}
              style={{ ...MC.input,fontSize:13 }} />
            {expiresAt && (
              <button onClick={()=>setExpiresAt('')}
                style={{ fontSize:12,color:MC.textS,background:'none',border:'none',cursor:'pointer',marginTop:6,padding:0 }}>
                Clear expiry
              </button>
            )}
          </div>
          <div style={{ display:'flex',gap:10,marginTop:20 }}>
            <button onClick={handleSave} disabled={saving} style={{ ...MC.btnP,flex:1,opacity:saving?.7:1 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={onClose} style={{ ...MC.btnS,flex:1 }}>Cancel</button>
          </div>
        </div>
      </div>
    </>
  )
}
