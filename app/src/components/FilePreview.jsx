import React, { useState, useEffect, useRef } from 'react'
import { api, downloadFile, fetchFileWithAuth, unwrapDEKWithPrivateKey, decryptWithDEK } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'

const STREAM = import.meta.env.VITE_STREAM_URL || 'https://stream.datadrop.co.in'

export default function FilePreview({ file, onClose, canDownload = true, vaultKey = null, vaultPrivKeyB64 = null }) {
  const toast = useToastMethods()
  const [streamToken, setStreamToken] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [textContent, setTextContent] = useState(null)
  const [blobUrl,     setBlobUrl]     = useState(null)
  const videoRef                      = useRef()

  const mime = file.mime_type || ''
  const isVideo  = mime.startsWith('video/')
  const isImage  = mime.startsWith('image/')
  const isAudio  = mime.startsWith('audio/')
  const isPDF    = mime === 'application/pdf'
  const isText   = mime.startsWith('text/')
  const isVault  = !!(vaultKey || vaultPrivKeyB64)

  // Decrypt vault file using V2 (ECDH DEK) or V1 (shared key)
  async function decryptVaultContent() {
    if (vaultPrivKeyB64) {
      try {
        const keyData = await api.getVaultFileKey(file.id)
        const dekBytes = await unwrapDEKWithPrivateKey(
          keyData.encryptedDek, keyData.dekNonce, keyData.ephemeralPublicKey, vaultPrivKeyB64
        )
        const resp = await fetchFileWithAuth(file.id)
        const enc = await resp.arrayBuffer()
        return new Uint8Array(await decryptWithDEK(dekBytes, enc))
      } catch (_) {
        // File may have been uploaded under V1 vault before upgrade
        if (vaultKey) {
          const resp = await fetchFileWithAuth(file.id, vaultKey)
          const buf = await resp.arrayBuffer()
          return new Uint8Array(buf)
        }
        throw new Error('This file was encrypted with the original vault key. Re-upload it to access it with your upgraded vault.')
      }
    } else {
      const resp = await fetchFileWithAuth(file.id, vaultKey)
      const buf = await resp.arrayBuffer()
      return new Uint8Array(buf)
    }
  }

  useEffect(() => {
    let createdUrl = null
    // Encrypted vault files: download all types client-side and decrypt (no streaming)
    if (isVault) {
      ;(async () => {
        try {
          const bytes = await decryptVaultContent()
          if (isText) {
            setTextContent(new TextDecoder().decode(bytes))
          } else {
            const blob = new Blob([bytes], { type: mime })
            createdUrl = URL.createObjectURL(blob)
            setBlobUrl(createdUrl)
          }
        } catch (e) {
          setError(e.message)
        } finally {
          setLoading(false)
        }
      })()
    } else if (isVideo) {
      api.streamToken(file.id)
        .then(d => setStreamToken(d))
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    } else if (isPDF || isText || isImage || isAudio) {
      ;(async () => {
        try {
          const resp = await fetchFileWithAuth(file.id)
          if (isText) {
            const text = await resp.text()
            setTextContent(text)
          } else {
            const blob = await resp.blob()
            createdUrl = URL.createObjectURL(blob)
            setBlobUrl(createdUrl)
          }
        } catch (e) {
          setError(e.message)
        } finally {
          setLoading(false)
        }
      })()
    } else {
      setLoading(false)
    }
    return () => { if (createdUrl) URL.revokeObjectURL(createdUrl) }
  }, [file.id, vaultKey, vaultPrivKeyB64])

  // Rotate stream token before expiry (60s)
  useEffect(() => {
    if (!streamToken) return
    const ttl = streamToken.expiresAt - Date.now() - 5000
    const id  = setTimeout(async () => {
      try {
        const d = await api.streamToken(file.id)
        setStreamToken(d)
        if (videoRef.current) {
          const currentTime = videoRef.current.currentTime
          videoRef.current.src = streamUrl(d)
          videoRef.current.currentTime = currentTime
          videoRef.current.play()
        }
      } catch {}
    }, Math.max(ttl, 1000))
    return () => clearTimeout(id)
  }, [streamToken])

  function streamUrl(tok) {
    if (!tok) return null
    const params = new URLSearchParams({
      token: tok.token,
      uid: tok.userId || '',
    })
    return `${STREAM}/stream/${file.id}?${params}`
  }

  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      if (vaultPrivKeyB64) {
        try {
          const keyData  = await api.getVaultFileKey(file.id)
          const dekBytes = await unwrapDEKWithPrivateKey(
            keyData.encryptedDek, keyData.dekNonce, keyData.ephemeralPublicKey, vaultPrivKeyB64
          )
          await downloadFile(file.id, file.filename, null, dekBytes)
        } catch (_) {
          if (vaultKey) {
            await downloadFile(file.id, file.filename, vaultKey)
          } else {
            throw new Error('This file uses the original vault key. Re-upload it to download with your upgraded vault.')
          }
        }
      } else {
        await downloadFile(file.id, file.filename, vaultKey)
      }
    } catch (e) {
      toast.error(`Download failed: ${e.message}`)
    }
    setDownloading(false)
  }

  const modal = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 200,
    display: 'flex', flexDirection: 'column',
  }
  const header = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)',
    color: '#fff', flexShrink: 0,
  }
  const body = {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', padding: 20,
  }

  return (
    <div style={modal}>
      {/* Header */}
      <div style={header}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:14, fontWeight:600 }}>{file.filename}</span>
          {!!file.is_vault && <span style={{ fontSize:11, background:'rgba(255,255,255,0.1)',
                                            padding:'2px 8px', borderRadius:100 }}>🔒 Vault</span>}
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center' }}>
          {canDownload && (
            <button onClick={handleDownload} disabled={downloading}
              style={{ color:'rgba(255,255,255,0.7)', fontSize:13, background:'none', border:'none',
                        cursor: downloading ? 'wait' : 'pointer' }}>
              {downloading ? '↓ Downloading…' : '↓ Download'}
            </button>
          )}
          <button onClick={onClose}
            style={{ background:'none', border:'none', color:'#fff', fontSize:24,
                      cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
      </div>

      {/* Body */}
      <div style={body}>
        {loading && <Spinner />}

        {!loading && error && (
          <div style={{ color:'#f87171', textAlign:'center' }}>
            <div style={{ fontSize:24, marginBottom:8 }}>⚠️</div>
            <div>{error}</div>
          </div>
        )}

        {!loading && !error && isVideo && blobUrl && (
          <video
            src={blobUrl}
            controls
            autoPlay
            style={{ maxWidth:'100%', maxHeight:'100%', borderRadius:8 }}
          />
        )}

        {!loading && !error && isVideo && !blobUrl && streamToken && (
          <video
            ref={videoRef}
            src={streamUrl(streamToken)}
            controls
            autoPlay
            style={{ maxWidth:'100%', maxHeight:'100%', borderRadius:8 }}
          />
        )}

        {!loading && !error && isImage && blobUrl && (
          <img
            src={blobUrl}
            alt={file.filename}
            style={{ maxWidth:'100%', maxHeight:'100%', borderRadius:8, objectFit:'contain' }}
          />
        )}

        {!loading && !error && isAudio && blobUrl && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:64, marginBottom:24 }}>🎵</div>
            <div style={{ color:'#fff', fontSize:16, fontWeight:600, marginBottom:20 }}>{file.filename}</div>
            <audio src={blobUrl} controls style={{ width:360 }} />
          </div>
        )}

        {!loading && !error && isPDF && blobUrl && (
          <iframe
            src={blobUrl}
            style={{ width:'100%', height:'100%', border:'none', borderRadius:8 }}
            title={file.filename}
          />
        )}

        {!loading && !error && isText && textContent !== null && (
          <pre style={{
            background: 'rgba(255,255,255,0.05)', color: '#e5e7eb',
            padding: 24, borderRadius: 8, margin: 0,
            overflow: 'auto', maxWidth: '100%', maxHeight: '100%',
            fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            flex: 1, width: '100%',
          }}>
            {textContent || <span style={{ color: 'rgba(255,255,255,0.3)' }}>(empty file)</span>}
          </pre>
        )}

        {!loading && !error && !isVideo && !isImage && !isAudio && !isPDF && !isText && (
          <div style={{ textAlign:'center', color:'#fff' }}>
            <div style={{ fontSize:64, marginBottom:20 }}>📄</div>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>{file.filename}</div>
            <div style={{ color:'rgba(255,255,255,0.5)', marginBottom:24 }}>
              Preview not available for this file type
            </div>
            {canDownload && (
              <button
                onClick={handleDownload} disabled={downloading}
                style={{ background:'#fff', color:'#111', padding:'12px 24px',
                          borderRadius:8, border:'none', fontWeight:600,
                          cursor: downloading ? 'wait' : 'pointer' }}>
                {downloading ? '↓ Downloading…' : '↓ Download'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div style={{ width:32, height:32, border:'3px solid rgba(255,255,255,0.2)',
                   borderTopColor:'#fff', borderRadius:'50%',
                   animation:'spin 0.7s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
