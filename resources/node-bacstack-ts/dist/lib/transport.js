'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transport = void 0;
const dgram_1 = require("dgram");
const events_1 = require("events");
const DEFAULT_BACNET_PORT = 47808;
class Transport extends events_1.EventEmitter {
    constructor(settings) {
        super();
        try {
            this._lastSendMessages = {};
            this._settings = settings;
            this._portRange = settings.portRangeMatrix;
            this.serverList = {};
            for (let i = 0; i < this._portRange.length; i++) {
                let port = this._portRange[i];
                this.serverList[port] = (0, dgram_1.createSocket)({ type: 'udp4', reuseAddr: true });
                this.serverList[port].on('message', (msg, rinfo) => this.emit('message', msg, rinfo.address, rinfo.port));
                this.serverList[port].on('error', (err) => this.emit('message', err));
            };
        } catch (e) {
            console.log("Transport constructor error: ", e);
        }
    }
    getBroadcastAddress() {
        return this._settings.broadcastAddress;
    }
    getMaxPayload() {
        return 1482;
    }
    send(buffer, offset, receiver, port) {
        try {
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

            const [address] = receiver.split(':');

            if (port == null || port == undefined || port == '' || port == 'null' || port == 'undefined') port = DEFAULT_BACNET_PORT;

            let serverExists = Object.keys(this.serverList).findIndex((existingPort) => port.toString() == existingPort);

            if (serverExists !== -1) {
                let server = this.serverList[port];
                server.send(buffer, 0, offset, port, address);
            }
        } catch (e) {
            console.log("Transport send error: ", e);
        }
    }
    open() {
        try {
            for (let port in this.serverList) {
                let server = this.serverList[port];
                if (server) {
                    server.bind(port, this._settings.interface, () => {
                        server.setBroadcast(true);
                    });
                }
            }
        } catch (e) {
            console.log("Transport open error: ", e);
        }
    }
    close() {
        try {
            for (let port in this.serverList) {
                let server = this.serverList[port];
                if (server) server.close();
            }
        } catch (e) {
            console.log("Transport close error: ", e);
        }
    }
}
exports.Transport = Transport;
