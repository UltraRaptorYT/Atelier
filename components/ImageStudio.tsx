'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, ImagePlus, Maximize2, Square, X } from 'lucide-react';
import { api } from '@/lib/client';
import type { ImageStudy, StudioRun } from '@/shared/images';

type Props = {
  projectId: string;
  revision: number;
  hasDesign: boolean;
  selectedConceptId: string | null;
  images: ImageStudy[];
  runs: StudioRun[];
  imageEnabled: boolean;
  generationEnabled: boolean;
  captureView: () => string | null;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
};
type Source = 'brief' | 'view' | 'image';
type StatusNotice = { message: string; runId?: string };

function modelLabel(model: string) {
  if (model.startsWith('gpt-image-2.5-flare')) return 'GPT Image 2.5 · Flare';
  if (model.startsWith('gpt-image-2.5-sunburst')) return 'GPT Image 2.5 · Sunburst';
  return model;
}

export default function ImageStudio({ projectId, revision, hasDesign, selectedConceptId, images, runs, imageEnabled, generationEnabled, captureView, onRefresh, onError }: Props) {
  const [source, setSource] = useState<Source>('brief');
  const [sourceId, setSourceId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusNotice | null>(null);
  const [preview, setPreview] = useState<ImageStudy | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const actionPending = useRef(false);
  const sectionId = useId(), previewId = useId();
  const currentImages = images.filter(image => image.revision === revision);
  const editImage = currentImages.find(image => image.id === sourceId) || currentImages.find(image => image.id === selectedConceptId) || currentImages[0];
  const activeRuns = runs.filter(run => ['queued', 'in_progress'].includes(run.status));
  const imageRuns = activeRuns.filter(run => run.kind === 'image');
  const lastImageRun = runs.find(run => run.kind === 'image');
  const statusMessage = status && (!status.runId || runs.some(run => run.id === status.runId && run.status === 'queued')) ? status.message : '';
  const canGenerate = imageEnabled && !busy && !activeRuns.length && (source !== 'view' || hasDesign) && (source !== 'image' || Boolean(editImage));
  const artifactURL = (id: string) => `/api/studio/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(id)}?inline=1`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (preview && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [preview]);

  async function action(work: () => Promise<string | StatusNotice>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setStatus(null);
    try {
      const result = await work();
      setStatus(typeof result === 'string' ? { message: result } : result);
      await onRefresh().catch(() => onError('Your request was saved, but the panel could not refresh. Reopen the project to see its progress.'));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The image request could not be completed.');
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  async function generate() {
    if (!canGenerate || instruction.trim().length < 2) return;
    await action(async () => {
      let sourceArtifactId: string | null = null;
      if (source === 'view') {
        const dataUrl = captureView();
        if (!dataUrl) throw new Error('Open the current model and position its camera before editing a view.');
        const capture = await api<{ artifactId: string }>(`/projects/${projectId}/captures`, 'POST', { operationId: crypto.randomUUID(), baseRevision: revision, dataUrl });
        sourceArtifactId = capture.artifactId;
      } else if (source === 'image') {
        if (!editImage) throw new Error('Choose an image from the current design revision.');
        sourceArtifactId = editImage.id;
      }
      const { runId } = await api<{ runId: string }>(`/projects/${projectId}/images`, 'POST', { operationId: crypto.randomUUID(), baseRevision: revision, instruction: instruction.trim(), sourceArtifactId });
      return { runId, message: 'Your designer’s image study is queued. The result will appear here.' };
    });
  }

  async function useDirection(image: ImageStudy) {
    if (image.revision !== revision) return;
    await action(async () => {
      await api(`/projects/${projectId}/concept`, 'PUT', { operationId: crypto.randomUUID(), baseRevision: revision, artifactId: image.id, apply: hasDesign });
      return hasDesign ? 'Direction saved. Follow the model update in Activity.' : 'Direction saved for your team’s first design.';
    });
  }

  return <section className="image-studio" aria-labelledby={sectionId}>
    <header className="image-studio-heading"><div><span className="section-label">DESIGNER’S BOARD</span><h3 id={sectionId}>Visual concepts</h3></div><ImagePlus size={21} aria-hidden="true" /></header>
    <p className="image-studio-description">Concepts are saved as references; your walkthrough changes when the architect updates the 3D design.</p>
    <form onSubmit={event => { event.preventDefault(); void generate(); }}>
      <label>Start from<select value={source} onChange={event => setSource(event.target.value as Source)} disabled={busy || !imageEnabled}>
        <option value="brief">Concept from brief</option>
        <option value="view" disabled={!hasDesign}>Edit current model view</option>
        <option value="image" disabled={!currentImages.length}>Edit a generated image</option>
      </select></label>
      {source === 'image' && <label>Reference image<select value={editImage?.id || ''} onChange={event => setSourceId(event.target.value)} disabled={busy || !currentImages.length}>
        {!currentImages.length && <option value="">Generate a current concept first</option>}
        {currentImages.map((image, index) => <option key={image.id} value={image.id}>{index + 1}. {image.name}</option>)}
      </select></label>}
      {source === 'view' && <p className="image-studio-hint">Open the current model and frame your view before generating. This captures the visible view, including cutaway.</p>}
      <label>Creative direction<textarea value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={source === 'brief' ? 'Explore a playful courtyard home with warm red accents…' : 'Try a red exterior; preserve the building shape and camera…'} rows={3} minLength={2} maxLength={2000} required disabled={busy || !imageEnabled} /></label>
      <button className="button full" type="submit" disabled={!canGenerate || instruction.trim().length < 2}><ImagePlus size={15} />{busy ? 'Saving request…' : source === 'brief' ? 'Generate concept' : 'Generate image edit'}</button>
      {!imageEnabled && <p className="image-studio-hint">Image generation is unavailable for this studio connection. Check your connection in Settings.</p>}
    </form>
    <div className="image-studio-status" role="status">{statusMessage}</div>
    {!imageRuns.length && lastImageRun?.status === 'failed' && <p className="image-studio-hint" role="status">The last image study failed. Check Activity for details, then try again.</p>}
    {imageRuns.map(run => <div className="image-studio-run" key={run.id}><span><span className="status-dot" />{run.status === 'queued' ? 'Image study queued' : 'Designer is generating an image'}</span><button className="text-button" disabled={busy} onClick={() => void action(async () => { await api(`/projects/${projectId}/runs/${run.id}`, 'DELETE'); return 'Image work cancelled. Saved studies remain available.'; })}><Square size={11} />Cancel</button></div>)}
    {images.length > 0 && <div className="image-studio-gallery">{images.map((image, index) => {
      const stale = image.revision !== revision, selected = image.id === selectedConceptId;
      return <article className={`image-study${selected ? ' selected' : ''}`} key={image.id}>
        <button className="image-study-preview" onClick={() => setPreview(image)} aria-label={`Preview concept ${index + 1}: ${image.name}`}><img src={artifactURL(image.id)} alt={image.name} loading="lazy" /><span><Maximize2 size={13} />View image</span></button>
        <div className="image-study-info"><div className="image-study-title"><strong>{image.name}</strong>{selected && <span className="image-study-selected"><Check size={12} />Selected</span>}</div><p>{modelLabel(image.model)} · Rev {image.revision}</p>
          {stale && <p className="image-study-stale">Earlier design · regenerate to apply or edit</p>}
          <button className="button subtle full" disabled={busy || stale || (selected && !hasDesign) || activeRuns.length > 0 || (hasDesign && !generationEnabled)} onClick={() => void useDirection(image)}>{selected && hasDesign && !stale ? <>Apply selected direction<ArrowRight size={14} /></> : selected ? <><Check size={14} />Direction saved</> : <>Use this direction<ArrowRight size={14} /></>}</button>
          {!stale && !selected && hasDesign && !generationEnabled && <p className="image-studio-hint">Enable design generation to apply this direction to the model.</p>}
        </div>
      </article>;
    })}</div>}
    <dialog ref={dialogRef} className="image-studio-lightbox" aria-labelledby={previewId} onClose={() => setPreview(null)} onKeyDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}>
      {preview && <><header><div><h3 id={previewId}>{preview.name}</h3><p>{modelLabel(preview.model)} · Source revision {preview.revision}</p></div><button className="icon-button" aria-label="Close image preview" onClick={() => dialogRef.current?.close()} autoFocus><X size={21} /></button></header><img src={artifactURL(preview.id)} alt={preview.name} /><p className="image-studio-lightbox-prompt">{preview.prompt}</p><a className="text-button" href={artifactURL(preview.id)} target="_blank" rel="noreferrer">Open full image<ArrowRight size={14} /></a></>}
    </dialog>
  </section>;
}
