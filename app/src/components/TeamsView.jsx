import React, { useState, useEffect, useCallback, useRef } from 'react'
import { api, deriveTeamKey, encryptForVault, decryptFromVault, wrapDEKWithPublicKey, unwrapDEKWithPrivateKey, uploadFile, fetchFileWithAuth, downloadFile, downloadZip } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'
import { useBreakpoint } from '../lib/hooks.js'
import FileGrid from './FileGrid.jsx'

// dark tokens: bg=#07070D bg2=#0F0F1A bg3=#11111E bg4=#161625
// border=#1E1E32 border2=#252540 indigo=#5B5EF4 green=#00C27C
// red=#E24B4A amber=#F59E0B textP=#EEEEF8 textS=#8888AA textT=#55556A

const card = { background: '#11111E', border: '1px solid #1E1E32', borderRadius: 12, padding: 20 }
const btn = (variant = 'primary', sm = false) => ({
  padding: sm ? '5px 12px' : '8px 16px', fontSize: sm ? 12 : 13, fontWeight: 600,
  border: 'none', borderRadius: 7, cursor: 'pointer',
  ...(variant === 'primary' ? { background: '#5B5EF4', color: '#fff' } :
      variant === 'danger'  ? { background: 'rgba(226,75,74,.12)', color: '#E24B4A', border: '1px solid rgba(226,75,74,.25)' } :
      variant === 'success' ? { background: 'rgba(0,194,124,.12)', color: '#00C27C', border: '1px solid rgba(0,194,124,.25)' } :
      variant === 'warning' ? { background: 'rgba(245,158,11,.12)', color: '#F59E0B', border: '1px solid rgba(245,158,11,.25)' } :
      /* ghost */              { background: '#161625', color: '#8888AA', border: '1px solid #1E1E32' }),
})

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(2)} GB`
}

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
      if (settled) return; settled = true
      URL.revokeObjectURL(url); resolve(result)
    }
    const timeout = setTimeout(() => finish(null), 10000)
    video.preload = 'metadata'; video.muted = true; video.playsInline = true
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
    video.src = url; video.load()
  })
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(7,7,13,.88)',backdropFilter:'blur(4px)',display:'flex',
                   alignItems:'center',justifyContent:'center',zIndex:200,padding:16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#0F0F1A',border:'1px solid #1E1E32',borderRadius:16,width:480,maxWidth:'100%',
                     maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.6)',display:'flex',flexDirection:'column' }}>
        <div style={{ padding:'18px 22px',borderBottom:'1px solid #1E1E32',display:'flex',justifyContent:'space-between',
                       alignItems:'center',position:'sticky',top:0,background:'#0F0F1A',zIndex:1 }}>
          <span style={{ fontWeight:700,fontSize:15,color:'#EEEEF8' }}>{title}</span>
          <button onClick={onClose} style={{ background:'#161625',border:'none',fontSize:20,cursor:'pointer',color:'#8888AA',borderRadius:6,width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center' }}>&times;</button>
        </div>
        <div style={{ padding:'18px 22px',flex:1 }}>{children}</div>
        {footer && (
          <div style={{ padding:'14px 22px',borderTop:'1px solid #1E1E32',display:'flex',justifyContent:'flex-end',gap:8,position:'sticky',bottom:0,background:'#0F0F1A' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

const ROLE_LABELS = { read: 'Read only', upload: 'Can upload', full: 'Full access', admin: 'Admin', owner: 'Owner' }
const ROLE_COLORS = {
  owner:  ['rgba(167,139,250,.15)', '#a78bfa', 'rgba(167,139,250,.3)'],
  admin:  ['rgba(91,94,244,.12)',   '#5B5EF4', 'rgba(91,94,244,.25)'],
  full:   ['rgba(0,194,124,.1)',    '#00C27C', 'rgba(0,194,124,.25)'],
  upload: ['rgba(136,136,170,.1)', '#8888AA', '#1E1E32'],
  read:   ['rgba(245,158,11,.1)',   '#F59E0B', 'rgba(245,158,11,.25)'],
}
function RoleBadge({ role }) {
  const [bg, color, border] = ROLE_COLORS[role] || ROLE_COLORS.read
  return (
    <span style={{ fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:99,background:bg,color,border:`1px solid ${border}`,flexShrink:0 }}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

function PassphraseModal({ teamName, onUnlock, onClose }) {
  const [pass, setPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    if (!pass.trim()) { setError('Enter a passphrase'); return }
    setLoading(true); setError('')
    try { await onUnlock(pass) } catch (e) { setError(e.message || 'Failed'); setLoading(false) }
  }
  return (
    <Modal title={`Unlock "${teamName}"`} onClose={onClose}
      footer={<>
        <button onClick={onClose} style={btn('ghost', true)}>Cancel</button>
        <button onClick={submit} disabled={loading} style={btn('primary', true)}>
          {loading ? 'Unlocking…' : 'Unlock'}
        </button>
      </>}>
      <p style={{ fontSize:13,color:'#8888AA',marginBottom:14,lineHeight:1.6 }}>
        Enter the passphrase to access <strong style={{ color:'#EEEEF8' }}>{teamName}</strong>. Decrypted locally &mdash; key never leaves your device.
      </p>
      <input type="password" placeholder="Team passphrase" value={pass}
        onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
        style={{ width:'100%',padding:'10px 12px',border:'1px solid #1E1E32',borderRadius:8,fontSize:14,outline:'none',
                  marginBottom:10,boxSizing:'border-box',background:'#161625',color:'#EEEEF8' }} autoFocus />
      {error && <div style={{ color:'#E24B4A',fontSize:13,marginBottom:8 }}>{error}</div>}
      <div style={{ padding:'10px 12px',background:'rgba(245,158,11,.1)',borderRadius:8,border:'1px solid rgba(245,158,11,.25)',fontSize:12,color:'#F59E0B',lineHeight:1.5 }}>
        Passphrase never sent to our servers. Not even we can read team files.
      </div>
    </Modal>
  )
}

function ConflictModal({ filename, onResolve, onClose }) {
  return (
    <Modal title={`"${filename}" already exists`} onClose={onClose}>
      <p style={{ fontSize:13,color:'#8888AA',marginBottom:18 }}>A file with this name already exists here. What would you like to do?</p>
      <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
        {[
          { key:'version', label:'Save as new version',   sub:'Keep the existing file and save this as v2, v3, etc.', v:'primary' },
          { key:'replace', label:'Replace',               sub:'Overwrite the existing file permanently.',              v:'warning' },
          { key:'keep',    label:'Keep both',             sub:'Upload with a different name.',                         v:'ghost'   },
          { key:'cancel',  label:'Cancel',                sub:null,                                                    v:'ghost'   },
        ].map(({ key, label, sub, v }) => (
          <button key={key} onClick={() => onResolve(key)}
            style={{ ...btn(v), textAlign:'left', padding:'12px 16px', borderRadius:10, color: key==='cancel'?'#55556A':undefined }}>
            <div style={{ fontWeight:700,marginBottom: sub?2:0 }}>{label}</div>
            {sub && <div style={{ fontSize:12,fontWeight:400,opacity:.7 }}>{sub}</div>}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function TeamPreviewModal({ file, teamKeyB64, onClose }) {
  const toast = useToastMethods()
  const [src, setSrc]           = useState(null)
  const [text, setText]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [dlLoading, setDlLoad]  = useState(false)
  const originalMime = file.mime_type?.replace('encrypted:', '') || 'application/octet-stream'
  const isImage = originalMime.startsWith('image/')
  const isVideo = originalMime.startsWith('video/')
  const isAudio = originalMime.startsWith('audio/')
  const isPdf   = originalMime === 'application/pdf'
  const isText  = originalMime.startsWith('text/')

  useEffect(() => {
    let url = null;
    (async () => {
      try {
        const resp = await fetchFileWithAuth(file.id, teamKeyB64)
        if (isText) { setText(await resp.text()) }
        else { const buf = await resp.arrayBuffer(); const blob = new Blob([buf], { type: originalMime }); url = URL.createObjectURL(blob); setSrc(url) }
      } catch(e) { setError(e.message) }
      finally { setLoading(false) }
    })()
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [file.id])

  async function dl() {
    setDlLoad(true)
    try { await downloadFile(file.id, file.filename, teamKeyB64) }
    catch(e) { toast.error('Download failed: ' + e.message) }
    setDlLoad(false)
  }

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.9)',zIndex:300,display:'flex',flexDirection:'column' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 24px',
                     borderBottom:'1px solid rgba(255,255,255,.1)',color:'#fff',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',gap:12 }}>
          <span style={{ fontSize:14,fontWeight:600 }}>{file.filename}</span>
          <span style={{ fontSize:11,background:'rgba(0,194,124,.08)',color:'#00C27C',border:'1px solid rgba(0,194,124,.2)',padding:'2px 8px',borderRadius:99,display:'inline-flex',alignItems:'center',gap:4 }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="5.5" width="8" height="5.5" rx="1.5" fill="rgba(0,194,124,.15)" stroke="#00C27C" strokeWidth="1"/>
              <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="#00C27C" strokeWidth="1" strokeLinecap="round"/>
            </svg>
            E2E encrypted
          </span>
        </div>
        <div style={{ display:'flex',gap:12,alignItems:'center' }}>
          <button onClick={dl} disabled={dlLoading} style={{ color:'rgba(255,255,255,.7)',fontSize:13,background:'none',border:'none',cursor:'pointer' }}>
            {dlLoading ? '↓ Downloading…' : '↓ Download'}
          </button>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'#fff',fontSize:24,cursor:'pointer' }}>&times;</button>
        </div>
      </div>
      <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:20 }}>
        {loading && <div style={{ width:32,height:32,border:'3px solid rgba(255,255,255,.2)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin .7s linear infinite' }}><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>}
        {!loading && error && (
          <div style={{ color:'#E24B4A',textAlign:'center' }}>
            <div style={{ fontWeight:700,fontSize:16,marginBottom:8 }}>Error</div>
            <div>{error}</div>
          </div>
        )}
        {!loading && !error && isImage && src && <img src={src} alt={file.filename} style={{ maxWidth:'100%',maxHeight:'100%',borderRadius:8,objectFit:'contain' }} />}
        {!loading && !error && isVideo && src && <video src={src} controls autoPlay style={{ maxWidth:'100%',maxHeight:'100%',borderRadius:8 }} />}
        {!loading && !error && isAudio && src && (
          <div style={{ textAlign:'center' }}>
            <div style={{ color:'#fff',fontSize:16,fontWeight:600,marginBottom:20 }}>{file.filename}</div>
            <audio src={src} controls style={{ width:360 }} />
          </div>
        )}
        {!loading && !error && isPdf && src && <iframe src={src} style={{ width:'100%',height:'100%',border:'none',borderRadius:8 }} title={file.filename} />}
        {!loading && !error && isText && text !== null && <pre style={{ background:'rgba(255,255,255,.05)',color:'#e5e7eb',padding:24,borderRadius:8,margin:0,overflow:'auto',maxWidth:'100%',maxHeight:'100%',fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word',flex:1,width:'100%' }}>{text || <span style={{ color:'rgba(255,255,255,.3)' }}>(empty file)</span>}</pre>}
        {!loading && !error && !isImage && !isVideo && !isAudio && !isPdf && !isText && (
          <div style={{ textAlign:'center',color:'#fff' }}>
            <div style={{ marginBottom:20,display:'flex',justifyContent:'center' }}>
              <svg width="64" height="64" viewBox="0 0 48 48" fill="none">
                <rect x="10" y="4" width="24" height="40" rx="4" fill="rgba(136,136,170,.1)" stroke="#8888AA" strokeWidth="1.5"/>
                <path d="M30 4l8 8H30V4z" fill="rgba(136,136,170,.2)" stroke="#8888AA" strokeWidth="1.5"/>
                <path d="M16 20h16M16 27h12M16 34h8" stroke="#8888AA" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize:16,fontWeight:600,marginBottom:8 }}>{file.filename}</div>
            <div style={{ color:'rgba(255,255,255,.5)',marginBottom:24 }}>Preview not available</div>
            <button onClick={dl} disabled={dlLoading} style={{ background:'#5B5EF4',color:'#fff',padding:'12px 24px',borderRadius:8,border:'none',fontWeight:600,cursor:'pointer' }}>
              {dlLoading ? '↓ Downloading…' : '↓ Download'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TeamVersionHistory({ teamId, file, teamKeyB64, onClose }) {
  const toast = useToastMethods()
  const [versions, setVersions] = useState([])
  const [loading, setLoading]   = useState(true)
  useEffect(() => {
    api.listTeamFileVersions(teamId, file.id)
      .then(d => setVersions(d.versions || []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [teamId, file.id])
  async function dlVersion(v) {
    try { await downloadFile(v.id, v.filename, teamKeyB64) }
    catch(e) { toast.error('Download failed: ' + e.message) }
  }
  return (
    <Modal title={`Version history — ${file.filename}`} onClose={onClose}>
      <div style={{ background:'rgba(0,194,124,.08)',borderRadius:8,padding:'10px 14px',marginBottom:12,border:'1px solid rgba(0,194,124,.2)' }}>
        <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:4 }}>
          <span style={{ background:'rgba(0,194,124,.25)',color:'#00C27C',fontWeight:700,fontSize:11,padding:'2px 8px',borderRadius:99 }}>
            v{file.version_number||1} &middot; current
          </span>
          <span style={{ fontSize:12,color:'#00C27C',fontWeight:600 }}>{file.filename}</span>
        </div>
        <div style={{ fontSize:11,color:'#55556A' }}>
          {fmtSize(file.size_bytes)}
          {file.uploaded_by_username && <span> &middot; <span style={{ color:'#5B5EF4',fontWeight:600 }}>@{file.uploaded_by_username}</span></span>}
          {file.uploaded_by_name && !file.uploaded_by_username && <span> &middot; {file.uploaded_by_name}</span>}
          {file.created_at && <span> &middot; {new Date(file.created_at).toLocaleDateString('en-IN',{ day:'numeric',month:'short',year:'numeric' })}</span>}
        </div>
      </div>
      {loading ? <div style={{ textAlign:'center',color:'#55556A',padding:20 }}>Loading&hellip;</div>
        : versions.length === 0 ? (
          <div style={{ color:'#55556A',fontSize:12,textAlign:'center',padding:'12px 0' }}>
            No older versions yet. Upload the same filename again to add a new version.
          </div>
        ) : (
          <>
            <div style={{ fontSize:11,fontWeight:700,color:'#55556A',textTransform:'uppercase',letterSpacing:.5,marginBottom:8 }}>Older versions</div>
            {[...versions].reverse().map(v => {
              const uploader = v.uploaded_by_username ? `@${v.uploaded_by_username}` : (v.uploaded_by_name||null)
              return (
                <div key={v.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 12px',marginBottom:4,background:'#161625',borderRadius:8,border:'1px solid #1E1E32' }}>
                  <span style={{ background:'rgba(91,94,244,.12)',color:'#5B5EF4',fontWeight:700,fontSize:11,padding:'2px 8px',borderRadius:99,flexShrink:0,whiteSpace:'nowrap' }}>
                    v{v.version_number}
                  </span>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#EEEEF8' }}>{v.filename}</div>
                    <div style={{ fontSize:11,color:'#55556A',marginTop:1 }}>
                      {fmtSize(v.size_bytes)}
                      {uploader && <span> &middot; <span style={{ color:'#5B5EF4' }}>{uploader}</span></span>}
                      {v.created_at && <span> &middot; {fmtDate(v.created_at)}</span>}
                    </div>
                  </div>
                  <button onClick={() => dlVersion(v)} style={{ ...btn('ghost',true),fontSize:11,flexShrink:0 }}>&darr; Download</button>
                </div>
              )
            })}
          </>
        )}
    </Modal>
  )
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000)    return 'just now'
  if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`
  if (diff < 604800000)return `${Math.floor(diff/86400000)}d ago`
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year: d.getFullYear()!==now.getFullYear()?'numeric':undefined })
}


const AVATAR_GRADIENTS = [
  ['#818cf8','#6366f1'], ['#34d399','#059669'], ['#f472b6','#db2777'],
  ['#fb923c','#ea580c'], ['#60a5fa','#2563eb'], ['#a78bfa','#7c3aed'],
  ['#fbbf24','#d97706'], ['#4ade80','#16a34a'],
]
function avatarGrad(name) {
  const code = (name||'?').charCodeAt(0) % AVATAR_GRADIENTS.length
  return AVATAR_GRADIENTS[code]
}

const ROLE_DESCS = {
  read:   'View and download files',
  upload: 'Upload + view + download',
  full:   'Upload, delete, manage folders',
  admin:  'Full access + manage members',
}

function ManagePanel({ teamId, data, currentUserId, myRole, onClose, onRefresh, onLeave, onDissolve }) {
  const toast = useToastMethods()
  const { team, members = [], pendingInvites = [], isOwner } = data
  const [showInvite,     setShowInvite]     = useState(false)
  const [inviteEmail,    setInviteEmail]    = useState('')
  const [inviteRole,     setInviteRole]     = useState('upload')
  const [inviting,       setInviting]       = useState(false)
  const [expandedMember, setExpandedMember] = useState(null)
  const [confirmRemove,  setConfirmRemove]  = useState(null)
  const [dangerAction,   setDangerAction]   = useState(null)
  const canAdmin = ['admin', 'owner'].includes(myRole)

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    try {
      await api.inviteMember(teamId, { emailOrUsername: inviteEmail.trim(), role: inviteRole })
      toast.success(`Invite sent to ${inviteEmail}`)
      setInviteEmail(''); setShowInvite(false); onRefresh()
    } catch(e) { toast.error(e.message) }
    setInviting(false)
  }

  async function handleChangeRole(memberId, role) {
    try { await api.changeMemberRole(teamId, memberId, { role }); toast.success('Role updated'); setExpandedMember(null); onRefresh() }
    catch(e) { toast.error(e.message) }
  }

  async function handleRemoveMember(memberId) {
    try { await api.removeMember(teamId, memberId); toast.success('Removed'); setConfirmRemove(null); setExpandedMember(null); onRefresh() }
    catch(e) { toast.error(e.message) }
  }

  return (
    <div style={{ display:'flex',flexDirection:'column',background:'#0F0F1A',flex:1,minHeight:0 }}>
      <div style={{ padding:'20px 22px 16px',background:'#0F0F1A',borderBottom:'1px solid #1E1E32',flexShrink:0 }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start' }}>
          <div>
            <div style={{ fontWeight:700,fontSize:16,color:'#EEEEF8',marginBottom:5 }}>{team.name}</div>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <span style={{ fontSize:12,color:'#8888AA' }}>{members.length} member{members.length!==1?'s':''}</span>
              <span style={{ color:'#1E1E32' }}>|</span>
              <RoleBadge role={myRole} />
            </div>
          </div>
          <button onClick={onClose}
            style={{ background:'#161625',border:'1px solid #1E1E32',borderRadius:8,width:32,height:32,fontSize:18,cursor:'pointer',color:'#8888AA',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
            &times;
          </button>
        </div>
      </div>
      <div style={{ flex:1,overflowY:'auto',padding:'0 0 24px' }}>
        <div style={{ padding:'20px 22px 0' }}>
          <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
            <span style={{ fontSize:13,fontWeight:700,color:'#EEEEF8' }}>Members</span>
            {canAdmin && (
              <button onClick={() => { setShowInvite(v => !v); setInviteEmail('') }}
                style={{ fontSize:12,fontWeight:700,padding:'5px 12px',borderRadius:7,cursor:'pointer',
                          border: showInvite ? '1px solid #1E1E32' : 'none',
                          background:showInvite?'#161625':'#5B5EF4',color:showInvite?'#8888AA':'#fff' }}>
                {showInvite ? 'Cancel' : '+ Invite'}
              </button>
            )}
          </div>
          {showInvite && (
            <div style={{ background:'#11111E',borderRadius:12,border:'1px solid #1E1E32',padding:18,marginBottom:16 }}>
              <div style={{ fontSize:13,fontWeight:600,color:'#EEEEF8',marginBottom:12 }}>Invite someone</div>
              <input
                style={{ width:'100%',padding:'10px 13px',border:'1px solid #1E1E32',borderRadius:9,fontSize:13,outline:'none',boxSizing:'border-box',marginBottom:14,background:'#161625',color:'#EEEEF8' }}
                placeholder="Email or @username" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key==='Enter' && handleInvite()} autoFocus />
              <div style={{ fontSize:11,fontWeight:700,color:'#55556A',textTransform:'uppercase',letterSpacing:.5,marginBottom:8 }}>Access level</div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:14 }}>
                {[
                  { v:'read',   l:'Read only'   },
                  { v:'upload', l:'Can upload'  },
                  { v:'full',   l:'Full access' },
                  { v:'admin',  l:'Admin'       },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setInviteRole(v)}
                    style={{ padding:'9px 8px',fontSize:12,fontWeight:600,borderRadius:9,cursor:'pointer',textAlign:'center',
                              border: inviteRole===v ? '2px solid #5B5EF4' : '1px solid #1E1E32',
                              background: inviteRole===v ? 'rgba(91,94,244,.12)' : '#161625',
                              color: inviteRole===v ? '#5B5EF4' : '#8888AA' }}>
                    {l}
                    <div style={{ fontSize:10,fontWeight:400,color:inviteRole===v?'#8888AA':'#55556A',marginTop:2,lineHeight:1.3 }}>{ROLE_DESCS[v]}</div>
                  </button>
                ))}
              </div>
              <button onClick={handleInvite} disabled={inviting||!inviteEmail.trim()}
                style={{ ...btn('primary'),width:'100%',opacity:(!inviteEmail.trim()||inviting)?.65:1,borderRadius:9 }}>
                {inviting ? 'Sending invite…' : 'Send invite'}
              </button>
            </div>
          )}
          <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
            {members.map(m => {
              const mRole      = m.user_id === team.owner_id ? 'owner' : m.role
              const isSelf     = m.user_id === currentUserId
              const canExpand  = isOwner && m.user_id !== team.owner_id
              const isExpanded = expandedMember === m.id
              const [g1, g2]   = avatarGrad(m.display_name || m.email)
              return (
                <div key={m.id}
                  style={{ background:'#11111E',borderRadius:12,border:`1px solid ${isExpanded?'#5B5EF4':'#1E1E32'}`,
                             overflow:'hidden',boxShadow: isExpanded?'0 0 0 3px rgba(91,94,244,.1)':'none',transition:'box-shadow .15s,border-color .15s' }}>
                  <div onClick={() => canExpand && setExpandedMember(isExpanded ? null : m.id)}
                    style={{ display:'flex',alignItems:'center',gap:13,padding:'13px 15px',cursor:canExpand?'pointer':'default' }}>
                    <div style={{ width:40,height:40,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:'#fff',background:`linear-gradient(135deg, ${g1}, ${g2})` }}>
                      {(m.display_name||m.email||'?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#EEEEF8' }}>
                        {m.display_name||m.email}
                        {isSelf && <span style={{ fontSize:10,background:'#161625',color:'#55556A',borderRadius:4,padding:'1px 5px',marginLeft:6,fontWeight:500 }}>you</span>}
                      </div>
                      <div style={{ fontSize:11,color:'#55556A',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
                        {m.username ? `@${m.username}` : m.email}
                      </div>
                    </div>
                    <div style={{ display:'flex',alignItems:'center',gap:6,flexShrink:0 }}>
                      <RoleBadge role={mRole} />
                      {canExpand && (
                        <span style={{ fontSize:14,color:'#55556A',display:'inline-block',transform:isExpanded?'rotate(90deg)':'rotate(0deg)',transition:'transform .2s',lineHeight:1 }}>&#8250;</span>
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ padding:'14px 15px 16px',borderTop:'1px solid #1E1E32',background:'#161625' }}>
                      <div style={{ fontSize:11,fontWeight:700,color:'#55556A',textTransform:'uppercase',letterSpacing:.5,marginBottom:10 }}>Change role</div>
                      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:14 }}>
                        {['read','upload','full','admin'].map(r => (
                          <button key={r} onClick={() => handleChangeRole(m.id, r)}
                            style={{ padding:'9px 8px',fontSize:12,fontWeight:600,borderRadius:9,cursor:'pointer',textAlign:'center',
                                      border: m.role===r ? '2px solid #5B5EF4' : '1px solid #1E1E32',
                                      background: m.role===r ? 'rgba(91,94,244,.12)' : '#11111E',
                                      color: m.role===r ? '#5B5EF4' : '#8888AA' }}>
                            {ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                      {confirmRemove?.id === m.id ? (
                        <div style={{ background:'rgba(226,75,74,.08)',borderRadius:9,padding:'12px 13px',border:'1px solid rgba(226,75,74,.2)' }}>
                          <div style={{ fontSize:12,color:'#EEEEF8',marginBottom:10,lineHeight:1.5 }}>
                            Remove <strong>{confirmRemove.name}</strong> from this workspace?
                          </div>
                          <div style={{ display:'flex',gap:6 }}>
                            <button onClick={() => setConfirmRemove(null)} style={btn('ghost',true)}>Cancel</button>
                            <button onClick={() => handleRemoveMember(m.id)} style={btn('danger',true)}>Remove</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmRemove({ id:m.id, name:m.display_name||m.email })}
                          style={{ width:'100%',padding:'9px',fontSize:12,fontWeight:600,borderRadius:9,cursor:'pointer',background:'rgba(226,75,74,.08)',border:'1px solid rgba(226,75,74,.2)',color:'#E24B4A' }}>
                          Remove from workspace
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {pendingInvites.length > 0 && (
          <div style={{ padding:'20px 22px 0' }}>
            <div style={{ fontSize:13,fontWeight:700,color:'#EEEEF8',marginBottom:12 }}>Pending invites</div>
            <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
              {pendingInvites.map(inv => (
                <div key={inv.id} style={{ background:'#11111E',borderRadius:10,border:'1px solid #1E1E32',padding:'11px 14px',display:'flex',alignItems:'center',gap:11 }}>
                  <div style={{ width:34,height:34,borderRadius:'50%',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="3.5" width="14" height="9" rx="1.5" stroke="#F59E0B" strokeWidth="1.2"/>
                      <path d="M1.5 4.5l6.5 5 6.5-5" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'#EEEEF8' }}>{inv.invited_email}</div>
                    <div style={{ fontSize:11,color:'#55556A',marginTop:2 }}>
                      Expires {new Date(inv.expires_at).toLocaleDateString('en-IN',{ month:'short',day:'numeric' })}
                    </div>
                  </div>
                  <span style={{ fontSize:11,background:'rgba(245,158,11,.1)',color:'#F59E0B',border:'1px solid rgba(245,158,11,.25)',padding:'2px 8px',borderRadius:99,fontWeight:600,flexShrink:0 }}>Pending</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding:'24px 22px 0' }}>
          <div style={{ borderTop:'1px solid #1E1E32',paddingTop:20 }}>
            {!dangerAction ? (
              isOwner ? (
                <button onClick={() => setDangerAction('dissolve')}
                  style={{ width:'100%',padding:'11px',fontSize:13,fontWeight:600,borderRadius:9,cursor:'pointer',background:'none',border:'1px solid rgba(226,75,74,.25)',color:'#E24B4A' }}>
                  Dissolve workspace
                </button>
              ) : (
                <button onClick={() => setDangerAction('leave')}
                  style={{ width:'100%',padding:'11px',fontSize:13,fontWeight:600,borderRadius:9,cursor:'pointer',background:'none',border:'1px solid #1E1E32',color:'#8888AA' }}>
                  Leave workspace
                </button>
              )
            ) : dangerAction === 'dissolve' ? (
              <div style={{ background:'rgba(226,75,74,.08)',borderRadius:12,padding:18,border:'1px solid rgba(226,75,74,.2)' }}>
                <div style={{ fontWeight:700,fontSize:14,color:'#E24B4A',marginBottom:6 }}>Dissolve workspace?</div>
                <div style={{ fontSize:13,color:'#8888AA',marginBottom:16,lineHeight:1.6 }}>
                  All {members.length} member{members.length!==1?'s':''} immediately lose access.
                  Files are not deleted but become inaccessible. <strong style={{ color:'#EEEEF8' }}>Cannot be undone.</strong>
                </div>
                <div style={{ display:'flex',gap:8 }}>
                  <button onClick={() => setDangerAction(null)} style={btn('ghost',true)}>Cancel</button>
                  <button onClick={onDissolve} style={btn('danger',true)}>Yes, dissolve</button>
                </div>
              </div>
            ) : (
              <div style={{ background:'rgba(226,75,74,.08)',borderRadius:12,padding:18,border:'1px solid rgba(226,75,74,.2)' }}>
                <div style={{ fontWeight:700,fontSize:14,color:'#EEEEF8',marginBottom:6 }}>Leave workspace?</div>
                <div style={{ fontSize:13,color:'#8888AA',marginBottom:16,lineHeight:1.6 }}>
                  You'll be removed immediately. The owner can re-invite you later.
                </div>
                <div style={{ display:'flex',gap:8 }}>
                  <button onClick={() => setDangerAction(null)} style={btn('ghost',true)}>Cancel</button>
                  <button onClick={onLeave} style={btn('danger',true)}>Leave</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function TeamWorkspace({ teamId, teamName, teamKeyB64, canUploadFiles, canManageFiles,
                          data, currentUserId, myRole, onBack, onRefreshData, onLeave, onDissolve }) {
  const toast        = useToastMethods()
  const { isMobile } = useBreakpoint()
  const fileInputRef          = useRef(null)
  const conflictResolverRef   = useRef(null)
  const syncTimerRef          = useRef(null)
  const [files,      setFiles]      = useState([])
  const [folders,    setFolders]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [folderId,   setFolderId]   = useState(null)
  const [folderPath, setFolderPath] = useState([])
  const [showNewFolder,  setShowNewFolder]  = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [uploading, setUploading] = useState([])
  const [conflict,  setConflict]  = useState(null)
  const [preview,            setPreview]           = useState(null)
  const [versionsFile,       setVersionsFile]       = useState(null)
  const [showManage,         setShowManage]         = useState(false)
  const [selectedFiles,      setSelectedFiles]      = useState(new Set())
  const [selectedFolders,    setSelectedFolders]    = useState(new Set())
  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(false)
  const [deleting,           setDeleting]           = useState(false)
  const [confirmFolderDelete,setConfirmFolderDelete]= useState(null)
  const [decryptedThumbs, setDecryptedThumbs] = useState({})
  const totalSelected = selectedFiles.size + selectedFolders.size

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const d = await api.listTeamFiles(teamId, folderId ? { folderId } : {})
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
    } catch(e) { toast.error(e.message) }
    if (!silent) setLoading(false)
  }, [teamId, folderId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!teamKeyB64) return
    const todo = files.filter(f => f.thumb_data?.startsWith('enc_thumb:') && !decryptedThumbs[f.id])
    if (!todo.length) return
    let cancelled = false
    async function go() {
      const results = {}
      for (const f of todo) {
        if (cancelled) break
        try {
          const encB64 = f.thumb_data.slice('enc_thumb:'.length)
          const encBuf = Uint8Array.from(atob(encB64), c => c.charCodeAt(0)).buffer
          const rawBuf = await decryptFromVault(teamKeyB64, encBuf)
          const blob   = new Blob([rawBuf], { type:'image/webp' })
          results[f.id] = await new Promise(res => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(blob) })
        } catch(_) {}
      }
      if (!cancelled && Object.keys(results).length) setDecryptedThumbs(prev => ({ ...prev, ...results }))
    }
    go()
    return () => { cancelled = true }
  }, [files, teamKeyB64])

  function toggleFileSelect(id) { setSelectedFiles(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n }) }
  function toggleFolderSelect(id) { setSelectedFolders(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n }) }
  function clearSelection() { setSelectedFiles(new Set()); setSelectedFolders(new Set()) }
  async function bulkDownloadFiles() {
    if (!teamKeyB64) { toast.error('Unlock the workspace first'); return }
    const toDownload = files.filter(f => selectedFiles.has(f.id))
    if (!toDownload.length) return
    const dekBytes = Uint8Array.from(atob(teamKeyB64), c => c.charCodeAt(0))
    try { await downloadZip(toDownload, dekBytes) }
    catch(e) { toast.error(e.message || 'Download failed') }
  }
  function showConflict(name) { return new Promise(resolve => { conflictResolverRef.current = resolve; setConflict({ name }) }) }
  function resolveConflict(decision) {
    setConflict(null)
    if (conflictResolverRef.current) { conflictResolverRef.current(decision); conflictResolverRef.current = null }
  }
  function openFolder(folder) {
    if (totalSelected > 0) { toggleFolderSelect(folder.id); return }
    setFolderPath(prev => [...prev, { id:folder.id, name:folder.name }])
    setFolderId(folder.id); clearSelection()
  }
  function navTo(idx) {
    if (idx < 0) { setFolderPath([]); setFolderId(null) }
    else { const slice=folderPath.slice(0,idx+1); setFolderPath(slice); setFolderId(slice[slice.length-1].id) }
    clearSelection()
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || creatingFolder) return
    setCreatingFolder(true)
    try {
      const res = await api.createTeamFolder(teamId, { name:newFolderName.trim(), parentId:folderId })
      setFolders(prev => [...prev, { id:res.folderId, name:newFolderName.trim(), parent_id:folderId, created_at:Date.now() }])
      setNewFolderName(''); setShowNewFolder(false)
    } catch(e) { toast.error(e.message) }
    setCreatingFolder(false)
  }

  async function handleBulkDelete() {
    setDeleting(true)
    try {
      await Promise.all([...[...selectedFiles].map(id => api.deleteTeamFile(teamId, id)),
                         ...[...selectedFolders].map(id => api.deleteTeamFolder(teamId, id))])
      setFiles(prev => prev.filter(f => !selectedFiles.has(f.id)))
      setFolders(prev => prev.filter(f => !selectedFolders.has(f.id)))
      toast.success(`Deleted ${totalSelected} item${totalSelected!==1?'s':''}`)
      clearSelection(); setShowDeleteConfirm(false)
    } catch(e) { toast.error(e.message) }
    setDeleting(false)
  }

  async function handleFolderDelete(folder) {
    try { await api.deleteTeamFolder(teamId, folder.id); setFolders(prev => prev.filter(f => f.id !== folder.id)); setConfirmFolderDelete(null) }
    catch(e) { toast.error(e.message) }
  }

  async function handleDeleteFile(file) {
    try {
      await api.deleteTeamFile(teamId, file.id)
      setFiles(prev => prev.filter(f => f.id !== file.id))
      toast.success(`"${file.filename}" deleted`)
    } catch(e) { toast.error(e.message) }
  }

  async function handleFileSelect(e) {
    const selected = Array.from(e.target.files)
    if (!selected.length) return
    e.target.value = ''
    const newItems = selected.map(f => ({ id:Math.random(), name:f.name, progress:0, done:false, error:null, file:f }))
    setUploading(prev => [...prev, ...newItems])
    for (const item of newItems) {
      try {
        const existing = files.find(f => f.filename===item.name && !f._optimistic)
        let decision = 'new'
        if (existing) decision = await showConflict(item.name)
        if (decision === 'cancel') { setUploading(prev => prev.filter(u => u.id!==item.id)); continue }
        let fileToUpload   = item.file
        let targetExisting = existing
        if (decision === 'replace' && existing) {
          await api.deleteTeamFile(teamId, existing.id)
          setFiles(prev => prev.filter(f => f.id!==existing.id))
          targetExisting = null
        }
        if (decision === 'keep') {
          const dotIdx = item.name.lastIndexOf('.')
          const base   = dotIdx>=0 ? item.name.slice(0,dotIdx) : item.name
          const ext    = dotIdx>=0 ? item.name.slice(dotIdx) : ''
          let n = 2
          while (files.some(f => f.filename===`${base} (${n})${ext}`)) n++
          fileToUpload = new File([item.file],`${base} (${n})${ext}`,{ type:item.file.type })
          setUploading(prev => prev.map(u => u.id===item.id ? { ...u, name:fileToUpload.name } : u))
          targetExisting = null
        }
        const isVersion = decision === 'version'
        const skipDedup = isVersion || decision==='keep' || decision==='replace'
        let thumbData = null
        try {
          let rawThumb = null
          if (fileToUpload.type.startsWith('image/'))      rawThumb = await generateThumb(fileToUpload)
          else if (fileToUpload.type.startsWith('video/')) rawThumb = await generateVideoThumb(fileToUpload)
          if (rawThumb && teamKeyB64) {
            const b64 = rawThumb.split(',')[1]
            const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
            const enc = await encryptForVault(teamKeyB64, raw.buffer)
            thumbData = 'enc_thumb:' + btoa(String.fromCharCode(...new Uint8Array(enc)))
          }
        } catch(_) {}
        const rawBuf  = await fileToUpload.arrayBuffer()
        const encBuf  = await encryptForVault(teamKeyB64, rawBuf)
        const encMime = `encrypted:${fileToUpload.type||'application/octet-stream'}`
        const encFile = new File([encBuf], fileToUpload.name, { type:encMime })
        const result = await uploadFile(encFile, {
          mimeType:encMime, folderId, isVault:false, isEncrypted:true, teamId, skipDedup, thumbData,
        }, pct => setUploading(prev => prev.map(u => u.id===item.id ? { ...u, progress:pct } : u)))
        if (isVersion && targetExisting) {
          let promoted = false
          for (let i=0; i<10&&!promoted; i++) {
            try { await api.promoteTeamFileVersion(teamId, targetExisting.id, { promoteFrom:result.fileId }); promoted=true }
            catch(e) { if (i<9&&e.message?.includes('Source file not found')) await new Promise(r=>setTimeout(r,600)); else throw e }
          }
          toast.success(`New version of "${item.name}" saved`)
          setFiles(prev => prev.map(f => f.id===targetExisting.id ? { ...f, version_number:(f.version_number||1)+1 } : f))
        } else {
          setFiles(prev => [...prev, { id:result.fileId, filename:fileToUpload.name, mime_type:encMime, size_bytes:encFile.size, created_at:Date.now(), version_number:1, _optimistic:true }])
          toast.success(`"${fileToUpload.name}" uploaded`)
        }
        setUploading(prev => prev.map(u => u.id===item.id ? { ...u, done:true, progress:100 } : u))
      } catch(err) {
        setUploading(prev => prev.map(u => u.id===item.id ? { ...u, error:err.message } : u))
        toast.error(`Failed: ${item.name}`)
      }
    }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => load(true), 6000)
    setTimeout(() => setUploading(prev => prev.filter(u => !u.done && !u.error)), 3000)
  }

  return (
    <div>
      <div style={{ padding:'10px 40px',margin:'-24px -24px 0 -24px',borderBottom:'1px solid #1E1E32',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',background:'#07070D',position:'sticky',top:-24,zIndex:10 }}>
        <button onClick={onBack} style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#8888AA',padding:'0 4px' }}>&larr;</button>
        <span onClick={() => navTo(-1)} style={{ fontSize:15,fontWeight:700,cursor:'pointer',color:folderId?'#5B5EF4':'#EEEEF8' }}>{teamName}</span>
        {folderPath.map((seg, i) => (
          <React.Fragment key={seg.id}>
            <span style={{ color:'#1E1E32' }}>/</span>
            <span onClick={() => navTo(i)} style={{ fontSize:14,fontWeight:600,cursor:i<folderPath.length-1?'pointer':'default',color:i<folderPath.length-1?'#5B5EF4':'#EEEEF8' }}>{seg.name}</span>
          </React.Fragment>
        ))}
        <div style={{ marginLeft:'auto',display:'flex',gap:6,alignItems:'center' }}>
          {canManageFiles && <button onClick={() => setShowNewFolder(true)} style={btn('ghost',true)}>+ Folder</button>}
          {canUploadFiles && (
            <button onClick={() => fileInputRef.current?.click()} style={btn('primary',true)}>
              {uploading.some(u => !u.done&&!u.error) ? 'Uploading…' : '+ Upload'}
            </button>
          )}
          <input ref={fileInputRef} type="file" multiple style={{ display:'none' }} onChange={handleFileSelect} />
          <button onClick={() => setShowManage(v => !v)}
            style={{ ...btn('ghost',true), background:showManage?'rgba(91,94,244,.12)':'#161625', color:showManage?'#5B5EF4':'#8888AA' }}>
            &#9881; Manage
          </button>
        </div>
      </div>
      <div style={{ display:'flex',alignItems:'flex-start' }}>
        <div style={{ flex:1,padding:'16px 18px',minWidth:0 }}>
          <div style={{ background:'rgba(0,194,124,.08)',border:'1px solid rgba(0,194,124,.2)',borderRadius:8,padding:'7px 12px',marginBottom:14,fontSize:12,color:'#00C27C',display:'flex',alignItems:'center',gap:6 }}>
            Zero-knowledge &middot; End-to-end encrypted &middot; decrypted locally
          </div>
          {uploading.filter(u => !u.done&&!u.error).map(u => (
            <div key={u.id} style={{ background:'#161625',border:'1px solid #1E1E32',borderRadius:8,padding:'8px 12px',marginBottom:8,display:'flex',alignItems:'center',gap:10 }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13,fontWeight:600,marginBottom:4,color:'#EEEEF8' }}>{u.name}</div>
                <div style={{ height:4,background:'#1E1E32',borderRadius:2 }}>
                  <div style={{ width:`${u.progress}%`,height:'100%',background:'#5B5EF4',borderRadius:2,transition:'width .2s' }} />
                </div>
              </div>
              <span style={{ fontSize:12,color:'#8888AA',flexShrink:0 }}>{u.progress}%</span>
            </div>
          ))}
          <FileGrid
            files={files.map(f => ({
              ...f,
              mime_type: f.mime_type?.replace('encrypted:', '') || '',
              thumb_data: decryptedThumbs[f.id] || null,
            }))}
            folders={folders}
            view="teams"
            loading={loading}
            onOpenFolder={openFolder}
            onPreview={setPreview}
            onVersions={setVersionsFile}
            onDelete={canManageFiles ? handleDeleteFile : null}
            onDeleteFolder={canManageFiles ? f => setConfirmFolderDelete(f) : null}
            onToggleFile={toggleFileSelect}
            onToggleFolder={toggleFolderSelect}
            selectedFileIds={selectedFiles}
            selectedFolderIds={selectedFolders}
          />
        </div>
        {showManage && data && !isMobile && (
          <div style={{ width:380,flexShrink:0,borderLeft:'1px solid #1E1E32',alignSelf:'stretch',
                         display:'flex',flexDirection:'column',overflow:'hidden' }}>
            <ManagePanel teamId={teamId} data={data} currentUserId={currentUserId} myRole={myRole}
              onClose={() => setShowManage(false)} onRefresh={onRefreshData} onLeave={onLeave} onDissolve={onDissolve} />
          </div>
        )}
      </div>
      {showManage && data && isMobile && (
        <div style={{ position:'fixed',inset:0,background:'rgba(7,7,13,.8)',zIndex:150 }}
          onClick={e => e.target===e.currentTarget && setShowManage(false)}>
          <div style={{ position:'absolute',right:0,top:0,bottom:0,width:'min(360px,92vw)',background:'#0F0F1A',overflowY:'auto' }}>
            <ManagePanel teamId={teamId} data={data} currentUserId={currentUserId} myRole={myRole}
              onClose={() => setShowManage(false)} onRefresh={onRefreshData} onLeave={onLeave} onDissolve={onDissolve} />
          </div>
        </div>
      )}
      {totalSelected > 0 && (
        <div style={{ position:'fixed',bottom:28,left:'50%',transform:'translateX(-50%)',background:'#11111E',color:'#EEEEF8',borderRadius:14,padding:'12px 20px',display:'flex',alignItems:'center',gap:14,border:'1px solid #1E1E32',boxShadow:'0 8px 28px rgba(0,0,0,.5)',zIndex:120,whiteSpace:'nowrap' }}>
          <span style={{ fontSize:13,fontWeight:600 }}>{totalSelected} item{totalSelected!==1?'s':''} selected</span>
          <button onClick={clearSelection} style={{ background:'rgba(136,136,170,.15)',color:'#8888AA',border:'1px solid #1E1E32',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:500 }}>Cancel</button>
          {selectedFiles.size > 0 && (
            <button onClick={bulkDownloadFiles} style={{ background:'rgba(91,94,244,.15)',color:'#a5b4fc',border:'1px solid rgba(91,94,244,.3)',borderRadius:7,padding:'6px 12px',fontSize:12,cursor:'pointer',fontWeight:500 }}>
              ↓ Download
            </button>
          )}
          {canManageFiles && (
            <button onClick={() => setShowDeleteConfirm(true)} style={{ background:'#E24B4A',color:'#fff',border:'none',borderRadius:7,padding:'6px 16px',fontSize:12,cursor:'pointer',fontWeight:700 }}>
              &#128465; Delete {totalSelected}
            </button>
          )}
        </div>
      )}
      {showNewFolder && (
        <Modal title="New Folder" onClose={() => setShowNewFolder(false)}
          footer={<>
            <button onClick={() => setShowNewFolder(false)} style={btn('ghost',true)}>Cancel</button>
            <button onClick={handleCreateFolder} disabled={creatingFolder} style={btn('primary',true)}>{creatingFolder ? 'Creating…' : 'Create'}</button>
          </>}>
          <input style={{ width:'100%',padding:'10px 12px',border:'1px solid #1E1E32',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'#161625',color:'#EEEEF8' }}
            placeholder="Folder name" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => e.key==='Enter' && handleCreateFolder()} autoFocus />
        </Modal>
      )}
      {showDeleteConfirm && (
        <Modal title="Delete items" onClose={() => setShowDeleteConfirm(false)}
          footer={<>
            <button onClick={() => setShowDeleteConfirm(false)} style={btn('ghost',true)}>Cancel</button>
            <button onClick={handleBulkDelete} disabled={deleting} style={btn('danger',true)}>{deleting ? 'Deleting…' : `Delete ${totalSelected} item${totalSelected!==1?'s':''}`}</button>
          </>}>
          <div style={{ fontSize:13,color:'#EEEEF8',lineHeight:1.7 }}>
            <p style={{ marginBottom:8 }}>You're about to permanently delete:</p>
            {selectedFiles.size > 0 && <p style={{ margin:'0 0 4px',fontWeight:600 }}>&bull; {selectedFiles.size} file{selectedFiles.size!==1?'s':''}</p>}
            {selectedFolders.size > 0 && <p style={{ margin:'0 0 4px',fontWeight:600 }}>&bull; {selectedFolders.size} folder{selectedFolders.size!==1?'s':''} (and all files inside)</p>}
            <p style={{ marginTop:10,color:'#55556A',fontSize:12 }}>This action cannot be undone.</p>
          </div>
        </Modal>
      )}
      {confirmFolderDelete && (
        <Modal title="Delete folder" onClose={() => setConfirmFolderDelete(null)}
          footer={<>
            <button onClick={() => setConfirmFolderDelete(null)} style={btn('ghost',true)}>Cancel</button>
            <button onClick={() => handleFolderDelete(confirmFolderDelete)} style={btn('danger',true)}>Delete</button>
          </>}>
          <div style={{ fontSize:13,color:'#EEEEF8',lineHeight:1.7 }}>
            <p>Delete folder <strong>"{confirmFolderDelete.name}"</strong>?</p>
            <p style={{ color:'#55556A',fontSize:12,marginTop:8 }}>Files inside this folder will also be deleted. This cannot be undone.</p>
          </div>
        </Modal>
      )}
      {conflict && <ConflictModal filename={conflict.name} onResolve={resolveConflict} onClose={() => resolveConflict('cancel')} />}
      {preview && <TeamPreviewModal file={preview} teamKeyB64={teamKeyB64} onClose={() => setPreview(null)} />}
      {versionsFile && <TeamVersionHistory teamId={teamId} file={versionsFile} teamKeyB64={teamKeyB64} onClose={() => setVersionsFile(null)} />}
    </div>
  )
}

function TeamView({ teamId, currentUserId, onBack, onRefreshList }) {
  const toast = useToastMethods()
  const [data,        setData]       = useState(null)
  const [loading,     setLoading]    = useState(true)
  const [teamKeyB64,  setTeamKeyB64] = useState(null)
  const [unlocking,   setUnlocking]  = useState(false)
  const [unlockError, setUnlockErr]  = useState('')
  const [showPassphrase, setShowPass]= useState(false)

  const load = useCallback(async () => {
    try { const d = await api.getTeam(teamId); setData(d) }
    catch(e) { toast.error(e.message) }
    setLoading(false)
  }, [teamId])

  useEffect(() => { load() }, [load])
  useEffect(() => { const stored = sessionStorage.getItem(`team_key_${teamId}`); if (stored) setTeamKeyB64(stored) }, [teamId])

  useEffect(() => {
    if (!data || teamKeyB64 || data.team.key_salt !== 'ecdh') return
    const privateKey = sessionStorage.getItem('dd_vault_private_key_pkcs8')
    if (!privateKey) return
    setUnlocking(true); setUnlockErr('')
    api.getTeamKey(teamId, currentUserId)
      .then(async kd => {
        const dekBytes = await unwrapDEKWithPrivateKey(kd.encrypted_team_key, kd.key_nonce, kd.ephemeral_public_key, privateKey)
        const dekB64   = btoa(String.fromCharCode(...dekBytes))
        sessionStorage.setItem(`team_key_${teamId}`, dekB64)
        setTeamKeyB64(dekB64)
      })
      .catch(e => setUnlockErr(
        e.status === 404
          ? 'No key distributed to your account yet. Ask the team owner to open the workspace once — this automatically distributes keys to all members.'
          : 'Failed to unlock: ' + (e.message || 'Unknown error')
      ))
      .finally(() => setUnlocking(false))
  }, [data, teamKeyB64, teamId, currentUserId])

  useEffect(() => {
    if (!data || !teamKeyB64 || data.team.key_salt !== 'ecdh') return
    const isAdmin = data.isOwner || data.members?.some(m => m.user_id===currentUserId && m.role==='admin')
    if (!isAdmin) return
    async function distribute() {
      try {
        const keyList  = await api.listTeamKeys(teamId)
        const hasKey   = new Set(keyList.keys.map(k => k.user_id))
        const needsKey = (data.members||[]).filter(m => !hasKey.has(m.user_id))
        if (!needsKey.length) return
        const dekBytes = Uint8Array.from(atob(teamKeyB64), c => c.charCodeAt(0))
        for (const m of needsKey) {
          try {
            const pub = await api.getPublicKey(m.user_id)
            const { encryptedDek, dekNonce, ephemeralPublicKey } = await wrapDEKWithPublicKey(dekBytes, pub.publicKey)
            await api.storeTeamKey(teamId, { encryptedTeamKey:encryptedDek, ephemeralPublicKey, keyNonce:dekNonce, targetUserId:m.user_id })
          } catch(_) {}
        }
      } catch(_) {}
    }
    distribute()
  }, [data?.members?.length, teamKeyB64, teamId, currentUserId, data?.isOwner])

  async function handleUnlockPassphrase(passphrase) {
    const key = await deriveTeamKey(passphrase, data.team.key_salt)
    sessionStorage.setItem(`team_key_${teamId}`, key)
    setTeamKeyB64(key); setShowPass(false)
  }
  async function handleLeave() {
    try { await api.leaveTeam(teamId); toast.success('You left the workspace'); onBack(); onRefreshList() }
    catch(e) { toast.error(e.message) }
  }
  async function handleDissolve() {
    try { await api.dissolveTeam(teamId); toast.success('Workspace dissolved'); onBack(); onRefreshList() }
    catch(e) { toast.error(e.message) }
  }

  if (loading || unlocking) {
    return (
      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',padding:80,flexDirection:'column',gap:12 }}>
        <div style={{ width:32,height:32,border:'3px solid #1E1E32',borderTopColor:'#5B5EF4',borderRadius:'50%',animation:'spin .7s linear infinite' }}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
        <div style={{ color:'#55556A',fontSize:13 }}>{unlocking ? 'Unlocking workspace…' : 'Loading…'}</div>
      </div>
    )
  }
  if (!data) return null

  const myMembership   = data.members?.find(m => m.user_id===currentUserId)
  const myRole         = data.isOwner ? 'owner' : (myMembership?.role||'read')
  const canUploadFiles = ['upload','full','admin','owner'].includes(myRole)
  const canManageFiles = ['full','admin','owner'].includes(myRole)

  if (!teamKeyB64) {
    const isEcdh     = data.team.key_salt === 'ecdh'
    const hasVaultKey= !!sessionStorage.getItem('dd_vault_private_key_pkcs8')
    return (
      <div style={{ maxWidth:480,width:'100%',margin:'0 auto',paddingTop:40 }}>
        <button onClick={onBack} style={{ background:'none',border:'none',cursor:'pointer',fontSize:14,color:'#8888AA',marginBottom:24,display:'flex',alignItems:'center',gap:6 }}>
          &larr; Back to workspaces
        </button>
        <div style={{ ...card,textAlign:'center' }}>
          <div style={{ marginBottom:16,display:'flex',justifyContent:'center' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="8" y="22" width="32" height="22" rx="5" fill="rgba(91,94,244,.12)" stroke="#5B5EF4" strokeWidth="1.5"/>
              <path d="M16 22V16a8 8 0 0 1 16 0v6" stroke="#5B5EF4" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="24" cy="33" r="3" fill="#5B5EF4"/>
            </svg>
          </div>
          <div style={{ fontWeight:700,fontSize:18,marginBottom:8,color:'#EEEEF8' }}>{data.team.name}</div>
          <div style={{ marginBottom:16 }}><RoleBadge role={myRole} /></div>
          <div style={{ fontSize:13,color:'#8888AA',marginBottom:20,lineHeight:1.6 }}>
            {isEcdh
              ? hasVaultKey
                ? (unlockError||'Your Vault key is available but the workspace key could not be retrieved.')
                : 'This workspace uses your Vault key. Please unlock your Vault (Settings → Vault) first, then return here.'
              : 'Enter the team passphrase to access files.'}
          </div>
          {!isEcdh && <button onClick={() => setShowPass(true)} style={btn('primary')}>Enter Passphrase</button>}
          {isEcdh && unlockError && (
            <p style={{ fontSize:12,color:'#55556A',marginTop:4,lineHeight:1.5 }}>
              New members need the owner to open the workspace first to receive their encrypted key automatically.
            </p>
          )}
        </div>
        {showPassphrase && <PassphraseModal teamName={data.team.name} onUnlock={handleUnlockPassphrase} onClose={() => setShowPass(false)} />}
      </div>
    )
  }

  return (
    <TeamWorkspace teamId={teamId} teamName={data.team.name} teamKeyB64={teamKeyB64}
      canUploadFiles={canUploadFiles} canManageFiles={canManageFiles}
      data={data} currentUserId={currentUserId} myRole={myRole}
      onBack={onBack} onRefreshData={load} onLeave={handleLeave} onDissolve={handleDissolve} />
  )
}

export default function TeamsView({ currentUserId, onGoToVault }) {
  const toast        = useToastMethods()
  const { isMobile } = useBreakpoint()
  const [teams,      setTeams]     = useState([])
  const [invites,    setInvites]   = useState([])
  const [loading,    setLoading]   = useState(true)
  const [activeTeam, setActiveTeam]= useState(null)
  const [showCreate, setShowCreate]= useState(false)
  const [newName,    setNewName]   = useState('')
  const [creating,   setCreating]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [td, id] = await Promise.all([api.listTeams(), api.listInvites()])
      setTeams(td.teams||[]); setInvites(id.invites||[])
    } catch(e) { toast.error(e.message) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token  = params.get('token')
    if (token) {
      api.acceptInvite(token)
        .then(res => { toast.success(`Joined "${res.teamName}"`); window.history.replaceState({},'',window.location.pathname); load() })
        .catch(e => toast.error(e.message))
    }
  }, [])

  async function handleCreateTeam() {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const me = await api.me()
      if (!me?.user?.public_key) {
        setShowCreate(false)
        setCreating(false)
        const vs = await api.vaultStatus().catch(() => ({}))
        if (vs?.configured) {
          toast.error('Vault V1 detected — click "Upgrade to V2" in the Vault page to enable workspace creation.')
        } else {
          toast.error('Set up your Vault first to create an encrypted workspace.')
        }
        onGoToVault?.()
        return
      }
      const dekBytes = crypto.getRandomValues(new Uint8Array(32))
      const { encryptedDek, dekNonce, ephemeralPublicKey } = await wrapDEKWithPublicKey(dekBytes, me.user.public_key)
      const res = await api.createTeam({ name:newName.trim(), keySalt:'ecdh' })
      await api.storeTeamKey(res.teamId, { encryptedTeamKey:encryptedDek, ephemeralPublicKey, keyNonce:dekNonce })
      const dekB64 = btoa(String.fromCharCode(...dekBytes))
      sessionStorage.setItem(`team_key_${res.teamId}`, dekB64)
      toast.success(`Workspace "${res.name}" created`)
      setShowCreate(false); setNewName(''); await load(); setActiveTeam(res.teamId)
    } catch(e) { console.error('Workspace creation failed:', e); toast.error(e.message||'Failed to create workspace') }
    setCreating(false)
  }

  async function handleAcceptInvite(token, teamName) {
    try { await api.acceptInvite(token); toast.success(`Joined "${teamName}"`); load() }
    catch(e) { toast.error(e.message) }
  }

  if (activeTeam) {
    return <TeamView teamId={activeTeam} currentUserId={currentUserId} onBack={() => setActiveTeam(null)} onRefreshList={load} />
  }

  return (
    <div style={{ maxWidth:isMobile?'100%':640,width:'100%' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8 }}>
        <h2 style={{ fontSize:20,fontWeight:700,color:'#EEEEF8' }}>Workspace</h2>
        <button onClick={() => { setNewName(''); setShowCreate(true) }} style={btn('primary')}>+ New Workspace</button>
      </div>
      <div style={{ fontSize:12,color:'#8888AA',marginBottom:18,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
        <span style={{ background:'rgba(91,94,244,.08)',color:'#5B5EF4',border:'1px solid rgba(91,94,244,.2)',borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>Zero-knowledge</span>
        <span style={{ background:'rgba(91,94,244,.08)',color:'#5B5EF4',border:'1px solid rgba(91,94,244,.2)',borderRadius:99,padding:'2px 8px',fontSize:11,fontWeight:600 }}>End-to-end encrypted</span>
        <span style={{ color:'#55556A' }}>&middot; Decrypted locally, never on our servers</span>
      </div>

      {invites.length > 0 && (
        <div style={{ background:'rgba(0,194,124,.08)',border:'1px solid rgba(0,194,124,.2)',borderRadius:10,padding:16,marginBottom:18 }}>
          <div style={{ fontWeight:600,fontSize:13,color:'#00C27C',marginBottom:10 }}>Workspace Invitations ({invites.length})</div>
          {invites.map(inv => (
            <div key={inv.id} style={{ display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid rgba(0,194,124,.15)',flexWrap:'wrap' }}>
              <div style={{ flex:1,fontSize:13,color:'#EEEEF8' }}><strong>{inv.inviter_name||'Someone'}</strong> invited you to <strong>{inv.team_name}</strong></div>
              <button onClick={() => handleAcceptInvite(inv.token, inv.team_name)} style={btn('success',true)}>Accept</button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign:'center',padding:60,color:'#55556A' }}>Loading&hellip;</div>
      ) : teams.length === 0 ? (
        <div style={{ textAlign:'center',padding:'60px 20px' }}>
          <div style={{ marginBottom:12,display:'flex',justifyContent:'center' }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="18" cy="16" r="7" fill="rgba(91,94,244,.1)" stroke="#5B5EF4" strokeWidth="1.5"/>
              <path d="M4 40c0-7.732 6.268-14 14-14s14 6.268 14 14" stroke="#5B5EF4" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="34" cy="18" r="5" fill="rgba(91,94,244,.1)" stroke="#5B5EF4" strokeWidth="1.5"/>
              <path d="M37 36c3.866 0 7-3.134 7-7" stroke="#5B5EF4" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ fontSize:16,fontWeight:600,marginBottom:6,color:'#EEEEF8' }}>No workspaces yet</div>
          <div style={{ fontSize:14,color:'#8888AA',marginBottom:20 }}>Create a workspace to collaborate with end-to-end encrypted shared files. Your Vault key protects all team files.</div>
          <button onClick={() => { setNewName(''); setShowCreate(true) }} style={btn('primary')}>Create your first workspace</button>
        </div>
      ) : (
        <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
          {teams.map(t => (
            <div key={t.id} onClick={() => setActiveTeam(t.id)}
              style={{ ...card,cursor:'pointer',display:'flex',alignItems:'center',gap:14 }}
              onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.3)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow=''}>
              <div style={{ width:40,height:40,borderRadius:10,background:'rgba(91,94,244,.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:700,color:'#5B5EF4',flexShrink:0 }}>
                {t.name[0].toUpperCase()}
              </div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontWeight:600,fontSize:14,color:'#EEEEF8' }}>{t.name}</div>
                <div style={{ fontSize:12,color:'#8888AA',display:'flex',alignItems:'center',gap:4 }}>
                  {t.member_count||1} member{t.member_count!==1?'s':''} &middot;{' '}
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <rect x="2" y="5.5" width="8" height="5.5" rx="1.5" fill="rgba(0,194,124,.15)" stroke="#00C27C" strokeWidth="1"/>
                    <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="#00C27C" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  {' E2E encrypted'}
                </div>
              </div>
              <RoleBadge role={t.role==='owner'?'owner':t.role} />
              <span style={{ color:'#55556A',fontSize:18 }}>&#8250;</span>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="New Encrypted Workspace" onClose={() => setShowCreate(false)}
          footer={<>
            <button onClick={() => setShowCreate(false)} style={btn('ghost',true)}>Cancel</button>
            <button onClick={handleCreateTeam} disabled={!newName.trim()||creating} style={btn('primary',true)}>
              {creating ? 'Creating…' : 'Create Workspace'}
            </button>
          </>}>
          <p style={{ fontSize:13,color:'#8888AA',marginBottom:14 }}>
            Give your workspace a name. Files are end-to-end encrypted using your Vault key &mdash; no passphrase to set or share.
          </p>
          <input style={{ width:'100%',padding:'10px 12px',border:'1px solid #1E1E32',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box',background:'#161625',color:'#EEEEF8' }}
            placeholder="e.g. Design Team" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key==='Enter' && handleCreateTeam()} autoFocus />
        </Modal>
      )}
    </div>
  )
}
