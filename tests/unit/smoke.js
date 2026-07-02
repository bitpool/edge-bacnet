/*
 * Lightweight smoke tests for the require-safe modules. Catches breakage that
 * `node --check` (syntax-only) misses — e.g. a require chain that fails at load
 * time, or a renamed export.
 *
 * The Node-RED factory modules (bacnet_gateway, bacnet_read, bacnet_write,
 * bacnet_inspector, bitpool_inject) export `function(RED)` and cannot be
 * exercised here without a fake RED runtime. They are covered by `node --check`
 * in CI for syntax validity only.
 */

let pass = 0;
let fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log(`  ok  ${name}`); return; }
  fail++;
  console.log(`  FAIL ${name}${info ? ' ' + info : ''}`);
}

// ---- vendored bacstack loads and exposes the constants we depend on ---------
const bacnet = require('../../resources/node-bacstack-ts/dist/index.js');
ok('bacstack: enum.PropertyIdentifier present', typeof bacnet.enum.PropertyIdentifier === 'object');
ok('bacstack: PRESENT_VALUE === 85', bacnet.enum.PropertyIdentifier.PRESENT_VALUE === 85);
ok('bacstack: ObjectType.ANALOG_VALUE present', typeof bacnet.enum.ObjectType.ANALOG_VALUE === 'number');
ok('bacstack: Client constructor exported', typeof bacnet.Client === 'function');

// ---- common ---------------------------------------------------------------
const common = require('../../common.js');
ok('common: exports object', typeof common === 'object');
ok('common: Read_Config_Sync_Server is callable', typeof common.Read_Config_Sync_Server === 'function');
ok('common: Store_Config_Server is callable', typeof common.Store_Config_Server === 'function');

// ---- BacnetServer can be required and the class shape is what we expect ----
const { BacnetServer } = require('../../bacnet_server.js');
ok('BacnetServer: class exported', typeof BacnetServer === 'function');
ok('BacnetServer: addObject on prototype', typeof BacnetServer.prototype.addObject === 'function');
ok('BacnetServer: getObject on prototype', typeof BacnetServer.prototype.getObject === 'function');
ok('BacnetServer: getServerPoints on prototype', typeof BacnetServer.prototype.getServerPoints === 'function');

// ---- BacnetDevice and treeBuilder load -------------------------------------
const { BacnetDevice } = require('../../bacnet_device.js');
ok('BacnetDevice: class exported', typeof BacnetDevice === 'function');

const { treeBuilder } = require('../../treeBuilder.js');
ok('treeBuilder: function exported', typeof treeBuilder === 'function');

// ---- BacnetClient class shape ---------------------------------------------
// Don't construct it (the constructor binds a UDP socket and starts schedulers).
const { BacnetClient } = require('../../bacnet_client.js');
ok('BacnetClient: class exported', typeof BacnetClient === 'function');
ok('BacnetClient: doRead on prototype', typeof BacnetClient.prototype.doRead === 'function');
ok('BacnetClient: doWrite on prototype', typeof BacnetClient.prototype.doWrite === 'function');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
