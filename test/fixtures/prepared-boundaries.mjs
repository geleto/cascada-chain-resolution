import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import {OrderedThenable,ready} from '../ordered-thenable.js'
const context=label=>({execution:new r.Execution(),errorContext:label})
let cases=0
for(const mode of ['ready','sync','native','ordered']){
 const ctx=context('source'),call={...ctx,errorContext:'return boundary'}
 const capability=r.externalState({read(){return 1}})
 const authority=new r.ContextChain({capability},ctx,{capability:{}})
 const pending=mode==='native'?Promise.withResolvers():mode==='ordered'?new OrderedThenable():undefined
 const available=mode==='ready'?capability:mode==='sync'?ready(capability):pending.promise??pending
 const source={child:available};source.self=source
 const first=new r.Chain(r.import(source,ctx),ctx)
 const second=new r.Chain(r.importMethodResult(source,call),call)
 assert.equal(r.lookupPath(second,[],call),r.lookupPath(first,[],ctx))
 pending?.resolve(capability);pending?.flush?.()
 assert.equal((await r.lookupPath(second,['child'],call)).kind,r.ERROR_KIND.ExternalLocationConflict)
 assert.equal(await r.getErrors(second,[],call),null)
 assert.equal((await r.export(second,[],call)).kind,r.ERROR_KIND.ExternalCapabilityEscape)
 assert.equal(r.run(authority,['capability'],'read',[],ctx,{}),1)
 const direct=r.importMethodResult(capability,call)
 assert.equal(direct,capability)
 assert.equal(r.export(new r.Chain(direct,call),[],call).kind,r.ERROR_KIND.ExternalLocationConflict)
 const later=mode==='native'?Promise.withResolvers():mode==='ordered'?new OrderedThenable():undefined
 const freshValue=mode==='ready'?capability:mode==='sync'?ready(capability):later.promise??later
 const fresh=new r.Chain(r.importMethodResult({child:freshValue},call),call)
 later?.resolve(capability);later?.flush?.()
 assert.equal(await r.getErrors(fresh,[],call),null)
 assert.equal((await r.export(fresh,[],call)).kind,r.ERROR_KIND.ExternalCapabilityEscape)
 cases++
}
{
 const ctx=context('first preparation'),call={...ctx,errorContext:'prepared return'}
 const cause=new Error('prebuilt reflection failure')
 let armed=false,reads=0
 const source=new Proxy({n:1},{ownKeys(target){reads++;if(armed)throw cause;return Reflect.ownKeys(target)}})
 const first=new r.Chain(r.import(source,ctx),ctx)
 const before=reads;armed=true
 const second=new r.Chain(r.importMethodResult({node:r.lookupPath(first,[],ctx)},call),call)
 assert.equal(reads,before,'Method-result preservation must not inspect prepared interiors')
 assert.equal(r.lookupPath(second,['node'],call),source)
 const exported=r.export(second,[],call)
 assert.equal(exported.kind,r.ERROR_KIND.ExportReflectionFailed)
 assert.equal(exported.cause,cause)
 cases++
}
console.log(cases+' prepared/fresh/direct boundary controls passed')
