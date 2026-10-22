import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import {ArrayView} from '../../src/array-view.js'
import {OrderedThenable} from '../ordered-thenable.js'
assert(global.gc)
const cause=new Error('prebuilt Array reflection failure')
const cases={at:[0],concat:[],copyWithin:[0,1],fill:[8,1,2],flat:[1],includes:[3],indexOf:[3],join:[],lastIndexOf:[3],pop:[],push:[8],reverse:[],shift:[],slice:[0,2],sort:[],splice:[0,1],toReversed:[],toSorted:[],toSpliced:[1,1],toString:[],unshift:[8],with:[1,8]}
const mutators=new Set(['copyWithin','fill','pop','push','reverse','shift','sort','splice','unshift'])
const rows=[]
async function execute(method,view,mutation){
 const label=`${method}/${view}/${mutation}`,ctx={execution:new r.Execution(),errorContext:label}
 let armed=false, hits=0, target=[3,,1,2]
 let source=new Proxy(target,{getOwnPropertyDescriptor(owner,key){if(armed&&key==='0'){hits++;throw cause}return Reflect.getOwnPropertyDescriptor(owner,key)}})
 let root={array:source,payload:{}},chain=new r.Chain(root,ctx),holder=chain,path=['array']
 if(view){holder=new r.Chain(r.run(chain,path,'slice',[],ctx,{}),ctx);path=[];assert(r.lookupPath(holder,[],ctx) instanceof ArrayView)}
 const weak=[new WeakRef(target),new WeakRef(source),new WeakRef(root.payload)]
 armed=true
 let result=await r.run(holder,path,method,cases[method],ctx,mutation?{mutationScopeDepth:path.length}:{})
 let output=r.isPoisonError(result)?result:await r.export(new r.Chain(result,ctx),[],ctx)
 assert(!r.isFatalError(output))
 if(r.isPoisonError(output))assert((output.errors??[output]).every(e=>e.cause===cause),label)
 else {
  const reference=[3,,1,2],returned=Reflect.apply(Array.prototype[method],reference,cases[method])
  assert.deepEqual(output,mutation||!mutators.has(method)?returned:reference,label)
 }
 rows.push({label,weak,keep:[ctx,output],hits})
 target=source=root=chain=holder=result=output=undefined
}
for(const method of Object.keys(cases))for(const view of [false,true]){
 await execute(method,view,false)
 if(mutators.has(method))await execute(method,view,true)
}
for(const method of ['indexOf','lastIndexOf'])for(const view of [false,true])for(const mode of ['native','ordered']){
 const label=`${method}/${view}/${mode}`,ctx={execution:new r.Execution(),errorContext:label}
 const pending=mode==='native'?Promise.withResolvers():new OrderedThenable()
 let armed=false,target=[0,1,2,3]
 target[method==='indexOf'?0:3]=pending.promise??pending
 let source=new Proxy(target,{getOwnPropertyDescriptor(owner,key){if(armed&&key==='1')throw cause;return Reflect.getOwnPropertyDescriptor(owner,key)}})
 let chain=new r.Chain({array:source},ctx),holder=chain,path=['array']
 if(view){holder=new r.Chain(r.run(chain,path,'slice',[],ctx,{}),ctx);path=[];assert(r.lookupPath(holder,[],ctx) instanceof ArrayView)}
 const weak=[new WeakRef(target),new WeakRef(source)]
 armed=true
 let result=r.run(holder,path,method,[99],ctx,{})
 assert(r.isPending(result,ctx),label)
 pending.resolve(0);pending.flush?.()
 const output=await result
 assert.equal(output.cause,cause,label)
 rows.push({label,weak,keep:[ctx,output],hits:1})
 target=source=chain=holder=result=undefined
}
for(let i=0;i<30;i++){await new Promise(setImmediate);global.gc()}
const retained=rows.filter(row=>row.weak.some(ref=>ref.deref())).map(row=>row.label)
assert.equal(rows.filter(row=>row.hits).length,64,'Reflection coverage changed')
console.log(JSON.stringify({cases:rows.length,reflectionCases:rows.filter(row=>row.hits).length,retained},null,2))
assert.deepEqual(retained,[],'Failed Array reflection retains source storage')
