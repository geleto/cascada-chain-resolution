import assert from 'node:assert/strict';
import * as r from '../../src/index.js';
import { OrderedThenable, ChainedThenable, ready } from '../../test/ordered-thenable.js';
import { verifyRefCounts } from '../../test/verify-refcounts.js';
const permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const signal = mode => mode==='native'?Promise.withResolvers():mode==='chained'?new ChainedThenable():new OrderedThenable();
const flush=async n=>{for(let i=0;i<n;i++)await Promise.resolve()};
let cases=0;
async function records(mode,indexed,observe,order,split,retire) {
 const ctx={execution:new r.Execution(),errorContext:'record'}; const sig=[signal(mode),signal(mode),signal(mode)];
 const input=sig.map(x=>x.promise??x), target={n:0,inner:input[1]}; target.self=target;
 const c=new r.Chain({child:input[0],marker:0},ctx); if(indexed)r.hasError(c,[],ctx);
 r.assignPath(c,['child','n'],input[2],ctx);
 const a=new r.Chain(r.lookupPath(c,[],ctx),ctx); r.assignPath(c,['marker'],1,ctx);
 const b=new r.Chain(r.lookupPath(c,[],ctx),ctx);
 const captured=observe||retire?r.export(b,[],ctx):undefined; if(retire)r.deletePath(b,[],ctx);
 const values=[target,{k:0},7]; const done=new Set();
 if(split){sig[order[0]].resolve(values[order[0]]);done.add(order[0]);await flush(split)}
 r.assignPath(c,['child','n'],2,ctx); r.assignPath(c,['child','inner','k'],3,ctx);
 for(const i of order)if(!done.has(i)){sig[i].resolve(values[i]); await flush(split?1:0)}
 const aa=await r.export(a,[],ctx),bb=await(captured??r.export(b,[],ctx)),cc=await r.export(c,[],ctx);
 for(const out of [aa,bb]) {assert.equal(out.child.n,7);assert.equal(out.child.inner.k,0);assert.equal(out.child.self.n,0);}
 assert.equal(aa.marker,0); assert.equal(bb.marker,1); assert.equal(cc.marker,1);assert.equal(cc.child.n,2);assert.equal(cc.child.inner.k,3);
 verifyRefCounts(ctx,c._state,a._state,b._state); assert.equal(ctx.execution.fatalError,null);cases++;
}
async function arrays(mode,indexed,observe,order,split) {
 const ctx={execution:new r.Execution(),errorContext:'array'}; const sig=[signal(mode),signal(mode),signal(mode)]; const input=sig.map(x=>x.promise??x);
 const c=new r.Chain([input[0],input[1],input[2]],ctx); if(indexed)r.hasError(c,[],ctx);
 r.run(c,[],'unshift',[-1],ctx,{mutationScopeDepth:0});
 r.run(c,[],'copyWithin',[2,1,2],ctx,{mutationScopeDepth:0});
 const a=new r.Chain(r.lookupPath(c,[],ctx),ctx); const captured=observe?r.export(a,[],ctx):undefined;
 const values=[{n:0},{discarded:1},{z:3}]; const done=new Set();
 if(split){sig[order[0]].resolve(values[order[0]]);done.add(order[0]);await flush(split)}
 r.assignPath(c,[1,'n'],1,ctx);r.run(c,[],'reverse',[],ctx,{mutationScopeDepth:0});
 for(const i of order)if(!done.has(i)){sig[i].resolve(values[i]);await flush(split?1:0)}
 const aa=await(captured??r.export(a,[],ctx)), cc=await r.export(c,[],ctx);
 assert.deepEqual(aa,[-1,{n:0},{n:0},{z:3}]);assert.equal(aa[1],aa[2]);
 assert.deepEqual(cc,[{z:3},{n:0},{n:1},-1]);assert.notEqual(cc[1],cc[2]);
 verifyRefCounts(ctx,c._state,a._state);assert.equal(ctx.execution.fatalError,null);cases++;
}
for(const mode of ['native','ordered','chained'])for(const indexed of [false,true])for(const observe of [false,true])for(const order of permutations)for(const split of [0,1,3]) {
 await records(mode,indexed,observe,order,split,false); await records(mode,indexed,observe,order,split,true); await arrays(mode,indexed,observe,order,split);
}
console.log(JSON.stringify({cases,failures:0,scenarios:['record_pending_writers_cycles_retired_export','array_copyWithin_pending_alias_reverse'],modes:['native','ordered','chained'],schedules:6,microtaskSplits:[0,1,3],indexed:[false,true],observed:[false,true]}));
