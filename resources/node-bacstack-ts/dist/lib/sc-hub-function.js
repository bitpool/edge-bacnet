'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScHubFunction = void 0;
/**
 * BACnet/SC hub function routing core. ANSI/ASHRAE 135-2020 AB.5.
 *
 * Accepts already-upgraded WebSockets (from any wss server), runs the
 * accepting-peer handshake on each via SCConnection, maintains the
 * VMAC -> connection table and performs the AB.5.3 forwarding rules:
 *  - unicast: forward to the hub connection whose peer VMAC matches the
 *    destination; insert the source peer's VMAC as originating address and
 *    remove the destination address; discard when no match (AB.5.3.2)
 *  - broadcast: copy to every hub connection except the source, keeping the
 *    broadcast destination address and inserting the originating address
 *    (AB.5.3.3); never echo to the source connection (AB.5.1)
 *  - message ids are never altered when forwarding (AB.3.1.3)
 *
 * v1 ships this as a dev/test component (the in-repo test hub wraps it); it is
 * written to production rules so a future hub-function feature can reuse it.
 */
const events_1 = require("events");
const debug_1 = require("debug");
const SC = require("./sc-constants");
const bvlcSc = require("./bvlc-sc");
const { SCConnection } = require("./sc-connection");
const debug = (0, debug_1.default)('bacstack:sc:hub');
class ScHubFunction extends events_1.EventEmitter {
    constructor(options) {
        super();
        options = options || {};
        // Identity reported in Connect-Accept: the VMAC/UUID of the network port
        // hosting the hub function (AB.5.3.1)
        this._vmac = options.vmac || bvlcSc.generateRandom48();
        this._uuid = options.uuid || bvlcSc.uuidFromString(require("crypto").randomUUID());
        this._connectionOptions = {
            connectWaitMs: options.connectWaitMs,
            disconnectWaitMs: options.disconnectWaitMs,
            maxBvlcAccepted: options.maxBvlcAccepted || SC.Defaults.MAX_BVLC_ACCEPTED,
            maxNpduAccepted: options.maxNpduAccepted || SC.Defaults.MAX_NPDU_ACCEPTED
        };
        this._connections = new Set(); // every attached SCConnection (any state)
        this._byVmac = new Map(); // vmac hex string -> CONNECTED SCConnection
        this._stopped = false;
    }
    get vmac() { return this._vmac; }
    get uuid() { return this._uuid; }
    get connectedNodes() {
        const nodes = [];
        for (const [vmac, connection] of this._byVmac)
            nodes.push({
                vmac,
                uuid: bvlcSc.uuidToString(connection.peerInfo.uuid),
                maxBvlcLength: connection.peerInfo.maxBvlcLength,
                maxNpduLength: connection.peerInfo.maxNpduLength
            });
        return nodes;
    }
    /**
     * Adopt an accepted, already-upgraded WebSocket as a hub connection and
     * run the accepting-peer state machine on it.
     */
    attachSocket(ws) {
        if (this._stopped) {
            try {
                ws.close(1001);
            }
            catch (err) {
                debug('close on stopped hub failed: %s', err.message);
            }
            return null;
        }
        const connection = new SCConnection(Object.assign({
            role: SC.ConnectionRole.ACCEPTING,
            ws,
            vmac: this._vmac,
            uuid: this._uuid,
            duplicateCheck: (peer) => this._duplicateCheck(peer)
        }, this._connectionOptions));
        this._connections.add(connection);
        connection.on('connected', (info) => this._onNodeConnected(connection, info));
        connection.on('routable', (message) => this._route(connection, message));
        connection.on('closed', (info) => this._onConnectionClosed(connection, info));
        connection.on('status', (status) => this.emit('status', Object.assign({ connectionId: connection.id }, status)));
        connection.connect();
        return connection;
    }
    // AB.6.2.1 / AB.6.2.3 duplicate detection against the current table
    _duplicateCheck(peer) {
        if (peer.vmac.equals(this._vmac))
            return 'vmac-collision';
        const uuidHex = peer.uuid.toString('hex');
        for (const connection of this._byVmac.values()) {
            if (connection.peerInfo.uuid.toString('hex') === uuidHex)
                return 'uuid-takeover';
        }
        if (this._byVmac.has(bvlcSc.vmacToString(peer.vmac)))
            return 'vmac-collision';
        return 'ok';
    }
    _onNodeConnected(connection, info) {
        const vmacKey = bvlcSc.vmacToString(info.peerVmac);
        // AB.6.2.3: a Connect-Request with a known device UUID takes over the
        // existing connection — accept the new one, then close the old one.
        const uuidHex = info.peerUuid.toString('hex');
        for (const [existingVmac, existing] of this._byVmac) {
            if (existing !== connection && existing.peerInfo.uuid.toString('hex') === uuidHex) {
                debug('device uuid takeover: closing stale connection %d (%s)', existing.id, existingVmac);
                this._byVmac.delete(existingVmac);
                existing.destroy('UUID_TAKEOVER');
            }
        }
        this._byVmac.set(vmacKey, connection);
        debug('node %s connected (%d nodes online)', vmacKey, this._byVmac.size);
        this.emit('nodeConnected', { vmac: vmacKey, uuid: bvlcSc.uuidToString(info.peerUuid) });
    }
    _onConnectionClosed(connection, info) {
        this._connections.delete(connection);
        if (connection.peerInfo) {
            const vmacKey = bvlcSc.vmacToString(connection.peerInfo.vmac);
            // only remove the mapping if it still points at this connection
            // (a uuid takeover may already have replaced it)
            if (this._byVmac.get(vmacKey) === connection) {
                this._byVmac.delete(vmacKey);
                debug('node %s disconnected (%s)', vmacKey, info.reasonName);
                this.emit('nodeDisconnected', { vmac: vmacKey, reasonName: info.reasonName });
            }
        }
    }
    _route(sourceConnection, message) {
        const sourceVmac = sourceConnection.peerInfo ? sourceConnection.peerInfo.vmac : null;
        if (!sourceVmac)
            return;
        if (message.isBroadcast) {
            // AB.5.3.3: duplicate to every hub connection except the source; the
            // broadcast destination address remains, the originating address is
            // added (always the authenticated peer VMAC of the source connection).
            const forwarded = bvlcSc.encodeMessage({
                func: message.func,
                messageId: message.messageId,
                origVmac: sourceVmac,
                destVmac: SC.BROADCAST_VMAC,
                destOptions: message.destOptionsRaw,
                dataOptions: message.dataOptionsRaw,
                payload: message.payload
            });
            for (const connection of this._byVmac.values()) {
                if (connection !== sourceConnection)
                    connection.sendMessage(forwarded);
            }
            return;
        }
        // AB.5.3.2: unicast — forward to the matching hub connection, or discard
        const target = this._byVmac.get(bvlcSc.vmacToString(message.destVmac));
        if (!target) {
            debug('unicast to unknown node %s discarded', bvlcSc.vmacToString(message.destVmac));
            return;
        }
        const forwarded = bvlcSc.encodeMessage({
            func: message.func,
            messageId: message.messageId,
            origVmac: sourceVmac,
            // destination address removed when forwarding to its final hop
            destOptions: message.destOptionsRaw,
            dataOptions: message.dataOptionsRaw,
            payload: message.payload
        });
        target.sendMessage(forwarded);
    }
    /** Tear down every connection. graceful=true performs Disconnect-Request. */
    stop(graceful) {
        this._stopped = true;
        for (const connection of this._connections) {
            if (graceful)
                connection.disconnect();
            else
                connection.destroy('HUB_STOPPED');
        }
        this._connections.clear();
        this._byVmac.clear();
    }
}
exports.ScHubFunction = ScHubFunction;
