// Run: node --unhandled-rejections=strict test/experiments/array-method-specification-probes.mjs
// Specification algorithms and real-runtime boundary probes; not a production layout.
import assert from 'node:assert/strict'
import { Chain, Execution, lookupPath, assignPath, export as exportValue,
    hasError, getErrors, isPoisonError } from '../../src/index.js'
import * as meta from '../../src/meta.js'
import { getParentPlacements } from '../../src/parent-placements.js'
import { getRefCounter, buildRefIndex } from '../../src/refcounts.js'
import { runGraphTransition } from '../../src/ownership.js'

const report = {}, HOLE = Symbol('hole'), UNKNOWN = Symbol('unknown')
const ctx = label => ({ execution: new Execution(), errorContext: label })
const clear = (chain, context) => assignPath(chain, [], undefined, context)
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => Promise.withResolvers()
const intervals = n => Array.from({ length: n + 1 }, (_, lo) =>
    Array.from({ length: n + 1 - lo }, (_, d) => [lo, lo + d])).flat()
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => i + a)
const sorted = s => [...s].sort((a, b) => a - b)
const norm = (n, length) => n < 0 ? Math.max(length + n, 0) : Math.min(n, length)

// For an in-range output i, copyWithin's write predicate simplifies to
// t <= i && s+i-t < e. Length clipping adds no independent alternative.
function copySources(length, i, [t0,t1], [s0,s1], [e0,e1]) {
    const candidates = new Set()
    const tMax = Math.min(t1, i)
    if (t0 <= tMax) {
        const first = s0 + i - tMax
        const last = Math.min(s1 + i - t0, e1 - 1, length - 1)
        for (const q of range(first, last)) candidates.add(q)
    }
    const definitelyWritten = t1 <= i && s1 + i - t0 < e0
    if (!definitelyWritten) candidates.add(i)
    return candidates
}
let copyQueries = 0, sparseChecks = 0
for (let length = 1; length <= 5; length++) {
    const spans = intervals(length), source = range(0, length - 1)
    for (const t of spans) for (const s of spans) for (const e of spans) {
        const expected = source.map(() => new Set())
        for (let target = t[0]; target <= t[1]; target++)
            for (let start = s[0]; start <= s[1]; start++)
                for (let end = e[0]; end <= e[1]; end++) {
                    const result = source.slice().copyWithin(target, start, end)
                    result.forEach((value, i) => expected[i].add(value))
                }
        for (let i = 0; i < length; i++) {
            assert.deepEqual(sorted(copySources(length, i, t, s, e)), sorted(expected[i]))
            copyQueries++
        }
    }
    for (let mask = 0; mask < 1 << length; mask++) {
        const sparse = new Array(length)
        for (const i of source) if (mask & (1 << i)) sparse[i] = i
        for (let t = 0; t <= length; t++) for (let s = 0; s <= length; s++) for (let e = 0; e <= length; e++) {
            const actual = sparse.slice().copyWithin(t,s,e)
            for (let i = 0; i < length; i++) {
                const q = i >= t && s+i-t < e ? s+i-t : i
                assert.equal(i in actual, q in sparse)
                assert.equal(actual[i], sparse[q]); sparseChecks++
            }
        }
    }
}
report.copyWithin = { selectorQueries: copyQueries, sparsePlacementChecks: sparseChecks }

// Unknown lengths stay symbolic. Test reductions for all lengths, not by choosing
// one guessed L or independently widening two uses of the same normalizer.
let normalizerChecks = 0
const raw = [-Infinity,-9,-3,-1,0,1,2,6,Infinity]
for (let length = 0; length <= 8; length++) for (const value of raw) {
    const a = range(0,length-1), same = norm(value,length)
    for (const end of raw) {
        assert.deepEqual(a.slice().copyWithin(value,value,end), a)
        assert.deepEqual(a.slice(value,value), [])
        assert.equal(norm(value,length), same); normalizerChecks += 3
    }
    for (let t = 0; t <= 8; t++) for (let s = 0; s <= 8; s++) for (let e = 0; e <= 8; e++) {
        const result = a.slice().copyWithin(t,s,e)
        for (let i = 0; i < length; i++) {
            const q = s+i-t
            const expected = t <= i && q < length && q < e ? a[q] : a[i]
            assert.equal(result[i], expected); normalizerChecks++
        }
    }
}
// API argument positions are independent, even when they receive one Promise or
// Error. These artificial bounds test arithmetic, not supported failed inputs.
// Repeated uses of one internal captured fact retain their shared binding.
{
    const a = range(0,5), independent = [], shared = []
    for (const start of [1,2]) for (const count of [1,2]) {
        const b = a.slice(); b.splice(start,count,'X'); independent.push(b)
        if (start === count) shared.push(b)
    }
    const chosen = a.slice(); chosen.splice(2,1,'X')
    const contains = (worlds, value) => worlds.some(b => JSON.stringify(b) === JSON.stringify(value))
    assert(contains(independent, chosen))
    assert(!contains(shared, chosen))
    for (const split of [1,2]) assert.equal(a.slice(0,split).length + a.slice(split).length, a.length)
}
report.coordinates = { checks: normalizerChecks, independentArguments: 'distinct from shared internal facts' }

// Successful permutations preserve membership and fixed undefined/hole partitions.
// These private facts do not permit result publication before required sorting
// succeeds. Whole-sort failure/status/repair needs production integration tests.
function permutations(values) {
    if (!values.length) return [[]]
    return values.flatMap((v,i) => permutations(values.filter((_,j) => i !== j)).map(rest => [v,...rest]))
}
let sortChecks = 0
for (let count = 0; count <= 5; count++) for (let undefs = 0; undefs <= 2; undefs++) for (let holes = 0; holes <= 2; holes++) {
    const records = range(0,count-1).map(i => ({ id: i }))
    const suffix = [...Array(undefs).fill(undefined),...Array(holes).fill(HOLE)]
    const fallback = [...records,...suffix]
    for (const permutation of permutations(records)) {
        const world = [...permutation,...suffix]
        assert.deepEqual(new Set(world.filter(v => v !== HOLE)), new Set(fallback.filter(v => v !== HOLE)))
        for (let i = count; i < world.length; i++) assert.equal(world[i], fallback[i])
        if (count < 2) assert.deepEqual(world, fallback)
        sortChecks++
    }
}
report.sort = { permutationChecks: sortChecks, privateFixedSuffix: 'preserved',
    wholeSortFailure: 'not implemented by this partition probe' }

// Each flatten occurrence has a path, so aliases or duplicate values are not
// merged. The shallowest allowed depth is a finite failure skeleton; uncertain
// skeleton occurrences become structural Errors, not extra missing-output slots.
function flattenRecords(a, depth, path = []) {
    const result = []
    for (let i = 0; i < a.length; i++) if (i in a) {
        const value = a[i], occurrence = [...path,i]
        if (depth > 0 && Array.isArray(value)) result.push(...flattenRecords(value, depth-1, occurrence))
        else result.push({ key: occurrence.join('.'), value })
    }
    return result
}
let flatChecks = 0
const alias = ['Q',,'R']
const samples = [[],[1,,2],[[1,2],3],[[[1],2],3],[alias,alias],[[[],1],2],[[],[1,[],2]]]
for (const a of samples) for (let lo = 0; lo <= 3; lo++) for (let hi = lo; hi <= 3; hi++) {
    const worlds = range(lo,hi).map(d => flattenRecords(a,d))
    const skeleton = worlds[0]
    const guaranteed = skeleton.filter(r => worlds.every(w => w.some(x => x.key === r.key)))
    const min = Math.min(...worlds.map(w => w.length)), max = Math.max(...worlds.map(w => w.length))
    assert(skeleton.length >= min && skeleton.length <= max)
    for (let d = lo; d <= hi; d++) assert.deepEqual(flattenRecords(a,d).map(r => r.value),a.flat(d))
    for (const r of guaranteed) assert(worlds.every(w => w.some(x => x.key === r.key && x.value === r.value)))
    for (let i = 0; i < min; i++) if (worlds.every(w => w[i].key === worlds[0][i].key))
        assert(guaranteed.some(r => r.key === skeleton[i].key))
    flatChecks++
}
report.flat = { depthDomains: flatChecks, aliasesAndHoles: 'preserved' }

// Real placement settlement, indexed publication, historical captures, native
// export aliases/cycles, retirement, and re-entry. No production layout is faked.
let integrationCases = 0
for (const rejection of [false,true]) for (const detachBeforeDelivery of [false,true]) {
    const context = ctx(`publication-${rejection}-${detachBeforeDelivery}`), d = deferred()
    let subscriptions = 0
    const then = d.promise.then
    d.promise.then = function (...args) { subscriptions++; return then.apply(this,args) }
    const array = [d.promise,d.promise], source = new Chain(array,context)
    const snapshot = new Chain(lookupPath(source,[],context),context)
    runGraphTransition(context, () => buildRefIndex(array,context))
    const errorQuery = hasError(snapshot,[],context)
    assignPath(source,[1],{ replacement: true },context)
    if (detachBeforeDelivery) clear(source,context)
    const received = lookupPath(snapshot,[0],context).then(value => {
        const item = new Chain(value,context)
        if (!rejection) {
            const parents = getParentPlacements(value,context)
            assert(parents.some(p => p.parent === array && p.key === '0'))
            assert(parents.some(p => p.parent === array && p.key === '1'))
            assert(getRefCounter(value,context))
        }
        return item
    })
    if (rejection) d.reject(new Error('payload failure'))
    else d.resolve({ n: 7, back: array })
    const item = await received
    assert.equal(await errorQuery,rejection)
    if (rejection) {
        assert(isPoisonError(await exportValue(snapshot,[],context)))
        assert(isPoisonError(await getErrors(snapshot,[],context)))
    } else {
        const exported = await exportValue(snapshot,[],context)
        assert.equal(exported[0],exported[1]); assert.equal(exported[0].back,exported)
        assert.equal(exported[0].n,7)
    }
    clear(item,context); clear(source,context); clear(snapshot,context)
    await flush()
    assert.equal(meta.requireMeta(array,context).relationshipsActive,false)
    assert.equal(getRefCounter(array,context),undefined)
    const before = subscriptions, restored = new Chain(array,context)
    assert.equal(await hasError(restored,[],context),rejection)
    assert.equal(subscriptions,before)
    assert.equal(meta.requireMeta(array,context).relationshipsActive,true)
    clear(restored,context); await flush()
    assert.equal(meta.requireMeta(array,context).relationshipsActive,false)
    integrationCases++
}
report.publication = { realRuntimeCases: integrationCases, indexedDelivery: true,
    aliasesCyclesAndErrors: true, retirementAndReentryWithoutResubscription: true }

// An exact-sum query needs readiness, not every intermediate numeric bound.
// Persistent prefix versions share facts. Each readiness summary changes once.
function sumVersions(size, eager) {
    const nodes = [], leaves = [], roots = []
    const empty = { ready: true, sum: 0, parents: [] }
    const make = (left,right) => {
        const n = { left,right,ready:left.ready&&right.ready,sum:0,parents:[] }
        left.parents.push(n);right.parents.push(n);nodes.push(n);return n
    }
    function put(node,lo,hi,index,leaf) {
        if (hi-lo===1) return leaf
        const mid=(lo+hi)>>1
        return index<mid ? make(put(node?.left,lo,mid,index,leaf),node?.right??empty)
            : make(node?.left??empty,put(node?.right,mid,hi,index,leaf))
    }
    let root,visits=0,wakes=0
    for(let i=0;i<size;i++) {
        const leaf={ready:false,sum:0,parents:[]};leaves.push(leaf)
        root=put(root,0,size,i,leaf);roots.push(root)
    }
    const rootRanks=new Map(roots.map((r,i)=>[r,i+1]))
    for(let i=0;i<size;i++) {
        leaves[i].ready=true;leaves[i].sum=1
        const work=[...leaves[i].parents]
        while(work.length) {
            const n=work.pop();visits++
            const ready=n.left.ready&&n.right.ready
            if(!eager && ready===n.ready)continue
            n.ready=ready;n.sum=n.left.sum+n.right.sum
            if(rootRanks.has(n)){wakes++;if(ready)assert.equal(n.sum,rootRanks.get(n))}
            work.push(...n.parents)
        }
    }
    assert(roots.every((r,i)=>r.ready&&r.sum===i+1))
    return { nodes:nodes.length,visits,wakes }
}
report.work=[]
for(const size of [32,128,512]) {
    const eager=sumVersions(size,true), projected=sumVersions(size,false)
    assert.equal(eager.wakes,size*(size+1)/2)
    assert.equal(projected.wakes,size)
    assert(projected.visits<=4*projected.nodes)
    report.work.push({size,eager,projected})
}

// Fixed-width mixed histories: conditional overwrite, ready overwrite, and
// permutation compose in one persistent summary. No completed row can retract.
// This is a projection test, not per-slot production storage for sparse Arrays.
report.mixed=[]
for (const size of [32,128,512]) for (const schedule of ['forward','reverse','shuffled']) {
    const width=4, identity=range(0,width-1), nodes=[], leaves=[], roots=[]
    const empty={map:identity,parents:[]}
    const compose=(a,b)=>b.map(x=>typeof x==='number'?a[x]:x)
    const same=(a,b)=>a.every((x,i)=>x===b[i])
    const make=(left,right)=>{
        const node={left,right,map:compose(left.map,right.map),parents:[]}
        left.parents.push(node);right.parents.push(node);nodes.push(node);return node
    }
    function put(node,lo,hi,index,leaf){
        if(hi-lo===1)return leaf
        const mid=(lo+hi)>>1
        return index<mid?make(put(node?.left,lo,mid,index,leaf),node?.right??empty)
            :make(node?.left??empty,put(node?.right,mid,hi,index,leaf))
    }
    let root,expected=identity,visits=0,changedRows=0
    const expectedVersions=[]
    for(let i=0;i<size;i++){
        const final=identity.slice(),initial=identity.slice()
        if(i%7===0){final.reverse();initial.reverse()}
        else {
            const position=i%width,apply=i%3!==0
            final[position]=apply?`v${i}`:position
            initial[position]=i%11===0?final[position]:UNKNOWN
        }
        const leaf={map:initial,final,parents:[]};leaves.push(leaf)
        root=put(root,0,size,i,leaf);roots.push(root)
        expected=compose(expected,final);expectedVersions.push(expected)
    }
    const order=range(0,size-1)
    if(schedule==='reverse')order.reverse()
    if(schedule==='shuffled')order.sort((a,b)=>((a*73)%size)-((b*73)%size))
    for(const index of order){
        const leaf=leaves[index]
        if(same(leaf.map,leaf.final))continue
        leaf.map=leaf.final
        const work=[...leaf.parents]
        while(work.length){
            const node=work.pop();visits++
            const next=compose(node.left.map,node.right.map)
            if(same(next,node.map))continue
            for(let j=0;j<width;j++)if(next[j]!==node.map[j]){
                assert.equal(node.map[j],UNKNOWN);changedRows++
            }
            node.map=next;work.push(...node.parents)
        }
        for(let i=0;i<size;i++)for(let j=0;j<width;j++)
            if(roots[i].map[j]!==UNKNOWN)assert.equal(roots[i].map[j],expectedVersions[i][j])
    }
    roots.forEach((r,i)=>assert.deepEqual(r.map,expectedVersions[i]))
    assert(changedRows<=width*nodes.length)
    assert(visits<=2*(width+1)*nodes.length)
    report.mixed.push({size,schedule,nodes:nodes.length,visits,changedRows})
}
console.log(JSON.stringify(report,null,2))
