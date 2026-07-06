import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '@clerk/clerk-react'
import { api } from '../lib/api.js'

// ============================================================
// InviteClaim — /invite/:token
// ============================================================
export function InviteClaim() {
  const { token }    = useParams()
  const { isSignedIn, isLoaded } = useAuth()
  const navigate     = useNavigate()
  const [status, setStatus] = useState('loading')
  const [error,  setError]  = useState(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      // Store token in sessionStorage, redirect to sign-in
      sessionStorage.setItem('pending_invite', token)
      navigate(`/sign-in?redirect=/invite/${token}`)
      return
    }
    claimIt()
  }, [isLoaded, isSignedIn])

  async function claimIt() {
    try {
      const res = await api.claimInvite(token)
      setStatus('claimed')
      // Redirect to file after short delay
      setTimeout(() => navigate(res.fileId ? `/` : '/'), 1500)
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
                   background:'#f9fafb', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:400 }}>
        <div style={{ fontSize:32, marginBottom:16 }}>
          {status === 'loading' ? '⏳' : status === 'claimed' ? '✓' : '⚠️'}
        </div>
        <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>
          {status === 'loading' ? 'Claiming invite…'
            : status === 'claimed' ? 'Access granted'
            : 'Could not claim invite'}
        </div>
        <div style={{ fontSize:14, color:'#6b7280' }}>
          {status === 'claimed' ? 'Redirecting to your files…'
            : error || ''}
        </div>
        {status === 'error' && (
          <button onClick={() => navigate('/')}
            style={{ marginTop:20, background:'#111', color:'#fff', border:'none',
                      borderRadius:8, padding:'10px 20px', cursor:'pointer', fontWeight:600 }}>
            Go to DataDrop
          </button>
        )}
      </div>
    </div>
  )
}

export default InviteClaim

// ============================================================
// SharedFile — /shared/:shareId
// ============================================================
export function SharedFile() {
  const { shareId }  = useParams()
  const { isSignedIn, isLoaded } = useAuth()
  const navigate     = useNavigate()
  const [share, setShare]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      navigate(`/sign-in?redirect=/shared/${shareId}`)
      return
    }
    api.getShare(shareId)
      .then(d => setShare(d.share))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [isLoaded, isSignedIn, shareId])

  if (loading) return <CenterMsg icon="⏳" title="Loading…" />
  if (error)   return <CenterMsg icon="⚠️" title="Share not found" desc={error} />

  return (
    <div style={{ minHeight:'100vh', background:'#f9fafb', display:'flex',
                   alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:16,
                     padding:32, maxWidth:400, width:'100%' }}>
        <div style={{ fontSize:14, fontWeight:600, color:'#6b7280', marginBottom:4 }}>Shared with you</div>
        <div style={{ fontSize:20, fontWeight:700, marginBottom:20 }}>{share?.filename}</div>

        <div style={{ display:'flex', gap:10 }}>
          {share?.can_view && (
            <button
              onClick={() => navigate('/', { state: { previewFileId: share.file_id } })}
              style={{ flex:1, padding:'10px', background:'#111', color:'#fff',
                        border:'none', borderRadius:8, fontWeight:600, cursor:'pointer' }}>
              Open
            </button>
          )}
          {share?.can_download && (
            <a
              href={`https://files.datadrop.co.in/files/${share.file_id}`}
              download
              style={{ flex:1, padding:'10px', background:'#f3f4f6', color:'#111',
                        border:'none', borderRadius:8, fontWeight:600, cursor:'pointer',
                        textDecoration:'none', textAlign:'center' }}>
              Download
            </a>
          )}
        </div>

        {share?.delete_on_confirm && !share?.confirmed_at && (
          <button
            onClick={async () => {
              await api.confirmReceipt({ shareId })
              alert('Receipt confirmed. File will be deleted.')
              navigate('/')
            }}
            style={{ width:'100%', marginTop:12, padding:'10px', background:'none',
                      border:'1px solid #e5e7eb', borderRadius:8, cursor:'pointer',
                      fontSize:13, color:'#6b7280' }}>
            ✓ Confirm receipt (deletes file)
          </button>
        )}

        <button onClick={() => navigate('/')}
          style={{ width:'100%', marginTop:12, padding:'10px', background:'none',
                    border:'none', cursor:'pointer', fontSize:13, color:'#9ca3af' }}>
          ← Go to my files
        </button>
      </div>
    </div>
  )
}

function CenterMsg({ icon, title, desc }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center',
                   justifyContent:'center', textAlign:'center', padding:20 }}>
      <div>
        <div style={{ fontSize:40, marginBottom:16 }}>{icon}</div>
        <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>{title}</div>
        {desc && <div style={{ fontSize:14, color:'#6b7280' }}>{desc}</div>}
      </div>
    </div>
  )
}
