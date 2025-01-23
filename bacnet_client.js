/*
  MIT License Copyright 2021, 2024 - Bitpool Pty Ltd
*/

const bacnet = require("./resources/node-bacstack-ts/dist/index.js");
const baEnum = bacnet.enum;
const bacnetIdMax = baEnum.ASN1_MAX_PROPERTY_ID;
const { EventEmitter } = require("events");
const {
  getUnit,
  roundDecimalPlaces,
  parseBacnetError,
  getBacnetErrorString,
  Read_Config_Sync,
  isNumber,
  decodeBitArray,
} = require("./common");
const { ToadScheduler, SimpleIntervalJob, Task } = require("toad-scheduler");
const { BacnetDevice } = require("./bacnet_device");
const { Mutex } = require("async-mutex");
const { treeBuilder } = require("./treeBuilder.js");

class BacnetClient extends EventEmitter {
  //client constructor
  constructor(config) {
    super();
    let that = this;
    that.config = config;
    that.deviceList = [];
    that.networkTree = {};
    that.lastWhoIs = null;
    that.client = null;
    that.lastNetworkPoll = null;
    that.scheduler = new ToadScheduler();
    that.mutex = new Mutex();
    that.manualMutex = new Mutex();
    that.pollInProgress = false;
    that.buildJsonInProgress = false;
    that.scanMatrix = [];
    that.renderListCount = 0;
    that.portRangeMatrix = config.portRangeMatrix;

    try {
      if (that.config.cacheFileEnabled) {
        let cachedData = JSON.parse(Read_Config_Sync());
        if (cachedData && typeof cachedData == "object") {
          if (cachedData.renderList) that.renderList = cachedData.renderList;
          if (cachedData.deviceList) {
            cachedData.deviceList.forEach(function (device) {
              let newBacnetDevice = new BacnetDevice(true, device);
              that.deviceList.push(newBacnetDevice);
            });
          }
          if (cachedData.pointList) that.networkTree = cachedData.pointList;
          if (cachedData.renderListCount) that.renderListCount = cachedData.renderListCount;
        }
      }

      that.roundDecimal = config.roundDecimal;
      that.apduSize = config.apduSize;
      that.maxSegments = config.maxSegments;
      that.discover_polling_schedule = config.discover_polling_schedule;
      that.deviceId = config.deviceId;
      that.broadCastAddr = config.broadCastAddr;
      that.device_read_schedule = config.device_read_schedule;
      that.deviceRetryCount = parseInt(config.retries);
      that.sanitise_device_schedule = config.sanitise_device_schedule;
      that.buildTreeException = false;

      that.readPropertyMultipleOptions = {
        maxSegments: 112,
        maxApdu: 5,
      };

      try {
        that.client = new bacnet.Client({
          apduTimeout: config.apduTimeout,
          interface: config.localIpAdrress,
          port: config.port,
          broadcastAddress: config.broadCastAddr,
          portRangeMatrix: config.portRangeMatrix,
        });
        that.setMaxListeners(1);

        const task = new Task("simple task", () => {
          that.globalWhoIs();
        });

        const job = new SimpleIntervalJob({ seconds: parseInt(that.discover_polling_schedule) }, task);

        that.scheduler.addSimpleIntervalJob(job);

        //query device task
        const queryDevices = new Task("simple task", () => {
          if (!that.pollInProgress) {
            that.queryDevices();
          }

          if (!that.buildJsonInProgress) {
            that.buildJsonTree();
          }
        });

        const queryJob = new SimpleIntervalJob({ seconds: parseInt(that.device_read_schedule) }, queryDevices);

        that.scheduler.addSimpleIntervalJob(queryJob);

        //buildNetworkTreeData task
        const buildNetworkTree = new Task("simple task", () => {
          that.doTreeBuilder();
          that.countDevices();
        });

        const buildNetworkTreeJob = new SimpleIntervalJob({ seconds: 5 }, buildNetworkTree);

        that.scheduler.addSimpleIntervalJob(buildNetworkTreeJob);

        that.globalWhoIs();

        setTimeout(() => {
          that.queryDevices();
          that.buildJsonTree();
        }, "5000");
      } catch (e) {
        that.logOut("Issue initializing client: ", e);
      }

      //who is callback
      that.client.on("iAm", (device) => {
        if (device.address !== that.config.localIpAdrress) {
          if (that.scanMatrix.length > 0) {
            let matrixMap = that.scanMatrix.filter((ele) => device.deviceId >= ele.start && device.deviceId <= ele.end);
            if (matrixMap.length > 0) {
              //only add unique device to array
              let foundIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() == device.deviceId);
              if (foundIndex == -1) {
                let newBacnetDevice = new BacnetDevice(false, device);
                newBacnetDevice.setLastSeen(Date.now());
                if (newBacnetDevice.getIsMstpDevice()) {
                  that.addToParentMstpNetwork(newBacnetDevice);
                }
                that.deviceList.push(newBacnetDevice);
                that.addToNetworkTree(newBacnetDevice);
              } else if (foundIndex !== -1) {
                that.deviceList[foundIndex].updateDeviceConfig(device);
                that.deviceList[foundIndex].setLastSeen(Date.now());
                if (that.deviceList[foundIndex].getIsMstpDevice()) {
                  that.addToParentMstpNetwork(that.deviceList[foundIndex]);
                }
                that.addToNetworkTree(that.deviceList[foundIndex]);
              }
              //emit event for node-red to log
              that.emit("deviceFound", device);
            }
          } else {
            //only add unique device to array
            let foundIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() == device.deviceId);
            if (foundIndex == -1) {
              let newBacnetDevice = new BacnetDevice(false, device);
              newBacnetDevice.setLastSeen(Date.now());
              if (newBacnetDevice.getIsMstpDevice()) {
                that.addToParentMstpNetwork(newBacnetDevice);
              }
              that.deviceList.push(newBacnetDevice);
              that.addToNetworkTree(newBacnetDevice);
            } else if (foundIndex !== -1) {
              that.deviceList[foundIndex].updateDeviceConfig(device);
              that.deviceList[foundIndex].setLastSeen(Date.now());
              if (that.deviceList[foundIndex].getIsMstpDevice()) {
                that.addToParentMstpNetwork(that.deviceList[foundIndex]);
              }
              that.addToNetworkTree(that.deviceList[foundIndex]);
            }

            //emit event for node-red to log
            that.emit("deviceFound", device);
          }
        }
      });
    } catch (e) {
      that.logOut("Issue with creating bacnet client, see error:  ", e);
    }

    that.client.on("error", (err) => {
      that.logOut("Error occurred: ", err);

      if (err.errno == -4090) {
        that.logOut("Invalid Client information or incorrect IP address provided");
      } else if (err.errno == -49) {
        that.logOut("Invalid IP address provided");
      } else {
        that.reinitializeClient(that.config);
      }
    });
  }

  testFunction(address, port, type, instance, property) {
    let that = this;
    console.log("test function ");

    let addressObject = {
      address: address,
      port: port,
    };

    const propertiesArray = [{ objectId: { type: type, instance: instance }, properties: [{ id: property }] }];

    that.client.readPropertyMultiple(addressObject, propertiesArray, that.readPropertyMultipleOptions, (err, value) => {
      console.log("1 - readPropertyMultiple:  ");

      console.log(value);
      if (value) {
        // If the result has value, resolve the promise
        console.log(value.values[0]);
        value.values[0].values.forEach(function (value) {
          console.log("value: ", value.value);
        });
      } else {
        console.log(err);
      }
    });

    that.client.readProperty(
      addressObject,
      { type: type, instance: instance },
      property,
      that.readPropertyMultipleOptions,
      (err, value) => {
        console.log("2 - readProperty:  ");

        console.log(value);
        if (value) {
          // If the result has value, resolve the promise
          console.log(value.values[0]);
          value.values[0].values.forEach(function (value) {
            console.log("value: ", value.value);
          });
        } else {
          console.log(err);
        }
      }
    );
  }

  addToNetworkTree(device) {
    let that = this;
    try {
      const deviceKey = that.createDeviceKey(device);
      let deviceName = device.getDeviceName();
      if (deviceName !== null) {
        const deviceId = device.getDeviceId();
        if (deviceId !== null) {
          let lastIndex = deviceName.lastIndexOf(deviceId);
          if (lastIndex) {
            let formattedName = deviceName.substring(0, lastIndex);
            formattedName = `${formattedName.trim()}_Device_${deviceId}`;
            if (
              that.networkTree[deviceKey][formattedName] &&
              Object.keys(that.networkTree[deviceKey][formattedName]).length > 0
            ) {
              delete that.networkTree[deviceKey]["device"];
            }
          }
        }
      } else {
        const json = {
          objectId: {
            type: 8,
            instance: device.getDeviceId(),
          },
        };

        if (that.networkTree[deviceKey] && that.networkTree[deviceKey]["device"]) {
          that.networkTree[deviceKey]["device"]["meta"] = json;
        } else {
          that.networkTree[deviceKey] = {
            device: {
              meta: json,
            },
          };
        }
      }
    } catch (e) {
      that.logOut("addToNetworkTree error: ", e);
    }
  }

  getProtocolSupported(device) {
    //return protocols support for device
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    return new Promise((resolve, reject) => {
      that.client.readProperty(
        addressObject,
        { type: baEnum.ObjectType.DEVICE, instance: device.getDeviceId() },
        baEnum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED,
        that.readPropertyMultipleOptions,
        (err, value) => {
          if (err) {
            reject(err);
          }

          if (value) {
            resolve(value);
          }
        }
      );
    });
  }

  addToParentMstpNetwork(device) {
    let that = this;
    let address = device.getAddress().address;
    let deviceId = device.getDeviceId();
    let foundParentIndex = that.deviceList.findIndex((ele) => ele.getAddress() == address);
    if (foundParentIndex !== -1) {
      that.deviceList[foundParentIndex].addChildDevice(deviceId);
      device.setParentDeviceId(that.deviceList[foundParentIndex].getDeviceId());
    }
  }

  logOut(param1, param2) {
    let that = this;
    that.emit("bacnetErrorLog", param1, param2);
  }

  rebuildDataModel() {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        that.deviceList = [];
        that.renderList = [];
        that.networkTree = {};
        that.pollInProgress = false;
        that.buildJsonInProgress = false;
        that.renderListCount = 0;
        resolve(true);
      } catch (e) {
        that.logOut("Error clearing BACnet data model: ", e);
        reject(e);
      }
    });
  }

  purgeDevice(device) {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        let renderListIndex = that.renderList.findIndex((ele) => ele.deviceId == device.deviceId && ele.ipAddr == device.address);
        let deviceListIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() == device.deviceId);
        let deviceKey = device.address + "-" + device.deviceId;
        delete that.networkTree[deviceKey];
        that.renderList.splice(renderListIndex, 1);
        that.deviceList.splice(deviceListIndex, 1);

        that.countDevices();

        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  }

  forceUpdateDevices(deviceArray) {
    let that = this;
    try {
      deviceArray.forEach(async function (deviceId) {
        let device = that.deviceList.find((ele) => ele.getDeviceId() === deviceId);
        if (device) {
          await that.buildJsonObject(device);
        }
      });
    } catch (e) {
      that.logOut("forceUpdateDevices error: ", e);
    }
  }

  async updatePointsForDevice(deviceObject) {
    try {
      let device = this.deviceList.find((ele) => ele.getDeviceId() === deviceObject.deviceId);

      if (!device) {
        throw new Error(`Device with ID ${deviceObject.deviceId} not found`);
      }

      await this.updateDeviceName(device);

      if (!device.getIsProtocolServicesSet()) {
        try {
          const result = await this.getProtocolSupported(device);
          const decodedValues = decodeBitArray(8, result.values[0].originalBitString.value);
          device.setProtocolServicesSupported(decodedValues);
        } catch (error) {
          this.logOut("getProtocolSupported error: ", error);
        }
      }

      try {
        await this.getDevicePointList(device);
        await this.buildJsonObject(device);
      } catch (e) {
        this.logOut(`Update points list error 2: ${this.getDeviceAddress(device)}`, e);
        device.setManualDiscoveryMode(true);

        try {
          await this.getDevicePointListWithoutObjectList(device);
          await this.buildJsonObject(device);
        } catch (e) {
          await this.buildJsonObject(device);
          this.logOut(`Update points list error 4: ${this.getDeviceAddress(device)}`, e);
        }
      }

      return true;
    } catch (e) {
      this.logOut(`Error in updatePointsForDevice: ${e.message}`, e);
      throw e; // Re-throw the error to be handled by the caller
    }
  }

  applyDisplayNames(pointsToRead) {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        for (let key in pointsToRead) {
          let deviceModel = that.findDeviceByKey(key);
          let device = pointsToRead[key];
          for (let pointName in device) {
            let pointObject = device[pointName];
            if (pointName == "deviceName") {
              deviceModel.setDisplayName(pointObject);
            }
            if (that.networkTree[key][pointName]) {
              that.networkTree[key][pointName] = pointObject;
            }
          }
        }

        resolve(true);
      } catch (e) {
        that.logOut("applyDisplayNames error: ", e);
        reject(e);
      }
    });
  }

  setDeviceDisplayName(deviceObject, displayName) {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        let address = "";
        if (typeof deviceObject.address == "string") {
          address = deviceObject.address;
        } else if (typeof deviceObject.address == "object") {
          address = deviceObject.address.address;
        }

        let device = that.deviceList.find(
          (ele) => that.getDeviceAddress(ele) == address && ele.getDeviceId() == deviceObject.deviceId
        );
        device.setDisplayName(displayName);
        that.buildTreeException = true;
        resolve(true);
      } catch (e) {
        that.logOut("setDeviceDisplayName error: ", e);
        reject(e);
      }
    });
  }

  setPointDisplayName(deviceKey, pointName, pointDisplayName) {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        if (that.networkTree[deviceKey][pointName]) {
          that.networkTree[deviceKey][pointName].displayName = pointDisplayName;
        }
        that.buildTreeException = true;
        resolve(true);
      } catch (e) {
        that.logOut("setPointDisplayName error: ", e);
        reject(e);
      }
    });
  }

  importReadList(payload) {
    let that = this;
    return new Promise((resolve, reject) => {
      try {
        that.buildTreeException = true;
        for (let key in payload) {
          let device = payload[key];
          for (let pointName in device) {
            let pointObject = device[pointName];
            if (that.networkTree[key][pointName]) {
              that.networkTree[key][pointName] = pointObject;
            }
          }
        }
        resolve(true);
      } catch (e) {
        that.logOut("importReadList error: ", e);
        reject(e);
      }
    });
  }

  async queryDevices() {
    let that = this;
    try {
      that.pollInProgress = true;

      let index = 0;
      await query(index);

      async function query(index) {
        if (index < that.deviceList.length) {
          let device = that.deviceList[index];
          if (typeof device == "object" && (device.getIsDumbMstpRouter() == false || device.getIsDumbMstpRouter() == undefined)) {
            if (device.getIsProtocolServicesSet() == false) {
              try {
                let result = await that.getProtocolSupported(device);
                let decodedValues = decodeBitArray(8, result.values[0].originalBitString.value);
                device.setProtocolServicesSupported(decodedValues);
              } catch (error) {
                that.logOut("getProtocolSupported error: ", error);
                index++;
                await query(index);
              }
            }
            try {
              await that.updateDeviceName(device);

              if (device.getSegmentation() !== 3) {
                try {
                  await that.getDevicePointList(device);
                  index++;
                  await query(index);
                } catch (e) {
                  that.logOut(`getDevicePointList error: ${device.getAddress()}`, e);

                  index++;
                  await query(index);
                }
              } else if (device.getSegmentation() == 3) {
                try {
                  await that.getDevicePointListWithoutObjectList(device);
                  index++;
                  await query(index);
                } catch (e) {
                  that.logOut(`getDevicePointList error: ${device.getAddress()}`, e);

                  index++;
                  await query(index);
                }
              }
            } catch (e) {
              that.logOut("Error while querying devices: ", e);

              index++;
              await query(index);
            }
          } else {
            index++;
            await query(index);
          }
        } else if (index == that.deviceList.length) {
          that.pollInProgress = false;
        }
      }
    } catch (e) {
      that.logOut("Error while querying devices: ", e);
    }
  }

  // updateDeviceName(device) {
  //   let that = this;
  //   return new Promise((resolve, reject) => {
  //     that
  //       ._getDeviceName(device)
  //       .then(function (deviceObject) {
  //         if (typeof deviceObject.name == "string") {
  //           device.setDeviceName(deviceObject.name + " " + device.getDeviceId());
  //           device.setPointsList(deviceObject.devicePointEntry);
  //         }
  //         resolve();
  //       })
  //       .catch(function (e) {
  //         that.logOut("updateDeviceName error: ", e);
  //         resolve();
  //       });
  //   });
  // }

  async updateDeviceName(device) {
    try {
      const deviceObject = await this._getDeviceName(device);
      if (typeof deviceObject?.name === "string") {
        device.setDeviceName(deviceObject.name + " " + device.getDeviceId());
        device.setPointsList(deviceObject.devicePointEntry);
      }
    } catch (e) {
      this.logOut("updateDeviceName error: ", e);
    }
  }

  reinitializeClient(config) {
    let that = this;

    that.config = config;
    that.roundDecimal = config.roundDecimal;
    that.apduSize = config.apduSize;
    that.maxSegments = config.maxSegments;
    that.discover_polling_schedule = config.discover_polling_schedule;
    that.deviceId = config.deviceId;
    that.broadCastAddr = config.broadCastAddr;
    that.device_read_schedule = config.device_read_schedule;

    if (that.scheduler !== null) {
      that.scheduler.stop();
    }

    try {
      that.client._settings.apduTimeout = config.apduTimeout;
      that.client._settings.interface = config.localIpAdrress;
      that.client._settings.port = config.port;
      that.client._settings.broadcastAddress = config.broadCastAddr;

      that.client._transport.interface = config.localIpAdrress;
      that.client._transport.port = config.port;
      that.client._transport.broadcastAddress = config.broadCastAddr;

      const task = new Task("simple task", () => {
        that.globalWhoIs();
      });

      const job = new SimpleIntervalJob({ seconds: parseInt(config.discover_polling_schedule) }, task);

      that.scheduler.addSimpleIntervalJob(job);

      // //query device task
      const queryDevices = new Task("simple task", () => {
        if (!that.pollInProgress) {
          that.queryDevices();
        }

        if (!that.buildJsonInProgress) {
          that.buildJsonTree();
        }
      });

      const queryJob = new SimpleIntervalJob({ seconds: parseInt(config.device_read_schedule) }, queryDevices);

      that.scheduler.addSimpleIntervalJob(queryJob);

      //buildNetworkTreeData task
      const buildNetworkTree = new Task("simple task", () => {
        that.doTreeBuilder();
        that.countDevices();
      });

      const buildNetworkTreeJob = new SimpleIntervalJob({ seconds: 10 }, buildNetworkTree);

      that.scheduler.addSimpleIntervalJob(buildNetworkTreeJob);
    } catch (e) {
      that.logOut("Error reinitializing bacnet client: ", e);
    }
  }

  getValidPointProperties(point, requestedProps) {
    let that = this;
    let availableProps = point.propertyList;
    let newProps = [];

    try {
      requestedProps.forEach(function (prop) {
        let foundInAvailable = availableProps.find((ele) => ele === prop.id);
        if (foundInAvailable) newProps.push(prop);
      });
      //add object name for use in formatting
      newProps.push({ id: baEnum.PropertyIdentifier.OBJECT_NAME });
    } catch (e) {
      that.logOut("Issue finding valid object properties, see error: ", e);
    }

    return newProps;
  }

  findDeviceByKey(key) {
    let that = this;
    return that.deviceList.find((ele) => `${that.getDeviceAddress(ele)}-${ele.getDeviceId()}` === key);
  }

  getObjectId(pointName, pointConfig, that) {
    // Retrieve the object type based on the point configuration
    const bacObjType = that.getObjectType(pointConfig.meta.objectId.type);
    // Construct the object ID string
    return `${pointName}_${bacObjType}_${pointConfig.meta.objectId.instance}`;
  }

  createDeviceKey(device) {
    // Create a device key by combining the address and device ID
    const address = device.getAddress();
    const deviceId = device.getDeviceId();
    if (typeof address === "object") {
      return `${address.address}-${deviceId}`;
    } else {
      return `${address}-${deviceId}`;
    }
  }

  async doRead(readConfig, outputType, objectPropertyType, readNodeName) {
    const that = this;
    const roundDecimal = readConfig.precision;
    const devicesToRead = Object.keys(readConfig.pointsToRead);
    const bacnetResults = {};
    let pendingRequests = 0;

    try {
      // Process all devices in sequence
      for (let deviceIndex = 0; deviceIndex < devicesToRead.length; deviceIndex++) {
        const key = devicesToRead[deviceIndex];
        const device = that.findDeviceByKey(key);
        if (!device) continue;

        const deviceName = that.computeDeviceName(device);
        const deviceKey = that.createDeviceKey(device);
        const deviceObject = that.networkTree[deviceKey];
        const maxObjectCount = that.estimateMaxObjectSize(device.getMaxApdu());

        if (!bacnetResults[deviceName]) {
          bacnetResults[deviceName] = {};
        }

        // Process points for the current device
        const pointsToRead = readConfig.pointsToRead[key];
        const pointNames = Object.keys(pointsToRead);
        let totalPoints = pointNames.length - 1;
        let requestArray = [];
        let processedPoints = 0; // Counter for processed points

        // Process each point for the device in batches
        for (let i = 0; i < pointNames.length; i++) {

          const pointName = pointNames[i];
          if (pointName === "deviceName") {
            continue;
          }

          const pointConfig = pointsToRead[pointName];
          const objectId = that.getObjectId(pointName, pointConfig, that);
          const point = deviceObject[objectId];

          if (point) {
            point.displayName = pointConfig.displayName;

            // Prepare request array for batch processing
            requestArray.push({
              objectId: { type: point.meta.objectId.type, instance: point.meta.objectId.instance },
              properties: [{ id: baEnum.PropertyIdentifier.PRESENT_VALUE }],
              pointRef: point,
              pointName: pointName,
            });
          }

          // Process the batch when the request array is full or the last point is reached
          if (requestArray.length === maxObjectCount) {
            if (device.getProtocolServiceSupport("ReadPropertyMultiple") == true) {
              await that.processBatch(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            } else {
              await that.processIndividualPoints(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            }

            requestArray = [];
            // Increment the processed points counter
            processedPoints += maxObjectCount;
          } else if (i === pointNames.length - 1) {
            if (device.getProtocolServiceSupport("ReadPropertyMultiple") == true) {
              await that.processBatch(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            } else {
              await that.processIndividualPoints(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            }

            requestArray = [];
            // Increment the processed points counter
            processedPoints += i;
          }

          // Check if all points for the device have been processed
          if (processedPoints >= totalPoints) {
            pendingRequests++;

            // Emit the `values` event for the current device
            that.emit(
              "values",
              bacnetResults,
              outputType,
              objectPropertyType,
              readNodeName,
              pendingRequests,
              devicesToRead.length
            );
            delete bacnetResults[deviceName];
          }
        }
      }
    } catch (error) {
      that.logOut("doRead error: ", error);
    }
  }

  async processBatch(device, requestArray, deviceName, bacnetResults, that, roundDecimal) {
    try {
      const results = await that.updateManyPoints(device, requestArray);
      if (results.error) {
        throw results.error;
      }

      let deviceMetaInfo = {
        address: device.getAddress(),
        isMstp: device.getIsMstpDevice(),
        deviceId: device.getDeviceId(),
        vendorId: device.getVendorId(),
        deviceName: deviceName,
      };

      // Process the results of the batch
      results.value.values.forEach((pointResult) => {
        const cacheRef = requestArray.find(
          (ele) =>
            ele.pointRef.meta.objectId.type === pointResult.objectId.type &&
            ele.pointRef.meta.objectId.instance === pointResult.objectId.instance
        );

        if (cacheRef) {
          const pointRef = cacheRef.pointRef;
          const pointNameRef = cacheRef.pointName;
          const val = pointResult.values[0].value[0].value;

          if (isNumber(val)) {
            pointRef.presentValue = roundDecimalPlaces(val, roundDecimal);
            pointRef.error = "none";
            if (pointRef.meta.objectId.type == 19 || pointRef.meta.objectId.type == 13 || pointRef.meta.objectId.type == 14) {
              if (pointRef.stateTextArray && typeof pointRef.stateTextArray[0].value !== "object") {
                if (val != 0) {
                  pointRef.presentValue = pointRef.stateTextArray[val - 1].value;
                } else {
                  pointRef.presentValue = pointRef.stateTextArray[val].value;
                }
              }
            }
          } else {
            if (typeof val !== "object") {
              pointRef.presentValue = val;
              pointRef.error = "none";
            } else if (val.errorClass && val.errorClass) {
              pointRef.error = getBacnetErrorString(val.errorClass, val.errorClass);
            }
          }

          pointRef.meta["device"] = deviceMetaInfo;
          pointRef.timestamp = Date.now();
          pointRef.status = "online";

          // Store the point data in results
          bacnetResults[deviceName][pointNameRef] = pointRef;
        }
      });
    } catch (err) {
      that.logOut("Error processing batch:", err);
      await that.processIndividualPoints(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
    }
  }

  async processIndividualPoints(device, requestArray, deviceName, bacnetResults, that, roundDecimal) {
    let deviceMetaInfo = {
      address: device.getAddress(),
      isMstp: device.getIsMstpDevice(),
      deviceId: device.getDeviceId(),
      vendorId: device.getVendorId(),
      deviceName: deviceName,
    };

    for (const request of requestArray) {
      const { objectId, pointRef, pointName } = request;
      try {

        const result = await that.updatePoint(device, pointRef);

        if (result.objectId.type == objectId.type && result.objectId.instance == objectId.instance) {
          const val = result.values[0].value;

          if (isNumber(val)) {
            pointRef.presentValue = roundDecimalPlaces(val, roundDecimal);

            if (pointRef.meta.objectId.type == 19 || pointRef.meta.objectId.type == 13 || pointRef.meta.objectId.type == 14) {
              if (pointRef.stateTextArray && typeof pointRef.stateTextArray[0].value !== "object") {
                if (val != 0) {
                  pointRef.presentValue = pointRef.stateTextArray[val - 1].value;
                } else {
                  pointRef.presentValue = pointRef.stateTextArray[val].value;
                }
              }
            }
          } else {
            pointRef.presentValue = val;
          }

          pointRef.meta["device"] = deviceMetaInfo;
          pointRef.timestamp = Date.now();
          pointRef.status = "online";
          pointRef.error = "none";

          // Store the point data in results
          bacnetResults[deviceName][pointName] = pointRef;
        }
      } catch (err) {
        that.logOut(`Error updating point ${pointName}:`, err);

        pointRef.meta["device"] = deviceMetaInfo;
        pointRef.timestamp = Date.now();
        pointRef.status = "offline";
        pointRef.error = parseBacnetError(err);
        bacnetResults[deviceName][pointName] = pointRef;
      }
    }
  }

  // updateManyPoints(device, points) {
  //   let that = this;
  //   return new Promise((resolve, reject) => {
  //     // let readOptions = {
  //     //   maxSegments: device.getMaxSe,
  //     //   maxApdu: that.readPropertyMultipleOptions.maxApdu,
  //     // };

  //     that
  //       ._readObjectWithRequestArray(device, points, that.readPropertyMultipleOptions)
  //       .then(function (results) {
  //         resolve(results);
  //       })
  //       .catch(function (err) {
  //         reject(err);
  //       });
  //   });
  // }

  async updateManyPoints(device, points) {
    try {
      // let readOptions = {
      //   maxSegments: device.getMaxSe,
      //   maxApdu: that.readPropertyMultipleOptions.maxApdu,
      // };

      const results = await this._readObjectWithRequestArray(device, points, this.readPropertyMultipleOptions);
      return results;
    } catch (error) {
      throw error;
    }
  }

  updatePointWithRetry(device, point, retryCount = 1) {
    let that = this;
    const tryUpdate = (retriesLeft) => {
      return that.updatePoint(device, point).catch((err) => {
        if (retriesLeft > 0) {
          that.logOut(`Retrying updatePoint... Attempts left: ${retriesLeft}`);
          return tryUpdate(retriesLeft - 1);
        }
        // If no retries are left, reject with the original error
        return Promise.reject(err);
      });
    };

    return tryUpdate(retryCount);
  }

  updatePoint(device, point) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    return new Promise((resolve, reject) => {
      that.client.readProperty(
        addressObject,
        { type: point.meta.objectId.type, instance: point.meta.objectId.instance },
        baEnum.PropertyIdentifier.PRESENT_VALUE,
        that.readPropertyMultipleOptions,
        (err, value) => {
          if (err) {
            reject(err);
          }
          if (value) {
            resolve(value);
          }
        }
      );
    });
  }

  estimateMaxObjectSize(apduSize) {
    if (apduSize < 500) {
      return 20;
    } else if (apduSize > 500 && apduSize < 1000) {
      //return Math.round(((apduSize - 30) / 7));
      return 50;
    } else if (apduSize > 1000) {
      //return Math.round(((apduSize - 30) / 7));
      return 100;
    }
  }

  getDeviceAddress(device) {
    switch (typeof device.getAddress()) {
      case "object":
        return device.getAddress().address;
      case "string":
        return device.getAddress();
      default:
        return device.getAddress();
    }
  }

  _getDeviceName(device) {
    let that = this;
    return new Promise((resolve, reject) => {
      that._readDeviceName(device, (err, result) => {
        if (result) {
          try {
            if (result.values[0].value) {
              const deviceObject = {
                name: result.values[0].value,
                devicePointEntry: [{ value: { type: 8, instance: device.getDeviceId() }, type: 12 }],
              };
              resolve(deviceObject);
            } else {
              that.logOut("Issue with deviceName payload, see object: ", result);
              resolve();
            }
          } catch (e) {
            that.logOut("Unable to get device name: ", e);
            reject(e);
          }
        }
        if (err) {
          reject(err);
        }
      });
    });
  }

  getPropertiesForType(props, type) {
    let that = this;
    let newProps = [];
    props.forEach(function (prop) {
      //that.logOut(prop);
      switch (type) {
        case 0: //analog-input
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
          if (prop.id == baEnum.PropertyIdentifier.PRESENT_VALUE || prop.id == baEnum.PropertyIdentifier.OBJECT_NAME)
            newProps.push(prop);
          break;
        case 14:
          if (prop.id == baEnum.PropertyIdentifier.PRESENT_VALUE || prop.id == baEnum.PropertyIdentifier.OBJECT_NAME)
            newProps.push(prop);
          break;
        case 19:
          if (prop.id == baEnum.PropertyIdentifier.PRESENT_VALUE || prop.id == baEnum.PropertyIdentifier.OBJECT_NAME)
            newProps.push(prop);
          break;
      }
    });
    return newProps;
  }

  getDevicePointList(device) {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        device.setManualDiscoveryMode(false);
        let result = await that.scanDevice(device);
        device.setPointsList(result);
        device.setLastSeen(Date.now());
        resolve(result);
      } catch (e) {
        that.logOut(`Error getting point list for ${device.getAddress().toString()} - ${device.getDeviceId()}: `, e);
        reject(e);
      }
    });
  }

  getDevicePointListWithoutObjectList(device) {
    let that = this;
    return new Promise(function (resolve, reject) {
      try {
        that
          .scanDeviceManually(device)
          .then(function (result) {
            device.setPointsList(result);
            device.setLastSeen(Date.now());
            resolve(result);
          })
          .catch(function (error) {
            reject(error);
          });
      } catch (e) {
        that.logOut("Error getting point list: ", e);
        reject(e);
      }
    });
  }

  scanDeviceManually(device) {
    let that = this;

    return new Promise(function (resolve, reject) {
      let deviceId = device.getDeviceId();
      let discoveredPointList = [];

      let addressObject = {
        address: device.getAddress(),
        port: device.getPort(),
      };

      let index = 1;

      send(index);

      function send(index) {
        let readOptions = {
          maxSegments: that.readPropertyMultipleOptions.maxSegments,
          maxApdu: that.readPropertyMultipleOptions.maxApdu,
          arrayIndex: index,
        };

        that.client.readProperty(
          addressObject,
          { type: baEnum.ObjectType.DEVICE, instance: deviceId },
          baEnum.PropertyIdentifier.OBJECT_LIST,
          readOptions,
          (err, value) => {
            if (err) {
              resolve(discoveredPointList);
            }

            if (value) {
              discoveredPointList.push(value.values[0]);
              index++;
              send(index);
            }
          }
        );
      }
    });
  }

  _readObjectWithRequestArray(device, requestArray, readOptions) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    return new Promise((resolve, reject) => {
      that.client.readPropertyMultiple(addressObject, requestArray, readOptions, (error, value) => {
        resolve({
          error: error,
          value: value,
        });
      });
    });
  }

  _readDeviceName(device, callback) {
    let that = this;

    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    let deviceId = device.getDeviceId();

    that.client.readProperty(
      addressObject,
      { type: baEnum.ObjectType.DEVICE, instance: deviceId },
      baEnum.PropertyIdentifier.OBJECT_NAME,
      that.readPropertyMultipleOptions,
      callback
    );
  }

  _readObjectList(device, readOptions, callback) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    let deviceId = device.getDeviceId();
    try {
      that.client.readProperty(
        addressObject,
        { type: baEnum.ObjectType.DEVICE, instance: deviceId },
        baEnum.PropertyIdentifier.OBJECT_LIST,
        readOptions,
        callback
      );
    } catch (e) {
      that.logOut("Error reading object list:  ", e);
    }
  }

  _readObject(addressObject, type, instance, properties, readOptions) {
    let that = this;
    return new Promise((resolve, reject) => {
      const requestArray = [
        {
          objectId: { type: type, instance: instance },
          properties: properties,
        },
      ];
      that.client.readPropertyMultiple(addressObject, requestArray, readOptions, (error, value) => {
        resolve({
          error: error,
          value: value,
        });
      });
    });
  }

  _readObjectFull(device, type, instance) {
    const that = this;
    const readOptions = {
      maxSegments: that.readPropertyMultipleOptions.maxSegments,
      maxApdu: that.readPropertyMultipleOptions.maxApdu,
    };

    const readIndividualPropsOptions = {
      maxSegments: 0,
      maxApdu: device.getMaxApdu(),
    };

    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };

    // Define all properties to be read
    const allProperties = [
      { id: baEnum.PropertyIdentifier.PRESENT_VALUE },
      { id: baEnum.PropertyIdentifier.DESCRIPTION },
      { id: baEnum.PropertyIdentifier.UNITS },
      { id: baEnum.PropertyIdentifier.OBJECT_NAME },
      { id: baEnum.PropertyIdentifier.OBJECT_TYPE },
      { id: baEnum.PropertyIdentifier.OBJECT_IDENTIFIER },
      { id: baEnum.PropertyIdentifier.SYSTEM_STATUS },
      { id: baEnum.PropertyIdentifier.MODIFICATION_DATE },
      { id: baEnum.PropertyIdentifier.STATE_TEXT },
      { id: baEnum.PropertyIdentifier.RECORD_COUNT },
      { id: baEnum.PropertyIdentifier.PRIORITY_ARRAY },
      { id: baEnum.PropertyIdentifier.VENDOR_NAME },
    ];

    return new Promise((resolve, reject) => {
      // Try to read all properties at once
      that
        ._readObject(addressObject, type, instance, [{ id: baEnum.PropertyIdentifier.ALL }], readOptions)
        .then((result) => {
          if (result.value) {
            // If the result has value, resolve the promise
            resolve(result);
          } else {
            // If not, proceed to read individual properties
            readPropertiesIndividually();
          }
        })
        .catch(() => {
          // On error, proceed to read individual properties
          readPropertiesIndividually();
        });

      // Function to read properties individually
      const readPropertiesIndividually = () => {
        const promises = allProperties.map(
          (property, index) =>
            new Promise((propertyResolve) => {
              that.client.readProperty(
                addressObject,
                { type: type, instance: instance },
                property.id,
                readIndividualPropsOptions,
                (err, value) => {
                  if (err) {
                    propertyResolve(null);
                  } else {
                    propertyResolve({
                      id: property.id,
                      index: value.property.index,
                      value: value.values,
                    });
                  }
                }
              );
            })
        );

        Promise.all(promises)
          .then((resultArray) => {
            // Filter out null results
            const validResults = resultArray.filter((result) => result !== null);

            resolve({
              error: null,
              value: {
                values: [
                  {
                    objectId: {
                      type: type,
                      instance: instance,
                    },
                    values: validResults,
                  },
                ],
              },
            });
          })
          .catch(reject);
      };
    });
  }

  _readObjectLite(device, type, instance) {
    const that = this;
    const readOptions = {
      maxSegments: that.readPropertyMultipleOptions.maxSegments,
      maxApdu: that.readPropertyMultipleOptions.maxApdu,
    };

    const readIndividualPropsOptions = {
      maxSegments: 0,
      maxApdu: device.getMaxApdu(),
    };

    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };

    // Define all properties to be read
    const allProperties = [{ id: baEnum.PropertyIdentifier.PRESENT_VALUE }, { id: baEnum.PropertyIdentifier.OBJECT_NAME }];

    return new Promise((resolve, reject) => {
      // Try to read all properties at once
      that
        ._readObject(addressObject, type, instance, allProperties, readOptions)
        .then((result) => {
          if (result.value) {
            // If the result has value, resolve the promise
            resolve(result);
          } else {
            // If not, proceed to read individual properties
            readPropertiesIndividually();
          }
        })
        .catch(() => {
          // On error, proceed to read individual properties
          readPropertiesIndividually();
        });

      // Function to read properties individually
      const readPropertiesIndividually = () => {
        const promises = allProperties.map(
          (property, index) =>
            new Promise((propertyResolve) => {
              that.client.readProperty(
                addressObject,
                { type: type, instance: instance },
                property.id,
                readIndividualPropsOptions,
                (err, value) => {
                  if (err) {
                    propertyResolve(null);
                  } else {
                    propertyResolve({
                      id: property.id,
                      index: value.property.index,
                      value: value.values,
                    });
                  }
                }
              );
            })
        );

        Promise.all(promises)
          .then((resultArray) => {
            // Filter out null results
            const validResults = resultArray.filter((result) => result !== null);

            resolve({
              error: null,
              value: {
                values: [
                  {
                    objectId: {
                      type: type,
                      instance: instance,
                    },
                    values: validResults,
                  },
                ],
              },
            });
          })
          .catch(reject);
      };
    });
  }

  doWrite(value, options) {
    let that = this;
    let valuesArray = [];
    options.pointsToWrite.forEach(function (point) {
      try {
        let device = that.deviceList.find((ele) => ele.getDeviceId() === point.deviceId);
        let addressObject = {
          address: device.getAddress(),
          port: device.getPort(),
        };

        let writeObject = {
          address: addressObject,
          objectId: {
            type: point.meta.objectId.type,
            instance: point.meta.objectId.instance,
          },
          values: {
            property: {
              id: 85,
              index: point.meta.arrayIndex,
            },
            value: [
              {
                type: options.appTag,
                value: value,
              },
            ],
          },
          options: {
            maxSegments: that.readPropertyMultipleOptions.maxSegments,
            maxApdu: that.readPropertyMultipleOptions.maxApdu,
            arrayIndex: point.meta.arrayIndex,
            priority: options.priority,
          },
        };

        valuesArray.push(writeObject);
      } catch (e) {
        that.logOut("doWrite error: ", e);
      }
    });

    return that._writePropertyMultiple(valuesArray);
  }

  _writePropertyMultiple(values) {
    let that = this;
    try {
      values.forEach(function (point) {
        that.client.writeProperty(
          point.address,
          point.objectId,
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          point.values.value,
          point.options,
          (err, value) => {
            if (err) {
              that.logOut(err);
            }
          }
        );
      });
    } catch (error) {
      that.logOut("_writePropertyMultiple error: ", error);
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
  }

  scanDevice(device) {
    let that = this;
    return new Promise((resolve, reject) => {
      const readOptions = {
        maxSegments: that.readPropertyMultipleOptions.maxSegments,
        maxApdu: that.readPropertyMultipleOptions.maxApdu,
      };
      this._readObjectList(device, readOptions, (err, result) => {
        if (!err) {
          try {
            resolve(result.values);
          } catch (e) {
            that.logOut("Issue with getting device point list, see error:  ", e);
          }
        } else {
          that.logOut(`Error while fetching objects: ${err}`);
          reject(err);
        }
      });
    });
  }

  //closes bacnet client
  shutDownClient() {
    let that = this;
    if (that.client)
      that.client.close((err, result) => {
        that.logOut(err, result);
      });
  }

  globalWhoIs() {
    let that = this;
    if (that.client) {
      that.client.whoIs({ net: 65535 });
    } else {
      that.reinitializeClient(that.config);
    }
    that.lastWhoIs = Date.now();
  }

  getNetworkTreeData() {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        const reducedDeviceList = JSON.parse(JSON.stringify(that.deviceList));
        reducedDeviceList.forEach((device) => {
          delete device["pointsList"];
        });

        resolve({
          renderList: that.renderList,
          deviceList: reducedDeviceList,
          pointList: that.networkTree,
          pollFrequency: that.discover_polling_schedule,
          renderListCount: that.renderListCount,
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  getDeviceList() {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        resolve({ deviceList: that.deviceList });
      } catch (e) {
        reject(e);
      }
    });
  }

  getDataModel() {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        resolve({
          renderList: that.renderList,
          deviceList: that.deviceList,
          pointList: that.networkTree,
          renderListCount: that.renderListCount,
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  updatePointsList(json) {
    let that = this;
    json.deviceList.forEach(function (updatedDevice) {
      let foundIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() == updatedDevice.deviceId);
      if (foundIndex == -1) {
      } else if (foundIndex !== -1) {
        that.deviceList[foundIndex].setPointsList(updatedDevice.pointsList);
      }
    });
  }

  updateDeviceList(json) {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        let deviceL = json.body.deviceList;
        deviceL.forEach(function (device) {
          let foundIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() == device.deviceId);
          if (foundIndex == -1) {
            let newBacnetDevice = new BacnetDevice(true, device);
            newBacnetDevice.setLastSeen(Date.now());
            that.deviceList.push(newBacnetDevice);
          } else if (foundIndex !== -1) {
            that.deviceList[foundIndex].updateDeviceConfig(device);
            that.deviceList[foundIndex].setLastSeen(Date.now());
          }
        });

        resolve(true);
      } catch (e) {
        reject(e);
      }
    });
  }

  updateDataModel(json) {
    let that = this;
    return new Promise(async function (resolve, reject) {
      try {
        if (json.body.renderList) {
          that.renderList = json.body.renderList;
        }
        if (json.body.deviceList) {
          await that.updateDeviceList(json);
        }
        if (json.body.pointList) {
          that.networkTree = json.body.pointList;
        }
        if (json.body.renderListCount) {
          that.renderListCount = json.body.renderListCount;
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  sortDevices(a, b) {
    if (a.deviceId < b.deviceId) {
      return -1;
    } else if (a.deviceId > b.deviceId) {
      return 1;
    }
    return 0; // deviceIds are equal
  }

  sortPoints(a, b) {
    if (a.bacnetType > b.bacnetType) {
      return 1;
    } else if (a.bacnetType < b.bacnetType) {
      return -1;
    } else if (a.bacnetType == b.bacnetType) {
      return 0;
    }

    return a.label.localeCompare(b.label);
  }

  computeDeviceName(device) {
    if (device.getDisplayName() !== null && device.getDisplayName() !== "" && device.getDisplayName() !== undefined) {
      return device.getDisplayName();
    }
    return device.getDeviceName();
  }

  checkInterruptFlag() {
    let that = this;
    let BreakException = {};

    if (that.buildTreeException) {
      throw BreakException;
    }
  }

  getPointName(object, pointName) {
    if (object.displayName) {
      return object.displayName;
    }
    return pointName;
  }

  addUniqueToArray(device, array) {
    const foundIndex = array.findIndex((ele) => ele.getDeviceId() === device.getDeviceId());
    if (foundIndex === -1) {
      array.push(device);
    }
  }

  async getDevicesNotRenderedYet() {
    let that = this;
    let missingDevices = [];
    for (let i = 0; i < that.deviceList.length; i++) {
      const device = that.deviceList[i];
      if (!device.getIsMstpDevice()) {
        //ip device
        const foundIndex = that.renderList.findIndex((ele) => ele.deviceId == device.getDeviceId());
        if (foundIndex == -1) {
          that.addUniqueToArray(device, missingDevices);
        }
      } else {
        //mstp device
        const foundParentIndex = that.renderList.findIndex((ele) => ele.deviceId == device.getParentDeviceId());
        if (foundParentIndex == -1) {
          //parent not existent in tree
          const parentDeviceIndex = that.deviceList.findIndex((ele) => ele.getDeviceId() === device.getParentDeviceId());
          if (parentDeviceIndex !== -1) {
            that.addUniqueToArray(that.deviceList[parentDeviceIndex], missingDevices);
          }
          that.addUniqueToArray(device, missingDevices);
        } else {
          const parentTreeDevice = that.renderList[foundParentIndex];
          let mstpIndex = -1;
          parentTreeDevice.children.forEach((child) => {
            if (child.label.includes("MSTP")) {
              const tempIndex = child.children.findIndex((ele) => ele.deviceId == device.getDeviceId());
              if (tempIndex !== -1) {
                mstpIndex = tempIndex;
              }
            }
          });
          if (mstpIndex == -1) {
            that.addUniqueToArray(device, missingDevices);
          }
        }
      }
    }
    return missingDevices;
  }

  initialTreeBuild = true;

  async doTreeBuilder() {
    let that = this;

    const treeWorker = new treeBuilder(
      that.deviceList,
      that.networkTree,
      that.renderList,
      that.renderListCount,
      that.initialTreeBuild
    );

    treeWorker.cacheData();

    for (let i = 0; i < that.deviceList.length; i++) {
      let device = that.deviceList[i];
      await treeWorker.processDevice(device, i);
    }

    that.deviceList = treeWorker.deviceList;
    that.networkTree = treeWorker.networkTree;
    that.renderList = treeWorker.renderList;

    that.initialTreeBuild = false;
  }

  countDevices() {
    let that = this;
    let deviceCount = 0;

    if (that.renderList && that.renderList.length > 0) {
      that.renderList.forEach(function (device, index) {
        if (device && device.children.length > 0) {
          device.children.forEach(function (folder) {
            if (folder.label == "Points") {
              //increment for parent device / mstp router
              deviceCount++;
            } else if (folder.label.includes("MSTP")) {
              //increment for mstp device list
              deviceCount += folder.children.length;
            }
          });
        }
        if (index == that.renderList.length - 1) {
          that.renderListCount = deviceCount;
        }
      });
    }
  }

  async buildJsonTree() {
    let that = this;
    that.buildJsonInProgress = true;
    for (let i = 0; i < that.deviceList.length; i++) {
      try {
        let device = that.deviceList[i];
        await that.buildJsonObject(device);
      } catch (e) {
        that.logOut("buildJsonTree error: ", e);
      }
    }

    that.buildJsonInProgress = false;
  }

  async buildJsonObject(device) {
    try {
      const pointList = device.getPointsList();
      const requestMutex = new Mutex();
      const promiseArray = [];

      if (typeof pointList === "undefined" || pointList.length === 0) {
        throw new Error("Unable to build network tree, empty point list");
      }

      for (const point of pointList) {
        await requestMutex.acquire();
        let result;
        if (device.getIsInitialQuery()) {
          result = await this._readObjectLite(device, point.value.type, point.value.instance);
          device.setIsInitialQuery(false);
        } else {
          result = await this._readObjectFull(device, point.value.type, point.value.instance);
        }

        if (!result.error) {
          device.setLastSeen(Date.now());
          if (result.length > 0 && Array.isArray(result)) {
            promiseArray.push(...result);
          } else {
            promiseArray.push(result);
          }
        }

        requestMutex.release();
      }

      await this.buildResponse(promiseArray, device);
      this.lastNetworkPoll = Date.now();

      return { deviceList: this.deviceList, pointList: this.networkTree };
    } catch (error) {
      this.logOut("Error while building json object: ", error);
      throw error;
    }
  }

  // Builds response object for a fully qualified
  buildResponse(fullObjects, device) {
    let that = this;
    const reg = /[$#\/\\+,]/gi;
    return new Promise(function (resolve, reject) {
      try {
        let deviceKey =
          typeof device.getAddress() == "object"
            ? device.getAddress().address + "-" + device.getDeviceId()
            : device.getAddress() + "-" + device.getDeviceId();
        let values = that.networkTree[deviceKey] ? that.networkTree[deviceKey] : {};
        for (let i = 0; i < fullObjects.length; i++) {
          let obj = fullObjects[i];
          let successfulResult = !obj.error ? obj.value : null;
          if (successfulResult) {
            successfulResult.values.forEach(function (pointProperty, pointPropertyIndex) {
              if (!pointProperty.objectId && successfulResult.objectId && !pointProperty.values && successfulResult.values) {
                pointProperty = successfulResult;
              }

              let currobjectId = pointProperty.objectId.type;
              let bac_obj = that.getObjectType(currobjectId);
              let objectName = that._findValueById(pointProperty.values, baEnum.PropertyIdentifier.OBJECT_NAME);
              let objectType = pointProperty.objectId.type;

              let objectId;
              if (objectName !== null && typeof objectName == "string") {
                objectName = objectName.replace(reg, "");
                objectId = objectName + "_" + bac_obj + "_" + pointProperty.objectId.instance;

                try {
                  pointProperty.values.forEach(function (object, objectIndex) {
                    //checks for error code json structure, returned for invalid bacnet requests
                    if (object && object.value && !object.value.errorClass) {
                      if (!values[objectId]) values[objectId] = {};
                      values[objectId].meta = {
                        objectId: pointProperty.objectId,
                      };

                      switch (object.id) {
                        case baEnum.PropertyIdentifier.PRESENT_VALUE:
                          try {
                            if (object.value[0] && object.value[0].value !== "undefined" && object.value[0].value !== null) {
                              //check for binary object type
                              if (objectType == 3 || objectType == 4 || objectType == 5) {
                                if (object.value[0].value == 0) {
                                  values[objectId].presentValue = false;
                                } else if (object.value[0].value == 1) {
                                  values[objectId].presentValue = true;
                                }
                              } else if (objectType == 40) {
                                //character string
                                values[objectId].presentValue = object.value[0].value;
                              } else if (objectType == 13 || objectType == 14 || objectType == 19) {
                                //check for MSV MSI MSO - for enum state text
                                if (values[objectId].stateTextArray && values[objectId].stateTextArray.length > 0) {
                                  if (object.value[0].value == 0) {
                                    values[objectId].presentValue = values[objectId].stateTextArray[object.value[0].value].value;
                                  } else if (object.value[0].value !== 0) {
                                    values[objectId].presentValue =
                                      values[objectId].stateTextArray[object.value[0].value - 1].value;
                                  }
                                }
                              } else if (objectType !== 8) {
                                values[objectId].presentValue = roundDecimalPlaces(object.value[0].value, 2);
                              }
                            }
                            values[objectId].meta.arrayIndex = object.index;
                          } catch (e) {
                            that.logOut("buildResponse PRESENT_VALUE error: ", e);
                          }
                          break;
                        case baEnum.PropertyIdentifier.DESCRIPTION:
                          if (object.value[0]) values[objectId].description = object.value[0].value;
                          break;
                        case baEnum.PropertyIdentifier.UNITS:
                          if (object.value[0] && object.value[0].value) values[objectId].units = getUnit(object.value[0].value);
                          break;
                        case baEnum.PropertyIdentifier.OBJECT_NAME:
                          if (object.value[0] && object.value[0].value) {
                            values[objectId].objectName = object.value[0].value.replace(reg, "");
                            if (!values[objectId].displayName) {
                              values[objectId].displayName = object.value[0].value.replace(reg, "");
                            }
                          }
                          break;
                        case baEnum.PropertyIdentifier.OBJECT_TYPE:
                          if (object.value[0] && object.value[0].value) values[objectId].objectType = object.value[0].value;
                          break;
                        case baEnum.PropertyIdentifier.PROPERTY_LIST:
                          if (object.value) values[objectId].propertyList = that.mapPropsToArray(object.value);
                          break;
                        case baEnum.PropertyIdentifier.SYSTEM_STATUS:
                          if (object.value[0]) {
                            values[objectId].systemStatus = that.getPROP_SYSTEM_STATUS(object.value[0].value);
                          }
                          break;
                        case baEnum.PropertyIdentifier.MODIFICATION_DATE:
                          if (object.value[0]) {
                            values[objectId].modificationDate = object.value[0].value;
                          }
                          break;
                        case baEnum.PropertyIdentifier.PROGRAM_STATE:
                          if (object.value[0]) {
                            values[objectId].programState = that.getPROP_PROGRAM_STATE(object.value[0].value);
                          }
                          break;
                        case baEnum.PropertyIdentifier.RECORD_COUNT:
                          if (object.value[0]) {
                            values[objectId].recordCount = object.value[0].value;
                          }
                          break;
                        case baEnum.PropertyIdentifier.PRIORITY_ARRAY:
                          if (object.value.length > 0) {
                            values[objectId].hasPriorityArray = true;
                          }
                          break;
                        case baEnum.PropertyIdentifier.STATE_TEXT:
                          try {
                            if (object.value) {
                              values[objectId].stateTextArray = object.value;
                              if (
                                typeof values[objectId].presentValue == "number" &&
                                values[objectId].presentValue !== null &&
                                values[objectId].presentValue !== undefined
                              ) {
                                const tempIndex = values[objectId].presentValue;
                                if (tempIndex == 0) {
                                  values[objectId].presentValue = values[objectId].stateTextArray[tempIndex].value;
                                } else if (tempIndex !== 0) {
                                  values[objectId].presentValue = values[objectId].stateTextArray[tempIndex - 1].value;
                                }
                              }
                            }
                          } catch (e) {
                            that.logOut("buildResponse STATE_TEXT error: ", e);
                          }
                          break;
                        case baEnum.PropertyIdentifier.VENDOR_NAME:
                          if (object.value) {
                            if (object.value[0].value && typeof object.value[0].value == "string") {
                              values[objectId].vendorName = object.value[0].value;
                            }
                          }
                          break;
                      }
                    }
                    if (
                      pointPropertyIndex == successfulResult.values.length - 1 &&
                      objectIndex == pointProperty.values.length - 1 &&
                      i == fullObjects.length - 1
                    ) {
                      that.networkTree[deviceKey] = values;
                      resolve(that.networkTree);
                    }
                  });
                } catch (e) {
                  that.logOut("issue resolving bacnet payload, see error:  ", e);
                  reject(e);
                }
              }
            });
          } else {
            //error found in point property
            if (i == fullObjects.length - 1) {
              that.networkTree[deviceKey] = values;
              resolve(that.networkTree);
            }
          }
        }
        that.networkTree[deviceKey] = values;
        resolve(that.networkTree);
      } catch (e) {
        reject(e);
      }
    });
  }

  mapPropsToArray(propertyList) {
    let uniquePropArray = [];
    for (let i = 0; i < propertyList.length; i++) {
      if (uniquePropArray.indexOf(propertyList[i].value) === -1) uniquePropArray.push(propertyList[i].value);
    }
    return uniquePropArray;
  }

  getPROP_PROGRAM_STATE(value) {
    switch (value) {
      case 0:
        return "0 - Idle";
      case 1:
        return "1 - Loading";
      case 2:
        return "2 - Running";
      case 3:
        return "3 - Waiting";
      case 4:
        return "4 - Halted";
      case 5:
        return "5 - Unloading";
      default:
        return "";
    }
  }

  getPROP_SYSTEM_STATUS(value) {
    switch (value) {
      case 0:
        return "0 - Operational";
      case 1:
        return "1 - Operational Readonly";
      case 2:
        return "2 - Download Required";
      case 3:
        return "3 - Download In Progress";
      case 4:
        return "4 - Non Operational";
      case 5:
        return "5 - Backup In Progress";
      default:
        return "";
    }
  }

  getPointIcon(values) {
    const objectId = values.meta.objectId.type;
    const hasPriorityArray =
      values.hasPriorityArray && values.hasOwnProperty("hasPriorityArray") ? values.hasPriorityArray : false;

    if (hasPriorityArray) {
      return "pi writePointIcon";
    } else {
      switch (objectId) {
        case 0:
          //AI
          return "pi readPointIcon";
        case 1:
          //AO
          return "pi readPointIcon";
        case 2:
          //AV
          return "pi readPointIcon";
        case 3:
          //BI
          return "pi readPointIcon";
        case 4:
          //BO
          return "pi readPointIcon";
        case 5:
          //BV
          return "pi readPointIcon";
        case 8:
          //Device
          return "pi pi-box";
        case 13:
          //MI
          return "pi readPointIcon";
        case 14:
          //MO
          return "pi readPointIcon";
        case 19:
          //MV
          return "pi readPointIcon";
        case 10:
          //File
          return "pi pi-file";
        case 16:
          //Program
          return "pi pi-database";
        case 20:
          //Trendlog
          return "pi pi-chart-line";
        case 15:
          //Notification Class
          return "pi pi-bell";
        case 56:
          return "pi pi-sitemap";
        case 178:
          return "pi pi-lock";
        case 17:
          return "pi pi-calendar";
        case 6:
          return "pi pi-calendar";
        default:
          //Return circle for all other types
          return "pi readPointIcon";
      }
    }
  }

  getObjectType(objectId) {
    switch (objectId) {
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
      case 40:
        return "CS";
      default:
        return "";
    }
  }

  getPROP_RELIABILITY(value) {
    switch (value) {
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

  getDeviceIcon(isMstp, manualDiscoveryMode) {
    if (manualDiscoveryMode == true) {
      return "pi pi-question-circle";
    } else if (manualDiscoveryMode == false) {
      if (isMstp == true) {
        return "pi pi-box";
      } else if (isMstp == false) {
        return "pi pi-server";
      }
    }
    return "pi pi-server";
  }
}

module.exports = { BacnetClient };
