import assert from 'node:assert/strict';import * as r from '../../src/index.js';import { OrderedThenable } from '../../test/ordered-thenable.js';import { verifyRefCounts } from '../../test/verify-refcounts.js';
let cases=0;const history=10000;for(const mode of ['native','ordered'])for(const route of ['record','reverse']){
const ctx={execution:new r.Execution(),errorContext:'long history'},signal=mode==='native'?Promise.withResolvers():new OrderedThenable(),p=signal.promise??signal,c=new r.Chain(route==='record'?{p,z:0}:[p,0],ctx);
for(let i=0;i<history;i++){if(route==='record'){const h=new r.Chain(r.lookupPath(c,[],ctx),ctx);r.assignPath(c,['z'],i,ctx);r.deletePath(h,[],ctx)}else r.run(c,[],'reverse',[],ctx,{mutationScopeDepth:0})}
signal.resolve({x:1});assert.deepEqual(await r.export(c,[],ctx),route==='record'?{p:{x:1},z:history-1}:[{x:1},0]);verifyRefCounts(ctx,c._state);assert.equal(ctx.execution.fatalError,null);cases++;
}console.log(JSON.stringify({cases,history,historySteps:40000,failures:0}));

