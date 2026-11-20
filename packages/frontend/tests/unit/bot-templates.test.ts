import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_TEMPLATES } from '../../src/data/bot-templates';

test('Group Protector emits whole-ID checks and server broadcast emits a named target', () => {
  const protector = BOT_TEMPLATES.find(t => t.id === 'group-protector')!;
  const groups = protector.flowDataFactory({ protectedGroupId: '8', allowedGroupId: '10' });
  assert.deepEqual(groups.nodes.filter(n => n.type === 'condition').map(n => n.config.expression), [
    "hasGroup(event.client_servergroups,'8')",
    "hasGroup(event.client_servergroups,'10') == 0",
  ]);
  const webhook = BOT_TEMPLATES.find(t => t.id === 'webhook-server-message')!;
  const { nodes } = webhook.flowDataFactory({ path: 'news', secret: 'test' });
  assert.equal(nodes.find(n => n.type === 'action_message').config.targetMode, 'server');
});
