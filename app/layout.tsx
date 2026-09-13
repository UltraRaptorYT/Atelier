import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
export const metadata: Metadata = { title: 'Atelier — Your architecture studio', description: 'Step inside your AI architecture studio. Brief, collaborate, and explore.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = <html lang="en"><body>{children}</body></html>;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{content}</ClerkProvider> : content;
}
