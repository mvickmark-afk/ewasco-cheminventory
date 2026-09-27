import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateFifo } from '../src/inventory.js';

test('FIFO allocates oldest available batch first', async () => {
  const batches = [
    {id:'b-old',lot_number:'LOT-OLD',unit:'L'},
    {id:'b-new',lot_number:'LOT-NEW',unit:'L'}
  ];
  const balances = {'b-old':3,'b-new':10};
  const result = await allocateFifo(batches,8,id=>balances[id]);
  assert.deepEqual(result.allocations,[
    {batchId:'b-old',lotNumber:'LOT-OLD',quantity:3,unit:'L'},
    {batchId:'b-new',lotNumber:'LOT-NEW',quantity:5,unit:'L'}
  ]);
  assert.equal(result.remaining,0);
});

test('FIFO skips depleted batches and reports shortage', async () => {
  const batches = [
    {id:'b-old',lot_number:'LOT-OLD',unit:'kg'},
    {id:'b-mid',lot_number:'LOT-MID',unit:'kg'}
  ];
  const balances = {'b-old':0,'b-mid':2};
  const result = await allocateFifo(batches,5,id=>balances[id]);
  assert.deepEqual(result.allocations,[
    {batchId:'b-mid',lotNumber:'LOT-MID',quantity:2,unit:'kg'}
  ]);
  assert.equal(result.remaining,3);
});
