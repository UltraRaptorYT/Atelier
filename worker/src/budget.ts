import { DurableObject } from 'cloudflare:workers';
import { Sandbox } from '@e2b/desktop';
import type { Bindings } from './types';
import { admission, limits } from '../../shared/budget';
type Lease = { id: string; owner: string; expires: number; sandbox: string | null; idle_since: number; busy: number; released: number };
export class ComputeBudget extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, owner TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL, seconds INTEGER NOT NULL, expires INTEGER NOT NULL, sandbox TEXT, idle_since INTEGER NOT NULL, busy INTEGER NOT NULL DEFAULT 1, released INTEGER NOT NULL DEFAULT 0)');
  }
  async reserve(id: string, owner: string, seconds = limits.leaseSeconds): Promise<{ allowed: boolean; reason?: string }> {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7);
    const previous = this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE id = ?', id).toArray()[0];
    if (previous) return previous.expires > now && !previous.released ? { allowed: true } : { allowed: false, reason: 'This computer reservation has expired.' };
    const active = this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM leases WHERE released = 0 AND expires > ?', now).one().n;
    const dailySeconds = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(seconds),0) AS n FROM leases WHERE owner = ? AND day = ?', owner, day).one().n;
    const monthlySeconds = this.ctx.storage.sql.exec<{ n: number }>('SELECT COALESCE(SUM(seconds),0) AS n FROM leases WHERE month = ?', month).one().n;
    const reason = admission({ active, dailySeconds, monthlySeconds }, seconds);
    if (reason) return { allowed: false, reason };
    this.ctx.storage.sql.exec('INSERT INTO leases(id,owner,day,month,seconds,expires,idle_since) VALUES(?,?,?,?,?,?,?)', id, owner, day, month, seconds, now + seconds * 1000, now);
    await this.ctx.storage.setAlarm(now + 60000);
    return { allowed: true };
  }
  attach(id: string, sandbox: string) { this.ctx.storage.sql.exec('UPDATE leases SET sandbox = ?, expires = ? + seconds * 1000 WHERE id = ? AND released = 0', sandbox, Date.now(), id); }
  touch(id: string, busy: boolean) { this.ctx.storage.sql.exec('UPDATE leases SET idle_since = ?, busy = ? WHERE id = ? AND released = 0', Date.now(), busy ? 1 : 0, id); }
  async release(id: string) {
    const row = this.ctx.storage.sql.exec<Lease>('SELECT * FROM leases WHERE id = ?', id).toArray()[0];
    if (!row || row.released) return;
    if (row.sandbox && this.env.E2B_API_KEY) {
      try { await Sandbox.kill(row.sandbox, { apiKey: this.env.E2B_API_KEY }); }
      catch { if (row.expires > Date.now()) { await this.ctx.storage.setAlarm(Date.now()+60000); return false; } }
    } else if (row.sandbox && row.expires > Date.now()) return false;
    this.ctx.storage.sql.exec('UPDATE leases SET released = 1 WHERE id = ?', id);
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
