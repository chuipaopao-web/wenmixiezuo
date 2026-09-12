export interface CardSource {key:string;text:string}
/** Budget includes escaping once more when source JSON becomes a model message. */
export function packCardSources(documents:ReadonlyArray<CardSource>,limit=5500):CardSource[][] {
 const pages:CardSource[][]=[];let page:CardSource[]=[];
 const fits=(items:CardSource[])=>JSON.stringify(JSON.stringify(items)).length<=limit;
 const flush=()=>{if(page.length){pages.push(page);page=[];}};
 if(!Number.isSafeInteger(limit)||limit<100)throw Error('资料页预算无效');
 for(const document of documents){
  if(!fits([{key:document.key,text:''}]))throw Error('单条资料来源标记超过预算');
  if(fits([...page,document])){page.push({...document});continue;}
  flush();
  if(fits([document])){page.push({...document});continue;}
  let offset=0;
  while(offset<document.text.length){
   let low=0,high=document.text.length-offset;
   while(low<high){const mid=Math.ceil((low+high)/2);if(fits([{key:document.key,text:document.text.slice(offset,offset+mid)}]))low=mid;else high=mid-1;}
   // Never split a supplementary Unicode character across pages.
   if(low&&offset+low<document.text.length&&/[\uD800-\uDBFF]/u.test(document.text.charAt(offset+low-1)))low--;
   if(!low)throw Error('单条资料来源标记超过预算');
   page=[{key:document.key,text:document.text.slice(offset,offset+low)}];offset+=low;
   if(offset<document.text.length)flush();
  }
 }
 flush();return pages;
}
