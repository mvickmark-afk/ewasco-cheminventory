import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCitations, questionSchema } from '../src/ai-assistant.js';

test('assistant question validation trims input and enforces length', () => {
  assert.deepEqual(questionSchema.parse({ question: '  What does the approved SOP say?  ' }), {
    question: 'What does the approved SOP say?'
  });
  assert.equal(questionSchema.safeParse({ question: '' }).success, false);
  assert.equal(questionSchema.safeParse({ question: 'x'.repeat(4001) }).success, false);
  assert.equal(questionSchema.safeParse({ question: 'valid', extra: 'unexpected' }).success, false);
});

test('citation extraction returns unique file citations only', () => {
  const response = {
    output: [
      { type: 'file_search_call', results: [] },
      { type: 'message', content: [
        { type: 'output_text', text: 'See policy.', annotations: [
          { type: 'file_citation', file_id: 'file_a', filename: 'Chemical-SOP.pdf' },
          { type: 'file_citation', file_id: 'file_a', filename: 'Chemical-SOP.pdf' },
          { type: 'url_citation', url: 'https://example.invalid' }
        ] }
      ] }
    ]
  };
  assert.deepEqual(extractCitations(response), [
    { fileId: 'file_a', filename: 'Chemical-SOP.pdf' }
  ]);
});

test('citation extraction handles empty model output', () => {
  assert.deepEqual(extractCitations({ output: [] }), []);
});
