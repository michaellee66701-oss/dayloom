export const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function normalized(value){if(Array.isArray(value))return value.map(normalized);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,normalized(value[k])]));return value;}
export const equal=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function mergePlans(base,local,remote){
 const conflicts=[];
 function merge(b,l,r,path){
  if(equal(l,r))return copy(l);
  if(equal(l,b))return copy(r);
  if(equal(r,b))return copy(l);
  if(object(l)&&object(r)&&(object(b)||b===undefined)){
   const out={};for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const value=merge(b?.[key],l[key],r[key],[...path,key]);if(value!==undefined)out[key]=value;}return out;
  }
  conflicts.push({path,base:copy(b),local:copy(l),remote:copy(r)});return copy(l);
 }
 const result={version:1};
 for(const kind of ['tasks','milestones']){
  const maps=[base,local,remote].map(x=>new Map((x?.[kind]||[]).map(row=>[row.id,row])));
  result[kind]=[];for(const id of new Set(maps.flatMap(m=>[...m.keys()]))){const row=merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),[kind,id]);if(row!==undefined)result[kind].push(row);}
 }
 result.settings=merge(base?.settings,local.settings,remote.settings,['settings']);
 result.exerciseDone=merge(base?.exerciseDone||{},local.exerciseDone,remote.exerciseDone,['exerciseDone']);
 return {data:result,conflicts};
}
export function resolveConflicts(merged,choices){
 const result=copy(merged.data);
 for(let i=0;i<merged.conflicts.length;i++){
  const c=merged.conflicts[i],value=copy(c[choices[i]||'local']),path=[...c.path];
  let root=result;
  if(path[0]==='tasks'||path[0]==='milestones'){
   const [kind,id]=path.splice(0,2),index=result[kind].findIndex(row=>row.id===id);
   if(!path.length){if(value===undefined){if(index>=0)result[kind].splice(index,1);}else if(index>=0)result[kind][index]=value;else result[kind].push(value);continue;}
   root=result[kind][index];
  }
  for(const key of path.slice(0,-1))root=root[key];
  if(value===undefined)delete root[path.at(-1)];else root[path.at(-1)]=value;
 }
 return result;
}
