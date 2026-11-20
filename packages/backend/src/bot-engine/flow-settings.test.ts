import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionContext } from './context.js';
import { normalizeFlowData } from './engine.js';
import { FlowRunner } from './flow-runner.js';
import type { AfkMoverActionData, MessageActionData } from '@ts6/common';

function conditionContext(groups: string): ExecutionContext {
  const prisma = { botVariable: { findMany: async () => [] } } as any;
  return new ExecutionContext(prisma, 1, 2, 3, 1, 'event', {
    client_servergroups: groups,
    client_nickname: 'Guest18',
  });
}

test('new and saved Group Protector flows match complete group IDs', async () => {
  for (const fn of ['hasGroup', 'contains']) {
    const protectedGroup = `${fn}(event.client_servergroups,'8')`;
    const missingAuth = `${fn}(event.client_servergroups,'10') == 0`;
    assert.equal(await conditionContext('18').evaluateCondition(protectedGroup), false);
    assert.equal(await conditionContext('8, 10').evaluateCondition(protectedGroup), true);
    assert.equal(await conditionContext('8, 10').evaluateCondition(missingAuth), false);
    assert.equal(await conditionContext('8,110').evaluateCondition(missingAuth), true);
  }
  assert.equal(await conditionContext('18').evaluateCondition("contains(event.client_nickname,'8')"), true);
});

test('saved broadcast modes normalize to the WebQuery target mode', () => {
  for (const [targetMode, expected] of [
    ['server', 3], ['3', 3], [3, 3], ['channel', 2], ['2', 2], [2, 2],
    ['client', 1], ['1', 1], [1, 1], [undefined, 1],
  ]) {
    const { nodes } = normalizeFlowData({ nodes: [{ type: 'action_message', config: { targetMode } }] });
    assert.equal((nodes[0].data as MessageActionData).targetMode, expected);
  }
});

test('AFK move uses the exemptions saved by the editor', async () => {
  const { nodes } = normalizeFlowData({ nodes: [{ type: 'action_afkMover', config: {
    afkChannelId: '99', idleThresholdSeconds: '10', exemptChannelIds: '12, 15', exemptGroupIds: '6',
  } }] });
  const moved: string[] = [];
  const client = {
    executePost: async (_sid: number, command: string, params: Record<string, string>) => {
      if (command === 'clientlist') return [
        { clid: '1', cid: '12', client_idle_time: 10000 },
        { clid: '2', cid: '15', client_idle_time: 10000 },
        { clid: '3', cid: '16', client_idle_time: 10000, client_servergroups: '6' },
        { clid: '4', cid: '16', client_idle_time: 10000 },
      ];
      assert.equal(command, 'clientmove');
      assert.equal(params.cid, '99');
      moved.push(params.clid);
    },
  };
  const runner = new FlowRunner({} as any, {} as any, {} as any) as any;
  const ctx = conditionContext('');
  await runner.executeAfkMover(nodes[0].data as AfkMoverActionData, ctx, client);
  assert.deepEqual(moved, ['4']);
  assert.equal(ctx.getTemp('afkMovedCount'), 1);
});
