import React, { useState } from 'react'

export default function UploadProgressPanel({ uploads }) {
  const [minimized, setMinimized] = useState(false)

  if (!uploads || uploads.length === 0) return null

  const active  = uploads.filter(u => !u.done && !u.error)
  const failed  = uploads.filter(u => u.error)
  const done    = uploads.filter(u => u.done)
  const total   = uploads.length

  const headerLabel = active.length > 0
    ? `Uploading ${active.length} of ${total} file${total !== 1 ? 's' : ''}…`
    : failed.length > 0
    ? `${failed.length} upload${failed.length !== 1 ? 's' : ''} failed`
    : `${done.length} upload${done.length !== 1 ? 's' : ''} complete`

  const panel = {
    position: 'fixed',
    bottom: 20,
    right: 20,
    width: 320,
    background: '#0F0F1A',
    border: '1px solid #1E1E32',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,.6)',
    zIndex: 600,
    overflow: 'hidden',
    fontFamily: 'inherit',
  }

  const header = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: '#11111E',
    borderBottom: minimized ? 'none' : '1px solid #1E1E32',
    cursor: 'pointer',
    userSelect: 'none',
  }

  return (
    <div style={panel}>
      <div style={header} onClick={() => setMinimized(v => !v)}>
        {active.length > 0 && (
          <div style={{
            width: 14, height: 14, border: '2px solid rgba(91,94,244,.3)',
            borderTopColor: '#5B5EF4', borderRadius: '50%', flexShrink: 0,
            animation: 'dd-spin 0.7s linear infinite',
          }} />
        )}
        {active.length === 0 && failed.length > 0 && (
          <span style={{ color: '#E24B4A', fontSize: 14 }}>⚠</span>
        )}
        {active.length === 0 && failed.length === 0 && (
          <span style={{ color: '#00C27C', fontSize: 14 }}>✓</span>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: '#EEEEF8', flex: 1 }}>
          {headerLabel}
        </span>
        <span style={{ color: '#55556A', fontSize: 16, lineHeight: 1 }}>
          {minimized ? '▲' : '▼'}
        </span>
      </div>

      {!minimized && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: '8px 0' }}>
          {uploads.map(u => {
            const key = u.uid || u.id
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 14px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: '#EEEEF8',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginBottom: 4,
                  }}>
                    {u.name}
                  </div>
                  {!u.error && !u.done && (
                    <div style={{ height: 2, background: '#1E1E32', borderRadius: 99 }}>
                      <div style={{
                        width: `${u.progress || 0}%`, height: '100%',
                        background: '#5B5EF4', borderRadius: 99, transition: 'width .15s',
                      }} />
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, flexShrink: 0,
                  color: u.error ? '#E24B4A' : u.done ? '#00C27C' : '#8888AA',
                  minWidth: 32, textAlign: 'right',
                }}>
                  {u.error ? 'Failed' : u.done ? 'Done' : `${u.progress || 0}%`}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
