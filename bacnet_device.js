class BacnetDevice {
    constructor(fromImport, config) {
        let that = this;

        if (fromImport == true) {
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
            that.pointListRetryCount = config.pointListRetryCount;
            that.priorityQueueIsActive = config.priorityQueueIsActive;
            that.priorityQueue = config.priorityQueue;
            that.lastPriorityQueueTS = config.lastPriorityQueueTS;

            if (config.childDevices) {
                that.childDevices = config.childDevices;
            } else {
                that.childDevices = [];
            }

            if (config.parentDeviceId) {
                that.parentDeviceId = config.parentDeviceId;
            } else {
                that.parentDeviceId = null;
            }

            that.displayName = config.displayName;
            that.protocolServicesSupported = config.protocolServicesSupported;
            that.isProtocolServicesSet = config.isProtocolServicesSet;
            that.isInitialQuery = config.isInitialQuery;
            that.isDumbMstpRouter = config.isDumbMstpRouter;

        } else if (fromImport == false) {
            if (config.net && config.adr) {
                that.address = { address: config.address, net: config.net, adr: config.adr };
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
            that.pointListRetryCount = 0;
            that.priorityQueueIsActive = false;
            that.priorityQueue = [];
            that.lastPriorityQueueTS = null;
            that.childDevices = [];
            that.parentDeviceId = null;
            that.displayName = null;
            that.protocolServicesSupported = [];
            that.protocolServicesSupported = [];
            that.isProtocolServicesSet = false;
            that.isInitialQuery = true;
            that.isDumbMstpRouter = false;
        }
    }

    setIsDumbMstpRouter(isDumbMstp) {
        this.isDumbMstpRouter = isDumbMstp;
    }

    getIsDumbMstpRouter() {
        return this.isDumbMstpRouter;
    }

    setDisplayName(displayName) {
        this.displayName = displayName;
    }

    getDisplayName() {
        return this.displayName;
    }

    setParentDeviceId(deviceId) {
        this.parentDeviceId = deviceId;
    }

    getParentDeviceId() {
        return this.parentDeviceId;
    }

    hasChildDevices() {
        if (this.childDevices.length > 0) {
            return true;
        } else if (this.childDevices.length == 0) {
            return false;
        }
    }

    addChildDevice(deviceId) {
        let foundIndex = this.childDevices.findIndex(ele => ele == deviceId);

        if (foundIndex == -1) {
            this.childDevices.push(deviceId);
        } else {
            this.childDevices[foundIndex] = deviceId
        }
    }

    getChildDevice(deviceId) {
        let foundIndex = this.childDevices.findIndex(ele => ele == deviceId);

        if (foundIndex !== -1) return this.childDevices[foundIndex];

        return null;
    }

    getChildDevices() {
        return this.childDevices;
    }

    setLastPriorityQueueTS() {
        this.lastPriorityQueueTS = Date.now();
    }

    getLastPriorityQueueTS() {
        return this.lastPriorityQueueTS;
    }

    setPriorityQueueIsActive(bool) {
        this.priorityQueueIsActive = bool;
    }

    getPriorityQueueIsActive() {
        return this.priorityQueueIsActive;
    }

    updatePriorityQueue(point) {
        let foundIndex = this.priorityQueue.findIndex(ele => ele.value.type == point.value.type && ele.value.instance == point.value.instance);
        if (foundIndex == -1) {
            //not found
            this.priorityQueue.push(point);
        }

        if (this.priorityQueue.length > 0) {
            this.setPriorityQueueIsActive(true);
        } else if (this.priorityQueue.length == 0) {
            this.setPriorityQueueIsActive(false);
        }
    }

    setPriorityQueue(points) {
        let queue = [];
        let keys = Object.keys(points);
        if (keys.length > 0) {
            keys.forEach(function (key) {
                let point = points[key];
                let pointRequestObject = { type: 12, value: point.meta.objectId }
                queue.push(pointRequestObject);
            });
            this.priorityQueue = queue;
            this.setPriorityQueueIsActive(true);
        } else if (keys.length == 0) {
            this.setPriorityQueueIsActive(false);
        }
    }

    getPriorityQueue() {
        return this.priorityQueue;
    }

    clearPriorityQueue() {
        this.priorityQueue = [];
        this.setPriorityQueueIsActive(false);
    }

    updateDeviceConfig(config) {
        if (config.address !== "" && config.address !== null && config.address !== "undefined") {
            if (config.net && config.adr) {
                this.address = { address: config.address, net: config.net, adr: config.adr };
            } else {
                this.address = config.address;
            }
        }
        if (Number.isInteger(config.deviceId)) this.deviceId = config.deviceId;
        if (Number.isInteger(config.maxApdu)) this.maxApdu = config.maxApdu;
        if (Number.isInteger(config.segmentation)) this.segmentation = config.segmentation;
        if (Number.isInteger(config.vendorId)) this.vendorId = config.vendorId;
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
        for (let index = 0; index < newPoints.length; index++) {
            let newPoint = newPoints[index];
            if (newPoint) {
                let foundIndex = this.pointsList.findIndex(ele => ele.value.type == newPoint.value.type && ele.value.instance == newPoint.value.instance);
                if (foundIndex == -1) {
                    //not found
                    this.pointsList.push(newPoint);
                }
            }
        }

        this.pointsList = this.pointsList.filter((point) =>
            point.value.type == 8 ||  //DEVICE
            point.value.type == 0 ||  //AI
            point.value.type == 1 ||  //AV
            point.value.type == 2 ||  //AO
            point.value.type == 3 ||  //BI
            point.value.type == 4 ||  //BV
            point.value.type == 5 ||  //BO
            point.value.type == 13 ||  //MSI
            point.value.type == 14 ||  //MSO
            point.value.type == 19     //MSV
        );
    }

    getDevicePoints() {
        return this.points;
    }

    getAddress() {
        return this.address;
    }

    setAddress(address) {
        this.address = address;
    }

    getDeviceId() {
        return this.deviceId;
    }

    setDeviceId(deviceId) {
        this.deviceId = deviceId;
    }

    getMaxApdu() {
        return this.maxApdu;
    }

    setMaxApdu(maxApdu) {
        this.maxApdu = maxApdu;
    }

    getSegmentation() {
        return this.segmentation;
    }

    setSegmentation(segmentation) {
        this.segmentation = segmentation;
    }

    getVendorId() {
        return this.vendorId;
    }

    setVendorId(vendorId) {
        this.vendorId = vendorId;
    }

    getLastSeen() {
        return this.lastSeen;
    }

    setLastSeen(lastSeen) {
        this.lastSeen = lastSeen;
    }

    getDeviceName() {
        return this.deviceName;
    }

    setDeviceName(deviceName) {
        this.deviceName = deviceName;

        if (this.getDisplayName() == null) {
            this.setDisplayName(deviceName);
        }
    }

    getIsMstpDevice() {
        return this.isMstp;
    }

    getIsProtocolServicesSet() {
        return this.isProtocolServicesSet;
    }

    setIsProtocolServicesSet(boolean) {
        this.isProtocolServicesSet = boolean;
    }

    getProtocolServicesSupported() {
        return this.protocolServicesSupported;
    }

    setProtocolServicesSupported(bitArray) {
        let position = 0;
        for (let i = 0; i < bitArray.length; i++) {
            let bitString = bitArray[i];
            for (let x = 0; x < bitString.length; x++) {
                let bit = bitString[x];
                this.protocolServicesSupported[position] = bit;
                position++;
            }
        }
        this.setIsProtocolServicesSet(true);
    }

    getProtocolServiceSupport(protocol) {
        switch (protocol) {
            case "ReadPropertyMultiple":
                if (this.protocolServicesSupported[14] == '1') {
                    return true;
                } else if (this.protocolServicesSupported[14] == '0') {
                    return false;
                }
                break;

            default:
                return false;
        }
    }

    getMstpNetworkNumber() {
        if (this.isMstp) {
            return this.address.net;
        } else {
            return false;
        }
    }

    getIsInitialQuery() {
        return this.isInitialQuery;
    }

    setIsInitialQuery(bool) {
        this.isInitialQuery = bool;
    }

}

module.exports = { BacnetDevice };