class BacnetDevice {
    constructor(config) {
        let that = this;
        that.address = config.address;
        that.deviceId = config.deviceId;
        that.maxApdu = config.maxApdu;
        that.segmentation = config.segmentation;
        that.vendorId = config.vendorId;
        that.lastSeen = null;
        that.deviceName = null;
        that.pointsList = [];
        that.pointListUpdateTs = null;
    }

    updateDeviceConfig(config) {
        if(config.address !== "" && config.address !== null && config.address !== "undefined") this.address = config.address;
        if(Number.isInteger(config.deviceId)) this.deviceId = config.deviceId;
        if(Number.isInteger(config.maxApdu)) this.maxApdu = config.maxApdu;
        if(Number.isInteger(config.segmentation)) this.segmentation = config.segmentation;
        if(Number.isInteger(config.vendorId)) this.vendorId = config.vendorId;
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
        this.pointsList = newPoints;
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

}

module.exports = { BacnetDevice };