'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHubConnector = void 0;
/**
 * BACnet/SC hub connector. ANSI/ASHRAE 135-2020 AB.1.1.2 / AB.5.2 / AB.5.4.
 *
 * Maintains exactly one established hub connection at a time. Prefers the
 * primary hub; falls back to the failover hub when the primary cannot be
 * reached; while connected to the failover, keeps probing the primary on the
 * reconnect cadence and promotes it (then drops the failover) as soon as it is
 * back (AB.5.2). Reconnect attempts back off exponentially with jitter, capped
 * at 600 s (AB.6.1). A Connect NAK of NODE_DUPLICATE_VMAC regenerates the
 * local Random-48 VMAC before the next attempt (AB.6.2.2).
 *
 * Range enforcement of the configured timeouts (AB.6.1: 2..300 s etc.) is the
 * configuration layer's duty — values are used as given here so tests can run
 * fast.
 */
const events_1 = require("events");
const debug_1 = require("debug");
const SC = require("./sc-constants");
const bvlcSc = require("./bvlc-sc");
const { SCConnection } = require("./sc-connection");
const debug = (0, debug_1.default)('bacstack:sc:connector');
class SCHubConnector extends events_1.EventEmitter {
    constructor(options) {
        super();
        options = options || {};
        this._primaryHubUri = options.primaryHubUri || null;
        this._failoverHubUri = options.failoverHubUri || null;
        if (this._failoverHubUri && this._failoverHubUri === this._primaryHubUri) {
            debug('failover hub URI equals primary; ignoring failover');
            this._failoverHubUri = null;
        }
        this._vmac = options.vmac || bvlcSc.generateRandom48();
        this._uuid = options.uuid || null;
        this._tls = options.tls || {};
        this._verifyHostname = options.verifyHostname === true;
        this._wsFactory = options.wsFactory || null;
        this._reconnectMs = options.reconnectMs || SC.Defaults.RECONNECT_MS;
        this._reconnectCapMs = options.reconnectCapMs || SC.Defaults.RECONNECT_CAP_MS;
        this._connectWaitMs = options.connectWaitMs || SC.Defaults.CONNECT_WAIT_MS;
        this._disconnectWaitMs = options.disconnectWaitMs || SC.Defaults.DISCONNECT_WAIT_MS;
        this._heartbeatMs = options.heartbeatMs || SC.Defaults.HEARTBEAT_MS;
        this._maxBvlcAccepted = options.maxBvlcAccepted || SC.Defaults.MAX_BVLC_ACCEPTED;
        this._maxNpduAccepted = options.maxNpduAccepted || SC.Defaults.MAX_NPDU_ACCEPTED;
        this._vmacRetryCap = options.vmacRetryCap || SC.Defaults.VMAC_RETRY_CAP;
        this._started = false;
        this._active = null; // CONNECTED SCConnection currently in use
        this._activeHubType = null; // 'primary' | 'failover'
        this._attempt = null; // SCConnection currently trying to establish
        this._probe = null; // primary probe while running on failover
        this._reconnectTimer = null;
        this._probeTimer = null;
        this._consecutiveFailures = 0;
        this._consecutiveVmacCollisions = 0;
        this._nextTarget = 'primary';
    }
    get connected() { return this._active !== null; }
    get hubType() { return this._activeHubType; }
    get vmac() { return this._vmac; }
    get peerInfo() { return this._active ? this._active.peerInfo : null; }
    /** Max NPDU octets the current hub advertises it can forward for us. */
    get maxNpduTx() {
        return this._active ? this._active.peerInfo.maxNpduLength : SC.Defaults.MAX_NPDU_ACCEPTED;
    }
    getStatus() {
        return {
            started: this._started,
            connected: this.connected,
            hubType: this._activeHubType,
            uri: this._activeHubType === 'failover' ? this._failoverHubUri : this._primaryHubUri,
            vmac: bvlcSc.vmacToString(this._vmac),
            uuid: this._uuid ? bvlcSc.uuidToString(this._uuid) : null,
            consecutiveFailures: this._consecutiveFailures
        };
    }
    /**
     * Start connecting. Idempotent. Returns false (with an SC_NOT_CONFIGURED
     * status event) when mandatory configuration is missing — factory-default
     * devices refuse to run rather than half-work (AB.7.4.2).
     */
    start() {
        if (this._started)
            return true;
        const missing = [];
        if (!this._primaryHubUri)
            missing.push('primary hub URI');
        if (!this._uuid)
            missing.push('device UUID');
        if (!this._wsFactory) {
            if (!this._tls.ca)
                missing.push('CA certificate');
            if (!this._tls.cert)
                missing.push('operational certificate');
            if (!this._tls.key)
                missing.push('private key');
        }
        if (missing.length > 0) {
            this._status('error', 'SC_NOT_CONFIGURED', `BACnet/SC disabled: ${missing.join(', ')} required`);
            return false;
        }
        this._started = true;
        this._nextTarget = 'primary';
        this._attemptConnection('primary');
        return true;
    }
    /** Graceful, bounded, idempotent shutdown. Resolves when fully quiesced. */
    stop() {
        this._started = false;
        this._clearReconnectTimer();
        this._stopProbe();
        if (this._attempt) {
            this._attempt.destroy('CONNECTOR_STOPPED');
            this._attempt = null;
        }
        const active = this._active;
        this._active = null;
        this._activeHubType = null;
        if (!active)
            return Promise.resolve();
        return new Promise((resolve) => {
            const guard = setTimeout(() => {
                active.destroy('CONNECTOR_STOPPED');
                resolve();
            }, this._disconnectWaitMs + 500);
            if (guard.unref)
                guard.unref();
            active.once('closed', () => {
                clearTimeout(guard);
                resolve();
            });
            active.disconnect();
        });
    }
    /**
     * Send an NPDU through the current hub connection. destVmac null means
     * broadcast. Returns false when there is no hub connection (datalink drop —
     * upper layers retry/time out).
     */
    send(npduBuffer, destVmac) {
        if (!this._active) {
            debug('send dropped: no hub connection');
            return false;
        }
        return this._active.sendNpdu(npduBuffer, destVmac);
    }
    // ---------------------------------------------------------- connect loop
    _makeConnection(hubType) {
        return new SCConnection({
            role: SC.ConnectionRole.INITIATING,
            url: hubType === 'failover' ? this._failoverHubUri : this._primaryHubUri,
            vmac: this._vmac,
            uuid: this._uuid,
            tls: this._tls,
            verifyHostname: this._verifyHostname,
            wsFactory: this._wsFactory,
            connectWaitMs: this._connectWaitMs,
            disconnectWaitMs: this._disconnectWaitMs,
            heartbeatMs: this._heartbeatMs,
            maxBvlcAccepted: this._maxBvlcAccepted,
            maxNpduAccepted: this._maxNpduAccepted,
            advertisementProvider: () => ({
                hubConnectionStatus: this._activeHubType === 'primary'
                    ? SC.HubConnectionStatus.CONNECTED_TO_PRIMARY
                    : this._activeHubType === 'failover'
                        ? SC.HubConnectionStatus.CONNECTED_TO_FAILOVER
                        : SC.HubConnectionStatus.NO_HUB_CONNECTION
            })
        });
    }
    _attemptConnection(hubType) {
        if (!this._started || this._active || this._attempt)
            return;
        debug('attempting %s hub (%s)', hubType, hubType === 'failover' ? this._failoverHubUri : this._primaryHubUri);
        this._status('info', 'SC_CONNECTING', `Connecting to ${hubType} hub`, { hubType });
        const connection = this._makeConnection(hubType);
        this._attempt = connection;
        connection.on('status', (status) => this.emit('status', status));
        connection.once('connected', (info) => {
            if (this._attempt !== connection) {
                connection.destroy('STALE_ATTEMPT');
                return;
            }
            this._attempt = null;
            this._adoptActive(connection, hubType, info);
        });
        connection.once('closed', (info) => {
            if (this._attempt !== connection)
                return; // already adopted or superseded
            this._attempt = null;
            this._onAttemptFailed(hubType, info);
        });
        connection.connect();
    }
    _adoptActive(connection, hubType, info) {
        this._active = connection;
        this._activeHubType = hubType;
        this._consecutiveFailures = 0;
        this._consecutiveVmacCollisions = 0;
        connection.on('npdu', (payload) => {
            if (this._active === connection)
                this.emit('npdu', payload);
        });
        connection.on('advertisement', (advertisement) => this.emit('advertisement', advertisement));
        connection.once('closed', (closeInfo) => this._onActiveClosed(connection, closeInfo));
        debug('%s hub connection up (peer vmac %s)', hubType, bvlcSc.vmacToString(info.peerVmac));
        if (hubType === 'failover') {
            this._status('warn', 'FAILOVER_ACTIVE', 'Running on the failover hub; primary will be probed');
            this._startProbe();
        }
        else {
            this._stopProbe();
        }
        this.emit('up', {
            hubType,
            peerVmac: info.peerVmac,
            peerUuid: info.peerUuid,
            peerMaxBvlc: info.peerMaxBvlc,
            peerMaxNpdu: info.peerMaxNpdu,
            vmac: this._vmac
        });
    }
    _onActiveClosed(connection, info) {
        if (this._active !== connection)
            return; // superseded (e.g. failover dropped after promotion)
        this._active = null;
        const wasHubType = this._activeHubType;
        this._activeHubType = null;
        this._stopProbe();
        if (!this._started) {
            this.emit('down', { reasonName: info.reasonName, willRetryInMs: null });
            return;
        }
        this._handleVmacCollision(info);
        // AB.5.2: if an established primary hub connection is lost, first attempt
        // to re-establish the primary hub connection
        this._nextTarget = 'primary';
        const delay = this._nextRetryDelay();
        debug('%s hub connection lost (%s); retrying in %d ms', wasHubType, info.reasonName, delay);
        this.emit('down', { reasonName: info.reasonName, willRetryInMs: delay });
        this._scheduleReconnect(delay);
    }
    _onAttemptFailed(hubType, info) {
        if (!this._started)
            return;
        this._handleVmacCollision(info);
        this._consecutiveFailures += 1;
        // alternate targets when a failover hub is configured
        this._nextTarget = (hubType === 'primary' && this._failoverHubUri) ? 'failover' : 'primary';
        const delay = this._nextRetryDelay();
        debug('%s hub attempt failed (%s); next target %s in %d ms', hubType, info.reasonName, this._nextTarget, delay);
        this._status('warn', 'SC_CONNECT_FAILED', `Connection to ${hubType} hub failed (${info.reasonName}); retrying`, { hubType, reasonName: info.reasonName, willRetryInMs: delay });
        this._scheduleReconnect(delay);
    }
    _handleVmacCollision(closeInfo) {
        if (closeInfo.reasonName !== 'NODE_DUPLICATE_VMAC')
            return;
        this._consecutiveVmacCollisions += 1;
        if (this._consecutiveVmacCollisions >= this._vmacRetryCap) {
            // 2^-44 odds make honest repeat collisions implausible — a hub bug or a
            // cloned configuration is far more likely; keep retrying but say so.
            this._status('error', 'VMAC_COLLISION_LOOP', `${this._consecutiveVmacCollisions} consecutive VMAC collisions; check for cloned device identities`);
        }
        this._vmac = bvlcSc.generateRandom48();
        debug('regenerated VMAC after collision: %s', bvlcSc.vmacToString(this._vmac));
        this.emit('vmac-changed', this._vmac);
    }
    _nextRetryDelay() {
        const backoff = Math.min(this._reconnectMs * Math.pow(2, this._consecutiveFailures), this._reconnectCapMs);
        const jitter = 1 + (Math.random() * 0.4 - 0.2); // ±20 %
        return Math.max(this._reconnectMs, Math.round(backoff * jitter));
    }
    _scheduleReconnect(delay) {
        this._clearReconnectTimer();
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._attemptConnection(this._nextTarget);
        }, delay);
        if (this._reconnectTimer.unref)
            this._reconnectTimer.unref();
    }
    _clearReconnectTimer() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
    }
    // ------------------------------------------------------- primary probing
    _startProbe() {
        this._stopProbe();
        // AB.5.2: while the failover hub connection is established, attempts to
        // re-establish the primary hub connection continue, respecting the
        // reconnect timeout
        this._probeTimer = setTimeout(() => {
            this._probeTimer = null;
            this._probePrimary();
        }, this._reconnectMs);
        if (this._probeTimer.unref)
            this._probeTimer.unref();
    }
    _stopProbe() {
        if (this._probeTimer) {
            clearTimeout(this._probeTimer);
            this._probeTimer = null;
        }
        if (this._probe) {
            this._probe.destroy('PROBE_CANCELLED');
            this._probe = null;
        }
    }
    _probePrimary() {
        if (!this._started || this._activeHubType !== 'failover' || this._probe)
            return;
        debug('probing primary hub');
        const probe = this._makeConnection('primary');
        this._probe = probe;
        probe.on('status', (status) => {
            if (status.level === 'error')
                debug('probe status %s: %s', status.code, status.message);
        });
        probe.once('connected', (info) => {
            if (this._probe !== probe) {
                probe.destroy('STALE_PROBE');
                return;
            }
            this._probe = null;
            const failover = this._active;
            this._active = null; // detach so the failover 'closed' handler is a no-op
            this._activeHubType = null;
            this._status('info', 'PRIMARY_RESTORED', 'Primary hub restored; leaving the failover hub');
            this._adoptActive(probe, 'primary', info);
            if (failover) {
                failover.once('closed', () => debug('failover connection released'));
                failover.disconnect(); // graceful, in the background
            }
        });
        probe.once('closed', () => {
            if (this._probe !== probe)
                return;
            this._probe = null;
            if (this._started && this._activeHubType === 'failover')
                this._startProbe(); // next probe on the reconnect cadence
        });
        probe.connect();
    }
    _status(level, code, message, detail) {
        this.emit('status', { level, code, message, detail: detail || {} });
    }
}
exports.SCHubConnector = SCHubConnector;
