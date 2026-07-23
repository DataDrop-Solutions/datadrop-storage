import React from 'react'
import { useNavigate } from 'react-router-dom'

const S = {
  bg:      '#08081A',
  bg2:     '#0D0D22',
  bg3:     '#111130',
  border:  'rgba(255,255,255,.07)',
  indigo:  '#6366F1',
  cyan:    '#00D4FF',
  textP:   '#EDEDFF',
  textS:   '#8888AA',
  textT:   '#7A7AAA',
}

function Logo() {
  const nav = useNavigate()
  return (
    <div onClick={() => nav('/')} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', userSelect:'none' }}>
      <svg width={22} height={22} viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="7" fill="#6366F1"/>
        <path d="M11 4h6v10h4l-7 8-7-8h4z" fill="white"/>
      </svg>
      <span style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:800, letterSpacing:'-0.04em' }}>
        <span style={{ color:S.textP }}>Data</span><span style={{ color:'#5B5EF4' }}>Drop</span>
      </span>
    </div>
  )
}

function LegalShell({ title, lastUpdated, children }) {
  return (
    <div style={{ background:S.bg, minHeight:'100vh', fontFamily:"'Inter',sans-serif", color:S.textP }}>
      {/* Header */}
      <div style={{ background:S.bg2, borderBottom:`1px solid ${S.border}`, padding:'16px 24px',
                    display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:10 }}>
        <Logo />
        <a href="https://datadrop.co.in" style={{ fontSize:13, color:S.textS, textDecoration:'none',
                  transition:'color .15s' }}
           onMouseEnter={e=>e.target.style.color=S.textP}
           onMouseLeave={e=>e.target.style.color=S.textS}>
          datadrop.co.in
        </a>
      </div>

      {/* Content */}
      <div style={{ maxWidth:760, margin:'0 auto', padding:'48px 24px 80px' }}>
        <div style={{ fontSize:12, color:S.textT, marginBottom:8 }}>Last updated: {lastUpdated}</div>
        <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:28, fontWeight:700,
                     color:S.textP, marginBottom:32, letterSpacing:'-0.02em' }}>{title}</h1>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:32 }}>
      <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:17, fontWeight:700,
                   color:S.textP, marginBottom:12, letterSpacing:'-0.01em' }}>{title}</h2>
      <div style={{ fontSize:14, lineHeight:1.75, color:S.textS }}>{children}</div>
    </div>
  )
}

function P({ children }) {
  return <p style={{ marginBottom:12 }}>{children}</p>
}

function Li({ children }) {
  return <li style={{ marginBottom:6, marginLeft:18 }}>{children}</li>
}

function Hl({ children }) {
  return <span style={{ color:S.textP, fontWeight:500 }}>{children}</span>
}

// ── Terms of Service ─────────────────────────────────────────────────────────
export function Terms() {
  return (
    <LegalShell title="Terms of Service" lastUpdated="1 July 2026">
      <Section title="Acceptance">
        <P>By creating an account or using DataDrop ("Service", "we", "us"), you agree to these Terms. If you do not agree, do not use the Service. These Terms are governed by the laws of India.</P>
      </Section>
      <Section title="Eligibility">
        <P>You must be at least 18 years old and capable of forming a legally binding contract under Indian law. By using the Service you represent that you meet these requirements.</P>
      </Section>
      <Section title="Your Account">
        <P>You are responsible for maintaining the confidentiality of your login credentials. You are responsible for all activity that occurs under your account. Notify us immediately if you suspect unauthorised access.</P>
      </Section>
      <Section title="Acceptable Use">
        <P>You agree NOT to:</P>
        <ul style={{ marginBottom:12 }}>
          <Li>Upload content that is illegal under Indian law or applicable international law.</Li>
          <Li>Upload, store, or share child sexual abuse material (CSAM) or any content that exploits minors. Violations will be reported to the appropriate authorities immediately.</Li>
          <Li>Distribute malware, ransomware, or other harmful software.</Li>
          <Li>Use the Service to infringe any third-party intellectual property rights.</Li>
          <Li>Attempt to reverse-engineer, bypass, or tamper with our security systems.</Li>
          <Li>Use automated bots or scripts to abuse the Service or its APIs.</Li>
        </ul>
        <P>We reserve the right to suspend or terminate accounts that violate these rules, without prior notice.</P>
      </Section>
      <Section title="Storage and Billing">
        <P>DataDrop uses <Hl>post-paid, usage-based billing</Hl>. Storage is charged by the second at a flat rate of ₹1.49 per GB per month. At the end of each calendar month, the total amount is collected via UPI AutoPay, never exceeding your configured monthly spending limit. If AutoPay collection fails, your account moves to read-only until the balance is resolved.</P>
        <P>Your 15-day free trial provides 5 GB of storage at no cost. No payment method is required to start a trial.</P>
      </Section>
      <Section title="Zero Knowledge Vault">
        <P>Files stored in the Zero Knowledge Vault are encrypted on your device before upload using keys derived from your PIN. DataDrop cannot access, read, or recover Vault files. <Hl>If you lose your PIN and recovery phrase, your Vault files are permanently unrecoverable.</Hl> We accept no liability for loss of Vault data resulting from lost credentials.</P>
      </Section>
      <Section title="No Public Links">
        <P>DataDrop does not provide public file links. File sharing is restricted to registered, verified users only. This is a core product principle and cannot be waived.</P>
      </Section>
      <Section title="Data and Privacy">
        <P>We handle your data as described in our Privacy Policy. You retain ownership of your uploaded files. By uploading, you grant us a limited licence to store and serve your files solely to provide the Service.</P>
      </Section>
      <Section title="Termination">
        <P>You may delete your account at any time from Settings. Upon deletion, all your files are permanently erased within 30 days. We may suspend or terminate your account for violations of these Terms.</P>
      </Section>
      <Section title="Disclaimer and Limitation of Liability">
        <P>The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, DataDrop's total liability for any claim related to the Service is limited to the amount you paid us in the 3 months preceding the claim.</P>
      </Section>
      <Section title="Changes to Terms">
        <P>We may update these Terms from time to time. We will notify you via email or in-app notice. Continued use after notice constitutes acceptance of the revised Terms.</P>
      </Section>
      <Section title="Contact">
        <P>Questions about these Terms? Email us at <Hl>support@datadrop.co.in</Hl>.</P>
      </Section>
    </LegalShell>
  )
}

// ── Privacy Policy ───────────────────────────────────────────────────────────
export function Privacy() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated="1 July 2026">
      <Section title="Overview">
        <P>DataDrop ("we", "us") is committed to protecting your privacy. This policy explains what data we collect, how we use it, and your rights regarding it. We are based in India and this policy is subject to the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.</P>
      </Section>
      <Section title="Data We Collect">
        <P><Hl>Account data:</Hl> email address, display name, phone number (for verification), and Clerk authentication tokens. Account management is handled by Clerk — see Clerk's privacy policy for details of their data handling.</P>
        <P><Hl>File metadata:</Hl> file names, sizes, upload timestamps, folder structure, and sharing records. This metadata is stored in our database to provide the Service.</P>
        <P><Hl>File content:</Hl> your uploaded files are stored in private cloud storage. Regular files are stored in standard encrypted storage. Vault files are end-to-end encrypted on your device before upload — we hold only ciphertext and cannot read Vault content.</P>
        <P><Hl>Usage data:</Hl> storage consumed, billing transactions, and service events (e.g. login timestamps) for billing accuracy and security monitoring.</P>
      </Section>
      <Section title="How We Use Your Data">
        <ul style={{ marginBottom:12 }}>
          <Li>To provide the file storage and sharing service.</Li>
          <Li>To calculate storage charges and collect payment via UPI AutoPay at the end of each billing period.</Li>
          <Li>To send essential transactional emails (billing alerts, security notices).</Li>
          <Li>To investigate abuse reports and enforce our Terms of Service.</Li>
        </ul>
        <P>We do not sell, rent, or share your personal data with third parties for marketing purposes.</P>
      </Section>
      <Section title="Data Sharing">
        <P>We share data with the following categories of service providers solely to operate the Service:</P>
        <ul style={{ marginBottom:12 }}>
          <Li><Hl>Authentication:</Hl> Clerk (identity management, login, session tokens)</Li>
          <Li><Hl>Object storage:</Hl> private cloud storage providers (files are stored in private buckets — no public access)</Li>
          <Li><Hl>Database:</Hl> Cloudflare D1 (metadata)</Li>
          <Li><Hl>Email:</Hl> transactional email provider for billing and security notices</Li>
        </ul>
        <P>We do not name specific vendors in user-facing responses. We may disclose data if required by Indian law or court order.</P>
      </Section>
      <Section title="Zero Knowledge Vault">
        <P>Vault files are encrypted using keys that never leave your device. We store only the resulting ciphertext. We cannot access, decrypt, or recover Vault content. Vault files are never included in any admin review, even in response to abuse reports.</P>
      </Section>
      <Section title="Data Retention">
        <P>Your files and account data are retained while your account is active. When you delete a file it is queued for permanent erasure within 30 days. When you delete your account, all associated data is permanently erased within 30 days.</P>
      </Section>
      <Section title="Security">
        <P>All data is transmitted over HTTPS/TLS. File storage uses private buckets with no public URL access. All API endpoints require JWT authentication. We do not log file contents or Vault keys.</P>
      </Section>
      <Section title="Your Rights">
        <P>Under Indian data protection law and our own policy, you have the right to access, correct, and delete your personal data. You can manage most data from Settings. For other requests, email <Hl>privacy@datadrop.co.in</Hl>.</P>
      </Section>
      <Section title="Contact">
        <P>Data protection queries: <Hl>privacy@datadrop.co.in</Hl>. General support: <Hl>support@datadrop.co.in</Hl>.</P>
      </Section>
    </LegalShell>
  )
}

// ── Refund Policy ────────────────────────────────────────────────────────────
export function RefundPolicy() {
  return (
    <LegalShell title="Refund Policy" lastUpdated="10 July 2026">
      <Section title="How Billing Works">
        <P>DataDrop uses <Hl>post-paid, usage-based billing</Hl>. You are charged only for the storage you actually keep, measured by the second at ₹1.49 per GB per month. At the end of each month, the total is collected via UPI AutoPay, never exceeding your monthly spending limit.</P>
      </Section>
      <Section title="Non-Refundable Charges">
        <P><Hl>Consumed storage charges</Hl> are non-refundable. Because you have real-time control over what you store and can delete any file at any moment to stop billing, completed charges are treated as accurate and final.</P>
        <P>The 15-day free trial is provided at no cost — there is nothing to refund for trial usage.</P>
      </Section>
      <Section title="Exceptions — When We Do Issue Refunds">
        <P>We will issue a full refund or credit in the following circumstances:</P>
        <ul style={{ marginBottom:12 }}>
          <Li><Hl>Billing error:</Hl> You were charged an amount that does not match your actual byte-second usage records. Contact us and we will investigate and correct any discrepancy.</Li>
          <Li><Hl>Charge exceeded spending limit:</Hl> If you were charged more than your configured spending limit due to a system error, we will refund the excess in full.</Li>
          <Li><Hl>Verified service outage:</Hl> If DataDrop experienced an outage of more than 24 continuous hours that prevented you from accessing or deleting files, you may request a pro-rata credit for the affected period.</Li>
          <Li><Hl>Duplicate charge:</Hl> If UPI AutoPay collected the same amount twice in the same billing period, we will refund the duplicate.</Li>
        </ul>
        <P>Refunds, where applicable, are processed to your original UPI payment method within 7–10 business days.</P>
      </Section>
      <Section title="Payment Failure">
        <P>If your UPI AutoPay collection fails at the end of a billing period, your account moves to read-only. Your files remain accessible for download. You have <Hl>35 days</Hl> to resolve the payment before permanent deletion of all data. You will receive email reminders at 7, 21, and 30 days.</P>
      </Section>
      <Section title="Ad-Free Plan">
        <P>Ad-Free access (purchased separately) is non-refundable once activated, as access is granted immediately upon purchase.</P>
      </Section>
      <Section title="Disputes">
        <P>If you believe you have been incorrectly charged, contact <Hl>billing@datadrop.co.in</Hl> before raising a chargeback with your bank. We resolve billing disputes promptly and chargebacks may result in account suspension.</P>
      </Section>
    </LegalShell>
  )
}

// ── Contact ──────────────────────────────────────────────────────────────────
export function Contact() {
  const [form, setForm] = React.useState({ name:'', email:'', subject:'', message:'' })
  const [sent, setSent] = React.useState(false)
  const [err, setErr] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const inp = {
    width:'100%', padding:'10px 14px', background:'#161625', border:`1px solid ${S.border}`,
    borderRadius:10, color:S.textP, fontSize:14, fontFamily:"'Inter',sans-serif", outline:'none',
    marginBottom:12,
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!form.name || !form.email || !form.message) { setErr('Please fill in all required fields.'); return }
    setLoading(true)
    try {
      const r = await fetch('https://api.datadrop.co.in/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error()
      setSent(true)
    } catch {
      setErr('Could not send your message. Please email us directly at support@datadrop.co.in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <LegalShell title="Contact Us" lastUpdated="1 July 2026">
      <Section title="Get in Touch">
        <P>We typically respond within one business day.</P>
        <P><Hl>General support:</Hl> support@datadrop.co.in</P>
        <P><Hl>Billing queries:</Hl> billing@datadrop.co.in</P>
        <P><Hl>Privacy / data requests:</Hl> privacy@datadrop.co.in</P>
        <P><Hl>Abuse / legal notices:</Hl> legal@datadrop.co.in</P>
      </Section>

      <Section title="Send a Message">
        {sent ? (
          <div style={{ background:'rgba(0,194,124,.1)', border:`1px solid rgba(0,194,124,.25)`,
                        borderRadius:10, padding:'14px 18px', color:'#00C27C', fontSize:14 }}>
            Message sent. We will reply to your email within one business day.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input style={inp} placeholder="Your name *" value={form.name}
                   onChange={e=>setForm(p=>({...p,name:e.target.value}))} />
            <input style={inp} type="email" placeholder="Your email *" value={form.email}
                   onChange={e=>setForm(p=>({...p,email:e.target.value}))} />
            <input style={inp} placeholder="Subject" value={form.subject}
                   onChange={e=>setForm(p=>({...p,subject:e.target.value}))} />
            <textarea style={{...inp, minHeight:120, resize:'vertical'}} placeholder="Message *" value={form.message}
                      onChange={e=>setForm(p=>({...p,message:e.target.value}))} />
            {err && <div style={{ color:S.red, fontSize:13, marginBottom:12 }}>{err}</div>}
            <button type="submit" disabled={loading}
                    style={{ padding:'10px 24px', background:S.indigo, color:'#fff', border:'none',
                             borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer',
                             fontFamily:"'Inter',sans-serif", opacity:loading?.6:1 }}>
              {loading ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        )}
      </Section>
    </LegalShell>
  )
}

// ── Pricing ──────────────────────────────────────────────────────────────────
export function Pricing() {
  const card = {
    background:S.bg3, border:`1px solid ${S.border}`, borderRadius:16, padding:28, marginBottom:16,
  }

  return (
    <LegalShell title="Pricing" lastUpdated="10 July 2026">
      <Section title="Simple, Pay-What-You-Use Storage">
        <P>No subscriptions. No monthly commitments. Set a spending limit and pay only for the storage you actually use, charged by the second.</P>
      </Section>

      <div style={card}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:700,
                      color:S.textP, marginBottom:6 }}>Free Trial</div>
        <div style={{ fontSize:13, color:S.textS, marginBottom:16 }}>15 days · 5 GB · No card required</div>
        <ul style={{ fontSize:14, color:S.textS, lineHeight:1.8 }}>
          <Li>5 GB total storage</Li>
          <Li>File sharing (registered users only)</Li>
          <Li>Zero Knowledge Vault</Li>
          <Li>Zero Knowledge Workspaces (coming soon)</Li>
          <Li>Version history</Li>
        </ul>
      </div>

      <div style={{...card, border:`1px solid rgba(99,102,241,.35)`, background:'rgba(99,102,241,.05)'}}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22, fontWeight:700,
                      color:S.textP, marginBottom:6 }}>Pay As You Go</div>
        <div style={{ fontSize:13, color:S.textS, marginBottom:16 }}>After trial · ₹1.49 per GB per month · Set your monthly limit</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:20 }}>
          {[
            ['10 GB',  '₹14.90',  '/month'],
            ['50 GB',  '₹74.50',  '/month'],
            ['100 GB', '₹149.00', '/month'],
            ['500 GB', '₹745.00', '/month'],
          ].map(([size, price, per]) => (
            <div key={size} style={{ background:S.bg2, border:`1px solid ${S.border}`,
                                     borderRadius:10, padding:14 }}>
              <div style={{ fontSize:13, color:S.textS, marginBottom:4 }}>{size}</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:700,
                            color:S.textP }}>{price}<span style={{ fontSize:12, color:S.textT, fontWeight:400 }}>{per}</span></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize:12, color:S.textT, lineHeight:1.7 }}>
          Charged by the second at ₹1.49 per GB per month. Billed monthly via UPI AutoPay. When you delete a file, billing stops immediately.
        </div>
      </div>

      <div style={card}>
        <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:18, fontWeight:700,
                      color:S.textP, marginBottom:6 }}>Ad-Free</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:24, fontWeight:700,
                      color:'#00C27C', marginBottom:10 }}>₹29 <span style={{ fontSize:14, color:S.textT, fontWeight:400 }}>/ 30 days</span></div>
        <P>Remove all non-intrusive ads from the DataDrop interface for 30 days. One-time purchase, activates immediately.</P>
      </div>

      <Section title="What's Always Free">
        <ul style={{ fontSize:14, color:S.textS, lineHeight:1.8 }}>
          <Li>Downloading and previewing your files</Li>
          <Li>File sharing to other DataDrop users</Li>
          <Li>Account and security features</Li>
          <Li>Customer support</Li>
        </ul>
      </Section>

      <Section title="UPI AutoPay">
        <P>After your trial, set a monthly spending limit and authorise UPI AutoPay. At the end of each month, the exact amount owed (never more than your limit) is collected automatically. Payments are processed via Razorpay and are subject to applicable GST.</P>
      </Section>

      <div style={{ marginTop:24, textAlign:'center' }}>
        <a href="https://app.datadrop.co.in/sign-up"
           style={{ display:'inline-block', padding:'12px 28px', background:S.indigo, color:'#fff',
                    borderRadius:10, fontSize:14, fontWeight:600, textDecoration:'none' }}>
          Start free trial
        </a>
      </div>
    </LegalShell>
  )
}
