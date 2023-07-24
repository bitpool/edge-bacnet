'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transport = void 0;
const dgram_1 = require("dgram");
const events_1 = require("events");
const DEFAULT_BACNET_PORT = 47808;
class Transport extends events_1.EventEmitter {
    constructor(settings) {
        super();
        this._lastSendMessages = {};
        this._settings = settings;
        this._server = (0, dgram_1.createSocket)({ type: 'udp4', reuseAddr: true });
        this._server.on('message', (msg, rinfo) => this.emit('message', msg, rinfo.address));
        this._server.on('error', (err) => this.emit('message', err));
    }
    getBroadcastAddress() {
        return this._settings.broadcastAddress;
    }
    getMaxPayload() {
        return 1482;
    }
    send(buffer, offset, receiver) {
        if (!receiver) {
            receiver = this.getBroadcastAddress();
            const dataToSend = Buffer.alloc(offset);
            // Sort out broadcasted messages that we also receive
            // TODO Find a better way?
            const hrTime = process.hrtime();
            const messageKey = hrTime[0] * 1000000000 + hrTime[1];
            buffer.copy(dataToSend, 0, 0, offset);
            this._lastSendMessages[messageKey] = dataToSend;
            setTimeout(() => {
                delete this._lastSendMessages[messageKey];
            }, 10000); // delete after 10s, hopefully all cases are handled by that
        }
        const [address, port] = receiver.split(':');
        this._server.send(buffer, 0, offset, port || DEFAULT_BACNET_PORT, address);

    }
    open() {
        this._server.bind(this._settings.port, this._settings.interface, () => {
            this._server.setBroadcast(true);
        });
    }
    close() {
        this._server.close();
    }
}
exports.Transport = Transport;
