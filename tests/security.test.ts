import { describe, it, expect } from 'vitest';
import { encryptCredential, decryptCredential, bodyJSON } from '../worker/src/security';
const keys={KEY_ENCRYPTION_KEYS:JSON.stringify({v1:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')}),KEY_VERSION:'v1'};
describe('credential protection',()=>{
  it('encrypts with random IVs and binds the ciphertext to its owner',async()=>{
    const a=await encryptCredential(keys,'owner-a','private-test-key'), b=await encryptCredential(keys,'owner-a','private-test-key');
    expect(a).not.toBe(b);expect(a).not.toContain('private-test-key');
    expect(await decryptCredential(keys,'owner-a',a)).toBe('private-test-key');
    await expect(decryptCredential(keys,'owner-b',a)).rejects.toThrow();
  });
  it('fails closed without an encryption key',async()=>{await expect(encryptCredential({KEY_VERSION:'v1'},'owner','test')).rejects.toThrow(/not configured/);});
  it('bounds bodies even when Content-Length is absent',async()=>{await expect(bodyJSON(new Request('https://test',{method:'POST',body:JSON.stringify({long:'x'.repeat(100)})}),32)).rejects.toThrow(/too large/);});
});
