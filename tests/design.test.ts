import { describe, it, expect } from 'vitest';
import { DesignSchema, recolor, reviewDesign } from '../shared/design';
import { exampleDesign } from '../shared/example';
import { geometryParts } from '../shared/geometry';
import { admission, limits } from '../shared/budget';
import { execFileSync } from 'node:child_process';
describe('canonical design', () => {
  it('validates the sample and enforces the floor/space boundary', () => {
    expect(DesignSchema.safeParse(exampleDesign()).success).toBe(true);
    expect(DesignSchema.safeParse({ ...exampleDesign(), floors: 5 }).success).toBe(false);
    expect(DesignSchema.safeParse({ ...exampleDesign(), spaces: Array.from({length:41},(_,i)=>({...exampleDesign().spaces[0],id:`space${i}`})) }).success).toBe(false);
  });
  it('recolors one element without changing architecture, shared materials, or furniture', () => {
    const before = exampleDesign(), after = recolor(before, 'front-left', '#cc3344');
    expect(after.spaces).toEqual(before.spaces);
    expect(after.elements.filter(e=>e.id!=='front-left')).toEqual(before.elements.filter(e=>e.id!=='front-left'));
    expect(after.materials.find(m=>m.id==='exterior')).toEqual(before.materials.find(m=>m.id==='exterior'));
    expect(after.materials.find(m=>m.id==='custom_front-left')?.color).toBe('#cc3344');
    expect(before.elements.find(e=>e.id==='front-left')?.materialId).toBe('exterior');
  });
  it('rejects invalid references, duplicate IDs and unknown steering targets', () => {
    const design = exampleDesign(); design.elements[0].materialId='missing';
    expect(DesignSchema.safeParse(design).success).toBe(false);
    const duplicate=exampleDesign(); duplicate.elements.push(duplicate.elements[0]);
    expect(DesignSchema.safeParse(duplicate).success).toBe(false);
    expect(()=>recolor(exampleDesign(),'missing','#ff0000')).toThrow();
    expect(()=>recolor(exampleDesign(),'roof','javascript:alert(1)')).toThrow();
    const asset=exampleDesign(); asset.elements[0].assetId='unknown-asset';expect(DesignSchema.safeParse(asset).success).toBe(false);
  });
  it('builds stair parts with bounded rises and exact total height', () => {
    const e={...exampleDesign().elements[0],kind:'stair' as const,size:[1.5,3,5] as [number,number,number]};
    const parts=geometryParts(e); expect(parts.length).toBe(17); expect(parts.at(-1)?.size[1]).toBe(3);
    expect(parts[0].size[1]).toBeLessThanOrEqual(.18);
  });
  it('flags multi-floor designs with no stair connection', () => { expect(reviewDesign({...exampleDesign(),floors:2})).toContain('Multiple floors need a connected staircase.'); });
  it('compiles the same stairs and curated furniture in Python and the browser',()=>{
    const elements=[...exampleDesign().elements,{...exampleDesign().elements[0],kind:'stair' as const,size:[1.5,3,5] as [number,number,number]}];
    const output=execFileSync(process.platform==='win32'?'python':'python3',['-c',"import json,sys; from scripts.blender_compile import parts; print(json.dumps([parts(e) for e in json.load(sys.stdin)]))"],{input:JSON.stringify(elements),encoding:'utf8'});
    const python=JSON.parse(output);
    elements.forEach((e,i)=>geometryParts(e).forEach((p,j)=>{p.position.forEach((v,k)=>expect(v).toBeCloseTo(python[i][j][0][k],10));p.size.forEach((v,k)=>expect(v).toBeCloseTo(python[i][j][1][k],10));}));
  });
});
describe('compute admission', () => {
  it('queues when both computers are in use',()=>expect(admission({active:2,dailySeconds:0,monthlySeconds:0},900)).toBe('queue'));
  it('rejects daily, monthly and dollar overspend before allocating',()=>{
    expect(admission({active:0,dailySeconds:3000,monthlySeconds:0},900)).toMatch(/daily/);
    expect(admission({active:0,dailySeconds:0,monthlySeconds:limits.globalMonthlySeconds},900)).toMatch(/monthly/);
    expect(admission({active:0,dailySeconds:0,monthlySeconds:0},901)).toMatch(/Invalid/);
  });
  it('admits a bounded reservation',()=>expect(admission({active:1,dailySeconds:0,monthlySeconds:0},900)).toBeNull());
});
