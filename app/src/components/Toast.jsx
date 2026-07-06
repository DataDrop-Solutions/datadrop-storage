import React, { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const colors = {
    info:    { bg: '#11111E', color: '#EEEEF8', border: '1px solid #1E1E32' },
    success: { bg: '#0A2118', color: '#00C27C', border: '1px solid rgba(0,194,124,0.25)' },
    error:   { bg: '#1E0B0B', color: '#E24B4A', border: '1px solid rgba(226,75,74,0.25)' },
    warning: { bg: '#1E1408', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.25)' },
  }

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                    display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        {toasts.map(t => (
          <div key={t.id}
            onClick={() => dismiss(t.id)}
            style={{
              background: colors[t.type].bg,
              color:      colors[t.type].color,
              border:     colors[t.type].border,
              padding: '11px 18px', borderRadius: 10,
              fontSize: 13, fontWeight: 600,
              boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
              cursor: 'pointer', maxWidth: 340,
              animation: 'dd-slide-up 0.2s ease',
            }}>
            {t.message}
          </div>
        ))}
      </div>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }`}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

// Convenience hook with typed methods
export function useToastMethods() {
  const show = useToast()
  return {
    info:    (msg, dur) => show(msg, 'info', dur),
    success: (msg, dur) => show(msg, 'success', dur),
    error:   (msg, dur) => show(msg, 'error', dur),
    warning: (msg, dur) => show(msg, 'warning', dur),
  }
}
