'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Mail, KeyRound, CheckCircle2, Eye, EyeOff, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionUser { userId: string; username: string; email: string; isAdmin: boolean; }

type EmailStep = 'idle' | 'entering' | 'verifying' | 'done';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  // Email change state
  const [emailStep, setEmailStep] = useState<EmailStep>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [changedEmail, setChangedEmail] = useState('');

  // Password change state
  const [showPwForm, setShowPwForm] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => setUser(d.user));
  }, []);

  const requestEmailChange = async () => {
    setEmailError('');
    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/change-email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail }),
      });
      const json = await res.json();
      if (!res.ok) { setEmailError(json.error); return; }
      setEmailStep('verifying');
    } catch {
      setEmailError('Something went wrong');
    } finally {
      setEmailLoading(false);
    }
  };

  const verifyCode = async () => {
    setEmailError('');
    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/change-email/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) { setEmailError(json.error); return; }
      setChangedEmail(json.newEmail);
      setEmailStep('done');
      setUser(u => u ? { ...u, email: json.newEmail } : u);
    } catch {
      setEmailError('Something went wrong');
    } finally {
      setEmailLoading(false);
    }
  };

  const changePassword = async () => {
    setPwError('');
    if (newPw !== confirmPw) { setPwError('Passwords do not match'); return; }
    if (newPw.length < 6) { setPwError('Password must be at least 6 characters'); return; }
    setPwLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const json = await res.json();
      if (!res.ok) { setPwError(json.error); return; }
      setPwSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setTimeout(() => { setPwSuccess(false); setShowPwForm(false); }, 2000);
    } catch {
      setPwError('Something went wrong');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810]">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#080810]/80 backdrop-blur-xl">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={() => router.push('/')} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/8 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Package size={13} className="text-white" />
            </div>
            <span className="font-semibold text-white">Account Settings</span>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 sm:px-6 py-8 space-y-4">
        {user && (
          <div className="bg-white/4 border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-violet-300 font-bold text-sm">
              {user.username[0].toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{user.username}</p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
          </div>
        )}

        {/* Change Email */}
        <div className="bg-white/4 border border-white/10 rounded-xl overflow-hidden">
          <button
            onClick={() => { if (emailStep === 'idle') setEmailStep('entering'); }}
            className="w-full flex items-center gap-3 px-4 py-4 hover:bg-white/4 transition-colors text-left"
          >
            <Mail size={16} className="text-violet-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Email address</p>
              <p className="text-xs text-gray-500 mt-0.5">{user?.email ?? '…'}</p>
            </div>
            {emailStep === 'idle' && <span className="text-xs text-violet-400">Change</span>}
          </button>

          {emailStep === 'entering' && (
            <div className="border-t border-white/8 px-4 py-4 space-y-3">
              <p className="text-xs text-gray-400">Enter your new email. We'll send a 6-digit verification code to confirm it.</p>
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">New email address</label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="new@example.com"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && requestEmailChange()}
                />
              </div>
              {emailError && <p className="text-xs text-red-400">{emailError}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEmailStep('idle'); setNewEmail(''); setEmailError(''); }}>Cancel</Button>
                <Button size="sm" onClick={requestEmailChange} disabled={emailLoading || !newEmail.includes('@')}>
                  {emailLoading ? 'Sending…' : 'Send code'}
                </Button>
              </div>
            </div>
          )}

          {emailStep === 'verifying' && (
            <div className="border-t border-white/8 px-4 py-4 space-y-3">
              <p className="text-xs text-gray-400">
                A 6-digit code was sent to <strong className="text-white">{newEmail}</strong>. Enter it below — expires in 15 minutes.
              </p>
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Verification code</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  autoFocus
                  className="text-center text-xl font-mono tracking-widest"
                  onKeyDown={e => e.key === 'Enter' && code.length === 6 && verifyCode()}
                />
              </div>
              {emailError && <p className="text-xs text-red-400">{emailError}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEmailStep('entering'); setCode(''); setEmailError(''); }}>
                  Back
                </Button>
                <Button size="sm" onClick={verifyCode} disabled={emailLoading || code.length !== 6}>
                  {emailLoading ? 'Verifying…' : 'Confirm'}
                </Button>
              </div>
              <button
                onClick={() => { setEmailStep('entering'); setCode(''); setEmailError(''); }}
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                Resend code
              </button>
            </div>
          )}

          {emailStep === 'done' && (
            <div className="border-t border-white/8 px-4 py-3 flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle2 size={15} />
              Email updated to {changedEmail}
            </div>
          )}
        </div>

        {/* Change Password */}
        <div className="bg-white/4 border border-white/10 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowPwForm(p => !p)}
            className="w-full flex items-center gap-3 px-4 py-4 hover:bg-white/4 transition-colors text-left"
          >
            <KeyRound size={16} className="text-violet-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Password</p>
              <p className="text-xs text-gray-500 mt-0.5">Change your password</p>
            </div>
            <span className="text-xs text-violet-400">{showPwForm ? 'Cancel' : 'Change'}</span>
          </button>

          {showPwForm && (
            <div className="border-t border-white/8 px-4 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Current password</label>
                <div className="relative">
                  <Input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Current password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">New password</label>
                <div className="relative">
                  <Input
                    type={showNew ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">Confirm new password</label>
                <Input
                  type="password"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                  onKeyDown={e => e.key === 'Enter' && changePassword()}
                />
              </div>
              {pwError && <p className="text-xs text-red-400">{pwError}</p>}
              {pwSuccess && (
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={13} /> Password updated
                </p>
              )}
              <Button className="w-full" onClick={changePassword} disabled={pwLoading || !currentPw || !newPw || !confirmPw}>
                {pwLoading ? 'Updating…' : 'Update password'}
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
