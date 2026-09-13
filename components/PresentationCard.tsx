import { ArrowRight, Footprints } from 'lucide-react';
import type { Snapshot } from '@/shared/design';
import styles from './PresentationCard.module.css';

export default function PresentationCard({ snapshot, onEnter }: { snapshot: Snapshot | null; onEnter: () => void }) {
  return <section className={styles.card} aria-label="Presentation room">
    <span className="section-label">PRESENTATION ROOM</span>
    <h3>{snapshot?.design?.title || 'Your design will be exhibited here.'}</h3>
    {snapshot?.design ? <>
      <p>Saved revision {snapshot.project.revision} · {snapshot.project.status === 'ready' ? 'Critic review complete' : snapshot.project.status === 'review' ? 'Review remains open' : 'Work in progress'}</p>
      <p>Enter the full-size building from this exhibit. Saved updates will follow you inside.</p>
      <button type="button" className="button full" onClick={onEnter}><Footprints size={16} />Walk inside saved design<ArrowRight size={15} /></button>
    </> : <p>The first saved building will appear on the table. Start your project brief to create it.</p>}
  </section>;
}
