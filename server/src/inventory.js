import { z } from 'zod';
import { can } from './permissions.js';

const units = ['g','kg','mg','mL','L','pcs'];
const positive = z.coerce.number().finite().positive();
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/);
const receiveSchema = z.object({
  chemicalId: id,
  lotNumber: z.string().trim().min(1).max(120),
  quantity: positive,
  unit: z.enum(units),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  location: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(200).optional()
});
const issueSchema = z.object({
  chemicalId: id,
  quantity: positive,
  unit: z.enum(units),
  reference: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(500).optional()
});

function allowed(role, action) {
  return can(role, action, action === 'create' ? 'batches' : 'consumption');
}

async function chemicalExists(client, user, chemicalId) {
  const q = await client.query(
    'SELECT id,data FROM records WHERE organization_id=$1 AND entity=$2 AND id=$3',
    [user.organization_id, 'chemicals', chemicalId]
  );
  return q.rows[0] || null;
}

async function batchBalance(client, organizationId, batchId) {
  const q = await client.query(
    `SELECT COALESCE(SUM(CASE
      WHEN transaction_type IN ('RECEIVE','RETURN') THEN quantity
      WHEN transaction_type IN ('ISSUE','DISPOSAL') THEN -quantity
      ELSE 0 END),0) AS balance
      FROM inventory_transactions
      WHERE organization_id=$1 AND batch_id=$2`,
    [organizationId, batchId]
  );
  return Number(q.rows[0].balance);
}

export function registerInventoryRoutes({ app, pool, auth, audit }) {
  app.post('/api/inventory/receive', auth, async (req, res, next) => {
    if (!allowed(req.user.role, 'create')) return res.status(403).json({error:'Forbidden'});
    const c = await pool.connect();
    try {
      const input = receiveSchema.parse(req.body);
      await c.query('BEGIN');
      const chemical = await chemicalExists(c, req.user, input.chemicalId);
      if (!chemical) {
        await c.query('ROLLBACK');
        return res.status(404).json({error:'Chemical not found'});
      }
      const duplicate = await c.query(
        'SELECT id FROM inventory_batches WHERE organization_id=$1 AND chemical_id=$2 AND lot_number=$3',
        [req.user.organization_id,input.chemicalId,input.lotNumber]
      );
      if (duplicate.rowCount) {
        await c.query('ROLLBACK');
        return res.status(409).json({error:'Batch/lot already exists'});
      }
      const b = await c.query(
        `INSERT INTO inventory_batches
        (organization_id,chemical_id,lot_number,expiry_date,unit,received_quantity,location,metadata,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id,chemical_id,lot_number,received_at,expiry_date,unit,received_quantity,location`,
        [req.user.organization_id,input.chemicalId,input.lotNumber,input.expiryDate||null,input.unit,input.quantity,input.location||null,
         JSON.stringify({supplier:input.supplier||null,reference:input.reference||null}),req.user.id]
      );
      const batch = b.rows[0];
      await c.query(
        `INSERT INTO inventory_transactions
        (organization_id,transaction_type,chemical_id,batch_id,quantity,unit,reference,reason,actor_id,metadata)
        VALUES($1,'RECEIVE',$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.user.organization_id,input.chemicalId,batch.id,input.quantity,input.unit,input.reference||null,'Initial receipt',req.user.id,
         JSON.stringify({lotNumber:input.lotNumber,supplier:input.supplier||null})]
      );
      await audit(c,req.user,'inventory_receive','inventory_batches',batch.id,{chemicalId:input.chemicalId,quantity:input.quantity,unit:input.unit,lotNumber:input.lotNumber});
      await c.query('COMMIT');
      res.status(201).json({...batch,availableQuantity:input.quantity});
    } catch(e) {
      await c.query('ROLLBACK').catch(()=>{});
      if (e.name === 'ZodError') return res.status(400).json({error:e.issues.map(x=>x.message).join('; ')});
      next(e);
    } finally { c.release(); }
  });

  app.post('/api/inventory/issue', auth, async (req, res, next) => {
    if (!allowed(req.user.role, 'create')) return res.status(403).json({error:'Forbidden'});
    const c = await pool.connect();
    try {
      const input = issueSchema.parse(req.body);
      await c.query('BEGIN');
      if (!(await chemicalExists(c, req.user, input.chemicalId))) {
        await c.query('ROLLBACK');
        return res.status(404).json({error:'Chemical not found'});
      }

      const batches = await c.query(
        `SELECT id,lot_number,received_at,expiry_date,unit
         FROM inventory_batches
         WHERE organization_id=$1 AND chemical_id=$2 AND unit=$3
         ORDER BY received_at ASC, id ASC
         FOR UPDATE`,
        [req.user.organization_id,input.chemicalId,input.unit]
      );

      let remaining = input.quantity;
      const allocations = [];
      for (const batch of batches.rows) {
        if (remaining <= 0) break;
        const available = await batchBalance(c,req.user.organization_id,batch.id);
        if (available <= 0) continue;
        const take = Math.min(available,remaining);
        await c.query(
          `INSERT INTO inventory_transactions
           (organization_id,transaction_type,chemical_id,batch_id,quantity,unit,reference,reason,actor_id,metadata)
           VALUES($1,'ISSUE',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [req.user.organization_id,input.chemicalId,batch.id,take,input.unit,input.reference||null,input.reason||'Consumption/issue',req.user.id,
           JSON.stringify({fifo:true})]
        );
        allocations.push({batchId:batch.id,lotNumber:batch.lot_number,quantity:take,unit:batch.unit});
        remaining -= take;
      }

      if (remaining > 0) {
        await c.query('ROLLBACK');
        return res.status(409).json({
          error:'Insufficient available stock',
          requestedQuantity:input.quantity,
          unavailableQuantity:remaining,
          unit:input.unit,
          allocations:[]
        });
      }

      await audit(c,req.user,'inventory_issue','inventory_transactions',null,{chemicalId:input.chemicalId,quantity:input.quantity,unit:input.unit,allocations});
      await c.query('COMMIT');
      res.status(201).json({chemicalId:input.chemicalId,quantity:input.quantity,unit:input.unit,allocations});
    } catch(e) {
      await c.query('ROLLBACK').catch(()=>{});
      if (e.name === 'ZodError') return res.status(400).json({error:e.issues.map(x=>x.message).join('; ')});
      next(e);
    } finally { c.release(); }
  });

  app.get('/api/inventory/stock/:chemicalId', auth, async (req,res,next) => {
    try {
      const q = await pool.query(
        `SELECT b.id AS "batchId",b.chemical_id AS "chemicalId",b.lot_number AS "lotNumber",
                b.received_at AS "receivedAt",b.expiry_date AS "expiryDate",b.unit,b.location,
                b.received_quantity AS "receivedQuantity",
                COALESCE(SUM(CASE WHEN t.transaction_type IN ('RECEIVE','RETURN') THEN t.quantity
                                  WHEN t.transaction_type IN ('ISSUE','DISPOSAL') THEN -t.quantity ELSE 0 END),0) AS "availableQuantity"
         FROM inventory_batches b
         LEFT JOIN inventory_transactions t ON t.organization_id=b.organization_id AND t.batch_id=b.id
         WHERE b.organization_id=$1 AND b.chemical_id=$2
         GROUP BY b.id
         ORDER BY b.received_at ASC,b.id ASC`,
        [req.user.organization_id,req.params.chemicalId]
      );
      res.json(q.rows.map(x=>({...x,receivedQuantity:Number(x.receivedQuantity),availableQuantity:Number(x.availableQuantity)})));
    } catch(e) { next(e); }
  });
}
