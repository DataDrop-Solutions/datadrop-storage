import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'

function isVaultUnlocked() {
  return !!(sessionStorage.getItem('dd_vault_private_key_pkcs8') || sessionStorage.getItem('dd_vault_key'))
}

function isTeamUnlocked(teamId) {
  return !!sessionStorage.getItem(`team_key_${teamId}`)
}

export default function FileMoveModal({ initialSection = 'files', selectedCount, excludeFolderIds = new Set(), actionLabel = 'Move Here', onMove, onClose }) {
  const [section,        setSection]        = useState(initialSection)
  const [folderStack,    setFolderStack]    = useState([])
  const [folders,        setFolders]        = useState([])
  const [loading,        setLoading]        = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('')
  const [moving,         setMoving]         = useState(false)

  // Teams state
  const [teams,        setTeams]        = useState(null)   // null = not loaded yet
  const [selectedTeam, setSelectedTeam] = useState(null)  // { id, name }

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null
  const vaultLocked     = section === 'vault'  && !isVaultUnlocked()
  const teamLocked      = section === 'teams'  && selectedTeam && !isTeamUnlocked(selectedTeam.id)

  // Reset navigation when section changes
  useEffect(() => { setFolderStack([]); setSelectedTeam(null); setTeams(null) }, [section])

  // Load teams list when teams section entered
  useEffect(() => {
    if (section !== 'teams' || teams !== null) return
    api.listTeams().then(d => setTeams(d.teams || [])).catch(() => setTeams([]))
  }, [section, teams])

  // Load folders when navigating files/vault/team folders
  useEffect(() => { loadFolders() }, [section, currentFolderId, selectedTeam])

  async function loadFolders() {
    if (section === 'vault' && !isVaultUnlocked()) { setFolders([]); return }
    if (section === 'teams' && !selectedTeam) { setFolders([]); return }
    setLoading(true)
    try {
      if (section === 'teams') {
        const d = await api.listTeamFiles(selectedTeam.id, currentFolderId ? { folderId: currentFolderId } : {})
        setFolders(d.folders || [])
      } else {
        const params = {}
        if (section === 'vault') params.vault = '1'
        if (currentFolderId) params.folder = currentFolderId
        const d = await api.listFiles(params)
        const raw = d.folders || []
        setFolders(section === 'files' ? raw.filter(f => !excludeFolderIds.has(f.id)) : raw)
      }
    } catch (_) {}
    setLoading(false)
  }

  function navigateTo(idx) {
    setFolderStack(prev => idx < 0 ? [] : prev.slice(0, idx + 1))
  }

  function selectTeam(team) {
    setSelectedTeam(team)
    setFolderStack([])
  }

  async function createFolder() {
    if (!newFolderName.trim()) return
    try {
      if (section === 'teams') {
        const { folderId } = await api.createTeamFolder(selectedTeam.id, {
          name: newFolderName.trim(),
          parentId: currentFolderId,
        })
        setFolders(prev => [...prev, { id: folderId, name: newFolderName.trim() }])
      } else {
        const { folderId } = await api.createFolder({
          name: newFolderName.trim(),
          parentId: currentFolderId,
          isVault: section === 'vault',
        })
        setFolders(prev => [...prev, { id: folderId, name: newFolderName.trim() }])
      }
      setCreatingFolder(false)
      setNewFolderName('')
    } catch (_) {}
  }

  async function handleMoveHere() {
    setMoving(true)
    try {
      await onMove(section, currentFolderId, selectedTeam?.id ?? null)
    } finally {
      setMoving(false)
    }
  }

  const sectionLabel = section === 'vault' ? 'Vault'
    : section === 'teams' ? (selectedTeam ? selectedTeam.name : 'Secured Sharing')
    : 'Files'

  const disableMoveHere = moving || vaultLocked || teamLocked
  const disableNewFolder = vaultLocked || teamLocked || (section === 'teams' && !selectedTeam)

  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(7,7,13,.87)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'#0F0F1A',border:'1px solid #1E1E32',borderRadius:16,width:'100%',maxWidth:480,
                     boxShadow:'0 20px 60px rgba(0,0,0,.7)',overflow:'hidden',margin:16 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 24px',borderBottom:'1px solid #1E1E32' }}>
          <span style={{ fontWeight:700,fontSize:15,color:'#EEEEF8' }}>
            Move {selectedCount} item{selectedCount !== 1 ? 's' : ''}
          </span>
          <button onClick={onClose}
            style={{ background:'none',border:'none',cursor:'pointer',fontSize:22,color:'#55556A',lineHeight:1,padding:'0 2px' }}>
            ×
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display:'flex',borderBottom:'1px solid #1E1E32' }}>
          {[['files','📁 Files'],['vault','🔒 Vault'],['teams','👥 Secured Sharing']].map(([s, label]) => (
            <button key={s} onClick={() => setSection(s)}
              style={{ flex:1,padding:'10px 6px',background:'none',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
                         color:section===s?'#5B5EF4':'#8888AA',
                         borderBottom:section===s?'2px solid #5B5EF4':'2px solid transparent',
                         transition:'color .12s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Breadcrumb */}
        <div style={{ padding:'9px 24px',display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',fontSize:13,
                       borderBottom:'1px solid #1E1E32',minHeight:40 }}>
          <button onClick={() => { navigateTo(-1); if (section === 'teams') setSelectedTeam(null) }}
            style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontSize:13,
                       color:(folderStack.length===0&&!selectedTeam)?'#EEEEF8':'#8888AA',
                       fontWeight:(folderStack.length===0&&!selectedTeam)?600:400 }}>
            {sectionLabel}
          </button>
          {folderStack.map((f, i) => (
            <React.Fragment key={f.id}>
              <span style={{ color:'#55556A' }}>›</span>
              <button onClick={() => navigateTo(i)}
                style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 4px',fontSize:13,
                           color:i===folderStack.length-1?'#EEEEF8':'#8888AA',
                           fontWeight:i===folderStack.length-1?600:400 }}>
                {f.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div style={{ height:200,overflowY:'auto' }}>
          {/* Vault locked state */}
          {vaultLocked ? (
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                           height:'100%',color:'#55556A',fontSize:13,textAlign:'center',padding:20,gap:8 }}>
              <span style={{ fontSize:22 }}>🔒</span>
              Vault is locked — unlock it first to move files here
            </div>
          ) : section === 'teams' && !selectedTeam ? (
            /* Team picker */
            teams === null ? (
              <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#55556A',fontSize:13 }}>
                Loading…
              </div>
            ) : teams.length === 0 ? (
              <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
                             color:'#55556A',fontSize:13,textAlign:'center',padding:20 }}>
                No workspaces — create one in Secured Sharing first
              </div>
            ) : (
              teams.map(t => {
                const unlocked = isTeamUnlocked(t.id)
                return (
                  <button key={t.id} onClick={() => selectTeam(t)}
                    style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'11px 24px',
                               background:'none',border:'none',cursor:'pointer',textAlign:'left',color:'#EEEEF8',fontSize:13 }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.05)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <span style={{ fontSize:14 }}>👥</span>
                    <span style={{ flex:1 }}>{t.name}</span>
                    {!unlocked && <span style={{ fontSize:11,color:'#55556A' }}>locked</span>}
                    <span style={{ color:'#55556A',fontSize:11 }}>›</span>
                  </button>
                )
              })
            )
          ) : teamLocked ? (
            <div style={{ display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                           height:'100%',color:'#55556A',fontSize:13,textAlign:'center',padding:20,gap:8 }}>
              <span style={{ fontSize:22 }}>🔒</span>
              Workspace is locked — open it in Secured Sharing first
            </div>
          ) : loading ? (
            <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#55556A',fontSize:13 }}>
              Loading…
            </div>
          ) : folders.length === 0 ? (
            <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
                           color:'#55556A',fontSize:13,textAlign:'center',padding:20 }}>
              No subfolders — move here or create one below
            </div>
          ) : (
            folders.map(f => (
              <button key={f.id}
                onClick={() => setFolderStack(prev => [...prev, { id: f.id, name: f.name }])}
                style={{ width:'100%',display:'flex',alignItems:'center',gap:10,padding:'11px 24px',
                           background:'none',border:'none',cursor:'pointer',textAlign:'left',color:'#EEEEF8',fontSize:13 }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.05)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{ fontSize:14 }}>📁</span>
                <span style={{ flex:1 }}>{f.name}</span>
                <span style={{ color:'#55556A',fontSize:11 }}>›</span>
              </button>
            ))
          )}
        </div>

        {/* New folder row */}
        <div style={{ padding:'10px 24px',borderTop:'1px solid #1E1E32',borderBottom:'1px solid #1E1E32' }}>
          {creatingFolder ? (
            <div style={{ display:'flex',gap:8 }}>
              <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') createFolder()
                  if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                }}
                placeholder="New folder name" autoFocus
                style={{ flex:1,padding:'7px 12px',background:'#161625',border:'1px solid #1E1E32',borderRadius:8,
                           color:'#EEEEF8',fontSize:13,outline:'none' }} />
              <button onClick={createFolder}
                style={{ padding:'7px 14px',background:'#5B5EF4',border:'none',color:'#fff',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer' }}>
                Create
              </button>
              <button onClick={() => { setCreatingFolder(false); setNewFolderName('') }}
                style={{ padding:'7px 12px',background:'none',border:'1px solid #1E1E32',color:'#8888AA',borderRadius:8,fontSize:13,cursor:'pointer' }}>
                ×
              </button>
            </div>
          ) : (
            <button onClick={() => setCreatingFolder(true)} disabled={disableNewFolder}
              style={{ background:'none',border:'none',color:disableNewFolder?'#55556A':'#5B5EF4',fontSize:12,
                         cursor:disableNewFolder?'default':'pointer',padding:'2px 0',fontWeight:500 }}>
              + New Folder
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ display:'flex',gap:10,justifyContent:'flex-end',padding:'14px 24px' }}>
          <button onClick={onClose}
            style={{ padding:'9px 20px',background:'none',border:'1px solid #1E1E32',color:'#8888AA',
                       borderRadius:9,fontSize:13,cursor:'pointer',fontWeight:500 }}>
            Cancel
          </button>
          <button onClick={handleMoveHere} disabled={disableMoveHere || (section === 'teams' && !selectedTeam)}
            style={{ padding:'9px 20px',background:'#5B5EF4',border:'none',color:'#fff',
                       borderRadius:9,fontSize:13,fontWeight:600,
                       cursor:(disableMoveHere||(section==='teams'&&!selectedTeam))?'not-allowed':'pointer',
                       opacity:(disableMoveHere||(section==='teams'&&!selectedTeam))?0.5:1 }}>
            {moving ? 'Working…' : actionLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
