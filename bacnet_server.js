const bacnet = require('./resources/node-bacnet/index.js');
const baEnum = bacnet.enum;
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler')

class BacnetServer {

    constructor(client, deviceId, rebuildSchedule, nodeRedVersion){
        let that = this;        
        that.bacnetClient = client;
        that.rebuildScheduleSeconds = rebuildSchedule;
        that.scheduler = new ToadScheduler();
        that.objectIdNumber = 1;
        that.nodeRedVersion = nodeRedVersion;
        that.deviceId = deviceId;
        that.objectList = [
            {value: {type: baEnum.ObjectType.DEVICE, instance: that.deviceId}, type: 12}
        ];
        that.objectStore = {
            [baEnum.ObjectType.DEVICE]: {
                [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{value: {type: baEnum.ObjectType.DEVICE, instance: that.deviceId}, type: 12}],  // OBJECT_IDENTIFIER
                [baEnum.PropertyIdentifier.OBJECT_LIST]: that.objectList,                                                  // OBJECT_IDENTIFIER
                [baEnum.PropertyIdentifier.OBJECT_NAME]: [{value: 'Bitpool Edge BACnet Gateway', type: 7}],            // OBJECT_NAME
                [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{value: 8, type: 9}],                          // OBJECT_TYPE
                [baEnum.PropertyIdentifier.DESCRIPTION]: [{value: 'Bitpool Edge BACnet gateway', type: 7}],          // DESCRIPTION
                [baEnum.PropertyIdentifier.SYSTEM_STATUS]: [{value: 0, type: 9}], // SYSTEM_STATUS
                [baEnum.PropertyIdentifier.VENDOR_NAME]:  [{value: "Bitpool", type: 7}], //VENDOR_NAME
                [baEnum.PropertyIdentifier.VENDOR_IDENTIFIER]:  [{value: 1401, type: 7}], //VENDOR_IDENTIFIER
                [baEnum.PropertyIdentifier.MODEL_NAME]:  [{value: "bitpool-edge", type: 7}],  //MODEL_NAME
                [baEnum.PropertyIdentifier.FIRMWARE_REVISION]:  [{value: "Node-Red " + that.nodeRedVersion, type: 7}], //FIRMWARE_REVISION
            },
            [baEnum.ObjectType.ANALOG_VALUE]: [],
            [baEnum.ObjectType.CHARACTERSTRING_VALUE]: []
        };

        that.bacnetClient.client.on('whoIs', (device) => {
            that.bacnetClient.client.iAmResponse(that.bacnetClient.broadCastAddr, that.deviceId, baEnum.Segmentation.SEGMENTED_BOTH, 27823);
        });

        that.bacnetClient.client.on('readPropertyMultiple', (data) => {

            let senderAddress = data.header.sender.address;
            let requestProps = data.payload.properties;
            let responseObject = [];

            try {
                if(requestProps) {

                    for(let i = 0; i < requestProps.length; i++) {

                        let prop = requestProps[i].properties[0].id;
                        let type = requestProps[i].objectId.type;
                        let instance = requestProps[i].objectId.instance;
                        let foundObject = that.getObjectMultiple(type, prop, instance, requestProps[i].properties);

                        if(foundObject !== null && foundObject !== undefined && foundObject !== "undefined") {
                            responseObject.push({objectId: {type: type, instance: instance}, values: foundObject});
                        }
                        
                        if(i == requestProps.length - 1) {
                            if(responseObject.length > 0) {
                                that.bacnetClient.client.readPropertyMultipleResponse(senderAddress, data.invokeId, responseObject);
                            } else {
                                that.bacnetClient.client.errorResponse(
                                    data.address, 
                                    baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE, 
                                    data.invokeId,
                                    baEnum.ErrorClass.PROPERTY, 
                                    baEnum.ErrorCode.UNKNOWN_PROPERTY
                                );
                            }
                        }
                    }
                }

            } catch(e) {
                console.log("Bacnet server readPropertyMultiple error: ", e);

                that.bacnetClient.client.errorResponse(
                    data.address, 
                    baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE, 
                    data.invokeId,
                    baEnum.ErrorClass.PROPERTY, 
                    baEnum.ErrorCode.UNKNOWN_PROPERTY
                );
            }
        });

        that.bacnetClient.client.on('readProperty', (data) => {
            try {
                let objectId = data.payload.objectId.type;
                let objectInstance = data.payload.objectId.instance;
                let propId = data.payload.property.id.toString();
                let responseObj = that.getObject(objectId, propId, objectInstance);

                if(responseObj !== null && responseObj !== undefined && typeof responseObj !== "undefined") {
                    that.bacnetClient.client.readPropertyResponse(data.header.sender.address, data.invokeId, objectId, data.payload.property, responseObj);
                } else {
                    that.bacnetClient.client.errorResponse(
                        data.address, 
                        baEnum.ConfirmedServiceChoice.READ_PROPERTY, 
                        data.invokeId,
                        baEnum.ErrorClass.PROPERTY, 
                        baEnum.ErrorCode.UNKNOWN_PROPERTY
                    );
                }
            } catch(e) {
                console.log("Local BACnet device readProperty error: ", e);
            }

        });

        //do initial iAm broadcast when BACnet server starts
        that.bacnetClient.client.iAmResponse(that.bacnetClient.broadCastAddr, that.deviceId, baEnum.Segmentation.SEGMENTED_BOTH, 27823);

        try {
            //add clear server job to schedule
            const task = new Task('simple task', () => {
                that.clearServerPoints(); 
            });

            const job = new SimpleIntervalJob({ seconds: parseInt(that.rebuildScheduleSeconds), }, task)
            
            that.scheduler.addSimpleIntervalJob(job)

        } catch (error) {
            
        }
    }

    addObject(name, value) {
        let that = this;
        if(name && value) {
            let formattedName = name.replaceAll('.', '');
            let objectType = that.getBacnetObjectType(value);

            if(objectType == "number") {
                let foundIndex = that.objectStore[baEnum.ObjectType.ANALOG_VALUE].findIndex(ele => ele[baEnum.PropertyIdentifier.OBJECT_NAME][0].value == formattedName);
                if(foundIndex == -1) {
                 let objectId = that.getObjectIdentifier();
                 that.objectStore[baEnum.ObjectType.ANALOG_VALUE].push({
                     [baEnum.PropertyIdentifier.OBJECT_NAME]: [{value: formattedName, type: 7}],
                     [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{value: baEnum.ObjectType.ANALOG_VALUE, type: 9}],
                     [baEnum.PropertyIdentifier.DESCRIPTION]: [{value: '', type: 7}],
                     [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{value: {type: baEnum.ObjectType.ANALOG_VALUE, instance: objectId}, type: 12}],
                     [baEnum.PropertyIdentifier.PRESENT_VALUE]: [{value: value, type: 4}],
                     [baEnum.PropertyIdentifier.PROPERTY_LIST]: 
                     [
                         {value: baEnum.PropertyIdentifier.OBJECT_NAME, type: 9 }, 
                         {value: baEnum.PropertyIdentifier.OBJECT_TYPE, type: 9 },
                         {value: baEnum.PropertyIdentifier.DESCRIPTION, type: 9 },
                         {value: baEnum.PropertyIdentifier.OBJECT_IDENTIFIER, type: 9 },
                         {value: baEnum.PropertyIdentifier.PROPERTY_LIST, type: 9 },
                         {value: baEnum.PropertyIdentifier.PRESENT_VALUE, type: 9 }
                     ],
                 });
     
                 that.objectList.push({value: {type: baEnum.ObjectType.ANALOG_VALUE, instance: objectId}, type: 12})
                } else if(foundIndex !== -1) {

                    let foundObject = that.objectStore[baEnum.ObjectType.ANALOG_VALUE][foundIndex];
                    foundObject[baEnum.PropertyIdentifier.PRESENT_VALUE][0].value = value;
                }
            } else if(objectType == "string") {
                let foundIndex = that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].findIndex(ele => ele[baEnum.PropertyIdentifier.OBJECT_NAME][0].value == formattedName);
                if(foundIndex == -1) {
                 let objectId = that.getObjectIdentifier();
                 that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].push({
                     [baEnum.PropertyIdentifier.OBJECT_NAME]: [{value: formattedName, type: 7}],
                     [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{value: baEnum.ObjectType.CHARACTERSTRING_VALUE, type: 9}],
                     [baEnum.PropertyIdentifier.DESCRIPTION]: [{value: '', type: 7}],
                     [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{value: {type: baEnum.ObjectType.CHARACTERSTRING_VALUE, instance: objectId}, type: 12}],
                     [baEnum.PropertyIdentifier.PRESENT_VALUE]: [{value: value, type: 7}],
                     [baEnum.PropertyIdentifier.PROPERTY_LIST]: 
                     [
                         {value: baEnum.PropertyIdentifier.OBJECT_NAME, type: 9 }, 
                         {value: baEnum.PropertyIdentifier.OBJECT_TYPE, type: 9 },
                         {value: baEnum.PropertyIdentifier.DESCRIPTION, type: 9 },
                         {value: baEnum.PropertyIdentifier.OBJECT_IDENTIFIER, type: 9 },
                         {value: baEnum.PropertyIdentifier.PROPERTY_LIST, type: 9 },
                         {value: baEnum.PropertyIdentifier.PRESENT_VALUE, type: 9 }
                     ],
                 });
     
                 that.objectList.push({value: {type: baEnum.ObjectType.CHARACTERSTRING_VALUE, instance: objectId}, type: 12})
                } else if(foundIndex !== -1) {
                    let foundObject = that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE][foundIndex];
                    foundObject[baEnum.PropertyIdentifier.PRESENT_VALUE][0].value = value;
                }
            }
        }
    }

    getObject(objectId, propId, instance) {
        let that = this;
        let objectGroup  = that.objectStore[objectId];

        if(Array.isArray(objectGroup)) {
            for(let i = 0; i < objectGroup.length; i++) {
                let object = objectGroup[i];
                if(object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == instance) {
                    let requestedProperty = object[propId];
                    if(requestedProperty !== null  && requestedProperty !== undefined && typeof requestedProperty !== "undefined") {
                        return requestedProperty;
                    }
                }
            }
        } else {
            return objectGroup[propId];
        }

        return null;
    }

    getObjectMultiple(objectId, propId, instance, properties) {
        let that = this;
        let objectGroup  = that.objectStore[objectId];

        try {
    
            if(Array.isArray(objectGroup)) {
                for(let i = 0; i < objectGroup.length; i++) {
                    let object = objectGroup[i];
                    if(object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == instance) {
                        if(propId == baEnum.PropertyIdentifier.ALL) {
                            let propList = [];
                            let keys = Object.keys(object);
                            keys.forEach(function(key) {
                                propList.push({property: {id: key, index: 0xFFFFFFFF}, value: object[key]});
                            });
    
                            return propList;

                        } else if(properties && properties.length > 1) {
                            let propList = [];
                            properties.forEach(function(p) {
                                if(object[p.id]){
                                    propList.push({property: {id: p.id, index: 0xFFFFFFFF}, value: object[p.id]});
                                }
                            });

                            return propList;
                        
                        } else {
                            return [{property: {id: propId, index: 0xFFFFFFFF}, value: object[propId]}];
                        }
                    }
                }
            } else {
                if(propId == baEnum.PropertyIdentifier.ALL) {
                    let propList = [];
                    let keys = Object.keys(objectGroup);
                    keys.forEach(function(key) {
                        propList.push({property: {id: key, index: 0xFFFFFFFF}, value: objectGroup[key]});
                    });
    
                    return propList;

                } else if(properties && properties.length > 1) {
                    let propList = [];
                    properties.forEach(function(p) {
                        if(objectGroup[p.id]){
                            propList.push({property: {id: p.id, index: 0xFFFFFFFF}, value: objectGroup[p.id]});
                        }
                    });

                    return propList;

                } else {
                    return [{property: {id: propId, index: 0xFFFFFFFF}, value: objectGroup[propId]}];
                }
            }

        } catch(e){
            //console.log("properties error: ", e);
        }
        
        return null;
    }

    clearServerPoints() {
        let that = this;

        that.objectStore[baEnum.ObjectType.ANALOG_VALUE] = [];
        that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE] = [];

        that.objectList = [
            {value: {type: baEnum.ObjectType.DEVICE, instance: that.deviceId}, type: 12}
        ];

        that.objectIdNumber = 1;
    }

    getRandomArbitrary(min, max) {
        return Math.random() * (max - min) + min;
    }

    getBacnetObjectType(value) {
        let type = typeof value;

        switch (type) {
            case "string":
                return "string"
            case "number":
                return "number"        
            default:
                return null
        }
    }

    getObjectIdentifier() {
        let that = this; 
        let objectId = that.objectIdNumber;
        that.objectIdNumber++;

        return objectId;
    }


}

module.exports = { BacnetServer };