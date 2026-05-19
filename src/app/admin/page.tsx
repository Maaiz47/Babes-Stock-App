'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Package,
  Users,
  Shield,
  Trash2,
  Key,
  Plus,
  ArrowLeft,
  Eye,
  EyeOff,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  is_admin: boolean;
  created_at: string;
}

interface CurrentUser {
  id: string;
  username: string;
  is_admin: boolean;
}

/* ─── Inline password reset form ─── */

function ResetPasswordInline({
  userId,
  onDone,
  onCancel,
}: {
  userId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to reset password.');
        return;
      }
      onDone();
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2">
      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          placeholder="New password (min 6 chars)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={{ fontSize: '16px' }}
          className="pr-10"
          required
          minLength={6}
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          tabIndex={-1}
        >
          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading} className="flex-1">
          {loading ? 'Saving…' : 'Set new password'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ─── Create user form ─── */

function CreateUserForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, isAdmin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to create user.');
        return;
      }
      onDone();
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Plus size={14} className="text-violet-400" />
        Create new user
      </h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">Username</label>
            <Input
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{ fontSize: '16px' }}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">Email</label>
            <Input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ fontSize: '16px' }}
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1.5 block">Password</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Initial password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ fontSize: '16px' }}
                className="pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className="w-4 h-4 rounded accent-violet-500"
              />
              <span className="text-xs font-medium text-gray-400">Admin user</span>
            </label>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? 'Creating…' : 'Create user'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ─── User card (mobile) ─── */

function UserCard({
  user,
  isSelf,
  resetingId,
  deleteConfirmId,
  deletingId,
  setResetingId,
  setDeleteConfirmId,
  onResetDone,
  onDelete,
}: {
  user: AdminUser;
  isSelf: boolean;
  resetingId: string | null;
  deleteConfirmId: string | null;
  deletingId: string | null;
  setResetingId: (id: string | null) => void;
  setDeleteConfirmId: (id: string | null) => void;
  onResetDone: () => void;
  onDelete: (id: string) => void;
}) {
  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="bg-white/4 border border-white/10 rounded-xl p-4 space-y-3">
      {/* User info */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center shrink-0">
          {user.is_admin ? <Shield size={15} className="text-violet-400" /> : <User size={15} className="text-gray-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-100">{user.username}</span>
            {isSelf && (
              <span className="text-[10px] bg-violet-500/15 text-violet-400 border border-violet-500/20 rounded-full px-1.5 py-0.5 leading-none">
                you
              </span>
            )}
            {user.is_admin && (
              <span className="inline-flex items-center gap-1 text-[10px] bg-violet-500/15 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5">
                <Shield size={9} /> Admin
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{user.email}</p>
          <p className="text-[10px] text-gray-600 mt-0.5">Joined {formatDate(user.created_at)}</p>
        </div>
      </div>

      {/* Reset password section */}
      {resetingId === user.id ? (
        <ResetPasswordInline
          userId={user.id}
          onDone={() => { setResetingId(null); onResetDone(); }}
          onCancel={() => setResetingId(null)}
        />
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => { setResetingId(user.id); setDeleteConfirmId(null); }}
          >
            <Key size={12} /> Reset password
          </Button>

          {deleteConfirmId === user.id ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Sure?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={deletingId === user.id}
                onClick={() => onDelete(user.id)}
              >
                {deletingId === user.id ? '…' : 'Yes'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(null)}>
                No
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              disabled={isSelf}
              title={isSelf ? "Can't delete your own account" : 'Delete user'}
              onClick={() => { setDeleteConfirmId(user.id); setResetingId(null); }}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main admin page ─── */

export default function AdminPage() {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [resetingId, setResetingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const data = await res.json();
      setCurrentUser(data.user ?? data);
    } catch { /* ignore */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    setFetchError('');
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!res.ok) { setFetchError(data.error ?? 'Failed to load users.'); return; }
      setUsers(data.users ?? data);
    } catch {
      setFetchError('Network error loading users.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
    fetchUsers();
  }, [fetchCurrentUser, fetchUsers]);

  const handleDelete = async (userId: string) => {
    setDeletingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error ?? 'Failed to delete user.');
        return;
      }
      setDeleteConfirmId(null);
      await fetchUsers();
    } catch {
      alert('Network error.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="min-h-screen bg-[#080810]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#080810]/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 transition-colors text-sm"
            >
              <ArrowLeft size={15} />
              <span>Back</span>
            </Link>
            <span className="text-white/20 select-none">|</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow shadow-violet-500/30">
                <Package size={14} className="text-white" />
              </div>
              <span className="text-base font-semibold text-white">Admin Panel</span>
            </div>
          </div>
          {currentUser && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Shield size={13} className="text-violet-400" />
              <span>{currentUser.username}</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-white">Users</h2>
            {!loadingUsers && (
              <span className="text-xs text-gray-500 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                {users.length}
              </span>
            )}
          </div>
          <Button size="sm" onClick={() => setShowCreateForm((v) => !v)}>
            <Plus size={14} />
            Create user
          </Button>
        </div>

        {/* Create user form */}
        {showCreateForm && (
          <CreateUserForm
            onDone={async () => { setShowCreateForm(false); await fetchUsers(); }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {/* Error */}
        {fetchError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            {fetchError}
          </p>
        )}

        {loadingUsers ? (
          <div className="flex items-center justify-center py-16">
            <span className="text-xs text-gray-500">Loading users…</span>
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center py-16">
            <span className="text-xs text-gray-500">No users found.</span>
          </div>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {users.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  isSelf={currentUser?.id === user.id}
                  resetingId={resetingId}
                  deleteConfirmId={deleteConfirmId}
                  deletingId={deletingId}
                  setResetingId={setResetingId}
                  setDeleteConfirmId={setDeleteConfirmId}
                  onResetDone={fetchUsers}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block bg-white/4 border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left text-xs font-medium text-gray-500 px-5 py-3">Username</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-5 py-3">Email</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-5 py-3">Admin</th>
                    <th className="text-left text-xs font-medium text-gray-500 px-5 py-3">Created</th>
                    <th className="text-right text-xs font-medium text-gray-500 px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.map((user) => {
                    const isSelf = currentUser?.id === user.id;
                    return (
                      <tr key={user.id} className="hover:bg-white/3 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-200 font-medium">{user.username}</span>
                            {isSelf && (
                              <span className="text-[10px] bg-violet-500/15 text-violet-400 border border-violet-500/20 rounded-full px-1.5 py-0.5 leading-none">
                                you
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-gray-400">{user.email}</td>
                        <td className="px-5 py-3.5">
                          {user.is_admin ? (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-violet-500/15 text-violet-400 border border-violet-500/20 rounded-full px-2 py-0.5">
                              <Shield size={10} /> Admin
                            </span>
                          ) : (
                            <span className="text-xs text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-gray-500 text-xs">{formatDate(user.created_at)}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {resetingId === user.id ? (
                              <ResetPasswordInline
                                userId={user.id}
                                onDone={async () => { setResetingId(null); await fetchUsers(); }}
                                onCancel={() => setResetingId(null)}
                              />
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setResetingId(user.id); setDeleteConfirmId(null); }}
                              >
                                <Key size={12} /> Reset password
                              </Button>
                            )}

                            {deleteConfirmId === user.id ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-gray-400">Sure?</span>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={deletingId === user.id}
                                  onClick={() => handleDelete(user.id)}
                                >
                                  {deletingId === user.id ? '…' : 'Delete'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isSelf}
                                title={isSelf ? "You can't delete your own account" : 'Delete user'}
                                onClick={() => { setDeleteConfirmId(user.id); setResetingId(null); }}
                              >
                                <Trash2 size={12} /> Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
