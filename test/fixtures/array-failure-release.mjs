import assert from 'node:assert/strict'
import * as r from '../../src/index.js'
import {ArrayView} from '../../src/array-view.js'
import { ready, OrderedThenable } from '../ordered-thenable.js'
assert(global.gc)
const cause = new Error('prebuilt host failure')
const rows=[]
async function execute(kind, mode, shape) {
 const label=`${kind}/${mode}/${shape}`, ctx={execution:new r.Execution(),errorContext:label}
 let array=[{n:2},{n:1}], args=[], method='sort', deferred
 const copies=[]
 if(kind==='flat-cycle') { array=[1];array.push(array);method='flat';args=[Infinity] }
 if(kind==='sort-symbol') array=[Symbol('bad'),1]
 if(kind==='join-symbol') {array=[Symbol('bad'),1];method='join'}
 if(kind==='numeric-array') {method='at';args=[[Symbol('bad')]]}
 if(kind==='with-range') {method='with';args=[100,1]}
 if(kind==='callback-invalid'||kind==='callback-throw'||kind==='callback-pending') args=[function compare(a,b) {
   copies.push(new WeakRef(a),new WeakRef(b))
   if(kind==='callback-throw')throw cause
   return kind==='callback-pending'?Promise.resolve(0):{}
 }]
 if(kind==='sort-symbol'||kind==='join-symbol') {
   if(mode==='sync')array[0]=ready(array[0])
   if(mode==='native'||mode==='ordered') {
    const value=array[0];deferred=mode==='native'?Promise.withResolvers():new OrderedThenable()
    array[0]=deferred.promise??deferred;deferred.complete=()=>{deferred.resolve(value);deferred.flush?.()}
   }
 } else if(args.length) {
   if(mode==='sync')args[0]=ready(args[0])
   if(mode==='native'||mode==='ordered') {
    const value=args[0];deferred=mode==='native'?Promise.withResolvers():new OrderedThenable()
    args[0]=deferred.promise??deferred;deferred.complete=()=>{deferred.resolve(value);deferred.flush?.()}
   }
 }
 let payload={tag:label}, source={array,payload}, chain=new r.Chain(shape==='view'?source:r.import(source,ctx),ctx), holder=chain, path=['array']
 if(shape==='view') {holder=new r.Chain(r.run(chain,path,'slice',[],ctx,{}),ctx);path=[];assert(r.lookupPath(holder,[],ctx) instanceof ArrayView,label)}
 const weak=[new WeakRef(source),new WeakRef(array),new WeakRef(payload)]
 let result=r.run(holder,path,method,args,ctx,{})
 deferred?.complete();result=await result
 assert(r.isPoisonError(result),label)
 assert.equal(result.kind,kind==='flat-cycle'||kind==='with-range'?r.ERROR_KIND.InvalidArrayOperation:
   kind==='callback-throw'?r.ERROR_KIND.ControlledCallbackFailed:
   kind.startsWith('callback-')?r.ERROR_KIND.InvalidCallbackResult:r.ERROR_KIND.ScalarConversionFailed,label)
 if(kind==='callback-throw')assert.equal(result.cause,cause,label)
 if(kind.startsWith('callback-'))assert(copies.length>=2,'Comparator export must be exercised')
 rows.push({label,weak,copies,keep:[ctx,result],kind:result.kind})
 result=array=args=deferred=payload=source=chain=holder=undefined
}
for(const kind of ['flat-cycle','sort-symbol','join-symbol','numeric-array','with-range','callback-invalid','callback-throw','callback-pending'])
for(const mode of ['ready','sync','native','ordered'])for(const shape of ['array','view'])await execute(kind,mode,shape)
for(let i=0;i<30;i++){await new Promise(setImmediate);global.gc()}
const failed=rows.filter(row=>[...row.weak,...row.copies].some(ref=>ref.deref())).map(row=>({label:row.label,source:row.weak.map(ref=>Boolean(ref.deref())),copies:row.copies.map(ref=>Boolean(ref.deref()))}))
console.log(JSON.stringify({cases:rows.length,failed},null,2))
assert.deepEqual(failed,[],'Failed Array operations retain completed resources')
