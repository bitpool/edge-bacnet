'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCConnection = void 0;
/**
 * One BACnet/SC connection over one WebSocket. ANSI/ASHRAE 135-2020 AB.6.
 *
 * Instances are SINGLE-USE: one instance drives one WebSocket attempt (or one
 * accepted socket) to a terminal CLOSED/FAILED state and is then discarded.
 * The owner (hub connector / hub function) creates a fresh instance per
 * attempt — this is the primary defence against reconnect races.
 *
 * role 'initiating' implements the Figure AB-11 state machine (hub connector
 * side, WebSocket client). role 'accepting' implements Figure AB-12 (used by
 * the hub function; dev/test-only in v1 but a full implementation).
 */
const events_1 = require("events");
const crypto = require("crypto");
const debug_1 = require("debug");
const SC = require("./sc-constants");
const bvlcSc = require("./bvlc-sc");
const debug = (0, debug_1.default)('bacstack:sc:connection');
const FN = SC.BvlcScFunction;
const ERR = SC.ScErrorCode;
const STATE = SC.ConnectionState;
const ROLE = SC.ConnectionRole;
// Messages whose VMAC fields are absent and which are consumed by the
// connection peer itself rather than being routable through a hub.
const CONNECTION_SCOPED = new Set([
    FN.CONNECT_REQUEST, FN.CONNECT_ACCEPT,
    FN.DISCONNECT_REQUEST, FN.DISCONNECT_ACK,
    FN.HEARTBEAT_REQUEST, FN.HEARTBEAT_ACK
]);
// ws bufferedAmount high-water mark — above this, sends are dropped with a
// status warning (datalink-drop semantics; the APDU layer retries).
const SEND_HIGH_WATER_BYTES = 4 * 1024 * 1024;
let nextConnectionId = 1;
class SCConnection extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.id = nextConnectionId++;
        this._role = options.role || ROLE.INITIATING;
        this._url = options.url || null;
        this._vmac = options.vmac; // Buffer(6) — local node identity
        this._uuid = options.uuid; // Buffer(16)
        this._tls = options.tls || {};
        this._verifyHostname = options.verifyHostname === true;
        this._subprotocol = options.subprotocol || SC.WS_SUBPROTOCOL_HUB;
        this._connectWaitMs = options.connectWaitMs || SC.Defaults.CONNECT_WAIT_MS;
        this._disconnectWaitMs = options.disconnectWaitMs || SC.Defaults.DISCONNECT_WAIT_MS;
        this._heartbeatMs = options.heartbeatMs || SC.Defaults.HEARTBEAT_MS;
        this._heartbeatAckWaitMs = options.heartbeatAckWaitMs || Math.min(10000, this._connectWaitMs);
        this._maxBvlcAccepted = options.maxBvlcAccepted || SC.Defaults.MAX_BVLC_ACCEPTED;
        this._maxNpduAccepted = options.maxNpduAccepted || SC.Defaults.MAX_NPDU_ACCEPTED;
        this._advertisementProvider = options.advertisementProvider || null;
        // accepting role: owner-supplied duplicate detection per AB.6.2.1/AB.6.2.3.
        // ({vmac, uuid, connection}) => 'ok' | 'vmac-collision' | 'uuid-takeover'
        this._duplicateCheck = options.duplicateCheck || null;
        this._wsFactory = options.wsFactory || null;
        this._ws = options.ws || null; // accepting role adopts an accepted socket
        this._state = STATE.IDLE;
        this._closedEmitted = false;
        this._started = false;
        this._peerInfo = null;
        this._lastPeerAdvertisement = null;
        this._pending = {}; // messageId -> { func }
        this._messageIdSeed = crypto.randomInt(0x10000);
        this._timers = {
            connectWait: null,
            disconnectWait: null,
            heartbeatIdle: null,
            heartbeatAckWait: null
        };
    }
    get state() { return this._state; }
    get role() { return this._role; }
    get peerInfo() { return this._peerInfo; }
    get lastPeerAdvertisement() { return this._lastPeerAdvertisement; }
    get localVmac() { return this._vmac; }
    /**
     * Start the connection state machine. Callable once.
     * Initiating: opens the WebSocket to options.url.
     * Accepting: adopts options.ws (an already-upgraded socket) and awaits a
     * Connect-Request within the connect wait timeout.
     */
    connect() {
        if (this._started)
            throw new Error('SCConnection instances are single-use; create a new instance to reconnect');
        this._started = true;
        if (this._role === ROLE.ACCEPTING) {
            if (!this._ws)
                throw new Error('accepting role requires options.ws');
            this._bindWs(this._ws);
            this._startConnectWait();
            this._transition(STATE.AWAITING_REQUEST);
            return;
        }
        let ws;
        try {
            ws = this._createWebSocket();
        }
        catch (err) {
            this._status('error', this._mapError(err), `WebSocket initiation failed: ${err.message}`);
            this._teardown(false, 'WEBSOCKET_INITIATION_FAILED', { err });
            return;
        }
        this._ws = ws;
        this._bindWs(ws);
        this._transition(STATE.AWAITING_WEBSOCKET);
    }
    _createWebSocket() {
        // AB.7.2 / AB.7.5.1: only "wss" URIs are supported
        if (!/^wss:\/\//i.test(this._url || ''))
            throw Object.assign(new Error(`URI scheme not supported for BACnet/SC: ${this._url}`), { code: 'WEBSOCKET_SCHEME_NOT_SUPPORTED' });
        const wsOptions = {
            ca: this._tls.ca,
            cert: this._tls.cert,
            key: this._tls.key,
            passphrase: this._tls.passphrase,
            crl: this._tls.crl,
            rejectUnauthorized: true,
            minVersion: this._tls.allowTls12 ? 'TLSv1.2' : 'TLSv1.3',
            maxVersion: 'TLSv1.3',
            handshakeTimeout: this._connectWaitMs,
            maxPayload: SC.Defaults.WS_HARD_MAX_PAYLOAD,
            perMessageDeflate: false,
            followRedirects: false
        };
        // AB.7.4: no hostname/CN/SAN checks unless specifically enabled
        if (!this._verifyHostname)
            wsOptions.checkServerIdentity = () => undefined;
        if (this._wsFactory)
            return this._wsFactory(this._url, [this._subprotocol], wsOptions);
        const WebSocket = require("ws");
        return new WebSocket(this._url, [this._subprotocol], wsOptions);
    }
    _bindWs(ws) {
        // handlers are kept so teardown can remove exactly these — calling
        // removeAllListeners() on a ws client would also strip the listeners a
        // WebSocketServer uses for its own client tracking
        this._wsHandlers = {
            open: () => this._onWsOpen(),
            message: (data, isBinary) => this._onWsMessage(data, isBinary),
            close: (code, reason) => this._onWsClose(code, reason),
            error: (err) => this._onWsError(err),
            'unexpected-response': (req, res) => this._onWsUnexpectedResponse(res)
        };
        for (const [event, handler] of Object.entries(this._wsHandlers))
            ws.on(event, handler);
    }
    // ---------------------------------------------------------------- timers
    _startTimer(name, ms, onExpiry) {
        this._clearTimer(name);
        const timer = setTimeout(onExpiry, ms);
        if (timer.unref)
            timer.unref();
        this._timers[name] = timer;
    }
    _clearTimer(name) {
        if (this._timers[name]) {
            clearTimeout(this._timers[name]);
            this._timers[name] = null;
        }
    }
    _startConnectWait() {
        this._startTimer('connectWait', this._connectWaitMs, () => {
            // AB.6.2: on connect wait expiry, close the WebSocket and enter IDLE
            this._status('warn', 'CONNECT_WAIT_TIMEOUT', 'Timed out waiting for the BACnet/SC connect handshake');
            this._closeWs(1002);
            this._teardown(false, 'CONNECT_WAIT_TIMEOUT');
        });
    }
    _armHeartbeatIdle() {
        if (this._role !== ROLE.INITIATING)
            return; // AB.6.3: initiating peers keep connections alive
        this._startTimer('heartbeatIdle', this._heartbeatMs, () => this._sendHeartbeat());
    }
    _sendHeartbeat() {
        if (this._state !== STATE.CONNECTED)
            return;
        const messageId = this._allocateMessageId(FN.HEARTBEAT_REQUEST);
        this._send(bvlcSc.encodeHeartbeatRequest({ messageId }));
        this._startTimer('heartbeatAckWait', this._heartbeatAckWaitMs, () => {
            this._status('warn', 'HEARTBEAT_TIMEOUT', 'No response to Heartbeat-Request; connection presumed dead');
            this._terminateWs();
            this._teardown(false, 'HEARTBEAT_TIMEOUT');
        });
    }
    // ------------------------------------------------------------ message id
    _nextMessageId() {
        // Mirrors the invoke-id pattern in client.js: increment, skip pending ids
        for (let i = 0; i < 0x10000; i++) {
            this._messageIdSeed = (this._messageIdSeed + 1) & 0xFFFF;
            if (!this._pending[this._messageIdSeed])
                return this._messageIdSeed;
        }
        debug('message id space exhausted; reusing current id');
        return this._messageIdSeed;
    }
    // For request messages that expect a response (tracked for correlation)
    _allocateMessageId(func) {
        const messageId = this._nextMessageId();
        this._pending[messageId] = { func };
        return messageId;
    }
    // ---------------------------------------------------------------- ws I/O
    _send(buffer) {
        const ws = this._ws;
        if (!ws || ws.readyState !== 1 /* OPEN */) {
            debug('send skipped, socket not open (state %s)', this._state);
            return false;
        }
        if (ws.bufferedAmount > SEND_HIGH_WATER_BYTES) {
            this._status('warn', 'SEND_BACKPRESSURE', `Send dropped: ${ws.bufferedAmount} bytes buffered on the WebSocket`);
            return false;
        }
        ws.send(buffer, { binary: true });
        return true;
    }
    _closeWs(code) {
        try {
            if (this._ws && this._ws.readyState <= 1)
                this._ws.close(code || 1000);
        }
        catch (err) {
            debug('ws close error: %s', err.message);
        }
    }
    _terminateWs() {
        try {
            if (this._ws && typeof this._ws.terminate === 'function')
                this._ws.terminate();
            else
                this._closeWs(1001);
        }
        catch (err) {
            debug('ws terminate error: %s', err.message);
        }
    }
    _onWsOpen() {
        if (this._state !== STATE.AWAITING_WEBSOCKET)
            return;
        // AB.7.1: the server must have selected the BACnet/SC subprotocol
        if (this._ws.protocol !== this._subprotocol) {
            this._status('error', 'WEBSOCKET_PROTOCOL_ERROR', `Peer selected subprotocol '${this._ws.protocol || ''}' instead of '${this._subprotocol}'`);
            this._closeWs(1002);
            this._teardown(false, 'WEBSOCKET_PROTOCOL_ERROR');
            return;
        }
        const messageId = this._allocateMessageId(FN.CONNECT_REQUEST);
        this._connectRequestId = messageId;
        this._send(bvlcSc.encodeConnectRequest({
            messageId,
            vmac: this._vmac,
            uuid: this._uuid,
            maxBvlcLength: this._maxBvlcAccepted,
            maxNpduLength: this._maxNpduAccepted
        }));
        this._startConnectWait();
        this._transition(STATE.AWAITING_ACCEPT);
    }
    _onWsMessage(data, isBinary) {
        // AB.7.5.3: only binary data frames are accepted
        if (!isBinary) {
            this._status('warn', 'WEBSOCKET_DATA_NOT_ACCEPTED', 'Non-binary WebSocket data frame received');
            this._closeWs(1003);
            this._teardown(false, 'WEBSOCKET_DATA_NOT_ACCEPTED');
            return;
        }
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        // AB.7.5.3: discard (do not close, do not NAK) oversized BVLC messages
        if (buffer.length > this._maxBvlcAccepted) {
            this._status('warn', 'BVLC_OVERSIZED', `Discarded ${buffer.length}-octet BVLC message (max accepted ${this._maxBvlcAccepted})`);
            return;
        }
        // Any traffic proves the link alive — reset keep-alive timers
        this._clearTimer('heartbeatAckWait');
        if (this._state === STATE.CONNECTED)
            this._armHeartbeatIdle();
        let message;
        try {
            message = bvlcSc.decodeMessage(buffer);
        }
        catch (err) {
            if (err instanceof bvlcSc.ScDecodeError) {
                this._nakMalformed(buffer, err);
                return;
            }
            throw err;
        }
        try {
            this._dispatch(message);
        }
        catch (err) {
            debug('dispatch error: %s', err.stack || err.message);
            this._status('error', 'DISPATCH_ERROR', `Internal error handling BVLC message: ${err.message}`);
        }
    }
    _onWsClose(code, reason) {
        const reasonName = SC.WsCloseCodeToErrorName[code] || 'WEBSOCKET_ERROR';
        debug('[%d] ws closed code=%d (%s)', this.id, code, reasonName);
        this._teardown(code === 1000, reasonName, { wsCode: code, wsReason: reason ? reason.toString() : undefined });
    }
    _onWsError(err) {
        const taxonomy = this._mapError(err);
        this._status(this._state === STATE.CONNECTED ? 'warn' : 'error', taxonomy, `WebSocket error: ${err.message}`);
        // ws emits 'close' after 'error' for established sockets, but not for
        // failed connection attempts — funnel both through teardown (idempotent).
        this._teardown(false, taxonomy, { err });
    }
    _onWsUnexpectedResponse(res) {
        const statusCode = res && res.statusCode;
        let taxonomy = 'HTTP_UNEXPECTED_RESPONSE_CODE';
        if (statusCode === 503)
            taxonomy = 'HTTP_TEMPORARY_UNAVAILABLE';
        else if (statusCode >= 300 && statusCode < 400)
            taxonomy = 'HTTP_NO_UPGRADE';
        this._status('error', taxonomy, `HTTP ${statusCode} response to the WebSocket upgrade request`);
        this._teardown(false, taxonomy, { httpStatusCode: statusCode });
    }
    _mapError(err) {
        if (err && err.code) {
            if (SC.NodeErrorToTaxonomy[err.code])
                return SC.NodeErrorToTaxonomy[err.code];
            if (SC.ScErrorCode[err.code] !== undefined)
                return err.code; // already an AB.7.5.1 taxonomy name
        }
        return this._state === STATE.AWAITING_WEBSOCKET ? 'TCP_ERROR' : 'WEBSOCKET_ERROR';
    }
    // -------------------------------------------------------------- dispatch
    _dispatch(message) {
        switch (this._state) {
            case STATE.AWAITING_ACCEPT:
                return this._dispatchAwaitingAccept(message);
            case STATE.AWAITING_REQUEST:
                return this._dispatchAwaitingRequest(message);
            case STATE.CONNECTED:
                return this._dispatchConnected(message);
            case STATE.DISCONNECTING:
                return this._dispatchDisconnecting(message);
            default:
                debug('[%d] message 0x%s dropped in state %s', this.id, message.func.toString(16), this._state);
        }
    }
    _dispatchAwaitingAccept(message) {
        if (message.func === FN.CONNECT_ACCEPT) {
            delete this._pending[message.messageId];
            this._clearTimer('connectWait');
            this._peerInfo = {
                vmac: Buffer.from(message.connect.vmac),
                uuid: Buffer.from(message.connect.uuid),
                maxBvlcLength: message.connect.maxBvlcLength,
                maxNpduLength: message.connect.maxNpduLength
            };
            this._transition(STATE.CONNECTED);
            this._armHeartbeatIdle();
            this.emit('connected', {
                peerVmac: this._peerInfo.vmac,
                peerUuid: this._peerInfo.uuid,
                peerMaxBvlc: this._peerInfo.maxBvlcLength,
                peerMaxNpdu: this._peerInfo.maxNpduLength
            });
            return;
        }
        if (message.func === FN.BVLC_RESULT && message.result.resultCode === SC.ResultCode.NAK) {
            delete this._pending[message.messageId];
            this._clearTimer('connectWait');
            const isDuplicateVmac = message.result.errorCode === ERR.NODE_DUPLICATE_VMAC;
            this._status('error', isDuplicateVmac ? 'NODE_DUPLICATE_VMAC' : 'CONNECT_REJECTED', `Connect-Request rejected (error code ${message.result.errorCode}${message.result.errorDetails ? `: ${message.result.errorDetails}` : ''})`);
            this._closeWs(1000);
            this._teardown(false, isDuplicateVmac ? 'NODE_DUPLICATE_VMAC' : 'CONNECT_REJECTED', { nak: message.result });
            return;
        }
        debug('[%d] unexpected 0x%s while awaiting Connect-Accept', this.id, message.func.toString(16));
    }
    _dispatchAwaitingRequest(message) {
        if (message.func !== FN.CONNECT_REQUEST) {
            debug('[%d] unexpected 0x%s while awaiting Connect-Request', this.id, message.func.toString(16));
            return;
        }
        const peer = {
            vmac: Buffer.from(message.connect.vmac),
            uuid: Buffer.from(message.connect.uuid),
            maxBvlcLength: message.connect.maxBvlcLength,
            maxNpduLength: message.connect.maxNpduLength
        };
        // AB.6.2.1 / AB.6.2.3: duplicate VMAC (different device UUID) is rejected;
        // a known device UUID takes over its existing connection.
        const verdict = this._duplicateCheck ? this._duplicateCheck(peer, this) : 'ok';
        if (verdict === 'vmac-collision') {
            this._send(bvlcSc.encodeResult({
                messageId: message.messageId,
                resultForFunction: FN.CONNECT_REQUEST,
                resultCode: SC.ResultCode.NAK,
                errorClass: SC.ScErrorClass.COMMUNICATION,
                errorCode: ERR.NODE_DUPLICATE_VMAC
            }));
            this._closeWs(1000);
            this._teardown(false, 'NODE_DUPLICATE_VMAC_REJECTED');
            return;
        }
        this._clearTimer('connectWait');
        this._peerInfo = peer;
        this._send(bvlcSc.encodeConnectAccept({
            messageId: message.messageId,
            vmac: this._vmac,
            uuid: this._uuid,
            maxBvlcLength: this._maxBvlcAccepted,
            maxNpduLength: this._maxNpduAccepted
        }));
        this._transition(STATE.CONNECTED);
        this.emit('connected', {
            peerVmac: peer.vmac,
            peerUuid: peer.uuid,
            peerMaxBvlc: peer.maxBvlcLength,
            peerMaxNpdu: peer.maxNpduLength,
            tookOver: verdict === 'uuid-takeover'
        });
    }
    _dispatchConnected(message) {
        // Initiating role, AB.5.4: a message from the hub whose destination VMAC
        // is present and not broadcast was misrouted — drop it.
        if (this._role === ROLE.INITIATING && message.destVmac && !message.isBroadcast) {
            debug('[%d] dropped hub message with non-broadcast destination VMAC', this.id);
            return;
        }
        // Accepting role: messages carrying a destination VMAC are for the hub
        // function to route, not for this endpoint.
        if (this._role === ROLE.ACCEPTING && message.destVmac) {
            this.emit('routable', message);
            return;
        }
        // Must-understand screening applies only to messages consumed locally
        // (never to forwarded traffic; the hub leaves options untouched).
        if (this._rejectUnknownMustUnderstand(message))
            return;
        switch (message.func) {
            case FN.ENCAPSULATED_NPDU:
                this.emit('npdu', {
                    npdu: message.payload,
                    srcVmac: message.origVmac ? Buffer.from(message.origVmac) : null,
                    isBroadcast: message.isBroadcast,
                    dataOptionsRaw: message.dataOptionsRaw
                });
                return;
            case FN.HEARTBEAT_REQUEST:
                this._send(bvlcSc.encodeHeartbeatAck({ messageId: message.messageId }));
                return;
            case FN.HEARTBEAT_ACK:
            case FN.BVLC_RESULT:
            case FN.ADDRESS_RESOLUTION_ACK:
                this._correlateResponse(message);
                return;
            case FN.DISCONNECT_REQUEST:
                // AB.6.2: respond Disconnect-ACK, close the WebSocket, enter IDLE
                this._send(bvlcSc.encodeDisconnectAck({ messageId: message.messageId }));
                this._closeWs(1000);
                this._teardown(true, 'DISCONNECTED_BY_PEER');
                return;
            case FN.ADVERTISEMENT:
                this._lastPeerAdvertisement = message.advertisement;
                this.emit('advertisement', Object.assign({ srcVmac: message.origVmac ? Buffer.from(message.origVmac) : null }, message.advertisement));
                return;
            case FN.ADVERTISEMENT_SOLICITATION:
                this._sendAdvertisement(message);
                return;
            case FN.ADDRESS_RESOLUTION:
                // v1 accepts no direct connections (AB.3.3)
                this._sendNak(message, FN.ADDRESS_RESOLUTION, ERR.OPTIONAL_FUNCTIONALITY_NOT_SUPPORTED);
                return;
            case FN.CONNECT_REQUEST:
            case FN.CONNECT_ACCEPT:
                debug('[%d] dropped connect message received while CONNECTED', this.id);
                return;
            case FN.DISCONNECT_ACK:
                debug('[%d] dropped unsolicited Disconnect-ACK', this.id);
                return;
            case FN.PROPRIETARY_MESSAGE:
                debug('[%d] dropped proprietary message (vendor %d)', this.id, message.proprietary.vendorId);
                return;
        }
    }
    _dispatchDisconnecting(message) {
        if (message.func === FN.DISCONNECT_ACK
            || (message.func === FN.BVLC_RESULT && message.result.resultCode === SC.ResultCode.NAK
                && message.messageId === this._disconnectRequestId)) {
            delete this._pending[message.messageId];
            this._closeWs(1000);
            this._teardown(true, 'DISCONNECTED');
            return;
        }
        if (message.func === FN.DISCONNECT_REQUEST) {
            // Simultaneous disconnect — answer and close
            this._send(bvlcSc.encodeDisconnectAck({ messageId: message.messageId }));
            this._closeWs(1000);
            this._teardown(true, 'DISCONNECTED');
            return;
        }
        debug('[%d] message 0x%s ignored while DISCONNECTING', this.id, message.func.toString(16));
    }
    _correlateResponse(message) {
        const pending = this._pending[message.messageId];
        if (pending)
            delete this._pending[message.messageId];
        else
            debug('[%d] unmatched response 0x%s (message id %d)', this.id, message.func.toString(16), message.messageId);
        if (message.func === FN.BVLC_RESULT && message.result.resultCode === SC.ResultCode.NAK) {
            // NPDU NAKs are fire-and-forget at the datalink — surface for diagnosis
            this._status('warn', 'BVLC_NAK_RECEIVED', `Peer NAKed function 0x${message.result.resultForFunction.toString(16)} (error code ${message.result.errorCode}${message.result.errorDetails ? `: ${message.result.errorDetails}` : ''})`);
        }
    }
    _rejectUnknownMustUnderstand(message) {
        // AB.3.1.4: unknown must-understand destination options — NAK for unicast,
        // silent drop for broadcast. v1 understands no destination options.
        for (const option of message.destOptions) {
            if (!option.mustUnderstand)
                continue;
            if (message.isBroadcast) {
                debug('[%d] broadcast with unknown must-understand option dropped', this.id);
                return true;
            }
            this._sendNak(message, message.func, ERR.HEADER_NOT_UNDERSTOOD, option.marker);
            return true;
        }
        return false;
    }
    _sendAdvertisement(solicitation) {
        // The Advertisement is NOT a response message: fresh message id, and it is
        // addressed per AB.3.1.2 so the soliciting node receives it.
        const provided = this._advertisementProvider ? this._advertisementProvider() : {};
        const messageId = this._nextMessageId(); // not a response message: fresh id, no correlation
        this._send(bvlcSc.encodeAdvertisement({
            messageId,
            destVmac: solicitation.origVmac ? Buffer.from(solicitation.origVmac) : undefined,
            hubConnectionStatus: provided.hubConnectionStatus !== undefined
                ? provided.hubConnectionStatus : SC.HubConnectionStatus.NO_HUB_CONNECTION,
            acceptsDirectConnections: 0,
            maxBvlcLength: this._maxBvlcAccepted,
            maxNpduLength: this._maxNpduAccepted
        }));
    }
    _sendNak(message, resultForFunction, errorCode, errorHeaderMarker) {
        // AB.3.1.5 / AB.3.1.1: NAK unicast messages only, and never NAK a BVLC-Result
        if (message.isBroadcast || message.func === FN.BVLC_RESULT)
            return;
        this._send(bvlcSc.encodeResult({
            messageId: message.messageId,
            destVmac: message.origVmac ? Buffer.from(message.origVmac) : undefined,
            resultForFunction: resultForFunction,
            resultCode: SC.ResultCode.NAK,
            errorClass: SC.ScErrorClass.COMMUNICATION,
            errorCode: errorCode,
            errorHeaderMarker: errorHeaderMarker
        }));
    }
    _nakMalformed(rawBuffer, decodeError) {
        this._status('warn', 'BVLC_DECODE_ERROR', `Malformed BVLC message (${decodeError.message})`);
        const peeked = bvlcSc.peekMessage(rawBuffer);
        if (peeked.messageId === null || peeked.isBroadcast || peeked.func === FN.BVLC_RESULT)
            return;
        this._send(bvlcSc.encodeResult({
            messageId: peeked.messageId,
            resultForFunction: peeked.func,
            resultCode: SC.ResultCode.NAK,
            errorClass: SC.ScErrorClass.COMMUNICATION,
            errorCode: decodeError.bacnetErrorCode,
            errorHeaderMarker: decodeError.headerMarker
        }));
    }
    // ------------------------------------------------------------ public API
    /**
     * Send an NPDU as an Encapsulated-NPDU. destVmac null/undefined means
     * broadcast. Returns false when the connection cannot take the message.
     */
    sendNpdu(npduBuffer, destVmac) {
        if (this._state !== STATE.CONNECTED)
            return false;
        const messageId = this._nextMessageId(); // fire-and-forget: no response tracked
        return this._send(bvlcSc.encodeEncapsulatedNpdu({
            messageId,
            destVmac: destVmac || SC.BROADCAST_VMAC,
            npdu: npduBuffer
        }));
    }
    /** Send a pre-encoded BVLC-SC message (hub function forwarding path). */
    sendMessage(buffer) {
        if (this._state !== STATE.CONNECTED)
            return false;
        return this._send(buffer);
    }
    /** Graceful disconnect: Disconnect-Request, await ACK, close. */
    disconnect() {
        if (this._state !== STATE.CONNECTED) {
            this.destroy('LOCAL_DISCONNECT');
            return;
        }
        const messageId = this._allocateMessageId(FN.DISCONNECT_REQUEST);
        this._disconnectRequestId = messageId;
        this._send(bvlcSc.encodeDisconnectRequest({ messageId }));
        this._startTimer('disconnectWait', this._disconnectWaitMs, () => {
            this._closeWs(1000);
            this._teardown(true, 'DISCONNECT_WAIT_TIMEOUT');
        });
        this._transition(STATE.DISCONNECTING);
    }
    /** Hard teardown. Always safe, idempotent. */
    destroy(reasonName) {
        this._terminateWs();
        this._teardown(false, reasonName || 'DESTROYED');
    }
    // -------------------------------------------------------------- internals
    _transition(to) {
        debug('[%d/%s] %s -> %s', this.id, this._role, this._state, to);
        this._state = to;
    }
    _status(level, code, message, detail) {
        this.emit('status', { level, code, message, detail: detail || {} });
    }
    /**
     * Single teardown funnel: clears every timer, drops pending state, detaches
     * the socket, and emits 'closed' exactly once.
     */
    _teardown(clean, reasonName, extra) {
        this._clearTimer('connectWait');
        this._clearTimer('disconnectWait');
        this._clearTimer('heartbeatIdle');
        this._clearTimer('heartbeatAckWait');
        this._pending = {};
        const ws = this._ws;
        if (ws) {
            this._ws = null;
            try {
                if (this._wsHandlers) {
                    for (const [event, handler] of Object.entries(this._wsHandlers))
                        ws.removeListener(event, handler);
                    this._wsHandlers = null;
                }
                // an aborted socket can still emit late errors (e.g. "closed
                // before the connection was established") — swallow them
                ws.on('error', () => { });
                if (ws.readyState <= 1) {
                    if (typeof ws.terminate === 'function')
                        ws.terminate();
                    else if (typeof ws.close === 'function')
                        ws.close();
                }
            }
            catch (err) {
                debug('teardown socket cleanup error: %s', err.message);
            }
        }
        const from = this._state;
        this._transition(clean ? STATE.CLOSED : STATE.FAILED);
        if (!this._closedEmitted) {
            this._closedEmitted = true;
            this.emit('closed', Object.assign({
                clean: !!clean,
                reasonName: reasonName || 'UNKNOWN',
                fromState: from
            }, extra || {}));
        }
    }
}
exports.SCConnection = SCConnection;
