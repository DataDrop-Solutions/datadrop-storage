import React from 'react'
import { SignUp as ClerkSignUp } from '@clerk/clerk-react'
import { useSearchParams } from 'react-router-dom'

export default function SignUp() {
  const [searchParams] = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column',
                   alignItems:'center', justifyContent:'center',
                   background:'#07070D', padding:20 }}>

      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <svg width={26} height={26} viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="7" fill="#5B5EF4"/>
          <path d="M11 4h6v10h4l-7 8-7-8h4z" fill="white"/>
        </svg>
        <span style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:800,
                        letterSpacing:'-0.04em', lineHeight:1 }}>
          <span style={{ color:'#EEEEF8' }}>Data</span><span style={{ color:'#5B5EF4' }}>Drop</span>
        </span>
      </div>

      <div style={{ fontSize:13, color:'#8888AA', marginBottom:28 }}>
        7 days free · 5 GB · No card required
      </div>

      <ClerkSignUp
        path="/sign-up"
        routing="path"
        signInUrl={`/sign-in${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}
        forceRedirectUrl={redirect}
        appearance={{
          variables: {
            colorBackground:       '#0F0F1A',
            colorInputBackground:  '#161625',
            colorInputText:        '#EEEEF8',
            colorText:             '#EEEEF8',
            colorTextSecondary:    '#8888AA',
            colorPrimary:          '#5B5EF4',
            colorDanger:           '#E24B4A',
            borderRadius:          '10px',
            fontFamily:            'Inter, sans-serif',
          },
          elements: {
            card: {
              boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
              border: '1px solid #1E1E32',
              borderRadius: '16px',
              background: '#0F0F1A',
            },
            headerTitle:    { display: 'none' },
            headerSubtitle: { display: 'none' },
            socialButtonsBlockButton: {
              background: '#161625',
              border: '1px solid #252540',
              color: '#EEEEF8',
              borderRadius: '9px',
            },
            socialButtonsBlockButtonText: {
              color: '#EEEEF8',
              fontWeight: 500,
            },
          }
        }}
      />
    </div>
  )
}
