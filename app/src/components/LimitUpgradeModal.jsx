import React, { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { useToastMethods } from './Toast.jsx'

const PRESETS = [149, 299, 499, 999]
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9000, padding: 16,
}
const card = {
  background: '#13132A', border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 16, padding: 28, width: '100%', maxWidth: 420,
  boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
}
const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.5px', color: '#7A7AAA', marginBottom: 6, display: 'block' }
const input = {
  width: '100%', padding: '10px 14px',
  border: '1px solid rgba(255,255,255,.07)', borderRadius: 10,
  fontSize: 14, outline: 'none',
  background: '#161625', color: '#EDEDFF', boxSizing: 'border-box',
}

const MIN_LIMIT = 49

function gbFromLimit(limitRs) {
  return Math.floor(limitRs / 1.49)
}

export default function LimitUpgradeModal({ currentLimit, onSuccess, onClose }) {
  const toast = useToastMethods()
  const [selected, setSelected]   = useState(null)
  const [custom, setCustom]       = useState('')
  const [busy, setBusy]           = useState(false)

  const effectiveLimit = selected !== null ? selected
    : custom !== '' ? (Math.floor(parseFloat(custom)) || 0)
    : 0

  const newGb      = effectiveLimit > 0 ? gbFromLimit(effectiveLimit) : null
  const currentGb  = currentLimit   > 0 ? gbFromLimit(currentLimit)   : null
  const isDecrease = effectiveLimit > 0 && effectiveLimit < currentLimit
  const isUnchanged = effectiveLimit === currentLimit

  useEffect(() => {
    if (!document.getElementById('rzp-script')) {
      const s = document.createElement('script')
      s.id  = 'rzp-script'
      s.src = 'https://checkout.razorpay.com/v1/checkout.js'
      document.head.appendChild(s)
    }
  }, [])

  async function handleProceed() {
    if (!effectiveLimit || effectiveLimit < MIN_LIMIT) {
      toast.error(`Minimum monthly limit is ₹${MIN_LIMIT}`)
      return
    }
    if (isUnchanged) {
      toast.info('Limit is already set to that amount')
      return
    }
    setBusy(true)
    try {
      const order = await api.createUpgradeMandate({ protectionLimit: effectiveLimit })
      if (!window.Razorpay) throw new Error('Razorpay SDK not loaded')

      const rzp = new window.Razorpay({
        key:         order.key,
        order_id:    order.orderId,
        customer_id: order.customerId,
        recurring:   true,
        amount:      order.amount,
        currency:    order.currency,
        name:        'DataDrop',
        description: `AutoPay limit change — ₹${effectiveLimit}/month max`,
        prefill:     { ...order.prefill },
        config: {
          display: {
            blocks: {
              upi: {
                name: 'Pay via UPI',
                instruments: [{ method: 'upi', flows: ['vpa', 'qr', 'intent'] }],
              },
            },
            sequence: ['block.upi'],
            preferences: { show_default_blocks: false },
          },
        },
        handler: async (response) => {
          try {
            const result = await api.confirmUpgradeMandate({
              razorpayOrderId:   response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            toast.success(`Limit ${isDecrease ? 'reduced' : 'increased'} to ₹${effectiveLimit}/month`)
            onSuccess(result.newLimit || effectiveLimit)
          } catch (e) {
            if (e.data?.code === 'MANDATE_ALREADY_UPDATED') {
              // Another tab completed a mandate update simultaneously — treat as success
              // since the mandate is already in a valid state
              toast.info('Mandate already updated — please refresh to see the new limit')
              onClose()
            } else {
              toast.error(e.message)
            }
          }
          setBusy(false)
        },
        modal: {
          ondismiss: async () => {
            await api.cancelUpgradeMandate().catch(() => {})
            setBusy(false)
          },
        },
      })
      if (!document.getElementById('rzp-zoom-style')) {
        const s = document.createElement('style')
        s.id = 'rzp-zoom-style'
        s.textContent = '.razorpay-checkout-frame { zoom: 1.35 !important; }'
        document.head.appendChild(s)
      }
      rzp.open()
    } catch (e) {
      toast.error(e.message)
      setBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#EDEDFF' }}>Change Monthly Limit</div>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'none', border: 'none', color: '#7A7AAA', fontSize: 20,
                     cursor: busy ? 'not-allowed' : 'pointer', lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Current limit */}
        <div style={{ background: '#0D0D1E', border: '1px solid rgba(255,255,255,.06)',
                      borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: '#7A7AAA', marginBottom: 4 }}>Current limit</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#EDEDFF' }}>
            ₹{currentLimit}/month
            {currentGb !== null && (
              <span style={{ fontSize: 13, fontWeight: 400, color: '#7A7AAA', marginLeft: 8 }}>
                · {currentGb} GB capacity
              </span>
            )}
          </div>
        </div>

        <span style={label}>Select new limit</span>

        {/* Preset buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          {PRESETS.map(p => (
            <button key={p}
              onClick={() => { setSelected(p); setCustom('') }}
              style={{
                padding: '10px 4px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', textAlign: 'center',
                border: selected === p ? '1.5px solid #6366F1' : '1px solid rgba(255,255,255,.08)',
                background: selected === p ? 'rgba(99,102,241,0.15)' : '#161625',
                color: selected === p ? '#A5B4FC' : '#EDEDFF',
              }}>
              <div>₹{p}</div>
              <div style={{ fontSize: 10, color: '#7A7AAA', marginTop: 2 }}>{gbFromLimit(p)} GB</div>
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div style={{ marginBottom: 20 }}>
          <span style={label}>Custom amount (₹)</span>
          <input
            type="number" min={MIN_LIMIT} step="1" placeholder="e.g. 750"
            value={custom}
            onChange={e => { setCustom(e.target.value ? String(Math.floor(Number(e.target.value))) : ''); setSelected(null) }}
            style={input}
          />
        </div>

        {/* Live preview */}
        {effectiveLimit > 0 && (
          <div style={{ background: isDecrease ? 'rgba(245,158,11,0.08)' : 'rgba(99,102,241,0.08)',
                        border: `1px solid ${isDecrease ? 'rgba(245,158,11,0.25)' : 'rgba(99,102,241,0.25)'}`,
                        borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600,
                          color: isDecrease ? '#F59E0B' : '#A5B4FC', marginBottom: 4 }}>
              {isDecrease ? 'Reducing limit' : 'New limit'}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#EDEDFF' }}>
              ₹{effectiveLimit}/month · {newGb} GB capacity
            </div>
            {isDecrease && (
              <div style={{ fontSize: 12, color: '#F59E0B', marginTop: 6, lineHeight: 1.5 }}>
                Make sure your stored data fits within {newGb} GB before reducing.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: '11px 0', background: 'transparent',
                     border: '1px solid rgba(255,255,255,.08)', borderRadius: 10,
                     color: '#8888AA', fontSize: 14, fontWeight: 600,
                     cursor: busy ? 'not-allowed' : 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleProceed} disabled={busy || !effectiveLimit || isUnchanged}
            style={{ flex: 2, padding: '11px 0', background: '#6366F1', borderRadius: 10,
                     color: '#fff', fontSize: 14, fontWeight: 700, border: 'none',
                     cursor: (busy || !effectiveLimit || isUnchanged) ? 'not-allowed' : 'pointer',
                     opacity: (busy || !effectiveLimit || isUnchanged) ? 0.6 : 1 }}>
            {busy ? 'Opening payment…' : isDecrease ? 'Reduce Limit' : 'Increase Limit'}
          </button>
        </div>
      </div>
    </div>
  )
}
