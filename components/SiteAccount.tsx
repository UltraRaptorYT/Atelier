'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';

export default function SiteAccount() {
  const [session, setSession] = useState<{ signedIn: boolean; email: string | null } | null>(null);
  useEffect(() => { void api<{ signedIn: boolean; email: string | null }>('/session').then(setSession).catch(() => setSession({ signedIn: false, email: null })); }, []);
  if (session?.signedIn) return <><span className="profile-avatar" title={session.email || 'Signed in'}>{session.email?.[0].toUpperCase() || 'A'}</span><a className="button subtle" href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a></>;
  return <a className="button subtle" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a>;
}
