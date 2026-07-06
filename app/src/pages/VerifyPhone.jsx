import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser, useAuth } from '@clerk/clerk-react'
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth'
import { auth } from '../firebase'

const API = import.meta.env.VITE_API_URL || 'https://api.datadrop.co.in'

export default function VerifyPhone({ onVerified }) {
  const { user, isLoaded } = useUser()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState('phone') // phone | otp | done
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [resendTimer, setResendTimer] = useState(0)
  const confirmationRef = useRef(null)
  const recaptchaRef = useRef(null)

  useEffect(() => {
    if (!isLoaded || !user) return
    checkAlreadyVerified()
  }, [isLoaded, user])

  useEffect(() => {
    if (resendTimer <= 0) return
    const t = setInterval(() => setResendTimer(s => s - 1), 1000)
    return () => clearInterval(t)
  }, [resendTimer])

  async function checkAlreadyVerified() {
    try {
      const token = await getToken()
      const res = await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (data.user?.trial_phone_verified) navigate('/', { replace: true })
    } catch {}
  }

  function getRecaptcha() {
    if (recaptchaRef.current) {
      try { recaptchaRef.current.clear() } catch {}
      recaptchaRef.current = null
    }
    const container = document.getElementById('recaptcha-container')
    if (container) container.innerHTML = ''
    recaptchaRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' })
    return recaptchaRef.current
  }

  async function handleSendOTP(e) {
    e?.preventDefault()
    setError(null)
    if (phone.length !== 10) { setError('Enter a valid 10-digit number'); return }
    setLoading(true)
    try {
      const appVerifier = getRecaptcha()
      const result = await signInWithPhoneNumber(auth, `+91${phone}`, appVerifier)
      confirmationRef.current = result
      setStep('otp')
      setResendTimer(30)
    } catch (err) {
      console.error('[Firebase OTP send]', err)
      setError(err.message || 'Failed to send OTP. Please try again.')
      // Reset reCAPTCHA so next attempt works
      if (recaptchaRef.current) {
        recaptchaRef.current.clear()
        recaptchaRef.current = null
      }
    } finally { setLoading(false) }
  }

  async function handleVerifyOTP(e) {
    e?.preventDefault()
    setError(null)
    if (otp.length < 4) { setError('Enter the OTP'); return }
    setLoading(true)
    try {
      const result = await confirmationRef.current.confirm(otp)
      const idToken = await result.user.getIdToken()

      const token = await getToken()
      const res = await fetch(`${API}/user/otp/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Verification failed. Please try again.'); return }
      setStep('done')
      setTimeout(() => { onVerified?.(); navigate('/', { replace: true }) }, 1500)
    } catch (err) {
      console.error('[Firebase OTP verify]', err)
      if (err.code === 'auth/invalid-verification-code') {
        setError('Incorrect OTP. Please try again.')
      } else if (err.code === 'auth/code-expired') {
        setError('OTP expired. Please request a new one.')
        setStep('phone')
      } else {
        setError(err.message || 'Verification failed. Please try again.')
      }
    } finally { setLoading(false) }
  }

  const PAGE = {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#f9fafb', padding: 20,
  }
  const CARD = { maxWidth: 400, width: '100%', textAlign: 'center' }
  const INPUT_BASE = {
    padding: '12px 14px', border: '1px solid #d1d5db', borderRadius: 8,
    fontSize: 16, outline: 'none', boxSizing: 'border-box', marginBottom: 12,
    fontFamily: 'inherit',
  }
  const BTN = {
    width: '100%', background: '#111', color: '#fff', border: 'none',
    borderRadius: 8, padding: '13px 0', fontWeight: 600, fontSize: 15,
    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
    fontFamily: 'inherit',
  }

  return (
    <div style={PAGE}>
      <div id="recaptcha-container" />
      <div style={CARD}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 }}>
          DataDrop
        </div>

        {step === 'phone' && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '32px 0 8px' }}>
              Verify your phone number
            </h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 28, lineHeight: 1.7 }}>
              One-time verification to activate your free trial.<br />
              Your number is never shared or used for marketing.
            </p>
            <form onSubmit={handleSendOTP}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <span style={{
                  ...INPUT_BASE, marginBottom: 0, flexShrink: 0,
                  background: '#f3f4f6', color: '#374151',
                  display: 'flex', alignItems: 'center', whiteSpace: 'nowrap',
                }}>
                  🇮🇳 +91
                </span>
                <input
                  style={{ ...INPUT_BASE, flex: 1, marginBottom: 0 }}
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  maxLength={10}
                  autoFocus
                  autoComplete="tel-national"
                />
              </div>
              {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px', textAlign: 'left' }}>{error}</p>}
              <button style={BTN} type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Send OTP →'}
              </button>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <div style={{ fontSize: 40, margin: '32px 0 16px' }}>📱</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
              Enter the OTP
            </h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 28, lineHeight: 1.7 }}>
              A 6-digit code was sent to +91 {phone}
            </p>
            <form onSubmit={handleVerifyOTP}>
              <input
                style={{ ...INPUT_BASE, width: '100%', letterSpacing: 10, fontSize: 24, textAlign: 'center' }}
                type="tel"
                placeholder="• • • • • •"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
              />
              {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px', textAlign: 'left' }}>{error}</p>}
              <button style={BTN} type="submit" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify →'}
              </button>
            </form>
            <div style={{ marginTop: 16, fontSize: 13, color: '#6b7280' }}>
              {resendTimer > 0
                ? `Resend OTP in ${resendTimer}s`
                : (
                  <span
                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => { setStep('phone'); setOtp(''); setError(null) }}
                  >
                    Change number or resend
                  </span>
                )
              }
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div style={{ fontSize: 48, margin: '32px 0 16px' }}>✓</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Phone verified!</h2>
            <p style={{ fontSize: 14, color: '#6b7280' }}>
              Your 7-day free trial is now active. Redirecting…
            </p>
          </>
        )}
      </div>
    </div>
  )
}
