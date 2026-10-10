import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { BrandMark } from '../components/BrandMark';
import { ThemeToggle } from '../components/ThemeToggle';
import { apiLogin, apiSignup, apiForgotPassword, AuthUser } from '../lib/api';
import { useDispatch } from '../state/store';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface PainPoint {
  id: number;
  tag: string;
  category: string;
  problem: string;
  solution: string;
  description: string;
  metric: string;
  icon: string;
}

const PAIN_POINTS: PainPoint[] = [
  {
    id: 1,
    tag: 'PAIN POINT 01 OF 07',
    category: 'GST Compliance & ITC Reconciliation',
    problem: 'The GSTR-2B vs Purchase Register Mismatch Nightmare',
    solution: 'AI-Powered Dual-Stream Reconciliation & Fraud Shield',
    description:
      'Cross-references thousands of purchase invoices with GSTN data in under 4 seconds. Instantly detects vendor invoice omissions, Section 17(5) blocked credits, and shields your clients from devastating Section 73 & 74 demand notices.',
    metric: '99.4% Match Accuracy • 18+ Hours Saved Monthly per Client',
    icon: 'shield',
  },
  {
    id: 2,
    tag: 'PAIN POINT 02 OF 07',
    category: 'Client Document Collection',
    problem: 'Endless WhatsApp & Email Document Chasing Chaos',
    solution: 'Autonomous 24/7 WhatsApp AI Bot & Vault Ingestion',
    description:
      'Clients snap bank statements, vendor bills, and Form 16 on WhatsApp. TaxFlow AI instantly extracts line items, verifies GSTIN checksums, and files them directly into your encrypted local client vault with zero staff intervention.',
    metric: 'Zero Lost Invoices • Instant WhatsApp Filing Receipts',
    icon: 'chat',
  },
  {
    id: 3,
    tag: 'PAIN POINT 03 OF 07',
    category: 'Accounting & ERP Automation',
    problem: 'Exhausting Manual Tally Re-entry & Clerical Typing Errors',
    solution: 'Direct One-Click Tally Prime & ERP XML Voucher Pipeline',
    description:
      'Eliminates tedious manual bookkeeping. Auto-maps extracted line items to your existing chart of accounts, verifies HSN/SAC tax rates, and pushes clean XML purchase vouchers in seconds with zero data entry errors.',
    metric: '100% Tax Accuracy • 1-Click Batch Voucher Export',
    icon: 'spark',
  },
  {
    id: 4,
    tag: 'PAIN POINT 04 OF 07',
    category: 'Direct Tax & Withholding',
    problem: 'Section 194Q & 206C TDS/TCS Cumulative Turnover Slip-ups',
    solution: 'Live ₹50L Threshold Monitor & Auto Form 26Q Schedules',
    description:
      'Never miss the ₹50 Lakh cumulative purchase threshold or 0.1% deduction triggers. TaxFlow AI monitors vendor turnover in real time and automatically prepares quarterly 26Q & 27EQ schedules with automated challan linking.',
    metric: '100% Threshold Compliance • Zero 201(1A) Interest Fines',
    icon: 'rupee',
  },
  {
    id: 5,
    tag: 'PAIN POINT 05 OF 07',
    category: 'Practice Workflow & Deadlines',
    problem: 'Missed Filing Deadlines & Crippling Late Fees',
    solution: 'Unified Master Compliance Kanban & Automated Escalation',
    description:
      'Track 200+ clients across GSTR-1, GSTR-3B, Advance Tax, and ROC filings on a high-visibility real-time Kanban board. Automatically dispatches polite WhatsApp nudges 7, 3, and 1 day prior to statutory cutoffs.',
    metric: 'Zero Late Filing Penalties • 100% On-Time Track Record',
    icon: 'cal',
  },
  {
    id: 6,
    tag: 'PAIN POINT 06 OF 07',
    category: 'Scrutiny & Audit Defense',
    problem: 'Scattered Audit Trails & Client Discrepancy Disputes',
    solution: 'Tamper-Evident Local Audit Logs & 1-Click Defense Dossiers',
    description:
      'Maintain an immutable, timestamped record of every client submission, invoice OCR scan, and calculation. Generates Section 148 / 142(1) scrutiny response drafts with pre-indexed documentary exhibits in 1 click.',
    metric: 'Instant Scrutiny Dossier • 100% Audit Readiness',
    icon: 'folder',
  },
  {
    id: 7,
    tag: 'PAIN POINT 07 OF 07',
    category: 'Practice Profitability & Cash Flow',
    problem: 'Unbilled Advisory Hours & Chronic Client Payment Delays',
    solution: 'Milestone-Linked Auto Invoicing & WhatsApp UPI Collect',
    description:
      'Automatically generates GST-compliant practice fee invoices the instant a return is filed. Sends automated WhatsApp reminders with dynamic UPI payment QR codes, slashing overdue receivables by 65%.',
    metric: '3x Faster Fee Realization • Automated Practice Invoicing',
    icon: 'users',
  },
];

export function AuthPage() {
  const dispatch = useDispatch();

  // Mode: Default is 'signup' as requested ("on right side it should show always first sign up tab card")
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');

  // Slide carousel state for left side
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Typewriter animation state
  const [typedProblem, setTypedProblem] = useState('');
  const [typedSolution, setTypedSolution] = useState('');
  const [typedDescription, setTypedDescription] = useState('');
  const [typingStage, setTypingStage] = useState<'problem' | 'solution' | 'desc' | 'waiting'>('problem');
  const [progressPercent, setProgressPercent] = useState(0);

  // Form states - Sign Up
  const [signupName, setSignupName] = useState('');
  const [signupFirm, setSignupFirm] = useState('');
  const [signupType, setSignupType] = useState('Chartered Accountant (CA)');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signupAgree, setSignupAgree] = useState(true);
  const [showSignupPass, setShowSignupPass] = useState(false);

  // Form states - Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showLoginPass, setShowLoginPass] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);

  // Rate Limiting & Cooldown state
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const failedAttemptsRef = useRef(0);

  const activePoint = PAIN_POINTS[currentSlide];

  // ─────────────────────────────────────────────────────────────
  // Typewriter Effect Logic for Left Showcase
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let isCancelled = false;
    setTypedProblem('');
    setTypedSolution('');
    setTypedDescription('');
    setTypingStage('problem');
    setProgressPercent(0);

    const problemText = activePoint.problem;
    const solutionText = activePoint.solution;
    const descText = activePoint.description;

    let pIdx = 0;
    let sIdx = 0;
    let dIdx = 0;

    // Type problem heading
    const pTimer = setInterval(() => {
      if (isCancelled) return;
      if (pIdx < problemText.length) {
        setTypedProblem(problemText.substring(0, pIdx + 1));
        pIdx++;
      } else {
        clearInterval(pTimer);
        setTypingStage('solution');

        // Delay before solution
        setTimeout(() => {
          if (isCancelled) return;
          const sTimer = setInterval(() => {
            if (isCancelled) return;
            if (sIdx < solutionText.length) {
              setTypedSolution(solutionText.substring(0, sIdx + 1));
              sIdx++;
            } else {
              clearInterval(sTimer);
              setTypingStage('desc');

              // Delay before description
              setTimeout(() => {
                if (isCancelled) return;
                const dTimer = setInterval(() => {
                  if (isCancelled) return;
                  if (dIdx < descText.length) {
                    setTypedDescription(descText.substring(0, dIdx + 1));
                    dIdx++;
                  } else {
                    clearInterval(dTimer);
                    setTypingStage('waiting');
                  }
                }, 16);
              }, 180);
            }
          }, 24);
        }, 180);
      }
    }, 28);

    return () => {
      isCancelled = true;
      clearInterval(pTimer);
    };
  }, [currentSlide, activePoint]);

  // ─────────────────────────────────────────────────────────────
  // 4.5s Dwell Countdown Bar & Next Slide Transition
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typingStage !== 'waiting' || isPaused) return;

    const totalDuration = 4500; // 4.5 seconds
    const intervalTime = 50;
    const step = (intervalTime / totalDuration) * 100;

    const barTimer = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev >= 100) {
          clearInterval(barTimer);
          // Advance to next slide smoothly
          setCurrentSlide((cur) => (cur + 1) % PAIN_POINTS.length);
          return 0;
        }
        return prev + step;
      });
    }, intervalTime);

    return () => clearInterval(barTimer);
  }, [typingStage, isPaused]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 9) score++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
    if (/[0-9]/.test(pass) || /[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: '#F87171' };
    if (score === 2) return { score: 2, label: 'Fair', color: '#F6C453' };
    if (score === 3) return { score: 3, label: 'Good', color: '#4C8DFF' };
    return { score: 4, label: 'Strong', color: '#34D399' };
  };

  const passStrength = getPasswordStrength(signupPassword);

  // ─────────────────────────────────────────────────────────────
  // Handle Signup Submission
  // ─────────────────────────────────────────────────────────────
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!signupName.trim()) {
      setErrorMessage('Please enter your full name or partner designation.');
      return;
    }
    if (!signupEmail.trim() || !signupEmail.includes('@')) {
      setErrorMessage('Please provide a valid work/practice email address.');
      return;
    }
    if (signupPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (signupPassword !== signupConfirm) {
      setErrorMessage('Passwords do not match. Please re-enter.');
      return;
    }
    if (!signupAgree) {
      setErrorMessage('Please accept the Data Confidentiality and Vault Privacy terms.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiSignup({
        name: signupName.trim(),
        firmName: signupFirm.trim() || `${signupName.trim()} & Associates`,
        email: signupEmail.trim(),
        password: signupPassword,
        practiceType: signupType,
      });

      if (res.success) {
        if (res.needsEmailConfirmation) {
          // Email confirmation required — show confirmation screen
          setSuccessMessage(
            '✅ Account created! A confirmation email has been sent to ' + signupEmail.trim() + '. Please check your inbox and click the link to activate your account, then come back to log in.'
          );
        } else if (res.user && res.token) {
          // Auto-confirmed — go straight in
          setSuccessMessage('Practice account created! Launching your workspace...');
          setTimeout(() => {
            dispatch({ type: 'LOGIN', user: res.user!, token: res.token!, refreshToken: res.refreshToken });
          }, 600);
        }
      } else {
        setErrorMessage(res.message || 'Signup failed. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during signup.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Handle Login Submission
  // ─────────────────────────────────────────────────────────────
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (lockoutSeconds > 0) {
      setErrorMessage(`Rate limit active. Please wait ${lockoutSeconds}s before attempting again.`);
      return;
    }

    if (!loginEmail.trim() || !loginEmail.includes('@')) {
      setErrorMessage('Please enter your registered work email.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Please enter your account password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiLogin(loginEmail.trim(), loginPassword);

      if (res.success && res.user && res.token) {
        failedAttemptsRef.current = 0;
        setSuccessMessage('Credentials verified. Launching workspace...');
        setTimeout(() => {
          dispatch({ type: 'LOGIN', user: res.user!, token: res.token!, refreshToken: res.refreshToken });
        }, 500);
      } else {
        if (res.rateLimited && res.secondsLeft) {
          setLockoutSeconds(res.secondsLeft);
          setErrorMessage(`Too many failed attempts. Security lockout active for ${res.secondsLeft} seconds.`);
        } else {
          failedAttemptsRef.current += 1;
          if (failedAttemptsRef.current >= 4) {
            setLockoutSeconds(30);
            setErrorMessage('Multiple failed attempts detected. Cooldown lock applied for 30s.');
          } else {
            setErrorMessage(res.message || 'Invalid email or password. Please try again.');
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error connecting to login service.');
    } finally {
      setIsLoading(false);
    }
  };

  // (Demo login removed — use your real Supabase account)

  // Fast Fill Signup Demo
  const handleFillDemoSignup = () => {
    setSignupName('CA Vikram Malhotra');
    setSignupFirm('Malhotra & Partners LLP');
    setSignupEmail('vikram@malhotratax.in');
    setSignupPassword('TaxFlow@2026');
    setSignupConfirm('TaxFlow@2026');
  };

  // Window Controls for Tauri
  const handleMinimize = async () => {
    try {
      const appWin = getCurrentWindow();
      await appWin.minimize();
    } catch (e) {}
  };
  const handleClose = async () => {
    try {
      const appWin = getCurrentWindow();
      await appWin.close();
    } catch (e) {}
  };

  return (
    <div className="auth-root">
      {/* Top bar with drag handle and app title */}
      <header className="auth-header">
        <div className="auth-brand" data-tauri-drag-region>
          <div className="auth-brand-badge">
            <BrandMark size={15} />
          </div>
          <span className="auth-brand-name">TaxFlow.AI</span>
          <span className="auth-brand-chip">Enterprise CA Edition</span>
        </div>

        <div className="auth-header-right">
          <ThemeToggle showLabel={true} />
          <div className="auth-wc-divider" />
          <div className="auth-window-ctrls">
            <button className="auth-wc-btn" onClick={handleMinimize} title="Minimize">
              <svg width="11" height="11" viewBox="0 0 12 12"><path fill="currentColor" d="M1 6h10v1H1z" /></svg>
            </button>
            <button className="auth-wc-btn auth-wc-close" onClick={handleClose} title="Close">
              <svg width="11" height="11" viewBox="0 0 12 12"><path fill="currentColor" d="M2.2 1.5 6 5.3l3.8-3.8.7.7L6.7 6l3.8 3.8-.7.7L6 6.7 2.2 10.5l-.7-.7L5.3 6 1.5 2.2z" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Two-Column Split Body */}
      <main className="auth-body">
        {/* ─── LEFT COLUMN: Top 7 Pain Points & AI Solutions Showcase ─── */}
        <section
          className="auth-showcase-panel"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {/* Subtle Ambient Glow Orbs */}
          <div className="auth-glow auth-glow-1" />
          <div className="auth-glow auth-glow-2" />

          <div className="auth-showcase-content">
            {/* Top Pill / Badge */}
            <div className="showcase-top-meta">
              <span className="showcase-tag-badge">
                <Icon name={activePoint.icon} size={14} />
                {activePoint.tag}
              </span>
              <span className="showcase-cat-pill">{activePoint.category}</span>
              {isPaused && <span className="showcase-paused-pill">Paused (Hover)</span>}
            </div>

            {/* Pain Point Heading with Typewriter Effect */}
            <div className="showcase-problem-block">
              <span className="showcase-section-kicker">PROBLEM SOLVED</span>
              <h2 className="showcase-heading">
                {typedProblem}
                {typingStage === 'problem' && <span className="typewriter-cursor">|</span>}
              </h2>
            </div>

            {/* AI Solution Card with Typewriter Effect */}
            <div className="showcase-solution-card">
              <div className="solution-card-header">
                <div className="solution-badge-icon">
                  <Icon name="spark" size={16} />
                </div>
                <div>
                  <span className="solution-kicker">TAXFLOW AI INTELLIGENT FIX</span>
                  <h3 className="solution-title">
                    {typedSolution}
                    {typingStage === 'solution' && <span className="typewriter-cursor">|</span>}
                  </h3>
                </div>
              </div>

              <p className="solution-description">
                {typedDescription}
                {typingStage === 'desc' && <span className="typewriter-cursor">|</span>}
              </p>

              {/* Verified Impact Metric */}
              <div className="solution-metric-row">
                <span className="metric-pill">
                  <Icon name="check" size={13} />
                  {activePoint.metric}
                </span>
              </div>
            </div>

            {/* Bottom Progress Bar & Navigation Controls */}
            <div className="showcase-footer-controls">
              {/* Animated Progress Timer Bar */}
              <div className="showcase-timer-track" title="Slide timer">
                <div
                  className="showcase-timer-bar"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="showcase-nav-row">
                {/* 7 Interactive Slide Dots */}
                <div className="showcase-dots">
                  {PAIN_POINTS.map((p, idx) => (
                    <button
                      key={p.id}
                      className={`showcase-dot ${idx === currentSlide ? 'active' : ''}`}
                      onClick={() => setCurrentSlide(idx)}
                      title={`Jump to Pain Point 0${idx + 1}: ${p.category}`}
                    >
                      <span className="dot-inner" />
                    </button>
                  ))}
                </div>

                <div className="showcase-arrows">
                  <span className="showcase-counter">
                    0{currentSlide + 1} <i>/</i> 0{PAIN_POINTS.length}
                  </span>
                  <button
                    className="showcase-arrow-btn"
                    onClick={() => setCurrentSlide((cur) => (cur - 1 + PAIN_POINTS.length) % PAIN_POINTS.length)}
                    title="Previous pain point"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 3.5 6 8l4.5 4.5-.7.7L5 8l4.8-5.2z" /></svg>
                  </button>
                  <button
                    className="showcase-arrow-btn"
                    onClick={() => setCurrentSlide((cur) => (cur + 1) % PAIN_POINTS.length)}
                    title="Next pain point"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="m5.5 3.5 4.5 4.5-4.5 4.5.7.7L11 8 6.2 2.8z" /></svg>
                  </button>
                </div>
              </div>

              {/* Compliance & Security Assurance Strip */}
              <div className="showcase-trust-strip">
                <div className="trust-item">
                  <Icon name="shield" size={13} />
                  <span>Local Vault AES-256 Storage</span>
                </div>
                <span className="trust-dot">•</span>
                <div className="trust-item">
                  <Icon name="lock" size={13} />
                  <span>Zero Cloud File Transmission</span>
                </div>
                <span className="trust-dot">•</span>
                <div className="trust-item">
                  <Icon name="check" size={13} />
                  <span>ICAI Ethical Standard Ready</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── RIGHT COLUMN: Sliding Sign Up & Login Cards ─── */}
        <section className="auth-form-panel">
          <div className="auth-card-container">
            {/* Top Mode Segmented Pill Switcher */}
            <div className="auth-mode-switcher">
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signup');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              >
                Create Account
              </button>
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
              >
                Sign In
              </button>
              <div
                className="auth-tab-slider"
                style={{
                  transform: authMode === 'signup' ? 'translateX(0%)' : 'translateX(100%)',
                }}
              />
            </div>

            {/* Error & Success Banner Alerts */}
            {errorMessage && (
              <div className="auth-alert auth-alert-error">
                <Icon name="alert" size={16} />
                <span>{errorMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="auth-alert auth-alert-success">
                <Icon name="check" size={16} />
                <span>{successMessage}</span>
              </div>
            )}
            {lockoutSeconds > 0 && (
              <div className="auth-alert auth-alert-warning">
                <Icon name="bell" size={16} />
                <span>Security cooldown in effect: {lockoutSeconds} seconds remaining.</span>
              </div>
            )}

            {/* Sliding Form Stage: Smooth Carousel between Signup and Login */}
            <div className="auth-slider-viewport">
              <div
                className="auth-slider-track"
                style={{
                  transform: authMode === 'signup' ? 'translateX(0%)' : 'translateX(-50%)',
                }}
              >
                {/* ────────── CARD 1: SIGN UP (Default) ────────── */}
                <div className="auth-form-card signup-card">
                  <div className="card-kicker-row">
                    <div>
                      <h1 className="card-title">Setup Practice Workspace</h1>
                      <p className="card-desc">
                        Register your CA firm to activate AI document extraction and WhatsApp client sync.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="demo-pill-btn"
                      onClick={handleFillDemoSignup}
                      title="Quick-fill sample firm credentials"
                    >
                      ⚡ Auto-fill Form
                    </button>
                  </div>

                  <form onSubmit={handleSignupSubmit} className="auth-fields-form">
                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label>Managing Partner Name *</label>
                        <div className="input-with-icon">
                          <Icon name="users" size={15} />
                          <input
                            type="text"
                            placeholder="CA Rajesh Sharma"
                            value={signupName}
                            onChange={(e) => setSignupName(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="field-group">
                        <label>CA Firm / Office Name</label>
                        <div className="input-with-icon">
                          <Icon name="folder" size={15} />
                          <input
                            type="text"
                            placeholder="Sharma & Associates"
                            value={signupFirm}
                            onChange={(e) => setSignupFirm(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="field-group">
                      <label>Practice Category</label>
                      <div className="practice-pills">
                        {['Chartered Accountant (CA)', 'Tax Consultant', 'Corporate Tax Team'].map((type) => (
                          <button
                            type="button"
                            key={type}
                            className={`practice-pill ${signupType === type ? 'active' : ''}`}
                            onClick={() => setSignupType(type)}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="field-group">
                      <label>Practice Email Address *</label>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <input
                          type="email"
                          placeholder="rajesh@sharmatax.in"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label>Create Password *</label>
                        <div className="input-with-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          <input
                            type={showSignupPass ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="input-eye-btn"
                            onClick={() => setShowSignupPass(!showSignupPass)}
                          >
                            {showSignupPass ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </div>

                      <div className="field-group">
                        <label>Confirm Password *</label>
                        <div className="input-with-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <input
                            type={showSignupPass ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={signupConfirm}
                            onChange={(e) => setSignupConfirm(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Password Strength Indicator */}
                    {signupPassword && (
                      <div className="pass-strength-meter">
                        <div className="strength-bars">
                          {[1, 2, 3, 4].map((level) => (
                            <div
                              key={level}
                              className="strength-bar-seg"
                              style={{
                                backgroundColor:
                                  passStrength.score >= level ? passStrength.color : 'var(--line2)',
                              }}
                            />
                          ))}
                        </div>
                        <span className="strength-text" style={{ color: passStrength.color }}>
                          Password Strength: {passStrength.label}
                        </span>
                      </div>
                    )}

                    <div className="auth-checkbox-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={signupAgree}
                          onChange={(e) => setSignupAgree(e.target.checked)}
                        />
                        <span>
                          I confirm local vault storage on this PC &amp; agree to firm confidentiality terms.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="auth-primary-btn"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <span className="btn-spinner">Provisioning Practice Workspace...</span>
                      ) : (
                        <span>Create Account &amp; Launch Practice →</span>
                      )}
                    </button>
                  </form>

                  <div className="card-footer-switch">
                    <span>Already have a TaxFlow practice account?</span>
                    <button
                      type="button"
                      className="inline-link-btn"
                      onClick={() => setAuthMode('login')}
                    >
                      Sign In to Workspace →
                    </button>
                  </div>
                </div>

                {/* ────────── CARD 2: LOGIN ────────── */}
                <div className="auth-form-card login-card">
                  <div className="card-kicker-row">
                    <div>
                      <h1 className="card-title">Welcome Back</h1>
                      <p className="card-desc">
                        Sign in to access your local client vaults, pending filings, and WhatsApp automations.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleLoginSubmit} className="auth-fields-form">
                    <div className="field-group">
                      <label>Registered Work Email</label>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <input
                          type="email"
                          placeholder="ca@taxflow.ai or your email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          disabled={lockoutSeconds > 0}
                          required
                        />
                      </div>
                    </div>

                    <div className="field-group">
                      <div className="field-label-split">
                        <label>Password</label>
                        <button
                          type="button"
                          className="forgot-link"
                          onClick={() => {
                            setForgotEmail(loginEmail || '');
                            setForgotModalOpen(true);
                          }}
                        >
                          Forgot Password?
                        </button>
                      </div>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <input
                          type={showLoginPass ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          disabled={lockoutSeconds > 0}
                          required
                        />
                        <button
                          type="button"
                          className="input-eye-btn"
                          onClick={() => setShowLoginPass(!showLoginPass)}
                        >
                          {showLoginPass ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>

                    <div className="auth-checkbox-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <span>Remember credentials on this local workstation</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="auth-primary-btn"
                      disabled={isLoading || lockoutSeconds > 0}
                    >
                      {isLoading ? (
                        <span className="btn-spinner">Authenticating...</span>
                      ) : lockoutSeconds > 0 ? (
                        <span>Locked for {lockoutSeconds}s</span>
                      ) : (
                        <span>Sign In to Practice Workspace →</span>
                      )}
                    </button>
                  </form>

                  {/* Fast Pass Demo Access Button */}


                  <div className="card-footer-switch">
                    <span>Need to register a new firm or practitioner?</span>
                    <button
                      type="button"
                      className="inline-link-btn"
                      onClick={() => setAuthMode('signup')}
                    >
                      Create Practice Account →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Forgot Password Modal */}
      {forgotModalOpen && (
        <div className="auth-modal-overlay">
          <div className="auth-modal-dialog">
            <div className="modal-header">
              <h3>Reset Practice Password</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setForgotModalOpen(false);
                  setForgotNotice(null);
                }}
              >
                ✕
              </button>
            </div>
            <p className="modal-desc">
              Enter your registered email address to receive secure password recovery instructions.
            </p>

            {forgotNotice ? (
              <div className="auth-alert auth-alert-success">
                <Icon name="check" size={15} />
                <span>{forgotNotice}</span>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!forgotEmail) return;
                  const res = await apiForgotPassword(forgotEmail);
                  setForgotNotice(res.message);
                }}
              >
                <div className="field-group" style={{ marginBottom: 14 }}>
                  <label>Practice Email</label>
                  <input
                    type="email"
                    className="modal-input"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="modal-btn-row">
                  <button
                    type="button"
                    className="btn-sec"
                    onClick={() => setForgotModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="auth-primary-btn" style={{ width: 'auto', padding: '0 18px' }}>
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
