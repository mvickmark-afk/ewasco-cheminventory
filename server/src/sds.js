import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {getTextExtractor} from 'office-text-extractor';
import {z} from 'zod';
import {feature} from './permissions.js';

const extractor=getTextExtractor();
const MAX_TEXT_LENGTH=2*1024*1024;
const supportedMimes=new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);
const idSchema=z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const casPattern=/\b\d{2,7}-\d{2}-\d\b/g;
const labelPatterns={
  sdsName:[
    /^\s*(?:sds|msds)\s*(?:name|title)\s*[:\-]\s*(.*)$/i,
    /^\s*safety\s+data\s+sheet\s+(?:name|title)\s*[:\-]\s*(.*)$/i,
    /^\s*document\s+title\s*[:\-]\s*(.*)$/i,
    /^\s*title\s*[:\-]\s*(.*)$/i
  ],
  manufacturer:[
    /^\s*manufacturer\s*(?:\/\s*supplier)?\s*[:\-]\s*(.*)$/i,
    /^\s*supplier\s*[:\-]\s*(.*)$/i,
    /^\s*company\s+name\s*[:\-]\s*(.*)$/i
  ],
  product:[
    /^\s*product\s+identifier\s*[:\-]\s*(.*)$/i,
    /^\s*product\s*(?:\/|or)\s*chemical\s*[:\-]\s*(.*)$/i,
    /^\s*chemical\s+name\s*[:\-]\s*(.*)$/i,
    /^\s*substance\s+name\s*[:\-]\s*(.*)$/i,
    /^\s*trade\s+name\s*[:\-]\s*(.*)$/i
  ],
  cas:[
    /^\s*(?:cas(?:\s+registry)?|cas\s*(?:no|number))\s*(?:\.?\s*[:\-])\s*(.*)$/i
  ],
  revisionDate:[
    /^\s*date\s+of\s+last\s+revision\s*[:\-]\s*(.*)$/i,
    /^\s*(?:revision\s+date|date\s+of\s+revision|date\s+of\s+issue|issue\s+date|revision)\s*[:\-]\s*(.*)$/i
  ]
};

const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const isLabelLine=line=>Object.values(labelPatterns).some(ps=>ps.some(re=>re.test(line)));

function findLabeledValue(lines,patterns){
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    for(const re of patterns){
      const m=line.match(re);
      if(!m)continue;
      const direct=clean(m[1]);
      if(direct)return direct;
      for(let j=i+1;j<lines.length;j++){
        const next=clean(lines[j]);
        if(!next)continue;
        if(isLabelLine(next))break;
        return next;
      }
    }
  }
  return null;
}

function uniqueCas(values){
  const distinct=[...new Set(values.filter(Boolean))];
  if(distinct.length===1)return distinct[0];
  if(distinct.length>1)throw Error('Multiple CAS numbers were detected; automatic extraction will not guess which chemical is intended');
  return null;
}

export function parseRevisionDate(value){
  const raw=clean(value);
  if(!raw) return null;
  let y,m,d;
  let x=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(x){y=+x[1];m=+x[2];d=+x[3]}
  else if((x=raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/))){
    const a=+x[1],b=+x[2];y=+x[3];
    if(a<=12&&b<=12)throw Error('Revision date is ambiguous; use a date with an unambiguous format such as YYYY-MM-DD or DD Month YYYY');
    if(a>12){d=a;m=b}else{m=a;d=b}
  }else{
    const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
    x=raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)||raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if(!x)throw Error('Revision date could not be parsed without guessing');
    if(/^\d/.test(x[1])){d=+x[1];m=months[x[2].toLowerCase()];y=+x[3]}
    else{m=months[x[1].toLowerCase()];d=+x[2];y=+x[3]}
  }
  const dt=new Date(Date.UTC(y,m-1,d));
  if(!m||!y||!d||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)throw Error('Invalid revision date');
  return dt.toISOString().slice(0,10);
}

export function extractSdsMetadata(input){
  const text=String(input??'').replace(/\r/g,'\n').replace(/\n+/g,'\n');
  if(text.length>MAX_TEXT_LENGTH)throw Error('Extracted document text exceeds the safety limit');
  const lines=text.split('\n').map(clean).filter(Boolean);
  const sdsName=findLabeledValue(lines,labelPatterns.sdsName);
  const manufacturer=findLabeledValue(lines,labelPatterns.manufacturer);
  const product=findLabeledValue(lines,labelPatterns.product);
  const labeledCas=findLabeledValue(lines,labelPatterns.cas);
  const cas=uniqueCas([...(labeledCas?labeledCas.match(casPattern)||[]:[]),...(labeledCas?[]:text.match(casPattern)||[])]);
  const revisionRaw=findLabeledValue(lines,labelPatterns.revisionDate);
  const revisionDate=revisionRaw?parseRevisionDate(revisionRaw):null;
  const missing=[];
  if(!sdsName)missing.push('SDS/MSDS name');
  if(!manufacturer)missing.push('Manufacturer');
  if(!product)missing.push('Product/Chemical');
  if(!cas)missing.push('CAS number');
  if(!revisionDate)missing.push('Revision date');
  if(missing.length)throw Object.assign(new Error(`Required SDS metadata not unambiguously identified: ${missing.join(', ')}`),{statusCode:422,missing});
  return {name:sdsName,manufacturer,product,cas,revisionDate};
}

export function registerSdsRoutes({app,pool,auth,upload,inspect,audit,dir}){
  const write=(req,res,next)=>feature(req.user.role,'sds')?next():res.status(403).json({error:'Forbidden'});
  app.post('/api/sds/:id/import',auth,write,upload.single('file'),async(req,res,next)=>{
    const c=await pool.connect();
    let committed=false;
    try{
      const sdsId=idSchema.parse(req.params.id);
      if(!req.file)return res.status(400).json({error:'File required'});
      const info=await inspect(req.file);
      if(!supportedMimes.has(info.mime)){
        await fs.unlink(req.file.path).catch(()=>{});
        return res.status(415).json({error:'Only Word (.docx), PDF (.pdf), and Excel (.xlsx) documents are accepted'});
      }
      const buffer=await fs.readFile(req.file.path);
      const extracted=await extractor.extractText({input:buffer,type:'buffer'});
      const metadata=extractSdsMetadata(extracted);
      await c.query('BEGIN');
      const existing=await c.query('SELECT data,version FROM records WHERE organization_id=$1 AND entity=\'sds\' AND id=$2 FOR UPDATE',[req.user.organization_id,sdsId]);
      const data={
        ...(existing.rows[0]?.data||{}),
        id:sdsId,
        name:metadata.name,
        manufacturer:metadata.manufacturer,
        product:metadata.product,
        cas:metadata.cas,
        revisionDate:metadata.revisionDate,
        metadataSource:'document',
        metadataExtraction:'deterministic'
      };
      let record;
      if(existing.rowCount){
        record=await c.query('UPDATE records SET data=$1,version=version+1,updated_at=now() WHERE organization_id=$2 AND entity=\'sds\' AND id=$3 RETURNING id,data,version,updated_at',[data,req.user.organization_id,sdsId]);
      }else{
        record=await c.query('INSERT INTO records(id,organization_id,entity,data) VALUES($1,$2,\'sds\',$3) RETURNING id,data,version,updated_at',[sdsId,req.user.organization_id,data]);
      }
      const q=await c.query('SELECT COALESCE(max(version),0)+1 version FROM sds_versions WHERE organization_id=$1 AND sds_id=$2',[req.user.organization_id,sdsId]);
      const version=q.rows[0].version;
      await c.query('INSERT INTO sds_versions(organization_id,sds_id,version,file_name,mime,size,stored_name,sha256,revision_date,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[req.user.organization_id,sdsId,version,req.file.originalname,info.mime,req.file.size,req.file.filename,info.sha256,metadata.revisionDate,req.user.id]);
      await audit(c,req.user,'sds_auto_import','sds',sdsId,{version,fileName:req.file.originalname,mime:info.mime,sha256:info.sha256,metadata});
      await c.query('COMMIT');committed=true;
      res.status(201).json({id:sdsId,version,metadata,fileName:req.file.originalname});
    }catch(e){
      await c.query('ROLLBACK').catch(()=>{});
      if(req.file&&!committed)await fs.unlink(req.file.path).catch(()=>{});
      next(e);
    }finally{
      c.release();
    }
  });
}
