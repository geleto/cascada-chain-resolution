import assert from 'node:assert/strict';import * as r from '../../src/index.js';import { OrderedThenable, ChainedThenable } from '../../test/ordered-thenable.js';import { verifyRefCounts } from '../../test/verify-refcounts.js';
const sig=m=>m==='native'?Promise.withResolvers():m==='chained'?new ChainedThenable():new OrderedThenable();let cases=0;
for(const mode of ['native','ordered','chained'])for(const array of [false,true])for(const indexed of [false,true])for(const reverse of [false,true])for(const retire of [false,true]){
 const ctx={execution:new r.Execution(),errorContext:'init'},writer={...ctx,errorContext:'writer'},source=sig(mode),failure=sig(mode),cause=new Error('rejected value'); const key=array?0:'child',mark=array?1:'mark';
 const c=new r.Chain(array?[source.promise??source,0]:{child:source.promise??source,mark:0},ctx);if(indexed)r.hasError(c,[],ctx);
 r.assignPath(c,[key,'n'],failure.promise??failure,writer);const a=new r.Chain(r.lookupPath(c,[],ctx),ctx);r.assignPath(c,[mark],1,ctx);const b=new r.Chain(r.lookupPath(c,[],ctx),ctx);const out=r.export(b,[],ctx);if(retire)r.deletePath(b,[],ctx);
 r.assignPath(c,[key,'n'],9,ctx);
 if(reverse){failure.reject(cause);await Promise.resolve();source.resolve({n:0})}else{source.resolve({n:0});await Promise.resolve();failure.reject(cause)}
 const ea=await r.getErrors(a,[],ctx),eb=await out;assert(r.isPoisonError(ea));assert.equal(eb,ea);assert.equal(ea.cause,cause);assert.equal(ea.errorContext,'writer');assert.equal(ea.kind,r.ERROR_KIND.AssignmentValueFailed);assert.deepEqual(await r.export(c,[],ctx),array?[{n:9},1]:{child:{n:9},mark:1});
 verifyRefCounts(ctx,c._state,a._state,b._state);assert.equal(ctx.execution.fatalError,null);cases++;
}
for(const mode of ['native','ordered','chained'])for(const indexed of [false,true])for(const split of [false,true]) {
 const ctx={execution:new r.Execution(),errorContext:'recovery'},source=sig(mode),obj={p:source.promise??source,n:0}; const c=new r.Chain({obj,mark:0},ctx);if(indexed)r.hasError(c,[],ctx);
 const failure=r.assignPath(c,['obj','missing','x'],7,ctx,1);assert(r.isPoisonError(failure));const a=new r.Chain(r.lookupPath(c,[],ctx),ctx);r.assignPath(c,['mark'],1,ctx);const b=new r.Chain(r.lookupPath(c,[],ctx),ctx);
 assert.equal(r.repairPath(b,['obj'],ctx),undefined);r.assignPath(b,['obj','n'],9,ctx);if(split){source.resolve({k:1});await Promise.resolve()}
 assert.equal(r.repairPath(c,['obj'],ctx),undefined);r.assignPath(c,['obj','p','k'],2,ctx);if(!split)source.resolve({k:1});
 assert.deepEqual(await r.export(b,[],ctx),{obj:{p:{k:1},n:9},mark:1});assert.deepEqual(await r.export(c,[],ctx),{obj:{p:{k:2},n:0},mark:1});assert.equal(await r.lookupPath(a,['obj'],ctx),failure);
 verifyRefCounts(ctx,c._state,a._state,b._state);assert.equal(ctx.execution.fatalError,null);cases++;
}
console.log(JSON.stringify({cases,failures:0,rejectionCases:48,recoveryCases:12,modes:['native','ordered','chained']}));
