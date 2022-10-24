/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

const { createLogger, format, transports } = require('winston');
const { randomUUID } = require('crypto');
const os = require('os');

const baEnum = require('./resources/bacstack/lib/enum');

const logger = createLogger({
    format: format.combine(
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.json()
    ),
    transports: [new transports.Console()],
});

class DeviceObjectId {
    constructor(type, instance) {
        this.type = type;
        this.instance = instance;
    }
}

class DeviceObject {
    constructor(objectId, name, description, type, units, presentValue) {
        this.objectId = objectId;
        this.name = name;
        this.description = description;
        this.type = type;
        this.units = units;
        this.presentValue = presentValue;
    }
}

class BacnetConfig {
    constructor(device, objects, bacnet_polling_schedule, apduTimeout, localIpAdrress, roundDecimal, local_device_port, apduSize, maxSegments, broadCastAddr) {
      this.device = {
        "deviceId": device.deviceId,
        "address": device.address
      };
      this.polling = {
        "schedule": bacnet_polling_schedule
      };
      this.objects = [{
        "objectId": {
          "type": objects.object_type,
          "instance": objects.instance,
          "properties": objects.object_props
        }
      }];
      this.apduTimeout = apduTimeout;
      this.localIpAdrress = localIpAdrress;
      this.roundDecimal = roundDecimal;
      this.port = local_device_port;
      this.apduSize = apduSize;
      this.maxSegments = maxSegments;
      this.broadCastAddr = broadCastAddr;
  }
};

class BacnetClientConfig {
  constructor(apduTimeout, localIpAdrress, local_device_port, apduSize, maxSegments, broadCastAddr, discover_polling_schedule) {
    this.apduTimeout = apduTimeout;
    this.localIpAdrress = localIpAdrress;
    this.port = local_device_port;
    this.apduSize = apduSize;
    this.maxSegments = maxSegments;
    this.broadCastAddr = broadCastAddr;
    this.discover_polling_schedule = discover_polling_schedule;
  }
};

class ReadCommandConfig {
  constructor(pointsToRead, objectProperties, decimalPrecision) {
    this.pointsToRead = pointsToRead;
    this.objectProperties = objectProperties;
    this.precision = decimalPrecision;
  }
};


class WriteCommandConfig {
  constructor(device, objects) {
    this.device = {
      "deviceId": device.deviceId,
      "address": device.address
    };
    this.objects = [{
      "objectId": {
        "type": objects.object_type,
        "instance": objects.instance,
        "properties": objects.object_props
      }
    }];
  }
};

const getUnit = function(id) {
  for (var key in baEnum.UnitsId) {
    if(baEnum.UnitsId[key] == id){
      if (baEnum.UnitsId.hasOwnProperty(key)) {
        let unitsArr = key.split("_"); unitsArr.shift();
        let unit;
        unitsArr.forEach((ele, index) =>{
          if(index == 0){
             unit = ele.toLowerCase();
          } else {
            unit += "-" + ele.toLowerCase();
          }
        });
        return unit;
      }
    }
  }
};

const generateId = function() {
  return randomUUID();
};

const getIpAddress = function() {
  return new Promise(function(resolve, reject) {
    const nets = os.networkInterfaces();
    const results = Object.create(null); // Or just '{}', an empty object
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            let family = parseInt(net.family.toString().match(/[0-9]/));
            if (family === 4 && !net.internal) {
                if (!results[name]) {
                    results[name] = [];
                }
                results[name].push(net.address);
            }
        }
    }

    if(os.version().includes('Ubuntu')) {
      let allInterfaceName = 'All interfaces';
      if (!results[allInterfaceName]) {
        results[allInterfaceName] = [];
      }
      results[allInterfaceName].push('0.0.0.0');
    } else if(os.version().includes('Windows')) {
      //do nothing
    }
    
    resolve(results);
  });
}

const roundDecimalPlaces = function(value, decimals) {
  if(decimals) return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
  return value;
}


module.exports = { DeviceObjectId, DeviceObject, BacnetConfig, BacnetClientConfig, ReadCommandConfig, WriteCommandConfig, logger, getUnit, generateId, getIpAddress, roundDecimalPlaces };