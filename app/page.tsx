import Studio from '@/components/Studio';
export default function Page() { return <Studio authConfigured={Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)} />; }
