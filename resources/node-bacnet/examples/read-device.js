'use strict';

/**
 * This script will discover all devices in the network and read out all
 * properties and deliver a JSON as device description
 *
 * If a deviceId is given as first parameter then only this device is discovered
 */

const Bacnet = require('../index');
const process = require('process');

// Map the Property types to their enums/bitstrings
const PropertyIdentifierToEnumMap = {};
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.OBJECT_TYPE] = Bacnet.enum.ObjectType;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.SEGMENTATION_SUPPORTED] = Bacnet.enum.Segmentation;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.EVENT_STATE] = Bacnet.enum.EventState;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.UNITS] = Bacnet.enum.EngineeringUnits;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.RELIABILITY] = Bacnet.enum.Reliability;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.NOTIFY_TYPE] = Bacnet.enum.NotifyType;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.POLARITY] = Bacnet.enum.Polarity;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED] = Bacnet.enum.ServicesSupported;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED] = Bacnet.enum.ObjectTypesSupported;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.STATUS_FLAGS] = Bacnet.enum.StatusFlags;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.LIMIT_ENABLE] = Bacnet.enum.LimitEnable;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.EVENT_ENABLE] = Bacnet.enum.EventTransitionBits;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.ACKED_TRANSITIONS] = Bacnet.enum.EventTransitionBits;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.SYSTEM_STATUS] = Bacnet.enum.DeviceStatus;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.SYSTEM_STATUS] = Bacnet.enum.DeviceStatus;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.ACK_REQUIRED] = Bacnet.enum.EventTransitionBits;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.LOGGING_TYPE] = Bacnet.enum.LoggingType;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.FILE_ACCESS_METHOD] = Bacnet.enum.FileAccessMethod;
PropertyIdentifierToEnumMap[Bacnet.enum.PropertyIdentifier.NODE_TYPE] = Bacnet.enum.NodeType;

// Sometimes the Map needs to be more specific
const ObjectTypeSpecificPropertyIdentifierToEnumMap = {};

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_INPUT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_INPUT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_INPUT][Bacnet.enum.PropertyIdentifier.MODE] = Bacnet.enum.BinaryPV;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.ANALOG_INPUT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.ANALOG_INPUT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV; //????

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.ANALOG_OUTPUT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.ANALOG_OUTPUT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV; //????

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_OUTPUT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_OUTPUT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_OUTPUT][Bacnet.enum.PropertyIdentifier.RELINQUISH_DEFAULT] = Bacnet.enum.BinaryPV;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_VALUE] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_VALUE][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_VALUE][Bacnet.enum.PropertyIdentifier.RELINQUISH_DEFAULT] = Bacnet.enum.BinaryPV;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_LIGHTING_OUTPUT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_LIGHTING_OUTPUT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryLightingPV;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BITSTRING_VALUE] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.BINARY_VALUE][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.BinaryPV; // ???

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.LifeSafetyState;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.TRACKING_VALUE] = Bacnet.enum.LifeSafetyState;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.MODE] = Bacnet.enum.LifeSafetyMode;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.ACCEPTED_MODES] = Bacnet.enum.LifeSafetyMode;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.SILENCED] = Bacnet.enum.LifeSafetyState;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_POINT][Bacnet.enum.PropertyIdentifier.OPERATION_EXPECTED] = Bacnet.enum.LifeSafetyOperation;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_ZONE] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_ZONE][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.LifeSafetyState;
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LIFE_SAFETY_ZONE][Bacnet.enum.PropertyIdentifier.MODE] = Bacnet.enum.LifeSafetyMode;

ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LOAD_CONTROL] = {};
ObjectTypeSpecificPropertyIdentifierToEnumMap[Bacnet.enum.ObjectType.LOAD_CONTROL][Bacnet.enum.PropertyIdentifier.PRESENT_VALUE] = Bacnet.enum.ShedState;


// For Objects we read out All properties if cli parameter --all is provided
const propSubSet = (process.argv.includes('--all')) ? Object.values(Bacnet.enum.PropertyIdentifier) : [
  /* normally supported from all devices */
  Bacnet.enum.PropertyIdentifier.OBJECT_IDENTIFIER,
  Bacnet.enum.PropertyIdentifier.OBJECT_NAME,
  Bacnet.enum.PropertyIdentifier.OBJECT_TYPE,
  Bacnet.enum.PropertyIdentifier.PRESENT_VALUE,
  Bacnet.enum.PropertyIdentifier.STATUS_FLAGS,
  Bacnet.enum.PropertyIdentifier.EVENT_STATE,
  Bacnet.enum.PropertyIdentifier.RELIABILITY,
  Bacnet.enum.PropertyIdentifier.OUT_OF_SERVICE,
  Bacnet.enum.PropertyIdentifier.UNITS,
  /* other properties */
  Bacnet.enum.PropertyIdentifier.DESCRIPTION,
  Bacnet.enum.PropertyIdentifier.SYSTEM_STATUS,
  Bacnet.enum.PropertyIdentifier.VENDOR_NAME,
  Bacnet.enum.PropertyIdentifier.VENDOR_IDENTIFIER,
  Bacnet.enum.PropertyIdentifier.MODEL_NAME,
  Bacnet.enum.PropertyIdentifier.FIRMWARE_REVISION,
  Bacnet.enum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION,
  Bacnet.enum.PropertyIdentifier.LOCATION,
  Bacnet.enum.PropertyIdentifier.LOCAL_DATE,
  Bacnet.enum.PropertyIdentifier.LOCAL_TIME,
  Bacnet.enum.PropertyIdentifier.UTC_OFFSET,
  Bacnet.enum.PropertyIdentifier.DAYLIGHT_SAVINGS_STATUS,
  Bacnet.enum.PropertyIdentifier.PROTOCOL_VERSION,
  Bacnet.enum.PropertyIdentifier.PROTOCOL_REVISION,
  Bacnet.enum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED,
  Bacnet.enum.PropertyIdentifier.PROTOCOL_OBJECT_TYPES_SUPPORTED,
  Bacnet.enum.PropertyIdentifier.OBJECT_LIST,
  Bacnet.enum.PropertyIdentifier.MAX_APDU_LENGTH_ACCEPTED,
  Bacnet.enum.PropertyIdentifier.SEGMENTATION_SUPPORTED,
  Bacnet.enum.PropertyIdentifier.APDU_TIMEOUT,
  Bacnet.enum.PropertyIdentifier.NUMBER_OF_APDU_RETRIES,
  Bacnet.enum.PropertyIdentifier.DEVICE_ADDRESS_BINDING,
  Bacnet.enum.PropertyIdentifier.DATABASE_REVISION,
  Bacnet.enum.PropertyIdentifier.MAX_INFO_FRAMES,
  Bacnet.enum.PropertyIdentifier.MAX_MASTER,
  Bacnet.enum.PropertyIdentifier.ACTIVE_COV_SUBSCRIPTIONS,
  Bacnet.enum.PropertyIdentifier.ACTIVE_COV_MULTIPLE_SUBSCRIPTIONS
];
const debug = process.argv.includes('--debug');

/**
 * Retrieve all properties manually because ReadPropertyMultiple is not available
 * @param address
 * @param objectId
 * @param callback
 * @param propList
 * @param result
 * @returns {*}
 */
function getAllPropertiesManually(address, objectId, callback, propList, result) {
  if (!propList) {
    propList = propSubSet.map((x) => x); // Clone the array
  }
  if (!result) {
    result = [];
  }
  if (!propList.length) {
    return callback({
      values: [
        {
          objectId: objectId,
          values: result
        }
      ]
    });
  }

  const prop = propList.shift();

  // Read only object-list property
  bacnetClient.readProperty(address, objectId, prop, (err, value) => {
    if (!err) {
      if (debug) {
        console.log('Handle value ' + prop + ': ', JSON.stringify(value));
      }
      const objRes = value.property;
      objRes.value = value.values;
      result.push(objRes);
    } else {
      // console.log('Device do not contain object ' + Bacnet.enum.getEnumName(Bacnet.enum.PropertyIdentifier, prop));
    }
    getAllPropertiesManually(address, objectId, callback, propList, result);
  });

}

/**
 * Reads ou one bit out of an buffer
 * @param buffer
 * @param i
 * @param bit
 * @returns {number}
 */
function readBit(buffer, i, bit) {
  return (buffer[i] >> bit) % 2;
}

/**
 * sets a bit in a buffer
 * @param buffer
 * @param i
 * @param bit
 * @param value
 */
function setBit(buffer, i, bit, value) {
  if (value === 0) {
    buffer[i] &= ~(1 << bit);
  } else {
    buffer[i] |= (1 << bit);
  }
}

/**
 * Parses a Bitstring and returns array with all true values
 * @param buffer
 * @param bitsUsed
 * @param usedEnum
 * @returns {[]}
 */
function handleBitString(buffer, bitsUsed, usedEnum) {
  const res = [];
  for (let i = 0; i < bitsUsed; i++) {
    const bufferIndex = Math.floor(i / 8);
    if (readBit(buffer, bufferIndex, i % 8)) {
      res.push(Bacnet.enum.getEnumName(usedEnum, i));
    }
  }
  return res;
}

/**
 * Parses a property value
 * @param address
 * @param objId
 * @param parentType
 * @param value
 * @param supportsMultiple
 * @param callback
 */
function parseValue(address, objId, parentType, value, supportsMultiple, callback) {
  let resValue = null;
  if (value && value.type && value.value !== null && value.value !== undefined) {
    switch (value.type) {
      case Bacnet.enum.ApplicationTag.NULL:
        // should be null already, but set again
        resValue = null;
        break;
      case Bacnet.enum.ApplicationTag.BOOLEAN:
        // convert number to a real boolean
        resValue = !!value.value;
        break;
      case Bacnet.enum.ApplicationTag.UNSIGNED_INTEGER:
      case Bacnet.enum.ApplicationTag.SIGNED_INTEGER:
      case Bacnet.enum.ApplicationTag.REAL:
      case Bacnet.enum.ApplicationTag.DOUBLE:
      case Bacnet.enum.ApplicationTag.CHARACTER_STRING:
        // datatype should be correct already
        resValue = value.value;
        break;
      case Bacnet.enum.ApplicationTag.DATE:
      case Bacnet.enum.ApplicationTag.TIME:
      case Bacnet.enum.ApplicationTag.TIMESTAMP:
        // datatype should be Date too
        // Javascript do not have date/timestamp only
        resValue = value.value;
        break;
      case Bacnet.enum.ApplicationTag.BIT_STRING:
        // handle bitstrings specific and more generic
        if (ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType] && ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType][objId]) {
          resValue = handleBitString(value.value.value, value.value.bitsUsed, ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType][objId]);
        } else if (PropertyIdentifierToEnumMap[objId]) {
          resValue = handleBitString(value.value.value, value.value.bitsUsed, PropertyIdentifierToEnumMap[objId]);
        } else {
          if (parentType !== Bacnet.enum.ObjectType.BITSTRING_VALUE) {
            console.log('Unknown value for BIT_STRING type for objId ' + Bacnet.enum.getEnumName(Bacnet.enum.PropertyIdentifier, objId) + ' and parent type ' + Bacnet.enum.getEnumName(Bacnet.enum.ObjectType, parentType));
          }
          resValue = value.value;
        }
        break;
      case Bacnet.enum.ApplicationTag.ENUMERATED:
        // handle enumerations specific and more generic
        if (ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType] && ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType][objId]) {
          resValue = Bacnet.enum.getEnumName(ObjectTypeSpecificPropertyIdentifierToEnumMap[parentType][objId], value.value);
        } else if (PropertyIdentifierToEnumMap[objId]) {
          resValue = Bacnet.enum.getEnumName(PropertyIdentifierToEnumMap[objId], value.value);
        } else {
          console.log('Unknown value for ENUMERATED type for objId ' + Bacnet.enum.getEnumName(Bacnet.enum.PropertyIdentifier, objId) + ' and parent type ' + Bacnet.enum.getEnumName(Bacnet.enum.ObjectType, parentType));
          resValue = value.value;
        }
        break;
      case Bacnet.enum.ApplicationTag.OBJECTIDENTIFIER:
        // Look up object identifiers
        // Some object identifiers should not be looked up because we end in loops else
        if (objId === Bacnet.enum.PropertyIdentifier.OBJECT_IDENTIFIER || objId === Bacnet.enum.PropertyIdentifier.STRUCTURED_OBJECT_LIST || objId === Bacnet.enum.PropertyIdentifier.SUBORDINATE_LIST) {
          resValue = value.value;
        } else if (supportsMultiple) {
          const requestArray = [{
            objectId: value.value,
            properties: [{id: 8}]
          }];
          bacnetClient.readPropertyMultiple(address, requestArray, (err, resValue) => {
            //console.log(JSON.stringify(value.value) + ': ' + JSON.stringify(resValue));
            parseDeviceObject(address, resValue, value.value, true, callback);
          });
          return;
        } else {
          getAllPropertiesManually(address, value.value, result => {
            parseDeviceObject(address, result, value.value, false, callback);
          });
          return;
        }
        break;
      case Bacnet.enum.ApplicationTag.OCTET_STRING:
        // It is kind of binary data??
        resValue = value.value;
        break;
      case Bacnet.enum.ApplicationTag.ERROR:
        // lookup error class and code
        resValue = {
          errorClass: Bacnet.enum.getEnumName(Bacnet.enum.ErrorClass, value.value.errorClass),
          errorCode: Bacnet.enum.getEnumName(Bacnet.enum.ErrorCode, value.value.errorCode)
        };
        break;
      case Bacnet.enum.ApplicationTag.OBJECT_PROPERTY_REFERENCE:
      case Bacnet.enum.ApplicationTag.DEVICE_OBJECT_PROPERTY_REFERENCE:
      case Bacnet.enum.ApplicationTag.DEVICE_OBJECT_REFERENCE:
      case Bacnet.enum.ApplicationTag.READ_ACCESS_SPECIFICATION: //???
        resValue = value.value;
        break;
      case Bacnet.enum.ApplicationTag.CONTEXT_SPECIFIC_DECODED:
        parseValue(address, objId, parentType, value.value, supportsMultiple, callback);
        return;
      case Bacnet.enum.ApplicationTag.READ_ACCESS_RESULT: // ????
        resValue = value.value;
        break;
      default:
        console.log('unknown type ' + value.type + ': ' + JSON.stringify(value));
        resValue = value;
    }
  }

  setImmediate(() => callback(resValue));
}

/**
 * Parse an object structure
 * @param address
 * @param obj
 * @param parent
 * @param supportsMultiple
 * @param callback
 */
function parseDeviceObject(address, obj, parent, supportsMultiple, callback) {
  if (debug) {
    console.log('START parseDeviceObject: ' + JSON.stringify(parent) + ' : ' + JSON.stringify(obj));
  }

  if(!obj) {
    console.log('object not valid on parse device object');
    return;
  }

  if (!obj.values || !Array.isArray(obj.values)) {
    console.log('No device or invalid response');
    callback({'ERROR': 'No device or invalid response'});
    return;
  }

  let cbCount = 0;
  let objDef = {};

  const finalize = () => {
    // Normalize and remove single item arrays
    Object.keys(objDef).forEach(devId => {
      Object.keys(objDef[devId]).forEach(objId => {
        if (objDef[devId][objId].length === 1) {
          objDef[devId][objId] = objDef[devId][objId][0];
        }
      });
    });
    // If (standard case) only one device was in do not create sub structures)
    if (obj.values.length === 1) {
      objDef = objDef[obj.values[0].objectId.instance];
    }
    if (debug) {
      console.log('END parseDeviceObject: ' + JSON.stringify(parent) + ' : ' + JSON.stringify(objDef));
    }
    callback(objDef);
  };

  obj.values.forEach(devBaseObj => {
    if (!devBaseObj.objectId) {
      console.log('No device Id found in object data');
      return;
    }
    if (devBaseObj.objectId.type === undefined || devBaseObj.objectId.instance === undefined) {
      console.log('No device type or instance found in object data');
      return;
    }
    if (!devBaseObj.values || !Array.isArray(devBaseObj.values)) {
      console.log('No device values response');
      return;
    }
    const deviceId = devBaseObj.objectId.instance;
    objDef[deviceId] = {};
    devBaseObj.values.forEach(devObj => {
      let objId = Bacnet.enum.getEnumName(Bacnet.enum.PropertyIdentifier, devObj.id);
      if (devObj.index !== 4294967295) {
        objId += '-' + devObj.index;
      }
      if (debug) {
        console.log('Handle Object property:', deviceId, objId, devObj.value);
      }
      devObj.value.forEach(val => {
        if (JSON.stringify(val.value) === JSON.stringify(parent)) {
          // ignore parent object
          objDef[deviceId][objId] = objDef[deviceId][objId] || [];
          objDef[deviceId][objId].push(val.value);
          return;
        }
        cbCount++;
        parseValue(address, devObj.id, parent.type, val, supportsMultiple, parsedValue => {
          if (debug) {
            console.log('RETURN parsedValue', deviceId, objId, devObj.value, parsedValue);
          }
          objDef[deviceId][objId] = objDef[deviceId][objId] || [];
          objDef[deviceId][objId].push(parsedValue);
          if (!--cbCount) {
            finalize();
          }
        });
      });
    });

  });
  if (cbCount === 0) {
    finalize();
  }
}

let objectsDone = 0;
/**
 * Print result info object
 * @param deviceId
 * @param obj
 */
function printResultObject(deviceId, obj) {
  objectsDone++;
  console.log(`Device ${deviceId} (${objectsDone}/${Object.keys(knownDevices).length}) read successfully ...`);
  console.log(JSON.stringify(obj));
  console.log();
  console.log();

  if (objectsDone === Object.keys(knownDevices).length) {
    setTimeout(() => {
      bacnetClient.close();
      console.log('closed transport ' + Date.now());
    }, 1000);
  }
}

let limitToDevice = null;
if (process.argv.length === 3) {
  limitToDevice = parseInt(process.argv[2]);
  if (isNaN(limitToDevice)) {
    limitToDevice = null;
  }
}
// create instance of Bacnet
const bacnetClient = new Bacnet({apduTimeout: 4000, interface: '0.0.0.0'});

// emitted for each new message
bacnetClient.on('message', (msg, rinfo) => {
  console.log(msg);
  if (rinfo) console.log(rinfo);
});

// emitted on errors
bacnetClient.on('error', (err) => {
  console.error(err);
  bacnetClient.close();
});

// emmitted when Bacnet server listens for incoming UDP packages
bacnetClient.on('listening', () => {
  console.log('sent whoIs ' + Date.now());
  // discover devices once we are listening
  bacnetClient.whoIs();
});

const knownDevices = [];

// emitted when a new device is discovered in the network
bacnetClient.on('iAm', (device) => {
  // address object of discovered device,
  // just use in subsequent calls that are directed to this device
  const address = device.header.sender;

  //discovered device ID
  const deviceId = device.payload.deviceId;
  if (knownDevices.includes(deviceId)) return;
  if (limitToDevice !== null && limitToDevice !== deviceId) return;

  console.log('Found Device ' + deviceId + ' on ' + JSON.stringify(address));
  knownDevices.push(deviceId);

  const propertyList = [];
  propSubSet.forEach(item => {
    propertyList.push({id: item});
  });

  const requestArray = [{
    objectId: {type: 8, instance: deviceId},
    properties: propertyList
    }
  ];

  bacnetClient.readPropertyMultiple(address, requestArray, (err, value) => {
    if (err) {
      console.log(deviceId, 'No ReadPropertyMultiple supported:', err.message);
      getAllPropertiesManually(address, {type: 8, instance: deviceId}, result => {
        parseDeviceObject(address, result, {type: 8, instance: deviceId}, false, res => printResultObject(deviceId, res));
      });
    } else {
      console.log(deviceId, 'ReadPropertyMultiple supported ...');
      parseDeviceObject(address, value, {type: 8, instance: deviceId}, true, res => printResultObject(deviceId, res));
    }
  });

});
