import React, { useState } from 'react'

const FILES_URL = import.meta.env.VITE_FILES_URL || 'https://files.datadrop.co.in'

// ── File type SVG icons ──────────────────────────────────────────────────────
function IcoImg()    { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><rect x="3" y="5" width="26" height="22" rx="2.5" stroke="#5B5EF4" strokeWidth="1.5"/><circle cx="10.5" cy="12" r="2.5" fill="#5B5EF4" opacity=".5"/><path d="M3 22l7-7 5 5 4-4 10 8" stroke="#5B5EF4" strokeWidth="1.5" strokeLinejoin="round"/></svg> }
function IcoVideo()  { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><rect x="3" y="6" width="20" height="20" rx="2.5" stroke="#E24B4A" strokeWidth="1.5"/><path d="M23 12l6-4v16l-6-4V12z" stroke="#E24B4A" strokeWidth="1.5" strokeLinejoin="round"/><path d="M10 13l8 3-8 3V13z" fill="#E24B4A" opacity=".6"/></svg> }
function IcoAudio()  { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M9 10h14M9 16h10M9 22h7" stroke="#00C27C" strokeWidth="2" strokeLinecap="round"/><circle cx="22" cy="22" r="4" stroke="#00C27C" strokeWidth="1.5"/><path d="M26 18V10l-6 2v8" stroke="#00C27C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function IcoPDF()    { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M8 3h12l9 9v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="#E24B4A" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 3v9h9" stroke="#E24B4A" strokeWidth="1.5" strokeLinejoin="round"/><path d="M12 17h8M12 21h6" stroke="#E24B4A" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/></svg> }
function IcoWord()   { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M8 3h12l9 9v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 3v9h9" stroke="#3B82F6" strokeWidth="1.5" strokeLinejoin="round"/><path d="M12 17h8M12 21h8M12 25h5" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/></svg> }
function IcoSheet()  { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M8 3h12l9 9v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="#00C27C" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 3v9h9" stroke="#00C27C" strokeWidth="1.5" strokeLinejoin="round"/><rect x="11" y="16" width="10" height="9" rx="1" stroke="#00C27C" strokeWidth="1.2" opacity=".6"/><path d="M16 16v9M11 20.5h10" stroke="#00C27C" strokeWidth="1.2" opacity=".6"/></svg> }
function IcoZip()    { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M8 3h12l9 9v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 3v9h9" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round"/><path d="M14 13h4M14 17h4M14 21h4M14 25h4" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" opacity=".7"/></svg> }
function IcoFile()   { return <svg width={32} height={32} viewBox="0 0 32 32" fill="none"><path d="M8 3h12l9 9v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="#8888AA" strokeWidth="1.5" strokeLinejoin="round"/><path d="M20 3v9h9" stroke="#8888AA" strokeWidth="1.5" strokeLinejoin="round"/></svg> }
function IcoFolder() { return <svg width={22} height={22} viewBox="0 0 22 22" fill="none"><path d="M2 6a2 2 0 0 1 2-2h4.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" fill="#5B5EF4" fillOpacity=".15" stroke="#5B5EF4" strokeWidth="1.3" strokeLinejoin="round"/></svg> }
function IcoVaultLock(){ return <svg width={28} height={28} viewBox="0 0 28 28" fill="none"><rect x="4" y="12" width="20" height="13" rx="2" fill="#5B5EF4" fillOpacity=".1" stroke="#5B5EF4" strokeWidth="1.4"/><path d="M9 12V9a5 5 0 0 1 10 0v3" stroke="#5B5EF4" strokeWidth="1.4" strokeLinecap="round"/><circle cx="14" cy="18.5" r="2.5" fill="#5B5EF4"/></svg> }

// ── Context menu SVG icons ────────────────────────────────────────────────
function MI_Open()      { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_Rename()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3L4 13H1v-3L9 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> }
function MI_Share()     { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><circle cx="10.5" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="3.5" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="10.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4.9 6.2l4.2-2M4.9 7.8l4.2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function MI_Vault()     { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.3"/><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><circle cx="7" cy="9.5" r="1.2" fill="currentColor"/></svg> }
function MI_Versions()  { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M7 4v3l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_Restore()   { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 7A5 5 0 1 0 4 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M2 2v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_Delete()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M3 4l.5 7a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> }
function MI_Browse()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 4a1 1 0 0 1 1-1h3l1.5 1.5H11a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> }
function MI_Move()     { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M1 7h12M9 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_Accept()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 7h10M7 3v8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }
function MI_Confirm()   { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M2 7.5l3.5 3.5L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_Report()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M3 2h8v7l-4 3-4-3V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M7 5v2M7 9h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> }
function MI_Revoke()    { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 7h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }
function MI_Dismiss()   { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }
function MI_EditPerm()  { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.3"/><path d="M5 6V4.5a2 2 0 0 1 4 0V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M8.5 9.5l-1-1-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }
function MI_MoveOut()   { return <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M9 2l3 3-3 3M12 5H5M5 8v3H2V3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg> }

function fileIcon(m) {
  if (!m) return <IcoFile />
  if (m.startsWith('image/'))  return <IcoImg />
  if (m.startsWith('video/'))  return <IcoVideo />
  if (m.startsWith('audio/'))  return <IcoAudio />
  if (m === 'application/pdf') return <IcoPDF />
  if (m.includes('wordprocessingml') || m.includes('msword')) return <IcoWord />
  if (m.includes('spreadsheetml') || m.includes('excel'))     return <IcoSheet />
  if (m.includes('presentationml'))                           return <IcoSheet />
  if (m.includes('zip') || m.includes('archive') || m.includes('compressed')) return <IcoZip />
  return <IcoFile />
}

function fmtSize(b) {
  if (!b) return '—'
  if (b < 1024)    return `${b} B`
  if (b < 1024**2) return `${(b/1024).toFixed(1)} KB`
  if (b < 1024**3) return `${(b/1024**2).toFixed(1)} MB`
  return `${(b/1024**3).toFixed(2)} GB`
}
function fmtDate(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
}

// ── Dark design tokens ────────────────────────────────────────────────────
const D = {
  card:   '#11111E',
  border: '#1E1E32',
  hover:  '#1A1A2E',
  textP:  '#EEEEF8',
  textS:  '#8888AA',
  textT:  '#55556A',
  indigo: '#5B5EF4',
  red:    '#E24B4A',
  menu:   '#0F0F1A',
}

export default function FileGrid({ files, folders, view, loading, onOpenFolder,
    onPreview, onShare, onDelete, onRename, onVersions, onDeleteFolder, onRenameFolder, onRevokeShare,
    selectedFileIds = new Set(), selectedFolderIds = new Set(),
    onToggleFile, onToggleFolder, onShareFolder,
    onMoveToVault, onMoveFolderToVault, onMoveFolder, onMoveOutOfVault,
    onEditShare, onOpenSharedFolder, onReport, onAcceptMove, onConfirmReceipt, onDismissShare }) {

  const [menuId,          setMenuId]          = useState(null)
  const [folderMenuId,    setFolderMenuId]    = useState(null)
  const [renamingFolder,  setRenamingFolder]  = useState(null)
  const [folderRenameVal, setFolderRenameVal] = useState('')

  if (loading) return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:10 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{ height:148, background:D.card, borderRadius:10, border:`1px solid ${D.border}`,
                               animation:'dd-fade 1.8s ease-in-out infinite' }} />
      ))}
    </div>
  )

  if (!files.length && !folders.length) {
    const emptyMsgs = {
      shared:   { title:'Nothing shared yet',    sub:'Share files with colleagues to see them here.' },
      received: { title:'Nothing shared with you', sub:'Files shared with your account appear here.' },
      files:    { title:'No files yet',          sub:'Drop files onto this area or click Upload to get started.' },
    }
    const em = emptyMsgs[view] || emptyMsgs.files
    return (
      <div style={{ textAlign:'center', padding:'80px 20px' }}>
        <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
                       width:64, height:64, background:'#1A1A2E', borderRadius:16, marginBottom:20 }}>
          {view === 'shared'   ? <MI_Share /> :
           view === 'received' ? <MI_Accept /> :
           <IcoFolder />}
        </div>
        <div style={{ fontSize:16, fontWeight:600, color:D.textP, marginBottom:8 }}>{em.title}</div>
        {em.sub && <div style={{ fontSize:14, color:D.textS, maxWidth:300, margin:'0 auto', lineHeight:1.6 }}>{em.sub}</div>}
      </div>
    )
  }

  return (
    <div>
      {/* ── Folders ─────────────────────────────────────────────────── */}
      {folders.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:11, fontWeight:700, color:D.textT, textTransform:'uppercase',
                         letterSpacing:'.6px', marginBottom:10 }}>Folders</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
            {folders.map(f => {
              const sel = selectedFolderIds.has(f.id)
              return (
                <div key={f.id}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
                             background:sel ? '#1A1A2E' : D.card,
                             border:`1px solid ${sel ? D.indigo : D.border}`,
                             borderRadius:10, fontSize:13, fontWeight:500, position:'relative',
                             cursor:'pointer', transition:'border-color .15s, background .15s' }}
                  onMouseEnter={e=>{ if(!sel){ e.currentTarget.style.borderColor='#252540'; e.currentTarget.style.background=D.hover } }}
                  onMouseLeave={e=>{ if(!sel){ e.currentTarget.style.borderColor=D.border; e.currentTarget.style.background=D.card } }}>

                  {onToggleFolder && (
                    <div onClick={e=>{ e.stopPropagation(); onToggleFolder(f.id) }}
                      style={{ width:16, height:16, flexShrink:0, borderRadius:4, cursor:'pointer',
                                background:sel ? D.indigo : 'transparent',
                                border:`1.5px solid ${sel ? D.indigo : '#55556A'}`,
                                display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
                      {sel && <svg width={10} height={10} viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                  )}

                  <span style={{ cursor:'pointer' }} onClick={() => onOpenFolder(f)}>
                    <IcoFolder />
                  </span>

                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                                  flex:1, cursor:'pointer', color:D.textP }}
                    onClick={() => onOpenFolder(f)}>
                    {f.name}
                  </span>

                  <button onClick={e=>{ e.stopPropagation(); setFolderMenuId(folderMenuId===f.id ? null : f.id) }}
                    style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
                              color:D.textT, flexShrink:0, borderRadius:4,
                              display:'flex', alignItems:'center', justifyContent:'center' }}
                    onMouseEnter={e=>e.currentTarget.style.color=D.textP}
                    onMouseLeave={e=>e.currentTarget.style.color=D.textT}>
                    <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="3" r="1.1" fill="currentColor"/>
                      <circle cx="7" cy="7" r="1.1" fill="currentColor"/>
                      <circle cx="7" cy="11" r="1.1" fill="currentColor"/>
                    </svg>
                  </button>

                  {folderMenuId === f.id && (
                    <FolderContextMenu f={f}
                      onOpen={() => { setFolderMenuId(null); onOpenFolder(f) }}
                      onShare={onShareFolder ? () => { setFolderMenuId(null); onShareFolder(f) } : null}
                      onMove={onMoveFolder ? () => { setFolderMenuId(null); onMoveFolder(f) } : null}
                      onVault={onMoveFolderToVault ? () => { setFolderMenuId(null); onMoveFolderToVault(f) } : null}
                      onRename={onRenameFolder ? () => { setFolderMenuId(null); setRenamingFolder(f); setFolderRenameVal(f.name) } : null}
                      onDelete={onDeleteFolder ? () => { setFolderMenuId(null); onDeleteFolder(f) } : null}
                      onClose={() => setFolderMenuId(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Files ───────────────────────────────────────────────────── */}
      {files.length > 0 && (
        <div>
          {folders.length > 0 && (
            <div style={{ fontSize:11, fontWeight:700, color:D.textT, textTransform:'uppercase',
                           letterSpacing:'.6px', marginBottom:10 }}>Files</div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:8 }}>
            {files.map(file => (
              <FileCard key={file.id} file={file} view={view}
                menuOpen={menuId === file.id}
                onMenuToggle={() => setMenuId(menuId === file.id ? null : file.id)}
                onPreview={() => { setMenuId(null); onPreview(file) }}
                onShare={() => { setMenuId(null); onShare(file) }}
                onDelete={() => { setMenuId(null); onDelete(file) }}
                onRename={() => { setMenuId(null); onRename({ id:file.id, name:file.filename }) }}
                onVersions={() => { setMenuId(null); onVersions(file) }}
                onRevokeShare={onRevokeShare ? () => { setMenuId(null); onRevokeShare(file) } : null}
                onEditShare={onEditShare ? () => { setMenuId(null); onEditShare(file) } : null}
                onOpenSharedFolder={onOpenSharedFolder && file.item_type==='folder' ? () => { setMenuId(null); onOpenSharedFolder(file) } : null}
                onMoveToVault={onMoveToVault ? () => { setMenuId(null); onMoveToVault(file) } : null}
                onMoveOutOfVault={onMoveOutOfVault ? () => { setMenuId(null); onMoveOutOfVault(file) } : null}
                onReport={onReport ? () => { setMenuId(null); onReport(file) } : null}
                onAcceptMove={onAcceptMove && file.can_save ? () => { setMenuId(null); onAcceptMove(file) } : null}
                onConfirmReceipt={onConfirmReceipt && file.delete_on_confirm ? () => { setMenuId(null); onConfirmReceipt(file) } : null}
                onDismissShare={onDismissShare ? () => { setMenuId(null); onDismissShare(file) } : null}
                selected={selectedFileIds.has(file.id)}
                onToggleSelect={onToggleFile ? () => onToggleFile(file.id) : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Folder rename modal ──────────────────────────────────────── */}
      {renamingFolder && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(7,7,13,0.85)', zIndex:200,
                         backdropFilter:'blur(8px)' }}
            onClick={() => setRenamingFolder(null)} />
          <div style={{ position:'fixed', inset:0, zIndex:201, display:'flex',
                          alignItems:'center', justifyContent:'center', padding:20 }}>
            <div style={{ background:'#0F0F1A', border:'1px solid #1E1E32', borderRadius:16,
                           padding:28, width:'100%', maxWidth:360,
                           boxShadow:'0 24px 64px rgba(0,0,0,.6)' }}>
              <h3 style={{ fontSize:16, fontWeight:700, color:'#EEEEF8', marginBottom:16 }}>Rename folder</h3>
              <input autoFocus value={folderRenameVal} onChange={e=>setFolderRenameVal(e.target.value)}
                onKeyDown={e=>{
                  if (e.key==='Enter' && folderRenameVal.trim()) { onRenameFolder(renamingFolder, folderRenameVal.trim()); setRenamingFolder(null) }
                  if (e.key==='Escape') setRenamingFolder(null)
                }}
                style={{ width:'100%', padding:'10px 14px', border:'1px solid #1E1E32', borderRadius:10,
                           fontSize:14, outline:'none', background:'#161625', color:'#EEEEF8',
                           boxSizing:'border-box', marginBottom:16 }} />
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => { if (folderRenameVal.trim()) { onRenameFolder(renamingFolder, folderRenameVal.trim()); setRenamingFolder(null) } }}
                  style={{ flex:1, padding:10, background:'#5B5EF4', color:'#fff', border:'none',
                             borderRadius:10, fontWeight:600, cursor:'pointer', fontSize:14 }}>
                  Rename
                </button>
                <button onClick={() => setRenamingFolder(null)}
                  style={{ flex:1, padding:10, background:'#161625', color:'#8888AA',
                             border:'1px solid #1E1E32', borderRadius:10, fontWeight:600, cursor:'pointer', fontSize:14 }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function FolderContextMenu({ onOpen, onShare, onMove, onVault, onRename, onDelete, onClose }) {
  return (
    <>
      <div style={{ position:'fixed', inset:0, zIndex:9 }} onClick={onClose} />
      <div style={{ position:'absolute', right:6, top:44, background:D.menu,
                     border:`1px solid ${D.border}`, borderRadius:10, zIndex:10,
                     boxShadow:'0 8px 24px rgba(0,0,0,.4)', minWidth:152, overflow:'hidden' }}>
        <CMenuItem Icon={MI_Browse} label="Open"         onClick={onOpen} />
        {onShare  && <CMenuItem Icon={MI_Share}  label="Share"        onClick={onShare} />}
        {onMove   && <CMenuItem Icon={MI_Move}   label="Move"         onClick={onMove} />}
        {onVault  && <CMenuItem Icon={MI_Vault}  label="Move to Vault" onClick={onVault} />}
        {onRename && <CMenuItem Icon={MI_Rename} label="Rename"       onClick={onRename} />}
        {onDelete && <CMenuItem Icon={MI_Delete} label="Delete"       onClick={onDelete} danger />}
      </div>
    </>
  )
}

function CMenuItem({ Icon, label, onClick, danger }) {
  return (
    <button onClick={e => { e.stopPropagation(); onClick() }}
      style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 14px',
                border:'none', background:'none', cursor:'pointer', fontSize:13,
                color:danger ? D.red : D.textP, textAlign:'left', transition:'background .1s' }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? 'rgba(226,75,74,0.1)' : D.hover}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
      <span style={{ color:danger ? D.red : D.textS, display:'flex', flexShrink:0 }}><Icon /></span>
      {label}
    </button>
  )
}

function FileCard({ file, view, menuOpen, onMenuToggle, onPreview, onShare, onDelete, onRename, onVersions, onRevokeShare, onEditShare, onOpenSharedFolder, onMoveToVault, onMoveOutOfVault, onReport, onAcceptMove, onConfirmReceipt, onDismissShare, selected, onToggleSelect }) {
  const filename = file.folder_name || file.filename || file.name || 'Untitled'
  const isFolder = file.item_type === 'folder'

  return (
    <div style={{ background:D.card, border:`1px solid ${selected ? D.indigo : D.border}`,
                   borderRadius:10, position:'relative', cursor:'pointer',
                   transition:'border-color .15s, box-shadow .15s, background .15s' }}
      onMouseEnter={e=>{ if(!selected){ e.currentTarget.style.borderColor='#252540'; e.currentTarget.style.background='#13131F' } }}
      onMouseLeave={e=>{ if(!selected){ e.currentTarget.style.borderColor=D.border; e.currentTarget.style.background=D.card } }}>

      {/* Selection checkbox */}
      {onToggleSelect && (
        <div onClick={e=>{ e.stopPropagation(); onToggleSelect() }}
          style={{ position:'absolute', top:8, left:8, width:18, height:18, zIndex:5, borderRadius:4,
                    background:selected ? D.indigo : 'rgba(15,15,26,0.85)',
                    border:`1.5px solid ${selected ? D.indigo : '#55556A'}`,
                    cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                    transition:'all .15s', backdropFilter:'blur(4px)' }}>
          {selected && <svg width={10} height={10} viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </div>
      )}

      {/* Thumbnail / icon area */}
      <div style={{ height:100, background:'#0C0C18', display:'flex', alignItems:'center', justifyContent:'center',
                     overflow:'hidden', position:'relative', borderTopLeftRadius:10, borderTopRightRadius:10 }}
        onClick={isFolder && onOpenSharedFolder ? onOpenSharedFolder : onPreview}>

        {isFolder ? (
          <svg width={40} height={40} viewBox="0 0 22 22" fill="none">
            <path d="M2 6a2 2 0 0 1 2-2h4.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"
              fill="#5B5EF4" fillOpacity=".2" stroke="#5B5EF4" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
        ) : (file.is_vault && !file.thumb_data?.startsWith('data:')) ? (
          <IcoVaultLock />
        ) : (file.thumb_data || file.thumb_key) ? (
          <>
            <img
              src={file.thumb_data || `${FILES_URL}/files/${file.id}/thumb`}
              alt=""
              style={{ width:'100%', height:'100%', objectFit:'cover' }}
              onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }}
            />
            <span style={{ display:'none', width:'100%', height:'100%',
                            alignItems:'center', justifyContent:'center' }}>
              {fileIcon(file.mime_type)}
            </span>
          </>
        ) : (
          fileIcon(file.mime_type)
        )}
      </div>

      {/* File info */}
      <div style={{ padding:'10px 12px' }} onClick={onPreview}>
        <div style={{ fontSize:12, fontWeight:600, marginBottom:3, color:D.textP,
                       display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{filename}</span>
          {(file.version_number > 1 || file.archived_count > 0) && (
            <span style={{ flexShrink:0, background:'rgba(91,94,244,0.2)', color:D.indigo,
                            fontSize:9, fontWeight:700, padding:'1px 5px', borderRadius:100 }}>
              v{file.version_number || 1}
            </span>
          )}
        </div>
        {view === 'shared' ? (
          <div style={{ fontSize:11, color:D.textS, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            → {file.recipient_username
              ? `@${file.recipient_username}`
              : file.recipient_display_name || file.recipient_email || file.recipient_user_email
              || (file.invite_link_token ? 'Via link' : '—')}
          </div>
        ) : view === 'received' ? (
          <div style={{ fontSize:11, color:D.textS, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            From {file.owner_name
              ? `${file.owner_name}${file.owner_email ? ` (${file.owner_email})` : ''}`
              : file.owner_email || '—'}
          </div>
        ) : (
          <div style={{ fontSize:11, color:D.textT, fontFamily:"'JetBrains Mono',monospace" }}>
            {fmtSize(file.size_bytes)} · {fmtDate(file.created_at)}
          </div>
        )}
      </div>

      {/* 3-dot menu button */}
      <button onClick={e=>{ e.stopPropagation(); onMenuToggle() }}
        style={{ position:'absolute', top:8, right:8, background:'rgba(15,15,26,0.85)',
                  border:`1px solid ${D.border}`, borderRadius:7, width:28, height:28,
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                  color:D.textS, backdropFilter:'blur(4px)', transition:'color .1s,border-color .1s' }}
        onMouseEnter={e=>{ e.currentTarget.style.color=D.textP; e.currentTarget.style.borderColor='#252540' }}
        onMouseLeave={e=>{ e.currentTarget.style.color=D.textS; e.currentTarget.style.borderColor=D.border }}>
        <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="3" r="1.1" fill="currentColor"/>
          <circle cx="7" cy="7" r="1.1" fill="currentColor"/>
          <circle cx="7" cy="11" r="1.1" fill="currentColor"/>
        </svg>
      </button>

      {menuOpen && (
        <ContextMenu view={view} isVault={file.is_vault} itemType={file.item_type}
          onPreview={onPreview} onShare={onShare} onDelete={onDelete}
          onRename={onRename} onVersions={onVersions}
          onRevokeShare={onRevokeShare} onEditShare={onEditShare}
          onOpenSharedFolder={onOpenSharedFolder}
          onMoveToVault={onMoveToVault}
          onMoveOutOfVault={onMoveOutOfVault}
          onReport={onReport}
          onAcceptMove={onAcceptMove}
          onConfirmReceipt={onConfirmReceipt}
          onDismissShare={onDismissShare}
          onClose={onMenuToggle} />
      )}
    </div>
  )
}

function ContextMenu({ view, isVault, itemType, onPreview, onShare, onDelete, onRename, onVersions, onRevokeShare, onEditShare, onOpenSharedFolder, onMoveToVault, onMoveOutOfVault, onReport, onAcceptMove, onConfirmReceipt, onDismissShare, onClose }) {
  return (
    <>
      <div style={{ position:'fixed', inset:0, zIndex:9 }} onClick={onClose} />
      <div style={{ position:'absolute', right:6, top:36, background:D.menu,
                     border:`1px solid ${D.border}`, borderRadius:10, zIndex:10,
                     boxShadow:'0 8px 32px rgba(0,0,0,.5)', minWidth:160, overflow:'hidden' }}>
        {view === 'received' ? (
          <>
            {itemType === 'folder' && onOpenSharedFolder
              ? <CMenuItem Icon={MI_Browse}  label="Browse folder"         onClick={onOpenSharedFolder} />
              : <CMenuItem Icon={MI_Open}    label="Open"                  onClick={onPreview} />}
            {onAcceptMove    && <CMenuItem Icon={MI_Accept}  label="Move to my storage"     onClick={onAcceptMove} />}
            {onConfirmReceipt && <CMenuItem Icon={MI_Confirm} label="Confirm receipt"        onClick={onConfirmReceipt} />}
            {onReport && itemType !== 'folder' && <CMenuItem Icon={MI_Report}  label="Report"              onClick={onReport}      danger />}
            {onDismissShare  && <CMenuItem Icon={MI_Dismiss} label="Remove from shared"     onClick={onDismissShare} danger />}
          </>
        ) : view === 'shared' ? (
          <>
            <CMenuItem Icon={MI_Open}     label="Open"             onClick={onPreview} />
            {onEditShare && <CMenuItem Icon={MI_EditPerm} label="Edit permissions" onClick={onEditShare} />}
            <CMenuItem Icon={MI_Revoke}   label="Revoke access"    onClick={onRevokeShare} danger />
          </>
        ) : view === 'teams' ? (
          <>
            <CMenuItem Icon={MI_Open}     label="Open"             onClick={onPreview} />
            <CMenuItem Icon={MI_Versions} label="Version history"  onClick={onVersions} />
            {onDelete && <CMenuItem Icon={MI_Delete} label="Delete" onClick={onDelete} danger />}
          </>
        ) : (
          <>
            <CMenuItem Icon={MI_Open}     label="Open"             onClick={onPreview} />
            <CMenuItem Icon={MI_Rename}   label="Rename"           onClick={onRename} />
            {!isVault && <CMenuItem Icon={MI_Share}    label="Share"            onClick={onShare} />}
            <CMenuItem Icon={MI_Versions} label="Version history"  onClick={onVersions} />
            {onMoveToVault    && <CMenuItem Icon={MI_Vault} label="Move to Vault"    onClick={onMoveToVault} />}
            {onMoveOutOfVault && <CMenuItem Icon={MI_Vault} label="Move out of Vault" onClick={onMoveOutOfVault} />}
            <CMenuItem Icon={MI_Delete}   label="Delete"           onClick={onDelete} danger />
          </>
        )}
      </div>
    </>
  )
}
