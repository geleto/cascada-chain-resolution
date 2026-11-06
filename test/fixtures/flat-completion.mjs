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
// Discard every completed nested output capture when another branch has failed,
// while still collecting required Errors from a pending nested sibling. Healthy
// output controls retain the same payload until it is delivered.
async function nestedOutput(mode, failed){
 const ctx={execution:new r.Execution(),errorContext:'flat nested output/'+mode}
 const later=mode==='ordered'?new OrderedThenable():Promise.withResolvers()
 let payload={tag:'retained output'}, nested=[payload,later.promise??later], cyclic=[]
 cyclic.push(cyclic)
 let root=failed?[cyclic,nested]:[nested], chain=new r.Chain(root,ctx)
 const weak=new WeakRef(payload)
 const result=new r.Chain(r.run(chain,[],'flat',[Infinity],ctx,{}),ctx)
 r.assignPath(chain,[],null,ctx)
 payload=nested=cyclic=root=chain=undefined
 await gc()
 assert.equal(Boolean(weak.deref()),!failed,'Discarded nested output retains payload or healthy output loses it')
 later.resolve(7);later.flush?.()
 const output=await r.export(result,[],ctx)
 if(failed)assert(r.isPoisonError(output))
 else assert.deepEqual(output,[{tag:'retained output'},7])
 cases++
}
for(const mode of ['native','ordered'])for(const failed of [false,true])await nestedOutput(mode,failed)

// Independently pending branches can close a cycle without repeating either
// branch's initial ancestry. Discard output at that edge, before an unrelated
// required input is available; the acyclic control still needs its payload.
async function crossBranchOutput(mode,failed){
 const ctx={execution:new r.Execution(),errorContext:'flat cross-branch output/'+mode}
 const signal=()=>mode==='ordered'?new OrderedThenable():Promise.withResolvers()
 let first=signal(),second=signal(),edge=signal()
 const later=signal()
 let b=[edge.promise??edge],c=[b],payload={tag:'cross-branch output'}
 let root=[first.promise??first,second.promise??second,payload,later.promise??later]
 let chain=new r.Chain(root,ctx)
 const weak=new WeakRef(payload)
 const result=new r.Chain(r.run(chain,[],'flat',[Infinity],ctx,{}),ctx)
 let completed=false
 const output=Promise.resolve(r.export(result,[],ctx)).then(value=>{completed=true;return value})
 r.assignPath(chain,[],null,ctx)
 first.resolve(b);first.flush?.();await turn()
 second.resolve(c);second.flush?.();await turn()
 edge.resolve(failed?c:7);edge.flush?.();await turn()
 first=second=edge=b=c=payload=root=chain=undefined
 await gc()
 assert.equal(completed,false,'Cross-branch flat still requires its pending sibling')
 assert.equal(Boolean(weak.deref()),!failed,'A proved cross-branch cycle must discard successful payloads')
 later.resolve(1);later.flush?.()
 const value=await output
 if(failed){
  const leaves=value.errors??[value]
  assert.equal(leaves.length,2)
  assert(leaves.every(error=>error.kind===r.ERROR_KIND.InvalidArrayOperation&&error.errorContext===ctx.errorContext))
 }else assert.deepEqual(value,[7,7,{tag:'cross-branch output'},1])
 assert.equal(ctx.execution.fatalError,null)
 cases++
}
for(const mode of ['native','ordered'])for(const failed of [false,true])await crossBranchOutput(mode,failed)

// A depth-one call never needs a nested Array's payload classification. Once
// presence is captured, failed output must release that version even while a
// different root placement still needs classification.
async function finiteBoundaryOutput(mode,failed){
 const ctx={execution:new r.Execution(),errorContext:'flat finite-boundary output/'+mode}
 const later=mode==='ordered'?new OrderedThenable():Promise.withResolvers()
 const cause=new Error('finite sibling inspection')
 let broken=false
 let sibling=new Proxy([1],{ownKeys(target){if(broken)throw cause;return Reflect.ownKeys(target)}})
 let payload={tag:'finite-boundary output'},nested=[payload],root=[nested,sibling,later.promise??later]
 let chain=new r.Chain(root,ctx)
 const weak=new WeakRef(payload)
 broken=failed
 const result=new r.Chain(r.run(chain,[],'flat',[1],ctx,{}),ctx)
 let completed=false
 const output=Promise.resolve(r.export(result,[],ctx)).then(value=>{completed=true;return value})
 r.assignPath(chain,[],null,ctx)
 sibling=payload=nested=root=chain=undefined
 await gc()
 assert.equal(completed,false,'Finite flat still requires its pending root placement')
 assert.equal(Boolean(weak.deref()),!failed,'Failed finite flat must release completed boundary payloads')
 later.resolve(7);later.flush?.()
 const value=await output
 if(failed){assert.equal(value.kind,r.ERROR_KIND.InvocationFailed);assert.equal(value.cause,cause)}
 else assert.deepEqual(value,[{tag:'finite-boundary output'},1,7])
 assert.equal(ctx.execution.fatalError,null)
 cases++
}
for(const mode of ['native','ordered'])for(const failed of [false,true])await finiteBoundaryOutput(mode,failed)

// Capacity rejection happens after successful capture. Retaining its unformatted
// diagnostic must not retain successful placements through a lazy Error stack.
async function overflowOutput(failed){
 const ctx={execution:new r.Execution(),errorContext:'flat capacity output'}
 let payload={tag:'capacity output'},array=[]
 array.push(payload,array)
 const weak=new WeakRef(payload)
 let source=new r.Chain(array,ctx)
 const value=r.run(source,[],'flat',[failed?2**54:3],ctx,{})
 const result=new r.Chain(value,ctx)
 if(failed)assert.equal(value.kind,r.ERROR_KIND.InvalidArrayLength)
 r.assignPath(source,[],null,ctx)
 payload=array=source=undefined
 await gc()
 assert.equal(Boolean(weak.deref()),!failed,'Capacity poison must not retain discarded flat placements')
 const output=await r.export(result,[],ctx)
 if(failed)assert.equal(output,value)
 else{
  assert.equal(output.length,5)
  assert.deepEqual(output[0],{tag:'capacity output'})
  assert(output.slice(0,-1).every(item=>item===output[0]))
  assert.equal(output.at(-1)[0],output[0])
  assert.equal(output.at(-1)[1],output.at(-1))
 }
 assert.equal(ctx.execution.fatalError,null)
 cases++
}
for(const failed of [false,true])await overflowOutput(failed)
console.log(cases+' flat presence and pending-collection cases passed')
