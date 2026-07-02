<h3>BITPOOL-EDGE BACNET</h3>


---

## About

A Node-RED node that reads and writes to BACnet devices.

## Getting Started 

Use the procedures below to install the Bitpool-Edge BACnet node onto your running instance. Then either use the Node-RED help, or read the [wiki](https://wiki.bitpool.com/bitpool-edge/connectors/bitpool-edge-bacnet) page to get you started on your next new project.

*- Examples are available using the Import->Examples->Flows menu.*

## Installation

Install using the Node-RED manage palette,


```javascript
1. Click the 'Hamburger' icon at the top right corner.

2. Select the 'Manage palette' option.

3. Click the 'Install' tab and type '@bitpoolos/edge-bacnet' into the search field.

4. Find the latest version and click to install.
```

or using NPM from the command line.

```bash
$ npm install @bitpoolos/edge-bacnet
```

## Updating 

The module can be updated via the Node-RED pallette manager, or via the npm cli. 

```javascript
Note: the following is our reccommendation based on error encountered in our experience. The below steps are mostly critical for updates that modify or add new properties to the UI of a node. Refer to comments in changelog.

Upon updating to the latest version, we highly recommend:
 - Check out the changelog for latest feature notes and updates 
 - Remove all @bitpoolos/edge-bacnet nodes from all flows 
 - Deploy all flows 
 - Restart Node-RED 
 - Insert and reconfigure new @bitpoolos/edge-bacnet nodes. 
 - Restart Node-RED again if no devices are discovered.
```
Main reason being, the behaviour of the bacnet client binding to network interfaces can remain stagnent if the Node-RED service is not restarted. This also ensures that all of the nodes are correctly configured as there are often properties added and removed from nodes. 


## BACnet Secure Connect (BACnet/SC)

From v1.7.0 the gateway can join BACnet/SC networks (ANSI/ASHRAE 135-2020, ANNEX AB) as an SC node. Select the datalink on the Gateway tab:

- **BACnet/IP (UDP)** — the default; behaviour is unchanged from previous versions.
- **BACnet Secure Connect (hub)** — the gateway connects out to a site SC hub over a mutually-authenticated TLS 1.3 WebSocket. All discovery, polling, reads, writes and the local BACnet server objects work through the hub; no interface, broadcast address or port settings apply.

Configuration in SC mode:

- **Primary Hub URI** (required) and optional **Failover Hub URI** — `wss://` only. While running on the failover hub, the gateway keeps probing the primary and switches back automatically.
- **CA Certificate / Operational Certificate / Private Key** — each field accepts pasted PEM text (stored encrypted in Node-RED credentials) *or* an absolute path to a PEM file on the gateway host. The operational certificate must be issued by a CA the hub trusts, and the CA certificate(s) you provide must have signed the hub's certificate (mutual TLS).
- Per the standard, hub **hostname verification is off** unless explicitly enabled, and **TLS 1.3** is required (a TLS 1.2 fallback toggle exists for older hubs).
- The gateway's **device UUID and VMAC** are generated on first SC start and persisted in `edge-bacnet-sc-identity.cfg` next to the datastore (honours `BACNET_STORAGE_PATH`). The UUID identifies this gateway for the life of the installation.

Notes:

- Devices on an SC network are addressed by their 6-octet VMAC (shown where an IP address would appear in the device tree). VMACs can change when a remote device restarts; the gateway re-learns them automatically by device instance.
- After **switching datalink mode**, devices are re-discovered on the first discovery cycle and reader-node point selections re-key to the new addresses — re-select points in reader nodes after a mode switch.
- Node status shows the live SC state (`SC: connected (primary)`, `SC: reconnecting`, …). The gateway edit dialog shows the state, VMAC and UUID under the SC settings.
- Requires Node.js >= 18.

For local development and interop testing, the repo (not the published package) includes a minimal spec-shaped SC hub and a test-PKI generator:

```bash
node scripts/generate-sc-test-certs.js     # test CA + hub/node certs -> test/sc/fixtures/
node tools/sc-test-hub.js --port 4443      # mutual-TLS SC hub on wss://127.0.0.1:4443
```

## Changelog 

[Changelog](CHANGELOG.md)

## Notes

 - This project is still in development and by no means perfect. 

 - Gateway node changes require a restart of Node-RED. This includes any networking or interface adapter changes. 

 - If you are using this node in a linux environment, using the 'All interfaces : 0.0.0.0' can be more reliable with a greater range of BACnet devices. 

 - Note your broadcast address, compatibility can vary from 255.255.255.255 (all subnets) and 192.x.x.255 (locked down to your current subnet).

## Resources
- [bitpool.com](https://www.bitpool.com/) - who are we.
- [wiki.bitpool.com](https://wiki.bitpool.com/) - helpful docs.
- [hub.docker.com](https://hub.docker.com/r/bitpoolos/bitpool-edge) - pre-canned nodes.

## Contributions

This node utilises v1.0.0-beta.2 of the node-bacnet package (https://github.com/HILA-TECH/ts-node-bacstack). None of the functionality here would be possible without the fantastic work done by the contributors of that project, and the original node-bacstack implementation (https://github.com/fh1ch/node-bacstack).

## License

This project is under the MIT license agreement. For more details, see the LICENSE file.


