import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDraftAfterSend } from '../e2e/support/sectionStagingAttachmentCleanup.mjs';

const missing = () => { throw Object.assign(new Error('draft removed by server'), { code: 'storage/object-not-found' }); };
const committed = { attachments: [{ path: 'messages/fixture/attachment.pdf' }] };

test('accepts a missing temporary upload only after a committed attachment', async () => {
  await removeDraftAfterSend(missing, { fullPath: 'message-uploads/fixture/draft.pdf' }, true, committed);
  await assert.rejects(removeDraftAfterSend(missing, {}, true, undefined), { code: 'storage/object-not-found' });
  await assert.rejects(removeDraftAfterSend(missing, {}, true, { attachments: [] }), { code: 'storage/object-not-found' });
  await assert.rejects(removeDraftAfterSend(() => { throw Object.assign(new Error('forbidden'), { code: 'storage/unauthorized' }); }, {}, true, committed), { code: 'storage/unauthorized' });
});
