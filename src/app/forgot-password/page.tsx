'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080810] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white/4 border border-white/10 rounded-2xl p-8 space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto shadow-lg shadow-violet-500/30">
            <Package size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Babes Stock</h1>
          <p className="text-xs text-gray-500">Reset your password</p>
        </div>

        {submitted ? (
          /* Success state */
          <div className="space-y-4 text-center">
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-5">
              <p className="text-sm font-medium text-violet-300">Check your email</p>
              <p className="text-xs text-gray-400 mt-1">
                We sent a password reset link to{' '}
                <span className="text-gray-200">{email}</span>.
              </p>
            </div>
            <Link
              href="/login"
              className="block text-xs text-violet-400 hover:text-violet-300 transition-colors"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Enter the email address associated with your account and we&apos;ll send you a link
                to reset your password.
              </p>

              <div>
                <label className="text-xs font-medium text-gray-400 mb-1.5 block">
                  Email address
                </label>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              {error && (
                <p className="text-xs text-red-400 mt-1">{error}</p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>

            <p className="text-center text-xs text-gray-500">
              Remember your password?{' '}
              <Link href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
