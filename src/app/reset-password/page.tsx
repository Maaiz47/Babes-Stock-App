'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Package, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Reset failed. The link may have expired.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-5">
          <p className="text-sm font-medium text-emerald-300">Password updated</p>
          <p className="text-xs text-gray-400 mt-1">
            Your password has been reset successfully.
          </p>
        </div>
        <Link
          href="/login"
          className="block text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!token && (
        <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          Missing or invalid reset token. Please use the link from your email.
        </p>
      )}

      <div>
        <label className="text-xs font-medium text-gray-400 mb-1.5 block">
          New password
        </label>
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter new password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-400 mb-1.5 block">
          Confirm new password
        </label>
        <div className="relative">
          <Input
            type={showConfirm ? 'text' : 'password'}
            placeholder="Repeat new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className="pr-10"
            required
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
            tabIndex={-1}
            aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
          >
            {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}

      <Button type="submit" className="w-full" disabled={loading || !token}>
        {loading ? 'Resetting…' : 'Reset password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white/4 border border-white/10 rounded-2xl p-8 space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-violet-500/30">
            <Package size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Babes Stock</h1>
          <p className="text-xs text-gray-500">Set a new password</p>
        </div>

        <Suspense
          fallback={
            <div className="h-32 flex items-center justify-center">
              <span className="text-xs text-gray-500">Loading…</span>
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>

        <p className="text-center text-xs text-gray-500">
          <Link href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
