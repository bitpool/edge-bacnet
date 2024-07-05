const bacnet = require('./resources/node-bacstack-ts/dist/index.js');
const pjson = require('./package.json');
const baEnum = bacnet.enum;
const { Store_Config_Server, Read_Config_Sync_Server } = require('./common');
const { EventEmitter } = require("events");

/**
 * Class representing a BACnet Server.
 * 
 * This class initializes a BACnet server with specified client, device ID, and Node-Red version.
 * It provides methods to set device name, add objects, retrieve objects, clear server points, clear server point, and get server points.
 * 
 * Simulates a BACnet IP device on a regular IP network
 * 
 * @constructor
 * @param {Object} client - The BACnet client object.
 * @param {number} deviceId - The ID of the device.
 * @param {string} nodeRedVersion - The version of Node-Red.
 */
class BacnetServer extends EventEmitter {

    constructor(client, deviceId, nodeRedVersion) {
        super();
        let that = this;
        that.bacnetClient = client;

        // object identifier init
        that.objectIdNumber = {};
        that.objectIdNumber[baEnum.ObjectType.ANALOG_VALUE] = 0;
        that.objectIdNumber[baEnum.ObjectType.CHARACTERSTRING_VALUE] = 0;
        that.objectIdNumber[baEnum.ObjectType.BINARY_VALUE] = 0;
        that.nodeRedVersion = nodeRedVersion;
        that.deviceId = deviceId;
        that.vendorId = 1401;
        that.objectList = [
            { value: { type: baEnum.ObjectType.DEVICE, instance: that.deviceId }, type: 12 }
        ];

        that.objectStore = {
            [baEnum.ObjectType.DEVICE]: {
                [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{ value: { type: baEnum.ObjectType.DEVICE, instance: that.deviceId }, type: 12 }],
                [baEnum.PropertyIdentifier.OBJECT_LIST]: that.objectList,
                [baEnum.PropertyIdentifier.OBJECT_NAME]: [{ value: 'Bitpool Edge BACnet Gateway', type: 7 }],
                [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{ value: 8, type: 9 }],
                [baEnum.PropertyIdentifier.DESCRIPTION]: [{ value: 'Bitpool Edge BACnet gateway', type: 7 }],
                [baEnum.PropertyIdentifier.SYSTEM_STATUS]: [{ value: 0, type: 9 }],
                [baEnum.PropertyIdentifier.VENDOR_NAME]: [{ value: "Bitpool", type: 7 }],
                [baEnum.PropertyIdentifier.VENDOR_IDENTIFIER]: [{ value: that.vendorId, type: 2 }],
                [baEnum.PropertyIdentifier.MODEL_NAME]: [{ value: "bitpool-edge", type: 7 }],
                [baEnum.PropertyIdentifier.FIRMWARE_REVISION]: [{ value: "Node-Red " + that.nodeRedVersion, type: 7 }],
                [baEnum.PropertyIdentifier.PROTOCOL_REVISION]: [{ value: 19, type: 2 }],
                [baEnum.PropertyIdentifier.PROTOCOL_VERSION]: [{ value: 0, type: 2 }],
                [baEnum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION]: [{ value: pjson.version, type: 7 }],
                [baEnum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED]: [{ value: { value: [0, 10, 0, 32, 32], bitsUsed: 40 }, type: 8 }],
                [baEnum.PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED]: [{ value: 1476, type: 2 }],
                [baEnum.PropertyIdentifier.SEGMENTATION_SUPPORTED]: [{ value: 0, type: 9 }],
                [baEnum.PropertyIdentifier.APDU_TIMEOUT]: [{ value: that.bacnetClient.config.apduTimeout, type: 2 }],
                [baEnum.PropertyIdentifier.NUMBER_OF_APDU_RETRIES]: [{ value: 3, type: 2 }],
                [baEnum.PropertyIdentifier.DEVICE_ADDRESS_BINDING]: [{ value: 0, type: 12 }],
                [baEnum.PropertyIdentifier.DATABASE_REVISION]: [{ value: 19, type: 2 }],
                [baEnum.PropertyIdentifier.PROPERTY_LIST]: [
                    { value: baEnum.PropertyIdentifier.OBJECT_IDENTIFIER, type: 9 },
                    { value: baEnum.PropertyIdentifier.OBJECT_LIST, type: 9 },
                    { value: baEnum.PropertyIdentifier.OBJECT_NAME, type: 9 },
                    { value: baEnum.PropertyIdentifier.OBJECT_TYPE, type: 9 },
                    { value: baEnum.PropertyIdentifier.DESCRIPTION, type: 9 },
                    { value: baEnum.PropertyIdentifier.SYSTEM_STATUS, type: 9 },
                    { value: baEnum.PropertyIdentifier.VENDOR_NAME, type: 9 },
                    { value: baEnum.PropertyIdentifier.VENDOR_IDENTIFIER, type: 9 },
                    { value: baEnum.PropertyIdentifier.MODEL_NAME, type: 9 },
                    { value: baEnum.PropertyIdentifier.FIRMWARE_REVISION, type: 9 },
                    { value: baEnum.PropertyIdentifier.PROTOCOL_REVISION, type: 9 },
                    { value: baEnum.PropertyIdentifier.PROTOCOL_VERSION, type: 9 },
                    { value: baEnum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION, type: 9 },
                    { value: baEnum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED, type: 9 },
                    { value: baEnum.PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED, type: 9 },
                    { value: baEnum.PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED, type: 9 },
                    { value: baEnum.PropertyIdentifier.SEGMENTATION_SUPPORTED, type: 9 },
                    { value: baEnum.PropertyIdentifier.APDU_TIMEOUT, type: 9 },
                    { value: baEnum.PropertyIdentifier.NUMBER_OF_APDU_RETRIES, type: 9 },
                    { value: baEnum.PropertyIdentifier.DEVICE_ADDRESS_BINDING, type: 9 },
                    { value: baEnum.PropertyIdentifier.DATABASE_REVISION, type: 9 },
                ],
            },
            [baEnum.ObjectType.ANALOG_VALUE]: [],
            [baEnum.ObjectType.CHARACTERSTRING_VALUE]: [],
            [baEnum.ObjectType.BINARY_VALUE]: []
        };

        try {
            let cachedData = JSON.parse(Read_Config_Sync_Server());
            if (typeof cachedData == "object") {
                if (cachedData.objectList) {
                    that.objectList = cachedData.objectList;
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                }
                if (cachedData.objectStore) {
                    that.objectStore[baEnum.ObjectType.ANALOG_VALUE] = cachedData.objectStore[baEnum.ObjectType.ANALOG_VALUE];
                    that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE] = cachedData.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE];
                    that.objectStore[baEnum.ObjectType.BINARY_VALUE] = cachedData.objectStore[baEnum.ObjectType.BINARY_VALUE];
                }
            }
        } catch (error) {
            //do nothing
        }

        that.bacnetClient.client.on('whoIs', (device) => {
            that.bacnetClient.client.iAmResponse(that.deviceId, baEnum.Segmentation.SEGMENTED_BOTH, that.vendorId);
            that.lastWhoIsRecived = Date.now();
        });

        that.bacnetClient.client.on('readPropertyMultiple', (data) => {
            let senderAddress = data.address;
            let requestProps = data.request.properties;
            let responseObject = [];

            try {
                if (requestProps) {
                    for (let i = 0; i < requestProps.length; i++) {
                        let prop = requestProps[i].properties[0].id;
                        let type = requestProps[i].objectId.type;
                        let instance = requestProps[i].objectId.instance;
                        let foundObject = that.getObjectMultiple(type, prop, instance, requestProps[i].properties);
                        if (foundObject !== null && foundObject !== undefined && foundObject !== "undefined") {
                            responseObject.push({ objectId: { type: type, instance: instance }, values: foundObject });
                        }
                        if (i == requestProps.length - 1) {
                            if (responseObject.length > 0) {
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
            } catch (e) {
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
                let objectId = data.request.objectId.type;
                let objectInstance = data.request.objectId.instance;
                let propId = data.request.property.id.toString();
                let responseObj = that.getObject(objectId, propId, objectInstance);
                if (propId == baEnum.PropertyIdentifier.OBJECT_LIST) {
                    if (data.request.property.index !== 0xFFFFFFFF) {
                        responseObj = responseObj[data.request.property.index];
                    }
                }
                if (responseObj !== null && responseObj !== undefined && typeof responseObj !== "undefined") {
                    that.bacnetClient.client.readPropertyResponse(data.address, data.invokeId, data.request.objectId, data.request.property, responseObj);
                } else {
                    that.bacnetClient.client.errorResponse(
                        data.address,
                        baEnum.ConfirmedServiceChoice.READ_PROPERTY,
                        data.invokeId,
                        baEnum.ErrorClass.PROPERTY,
                        baEnum.ErrorCode.UNKNOWN_PROPERTY
                    );
                }
            } catch (e) {
                console.log("Local BACnet device readProperty error: ", e);
            }
        });

        that.bacnetClient.client.on('writeProperty', (data) => {
            let objectId = data.request.objectId.type;
            let objectInstance = data.request.objectId.instance;
            let propId = data.request.value.property.id.toString();
            let newValue = data.request.value.value[0].value;

            if (!that.modifyObject(objectId, propId, objectInstance, newValue)) {
                that.bacnetClient.errorResponse(data.address, data.service, data.invokeId, bacnet.enum.ErrorClass.OBJECT, bacnet.enum.ErrorCode.UNKNOWN_OBJECT);
            }
            that.getServerPoints(objectId, objectInstance).then(function (result) {
                that.bacnetClient.client.simpleAckResponse(data.address, data.service, data.invokeId);
                that.emit("writeProperty", result[0].name, newValue);
            }).catch(function (error) {
                that.bacnetClient.errorResponse(data.address, data.service, data.invokeId, bacnet.enum.ErrorClass.OBJECT, bacnet.enum.ErrorCode.UNKNOWN_OBJECT);
                that.logOut("Error getting server points:  ", error);
            });
        });

        that.bacnetClient.client.on('createObject', (data) => {
            var defaultValue;
            switch (data.request.values[0].value[0].type) {
                case baEnum.ObjectType.CHARACTERSTRING_VALUE:
                    defaultValue = "";
                    break;
                case baEnum.ObjectType.BINARY_VALUE:
                    defaultValue = 0;
                    break;
                case baEnum.ObjectType.ANALOG_VALUE:
                    defaultValue = false;
                    break;
                default:
                    defaultValue = 0;
                    break;
            }
            that.addObject(data.request.values[0].value[0].value, defaultValue);
            that.bacnetClient.client.simpleAckResponse(data.address, data.service, data.invokeId);
        });

        that.bacnetClient.client.on('deleteObject', (data) => {
            var type;
            switch (data.request.objectType) {
                case baEnum.ObjectType.CHARACTERSTRING_VALUE:
                    type = 'SV';
                    break;
                case baEnum.ObjectType.BINARY_VALUE:
                    type = 'BV';
                    break;
                case baEnum.ObjectType.ANALOG_VALUE:
                    type = 'AV';
                    break;
                default:
                    type = 'AV';
                    break;
            }

            var req = { body: { type: type, instance: data.request.instance } };
            that.clearServerPoint(req).then(function (result) {
                that.bacnetClient.client.simpleAckResponse(data.address, data.service, data.invokeId);
            }).catch(function (error) {
                console.log(error)
            });
        });

        //do initial iAm broadcast when BACnet server starts
        that.bacnetClient.client.iAmResponse(that.deviceId, baEnum.Segmentation.SEGMENTED_BOTH, that.vendorId);
    }

    /**
     * Set the name of the device.
     * 
     * @param {string} nodeName - The new name for the device.
     */
    setDeviceName(nodeName) {
        let that = this;
        if (typeof nodeName == "string" && nodeName !== "") {
            that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_NAME][0].value = nodeName;
        }
    }

    /**
     * Adds a new object to the BacnetServer's object store based on the provided name and value.
     * 
     * @param {string} name - The name of the object to be added.
     * @param {number|boolean|string} value - The value of the object to be added.
     * @returns {void}
     */
    addObject(name, value) {
        let that = this;
        let objectType = that.getBacnetObjectType(value);
        if (name && objectType) {
            let instanceNumber;
            if (name.includes('|')) {
                // split name, assign last part to instanceNumber and the rest to name
                let nameParts = name.split('|');
                instanceNumber = nameParts[nameParts.length - 1];
                nameParts.pop();
                name = nameParts.join('|');
            }
            let formattedName = name.replaceAll('.', '_');
            formattedName = formattedName.replaceAll('/', '_');
            if (objectType == "number") {
                let foundIndex = that.objectStore[baEnum.ObjectType.ANALOG_VALUE].findIndex(ele => ele[baEnum.PropertyIdentifier.OBJECT_NAME][0].value == formattedName);
                if (foundIndex == -1) {
                    let objectId = that.getObjectIdentifier(baEnum.ObjectType.ANALOG_VALUE, instanceNumber);
                    that.objectStore[baEnum.ObjectType.ANALOG_VALUE].push({
                        [baEnum.PropertyIdentifier.OBJECT_NAME]: [{ value: formattedName, type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{ value: baEnum.ObjectType.ANALOG_VALUE, type: 9 }],
                        [baEnum.PropertyIdentifier.DESCRIPTION]: [{ value: '', type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{ value: { type: baEnum.ObjectType.ANALOG_VALUE, instance: objectId }, type: 12 }],
                        [baEnum.PropertyIdentifier.PRESENT_VALUE]: [{ value: value, type: 4 }],
                        [baEnum.PropertyIdentifier.STATUS_FLAGS]: [{ value: 0, type: 8 }],
                        [baEnum.PropertyIdentifier.EVENT_STATE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.UNITS]: [{ value: 95, type: 9 }],
                        [baEnum.PropertyIdentifier.PRIORITY_ARRAY]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.MAX_PRES_VALUE]: [{ value: value, type: 4 }],
                        [baEnum.PropertyIdentifier.MIN_PRES_VALUE]: [{ value: value, type: 4 }],
                        [baEnum.PropertyIdentifier.RESOLUTION]: [{ value: 0, type: 4 }],
                        [baEnum.PropertyIdentifier.PROPERTY_LIST]:
                            [
                                { value: baEnum.PropertyIdentifier.OBJECT_NAME, type: 9 },
                                { value: baEnum.PropertyIdentifier.OBJECT_TYPE, type: 9 },
                                { value: baEnum.PropertyIdentifier.DESCRIPTION, type: 9 },
                                { value: baEnum.PropertyIdentifier.OBJECT_IDENTIFIER, type: 9 },
                                { value: baEnum.PropertyIdentifier.PRESENT_VALUE, type: 9 },
                                { value: baEnum.PropertyIdentifier.STATUS_FLAGS, type: 9 },
                                { value: baEnum.PropertyIdentifier.EVENT_STATE, type: 9 },
                                { value: baEnum.PropertyIdentifier.OUT_OF_SERVICE, type: 9 },
                                { value: baEnum.PropertyIdentifier.UNITS, type: 9 },
                                { value: baEnum.PropertyIdentifier.PRIORITY_ARRAY, type: 9 },
                                { value: baEnum.PropertyIdentifier.MAX_PRES_VALUE, type: 9 },
                                { value: baEnum.PropertyIdentifier.MIN_PRES_VALUE, type: 9 },
                                { value: baEnum.PropertyIdentifier.RESOLUTION, type: 9 },
                            ],
                    });

                    that.objectList.push({ value: { type: baEnum.ObjectType.ANALOG_VALUE, instance: objectId }, type: 12 })
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                } else if (foundIndex !== -1) {
                    let foundObject = that.objectStore[baEnum.ObjectType.ANALOG_VALUE][foundIndex];
                    foundObject[baEnum.PropertyIdentifier.PRESENT_VALUE][0].value = value;
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                }
            } else if (objectType == "boolean") {
                let foundIndex = that.objectStore[baEnum.ObjectType.BINARY_VALUE].findIndex(ele => ele[baEnum.PropertyIdentifier.OBJECT_NAME][0].value == formattedName);
                if (foundIndex == -1) {
                    let objectId = that.getObjectIdentifier(baEnum.ObjectType.BINARY_VALUE);
                    that.objectStore[baEnum.ObjectType.BINARY_VALUE].push({
                        [baEnum.PropertyIdentifier.OBJECT_NAME]: [{ value: formattedName, type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{ value: baEnum.ObjectType.BINARY_VALUE, type: 9 }],
                        [baEnum.PropertyIdentifier.DESCRIPTION]: [{ value: '', type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{ value: { type: baEnum.ObjectType.BINARY_VALUE, instance: objectId }, type: 12 }],
                        [baEnum.PropertyIdentifier.PRESENT_VALUE]: [{ value: value, type: 1 }],
                        [baEnum.PropertyIdentifier.STATUS_FLAGS]: [{ value: 0, type: 8 }],
                        [baEnum.PropertyIdentifier.EVENT_STATE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.ACTIVE_TEXT]: [{ value: 'ACTIVE', type: 7 }],
                        [baEnum.PropertyIdentifier.INACTIVE_TEXT]: [{ value: 'INACTIVE', type: 7 }],
                    });

                    that.objectList.push({ value: { type: baEnum.ObjectType.BINARY_VALUE, instance: objectId }, type: 12 })
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                } else if (foundIndex !== -1) {
                    let foundObject = that.objectStore[baEnum.ObjectType.BINARY_VALUE][foundIndex];
                    foundObject[baEnum.PropertyIdentifier.PRESENT_VALUE][0].value = value;
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                }
            } else if (objectType == "string") {
                let foundIndex = that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].findIndex(ele => ele[baEnum.PropertyIdentifier.OBJECT_NAME][0].value == formattedName);
                if (foundIndex == -1) {
                    let objectId = that.getObjectIdentifier(baEnum.ObjectType.CHARACTERSTRING_VALUE);
                    that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].push({
                        [baEnum.PropertyIdentifier.OBJECT_NAME]: [{ value: formattedName, type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_TYPE]: [{ value: baEnum.ObjectType.CHARACTERSTRING_VALUE, type: 9 }],
                        [baEnum.PropertyIdentifier.DESCRIPTION]: [{ value: '', type: 7 }],
                        [baEnum.PropertyIdentifier.OBJECT_IDENTIFIER]: [{ value: { type: baEnum.ObjectType.CHARACTERSTRING_VALUE, instance: objectId }, type: 12 }],
                        [baEnum.PropertyIdentifier.PRESENT_VALUE]: [{ value: value, type: 7 }],
                        [baEnum.PropertyIdentifier.STATUS_FLAGS]: [{ value: 0, type: 8 }],
                        [baEnum.PropertyIdentifier.EVENT_STATE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.OUT_OF_SERVICE]: [{ value: 0, type: 9 }],
                        [baEnum.PropertyIdentifier.UNITS]: [{ value: 95, type: 9 }]
                    });

                    that.objectList.push({ value: { type: baEnum.ObjectType.CHARACTERSTRING_VALUE, instance: objectId }, type: 12 })
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                } else if (foundIndex !== -1) {
                    let foundObject = that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE][foundIndex];
                    foundObject[baEnum.PropertyIdentifier.PRESENT_VALUE][0].value = value;
                    that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
                }
            }
        }
        Store_Config_Server(JSON.stringify({ objectList: that.objectList, objectStore: that.objectStore }));
    }

    /**
     * Retrieves a specific property of an object based on the object ID, property ID, and instance number.
     * 
     * @param {number} objectId - The ID of the object type.
     * @param {number} propId - The ID of the property to retrieve.
     * @param {number} instance - The instance number of the object.
     * @returns {any} The requested property value if found, otherwise null.
     */
    getObject(objectId, propId, instance) {
        let that = this;
        let objectGroup = that.objectStore[objectId];

        if (Array.isArray(objectGroup)) {
            for (let i = 0; i < objectGroup.length; i++) {
                let object = objectGroup[i];
                if (object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == instance) {
                    let requestedProperty = object[propId];
                    if (requestedProperty !== null && requestedProperty !== undefined && typeof requestedProperty !== "undefined") {
                        return requestedProperty;
                    }
                }
            }
        } else {
            return objectGroup[propId];
        }

        return null;
    }

    /**
     * Retrieves a specific property of an object based on the object ID, property ID, and instance number and modify his value.
     * 
     * @param {number} objectId - The ID of the object type.
     * @param {number} propId - The ID of the property to retrieve.
     * @param {number} instance - The instance number of the object.
     * @param {number} newValue - The the new value for update.
     * @returns {any} The requested property value if found, otherwise null.
     */
    modifyObject(objectId, propId, instance, newValue) { //TODO factorise with getObject
        let that = this;
        let objectGroup = that.objectStore[objectId];

        if (Array.isArray(objectGroup)) {
            for (let i = 0; i < objectGroup.length; i++) {
                let object = objectGroup[i];
                if (object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == instance) {
                    let requestedProperty = object[propId];
                    if (requestedProperty !== null && requestedProperty !== undefined && typeof requestedProperty !== "undefined") {
                        that.objectStore[objectId][i][propId][0].value = newValue;
                        return requestedProperty;
                    }
                }
            }
        } else {
            return objectGroup[propId];
        }

        return null;
    }

    /**
     * Retrieves the properties of a specific object instance from the objectStore based on the provided parameters.
     * 
     * @param {number} objectId - The type of the object to retrieve.
     * @param {number} propId - The property identifier to retrieve.
     * @param {number} instance - The instance number of the object to retrieve.
     * @param {Array} properties - An array of additional properties to retrieve along with the main property.
     * @returns {Array|null} - An array of properties with values for the specified object instance, or null if not found.
     */
    getObjectMultiple(objectId, propId, instance, properties) {
        let that = this;
        let objectGroup = that.objectStore[objectId];

        try {
            if (Array.isArray(objectGroup)) {
                for (let i = 0; i < objectGroup.length; i++) {
                    let object = objectGroup[i];
                    if (object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == instance) {
                        if (propId == baEnum.PropertyIdentifier.ALL) {
                            let propList = [];
                            let keys = Object.keys(object);
                            keys.forEach(function (key) {
                                propList.push({ property: { id: key, index: 0xFFFFFFFF }, value: object[key] });
                            });

                            return propList;

                        } else if (properties && properties.length > 1) {
                            let propList = [];
                            properties.forEach(function (p) {
                                if (object[p.id]) {
                                    propList.push({ property: { id: p.id, index: 0xFFFFFFFF }, value: object[p.id] });
                                }
                            });

                            return propList;

                        } else {
                            return [{ property: { id: propId, index: 0xFFFFFFFF }, value: object[propId] }];
                        }
                    }
                }
            } else {
                if (propId == baEnum.PropertyIdentifier.ALL) {
                    let propList = [];
                    let keys = Object.keys(objectGroup);
                    keys.forEach(function (key) {
                        propList.push({ property: { id: key, index: 0xFFFFFFFF }, value: objectGroup[key] });
                    });

                    return propList;

                } else if (properties && properties.length > 1) {
                    let propList = [];
                    properties.forEach(function (p) {
                        if (objectGroup[p.id]) {
                            propList.push({ property: { id: p.id, index: 0xFFFFFFFF }, value: objectGroup[p.id] });
                        }
                    });

                    return propList;

                } else {
                    return [{ property: { id: propId, index: 0xFFFFFFFF }, value: objectGroup[propId] }];
                }
            }

        } catch (e) {
            //do nothing
        }

        return null;
    }

    /**
     * Clear all server points by resetting the object lists and object store.
     * This method resets the object list for the device, clears the character string values,
     * and clears the analog values. It also resets the object id numbers for analog, character string, and binary values.
     * Finally, it stores the updated object list and object store in the server configuration.
     */
    clearServerPoints() {
        let that = this;

        that.objectList = [
            { value: { type: baEnum.ObjectType.DEVICE, instance: that.deviceId }, type: 12 }
        ];
        that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;
        that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE] = [];
        that.objectStore[baEnum.ObjectType.ANALOG_VALUE] = [];

        that.objectIdNumber = {};
        that.objectIdNumber[baEnum.ObjectType.ANALOG_VALUE] = 0;
        that.objectIdNumber[baEnum.ObjectType.CHARACTERSTRING_VALUE] = 0;
        that.objectIdNumber[baEnum.ObjectType.BINARY_VALUE] = 0;

        Store_Config_Server(JSON.stringify({ objectList: that.objectList, objectStore: that.objectStore }));
    }

    /**
     * Removes a server point from the objectStore and objectList based on the provided JSON data.
     * 
     * @param {Object} json - The JSON data containing information about the server point to be removed.
     * @param {string} json.body.type - The type of the server point ('SV' for CharacterString, 'BV' for BinaryValue, default is AnalogValue).
     * @param {number} json.body.instance - The instance number of the server point to be removed.
     * @returns {Promise<boolean>} A Promise that resolves to true if the server point is successfully removed, otherwise rejects with an error.
     */
    clearServerPoint(json) {
        let that = this;
        return new Promise(async function (resolve, reject) {
            try {
                let type;
                switch (json.body.type) {
                    case 'SV':
                        type = baEnum.ObjectType.CHARACTERSTRING_VALUE;
                        break;
                    case 'BV':
                        type = baEnum.ObjectType.BINARY_VALUE;
                        break;
                    default:
                        type = baEnum.ObjectType.ANALOG_VALUE;
                        break;
                }

                // remove object from objectStore
                let objectGroup = that.objectStore[type];
                if (Array.isArray(objectGroup)) {
                    for (let i = 0; i < objectGroup.length; i++) {
                        let object = objectGroup[i];
                        if (object[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance == json.body.instance) {
                            that.objectStore[type].splice(i, 1);
                            break;
                        }
                    }
                } else {
                    delete that.objectStore[type];
                }

                // remove object from objectList
                let objectIndex = that.objectList.findIndex(ele =>
                    ele.value.instance == json.body.instance && ele.value.type == type);
                if (objectIndex !== -1) {
                    that.objectList.splice(objectIndex, 1);
                }

                // update objectList in device object
                that.objectStore[baEnum.ObjectType.DEVICE][baEnum.PropertyIdentifier.OBJECT_LIST] = that.objectList;

                Store_Config_Server(JSON.stringify({ objectList: that.objectList, objectStore: that.objectStore }));

                resolve(true);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Retrieves all server points from the BacnetServer objectStore.
     * Points include Analog Value, Character String Value, and Binary Value objects.
     * Each point is represented as an object with properties:
     * - name: The name of the object.
     * - type: The type of the object (AV for Analog Value, SV for Character String Value, BV for Binary Value).
     * - instance: The instance number of the object.
     * 
     * @returns {Promise<Array>} A promise that resolves with an array of points sorted by instance number.
     * @throws {Error} If an error occurs during the retrieval process.
     */
    getServerPoints(typeFilter = null, instanceFilter = null) {
        let that = this;
        let points = [];

        return new Promise(async function (resolve, reject) {
            try {
                // iterate analog value objects
                if (that.objectStore[baEnum.ObjectType.ANALOG_VALUE] && that.objectStore[baEnum.ObjectType.ANALOG_VALUE].length > 0) {
                    that.objectStore[baEnum.ObjectType.ANALOG_VALUE].forEach((point) => {
                        let instance = point[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance;
                        let objectName = point[baEnum.PropertyIdentifier.OBJECT_NAME][0].value;

                        if (typeFilter === null && instanceFilter === null) {
                            points.push({
                                name: objectName,
                                type: "AV",
                                instance
                            });
                        } else {
                            if ((typeFilter === baEnum.ObjectType.ANALOG_VALUE) && (instanceFilter === instance)) {
                                points.push({
                                    name: objectName,
                                    type: "AV",
                                    instance
                                });
                            }
                        }
                    });
                }

                // iterate character string value objects
                if (that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE] && that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].length > 0) {
                    that.objectStore[baEnum.ObjectType.CHARACTERSTRING_VALUE].forEach((point) => {
                        let instance = point[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance;
                        let objectName = point[baEnum.PropertyIdentifier.OBJECT_NAME][0].value;

                        if (typeFilter === null && instanceFilter === null) {
                            points.push({
                                name: objectName,
                                type: "SV",
                                instance
                            });
                        } else {
                            if ((typeFilter === baEnum.ObjectType.CHARACTERSTRING_VALUE) && (instanceFilter === instance)) {
                                points.push({
                                    name: objectName,
                                    type: "SV",
                                    instance
                                });
                            }
                        }
                    });
                }

                // iterate binary value objects
                if (that.objectStore[baEnum.ObjectType.BINARY_VALUE] && that.objectStore[baEnum.ObjectType.BINARY_VALUE].length > 0) {
                    that.objectStore[baEnum.ObjectType.BINARY_VALUE].forEach((point) => {
                        let instance = point[baEnum.PropertyIdentifier.OBJECT_IDENTIFIER][0].value.instance;
                        let objectName = point[baEnum.PropertyIdentifier.OBJECT_NAME][0].value;

                        if (typeFilter === null && instanceFilter === null) {
                            points.push({
                                name: objectName,
                                type: "BV",
                                instance
                            });
                        } else {
                            if ((typeFilter === baEnum.ObjectType.BINARY_VALUE) && (instanceFilter === instance)) {
                                points.push({
                                    name: objectName,
                                    type: "BV",
                                    instance
                                });
                            }
                        }
                    });
                }

                resolve(points.sort((a, b) => (a.instance > b.instance) ? 1 : -1));
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Determines the BACnet object type based on the provided value.
     * 
     * @param {any} value - The value to determine the BACnet object type for.
     * @returns {string|null} The BACnet object type as a string ('string', 'number', 'boolean') or null if the type is not recognized.
     */
    getBacnetObjectType(value) {
        let type = typeof value;

        switch (type) {
            case "string":
                return "string"
            case "number":
                return "number"
            case "boolean":
                return "boolean"
            default:
                return null
        }
    }

    /**
     * Returns the object identifier for the given type and instance number.
     * 
     * @param {string} type - The type of the object.
     * @param {number} instanceNumber - The instance number of the object.
     * @returns {number} The object identifier.
     */
    getObjectIdentifier(type, instanceNumber) {
        let that = this;
        // manual instance numbering
        if (instanceNumber) {
            that.objectIdNumber[type] = instanceNumber + 1;
            return instanceNumber;
        }
        // auto instance numbering
        let objectId = that.objectIdNumber[type];
        that.objectIdNumber[type]++;
        return objectId;
    }
}

module.exports = { BacnetServer };