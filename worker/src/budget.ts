import { DurableObject } from 'cloudflare:workers';
import { Sandbox } from '@e2b/desktop';
import type { Bindings } from './types';
import { admission, limits } from '../../shared/budget';
type Lease = { id: string; owner: string; seconds: number; expires: number; sandbox: string | null; idle_since: number; busy: number; released: number; started_at: number | null };
export class ComputeBudget extends DurableObject<Bindings> {
  private releases = new Map<string, Promise<boolean>>();
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, seconds INTEGER NOT NULL, expires INTEGER NOT NULL, sandbox TEXT, idle_since INTEGER NOT NULL, busy INTEGER NOT NULL DEFAULT 1, released INTEGER NOT NULL DEFAULT 0)');
    const columns = this.ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(leases)').toArray();
    // Legacy leases retain their full charge: their actual start time is unknown.
    if (!columns.some(column => column.name === 'started_at')) this.ctx.storage.sql.exec('ALTER TABLE leases ADD COLUMN started_at INTEGER');
  }
  async reserve(id: string, owner: string, seconds = limits.leaseSeconds): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
    const previous = this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE id = ?', id).toArray()[0];
    if (previous) {
      if (previous.owner !== owner) return { allowed: false, reason: 'This computer reservation belongs to another owner.' };
      if (previous.released || previous.expires <= now) return { allowed: false, reason: 'This computer reservation has expired.' };
      if (previous.seconds !== seconds) return { allowed: false, reason: 'This computer reservation has a different allowance.' };
      return { allowed: true };
    }
    const active = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM leases WHERE released = 0 AND expires > ?', now).one().n;
    const dailySeconds = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(seconds),0) AS n FROM leases WHERE owner = ? AND day = ?', owner, day).one().n;
    const monthlySeconds = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(seconds),0) AS n FROM leases WHERE month = ?', month).one().n;
    const reason = admission({ active, dailySeconds, monthlySeconds }, seconds);
    if (reason) return { allowed: false, reason };
    this.ctx.storage.sql.exec('INSERT INTO leases(id,owner,day,month,seconds,expires,idle_since,started_at) VALUES(?,?,?,?,?,?,?,?)', id, owner, day, month, seconds, now + seconds * 1000, now, now);
    await this.ctx.storage.setAlarm(now + 60000);
    return { allowed: true };
  }
  attach(id: string, sandbox: string): boolean {
    const row = this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE id = ?', id).toArray()[0];
    if (!row || row.released || row.expires <= Date.now() || (row.sandbox && row.sandbox !== sandbox)) return false;
    if (!row.sandbox) this.ctx.storage.sql.exec('UPDATE leases SET sandbox = ?, expires = ? + seconds * 1000 WHERE id = ?', sandbox, Date.now(), id);
    return true;
  }
  touch(id: string, busy: boolean) { this.ctx.storage.sql.exec('UPDATE leases SET idle_since = ?, busy = ? WHERE id = ? AND released = 0', Date.now(), busy ? 1 : 0, id); }
  async release(id: string, knownSandbox?: string): Promise<boolean> {
    const pending = this.releases.get(id);
    if (pending) return pending;
    const operation = this.finishRelease(id, knownSandbox);
    this.releases.set(id, operation);
    try { return await operation; } finally { this.releases.delete(id); }
  }
  private async finishRelease(id: string, knownSandbox?: string): Promise<boolean> {
    const row = this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE id = ?', id).toArray()[0];
    if (!row || row.released) return true;
    if (knownSandbox && row.sandbox && row.sandbox !== knownSandbox) return false;
    // A createDesktop caller can recover a failed/ambiguous attach without
    // refunding the reservation while its newly-created machine is still alive.
    if (knownSandbox && !row.sandbox) {
      row.sandbox = knownSandbox;
      row.expires = Math.max(row.expires, Date.now() + row.seconds * 1000);
      this.ctx.storage.sql.exec('UPDATE leases SET sandbox = ?, expires = ? WHERE id = ?', row.sandbox, row.expires, id);
    }
    if (row.sandbox && row.expires > Date.now()) {
      try {
        if (!this.env.E2B_API_KEY) throw new Error('Remote computers are not configured.');
        // The SDK returns false only for a confirmed 404 (already gone).
        await Sandbox.kill(row.sandbox, { apiKey: this.env.E2B_API_KEY });
      } catch {
        if (row.expires > Date.now()) {
          // Release was explicitly requested. Keep the charge and slot, but
          // make the next alarm retry shutdown instead of waiting for expiry.
          this.ctx.storage.sql.exec('UPDATE leases SET busy = 0, idle_since = ? WHERE id = ? AND released = 0', Date.now() - 120001, id);
          await this.ctx.storage.setAlarm(Date.now() + 60000);
          return false;
        }
      }
    }
    const elapsed = Math.ceil(Math.max(0, Date.now() - (row.started_at ?? Date.now())) / 1000);
    // An unattached lease explicitly returned after failed allocation costs
    // nothing. An abandoned one that reaches expiry has uncertain execution
    // history (for example, an unavailable attach RPC), so retain its bound.
    const charged = row.started_at === null ? row.seconds : row.sandbox ? Math.min(row.seconds, elapsed) : row.expires <= Date.now() ? row.seconds : 0;
    this.ctx.storage.sql.exec('UPDATE leases SET released = 1, busy = 0, seconds = ? WHERE id = ? AND released = 0', charged, id);
    return true;
  }
  async alarm() {
    const now = Date.now();
    for (const lease of this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE released = 0').toArray()) {
      if (lease.expires <= now || (!lease.busy && now - lease.idle_since > 120000)) await this.release(lease.id);
    }
    const active = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) as n FROM leases WHERE released = 0').one().n;
    if (active) await this.ctx.storage.setAlarm(now + 60000);
  }
}
