import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import {OrderedThenable} from '../ordered-thenable.js'
assert(global.gc)
const turn=()=>new Promise(setImmediate)
async function gc(){for(let i=0;i<20;i++){await turn();global.gc()}}
let cases=0
// Presence is captured at issuance; later deletion, growth and another holder
// must not alter the flattened result, even when entry publication is pending.
for(const depth of [0,1,Infinity])for(const present of [false,true])for(const view of [false,true]){
 const ctx={execution:new r.Execution(),errorContext:'flat presence'}
 let chain=new r.Chain([1,,[2,,3]],ctx)
 if(view)chain=new r.Chain(r.run(chain,[],'slice',[],ctx,{}),ctx)
 const gate=Promise.withResolvers()
 const entry=r.enter(chain,[1],ctx,true,inside=>{
   if(present)r.assignPath(inside,[],[4,,5],ctx)
   return gate.promise
 })
 const output=new r.Chain(r.run(chain,[],'flat',[depth],ctx,{}),ctx)
 r.assignPath(chain,[2],99,ctx)
 gate.resolve();await entry
 const expected=[1];if(present)expected[1]=[4,,5];else expected.length=2
 expected[2]=[2,,3]
 assert.deepEqual(await r.export(output,[],ctx),expected.flat(depth))
 cases++
}
// A known cycle Error releases source-only state while required pending sibling
// traversal continues. A later structural failure must still be collected;
// an ordinary Error leaf is carried data and needs no discarded-output scan.
async function pendingCycle(mode, lateCycle){
 const ctx={execution:new r.Execution(),errorContext:'flat cycle collection/'+mode}
 const later=mode==='ordered'?new OrderedThenable():Promise.withResolvers()
 let array=[1];array.push(array,later.promise??later)
 let root={array,payload:{}}, chain=new r.Chain(r.import(root,ctx),ctx)
 const weak=new WeakRef(root.payload)
 let completed=false
 const result=Promise.resolve(r.run(chain,['array'],'flat',[Infinity],ctx,{})).then(v=>{completed=true;return v})
 // Explicitly retire the holder: a still-active source producer retains its
 // publication destination independently of this operation's traversal.
 r.assignPath(chain,[],null,ctx)
 root=chain=array=undefined
 await gc()
 assert.equal(completed,false,'Required Error collection must remain pending')
 assert.equal(weak.deref(),undefined,'Success-only source survives known cycle failure')
 const cause=new Error('late sibling')
 if(lateCycle){const cyclic=[];cyclic.push(cyclic);later.resolve(cyclic)}
 else later.reject(cause)
 later.flush?.()
 const failure=await result
 assert(r.isPoisonError(failure))
 const errors=failure.errors??[failure]
 assert.equal(errors.length,lateCycle?2:1)
 assert(errors.every(e=>e.kind===r.ERROR_KIND.InvalidArrayOperation&&e.errorContext===ctx.errorContext))
 cases++
}
for(const mode of ['native','ordered'])for(const lateCycle of [false,true])await pendingCycle(mode,lateCycle)
console.log(cases+' flat presence and pending-collection cases passed')
