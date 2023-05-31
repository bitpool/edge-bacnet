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
            that.mDiscoverInstanceRange = config.mDiscoverInstanceRange;
            that.pointListRetryCount = config.pointListRetryCount;

        } else if(fromImport == false) {
            if(config.net && config.adr) {
                that.address = {address: config.address, net: config.net, adr: config.adr};
                that.isMstp = true;
            } else {
                that.address = config.address;
                that.isMstp = false;
            }
            that.deviceId = config.deviceId;
            that.maxApdu = config.maxApdu;
            that.segmentation = config.segmentation;
            that.vendorId = config.vendorId;
            that.lastSeen = null;
            that.deviceName = null;
            that.pointsList = [];
            that.pointListUpdateTs = null;
            that.manualDiscoveryMode = false;
            that.mDiscoverInstanceRange = {start: 0, end: 100};
            that.pointListRetryCount = 0;
        }
    }

    updateDeviceConfig(config) {
        if(config.address !== "" && config.address !== null && config.address !== "undefined") {
            if(config.net && config.adr) {
                this.address = {address: config.address, net: config.net, adr: config.adr};
            } else {
                this.address = config.address;
            }
        }
        if(Number.isInteger(config.deviceId)) this.deviceId = config.deviceId;
        if(Number.isInteger(config.maxApdu)) this.maxApdu = config.maxApdu;
        if(Number.isInteger(config.segmentation)) this.segmentation = config.segmentation;
        if(Number.isInteger(config.vendorId)) this.vendorId = config.vendorId;
    }

    getPointListRetryCount() {
        return this.pointListRetryCount;
    }

    incrementPointListRetryCount() {
        this.pointListRetryCount++;
    }

    clearPointListRetryCount() {
        this.pointListRetryCount = 0;
    }

    getmDiscoverInstanceRange() {
        return this.mDiscoverInstanceRange;
    }

    setmDiscoverInstanceRange(range) {
        this.mDiscoverInstanceRange = range;
    }

    updatemDiscoverInstanceRange(position, value) {
        this.mDiscoverInstanceRange[position] = value;
    }

    shouldBeInManualMode() {
        if(this.mDiscoverInstanceRange.start >= 1000000 || this.mDiscoverInstanceRange.end >= 1000000) {
            return false;
        }
        return true;
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