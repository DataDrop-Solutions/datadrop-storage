import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { setTokenProvider } from './lib/api.js'
import { ToastProvider } from './components/Toast.jsx'

import Dashboard    from './pages/Dashboard.jsx'
import SignIn       from './pages/SignIn.jsx'
import SignUp       from './pages/SignUp.jsx'
import VerifyPhone  from './pages/VerifyPhone.jsx'
import InviteClaim, { SharedFile } from './pages/InviteClaim.jsx'
import { Terms, Privacy, RefundPolicy, Contact, Pricing } from './pages/Legal.jsx'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const API       = import.meta.env.VITE_API_URL || 'https://api.datadrop.co.in'

// Suppress all debug output in production builds
if (import.meta.env.PROD) {
  const noop = () => {}
  console.log   = noop
  console.debug = noop
  console.info  = noop
}

function AppRoutes() {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const { user } = useUser()
  const [phoneVerified, setPhoneVerified] = React.useState(null)

  React.useEffect(() => {
    setTokenProvider(() => getToken())
  }, [getToken])

  React.useEffect(() => {
    if (!isSignedIn || !isLoaded) return
    let cancelled = false
    getToken().then(token => {
      if (!token) { setPhoneVerified(true); return }
      return fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => {
          if (!cancelled) setPhoneVerified(true)
        })
        .catch(() => {
          if (!cancelled) setPhoneVerified(true)
        })
    })
    return () => { cancelled = true }
  }, [isSignedIn, isLoaded])

  if (!isLoaded || (isSignedIn && phoneVerified === null)) return <Loader />

  return (
    <Routes>
      <Route path="/sign-in/*"     element={<SignIn />} />
      <Route path="/sign-up/*"     element={<SignUp />} />
      <Route path="/invite/:token" element={<InviteClaim />} />
      <Route path="/shared/:id"    element={<SharedFile />} />
      <Route path="/terms"         element={<Terms />} />
      <Route path="/privacy"       element={<Privacy />} />
      <Route path="/refund-policy" element={<RefundPolicy />} />
      <Route path="/contact"       element={<Contact />} />
      <Route path="/pricing"       element={<Pricing />} />
      <Route path="/verify-phone"  element={
        isSignedIn ? <VerifyPhone onVerified={() => setPhoneVerified(true)} /> : <Navigate to="/sign-in" replace />
      } />
      <Route path="/*" element={
        !isSignedIn       ? <Navigate to="/sign-in" replace />
        : !phoneVerified  ? <Navigate to="/verify-phone" replace />
        : <Dashboard />
      } />
    </Routes>
  )
}

function Loader() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#08081A' }}>
      <div style={{ width:26, height:26, border:'2.5px solid rgba(255,255,255,.08)', borderTopColor:'#6366F1',
                    borderRadius:'50%', animation:'dd-spin 0.7s linear infinite' }} />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ClerkProvider publishableKey={CLERK_KEY} afterSignInUrl="/" afterSignUpUrl="/">
    <BrowserRouter>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </BrowserRouter>
  </ClerkProvider>
)
