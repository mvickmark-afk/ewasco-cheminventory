import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {feature} from './permissions.js';

const uuid=z.string().uuid();
const iso=z.string().datetime({offset:true});
export const statusTransitions={
  REGISTERED:['RECEIVED','CANCELLED'],
  RECEIVED:['IN_ANALYSIS','CANCELLED'],
  IN_ANALYSIS:['PENDING_REVIEW','CANCELLED'],
  PENDING_REVIEW:['APPROVED','IN_ANALYSIS'],
  APPROVED:['REPORTED'],
  REPORTED:['ARCHIVED'],
  ARCHIVED:[],
  CANCELLED:[]
};

const pointSchema=z.object({
  code:z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._-]+$/),
  name:z.string().trim().min(1).max(200),
  category:z.string().trim().min(1).max(80).default('GENERAL'),
  location:z.string().trim().max(300).optional().nullable(),
  active:z.boolean().optional(),
  metadata:z.record(z.unknown()).optional()
});
const methodSchema=z.object({
  code:z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._-]+$/),
  name:z.string().trim().min(1).max(200),
  analyte:z.string().trim().min(1).max(200),
  matrix:z.string().trim().max(120).optional().nullable(),
  resultType:z.enum(['NUMERIC','TEXT','QUALITATIVE']),
  defaultUnit:z.string().trim().max(40).optional().nullable(),
  methodReference:z.string().trim().max(300).optional().nullable(),
  methodVersion:z.string().trim().max(60).optional().nullable(),
  active:z.boolean().optional(),
  metadata:z.record(z.unknown()).optional()
});
const specSchema=z.object({
  code:z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._-]+$/),
  name:z.string().trim().min(1).max(200),
  parameter:z.string().trim().min(1).max(200),
  operator:z.enum(['BETWEEN','LT','LTE','GT','GTE','EQ','NEQ','IS_NOT_NULL']),
  lowerLimit:z.number().finite().optional().nullable(),
  upperLimit:z.number().finite().optional().nullable(),
  targetUnit:z.string().trim().max(40).optional().nullable(),
  sourceReference:z.string().trim().max(500).optional().nullable(),
  active:z.boolean().optional(),
  metadata:z.record(z.unknown()).optional()
});
const sampleSchema=z.object({
  samplingPointId:uuid.optional().nullable(),
  sampleType:z.string().trim().min(1).max(100),
  matrix:z.string().trim().max(120).optional().nullable(),
  collectedAt:iso.optional().nullable(),
  receivedAt:iso.optional().nullable(),
  collectedBy:uuid.optional().nullable(),
  notes:z.string().max(2000).optional().nullable(),
  tests:z.array(z.object({
    methodId:uuid,
    specificationId:uuid.optional().nullable(),
    priority:z.number().int().min(0).max(1000).optional(),
    assignedTo:uuid.optional().nullable(),
    dueAt:iso.optional().nullable()
  })).min(1).max(100)
});
const resultSchema=z.object({
  valueNumeric:z.number().finite().optional().nullable(),
  valueText:z.string().max(4000).optional().nullable(),
  rawValue:z.string().trim().min(1).max(4000),
  unit:z.string().trim().max(40).optional().nullable(),
  instrumentReference:z.string().trim().max(200).optional().nullable()
}).refine(x=>(x.valueNumeric!==null&&x.valueNumeric!==undefined) !== (x.valueText!==null&&x.valueText!==undefined),'Enter exactly one numeric or text result');

const transition=(from,to)=>Boolean(statusTransitions[from]?.includes(to));
export const evaluate=(value,spec)=>{
  if(!spec)return 'NOT_EVALUATED';
  if(spec.operator==='IS_NOT_NULL')return value===null?'FAIL':'PASS';
  if(typeof value!=='number'||!Number.isFinite(value))return 'NOT_EVALUATED';
  const lo=spec.lower_limit===null?null:Number(spec.lower_limit);
  const hi=spec.upper_limit===null?null:Number(spec.upper_limit);
  if(spec.operator==='BETWEEN')return value>=lo&&value<=hi?'PASS':'FAIL';
  if(spec.operator==='LT')return value<lo?'PASS':'FAIL';
  if(spec.operator==='LTE')return value<=lo?'PASS':'FAIL';
  if(spec.operator==='GT')return value>lo?'PASS':'FAIL';
  if(spec.operator==='GTE')return value>=lo?'PASS':'FAIL';
  if(spec.operator==='EQ')return value===lo?'PASS':'FAIL';
  if(spec.operator==='NEQ')return value!==lo?'PASS':'FAIL';
  return 'NOT_EVALUATED';
};

export function registerLimsRoutes({app,pool,auth,audit}){
  const read=(req,res,next)=>feature(req.user.role,'limsRead')?next():res.status(403).json({error:'LIMS access not permitted'});
  const sampleWrite=(req,res,next)=>feature(req.user.role,'limsSampleCreate')?next():res.status(403).json({error:'Sample registration not permitted'});
  const resultWrite=(req,res,next)=>feature(req.user.role,'limsResultEntry')?next():res.status(403).json({error:'Result entry not permitted'});
  const review=(req,res,next)=>feature(req.user.role,'limsReview')?next():res.status(403).json({error:'Result review not permitted'});
  const approve=(req,res,next)=>feature(req.user.role,'limsApprove')?next():res.status(403).json({error:'Result approval not permitted'});
  const setup=(req,res,next)=>feature(req.user.role,'limsSetup')?next():res.status(403).json({error:'LIMS configuration not permitted'});

  app.get('/api/lims/dashboard',auth,read,async(req,res,next)=>{
    try{
      const [s,t,r]=await Promise.all([
        pool.query("SELECT status,count(*)::int count FROM samples WHERE organization_id=$1 GROUP BY status ORDER BY status",[req.user.organization_id]),
        pool.query("SELECT status,count(*)::int count FROM sample_tests WHERE organization_id=$1 GROUP BY status ORDER BY status",[req.user.organization_id]),
        pool.query("SELECT result_status,count(*)::int count,sum(CASE WHEN result_flag='FAIL' THEN 1 ELSE 0 END)::int failed FROM results WHERE organization_id=$1 GROUP BY result_status ORDER BY result_status",[req.user.organization_id])
      ]);
      res.json({samples:s.rows,tests:t.rows,results:r.rows});
    }catch(e){next(e)}
  });

  app.get('/api/lims/sampling-points',auth,read,async(req,res,next)=>{
    try{res.json((await pool.query("SELECT id,code,name,category,location,active,metadata,created_at,updated_at FROM sampling_points WHERE organization_id=$1 ORDER BY active DESC,name",[req.user.organization_id])).rows)}
    catch(e){next(e)}
  });
  app.post('/api/lims/sampling-points',auth,setup,async(req,res,next)=>{
    try{
      const d=pointSchema.parse(req.body);
      const q=await pool.query("INSERT INTO sampling_points(organization_id,code,name,category,location,active,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[req.user.organization_id,d.code,d.name,d.category,d.location??null,d.active??true,d.metadata??{},req.user.id]);
      await audit(pool,req.user,'lims_create','sampling_points',q.rows[0].id,{code:d.code,name:d.name});
      res.status(201).json(q.rows[0]);
    }catch(e){next(e)}
  });
  app.patch('/api/lims/sampling-points/:id',auth,setup,async(req,res,next)=>{
    try{
      const d=pointSchema.partial().parse(req.body);
      const q=await pool.query("UPDATE sampling_points SET code=COALESCE($1,code),name=COALESCE($2,name),category=COALESCE($3,category),location=COALESCE($4,location),active=COALESCE($5,active),metadata=COALESCE($6,metadata),updated_at=now() WHERE organization_id=$7 AND id=$8 RETURNING *",[d.code??null,d.name??null,d.category??null,d.location??null,d.active??null,d.metadata??null,req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Sampling point not found'});
      await audit(pool,req.user,'lims_update','sampling_points',req.params.id,d);
      res.json(q.rows[0]);
    }catch(e){next(e)}
  });

  app.get('/api/lims/methods',auth,read,async(req,res,next)=>{
    try{res.json((await pool.query("SELECT id,code,name,analyte,matrix,result_type,default_unit,method_reference,method_version,active,metadata,created_at,updated_at FROM test_methods WHERE organization_id=$1 ORDER BY active DESC,name",[req.user.organization_id])).rows)}
    catch(e){next(e)}
  });
  app.post('/api/lims/methods',auth,setup,async(req,res,next)=>{
    try{
      const d=methodSchema.parse(req.body);
      const q=await pool.query("INSERT INTO test_methods(organization_id,code,name,analyte,matrix,result_type,default_unit,method_reference,method_version,active,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[req.user.organization_id,d.code,d.name,d.analyte,d.matrix??null,d.resultType,d.defaultUnit??null,d.methodReference??null,d.methodVersion??null,d.active??true,d.metadata??{},req.user.id]);
      await audit(pool,req.user,'lims_create','test_methods',q.rows[0].id,{code:d.code,name:d.name,version:d.methodVersion??null});
      res.status(201).json(q.rows[0]);
    }catch(e){next(e)}
  });
  app.patch('/api/lims/methods/:id',auth,setup,async(req,res,next)=>{
    try{
      const d=methodSchema.partial().parse(req.body);
      const q=await pool.query("UPDATE test_methods SET code=COALESCE($1,code),name=COALESCE($2,name),analyte=COALESCE($3,analyte),matrix=COALESCE($4,matrix),result_type=COALESCE($5,result_type),default_unit=COALESCE($6,default_unit),method_reference=COALESCE($7,method_reference),method_version=COALESCE($8,method_version),active=COALESCE($9,active),metadata=COALESCE($10,metadata),updated_at=now() WHERE organization_id=$11 AND id=$12 RETURNING *",[d.code??null,d.name??null,d.analyte??null,d.matrix??null,d.resultType??null,d.defaultUnit??null,d.methodReference??null,d.methodVersion??null,d.active??null,d.metadata??null,req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Test method not found'});
      await audit(pool,req.user,'lims_update','test_methods',req.params.id,d);
      res.json(q.rows[0]);
    }catch(e){next(e)}
  });

  app.get('/api/lims/specifications',auth,read,async(req,res,next)=>{
    try{res.json((await pool.query("SELECT id,code,name,parameter,operator,lower_limit,upper_limit,target_unit,source_reference,active,metadata,created_at,updated_at FROM specifications WHERE organization_id=$1 ORDER BY active DESC,name",[req.user.organization_id])).rows)}
    catch(e){next(e)}
  });
  app.post('/api/lims/specifications',auth,setup,async(req,res,next)=>{
    try{
      const d=specSchema.parse(req.body);
      const q=await pool.query("INSERT INTO specifications(organization_id,code,name,parameter,operator,lower_limit,upper_limit,target_unit,source_reference,active,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[req.user.organization_id,d.code,d.name,d.parameter,d.operator,d.lowerLimit??null,d.upperLimit??null,d.targetUnit??null,d.sourceReference??null,d.active??true,d.metadata??{},req.user.id]);
      await audit(pool,req.user,'lims_create','specifications',q.rows[0].id,{code:d.code,name:d.name,sourceReference:d.sourceReference??null});
      res.status(201).json(q.rows[0]);
    }catch(e){next(e)}
  });

  app.get('/api/lims/samples',auth,read,async(req,res,next)=>{
    try{
      const limit=Math.min(Math.max(Number(req.query.limit||100),1),500);
      const status=typeof req.query.status==='string'&&req.query.status.length?req.query.status:null;
      const q=await pool.query(`SELECT s.id,s.sample_no,s.sample_type,s.matrix,s.status,s.collected_at,s.received_at,s.notes,sp.code sampling_point_code,sp.name sampling_point_name,
        (SELECT count(*)::int FROM sample_tests st WHERE st.sample_id=s.id) test_count,
        (SELECT count(*)::int FROM sample_tests st WHERE st.sample_id=s.id AND st.status='APPROVED') approved_test_count
        FROM samples s LEFT JOIN sampling_points sp ON sp.id=s.sampling_point_id
        WHERE s.organization_id=$1 AND ($2::text IS NULL OR s.status=$2)
        ORDER BY s.updated_at DESC LIMIT $3`,[req.user.organization_id,status,limit]);
      res.json(q.rows);
    }catch(e){next(e)}
  });

  app.get('/api/lims/samples/:id',auth,read,async(req,res,next)=>{
    try{
      const q=await pool.query(`SELECT s.*,sp.code sampling_point_code,sp.name sampling_point_name,
        (SELECT COALESCE(json_agg(json_build_object('id',st.id,'status',st.status,'priority',st.priority,'due_at',st.due_at,'method',json_build_object('id',tm.id,'code',tm.code,'name',tm.name,'analyte',tm.analyte,'result_type',tm.result_type,'default_unit',tm.default_unit)),
          ORDER BY tm.name),'[]'::json) FROM sample_tests st JOIN test_methods tm ON tm.id=st.method_id WHERE st.sample_id=s.id) tests
        FROM samples s LEFT JOIN sampling_points sp ON sp.id=s.sampling_point_id
        WHERE s.organization_id=$1 AND s.id=$2 GROUP BY s.id,sp.code,sp.name`,[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Sample not found'});
      const tests=await pool.query(`SELECT st.*,tm.code method_code,tm.name method_name,tm.analyte,tm.result_type,tm.default_unit,
        spc.code specification_code,spc.name specification_name,spc.operator,spc.lower_limit,spc.upper_limit,spc.target_unit,spc.source_reference,
        r.id result_id,r.value_numeric,r.value_text,r.raw_value,r.unit,r.result_flag,r.result_status,r.instrument_reference,r.entered_by,r.entered_at,r.reviewed_by,r.reviewed_at,r.approved_by,r.approved_at
        FROM sample_tests st JOIN test_methods tm ON tm.id=st.method_id
        LEFT JOIN specifications spc ON spc.id=st.specification_id
        LEFT JOIN results r ON r.sample_test_id=st.id
        WHERE st.organization_id=$1 AND st.sample_id=$2 ORDER BY st.priority,tm.name`,[req.user.organization_id,req.params.id]);
      res.json({...q.rows[0],tests:tests.rows});
    }catch(e){next(e)}
  });

  app.post('/api/lims/samples',auth,sampleWrite,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      const d=sampleSchema.parse(req.body);
      await c.query('BEGIN');
      if(d.samplingPointId){
        const p=await c.query("SELECT id FROM sampling_points WHERE organization_id=$1 AND id=$2 AND active=true",[req.user.organization_id,d.samplingPointId]);
        if(!p.rowCount)throw Error('Sampling point not found or inactive');
      }
      const methods=await c.query("SELECT tm.id,tm.result_type,tm.active FROM test_methods tm WHERE tm.organization_id=$1 AND tm.id=ANY($2::uuid[])",[req.user.organization_id,d.tests.map(t=>t.methodId)]);
      if(methods.rowCount!==new Set(d.tests.map(t=>t.methodId)).size)throw Error('One or more test methods are missing or outside this organisation');
      if(methods.rows.some(x=>!x.active))throw Error('Inactive test method cannot be assigned');
      const sample=await c.query("INSERT INTO samples(organization_id,sample_no,sampling_point_id,sample_type,matrix,status,collected_at,received_at,collected_by,received_by,registered_by,notes) VALUES($1,'TEMP',NULLIF($2::uuid,'00000000-0000-0000-0000-000000000000'),$3,$4,'REGISTERED',$5,$6,$7,$8,$9,$10) RETURNING *",[req.user.organization_id,d.samplingPointId??'00000000-0000-0000-0000-000000000000',d.sampleType,d.matrix??null,d.collectedAt??null,d.receivedAt??null,d.collectedBy??null,d.receivedAt?req.user.id:null,req.user.id,d.notes??null]);
      const number=await c.query("SELECT 'SMP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('lims_sample_number_seq')::text,6,'0') sample_no");
      await c.query("UPDATE samples SET sample_no=$1 WHERE id=$2",[number.rows[0].sample_no,sample.rows[0].id]);
      for(const t of d.tests){
        if(t.specificationId){
          const sq=await c.query("SELECT id FROM specifications WHERE organization_id=$1 AND id=$2 AND active=true",[req.user.organization_id,t.specificationId]);
          if(!sq.rowCount)throw Error('Specification not found or inactive');
        }
        await c.query("INSERT INTO sample_tests(organization_id,sample_id,method_id,specification_id,status,priority,assigned_to,due_at) VALUES($1,$2,$3,$4,'PLANNED',$5,$6,$7)",[req.user.organization_id,sample.rows[0].id,t.methodId,t.specificationId??null,t.priority??100,t.assignedTo??null,t.dueAt??null]);
      }
      await audit(c,req.user,'lims_register','samples',sample.rows[0].id,{sampleNo:number.rows[0].sample_no,sampleType:d.sampleType,testCount:d.tests.length});
      await c.query('COMMIT');
      const full=await pool.query("SELECT id,sample_no,status FROM samples WHERE id=$1 AND organization_id=$2",[sample.rows[0].id,req.user.organization_id]);
      res.status(201).json(full.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.patch('/api/lims/samples/:id/status',auth,sampleWrite,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      const body=z.object({status:z.enum(['REGISTERED','RECEIVED','IN_ANALYSIS','PENDING_REVIEW','APPROVED','REPORTED','ARCHIVED','CANCELLED'])}).parse(req.body);
      await c.query('BEGIN');
      const q=await c.query("SELECT * FROM samples WHERE organization_id=$1 AND id=$2 FOR UPDATE",[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Sample not found'});
      const current=q.rows[0].status;
      if(!transition(current,body.status))return res.status(409).json({error:`Invalid sample lifecycle transition: ${current} → ${body.status}`});
      if(['APPROVED','REPORTED','ARCHIVED'].includes(body.status)&&!['Administrator','Laboratory Manager'].includes(req.user.role))return res.status(403).json({error:'Only laboratory management can complete this sample lifecycle action'});
      if(body.status==='APPROVED'){
        const pending=await c.query("SELECT count(*)::int count FROM sample_tests WHERE sample_id=$1 AND status<>'APPROVED'",[req.params.id]);
        if(pending.rows[0].count>0)return res.status(409).json({error:'All tests must be approved before the sample can be approved'});
      }
      const x=await c.query("UPDATE samples SET status=$1,received_at=CASE WHEN $1='RECEIVED' AND received_at IS NULL THEN now() ELSE received_at END,received_by=CASE WHEN $1='RECEIVED' THEN $2 ELSE received_by END,updated_at=now() WHERE id=$3 AND organization_id=$4 RETURNING *",[body.status,req.user.id,req.params.id,req.user.organization_id]);
      await audit(c,req.user,'lims_status', 'samples',req.params.id,{from:current,to:body.status});
      await c.query('COMMIT');
      res.json(x.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.get('/api/lims/worklist',auth,read,async(req,res,next)=>{
    try{
      const status=typeof req.query.status==='string'&&req.query.status.length?req.query.status:null;
      const q=await pool.query(`SELECT st.id,st.status,st.priority,st.assigned_to,st.due_at,s.id sample_id,s.sample_no,s.sample_type,s.sampling_point_id,sp.code sampling_point_code,
        tm.id method_id,tm.code method_code,tm.name method_name,tm.analyte,tm.result_type,tm.default_unit
        FROM sample_tests st JOIN samples s ON s.id=st.sample_id JOIN test_methods tm ON tm.id=st.method_id
        LEFT JOIN sampling_points sp ON sp.id=s.sampling_point_id
        WHERE st.organization_id=$1 AND ($2::text IS NULL OR st.status=$2)
        ORDER BY st.priority ASC,st.due_at NULLS LAST,s.created_at ASC LIMIT 500`,[req.user.organization_id,status]);
      res.json(q.rows);
    }catch(e){next(e)}
  });

  app.post('/api/lims/tests/:id/claim',auth,resultWrite,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const q=await c.query("UPDATE sample_tests SET status=CASE WHEN status='PLANNED' OR status='ASSIGNED' THEN 'IN_PROGRESS' ELSE status END,assigned_to=$1,started_at=COALESCE(started_at,now()),updated_at=now() WHERE organization_id=$2 AND id=$3 AND status IN ('PLANNED','ASSIGNED','IN_PROGRESS') RETURNING *",[req.user.id,req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(409).json({error:'Test cannot be claimed in its current state'});
      await audit(c,req.user,'lims_claim','sample_tests',req.params.id,{assignedTo:req.user.id});
      await c.query('COMMIT');res.json(q.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.post('/api/lims/tests/:id/result',auth,resultWrite,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      const d=resultSchema.parse(req.body);await c.query('BEGIN');
      const q=await c.query(`SELECT st.*,tm.result_type,tm.default_unit,spc.operator,spc.lower_limit,spc.upper_limit,spc.target_unit
        FROM sample_tests st JOIN test_methods tm ON tm.id=st.method_id
        LEFT JOIN specifications spc ON spc.id=st.specification_id
        WHERE st.organization_id=$1 AND st.id=$2 FOR UPDATE`,[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Test not found'});
      const st=q.rows[0];
      if(['APPROVED'].includes(st.status))return res.status(409).json({error:'Approved result is locked'});
      if(st.assigned_to&&st.assigned_to!==req.user.id&&!['Administrator','Laboratory Manager'].includes(req.user.role))return res.status(403).json({error:'This test is assigned to another analyst'});
      const numeric=d.valueNumeric!==null&&d.valueNumeric!==undefined;
      if(st.result_type==='NUMERIC'&&!numeric)return res.status(400).json({error:'This method requires a numeric result'});
      if(st.result_type!=='NUMERIC'&&numeric)return res.status(400).json({error:'This method does not accept a numeric result'});
      const spec=st.operator?st:null;const flag=spec&&numeric?evaluate(d.valueNumeric,spec):(spec&&d.valueText!==null?'NOT_EVALUATED':'NOT_EVALUATED');
      const existing=await c.query("SELECT result_status FROM results WHERE sample_test_id=$1 FOR UPDATE",[req.params.id]);
      if(existing.rowCount&&existing.rows[0].result_status==='APPROVED')return res.status(409).json({error:'Approved result is locked'});
      let r;
      if(existing.rowCount)r=await c.query("UPDATE results SET value_numeric=$1,value_text=$2,raw_value=$3,unit=$4,result_flag=$5,result_status='ENTERED',instrument_reference=$6,entered_by=$7,entered_at=now(),reviewed_by=NULL,reviewed_at=NULL,approved_by=NULL,approved_at=NULL,updated_at=now() WHERE organization_id=$8 AND sample_test_id=$9 RETURNING *",[d.valueNumeric??null,d.valueText??null,d.rawValue,d.unit??st.default_unit??null,flag,d.instrumentReference??null,req.user.id,req.user.organization_id,req.params.id]);
      else r=await c.query("INSERT INTO results(organization_id,sample_test_id,value_numeric,value_text,raw_value,unit,result_flag,result_status,instrument_reference,entered_by) VALUES($1,$2,$3,$4,$5,$6,$7,'ENTERED',$8,$9) RETURNING *",[req.user.organization_id,req.params.id,d.valueNumeric??null,d.valueText??null,d.rawValue,d.unit??st.default_unit??null,flag,d.instrumentReference??null,req.user.id]);
      await c.query("UPDATE sample_tests SET status='RESULT_ENTERED',result_entered_at=now(),updated_at=now() WHERE id=$1",[req.params.id]);
      await c.query("UPDATE samples SET status='IN_ANALYSIS',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('REGISTERED','RECEIVED')",[st.sample_id,req.user.organization_id]);
      await audit(c,req.user,existing.rowCount?'lims_result_update':'lims_result_enter','results',r.rows[0].id,{sampleTestId:req.params.id,resultFlag:flag,unit:r.rows[0].unit});
      await c.query('COMMIT');res.status(existing.rowCount?200:201).json(r.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.post('/api/lims/results/:id/review',auth,review,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const q=await c.query(`SELECT r.*,st.sample_id,st.status test_status FROM results r JOIN sample_tests st ON st.id=r.sample_test_id WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE`,[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Result not found'});
      const r=q.rows[0];if(r.result_status==='APPROVED')return res.status(409).json({error:'Approved result is locked'});if(r.result_status!=='ENTERED')return res.status(409).json({error:'Only entered results can be reviewed'});if(r.entered_by===req.user.id)return res.status(409).json({error:'Independent review is required; the result author cannot review the same result'});
      const x=await c.query("UPDATE results SET result_status='REVIEWED',reviewed_by=$1,reviewed_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING *",[req.user.id,req.params.id,req.user.organization_id]);
      await c.query("UPDATE sample_tests SET status='REVIEWED',reviewed_at=now(),updated_at=now() WHERE id=$1",[r.sample_test_id]);
      await audit(c,req.user,'lims_result_review','results',req.params.id,{sampleTestId:r.sample_test_id});
      await c.query('COMMIT');res.json(x.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.post('/api/lims/results/:id/approve',auth,approve,async(req,res,next)=>{
    const c=await pool.connect();
    try{
      const body=z.object({password:z.string().min(1).max(200)}).parse(req.body);await c.query('BEGIN');
      const u=await c.query("SELECT password_hash FROM users WHERE organization_id=$1 AND id=$2 AND disabled=false FOR UPDATE",[req.user.organization_id,req.user.id]);
      if(!u.rowCount||!(await bcrypt.compare(body.password,u.rows[0].password_hash)))return res.status(403).json({error:'Re-authentication failed'});
      const q=await c.query("SELECT r.*,st.id sample_test_id,st.sample_id,st.status test_status FROM results r JOIN sample_tests st ON st.id=r.sample_test_id WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE",[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Result not found'});
      const r=q.rows[0];if(r.result_status!=='REVIEWED')return res.status(409).json({error:'Result must be reviewed before approval'});if(r.reviewed_by===req.user.id)return res.status(409).json({error:'The reviewer cannot also approve the same result'});if(r.test_status==='APPROVED')return res.status(409).json({error:'Result already approved'});
      const x=await c.query("UPDATE results SET result_status='APPROVED',approved_by=$1,approved_at=now(),updated_at=now() WHERE id=$2 AND organization_id=$3 AND result_status='REVIEWED' RETURNING *",[req.user.id,req.params.id,req.user.organization_id]);
      if(!x.rowCount)return res.status(409).json({error:'Result approval conflict'});
      await c.query("UPDATE sample_tests SET status='APPROVED',approved_at=now(),updated_at=now() WHERE id=$1",[r.sample_test_id]);
      await c.query("UPDATE samples SET status='PENDING_REVIEW',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='IN_ANALYSIS'",[r.sample_id,req.user.organization_id]);
      const remaining=await c.query("SELECT count(*)::int count FROM sample_tests WHERE sample_id=$1 AND status<>'APPROVED'",[r.sample_id]);
      if(remaining.rows[0].count===0)await c.query("UPDATE samples SET status='APPROVED',updated_at=now() WHERE id=$1 AND organization_id=$2",[r.sample_id,req.user.organization_id]);
      await audit(c,req.user,'lims_result_approve','results',req.params.id,{sampleTestId:r.sample_test_id,sampleId:r.sample_id,reauthenticated:true});
      await c.query('COMMIT');res.json(x.rows[0]);
    }catch(e){await c.query('ROLLBACK').catch(()=>{});next(e)}finally{c.release()}
  });

  app.get('/api/lims/results/:id',auth,read,async(req,res,next)=>{
    try{
      const q=await pool.query(`SELECT r.*,st.sample_id,st.status test_status,s.sample_no,tm.code method_code,tm.name method_name,tm.analyte,tm.result_type,
        spc.code specification_code,spc.name specification_name,spc.operator,spc.lower_limit,spc.upper_limit,spc.target_unit,spc.source_reference,
        u1.username entered_by_username,u2.username reviewed_by_username,u3.username approved_by_username
        FROM results r JOIN sample_tests st ON st.id=r.sample_test_id JOIN samples s ON s.id=st.sample_id JOIN test_methods tm ON tm.id=st.method_id
        LEFT JOIN specifications spc ON spc.id=st.specification_id
        LEFT JOIN users u1 ON u1.id=r.entered_by LEFT JOIN users u2 ON u2.id=r.reviewed_by LEFT JOIN users u3 ON u3.id=r.approved_by
        WHERE r.organization_id=$1 AND r.id=$2`,[req.user.organization_id,req.params.id]);
      if(!q.rowCount)return res.status(404).json({error:'Result not found'});res.json(q.rows[0]);
    }catch(e){next(e)}
  });
}
