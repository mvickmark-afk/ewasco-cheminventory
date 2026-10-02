import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {z} from 'zod';
import {feature} from './permissions.js';

const text=z.string().trim().min(1).max(300);
const uuid=z.string().uuid();
const calibrationPoint=z.object({
  point:z.string().trim().min(1).max(80),
  nominal:z.number().finite(),
  measured:z.number().finite(),
  unit:z.string().trim().max(40).optional().nullable(),
  tolerance:z.number().finite().nonnegative().optional().nullable(),
  error:z.number().finite().optional().nullable(),
  standardReference:z.string().trim().max(300).optional().nullable()
}).superRefine((p,ctx)=>{
  const error=p.error??(p.measured-p.nominal);
  if(p.tolerance!=null&&Math.abs(error)>p.tolerance)ctx.addIssue({code:z.ZodIssueCode.custom,path:['error'],message:'Measured value exceeds the declared tolerance'});
});
const readOnly=(req,res,next)=>feature(req.user.role,'limsRead')?next():res.status(403).json({error:'LIMS access not permitted'});
const setup=(req,res,next)=>feature(req.user.role,'limsSetup')?next():res.status(403).json({error:'LIMS configuration not permitted'});
const write=(req,res,next)=>feature(req.user.role,'limsResultEntry')?next():res.status(403).json({error:'LIMS operation not permitted'});

export function evaluateQcFlag({valueNumeric,lowerLimit,upperLimit}){
  if(valueNumeric==null || (lowerLimit==null && upperLimit==null))return 'NOT_EVALUATED';
  if(lowerLimit!=null && upperLimit!=null && lowerLimit>upperLimit)throw Object.assign(new Error('Lower limit cannot exceed upper limit'),{statusCode:422});
  if(lowerLimit!=null && valueNumeric<lowerLimit)return 'FAIL';
  if(upperLimit!=null && valueNumeric>upperLimit)return 'FAIL';
  return 'PASS';
}

export function canTransitionBatch(from,to){
  const transitions={OPEN:['IN_PROGRESS','REJECTED'],IN_PROGRESS:['COMPLETED','REJECTED'],COMPLETED:['ACCEPTED','REJECTED'],ACCEPTED:[],REJECTED:[]};
  return Boolean(transitions[from]?.includes(to));
}

export function registerLimsPhaseRoutes({app,pool,audit}){
  const authenticated=async(req,res,next)=>{try{const token=req.cookies?.ewasco_session;if(!token)return res.status(401).json({error:'Authentication required'});const q=await pool.query('SELECT u.id,u.organization_id,u.username,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()',[crypto.createHash('sha256').update(token).digest('hex')]);if(!q.rowCount)return res.status(401).json({error:'Invalid or expired session'});req.user=q.rows[0];jwt.verify(token,process.env.JWT_SECRET,{issuer:'ewasco',audience:'ewasco-web'});next()}catch{res.status(401).json({error:'Invalid or expired session'})}};
  app.get('/api/lims/phase-status',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query("SELECT (SELECT count(*)::int FROM samples WHERE organization_id=$1) samples,(SELECT count(*)::int FROM sampling_schedules WHERE organization_id=$1) schedules,(SELECT count(*)::int FROM chain_of_custody WHERE organization_id=$1) custody,(SELECT count(*)::int FROM analytical_batches WHERE organization_id=$1) batches,(SELECT count(*)::int FROM qc_results WHERE organization_id=$1) qc,(SELECT count(*)::int FROM instruments WHERE organization_id=$1) instruments,(SELECT count(*)::int FROM controlled_documents WHERE organization_id=$1) documents,(SELECT count(*)::int FROM deviations WHERE organization_id=$1) deviations,(SELECT count(*)::int FROM reports WHERE organization_id=$1) reports,(SELECT count(*)::int FROM integration_events WHERE organization_id=$1) integrations",[req.user.organization_id]);
    const x=q.rows[0];res.json({phase1:{status:'ACTIVE',samples:x.samples},phase2:{status:'FOUNDATION',schedules:x.schedules,custody:x.custody},phase3:{status:'FOUNDATION',batches:x.batches,qc:x.qc},phase4:{status:'FOUNDATION',instruments:x.instruments},phase5:{status:'FOUNDATION',documents:x.documents,deviations:x.deviations},phase6:{status:'FOUNDATION',reports:x.reports,integrations:x.integrations}});
  }catch(e){next(e)}});

  const list=(path,table,columns,order)=>app.get(path,authenticated,readOnly,async(req,res,next)=>{try{const q=await pool.query("SELECT "+columns+" FROM "+table+" WHERE organization_id=$1 ORDER BY "+(order||'created_at DESC')+" LIMIT 500",[req.user.organization_id]);res.json(q.rows)}catch(e){next(e)}});
  list('/api/lims/schedules','sampling_schedules','id,code,name,sampling_point_id,frequency,next_due_at,active,metadata,created_at,updated_at');
  list('/api/lims/custody','chain_of_custody','id,sample_id,coc_no,status,collector_id,collected_at,received_by,received_at,transport_details,receipt_condition,exception_reason,metadata,created_at');
  list('/api/lims/batches','analytical_batches','id,batch_no,batch_type,method_id,status,started_at,completed_at,accepted_at,created_by,metadata,created_at,updated_at');
  list('/api/lims/qc','qc_results','id,batch_id,sample_test_id,qc_type,value_numeric,expected_value,lower_limit,upper_limit,flag,notes,created_by,created_at');
  list('/api/lims/instruments','instruments','id,asset_no,name,manufacturer,model,serial_no,location,status,calibration_due_at,metadata,created_by,created_at,updated_at');
  list('/api/lims/calibrations','calibration_records','id,instrument_id,performed_at,due_at,status,standard_reference,points,certificate_file,performed_by,notes,created_at');
  list('/api/lims/documents','controlled_documents','id,document_no,title,document_type,status,current_version,owner_id,created_at,updated_at');
  list('/api/lims/deviations','deviations','id,deviation_no,title,description,severity,status,owner_id,due_at,closed_at,created_by,created_at');
  list('/api/lims/capa','capa_actions','id,capa_no,source_type,source_id,description,action_type,owner_id,due_at,status,verified_by,verified_at,created_by,created_at');
  list('/api/lims/audits','audit_plans','id,audit_no,audit_type,scope,scheduled_at,status,lead_id,findings,created_at');
  list('/api/lims/change-controls','change_controls','id,change_no,title,rationale,impact_assessment,status,requested_by,approved_by,implemented_at,created_at');
  list('/api/lims/reports','reports','id,report_no,report_type,sample_id,status,version,issued_at,issued_by,file_name,sha256,created_at');
  list('/api/lims/notifications','notifications','id,user_id,event_type,severity,title,message,entity,record_id,read_at,created_at');
  list('/api/lims/integrations/events','integration_events','id,source,event_type,external_id,payload,status,error_message,received_at,processed_at','received_at DESC');
  list('/api/lims/calculations','calculations','id,sample_test_id,formula_code,formula_version,inputs,output_value,output_unit,intermediates,calculated_by,calculated_at','calculated_at DESC');
  list('/api/lims/hold-time-rules','hold_time_rules','id,method_id,hours,warning_hours,source_reference,active');

  app.post('/api/lims/schedules',authenticated,setup,async(req,res,next)=>{try{const d=z.object({code:text,name:text,samplingPointId:uuid.optional().nullable(),frequency:text,nextDueAt:z.string().datetime({offset:true}).optional().nullable(),active:z.boolean().optional(),metadata:z.record(z.unknown()).optional()}).parse(req.body);const q=await pool.query('INSERT INTO sampling_schedules(organization_id,code,name,sampling_point_id,frequency,next_due_at,active,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.organization_id,d.code,d.name,d.samplingPointId??null,d.frequency,d.nextDueAt??null,d.active??true,d.metadata??{},req.user.id]);await audit(pool,req.user,'lims_schedule_create','sampling_schedules',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/custody',authenticated,write,async(req,res,next)=>{try{const d=z.object({sampleId:uuid,cocNo:text,collectorId:uuid.optional().nullable(),collectedAt:z.string().datetime({offset:true}).optional().nullable(),transportDetails:z.string().max(1000).optional().nullable(),metadata:z.record(z.unknown()).optional()}).parse(req.body);const q=await pool.query('INSERT INTO chain_of_custody(organization_id,sample_id,coc_no,collector_id,collected_at,transport_details,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.organization_id,d.sampleId,d.cocNo,d.collectorId??req.user.id,d.collectedAt??null,d.transportDetails??null,d.metadata??{}]);await audit(pool,req.user,'lims_coc_create','chain_of_custody',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/containers',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({sampleId:uuid,containerCode:text,containerType:z.string().max(120).optional().nullable(),preservative:z.string().max(200).optional().nullable(),volume:z.number().finite().nonnegative().optional().nullable(),unit:z.string().max(30).optional().nullable(),condition:z.string().max(100).optional().nullable(),collectedAt:z.string().datetime({offset:true}).optional().nullable(),temperature:z.number().finite().optional().nullable(),notes:z.string().max(1000).optional().nullable()}).parse(req.body);
    const sample=await pool.query('SELECT id FROM samples WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.sampleId]);if(!sample.rowCount)return res.status(404).json({error:'Sample not found'});
    const q=await pool.query('INSERT INTO sample_containers(organization_id,sample_id,container_code,container_type,preservative,volume,unit,condition,collected_at,temperature,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[req.user.organization_id,d.sampleId,d.containerCode,d.containerType??null,d.preservative??null,d.volume??null,d.unit??null,d.condition??null,d.collectedAt??null,d.temperature??null,d.notes??null]);
    await audit(pool,req.user,'lims_container_create','sample_containers',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.post('/api/lims/custody/:id/events',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({eventType:text,fromUserId:uuid.optional().nullable(),toUserId:uuid.optional().nullable(),eventAt:z.string().datetime({offset:true}).optional(),notes:z.string().max(1000).optional().nullable(),metadata:z.record(z.unknown()).optional()}).parse(req.body);
    const coc=await pool.query('SELECT id,status FROM chain_of_custody WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);if(!coc.rowCount)return res.status(404).json({error:'Chain of custody record not found'});
    if(coc.rows[0].status==='CLOSED')return res.status(409).json({error:'Closed chain of custody cannot receive new events'});
    const q=await pool.query('INSERT INTO custody_events(organization_id,chain_id,event_type,from_user_id,to_user_id,event_at,notes,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.organization_id,req.params.id,d.eventType,d.fromUserId??null,d.toUserId??null,d.eventAt??new Date().toISOString(),d.notes??null,d.metadata??{}]);
    await audit(pool,req.user,'lims_custody_event','custody_events',q.rows[0].id,{chainId:req.params.id,...d});res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.patch('/api/lims/custody/:id/status',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({status:z.enum(['OPEN','IN_TRANSIT','RECEIVED','CLOSED','EXCEPTION']),receivedBy:uuid.optional().nullable(),receivedAt:z.string().datetime({offset:true}).optional().nullable(),receiptCondition:z.string().max(500).optional().nullable(),exceptionReason:z.string().max(1000).optional().nullable()}).parse(req.body);
    if(d.status==='EXCEPTION'&&!d.exceptionReason)throw Object.assign(new Error('Exception reason is required'),{statusCode:422});
    const q=await pool.query('UPDATE chain_of_custody SET status=$1,received_by=COALESCE($2,received_by),received_at=COALESCE($3,received_at),receipt_condition=COALESCE($4,receipt_condition),exception_reason=COALESCE($5,exception_reason) WHERE organization_id=$6 AND id=$7 RETURNING *',[d.status,d.receivedBy??null,d.receivedAt??null,d.receiptCondition??null,d.exceptionReason??null,req.user.organization_id,req.params.id]);
    if(!q.rowCount)return res.status(404).json({error:'Chain of custody record not found'});
    await audit(pool,req.user,'lims_custody_status','chain_of_custody',req.params.id,{status:d.status});res.json(q.rows[0])
  }catch(e){next(e)}});
  app.post('/api/lims/batches',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({batchNo:text,batchType:z.enum(['ANALYTICAL','PREPARATION','QC','CALIBRATION']),methodId:uuid.optional().nullable(),requiredQcTypes:z.array(z.enum(['BLANK','DUPLICATE','SPIKE','LCS','CALIBRATION_CHECK','REFERENCE_MATERIAL'])).max(6).optional(),metadata:z.record(z.unknown()).optional()}).parse(req.body);
    if(d.methodId){const m=await pool.query('SELECT id FROM test_methods WHERE organization_id=$1 AND id=$2 AND active=true',[req.user.organization_id,d.methodId]);if(!m.rowCount)return res.status(422).json({error:'Batch method not found or inactive'});}
    const metadata={...(d.metadata??{}),...(d.requiredQcTypes?{requiredQcTypes:[...new Set(d.requiredQcTypes)]}:{})};
    const q=await pool.query('INSERT INTO analytical_batches(organization_id,batch_no,batch_type,method_id,created_by,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[req.user.organization_id,d.batchNo,d.batchType,d.methodId??null,req.user.id,metadata]);await audit(pool,req.user,'lims_batch_create','analytical_batches',q.rows[0].id,{...d,metadata});res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.get('/api/lims/batches/:id/members',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query(`SELECT bm.id,bm.batch_id,bm.sample_test_id,bm.created_at,st.status test_status,s.sample_no,s.sample_type,tm.id method_id,tm.code method_code,tm.name method_name,tm.analyte,r.id result_id,r.result_flag,r.result_status
      FROM batch_members bm JOIN sample_tests st ON st.organization_id=bm.organization_id AND st.id=bm.sample_test_id JOIN samples s ON s.organization_id=st.organization_id AND s.id=st.sample_id JOIN test_methods tm ON tm.id=st.method_id LEFT JOIN results r ON r.sample_test_id=st.id
      WHERE bm.organization_id=$1 AND bm.batch_id=$2 ORDER BY bm.created_at`,[req.user.organization_id,req.params.id]);res.json(q.rows)
  }catch(e){next(e)}});
  app.post('/api/lims/batches/:id/members',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({sampleTestId:uuid}).parse(req.body);
    const check=await pool.query('SELECT id,method_id,status FROM analytical_batches WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);if(!check.rowCount)return res.status(404).json({error:'Batch not found'});
    if(['COMPLETED','ACCEPTED','REJECTED'].includes(check.rows[0].status))return res.status(409).json({error:'Batch membership is locked after completion'});
    const st=await pool.query('SELECT id,method_id,status FROM sample_tests WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.sampleTestId]);if(!st.rowCount)return res.status(404).json({error:'Sample test not found'});
    if(check.rows[0].method_id&&check.rows[0].method_id!==st.rows[0].method_id)return res.status(422).json({error:'Sample test method does not match the batch method'});
    const q=await pool.query('INSERT INTO batch_members(organization_id,batch_id,sample_test_id) VALUES($1,$2,$3) RETURNING *',[req.user.organization_id,req.params.id,d.sampleTestId]);await audit(pool,req.user,'lims_batch_member_add','batch_members',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});

  app.patch('/api/lims/batches/:id/status',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({status:z.enum(['OPEN','IN_PROGRESS','COMPLETED','ACCEPTED','REJECTED'])}).parse(req.body);
    const current=await pool.query('SELECT * FROM analytical_batches WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);
    if(!current.rowCount)return res.status(404).json({error:'Batch not found'});
    const from=current.rows[0].status;
    if(!canTransitionBatch(from,d.status))return res.status(409).json({error:'Invalid batch status transition',from,to:d.status});
    if(d.status==='ACCEPTED'){
      const blockers=await pool.query(`SELECT 'QC_FAIL' AS type,q.id,q.qc_type,q.flag FROM qc_results q WHERE q.organization_id=$1 AND q.batch_id=$2 AND q.flag='FAIL'
        UNION ALL
        SELECT 'HOLD_TIME_EXPIRED' AS type,st.id,st.status,NULL FROM batch_members bm JOIN sample_tests st ON st.organization_id=bm.organization_id AND st.id=bm.sample_test_id
        JOIN samples s ON s.organization_id=st.organization_id AND s.id=st.sample_id JOIN hold_time_rules hr ON hr.organization_id=st.organization_id AND hr.method_id=st.method_id AND hr.active=true
        WHERE bm.organization_id=$1 AND bm.batch_id=$2 AND s.collected_at IS NOT NULL AND now()>s.collected_at+(hr.hours*interval '1 hour')
        UNION ALL
        SELECT 'QC_REQUIRED_MISSING' AS type,NULL,req.qc_type,NULL FROM analytical_batches b CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.metadata->'requiredQcTypes','[]'::jsonb)) req(qc_type)
        WHERE b.organization_id=$1 AND b.id=$2 AND NOT EXISTS (SELECT 1 FROM qc_results q WHERE q.organization_id=b.organization_id AND q.batch_id=b.id AND q.qc_type=req.qc_type AND q.flag='PASS')`,[req.user.organization_id,req.params.id]);
      if(blockers.rowCount)return res.status(409).json({error:'Batch cannot be accepted while quality gates are failing',blockers:blockers.rows});
    }
    const fields={OPEN:'started_at',IN_PROGRESS:'started_at',COMPLETED:'completed_at',ACCEPTED:'accepted_at',REJECTED:'completed_at'};
    const col=fields[d.status];
    const q=await pool.query('UPDATE analytical_batches SET status=$1,'+col+'=COALESCE('+col+',now()),updated_at=now() WHERE organization_id=$2 AND id=$3 RETURNING *',[d.status,req.user.organization_id,req.params.id]);
    await audit(pool,req.user,'lims_batch_status','analytical_batches',req.params.id,{from,to:d.status});res.json(q.rows[0])
  }catch(e){next(e)}});
  app.get('/api/lims/hold-time/:sampleTestId',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query(`SELECT st.id,st.sample_id,st.method_id,s.collected_at,hr.hours,hr.warning_hours,hr.source_reference,
      CASE WHEN s.collected_at IS NULL THEN 'NO_COLLECTION_TIME'
           WHEN now()>s.collected_at+(hr.hours*interval '1 hour') THEN 'EXPIRED'
           WHEN hr.warning_hours IS NOT NULL AND now()>s.collected_at+((hr.hours-hr.warning_hours)*interval '1 hour') THEN 'WARNING'
           ELSE 'WITHIN_LIMIT' END AS hold_status
      FROM sample_tests st JOIN samples s ON s.organization_id=st.organization_id AND s.id=st.sample_id
      LEFT JOIN hold_time_rules hr ON hr.organization_id=st.organization_id AND hr.method_id=st.method_id AND hr.active=true
      WHERE st.organization_id=$1 AND st.id=$2`,[req.user.organization_id,req.params.sampleTestId]);
    if(!q.rowCount)return res.status(404).json({error:'Sample test not found'});
    res.json(q.rows[0])
  }catch(e){next(e)}});
  app.post('/api/lims/qc',authenticated,write,async(req,res,next)=>{try{const d=z.object({batchId:uuid,sampleTestId:uuid.optional().nullable(),qcType:z.enum(['BLANK','DUPLICATE','SPIKE','LCS','CALIBRATION_CHECK','REFERENCE_MATERIAL']),valueNumeric:z.number().finite().optional().nullable(),expectedValue:z.number().finite().optional().nullable(),lowerLimit:z.number().finite().optional().nullable(),upperLimit:z.number().finite().optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const batch=await pool.query('SELECT id,status FROM analytical_batches WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.batchId]);if(!batch.rowCount)return res.status(404).json({error:'Batch not found'});
    if(['ACCEPTED','REJECTED'].includes(batch.rows[0].status))return res.status(409).json({error:'QC cannot be added to a closed batch'});
    if(d.sampleTestId){const st=await pool.query('SELECT id FROM sample_tests WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.sampleTestId]);if(!st.rowCount)return res.status(404).json({error:'Sample test not found'});}
    const flag=evaluateQcFlag(d);const q=await pool.query('INSERT INTO qc_results(organization_id,batch_id,sample_test_id,qc_type,value_numeric,expected_value,lower_limit,upper_limit,flag,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[req.user.organization_id,d.batchId,d.sampleTestId??null,d.qcType,d.valueNumeric??null,d.expectedValue??null,d.lowerLimit??null,d.upperLimit??null,flag,d.notes??null,req.user.id]);await audit(pool,req.user,'lims_qc_create','qc_results',q.rows[0].id,{...d,flag});res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.get('/api/lims/trend-rules',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query('SELECT * FROM trend_rules WHERE organization_id=$1 ORDER BY created_at DESC',[req.user.organization_id]);res.json(q.rows)
  }catch(e){next(e)}});
  app.post('/api/lims/trend-rules',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({methodId:uuid,minObservations:z.number().int().min(3).max(1000).optional(),warningSigma:z.number().finite().positive().max(10).optional(),actionSigma:z.number().finite().positive().max(20).optional(),active:z.boolean().optional(),sourceReference:z.string().max(300).optional().nullable()}).parse(req.body);
    const method=await pool.query('SELECT id FROM test_methods WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.methodId]);if(!method.rowCount)return res.status(404).json({error:'Test method not found'});
    const min=d.minObservations??10, warning=d.warningSigma??2, action=d.actionSigma??3;if(action<warning)return res.status(422).json({error:'Action sigma must be greater than or equal to warning sigma'});
    const q=await pool.query('INSERT INTO trend_rules(organization_id,method_id,min_observations,warning_sigma,action_sigma,active,source_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,method_id) DO UPDATE SET min_observations=EXCLUDED.min_observations,warning_sigma=EXCLUDED.warning_sigma,action_sigma=EXCLUDED.action_sigma,active=EXCLUDED.active,source_reference=EXCLUDED.source_reference RETURNING *',[req.user.organization_id,d.methodId,min,warning,action,d.active??true,d.sourceReference??null,req.user.id]);
    await audit(pool,req.user,'lims_trend_rule_upsert','trend_rules',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.get('/api/lims/trends/:sampleTestId',authenticated,readOnly,async(req,res,next)=>{try{
    const st=await pool.query('SELECT st.id,st.method_id,tm.code method_code,tm.name method_name,r.id result_id,r.value_numeric,r.result_status,r.entered_at FROM sample_tests st JOIN test_methods tm ON tm.id=st.method_id LEFT JOIN results r ON r.sample_test_id=st.id WHERE st.organization_id=$1 AND st.id=$2',[req.user.organization_id,req.params.sampleTestId]);
    if(!st.rowCount)return res.status(404).json({error:'Sample test not found'});
    const current=st.rows[0];if(current.value_numeric==null)return res.json({sampleTestId:current.id,methodId:current.method_id,status:'NOT_EVALUATED',reason:'Current result is not numeric'});
    const rule=await pool.query('SELECT * FROM trend_rules WHERE organization_id=$1 AND method_id=$2 AND active=true',[req.user.organization_id,current.method_id]);
    if(!rule.rowCount)return res.json({sampleTestId:current.id,methodId:current.method_id,status:'NOT_EVALUATED',reason:'No active trend rule'});
    const rr=rule.rows[0];
    const hist=await pool.query('SELECT r.value_numeric,r.entered_at FROM results r JOIN sample_tests st ON st.organization_id=r.organization_id AND st.id=r.sample_test_id WHERE r.organization_id=$1 AND st.method_id=$2 AND r.value_numeric IS NOT NULL AND r.id<>$3 ORDER BY r.entered_at DESC LIMIT 1000',[req.user.organization_id,current.method_id,current.result_id]);
    if(hist.rowCount<rr.min_observations)return res.json({sampleTestId:current.id,methodId:current.method_id,status:'NOT_EVALUATED',reason:'Insufficient historical observations',observations:hist.rowCount,minObservations:rr.min_observations});
    const vals=hist.rows.map(x=>Number(x.value_numeric));const mean=vals.reduce((a,b)=>a+b,0)/vals.length;const variance=vals.reduce((a,b)=>a+(b-mean)**2,0)/(vals.length-1);const sd=Math.sqrt(variance);
    if(!Number.isFinite(sd)||sd===0)return res.json({sampleTestId:current.id,methodId:current.method_id,status:'NOT_EVALUATED',reason:'Historical standard deviation is zero',mean,standardDeviation:sd,observations:vals.length});
    const zScore=Math.abs((Number(current.value_numeric)-mean)/sd);const status=zScore>=rr.action_sigma?'OOT_ACTION':zScore>=rr.warning_sigma?'OOT_WARNING':'WITHIN_CONTROL';
    res.json({sampleTestId:current.id,methodId:current.method_id,status,zScore,mean,standardDeviation:sd,observations:vals.length,warningSigma:Number(rr.warning_sigma),actionSigma:Number(rr.action_sigma)})
  }catch(e){next(e)}});
  app.post('/api/lims/trends/:sampleTestId/evaluate',authenticated,write,async(req,res,next)=>{try{
    const st=await pool.query('SELECT st.id,st.method_id,r.id result_id,r.value_numeric FROM sample_tests st JOIN results r ON r.sample_test_id=st.id WHERE st.organization_id=$1 AND st.id=$2',[req.user.organization_id,req.params.sampleTestId]);if(!st.rowCount)return res.status(404).json({error:'Numeric result not found'});
    const current=st.rows[0];if(current.value_numeric==null)return res.status(422).json({error:'Trend evaluation requires a numeric result'});
    const rule=await pool.query('SELECT * FROM trend_rules WHERE organization_id=$1 AND method_id=$2 AND active=true',[req.user.organization_id,current.method_id]);if(!rule.rowCount)return res.status(422).json({error:'No active trend rule for this method'});
    const rr=rule.rows[0];const hist=await pool.query('SELECT r.value_numeric FROM results r JOIN sample_tests st ON st.organization_id=r.organization_id AND st.id=r.sample_test_id WHERE r.organization_id=$1 AND st.method_id=$2 AND r.value_numeric IS NOT NULL AND r.id<>$3 ORDER BY r.entered_at DESC LIMIT 1000',[req.user.organization_id,current.method_id,current.result_id]);if(hist.rowCount<rr.min_observations)return res.status(422).json({error:'Insufficient historical observations',observations:hist.rowCount,minObservations:rr.min_observations});
    const vals=hist.rows.map(x=>Number(x.value_numeric)),mean=vals.reduce((a,b)=>a+b,0)/vals.length,sd=Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/(vals.length-1));if(!Number.isFinite(sd)||sd===0)return res.status(422).json({error:'Historical standard deviation is zero'});
    const zScore=Math.abs((Number(current.value_numeric)-mean)/sd);const eventType=zScore>=rr.warning_sigma?'OOT':null;
    let event=null;if(eventType){const ex=await pool.query('SELECT id FROM quality_events WHERE organization_id=$1 AND result_id=$2 AND event_type=$3 AND status<>$4 LIMIT 1',[req.user.organization_id,current.result_id,eventType,'CLOSED']);if(!ex.rowCount){const qe=await pool.query('INSERT INTO quality_events(organization_id,sample_test_id,result_id,event_type,trigger_source,description,detected_by,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.organization_id,current.id,current.result_id,eventType,'TREND_CONTROL_CHART',zScore>=rr.action_sigma?'Result exceeded action control limit':'Result exceeded warning control limit',req.user.id,{zScore,mean,standardDeviation:sd,observations:vals.length}]);event=qe.rows[0];await audit(pool,req.user,'lims_quality_event_trend','quality_events',event.id,{sampleTestId:current.id,resultId:current.result_id,eventType,zScore})}}
    res.json({sampleTestId:current.id,resultId:current.result_id,status:eventType??'WITHIN_CONTROL',zScore,mean,standardDeviation:sd,observations:vals.length,event})
  }catch(e){next(e)}});
  app.get('/api/lims/quality-events',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query(`SELECT qe.*,s.sample_id,s.sample_no FROM quality_events qe
      LEFT JOIN sample_tests st ON st.organization_id=qe.organization_id AND st.id=qe.sample_test_id
      LEFT JOIN samples s ON s.organization_id=st.organization_id AND s.id=st.sample_id
      WHERE qe.organization_id=$1 ORDER BY qe.detected_at DESC LIMIT 500`,[req.user.organization_id]);
    res.json(q.rows)
  }catch(e){next(e)}});
  app.post('/api/lims/quality-events',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({sampleTestId:uuid.optional().nullable(),resultId:uuid.optional().nullable(),eventType:z.enum(['OOS','OOT']),triggerSource:text,description:z.string().max(3000).optional().nullable(),metadata:z.record(z.unknown()).optional()}).parse(req.body);
    if(d.resultId){const r=await pool.query('SELECT id,sample_test_id,result_flag FROM results WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.resultId]);if(!r.rowCount)return res.status(404).json({error:'Result not found'});if(d.sampleTestId&&r.rows[0].sample_test_id!==d.sampleTestId)return res.status(422).json({error:'Result does not belong to sample test'});}
    if(d.sampleTestId){const st=await pool.query('SELECT id FROM sample_tests WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.sampleTestId]);if(!st.rowCount)return res.status(404).json({error:'Sample test not found'});}
    const q=await pool.query('INSERT INTO quality_events(organization_id,sample_test_id,result_id,event_type,trigger_source,description,detected_by,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[req.user.organization_id,d.sampleTestId??null,d.resultId??null,d.eventType,d.triggerSource,d.description??null,req.user.id,d.metadata??{}]);
    await audit(pool,req.user,'lims_quality_event_create','quality_events',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.post('/api/lims/calculations',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({sampleTestId:uuid,formulaCode:text,formulaVersion:z.string().max(50).regex(/^v?[0-9]+(?:\\.[0-9]+)*$/),inputs:z.record(z.unknown()).default({}),outputValue:z.number().finite().optional().nullable(),outputUnit:z.string().max(50).optional().nullable(),intermediates:z.record(z.unknown()).default({})}).parse(req.body);
    const st=await pool.query('SELECT id FROM sample_tests WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.sampleTestId]);if(!st.rowCount)return res.status(404).json({error:'Sample test not found'});
    const q=await pool.query('INSERT INTO calculations(organization_id,sample_test_id,formula_code,formula_version,inputs,output_value,output_unit,intermediates,calculated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.organization_id,d.sampleTestId,d.formulaCode,d.formulaVersion,d.inputs,d.outputValue??null,d.outputUnit??null,d.intermediates,req.user.id]);
    await audit(pool,req.user,'lims_calculation_create','calculations',q.rows[0].id,{sampleTestId:d.sampleTestId,formulaCode:d.formulaCode,formulaVersion:d.formulaVersion});res.status(201).json(q.rows[0])
  }catch(e){next(e)}});

  app.get('/api/lims/instruments/:id/files',authenticated,readOnly,async(req,res,next)=>{try{const q=await pool.query('SELECT * FROM instrument_files WHERE organization_id=$1 AND instrument_id=$2 ORDER BY imported_at DESC LIMIT 500',[req.user.organization_id,req.params.id]);res.json(q.rows)}catch(e){next(e)}});
  app.post('/api/lims/instruments/:id/files',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({fileName:text,mime:z.string().max(150).optional().nullable(),size:z.number().int().nonnegative().max(50*1024*1024).optional().nullable(),sha256:z.string().regex(/^[a-fA-F0-9]{64}$/).optional().nullable(),storedName:z.string().max(500).optional().nullable(),status:z.enum(['RECEIVED','PROCESSED','REJECTED']).optional(),errorMessage:z.string().max(1000).optional().nullable()}).parse(req.body);
    const i=await pool.query('SELECT id FROM instruments WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);if(!i.rowCount)return res.status(404).json({error:'Instrument not found'});
    const q=await pool.query('INSERT INTO instrument_files(organization_id,instrument_id,file_name,mime,size,sha256,stored_name,imported_by,status,error_message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.organization_id,req.params.id,d.fileName,d.mime??null,d.size??null,d.sha256??null,d.storedName??null,req.user.id,d.status??'RECEIVED',d.errorMessage??null]);
    await audit(pool,req.user,'lims_instrument_file_register','instrument_files',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.get('/api/lims/instruments/:id/readiness',authenticated,readOnly,async(req,res,next)=>{try{
    const i=await pool.query('SELECT id,asset_no,name,status,calibration_due_at FROM instruments WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);if(!i.rowCount)return res.status(404).json({error:'Instrument not found'});
    const x=i.rows[0], c=await pool.query("SELECT status,performed_at,due_at FROM calibration_records WHERE organization_id=$1 AND instrument_id=$2 ORDER BY performed_at DESC LIMIT 1",[req.user.organization_id,x.id]), q=await pool.query("SELECT status,performed_at,due_at FROM instrument_qualifications WHERE organization_id=$1 AND instrument_id=$2 ORDER BY performed_at DESC LIMIT 1",[req.user.organization_id,x.id]);
    const calibrationCurrent=x.calibration_due_at==null||new Date(x.calibration_due_at)>=new Date();const qualificationCurrent=!q.rowCount||q.rows[0].status==='PASS'&&(q.rows[0].due_at==null||new Date(q.rows[0].due_at)>=new Date());
    res.json({instrument:x,ready:x.status==='ACTIVE'&&calibrationCurrent&&qualificationCurrent,calibration:c.rows[0]??null,qualification:q.rows[0]??null})
  }catch(e){next(e)}});
  app.get('/api/lims/maintenance',authenticated,readOnly,async(req,res,next)=>{try{const q=await pool.query('SELECT m.*,i.asset_no,i.name instrument_name FROM instrument_maintenance m JOIN instruments i ON i.organization_id=m.organization_id AND i.id=m.instrument_id WHERE m.organization_id=$1 ORDER BY COALESCE(m.scheduled_at,m.created_at) DESC LIMIT 500',[req.user.organization_id]);res.json(q.rows)}catch(e){next(e)}});
  app.post('/api/lims/maintenance',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({instrumentId:uuid,maintenanceType:text,scheduledAt:z.string().datetime({offset:true}).optional().nullable(),performedAt:z.string().datetime({offset:true}).optional().nullable(),status:z.enum(['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED']).optional(),vendor:z.string().max(200).optional().nullable(),workReference:z.string().max(300).optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const i=await pool.query('SELECT id,status FROM instruments WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.instrumentId]);if(!i.rowCount)return res.status(404).json({error:'Instrument not found'});
    const q=await pool.query('INSERT INTO instrument_maintenance(organization_id,instrument_id,maintenance_type,scheduled_at,performed_at,status,vendor,work_reference,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.organization_id,d.instrumentId,d.maintenanceType,d.scheduledAt??null,d.performedAt??null,d.status??'PLANNED',d.vendor??null,d.workReference??null,d.notes??null,req.user.id]);
    await audit(pool,req.user,'lims_maintenance_create','instrument_maintenance',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.get('/api/lims/qualifications',authenticated,readOnly,async(req,res,next)=>{try{const q=await pool.query('SELECT q.*,i.asset_no,i.name instrument_name FROM instrument_qualifications q JOIN instruments i ON i.organization_id=q.organization_id AND i.id=q.instrument_id WHERE q.organization_id=$1 ORDER BY q.performed_at DESC LIMIT 500',[req.user.organization_id]);res.json(q.rows)}catch(e){next(e)}});
  app.post('/api/lims/qualifications',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({instrumentId:uuid,qualificationType:z.enum(['IQ','OQ','PQ','REQUALIFICATION']),performedAt:z.string().datetime({offset:true}),dueAt:z.string().datetime({offset:true}).optional().nullable(),status:z.enum(['PASS','FAIL','EXPIRED']),protocolReference:z.string().max(300).optional().nullable(),certificateFile:z.string().max(500).optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const i=await pool.query('SELECT id,status FROM instruments WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.instrumentId]);if(!i.rowCount)return res.status(404).json({error:'Instrument not found'});if(i.rows[0].status==='RETIRED')return res.status(409).json({error:'Retired instrument cannot be qualified'});
    const q=await pool.query('INSERT INTO instrument_qualifications(organization_id,instrument_id,qualification_type,performed_at,due_at,status,protocol_reference,certificate_file,performed_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.organization_id,d.instrumentId,d.qualificationType,d.performedAt,d.dueAt??null,d.status,d.protocolReference??null,d.certificateFile??null,req.user.id,d.notes??null]);
    if(d.status!=='PASS')await pool.query("UPDATE instruments SET status='QUARANTINED',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status<>'RETIRED'",[req.user.organization_id,d.instrumentId]);
    await audit(pool,req.user,'lims_qualification_create','instrument_qualifications',q.rows[0].id,d);res.status(201).json(q.rows[0])
  }catch(e){next(e)}});
  app.get('/api/lims/instruments/due',authenticated,readOnly,async(req,res,next)=>{try{
    const q=await pool.query("SELECT id,asset_no,name,status,calibration_due_at,CASE WHEN calibration_due_at IS NULL THEN 'NO_DUE_DATE' WHEN calibration_due_at<now() THEN 'OVERDUE' WHEN calibration_due_at<=now()+interval '30 days' THEN 'DUE_SOON' ELSE 'CURRENT' END AS calibration_status FROM instruments WHERE organization_id=$1 ORDER BY calibration_due_at NULLS LAST",[req.user.organization_id]);res.json(q.rows)
  }catch(e){next(e)}});
  app.patch('/api/lims/instruments/:id/status',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({status:z.enum(['ACTIVE','IN_SERVICE','OUT_OF_SERVICE','QUARANTINED','RETIRED']),reason:z.string().max(1000).optional().nullable()}).parse(req.body);
    const q=await pool.query('UPDATE instruments SET status=$1,metadata=jsonb_set(COALESCE(metadata,\'{}\'::jsonb),\'{lastStatusChange}\',to_jsonb(json_build_object(\'at\',now(),\'by\',$3,\'reason\',$4)),true),updated_at=now() WHERE organization_id=$2 AND id=$5 RETURNING *',[d.status,req.user.organization_id,req.user.id,d.reason??null,req.params.id]);
    if(!q.rowCount)return res.status(404).json({error:'Instrument not found'});await audit(pool,req.user,'lims_instrument_status','instruments',req.params.id,d);res.json(q.rows[0])
  }catch(e){next(e)}});
  app.post('/api/lims/instruments',authenticated,setup,async(req,res,next)=>{try{const d=z.object({assetNo:text,name:text,manufacturer:z.string().max(200).optional().nullable(),model:z.string().max(200).optional().nullable(),serialNo:z.string().max(200).optional().nullable(),location:z.string().max(300).optional().nullable(),calibrationDueAt:z.string().datetime({offset:true}).optional().nullable(),metadata:z.record(z.unknown()).optional()}).parse(req.body);const q=await pool.query('INSERT INTO instruments(organization_id,asset_no,name,manufacturer,model,serial_no,location,calibration_due_at,metadata,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.organization_id,d.assetNo,d.name,d.manufacturer??null,d.model??null,d.serialNo??null,d.location??null,d.calibrationDueAt??null,d.metadata??{},req.user.id]);await audit(pool,req.user,'lims_instrument_create','instruments',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/calibrations',authenticated,setup,async(req,res,next)=>{try{const d=z.object({instrumentId:uuid,performedAt:z.string().datetime({offset:true}),dueAt:z.string().datetime({offset:true}).optional().nullable(),status:z.enum(['PASS','FAIL','OUT_OF_TOLERANCE']),standardReference:z.string().max(300).optional().nullable(),points:z.array(calibrationPoint).max(100).optional(),certificateFile:z.string().max(500).optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const instrument=await pool.query('SELECT id,status FROM instruments WHERE organization_id=$1 AND id=$2',[req.user.organization_id,d.instrumentId]);if(!instrument.rowCount)return res.status(404).json({error:'Instrument not found'});if(instrument.rows[0].status==='RETIRED')return res.status(409).json({error:'Retired instrument cannot be calibrated'});
    const q=await pool.query('INSERT INTO calibration_records(organization_id,instrument_id,performed_at,due_at,status,standard_reference,points,certificate_file,performed_by,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[req.user.organization_id,d.instrumentId,d.performedAt,d.dueAt??null,d.status,d.standardReference??null,d.points??[],d.certificateFile??null,req.user.id,d.notes??null]);
    if(d.status==='PASS')await pool.query("UPDATE instruments SET status='ACTIVE',calibration_due_at=COALESCE($1,calibration_due_at),updated_at=now() WHERE organization_id=$2 AND id=$3",[d.dueAt??null,req.user.organization_id,d.instrumentId]);else await pool.query("UPDATE instruments SET status='OUT_OF_SERVICE',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status<>'RETIRED'",[req.user.organization_id,d.instrumentId]);
    await audit(pool,req.user,'lims_calibration_create','calibration_records',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/deviations',authenticated,write,async(req,res,next)=>{try{const d=z.object({deviationNo:text,title:text,description:text,severity:z.string().max(30).default('MEDIUM'),dueAt:z.string().datetime({offset:true}).optional().nullable()}).parse(req.body);const q=await pool.query('INSERT INTO deviations(organization_id,deviation_no,title,description,severity,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[req.user.organization_id,d.deviationNo,d.title,d.description,d.severity,d.dueAt??null,req.user.id]);await audit(pool,req.user,'lims_deviation_create','deviations',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/capa',authenticated,write,async(req,res,next)=>{try{const d=z.object({capaNo:text,sourceType:text,sourceId:z.string().max(120).optional().nullable(),description:text,actionType:z.enum(['CORRECTIVE','PREVENTIVE']),ownerId:uuid.optional().nullable(),dueAt:z.string().datetime({offset:true}).optional().nullable()}).parse(req.body);const q=await pool.query('INSERT INTO capa_actions(organization_id,capa_no,source_type,source_id,description,action_type,owner_id,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[req.user.organization_id,d.capaNo,d.sourceType,d.sourceId??null,d.description,d.actionType,d.ownerId??null,d.dueAt??null,req.user.id]);await audit(pool,req.user,'lims_capa_create','capa_actions',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/change-controls',authenticated,setup,async(req,res,next)=>{try{const d=z.object({changeNo:text,title:text,rationale:z.string().max(3000).optional().nullable(),impactAssessment:z.string().max(3000).optional().nullable()}).parse(req.body);const q=await pool.query('INSERT INTO change_controls(organization_id,change_no,title,rationale,impact_assessment,status,requested_by) VALUES($1,$2,$3,$4,$5,\'DRAFT\',$6) RETURNING *',[req.user.organization_id,d.changeNo,d.title,d.rationale??null,d.impactAssessment??null,req.user.id]);await audit(pool,req.user,'lims_change_control_create','change_controls',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/reports',authenticated,write,async(req,res,next)=>{try{const d=z.object({reportNo:text,reportType:text,sampleId:uuid.optional().nullable()}).parse(req.body);const q=await pool.query('INSERT INTO reports(organization_id,report_no,report_type,sample_id) VALUES($1,$2,$3,$4) RETURNING *',[req.user.organization_id,d.reportNo,d.reportType,d.sampleId??null]);await audit(pool,req.user,'lims_report_create','reports',q.rows[0].id,d);res.status(201).json(q.rows[0])}catch(e){next(e)}});

  app.post('/api/lims/integrations/events',authenticated,write,async(req,res,next)=>{try{const d=z.object({source:text,eventType:text,externalId:z.string().max(200).optional().nullable(),payload:z.record(z.unknown())}).parse(req.body);const q=await pool.query('INSERT INTO integration_events(organization_id,source,event_type,external_id,payload) VALUES($1,$2,$3,$4,$5) RETURNING *',[req.user.organization_id,d.source,d.eventType,d.externalId??null,d.payload]);await audit(pool,req.user,'integration_event_received','integration_events',q.rows[0].id,{source:d.source,eventType:d.eventType,externalId:d.externalId??null});res.status(202).json(q.rows[0])}catch(e){next(e)}});

  app.patch('/api/lims/notifications/:id/read',authenticated,readOnly,async(req,res,next)=>{try{const q=await pool.query('UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE organization_id=$1 AND id=$2 AND (user_id=$3 OR user_id IS NULL) RETURNING *',[req.user.organization_id,req.params.id,req.user.id]);if(!q.rowCount)return res.status(404).json({error:'Notification not found'});res.json(q.rows[0])}});
  app.patch('/api/lims/maintenance/:id/status',authenticated,write,async(req,res,next)=>{try{
    const d=z.object({status:z.enum(['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED']),performedAt:z.string().datetime({offset:true}).optional().nullable(),performedBy:uuid.optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const q0=await pool.query('SELECT * FROM instrument_maintenance WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);
    if(!q0.rowCount)return res.status(404).json({error:'Maintenance record not found'});
    const from=q0.rows[0].status;
    const transitions={PLANNED:['IN_PROGRESS','CANCELLED'],IN_PROGRESS:['COMPLETED','CANCELLED'],COMPLETED:[],CANCELLED:[]};
    if(!transitions[from]?.includes(d.status))return res.status(409).json({error:'Invalid maintenance status transition',from,to:d.status});
    if(d.status==='COMPLETED'&&!d.performedAt)return res.status(422).json({error:'performedAt is required when completing maintenance'});
    const q=await pool.query("UPDATE instrument_maintenance SET status=$1,performed_at=COALESCE($2,performed_at),performed_by=COALESCE($3,performed_by),notes=COALESCE($4,notes) WHERE organization_id=$5 AND id=$6 RETURNING *",[d.status,d.performedAt??null,d.performedBy??req.user.id,d.notes??null,req.user.organization_id,req.params.id]);
    if(d.status==='COMPLETED')await pool.query("UPDATE instruments SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{lastMaintenance}',to_jsonb(json_build_object('at',COALESCE($1,now()),'maintenanceId',$2)),true),updated_at=now() WHERE organization_id=$3 AND id=$4",[d.performedAt??null,req.params.id,req.user.organization_id,q0.rows[0].instrument_id]);
    await audit(pool,req.user,'lims_maintenance_status','instrument_maintenance',req.params.id,{from,to:d.status});res.json(q.rows[0])
  }catch(e){next(e)}});
  app.patch('/api/lims/qualifications/:id/status',authenticated,setup,async(req,res,next)=>{try{
    const d=z.object({status:z.enum(['PASS','FAIL','EXPIRED']),performedAt:z.string().datetime({offset:true}).optional(),dueAt:z.string().datetime({offset:true}).optional().nullable(),notes:z.string().max(2000).optional().nullable()}).parse(req.body);
    const q0=await pool.query('SELECT * FROM instrument_qualifications WHERE organization_id=$1 AND id=$2',[req.user.organization_id,req.params.id]);
    if(!q0.rowCount)return res.status(404).json({error:'Qualification record not found'});
    const q=await pool.query('UPDATE instrument_qualifications SET status=$1,performed_at=COALESCE($2,performed_at),due_at=COALESCE($3,due_at),notes=COALESCE($4,notes) WHERE organization_id=$5 AND id=$6 RETURNING *',[d.status,d.performedAt??null,d.dueAt??null,d.notes??null,req.user.organization_id,req.params.id]);
    if(d.status!=='PASS')await pool.query("UPDATE instruments SET status='QUARANTINED',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status<>'RETIRED'",[req.user.organization_id,q0.rows[0].instrument_id]);
    else await pool.query("UPDATE instruments SET status='ACTIVE',updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='QUARANTINED'",[req.user.organization_id,q0.rows[0].instrument_id]);
    await audit(pool,req.user,'lims_qualification_status','instrument_qualifications',req.params.id,{from:q0.rows[0].status,to:d.status});res.json(q.rows[0])
  }catch(e){next(e)}});

}
