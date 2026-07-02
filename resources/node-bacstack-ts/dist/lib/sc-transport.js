'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScTransport = void 0;
/**
 * BACnet/SC datalink transport for the stack Client (ANSI/ASHRAE 135-2020
 * ANNEX AB, node role). Injected via the Client's existing options.transport
 * hook; the Client detects the sendNpdu capability and hands over raw NPDUs
 * instead of applying Annex-J B/IP framing (see sendBvlc in client.js).
 *
 * Addressing at this boundary is VMAC-as-string: uppercase colon-separated
 * hex ("C2:A1:5E:33:07:B4"), broadcast sentinel "FF:FF:FF:FF:FF:FF". Receivers
 * whose address is not VMAC-shaped (e.g. a stale cached IP address right after
 * a datalink mode switch) are dropped with a debug note — same UX as an
 * offline device; discovery re-learns addresses by device instance.
 *
 * This transport NEVER emits 'error': bacnet_client.js responds to client
 * errors by reinitialising the client, which would fight the connector's
 * internal reconnect loop. Everything is surfaced on 'scStatus' instead.
 */
const events_1 = require("events");
const crypto = require("crypto");
const debug_1 = require("debug");
const SC = require("./sc-constants");
const bvlcSc = require("./bvlc-sc");
const { SCHubConnector } = require("./sc-hub-connector");
const debug = (0, debug_1.default)('bacstack:sc:transport');
class ScTransport extends events_1.EventEmitter {
    constructor(options) {
        super();
        options = options || {};
        this._localMaxNpdu = options.maxNpduAccepted || SC.Defaults.MAX_NPDU_ACCEPTED;
        this._tls = {
            ca: options.ca,
            cert: options.cert,
            key: options.key,
            passphrase: options.keyPassphrase,
            crl: options.crl,
            allowTls12: options.allowTls12 === true
        };
        this._connector = new SCHubConnector({
            primaryHubUri: options.primaryHubUri,
            failoverHubUri: options.failoverHubUri,
            vmac: typeof options.vmac === 'string' ? bvlcSc.vmacFromString(options.vmac) : options.vmac,
            uuid: typeof options.uuid === 'string' ? bvlcSc.uuidFromString(options.uuid) : options.uuid,
            tls: this._tls,
            verifyHostname: options.verifyHostname,
            wsFactory: options.wsFactory,
            reconnectMs: options.reconnectMs,
            reconnectCapMs: options.reconnectCapMs,
            connectWaitMs: options.connectWaitMs,
            disconnectWaitMs: options.disconnectWaitMs,
            heartbeatMs: options.heartbeatMs,
            maxBvlcAccepted: options.maxBvlcAccepted,
            maxNpduAccepted: this._localMaxNpdu,
            vmacRetryCap: options.vmacRetryCap
        });
        this._lastScStatus = { state: 'disconnected', hub: null, uri: null };
        this._connector.on('up', (info) => {
            this._setScStatus({
                state: 'connected',
                hub: info.hubType,
                uri: this._connector.getStatus().uri,
                peerVmac: bvlcSc.vmacToString(info.peerVmac),
                peerMaxNpdu: info.peerMaxNpdu
            });
            this.emit('connected', { hub: info.hubType });
        });
        this._connector.on('down', (info) => {
            this._setScStatus({
                state: info.willRetryInMs === null ? 'disconnected' : 'reconnecting',
                hub: null,
                uri: null,
                error: info.reasonName,
                willRetryInMs: info.willRetryInMs
            });
            this.emit('disconnected', { reason: info.reasonName });
        });
        this._connector.on('status', (status) => {
            if (status.code === 'SC_NOT_CONFIGURED')
                this._setScStatus({ state: 'failed', hub: null, uri: null, error: status.code, message: status.message });
            else
                this.emit('scStatus', Object.assign({}, this._lastScStatus, {
                    level: status.level, code: status.code, message: status.message, detail: status.detail
                }));
        });
        this._connector.on('vmac-changed', (vmac) => this.emit('vmac-changed', bvlcSc.vmacToString(vmac)));
        this._connector.on('npdu', (payload) => {
            // The stack treats the remote address as an opaque string; a null
            // srcVmac means the message came from the hub's own hosting node.
            const remoteAddress = payload.srcVmac
                ? bvlcSc.vmacToString(payload.srcVmac)
                : (this._connector.peerInfo ? bvlcSc.vmacToString(this._connector.peerInfo.vmac) : SC.BROADCAST_VMAC_STRING);
            this.emit('npdu', payload.npdu, 0, payload.npdu.length, remoteAddress);
        });
    }
    // ------------------------------------------------ stack transport contract
    open() {
        this._checkOwnCertificate();
        this._connector.start();
    }
    close() {
        return this._connector.stop();
    }
    /**
     * The BACnet/SC framing seam (see client.js sendBvlc). receiver semantics:
     * null/undefined or the broadcast sentinel => broadcast via the hub;
     * a VMAC-shaped address string => unicast to that node.
     */
    sendNpdu(buffer, offset, length, receiver) {
        const npdu = buffer.subarray(offset, offset + length);
        if (!receiver || !receiver.address) {
            this._connector.send(npdu, null);
            return;
        }
        const vmac = bvlcSc.tryVmacFromString(receiver.address);
        if (!vmac) {
            // e.g. a stale IP-datalink address from the device cache
            debug('dropped NPDU for non-VMAC address %s', receiver.address);
            return;
        }
        this._connector.send(npdu, bvlcSc.isBroadcastVmac(vmac) ? null : vmac);
    }
    /**
     * Legacy B/IP-framed send. Unreachable through client.js once sendNpdu is
     * detected — kept as a guarded no-op in case of future direct callers.
     */
    send(buffer, offset, receiver, port) {
        debug('legacy transport.send() ignored in BACnet/SC mode (receiver %s port %s)', receiver, port);
    }
    getBroadcastAddress() {
        return SC.BROADCAST_VMAC_STRING;
    }
    /**
     * Sizing hint used by the Client for outgoing buffers (_getBuffer keeps a
     * 4-octet framing headroom, hence the +4) and for the maxApdu it
     * advertises. Re-read per request, so a renegotiated value after a
     * reconnect propagates automatically.
     */
    getMaxPayload() {
        return Math.min(this._connector.maxNpduTx, this._localMaxNpdu) + 4;
    }
    // ----------------------------------------------------------- diagnostics
    getLocalVmac() {
        return bvlcSc.vmacToString(this._connector.vmac);
    }
    getStatus() {
        return Object.assign({}, this._lastScStatus, this._connector.getStatus());
    }
    _setScStatus(status) {
        this._lastScStatus = status;
        this.emit('scStatus', status);
    }
    /**
     * Surfaces local operational-certificate problems early: expired certs
     * still attempt to connect (the hub decides), but the operator sees why.
     */
    _checkOwnCertificate() {
        if (!this._tls.cert || typeof crypto.X509Certificate !== 'function')
            return;
        try {
            const certificate = new crypto.X509Certificate(this._tls.cert);
            const notAfter = new Date(certificate.validTo);
            const daysRemaining = Math.floor((notAfter.getTime() - Date.now()) / 86400000);
            if (daysRemaining < 0)
                this.emit('scStatus', Object.assign({}, this._lastScStatus, {
                    level: 'error', code: 'LOCAL_CERTIFICATE_EXPIRED',
                    message: `Operational certificate expired ${-daysRemaining} day(s) ago (${certificate.subject})`
                }));
            else if (daysRemaining < 30)
                this.emit('scStatus', Object.assign({}, this._lastScStatus, {
                    level: 'warn', code: 'CERT_EXPIRES_SOON',
                    message: `Operational certificate expires in ${daysRemaining} day(s)`
                }));
        }
        catch (err) {
            this.emit('scStatus', Object.assign({}, this._lastScStatus, {
                level: 'error', code: 'LOCAL_CERTIFICATE_INVALID',
                message: `Operational certificate could not be parsed: ${err.message}`
            }));
        }
    }
}
exports.ScTransport = ScTransport;
