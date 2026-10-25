import assert from 'node:assert/strict';
import * as r from '../../src/index.js';
import { OrderedThenable } from '../../test/ordered-thenable.js';
import { verifyRefCounts } from '../../test/verify-refcounts.js';
let cases=0;
for(const representation of ['owned','imported','shared','view','overlay'])for(const method of ['fill','copyWithin'])for(const mutation of [false,true])for(const delivery of ['native','ordered'])for(const reject of [false,true]){
 const ctx={execution:new r.Execution(),errorContext:`${representation}/${method}/${mutation}/${delivery}/${reject}`};
 const signal=delivery==='native'?Promise.withResolvers():new OrderedThenable(),pending=signal.promise??signal,unused=Promise.withResolvers();
 const initial=method==='fill'?[1,2,,4]:[pending,pending,,4];
 let chain=new r.Chain(representation==='imported'?r.import(initial,ctx):representation==='view'?[9,...initial]:initial,ctx),extra;
 if(representation==='view'){extra=chain;chain=new r.Chain(r.run(extra,[],'slice',[1],ctx,{}),ctx);r.deletePath(extra,[],ctx)}
 if(representation==='shared')extra=new r.Chain(r.lookupPath(chain,[],ctx),ctx);
 if(representation==='overlay')r.assignPath(chain,[2],unused.promise,ctx);
 const out=new r.Chain(r.run(chain,[],method,method==='fill'?[pending,1,3]:[1,0,2],ctx,mutation?{mutationScopeDepth:0}:{}),ctx);
 const exported=r.export(out,[],ctx);r.deletePath(out,[],ctx);r.deletePath(chain,[],ctx);if(extra)r.deletePath(extra,[],ctx);
 const cause=new Error('payload rejection');if(reject)signal.reject(cause);else signal.resolve({n:1});unused.resolve(44);
 const value=await exported;
 if(reject){assert(r.isPoisonError(value));assert.equal(value.cause,cause)}
 else {assert.deepEqual(value,method==='fill'?[1,{n:1},{n:1},4]:[{n:1},{n:1},{n:1},4]);assert.equal(value[1],value[2]);if(method==='copyWithin')assert.equal(value[0],value[1])}
 verifyRefCounts(ctx,chain._state,out._state,...(extra?[extra._state]:[]));assert.equal(ctx.execution.fatalError,null);cases++;
}
console.log(JSON.stringify({cases,failures:0,representations:['owned','imported','shared','view','overlay'],modes:['observation','mutation'],delivery:['native','ordered'],outcomes:['fulfillment','rejection'],capture:'export captured before all holders cleared'}));
