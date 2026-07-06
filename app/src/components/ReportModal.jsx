import React, { useState, useRef } from 'react'
import { api } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'

const REASONS = [
  'Inappropriate content',
  'Copyright infringement',
  'Harassment or abuse',
  'Spam or misleading',
  'Illegal content',
  'Other',
]

export default function ReportModal({ file, onClose }) {
  const toast       = useToastMethods()
  const inputRef    = useRef()
  const [reason,    setReason]    = useState(REASONS[0])
  const [evidence,  setEvidence]  = useState(null)   // { base64, type, previewUrl, name }
  const [submitting,setSubmitting]= useState(false)
  const [done,      setDone]      = useState(false)

  function handleScreenshot(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPEG, etc.)')
      return
    }
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target.result
      const base64  = dataUrl.split(',')[1]
      setEvidence({ base64, type: file.type, previewUrl: dataUrl, name: file.name })
    }
    reader.readAsDataURL(file)
  }

  async function submit() {
    if (!evidence) {
      toast.error('Screenshot required — please upload evidence before submitting')
      return
    }
    setSubmitting(true)
    try {
      await api.submitReport({
        fileId:        file.id || file.file_id,
        shareId:       file.share_id || null,
        reason,
        evidenceBase64: evidence.base64,
        evidenceType:   evidence.type,
      })
      setDone(true)
    } catch (e) {
      toast.error(e.message || 'Failed to submit report')
    }
    setSubmitting(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440,
                     maxHeight: '90vh', overflow: 'auto', padding: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>🚩 Report file</h2>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Report submitted</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              The file has been hidden while we review it. Thank you.
            </div>
            <button onClick={onClose}
              style={{ padding: '10px 24px', background: '#111', color: '#fff',
                        border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              Reporting <strong style={{ color: '#111' }}>{file.filename || file.folder_name || 'this file'}</strong>.
              {' '}A screenshot of the content is required as evidence.
            </div>

            {/* Reason */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                               letterSpacing: '.5px', color: '#6b7280', marginBottom: 8 }}>
                Reason
              </label>
              <select value={reason} onChange={e => setReason(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb',
                          borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none' }}>
                {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Evidence screenshot */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                               letterSpacing: '.5px', color: '#6b7280', marginBottom: 8 }}>
                Evidence screenshot <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={handleScreenshot} />

              {evidence ? (
                <div style={{ position: 'relative' }}>
                  <img src={evidence.previewUrl} alt="Evidence"
                    style={{ width: '100%', maxHeight: 200, objectFit: 'contain',
                              borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb' }} />
                  <button onClick={() => setEvidence(null)}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)',
                              border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer',
                              fontSize: 12, padding: '2px 8px' }}>
                    Remove
                  </button>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{evidence.name}</div>
                </div>
              ) : (
                <button onClick={() => inputRef.current?.click()}
                  style={{ width: '100%', padding: '18px 12px', border: '2px dashed #e5e7eb',
                            borderRadius: 8, background: '#fafafa', cursor: 'pointer',
                            fontSize: 13, color: '#6b7280', fontWeight: 500 }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#111'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#e5e7eb'}>
                  📷 Click to upload screenshot
                  <div style={{ fontSize: 11, marginTop: 4, fontWeight: 400 }}>PNG, JPEG, WEBP</div>
                </button>
              )}
            </div>

            {/* Disclaimer */}
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 18, lineHeight: 1.6,
                           padding: '10px 12px', background: '#f9fafb', borderRadius: 7 }}>
              Reports without a screenshot cannot be accepted. The file will be immediately
              hidden while our team reviews it.
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={submit} disabled={submitting || !evidence}
                style={{ flex: 1, padding: '11px 16px', background: submitting ? '#d1d5db' : '#dc2626',
                          color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700,
                          fontSize: 14, cursor: submitting || !evidence ? 'not-allowed' : 'pointer' }}>
                {submitting ? 'Submitting…' : 'Submit Report'}
              </button>
              <button onClick={onClose}
                style={{ padding: '11px 16px', background: '#f3f4f6', border: 'none',
                          borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
