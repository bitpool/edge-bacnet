class BacnetDevice {
    constructor(fromImport, config) {
        let that = this;

        if(fromImport == true) {
            that.address = config.address;
            that.isMstp = config.isMstp;
            that.deviceId = config.deviceId;
            that.maxApdu = config.maxApdu;
            that.segmentation = config.segmentation;
            that.vendorId = config.vendorId;
            that.lastSeen = config.lastSeen;
            that.deviceName = config.deviceName;
            that.pointsList = config.pointsList;
            that.pointListUpdateTs = config.pointListUpdateTs;
            that.manualDiscoveryMode = config.manualDiscoveryMode;

        } else if(fromImport == false) {

            if(config.header.source) {
                that.address = {address: config.header.sender.address, net: config.header.source.net, adr: config.header.source.adr};
                that.isMstp = true;
            } else {
                that.address = config.header.sender.address;
                that.isMstp = false;
            }
            that.deviceId = config.payload.deviceId;
            that.maxApdu = config.payload.maxApdu;
            that.segmentation = config.payload.segmentation;
            that.vendorId = config.payload.vendorId;
            that.lastSeen = null;
            that.deviceName = null;
            that.pointsList = [];
            that.pointListUpdateTs = null;
            that.manualDiscoveryMode = false;
        }
    }

    updateDeviceConfig(config) {
        if(config.header.sender.address !== "" && config.header.sender.address !== null && config.header.sender.address !== "undefined") {
            if(config.header.source) {
                this.address = {address: config.header.sender.address, net: config.header.source.net, adr: config.header.source.adr};
            } else {
                this.address = config.header.sender.address;
            }
        }
        if(Number.isInteger(config.deviceId)) this.deviceId = config.payload.deviceId;
        if(Number.isInteger(config.maxApdu)) this.maxApdu = config.payload.maxApdu;
        if(Number.isInteger(config.segmentation)) this.segmentation = config.payload.segmentation;
        if(Number.isInteger(config.vendorId)) this.vendorId = config.payload.vendorId;
    }

    setManualDiscoveryMode(bool) {
        this.manualDiscoveryMode = bool;
    }

    getManualDiscoveryMode() {
        return this.manualDiscoveryMode;
    }

    setPointListUpdateTS(ts) {
        this.pointListUpdateTs = ts;
    }

    getPointListUpdateTS() {
        return this.pointListUpdateTs;
    }

    getPointsList() {
        return this.pointsList;
    }

    setPointsList(newPoints) {
        for(let index = 0; index < newPoints.length; index ++){
            let newPoint = newPoints[index];
            let foundIndex = this.pointsList.findIndex(ele => ele.value.type == newPoint.value.type && ele.value.instance == newPoint.value.instance);
            if(foundIndex == -1 ) {
                //not found
                this.pointsList.push(newPoint);
            }
        }
    }

    getDevicePoints() {
        return this.points;
    }

    getAddress() {
        return this.address;
    }

    setAddress(address){
        this.address = address;
    }

    getDeviceId() {
        return this.deviceId;
    }

    setDeviceId(deviceId){
        this.deviceId = deviceId;
    }

    getMaxApdu() {
        return this.maxApdu;
    }

    setMaxApdu(maxApdu){
        this.maxApdu = maxApdu;
    }

    getSegmentation() {
        return this.segmentation;
    }

    setSegmentation(segmentation){
        this.segmentation = segmentation;
    }

    getVendorId() {
        return this.vendorId;
    }

    setVendorId(vendorId){
        this.vendorId = vendorId;
    }

    getLastSeen() {
        return this.lastSeen;
    }

    setLastSeen(lastSeen){
        this.lastSeen = lastSeen;
    }

    getDeviceName() {
        return this.deviceName;
    }

    setDeviceName(deviceName){
        this.deviceName = deviceName;
    }

    getIsMstpDevice(){
        return this.isMstp;
    }

}

module.exports = { BacnetDevice };