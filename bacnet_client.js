/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

const bacnet = require('./resources/bacstack/lib/client');
const baEnum = require('./resources/bacstack/lib/enum');
const baAsn1 = require('./resources/bacstack/lib/asn1');
const { EventEmitter } = require('events');
const { DeviceObjectId, DeviceObject, logger, getUnit, roundDecimalPlaces } = require('./common');
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler')
const { BacnetDevice } = require('./bacnet_device');
const {Mutex, Semaphore, withTimeout} = require("async-mutex");
class BacnetClient extends EventEmitter {

    //client constructor
    constructor(config) {
        super();
        let that = this;
        that.deviceList = [];
        that.pointReferenceList = [];
        that.networkTree = {};
        that.lastWhoIs = null;
        that.client = null;
        that.lastNetworkPoll = null;
        that.scheduler = new ToadScheduler();
        that.mutex = new Mutex();

        try {
            that.config = config;
            that.roundDecimal = config.roundDecimal;
            that.apduSize = config.apduSize;
            that.maxSegments = config.maxSegments;
            that.discover_polling_schedule = config.discover_polling_schedule;
            that.device_id_range_enabled = config.device_id_range_enabled;
            that.device_id_range_start = config.device_id_range_start;
            that.device_id_range_end = config.device_id_range_end;

            that.readPropertyMultipleOptions = {
                maxSegments: that.maxSegments,
                apduSize: that.apduSize
            };

            try {

                that.client = new bacnet({ apduTimeout: config.apduTimeout, interface: config.localIpAdrress, port: config.port, broadcastAddress: config.broadCastAddr});
                that.setMaxListeners(1);

                const task = new Task('simple task', () => { 
                    that.globalWhoIs(); 
                });

                const job = new SimpleIntervalJob({ seconds: parseInt(that.discover_polling_schedule), }, task)
                
                that.scheduler.addSimpleIntervalJob(job)

                //query device task
                const queryDevices = new Task('simple task', () => { 
                    that.queryDevices(); 
                });

                const queryJob = new SimpleIntervalJob({ seconds: parseInt(that.discover_polling_schedule), }, queryDevices)
                
                that.scheduler.addSimpleIntervalJob(queryJob);

                //buildNetworkTreeData task
                const buildNetworkTree = new Task('simple task', () => { 
                    that.buildNetworkTreeData();
                });

                const buildNetworkTreeJob = new SimpleIntervalJob({ seconds: 5, }, buildNetworkTree)
                
                that.scheduler.addSimpleIntervalJob(buildNetworkTreeJob);

                that.globalWhoIs();

                setTimeout(() => {
                    that.queryDevices();
                  }, "5000")

            } catch(e){
                console.log("Issue initializing client: ", e)
            }

            //who is callback
            that.client.on('iAm', (device) => {
                //only add unique device to array
                let foundIndex = that.deviceList.findIndex(ele => ele.getAddress() == device.address);
                if(foundIndex == -1) {
                    let newBacnetDevice = new BacnetDevice(device);
                    newBacnetDevice.setLastSeen(Date.now());
                    that.updateDeviceName(newBacnetDevice);
                    that.deviceList.push(newBacnetDevice);

                } else if(foundIndex !== -1) {
                    that.deviceList[foundIndex].updateDeviceConfig(device);
                    that.deviceList[foundIndex].setLastSeen(Date.now());
                    that.updateDeviceName(that.deviceList[foundIndex]);
                }
                
                //emit event for node-red to log 
                that.emit('deviceFound', device);
            });
        } catch(e){
            console.log("Issue with creating bacnet client, see error:  ", e);
        }

        that.client.on('error', (err) => {
            console.log('Error occurred: ', err);

            if(err.errno == -4090){
                console.log("Invalid Client information or incorrect IP address provided");
            } else if(err.errno == -49) {
                console.log("Invalid IP address provided");
            } else {
                that.reinitializeClient(that.config);
            }
        });

    }

    queryDevices() {
        let that = this;
        that.deviceList.forEach(function(device, index){
            that.mutex
            .acquire()
            .then(function(release) {
                try {
                    that.getDevicePointList(device).then(function() {
                        that.buildJsonObject(device).then(function() {
                            release();
                        }).catch(function(e) {
                            release();
                        });
                    }).catch(function(e){
                        release();
                    });
                } catch(e) {
                    console.log("Error while querying devices: ", e);
                    release();
                }
            });
        });
    }

    updateDeviceName(device) {
        let that = this;
        that._getDeviceName(device.address, device.deviceId).then(function(deviceName) {
            device.setDeviceName(deviceName);
        });
    }

    reinitializeClient(config) {
        let that = this;

        that.device_id_range_enabled = config.device_id_range_enabled;
        that.device_id_range_start = config.device_id_range_start;
        that.device_id_range_end = config.device_id_range_end;

        if(that.client !== null) {
            that.client.close();
            that.client = null;
        } 

        if(that.scheduler !== null) {
            that.scheduler.stop();
        }

        try{
            that.client = new bacnet({ apduTimeout: config.apduTimeout, interface: config.localIpAdrress, port: config.port, broadcastAddress: config.broadCastAddr});

            const task = new Task('simple task', () => { 
                that.globalWhoIs(); 
            });

            const job = new SimpleIntervalJob({ seconds: parseInt(config.discover_polling_schedule), }, task)
            
            that.scheduler.addSimpleIntervalJob(job);

            that.globalWhoIs();

        } catch(e){
            console.log("Error reinitializing bacnet client: ", e)
        }
    };

    buildPointReferenceList(promiseArray){
        let that = this;

        let points = promiseArray.map(function(element){return element.point})
        let promises = promiseArray.map(function(element){return element.promise})
        promiseArray.forEach(function(element){
            let point = element.point;

            Promise.resolve(element.promise).then(function(result){
                that.pointReferenceList.push({})
            });
        });

    }

    getValidPointProperties(point, requestedProps){
        let availableProps = point.propertyList;
        let newProps = [];

        try{
            requestedProps.forEach(function(prop) {
                let foundInAvailable = availableProps.find(ele => ele === prop.id);
                if(foundInAvailable) newProps.push(prop);
            });
            //add object name for use in formatting
            newProps.push({id: baEnum.PropertyIds.PROP_OBJECT_NAME});
        } catch(e){
            console.log("Issue finding valid object properties, see error: ", e);
        }

        return newProps;
    }

    doRead(readConfig, outputType, msgId) {
        let that = this;

        that.roundDecimal = readConfig.precision;
        let devicesToRead = Object.keys(readConfig.pointsToRead);
        let propertiesToRead = readConfig.objectProperties;

        try {
            devicesToRead.forEach(function(deviceAddress) {
                let requestArray = [];
                let readPromiseArray = [];
                let pointsToReadNames = Object.keys(readConfig.pointsToRead[deviceAddress]);
                let device = that.deviceList.find(ele => ele.address == deviceAddress);
                pointsToReadNames.forEach(function(pointName, index) {
                    let point = readConfig.pointsToRead[deviceAddress][pointName];
                    readPromiseArray.push(that._readObjectFull(deviceAddress, point.meta.objectId.type, point.meta.objectId.instance));
                });
                that.readDeviceAndEmitJSON(readPromiseArray, device, outputType, propertiesToRead, msgId);
            });

        } catch(e){
            console.log("Issue doing read, see error: ", e);
        }

    }

    readDeviceAndEmitJSON(readPromiseArray, device, outputType, propertiesToRead, msgId) {
        let that = this;
        let deviceName = device.deviceName;

        let bacnetResults = {
            [deviceName]: []
        };

        try{
            Promise.all(readPromiseArray).then((result) => {
                let values = {};

                // remove errors and map to result element
                let successfulResults = result.filter(element => !element.error).map(element => element.value);
                successfulResults.forEach(element => {
                    try {
                        element.values.forEach(function(point){
                            point.values.forEach(function(object) {                             
                                let toReadProperty = propertiesToRead.findIndex(ele => ele.id == object.id);
                                //checks for error code json structure, returned for invalid bacnet requests
                                if(!object.value.value && toReadProperty !== -1) {      
                                    var currobjectId = point.objectId.type
                                    let bac_obj = that.getObjectType(currobjectId);                                
                                    let objectName = that._findValueById(point.values, baEnum.PropertyIds.PROP_OBJECT_NAME);

                                    let objectId;
                                    if(objectName !== null) {
                                        objectName = objectName.split(" ").join("_");
                                        objectId = objectName + "_" + bac_obj + '_' + point.objectId.instance;
                                    } else {
                                        objectId = bac_obj + '_' + point.objectId.instance;
                                    }

                                    //init json object
                                    if(!values[objectId]) values[objectId] = {};

                                    switch(object.id) {
                                        case baEnum.PropertyIds.PROP_PRESENT_VALUE:                                            
                                            if(object.value[0] && object.value[0].value) values[objectId].presentValue = roundDecimalPlaces(object.value[0].value, that.roundDecimal);
                                            break;
                                        case baEnum.PropertyIds.PROP_DESCRIPTION:
                                            if(object.value[0]) values[objectId].description = object.value[0].value;
                                            break;
                                        case baEnum.PropertyIds.PROP_STATUS_FLAGS:
                                            if(object.value[0] && object.value[0].value) values[objectId].statusFlags = that.getStatusFlags(object);
                                            break;
                                        case baEnum.PropertyIds.PROP_RELIABILITY:
                                            if(object.value[0]) values[objectId].reliability = that.getPROP_RELIABILITY(object.value[0].value);
                                            break; 
                                        case baEnum.PropertyIds.PROP_OUT_OF_SERVICE:
                                            if(object.value[0]) values[objectId].outOfService = object.value[0].value;
                                            break;
                                        case baEnum.PropertyIds.PROP_UNITS:
                                            if(object.value[0] && object.value[0].value) values[objectId].units = getUnit(object.value[0].value);
                                            break;
                                        case baEnum.PropertyIds.PROP_OBJECT_NAME:
                                            if(object.value[0] && object.value[0].value) values[objectId].objectName = object.value[0].value;
                                            break;
                                    }
                                }
                            });
                        }); 
                        bacnetResults[deviceName] = values;

                    } catch(e) {
                        console.log("issue resolving bacnet payload, see error:  ", e);
                    }
                });
                if(Object.keys(bacnetResults[deviceName]).length !== 0) {
                    that.emit('values', device, bacnetResults, outputType, msgId, successfulResults);
                }
                
            }).catch(function (error) {
                logger.log('error', `Error while fetching values: ${error}`);
            });

        } catch(e){
            console.log("Issue reading from device, see error: ", e);
        }
    }



    _getDeviceName(address, deviceId) {
        let that = this;
        return new Promise((resolve, reject) => {
            that._readDeviceName(address, deviceId, (err, result) => {
                if(result) {
                    result.values[0].values.forEach(object => {
                        try {
                            if(object.value[0]) {
                                resolve(object.value[0].value);
                            } else {
                                console.log("Issue with deviceName payload, see object: ", object);
                            }
                        } catch(e){
                            console.log("Unable to get device name: ", e);
                        }
                    });
                }            
            });
        });
    }

    getPropertiesForType(props, type) {
        let newProps = [];
        props.forEach(function(prop) {
            //console.log(prop);
            switch(type){
                case 0:  //analog-input
                    newProps.push(prop);
                    break;
                case 1: //analog-output
                    newProps.push(prop);
                    break;
                case 2: //analog-value
                    newProps.push(prop);
                    break;
                case 3: //binary-input
                    newProps.push(prop);
                    break;
                case 4: //binary-output
                    newProps.push(prop);
                    break;
                case 5: //binary-value
                    newProps.push(prop);
                    break;
                case 13:
                    if(prop.id == baEnum.PropertyIds.PROP_PRESENT_VALUE || prop.id == baEnum.PropertyIds.PROP_OBJECT_NAME) newProps.push(prop);
                    break;     
                case 14:
                    if(prop.id == baEnum.PropertyIds.PROP_PRESENT_VALUE || prop.id == baEnum.PropertyIds.PROP_OBJECT_NAME) newProps.push(prop);
                    break;   
                case 19:
                    if(prop.id == baEnum.PropertyIds.PROP_PRESENT_VALUE || prop.id == baEnum.PropertyIds.PROP_OBJECT_NAME) newProps.push(prop);
                    break;              
            }
        });
        return newProps;
    }

    getDevicePointList(device) {
        let that = this;
        return new Promise(async function(resolve, reject) {
            try {
                let result = await that.scanDevice(device);
                device.setPointsList(result);
                resolve(result);

            } catch(e) {
                console.log("Error getting point list: ", e);
                reject(e);
            }
            
        });
    }

    _readObjectWithRequestArray(deviceAddress, requestArray) {
        let that = this;

        return new Promise((resolve, reject) => {
            this.client.readPropertyMultiple(deviceAddress, requestArray, that.readPropertyMultipleOptions, (error, value) => {
                resolve({
                    error: error,
                    value: value
                });
            });
        });
    }

    _readObject(deviceAddress, type, instance, properties) {
        let that = this;
        return new Promise((resolve, reject) => {
            const requestArray = [{
                objectId: { type: type, instance: instance },
                properties: properties
            }];
            this.client.readPropertyMultiple(deviceAddress, requestArray, that.readPropertyMultipleOptions, (error, value) => {
                resolve({
                    error: error,
                    value: value
                });
            });
        });
    }

    _readDeviceName(deviceAddress, deviceId, callback){
        let that = this;
        const requestArray = [{
            objectId: { type: baEnum.ObjectTypes.OBJECT_DEVICE, instance: deviceId },
            properties: [
                { id: baEnum.PropertyIds.PROP_OBJECT_NAME }
            ]
        }];

        this.client.readPropertyMultiple(deviceAddress, requestArray, that.readPropertyMultipleOptions, callback);
    }

    _readObjectList(deviceAddress, deviceId, callback) {
        let that = this;
        const requestArray = [{
            objectId: { type: baEnum.ObjectTypes.OBJECT_DEVICE, instance: deviceId },
            properties: [{ id: baEnum.PropertyIds.PROP_OBJECT_LIST }
            ]
        }];
        
        try {
            that.client.readPropertyMultiple(deviceAddress, requestArray, that.readPropertyMultipleOptions, callback);
        } catch(e) {
            console.log("Error reading object list:  ", e);
        }
    }

    _readObjectFull(deviceAddress, type, instance) {

        return this._readObject(deviceAddress, type, instance, [
            { id: baEnum.PropertyIds.PROP_OBJECT_IDENTIFIER },
            { id: baEnum.PropertyIds.PROP_OBJECT_NAME },
            { id: baEnum.PropertyIds.PROP_OBJECT_TYPE },
            { id: baEnum.PropertyIds.PROP_DESCRIPTION },
            { id: baEnum.PropertyIds.PROP_UNITS },
            { id: baEnum.PropertyIds.PROP_PRESENT_VALUE },
            { id: baEnum.PropertyIds.PROP_PROPERTY_LIST },
            { id: baEnum.PropertyIds.PROP_STATUS_FLAGS },
            { id: baEnum.PropertyIds.PROP_RELIABILITY },
            { id: baEnum.PropertyIds.PROP_OUT_OF_SERVICE }
        ]);
    };

    _readObjectPropList(deviceAddress, type, instance) {

        return this._readObject(deviceAddress, type, instance, [
            { id: baEnum.PropertyIds.PROP_PROPERTY_LIST }
        ]);
    };

    _readObjectId(deviceAddress, type, instance) {

        return this._readObject(deviceAddress, type, instance, [
            { id: baEnum.PropertyIds.PROP_OBJECT_IDENTIFIER }
        ]);
    }

    _readObjectPresentValue(deviceAddress, type, instance) {

        return this._readObject(deviceAddress, type, instance, [
            { id: baEnum.PropertyIds.PROP_PRESENT_VALUE },
            { id: baEnum.PropertyIds.PROP_OBJECT_NAME}
        ]);
    }

    doWrite(value, options){
        let that = this;
        let valuesArray = [];

        options.pointsToWrite.forEach(function(point){

            let deviceAddress = point.deviceAddress;

            if(valuesArray[deviceAddress] == null || valuesArray[deviceAddress] == undefined){
                valuesArray[deviceAddress] = [];
            }

            let writeObject = {
                objectId: {
                    type: point.meta.objectId.type,
                    instance: point.meta.objectId.instance
                },
                values: [{
                    property: {
                        id: 85,
                        index: point.meta.arrayIndex
                    },
                    value: [{
                        type: options.appTag,
                        value: value
                    }],
                    priority: options.priority
                }]
            };

            valuesArray[deviceAddress].push(writeObject);
        });

        return that._writePropertyMultiple(valuesArray);
    }

    _writePropertyMultiple(values) {
        let that = this;
        let writePromises = [];
        try {
            return new Promise((resolve, reject) => {
                for(const device in values) {
                    writePromises.push(that.client.writePropertyMultiple(device, values[device], that.readPropertyMultipleOptions, (err, value) => {
                        resolve({
                            error: err,
                            value: value
                        })}
                    ));
                }
    
                Promise.all(writePromises).then(function(result) {
                    resolve(result);
                }).catch(function(e) {
                    console.log("Error writing:  ", e);
                });
            });
        } catch (error) {
            console.log(error);
        }
    }

    _findValueById(properties, id) {
        const property = properties.find(function (element) {
            return element.id === id;
        });
        if (property && property.value && property.value.length > 0) {
            return property.value[0].value;
        } else {
            return null;
        }
    };

    _mapToDeviceObject(object) {
        if (!object || !object.values) {
            return null;
        }

        const objectInfo = object.values[0].objectId;
        const deviceObjectId = new DeviceObjectId(objectInfo.type, objectInfo.instance);
        const objectProperties = object.values[0].values;
        const name = this._findValueById(objectProperties, baEnum.PropertyIds.PROP_OBJECT_NAME);
        const PROP_DESCRIPTION = this._findValueById(objectProperties, baEnum.PropertyIds.PROP_DESCRIPTION);
        const type = this._findValueById(objectProperties, baEnum.PropertyIds.PROP_OBJECT_TYPE);
        const PROP_UNITS = this._findValueById(objectProperties, baEnum.PropertyIds.PROP_UNITS);
        const presentValue = this._findValueById(objectProperties, baEnum.PropertyIds.PROP_PRESENT_VALUE);

        return new DeviceObject(deviceObjectId, name, PROP_DESCRIPTION, type, PROP_UNITS, presentValue);
    }

    scanForDevices(config) {
        let that = this;

        //scan on first poll
        if(that.lastWhoIs == null){
            doScan();
            that.lastWhoIs = Date.now();
        
        //scan every hour 
        } else if (((Date.now() / 1000) - (that.lastWhoIs  / 1000)) >= 3600) {
            doScan();
            that.lastWhoIs = Date.now();
        }

        function doScan() {
            let deviceIdRange = config.device.deviceId.split("-").sort(function(a, b){return a-b});
            let options = {
                lowLimit: deviceIdRange[0],
                highLimit: deviceIdRange[1]
            };

            if(that.client) {
                that.client.whoIs(options);
            } else {
                that.reinitializeClient(that.config);
            }
        }
    }

    scanDevice(device) {
        return new Promise((resolve, reject) => {
            this._readObjectList(device.address, device.deviceId, (err, result) => {
                if (!err) {
                    try {
                        resolve(result.values[0].values[0].value);
                    } catch(e) {
                        console.log("Issue with getting device point list, see error:  ", e);
                    }
                } else {
                    logger.log('error', `Error while fetching objects: ${err}`);
                    reject(err);
                }
            });
        });
    }

    //closes bacnet client
    shutDownClient() {
        let that = this;
        if(that.client) that.client.close((err, result) => {
            console.log(err, result);
        });
    };

    globalWhoIs() {
        let that = this;
        let options = {
            lowLimit: 0,
            highLimit: baAsn1.BACNET_MAX_INSTANCE
        };

        if(that.device_id_range_enabled == true) {
            options.lowLimit = that.device_id_range_start;
            options.highLimit = that.device_id_range_end;
        }

        if(that.client) {
            that.client.whoIs(options);
        } else {
            that.reinitializeClient(that.config);
        }
        that.lastWhoIs = Date.now();
    }


    getNetworkTreeData() {
        let that = this;
        return new Promise(async function(resolve, reject) {
            try {
                resolve({renderList: that.renderList, deviceList: that.deviceList, pointList: that.networkTree, pollFrequency: that.discover_polling_schedule});
            } catch(e){
                reject(e);
            }
        });
    }

    sortPoints(a, b) {
        if(a.bacnetType > b.bacnetType) {
            return 1;
        } else if(a.bacnetType < b.bacnetType) {
            return -1;
        } else if(a.bacnetType == b.bacnetType) {
            return 0;
        }

        return a.label.localeCompare(b.label)
    }

    buildNetworkTreeData() {
        let that = this;        
        return new Promise(async function(resolve, reject) {
            if(!that.renderList) that.renderList = [];
            if(that.deviceList && that.networkTree) {
                that.deviceList.forEach(function(deviceInfo, index) {
                    let ipAddr = deviceInfo.getAddress();
                    let deviceName = deviceInfo.getDeviceName() == null ? ipAddr : deviceInfo.getDeviceName();                    
                    let deviceObject = that.networkTree[ipAddr];

                    if(deviceObject) {
                        let children = [];
                        let pointIndex = 0;

                        for(const pointName in deviceObject) {
                            let pointProperties = [];
                            let values = deviceObject[pointName];

                            if(values.objectName){
                                pointProperties.push({"key": `${index}-${pointIndex}-0`, "label": `Name: ${values.objectName}`, "data": values.objectName, "icon": "pi pi-bolt", "children": null});
                            }
                            if(values.objectType){
                                pointProperties.push({"key": `${index}-${pointIndex}-1`, "label": `Object Type: ${values.objectType}`, "data": values.objectType, "icon": "pi pi-bolt", "children": null});
                            } 
                            if(values.objectID && values.objectID.instance) {
                                pointProperties.push({"key": `${index}-${pointIndex}-2`, "label": `Object Instance: ${values.objectID.instance}`, "data": values.objectID.instance, "icon": "pi pi-bolt", "children": null});
                            }
                            if(values.description){
                                pointProperties.push({"key": `${index}-${pointIndex}-3`, "label": `Description: ${values.description}`, "data": `${values.description}`, "icon": "pi pi-bolt", "children": null});
                            }
                            if(values.units){
                                pointProperties.push({"key": `${index}-${pointIndex}-4`, "label": `Units: ${values.units}`, "data": `${values.units}`, "icon": "pi pi-bolt", "children": null});
                            }
                            if(values.presentValue !== "undefined" && values.presentValue !== null) {
                                pointProperties.push({"key": `${index}-${pointIndex}-5`, "label": `Present Value: ${values.presentValue}`, "data": `${values.presentValue}`, "icon": "pi pi-bolt", "children": null});
                            }
                            children.push({"key": `${index}-${pointIndex}`, "label": pointName, "data": pointName, "icon": "", "children": pointProperties, "type": "point", "parentDevice": deviceName, "showAdded": false, "bacnetType": values.meta.objectId.type})
                            pointIndex++;
                        }
                        let foundIndex = that.renderList.findIndex(ele => ele.key == index && ele.ipAddr == ipAddr);
                        if(foundIndex !== -1) {
                            that.renderList[foundIndex] = {"key": index, "label": deviceName, "data": deviceName, "icon": "pi pi-box", "children": children.sort(that.sortPoints), "type": "device", "lastSeen": deviceInfo.getLastSeen(), "showAdded": false, "ipAddr": ipAddr};
                        } else if(foundIndex == -1) {
                            that.renderList.push({"key": index, "label": deviceName, "data": deviceName, "icon": "pi pi-box", "children": children.sort(that.sortPoints), "type": "device", "lastSeen": deviceInfo.getLastSeen(), "showAdded": false, "ipAddr": ipAddr});
                        }
                        if(index == that.deviceList.length - 1) {
                            resolve({renderList: that.renderList, deviceList: that.deviceList, pointList: that.networkTree, pollFrequency: that.discover_polling_schedule});
                        }
                    } else {
                        if(index == that.deviceList.length - 1) resolve({renderList: that.renderList, deviceList: that.deviceList, pointList: that.networkTree, pollFrequency: that.discover_polling_schedule});
                    }
                });
            }
        });
    }

    buildJsonObject(device, result) {
        let that = this;    
        let address = device.address;
        let pointList = device.getPointsList();

        return new Promise(function(resolve, reject) {           
            let promiseArray = [];
            pointList.forEach(function(point, pointListIndex) {
                promiseArray.push(that._readObjectFull(address, point.value.type, point.value.instance));
                if(pointListIndex == pointList.length - 1) {
                    Promise.all(promiseArray).then(function(objectList){
                        that.buildResponse(objectList, device).then(function() {
                            that.lastNetworkPoll = Date.now();
                            resolve({deviceList: that.deviceList, pointList: that.networkTree});
                        }).catch(function(e){
                            console.log("Error while building json object: ", e);
                            reject(e);
                        });
                    }).catch(function(e) {
                        console.log("Error while building json object: ", e);
                        reject(e);
                    });
                }
            });
        });
    }

    // Builds response object for a fully qualified 
    buildResponse(fullObjects, device) {
        let that = this;
        let deviceName = device.getDeviceName();
        let ipAddr = device.getAddress();

        return new Promise(function(resolve, reject) {
            let values = that.networkTree[device.getAddress()] ? that.networkTree[device.getAddress()] : {};

            for(let i = 0; i < fullObjects.length; i++) {
            
                let obj = fullObjects[i];
                let successfulResult = !obj.error ? obj.value : null;

                if(successfulResult) {
                    successfulResult.values.forEach(function(pointProperty, pointPropertyIndex) {

                        let currobjectId = pointProperty.objectId.type
                        let bac_obj = that.getObjectType(currobjectId);
                        
                        let objectName = that._findValueById(pointProperty.values, baEnum.PropertyIds.PROP_OBJECT_NAME);
                        let objectType = that._findValueById(pointProperty.values, baEnum.PropertyIds.PROP_OBJECT_TYPE);
                        
                        let objectId;
                        if(objectName !== null) {
                            objectName = objectName.split(" ").join("_");
                            objectId = objectName + "_" + bac_obj + '_' + pointProperty.objectId.instance;
                        } else {
                            objectId = bac_obj + '_' + pointProperty.objectId.instance;
                        }

                        if(!values[objectId]) values[objectId] = {};
                        values[objectId].meta = {
                            objectId: pointProperty.objectId
                        };
                        
                        try {
                            pointProperty.values.forEach(function(object, objectIndex) {
                                //checks for error code json structure, returned for invalid bacnet requests
                                if(!object.value.value) {
                                    switch(object.id) {
                                        case baEnum.PropertyIds.PROP_PRESENT_VALUE:
                                            if(object.value[0] && object.value[0].value !== "undefined" && object.value[0].value !== null) {
                                                //check for binary object type
                                                if(objectType == 3 || objectType == 4 || objectType == 5){
                                                    if(object.value[0].value == 0) {
                                                        values[objectId].presentValue = false;
                                                    } else if(object.value[0].value == 1) {
                                                        values[objectId].presentValue = true;
                                                    }
                                                } else {
                                                    values[objectId].presentValue = roundDecimalPlaces(object.value[0].value, 2);
                                                }
                                            } 
                                            values[objectId].meta.arrayIndex = object.index;
                                            break;
                                        case baEnum.PropertyIds.PROP_DESCRIPTION:
                                            if(object.value[0]) values[objectId].description = object.value[0].value;
                                            break;
                                        case baEnum.PropertyIds.PROP_UNITS:
                                            if(object.value[0] && object.value[0].value) values[objectId].units = getUnit(object.value[0].value);
                                            break;
                                        case baEnum.PropertyIds.PROP_OBJECT_NAME:
                                            if(object.value[0] && object.value[0].value) values[objectId].objectName = object.value[0].value;
                                            break;
                                        case baEnum.PropertyIds.PROP_OBJECT_TYPE:
                                            if(object.value[0] && object.value[0].value) values[objectId].objectType = object.value[0].value;
                                            break;
                                        case baEnum.PropertyIds.PROP_OBJECT_IDENTIFIER:
                                            if(object.value[0] && object.value[0].value) values[objectId].objectID = object.value[0].value;
                                            break;    
                                        case baEnum.PropertyIds.PROP_PROPERTY_LIST:
                                            if(object.value) values[objectId].propertyList = that.mapPropsToArray(object.value);
                                            break;                                                                                        
                                    }
                                }

                                if(pointPropertyIndex == successfulResult.values.length - 1 && objectIndex == pointProperty.values.length - 1 && i == fullObjects.length - 1) {
                                    that.networkTree[device.getAddress()] = values;
                                    resolve(that.networkTree);
                                } 
                            });
                        } catch(e) {
                            console.log("issue resolving bacnet payload, see error:  ", e);
                            reject(e);
                        }
                    });
                } else {
                    //error found in point property
                    if(i == fullObjects.length - 1) {
                        that.networkTree[device.getAddress()] = values;
                        resolve(that.networkTree);
                    }
                }
            }
            reject("Unexpectedly found end of loop, line 861");
        });
    }

    mapPropsToArray(propertyList) {
        let uniquePropArray = [];
        for(let i = 0; i < propertyList.length; i++) {
            if(uniquePropArray.indexOf(propertyList[i].value) === -1) uniquePropArray.push(propertyList[i].value);
        }
        return uniquePropArray;
    }

    getObjectType(objectId) {
        switch(objectId) {
            case 0:
                return "AI";
            case 1:
                return "AO";
            case 2:
                return "AV";
            case 3: 
                return "BI";
            case 4:
                return "BO";
            case 5:
                return "BV";
            case 8:
                return "Device";
            case 13: 
                return "MI";
            case 14:
                return "MO";
            case 19:
                return "MV";
            default: 
                return "";
        }
    }

    getPROP_RELIABILITY(value) {
        switch(value) {
            case 0:
                return "No Fault Detected";
            case 1:
                return "No Sensor";
            case 2:
                return "Over Range";
            case 3: 
                return "Under Range";
            case 4:
                return "Open Loop";
            case 5:
                return "Shorted Loop";
            case 6:
                return "No Output";
            case 7:
                return "Unreliable Other";
            case 8:
                return "Process Error";
            case 9:
                return "Multi State Fault";    
            case 10:
                return "Configuration Error";
            case 11:
                return "Member Fault";
            case 12:
                return "Communication Failure";
            case 13:
                return "Tripped";
            default:
                return "";            
        }
    }

    getStatusFlags(flags) {
        return flags.value[0].value;
    }
}

module.exports = { BacnetClient };
