const { runTransferAgentBatchOnSession } = require('../sedar/transfer-agent-batch');

/**
 * @param {Array<{id?: number, name: string, ticker?: string, exchange?: string}>} companies
 * @param {{ relaySlot?: number, relayTier?: string, taskSlug?: string, onResult?: (row: object) => void }} opts
 */
async function runTransferAgentBatch(companies, opts = {}) {
  const results = await runTransferAgentBatchOnSession(companies, {
    relaySlot: opts.relaySlot || 1,
    relayTier: opts.relayTier,
    taskSlug: opts.taskSlug || 'sedar_transfer_agent',
    onResult: opts.onResult,
  });
  return results;
}

module.exports = { runTransferAgentBatch, TA_RESULT_MARKER: '__OREWIRE_TA_RESULT__' };
