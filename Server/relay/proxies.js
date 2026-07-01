/**
 * Relay browser proxy assignment — DB-backed via proxy-store.
 */
const store = require('./proxy-store');

module.exports = {
  DC_PORTS: store.DC_PORTS,
  getPoolCounts: store.getPoolCounts,
  buildWorkerPlans: store.buildWorkerPlans,
  getProxyInventory: store.getProxyInventory,
  getDatacenterProxy: (slotIndex) => {
    const rows = store.getProxiesForRelayTier('dc');
    const row = rows[slotIndex];
    return row ? store.rowToPlaywrightProxy(row) : store.getDirectProxyConfig();
  },
  getResidentialProxy: (slotIndex) => {
    const rows = store.getProxiesForRelayTier('res');
    const row = rows[slotIndex];
    return row ? store.rowToPlaywrightProxy(row) : store.getDirectProxyConfig();
  },
  getDirectProxy: store.getDirectProxyConfig,
  maskProxyForApi: store.maskProxyForApi,
  refreshProxyCache: store.refreshProxyCache,
  invalidateProxyCache: store.invalidateProxyCache,
};
