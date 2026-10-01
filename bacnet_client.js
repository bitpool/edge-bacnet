/*
  MIT License Copyright 2021, 2024 - Bitpool Pty Ltd
*/

const bacnet = require("./resources/node-bacstack-ts/dist/index.js");
const baEnum = bacnet.enum;
const { EventEmitter } = require("events");
const {
  getUnit,
  roundDecimalPlaces,
  parseBacnetError,
  getBacnetErrorString,
  Read_Config_Async,
  isNumber,
  decodeBitArray,
} = require("./common");
const { ToadScheduler, SimpleIntervalJob, Task } = require("toad-scheduler");
const { BacnetDevice, ALLOWED_OBJECT_TYPES } = require("./bacnet_device");
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
    that.renderList = [];
    that.lastWhoIs = null;
    that.client = null;
    that.lastNetworkPoll = null;
    that.scheduler = new ToadScheduler();
    that.mutex = new Mutex();
    that.manualMutex = new Mutex();
    that.pollInProgress = false;
    that.buildJsonInProgress = false;
    that.cacheLoaded = false;
    that.scanMatrix = [];
    that.renderListCount = 0;
    that.portRangeMatrix = config.portRangeMatrix;
    that._requestQueue = [];           // Queue of waiting request resolvers
    that._processingQueue = false;     // Flag to prevent concurrent queue processing
    that._maxQueueSize = 10000;        // Maximum queued requests before rejecting (sized for large sites)
    // --- per-router (per-address) in-flight throttle + offline debounce ---
    that._perAddrInFlight = new Map();   // addr -> current outstanding count
    that._perAddrWaiters = new Map();    // addr -> [resolve, ...] queued waiters
    that._perRouterCap = Math.max(1, parseInt(config.perRouterCap) || 4);     // max outstanding per router IP (>=1)
    that.offlineThreshold = Math.max(1, parseInt(config.offlineThreshold) || 3); // consecutive misses before a point goes offline (>=1)

    try {
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
      that.enable_device_discovery = config.enable_device_discovery;

      that.readPropertyMultipleOptions = {
        maxSegments: 112,
        maxApdu: 5,
      };

      try {
        that.readCachedFile();

        that.client = new bacnet.Client({
          apduTimeout: config.apduTimeout,
          interface: config.localIpAdrress,
          port: config.port,
          broadcastAddress: config.broadCastAddr,
          portRangeMatrix: config.portRangeMatrix,
          maxConcurrentRequests: config.maxConcurrentRequests,
        });
        that.setMaxListeners(1);

        const task = new Task("simple task", () => {
          that.globalWhoIs();
        });

        const job = new SimpleIntervalJob({ seconds: parseInt(that.discover_polling_schedule) }, task);

        that.scheduler.addSimpleIntervalJob(job);

        //query device task
        const queryDevices = new Task("simple task", () => {
          if (!that.cacheLoaded) return;

          if (!that.pollInProgress && that.enable_device_discovery) {
            that.queryDevices();
          }

          if (!that.buildJsonInProgress && that.enable_device_discovery) {
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

        setTimeout(() => {
          that.globalWhoIs();
          setTimeout(() => {
            if (!that.pollInProgress && that.enable_device_discovery) {
              that.queryDevices();
            }

            if (!that.buildJsonInProgress && that.enable_device_discovery) {
              that.buildJsonTree();
            }
          }, "4000");
        }, "15000");
      } catch (e) {
        that.logOut("Issue initializing client: ", e);
      }

      try {
        //who is callback
        that.client.on("iAm", (device) => {
          if (device.address !== that.config.localIpAdrress) {
            // Ignore phantom/invalid device instances (null/0/NaN) — they can never enumerate and
            // only bloat the list. A genuine device always announces a valid positive instance.
            if (!that._isValidDeviceId(device.deviceId)) return;
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
    } catch (e) {
      console.log("BACnet Client client binder error: ", e);
    }
  }

  /**
   * Waits until a request slot is available (throttling).
   * Uses a queue to ensure only one waiter proceeds per available slot.
   * Rejects if the queue is full (backpressure mechanism).
   *
   * The previous implementation used a `while` loop inside `processQueue` which
   * called `nextResolve()` multiple times synchronously.  Because Promise
   * resolutions are scheduled as microtasks, none of those continuations ran
   * before the next `canSendRequest()` check — so the while-loop could release
   * dozens of waiters simultaneously even when only one slot was free.  The fix
   * is to release exactly ONE waiter per `requestComplete` event, letting the
   * microtask queue drain before the next slot check.
   */
  _waitForRequestSlot() {
    let that = this;
    return new Promise((resolve, reject) => {
      // Fast path: a slot is available right now
      if (that.client.canSendRequest()) {
        resolve();
        return;
      }

      // Backpressure: refuse to queue more work than the limit allows
      if (that._requestQueue.length >= that._maxQueueSize) {
        reject(new Error('ERR_REQUEST_QUEUE_FULL: Too many pending requests. Reduce polling frequency or increase Max Concurrent Requests.'));
        return;
      }

      // Park this request until a slot opens
      that._requestQueue.push(resolve);

      if (!that._processingQueue) {
        that._processingQueue = true;

        const processQueue = () => {
          // Release exactly ONE waiter per call.  The 'requestComplete' event
          // fires each time a slot is freed, so we will naturally be called
          // again once the released request registers its own callback in the
          // invoke store and eventually completes.
          if (that._requestQueue.length > 0 && that.client.canSendRequest()) {
            const nextResolve = that._requestQueue.shift();
            nextResolve();
          }

          if (that._requestQueue.length === 0) {
            that._processingQueue = false;
            that.client.removeListener('requestComplete', processQueue);
          }
        };

        that.client.on('requestComplete', processQueue);
      }
    });
  }

  // Cap simultaneous outstanding requests to a single device/router IP, on top of the
  // global maxConcurrentRequests. MSTP trunks are serial, so flooding one router with many
  // concurrent requests just overruns its buffer and drops responses; this protects the slow
  // trunks (and lets the global cap be raised for throughput). Acquire AFTER _waitForRequestSlot.
  _acquireAddrSlot(addr) {
    let that = this;
    const inFlight = that._perAddrInFlight.get(addr) || 0;
    if (inFlight < that._perRouterCap) {
      that._perAddrInFlight.set(addr, inFlight + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let q = that._perAddrWaiters.get(addr);
      if (!q) {
        q = [];
        that._perAddrWaiters.set(addr, q);
      }
      q.push(resolve);
    });
  }

  _releaseAddrSlot(addr) {
    let that = this;
    const q = that._perAddrWaiters.get(addr);
    if (q && q.length > 0) {
      q.shift()(); // hand the slot straight to the next waiter (count unchanged)
      if (q.length === 0) that._perAddrWaiters.delete(addr);
      return;
    }
    const inFlight = that._perAddrInFlight.get(addr) || 0;
    if (inFlight <= 1) that._perAddrInFlight.delete(addr);
    else that._perAddrInFlight.set(addr, inFlight - 1);
  }

  // Key for the per-router cap. For MSTP devices include the network number so independent
  // trunks behind ONE BACnet/IP router each get their own cap (the trunk — not the router — is
  // the serial bottleneck). Local BACnet/IP devices key by their own IP (cap never binds since
  // reads are already serial per device).
  _addrKeyFromAddress(a) {
    if (a && typeof a === "object") {
      return a.address + (a.net !== undefined && a.net !== null ? ":" + a.net : "");
    }
    return a;
  }

  _addrSlotKey(device) {
    return this._addrKeyFromAddress(device.getAddress());
  }

  // Shared timeout classifier: distinguishes a transient ERR_TIMEOUT from a definitive error.
  _isTimeoutError(err) {
    return !!err && String(err.message || err).includes("ERR_TIMEOUT");
  }

  // Gated single ReadProperty for the DISCOVERY / internal read paths: waits for a global slot
  // AND a per-router slot, then releases the per-router slot exactly once (response, timeout, or
  // synchronous throw). ALWAYS resolves {err, value} and NEVER rejects, so callers can destructure
  // without a try/catch — a saturated global queue surfaces as {err}, not a rejection (several
  // callers, e.g. the per-property Promise.all and _readDeviceName, rely on this). The per-router
  // release relies on the bacnet library always firing the callback (response OR apduTimeout), so a
  // stuck request cannot permanently hold a trunk's slot.
  async _gatedReadProperty(addressObject, objectId, property, options) {
    const addr = this._addrKeyFromAddress(addressObject.address);
    const that = this;
    try {
      await this._waitForRequestSlot();
      await this._acquireAddrSlot(addr);
    } catch (e) {
      return { err: e, value: undefined }; // gating failed (e.g. queue full) — surface as {err}, never reject
    }
    return new Promise((resolve) => {
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          that._releaseAddrSlot(addr);
        }
      };
      try {
        that.client.readProperty(addressObject, objectId, property, options, (err, value) => {
          release();
          resolve({ err, value });
        });
      } catch (e) {
        release();
        resolve({ err: e, value: undefined });
      }
    });
  }

  async readCachedFile() {
    let that = this;
    try {
      if (that.config.cacheFileEnabled) {
        const cachedData = await Read_Config_Async();
        const parsedData = JSON.parse(cachedData);
        if (parsedData && typeof parsedData == "object") {
          // renderList is no longer cached - will be rebuilt by tree builder
          // if (parsedData.renderList) that.renderList = parsedData.renderList;
          if (parsedData.deviceList) {
            parsedData.deviceList.forEach(function (device) {
              // Skip phantom entries (invalid instance id) unless they are router placeholders
              // (isDumbMstpRouter, deviceId null) which the tree builder needs for rendering.
              if (!that._isValidDeviceId(device.deviceId) && device.isDumbMstpRouter !== true) return;
              let newBacnetDevice = new BacnetDevice(true, device);
              that.deviceList.push(newBacnetDevice);
            });
            // Collapse any duplicate entries persisted in the cache from earlier sessions.
            that._dedupeDeviceList();
          }
          if (parsedData.pointList) that.networkTree = parsedData.pointList;
          // renderListCount is no longer cached - will be recalculated by tree builder
          // if (parsedData.renderListCount) that.renderListCount = parsedData.renderListCount;
        }
      }
    } finally {
      that.cacheLoaded = true;
    }
  }

  testFunction(address, port, type, instance, property, nodeWarnCallback) {
    let that = this;
    console.log("test function ");

    let addressObject = {
      address: address,
      port: port,
    };

    // Try to find the device to use device-specific options
    let device = null;
    if (type === 8) {
      // Device object - instance is the device ID
      device = that.deviceList.find(ele => ele.getDeviceId() === instance);
    } else {
      // For non-device objects, we can't determine the device from just address/instance
      // This is a limitation of testFunction's current signature
    }

    // Use device-specific options if we found the device, otherwise use safer defaults
    let readOptions;
    if (device) {
      readOptions = that.getDeviceSpecificOptions(device);
    } else {
      // Conservative defaults for unknown devices (assume small MSTP)
      readOptions = {
        maxSegments: 0,  // No segmentation
        maxApdu: 2       // 206 octets - safe for most MSTP devices
      };
    }

    const propertiesArray = [{ objectId: { type: type, instance: instance }, properties: [{ id: property }] }];

    that.client.readPropertyMultiple(addressObject, propertiesArray, readOptions, (err, value) => {
      console.log("1 - readPropertyMultiple:  ");

      console.log(value);

      if (nodeWarnCallback) {
        nodeWarnCallback(value);
      }

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
      readOptions,
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

  async getProtocolSupported(device) {
    //return protocols support for device
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    const readOptions = that.getDeviceSpecificOptions(device);

    const { err, value } = await that._gatedReadProperty(
      addressObject,
      { type: baEnum.ObjectType.DEVICE, instance: device.getDeviceId() },
      baEnum.PropertyIdentifier.PROTOCOL_SERVICES_SUPPORTED,
      readOptions
    );
    if (err) throw err;
    return value;
  }

  addToParentMstpNetwork(device) {
    let that = this;
    let address = device.getAddress().address;
    let deviceId = device.getDeviceId();
    let foundParentIndex = that.deviceList.findIndex((ele) => that.getDeviceAddress(ele) == address && !ele.getIsMstpDevice());
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

      // Flat sequential walk. The previous recursive version advanced with
      // `index++; await query(index)` inside catch blocks WITHOUT returning, so a
      // failing device re-walked the remaining list (2^m traversals) and any escaped
      // throw left pollInProgress stuck true, permanently disabling polling until a
      // restart. A for-loop + try/finally fixes both.
      for (let index = 0; index < that.deviceList.length; index++) {
        let device = that.deviceList[index];
        if (typeof device !== "object") continue;
        if (device.getIsDumbMstpRouter() === true) continue;
        if (!that._isValidDeviceId(device.getDeviceId())) continue; // never scan a phantom/invalid id

        try {
          if (device.getIsProtocolServicesSet() == false) {
            try {
              let result = await that.getProtocolSupported(device);
              let decodedValues = decodeBitArray(8, result.values[0].originalBitString.value);
              device.setProtocolServicesSupported(decodedValues);
            } catch (error) {
              that.logOut("getProtocolSupported error: ", error);
              continue; // skip this device this cycle; retried next cycle (isProtocolServicesSet stays false)
            }
          }

          // Re-enumeration gate. Re-walking every device's full OBJECT_LIST every cycle is what
          // starves discovery on large sites — the sweep never reaches the un-enumerated tail. A
          // device that has ALREADY produced points and was refreshed within RESCAN_MS is skipped
          // here (its points persist and still get polled by buildJsonTree); devices that have
          // never enumerated (no timestamp) are (re)tried every cycle so the tail is prioritised.
          // Object lists change rarely, so the slow re-scan is safe; a manual rediscover forces it.
          const enumTs = device.getPointListUpdateTS ? device.getPointListUpdateTS() : null;
          const RESCAN_MS = Math.max(6 * 3600 * 1000, (parseInt(that.device_read_schedule) || 900) * 1000 * 8);
          if (enumTs && Date.now() - enumTs < RESCAN_MS) {
            continue; // already enumerated recently — free discovery to reach un-enumerated devices
          }

          await that.updateDeviceName(device);

          device._enumComplete = false; // set by getDevicePointList / scanDeviceManually below

          if (device.getSegmentation() !== 3) {
            // Try the whole-list OBJECT_LIST read first.
            let ok = false;
            let definitiveFailure = false;
            try {
              const result = await that.getDevicePointList(device);
              ok = Array.isArray(result) && result.length > 1; // got a real list (not just the device object)
            } catch (e) {
              that.logOut(`getDevicePointList (whole) failed for ${device.getDeviceId ? device.getDeviceId() : ""}: `, e);
              definitiveFailure = !that._isTimeoutError(e); // a non-timeout error (e.g. seg-not-supported abort) is real
            }
            if (!ok) {
              // #53: whole-list read didn't yield a usable list -> fall back to the per-index scan.
              // Only PIN the device to the slow path (setSegmentation 3) on a DEFINITIVE failure — a
              // single dropped datagram (timeout) or a genuinely short list must NOT downgrade a
              // segmentation-capable device (it retries the fast whole-list read next cycle).
              that.logOut(`Falling back to per-index OBJECT_LIST scan for device ${device.getDeviceId ? device.getDeviceId() : ""}`);
              if (definitiveFailure) device.setSegmentation(3);
              await that.getDevicePointListWithoutObjectList(device);
            }
          } else {
            await that.getDevicePointListWithoutObjectList(device);
          }

          // Stamp enumeration time ONLY once the device has real (non device-object) points AND
          // the enumeration was COMPLETE (whole-list read, or a per-index walk that reached a
          // definitive end with no retry-exhausted gaps). A partial walk (transient miss on a
          // flaky trunk) is left unstamped so the gate retries it next cycle until it fully
          // enumerates — otherwise the missed points would lock out for the full RESCAN_MS.
          const realPts = (device.getPointsList() || []).filter((p) => p && p.value && p.value.type !== 8);
          if (realPts.length > 0 && device._enumComplete === true) device.setPointListUpdateTS(Date.now());
        } catch (e) {
          that.logOut(`Error while querying device ${device.getDeviceId ? device.getDeviceId() : ""}: `, e);
          // continue to next device
        }
      }
    } catch (e) {
      that.logOut("Error while querying devices: ", e);
    } finally {
      that.pollInProgress = false; // ALWAYS clear, even on an escaped throw
    }
  }

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
    that.enable_device_discovery = config.enable_device_discovery;

    if (that.scheduler !== null) {
      that.scheduler.stop();
    }

    try {
      that.client._settings.apduTimeout = config.apduTimeout;
      // maxConcurrentRequests was previously only applied at construction, so changing it
      // required a full Node-RED restart. canSendRequest() reads _settings live, so patching
      // it here makes it take effect on Deploy (same as apduTimeout).
      // config.maxConcurrentRequests is already clamped to [1,250] by BacnetClientConfig (common.js),
      // so assign it directly like the other live settings above.
      that.client._settings.maxConcurrentRequests = config.maxConcurrentRequests;
      that.client._settings.interface = config.localIpAdrress;
      that.client._settings.port = config.port;
      that.client._settings.broadcastAddress = config.broadCastAddr;
      // NOTE: portRangeMatrix is NOT live-patchable here — the transport binds a UDP socket
      // per port at construction; changing ports still needs a restart / transport rebuild.

      // Re-read app-layer tunables so a Deploy applies them (not just a restart).
      that.deviceRetryCount = parseInt(config.retries);
      that._perRouterCap = Math.max(1, parseInt(config.perRouterCap) || 4);
      that.offlineThreshold = Math.max(1, parseInt(config.offlineThreshold) || 3);

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
        if (!that.cacheLoaded) return;

        if (!that.pollInProgress && that.enable_device_discovery) {
          that.queryDevices();
        }

        if (!that.buildJsonInProgress && that.enable_device_discovery) {
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

  // A valid BACnet device instance is an integer in 0..4194302 (ASHRAE 135: 0 is spec-legal and
  // addressable; 4194303 = 0x3FFFFF is the reserved "uninitialized/wildcard" value, never a real
  // device). Phantom entries (null / NaN / negative / the wildcard) fail this — they can only ever
  // error on read, so they must never enter the device list or be scanned.
  _isValidDeviceId(id) {
    const n = typeof id === "string" ? parseInt(id, 10) : id;
    return Number.isInteger(n) && n >= 0 && n <= 4194302;
  }

  // Collapse duplicate deviceList entries that share the same IP+deviceId key. Duplicates
  // accumulate over time (per-cycle re-adds / overlapping tree builds) and bloat the datamodel,
  // waste discovery, and split a device's children across stale copies. Merge conservatively:
  // keep the copy with the most points, take the freshest lastSeen, and union childDevices.
  // Purely removes redundancy (never adds work or wire traffic) so it cannot regress throughput.
  // Returns the number of entries removed.
  _dedupeDeviceList() {
    let that = this;
    if (!Array.isArray(that.deviceList) || that.deviceList.length === 0) return 0;
    const byKey = new Map();
    const order = [];
    for (const device of that.deviceList) {
      if (typeof device !== "object" || device === null) continue;
      const key = that.createDeviceKey(device);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, device);
        order.push(key);
      } else {
        // Merge: survivor = the more complete copy (most points). Keep freshest lastSeen and the
        // union of child device ids so no children are lost when a stale copy is dropped.
        const survivor = (device.getPointsList() || []).length > (existing.getPointsList() || []).length ? device : existing;
        const dropped = survivor === existing ? device : existing;
        const ls = Math.max(survivor.getLastSeen() || 0, dropped.getLastSeen() || 0);
        if (ls) survivor.setLastSeen(ls);
        const kids = new Set([...(survivor.childDevices || []), ...(dropped.childDevices || [])]);
        survivor.childDevices = [...kids];
        // Preserve a parent link if the survivor lost it — the merge must NEVER drop parentDeviceId
        // (doing so would orphan an MSTP child under a bare-IP stub instead of its named router).
        if (
          (survivor.getParentDeviceId() === null || survivor.getParentDeviceId() === undefined) &&
          dropped.getParentDeviceId() !== null &&
          dropped.getParentDeviceId() !== undefined
        ) {
          survivor.setParentDeviceId(dropped.getParentDeviceId());
        }
        // Preserve any points that exist ONLY on the dropped copy so the survivor is a true
        // superset — a device must never lose points to a merge. setPointsList de-dups by
        // type+instance and re-applies the whitelist, and issues zero wire traffic.
        const droppedPts = dropped.getPointsList() || [];
        if (droppedPts.length > 0) survivor.setPointsList(droppedPts);
        byKey.set(key, survivor);
      }
    }
    const deduped = order.map((k) => byKey.get(k));
    const removed = that.deviceList.length - deduped.length;
    if (removed > 0) {
      that.deviceList = deduped;
      that.logOut(`_dedupeDeviceList: collapsed ${removed} duplicate device entr${removed === 1 ? "y" : "ies"}`);
    }
    return removed;
  }

  // Repair MSTP children that never got linked to a parent (parentDeviceId null) and remove the
  // redundant bare-IP placeholder folders they caused. Without this, the tree builder drops an
  // orphaned child under a bare-<IP> stub (addEmptyIpRootDevice) instead of nesting it under its
  // real named router — the "device shows as its IP with no points" symptom. Re-running discovery
  // never fixes it because nothing re-links the child. This is pure in-memory relinking/cleanup:
  // no wire traffic, no cadence change, so it cannot regress throughput.
  _repairOrphanParents() {
    let that = this;
    try {
      if (!Array.isArray(that.deviceList) || that.deviceList.length === 0) return;
      // Index the real (non-MSTP, valid-id) device at each IP — the router a child should nest under.
      const rootByIp = new Map();
      for (const d of that.deviceList) {
        if (d && typeof d.getIsMstpDevice === "function" && !d.getIsMstpDevice() && that._isValidDeviceId(d.getDeviceId())) {
          const ip = that.getDeviceAddress(d);
          if (!rootByIp.has(ip)) rootByIp.set(ip, d); // first-write-wins, matching addToParentMstpNetwork's findIndex
        }
      }
      // 1) Re-link orphaned MSTP children to the real router at their IP.
      let relinked = 0;
      for (const d of that.deviceList) {
        if (!d || typeof d.getIsMstpDevice !== "function" || !d.getIsMstpDevice()) continue;
        const pid = d.getParentDeviceId();
        if (pid !== null && pid !== undefined && pid !== 0) continue; // already linked
        const root = rootByIp.get(that.getDeviceAddress(d));
        if (root && root.getDeviceId() !== d.getDeviceId()) {
          d.setParentDeviceId(root.getDeviceId());
          root.addChildDevice(d.getDeviceId());
          relinked++;
        }
      }
      // 2) Prune redundant bare-IP stubs (deviceId null) at IPs now covered by a real device. Their
      //    children were just re-linked to the real router and will re-nest on this build pass.
      let pruned = 0;
      const prunedIps = new Set();
      that.deviceList = that.deviceList.filter((d) => {
        if (d && typeof d.getDeviceId === "function" && d.getDeviceId() === null) {
          const ip = that.getDeviceAddress(d);
          if (rootByIp.has(ip)) {
            const key = that.createDeviceKey(d);
            if (that.networkTree && that.networkTree[key]) delete that.networkTree[key];
            prunedIps.add(ip);
            pruned++;
            return false; // drop the redundant stub
          }
        }
        return true;
      });
      // Single pass over renderList to drop the pruned stubs' folder entries.
      if (prunedIps.size > 0 && Array.isArray(that.renderList)) {
        that.renderList = that.renderList.filter(
          (r) => !(r && (r.deviceId === null || r.deviceId === undefined) && prunedIps.has(r.ipAddr))
        );
      }
      if (relinked > 0 || pruned > 0) {
        that.logOut(`_repairOrphanParents: relinked ${relinked} orphaned MSTP child device(s), pruned ${pruned} redundant IP-stub folder(s)`);
      }
    } catch (e) {
      that.logOut("_repairOrphanParents error: ", e);
    }
  }

  async doRead(readConfig, outputType, objectPropertyType, readNodeName) {
    const that = this;
    const roundDecimal = readConfig.precision;
    const devicesToRead = Object.keys(readConfig.pointsToRead);
    let completedDevices = 0;

    try {
      // Create array of device processing promises
      const devicePromises = devicesToRead.map(async (key, deviceIndex) => {
        const device = that.findDeviceByKey(key);
        if (!device) return null;
        device._deadReadStreak = 0; // reset the per-cycle circuit-breaker streak for this device

        const deviceName = that.computeDeviceName(device);
        const deviceKey = that.createDeviceKey(device);
        const deviceObject = that.networkTree[deviceKey];
        const maxObjectCount = that.estimateMaxObjectSize(device.getMaxApdu());

        const bacnetResults = {};
        bacnetResults[deviceName] = {};

        // Process points for the current device
        const pointsToRead = readConfig.pointsToRead[key];
        const pointNames = Object.keys(pointsToRead);
        let totalPoints = pointNames.length - 1;
        let requestArray = [];

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
          if (requestArray.length === maxObjectCount || i === pointNames.length - 1) {
            if (device.getProtocolServiceSupport("ReadPropertyMultiple") == true) {
              await that.processBatch(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            } else {
              await that.processIndividualPoints(device, requestArray, deviceName, bacnetResults, that, roundDecimal);
            }

            requestArray = [];
          }
        }

        // Return results for this device
        return {
          deviceName,
          results: bacnetResults,
          deviceIndex: deviceIndex + 1,
          totalDevices: devicesToRead.length,
        };
      });

      // Process all devices in parallel and emit results as they complete
      const results = await Promise.allSettled(devicePromises);

      results.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          completedDevices++;
          const { deviceName, results: bacnetResults, deviceIndex, totalDevices } = result.value;

          // Emit the `values` event for this device immediately
          that.emit("values", bacnetResults, outputType, objectPropertyType, readNodeName, completedDevices, totalDevices);
        } else {
          // Handle failed device (offline/error)
          completedDevices++;
          that.logOut(`Device ${devicesToRead[index]} failed:`, result.reason);
        }
      });
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

      device.setLastSeen(Date.now()); // batch answered -> device is online (device-dot fix)
      device._deadReadStreak = 0; // batch answered -> device is alive; reset circuit-breaker

      // Process the results of the batch
      results.value.values.forEach((pointResult, index) => {
        const cacheRef = requestArray[index];
        const pointRef = cacheRef.pointRef;
        const pointNameRef = cacheRef.pointName;

        if (pointResult.values[0].value.length > 0) {
          const val = pointResult.values[0].value[0].value;

          if (isNumber(val)) {
            pointRef.presentValue = roundDecimalPlaces(val, roundDecimal);
            that._markPointOnline(pointRef);
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
              that._markPointOnline(pointRef);
            } else if (val.errorClass && val.errorClass) {
              pointRef.error = getBacnetErrorString(val.errorClass, val.errorClass);
              pointRef.status = "offline";
              pointRef.missCount = 0;
              pointRef.stale = false;
            } else {
              that._markPointOnline(pointRef);
            }
          }
        }
        pointRef.meta["device"] = deviceMetaInfo;
        pointRef.timestamp = Date.now();

        // Store the point data in results
        bacnetResults[deviceName][pointNameRef] = pointRef;
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

    // Route reads through the retry wrapper using the configured "Number of Retries"
    // (deviceRetryCount). It fires only on failure, so a healthy device sees no change.
    const retries = Number.isFinite(that.deviceRetryCount) ? that.deviceRetryCount : 2;
    // Per-device circuit breaker for THIS cycle. The streak is stored ON THE DEVICE (reset once
    // per cycle in doRead, and on any success) so it spans ALL of the device's point chunks —
    // not just this batch — and actually bounds a dead device (small-APDU devices are read in
    // tiny chunks). Once a device fails this many reads in a row, skip its remaining points
    // (still recorded as debounced misses).
    const CIRCUIT_BREAK = 10;

    for (const request of requestArray) {
      const { objectId, pointRef, pointName } = request;

      if ((device._deadReadStreak || 0) >= CIRCUIT_BREAK) {
        // Device looks dead this cycle — skip the read, record a (debounced) miss.
        pointRef.meta["device"] = deviceMetaInfo;
        that._recordPointMiss(pointRef, null);
        bacnetResults[deviceName][pointName] = pointRef;
        continue;
      }

      try {
        const result = await that.updatePointWithRetry(device, pointRef, retries);

        if (result.objectId.type == objectId.type && result.objectId.instance == objectId.instance) {
          const val = result.values[0].value;

          if (isNumber(val)) {
            pointRef.presentValue = roundDecimalPlaces(val, roundDecimal);
            that._markPointOnline(pointRef);

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
              that._markPointOnline(pointRef);
            } else if (val.errorClass && val.errorClass) {
              // Definitive per-property BACnet error (device answered) — not a transient miss.
              pointRef.error = getBacnetErrorString(val.errorClass, val.errorClass);
              pointRef.status = "offline";
              pointRef.missCount = 0;
              pointRef.stale = false;
            } else {
              that._markPointOnline(pointRef);
            }
          }

          pointRef.meta["device"] = deviceMetaInfo;
          pointRef.timestamp = Date.now();
          device.setLastSeen(Date.now()); // a device answering value reads IS online (device-dot fix)
          device._deadReadStreak = 0;

          // Store the point data in results
          bacnetResults[deviceName][pointName] = pointRef;
        }
      } catch (err) {
        that.logOut(`Error updating point ${pointName}:`, err);
        device._deadReadStreak = (device._deadReadStreak || 0) + 1;

        // Device-dot liveness: an Error/Abort/Reject PDU IS a response — the device is provably
        // alive even though this point read failed. Only a genuine ERR_TIMEOUT (no reply) leaves
        // lastSeen untouched so a truly dead device still goes red. This keeps devices that answer
        // Who-Is but whose point reads all error (segmentation/RPM-unsupported/unknown-property)
        // from falling off the tree on the 900s Who-Is boundary. Point status is unaffected.
        if (!that._isTimeoutError(err)) device.setLastSeen(Date.now());

        pointRef.meta["device"] = deviceMetaInfo;
        that._recordPointMiss(pointRef, err);
        bacnetResults[deviceName][pointName] = pointRef;
      }
    }
  }

  // Mark a point online and reset its debounce/stale state. Used at every success site in
  // both processBatch and processIndividualPoints so a point that recovers via any path
  // clears its miss counter (missing one site silently breaks the consecutive-miss debounce).
  _markPointOnline(pointRef) {
    pointRef.error = "none";
    pointRef.status = "online";
    pointRef.missCount = 0;
    pointRef.stale = false;
  }

  // Consecutive-miss debounce: only flip a point offline after offlineThreshold consecutive
  // failed reads; until then keep the last-known value/status/timestamp and flag it stale.
  // Passing err === null means the read was skipped by the circuit breaker (still a miss).
  _recordPointMiss(pointRef, err) {
    pointRef.missCount = (pointRef.missCount || 0) + 1;
    if (pointRef.missCount >= this.offlineThreshold) {
      pointRef.status = "offline";
      pointRef.error = err ? parseBacnetError(err) : "no response";
      pointRef.stale = false;
      pointRef.timestamp = Date.now(); // definitive result -> fresh timestamp
    } else {
      // Transient miss: keep last-known value, status AND timestamp; only flag stale.
      // Do NOT refresh the timestamp — a historian must never get an OLD value with a NEW time.
      pointRef.stale = true;
    }
  }

  async updateManyPoints(device, points) {
    try {
      // Use device-specific options instead of global options
      const deviceOptions = this.getDeviceSpecificOptions(device);
      const results = await this._readObjectWithRequestArray(device, points, deviceOptions);
      return results;
    } catch (error) {
      throw error;
    }
  }

  getDeviceSpecificOptions(device) {
    let maxSegments = this.readPropertyMultipleOptions.maxSegments;
    let maxApdu = this.readPropertyMultipleOptions.maxApdu;

    // Adjust for devices with no segmentation support
    if (device.getSegmentation() == 3) {
      maxSegments = 0;
    }

    // Adjust maxApdu based on device capability
    const deviceMaxApdu = device.getMaxApdu();
    if (deviceMaxApdu <= 50) {
      maxApdu = 0; // 50 octets
    } else if (deviceMaxApdu <= 128) {
      maxApdu = 1; // 128 octets  
    } else if (deviceMaxApdu <= 206) {
      maxApdu = 2; // 206 octets
    } else if (deviceMaxApdu <= 480) {
      maxApdu = 3; // 480 octets
    } else if (deviceMaxApdu <= 1024) {
      maxApdu = 4; // 1024 octets
    } else {
      maxApdu = 5; // 1476 octets
    }

    return {
      maxSegments: maxSegments,
      maxApdu: maxApdu
    };
  }

  updatePointWithRetry(device, point, retryCount = 1) {
    let that = this;
    // Small backoff between attempts so retries don't pile straight back onto a congested trunk.
    const backoff = (attempt) => new Promise((r) => setTimeout(r, Math.min(500, 150 * attempt)));
    const tryUpdate = (retriesLeft, attempt) => {
      return that.updatePoint(device, point).catch(async (err) => {
        if (retriesLeft > 0) {
          await backoff(attempt);
          return tryUpdate(retriesLeft - 1, attempt + 1);
        }
        // Exhausted; reject with the original error. The caller (processIndividualPoints)
        // logs it and applies the consecutive-miss debounce, so we don't log per-retry here.
        return Promise.reject(err);
      });
    };

    return tryUpdate(retryCount, 1);
  }

  //used for manual point updates in the UI tree
  async updateIndividualPoint(deviceKey, pointKey) {
    let that = this;
    try {
      let device = that.deviceList.find((ele) => ele.getDeviceId() == deviceKey.split("-")[1]);
      const pointType = parseInt(pointKey.split(":")[0]);
      const pointInstance = parseInt(pointKey.split(":")[1]);
      const promiseArray = [];
      const result = await that._readObjectFull(device, pointType, pointInstance);

      if (!result.error) {
        device.setLastSeen(Date.now());
        if (result.length > 0 && Array.isArray(result)) {
          promiseArray.push(...result);
        } else {
          promiseArray.push(result);
        }
      }

      await that.buildNetworkModel(promiseArray, device);

      return true;
    } catch (e) {
      throw e;
    }
  }

  //used in the doRead querying work flow
  async updatePoint(device, point) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };

    // Use device-specific options
    const settings = that.getDeviceSpecificOptions(device);
    const addr = that._addrSlotKey(device);

    // Wait for a global slot, then a per-router slot, before proceeding.
    await that._waitForRequestSlot();
    await that._acquireAddrSlot(addr);

    return new Promise((resolve, reject) => {
      // Release the router slot exactly once on ANY outcome — response, ERR_TIMEOUT, or a
      // synchronous throw from readProperty (the library registers its callback only AFTER the
      // synchronous encode+send, so a throw there would never fire it and would leak the slot ->
      // after perRouterCap throws the router deadlocks). released-guard makes release idempotent.
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          that._releaseAddrSlot(addr);
        }
      };
      try {
        that.client.readProperty(
          addressObject,
          { type: point.meta.objectId.type, instance: point.meta.objectId.instance },
          baEnum.PropertyIdentifier.PRESENT_VALUE,
          settings,
          (err, value) => {
            release();
            if (err) return reject(err);
            if (value) return resolve(value);
            return reject(new Error("ERR_EMPTY_RESPONSE"));
          }
        );
      } catch (e) {
        release();
        reject(e);
      }
    });
  }

  estimateMaxObjectSize(apduSize) {
    // Be more conservative for very small MSTP devices
    if (apduSize <= 50) {
      return 1;  // Only 1 object at a time for 50-byte devices
    } else if (apduSize <= 128) {
      return 3;  // 3 objects for 128-byte devices
    } else if (apduSize <= 206) {
      return 5;  // 5 objects for 206-byte devices
    } else if (apduSize < 500) {
      return 10; // Reduced from 20 for safety
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
        // Settle EXACTLY once on every callback path — an err/result pair that is both falsy
        // must not leave this promise (and its awaiter, updateDeviceName) hung forever.
        if (err) {
          reject(err);
          return;
        }
        try {
          if (result && result.values && result.values[0] && result.values[0].value) {
            resolve({
              name: result.values[0].value,
              devicePointEntry: [{ value: { type: 8, instance: device.getDeviceId() }, type: 12 }],
            });
          } else {
            that.logOut("Issue with deviceName payload, see object: ", result);
            resolve(); // no usable name, but SETTLE (don't hang)
          }
        } catch (e) {
          that.logOut("Unable to get device name: ", e);
          reject(e);
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
        // The whole-list (segmented) read is atomic — a returned list is the COMPLETE object list.
        device._enumComplete = true;
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

  // Read a device's OBJECT_LIST element-by-element (for devices that can't return the whole
  // list in one segmented read). #50 fix: read OBJECT_LIST[0] (the element count) first so we
  // know how many to expect, retry transient timeouts, and only stop on a DEFINITIVE error —
  // so a single dropped datagram no longer silently truncates the point list. Gated per-router.
  scanDeviceManually(device) {
    let that = this;
    return new Promise(async function (resolve) {
      // discoveredPointList must be reachable from the catch, so declare it before the try.
      // Everything else (device getters, options) goes INSIDE the try so a throwing getter
      // still settles the promise instead of leaving it (and the caller) hung forever.
      const discoveredPointList = [];
      try {
        const deviceId = device.getDeviceId();
        const addressObject = { address: device.getAddress(), port: device.getPort() };
        const baseOptions = that.getDeviceSpecificOptions(device);
        const objId = { type: baEnum.ObjectType.DEVICE, instance: deviceId };
        const MAX_INDEX = 10000; // safety bound

        const readIndex = (idx) =>
          that._gatedReadProperty(
            addressObject,
            objId,
            baEnum.PropertyIdentifier.OBJECT_LIST,
            Object.assign({}, baseOptions, { arrayIndex: idx })
          );

        // Read one array index, retrying transient timeouts up to 2 extra times.
        // Returns { entry } on success, { end:true } on a definitive (non-timeout) error, {} if it kept timing out.
        const readWithRetry = async (idx) => {
          for (let attempt = 0; attempt <= 2; attempt++) {
            const { err, value } = await readIndex(idx);
            if (!err && value && value.values && value.values[0] !== undefined) {
              return { entry: value.values[0] };
            }
            if (err && !that._isTimeoutError(err)) return { end: true };
          }
          return {};
        };

        // 1) Element count from OBJECT_LIST[0].
        let count = null;
        for (let attempt = 0; attempt <= 2 && count === null; attempt++) {
          const { err, value } = await readIndex(0);
          if (!err && value && value.values && value.values[0] && typeof value.values[0].value === "number") {
            count = value.values[0].value;
          } else if (err && !that._isTimeoutError(err)) {
            break; // device won't give a count (not a timeout) -> degraded walk below
          }
        }

        if (count !== null) {
          const n = Math.min(count, MAX_INDEX);
          let missedIndex = false; // an index that exhausted its retries (transient gap)
          for (let i = 1; i <= n; i++) {
            const r = await readWithRetry(i);
            if (r.entry !== undefined) discoveredPointList.push(r.entry);
            else if (r.end) break; // array shrank / definitive end -> a complete walk
            else missedIndex = true; // kept timing out: skip this index but keep going (don't truncate)
          }
          if (discoveredPointList.length < n) {
            that.logOut(
              `scanDeviceManually: device ${deviceId} got ${discoveredPointList.length}/${count} OBJECT_LIST entries (some reads failed)`
            );
          }
          // Complete only if no index was skipped due to exhausted retries — a partial walk must
          // NOT be stamped/gated (queryDevices reads this) or the missed points lock out for hours.
          device._enumComplete = !missedIndex;
          resolve(discoveredPointList);
          return;
        }

        // 2) Degraded fallback: no count -> walk until a DEFINITIVE error (past end of array),
        // retrying transient timeouts so a dropped datagram doesn't cut the list short.
        let endedDefinitively = false;
        for (let i = 1; i <= MAX_INDEX; i++) {
          const r = await readWithRetry(i);
          if (r.entry !== undefined) discoveredPointList.push(r.entry);
          else if (r.end) {
            endedDefinitively = true;
            break; // definitive end-of-array -> complete
          } else break; // exhausted retries -> stop, but this is an INCOMPLETE walk
        }
        device._enumComplete = endedDefinitively;
        resolve(discoveredPointList);
      } catch (e) {
        that.logOut("scanDeviceManually error: ", e);
        device._enumComplete = false;
        resolve(discoveredPointList);
      }
    });
  }

  async _readObjectWithRequestArray(device, requestArray, readOptions) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    const addr = that._addrSlotKey(device);

    // Wait for a global slot, then a per-router slot, before proceeding.
    await that._waitForRequestSlot();
    await that._acquireAddrSlot(addr);

    return new Promise((resolve) => {
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          that._releaseAddrSlot(addr);
        }
      };
      try {
        that.client.readPropertyMultiple(addressObject, requestArray, readOptions, (error, value) => {
          release();
          if (value && value.values) {
            const reorderedValues = requestArray.map((req) => {
              const foundValue = value.values.find(
                (val) => val.objectId.type === req.objectId.type && val.objectId.instance === req.objectId.instance
              );
              return (
                foundValue || {
                  objectId: req.objectId,
                  values: [
                    {
                      value: [
                        {
                          value: {
                            errorClass: baEnum.ErrorClass.PROPERTY,
                            errorCode: baEnum.ErrorCode.UNKNOWN_PROPERTY,
                          },
                        },
                      ],
                    },
                  ],
                }
              );
            });
            value.values = reorderedValues;
          }

          resolve({
            error: error,
            value: value,
          });
        });
      } catch (e) {
        // Synchronous throw before the library registered its callback: release the slot and
        // preserve the {error, value} contract (the caller checks results.error).
        release();
        resolve({ error: e, value: null });
      }
    });
  }

  async _readDeviceName(device, callback) {
    let that = this;

    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    let deviceId = device.getDeviceId();
    const readOptions = that.getDeviceSpecificOptions(device);

    try {
      const { err, value } = await that._gatedReadProperty(
        addressObject,
        { type: baEnum.ObjectType.DEVICE, instance: deviceId },
        baEnum.PropertyIdentifier.OBJECT_NAME,
        readOptions
      );
      callback(err, value);
    } catch (e) {
      that.logOut("Error reading device name: ", e);
      callback(e, undefined);
    }
  }

  async _readObjectList(device, readOptions, callback) {
    let that = this;
    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };
    let deviceId = device.getDeviceId();
    try {
      // Gated (global + per-router). Previously this whole-list read had no throttle at all.
      const { err, value } = await that._gatedReadProperty(
        addressObject,
        { type: baEnum.ObjectType.DEVICE, instance: deviceId },
        baEnum.PropertyIdentifier.OBJECT_LIST,
        readOptions
      );
      callback(err, value);
    } catch (e) {
      that.logOut("Error reading object list:  ", e);
      callback(e, undefined);
    }
  }

  async _readObject(addressObject, type, instance, properties, readOptions) {
    let that = this;
    const addr = that._addrKeyFromAddress(addressObject.address);

    // Wait for a global slot, then a per-router slot. Never reject — surface a gating failure
    // (e.g. queue full) as {error} so callers' .then/{error} handling stays intact.
    try {
      await that._waitForRequestSlot();
      await that._acquireAddrSlot(addr);
    } catch (e) {
      return { error: e, value: null };
    }

    return new Promise((resolve) => {
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          that._releaseAddrSlot(addr);
        }
      };
      const requestArray = [
        {
          objectId: { type: type, instance: instance },
          properties: properties,
        },
      ];
      try {
        that.client.readPropertyMultiple(addressObject, requestArray, readOptions, (error, value) => {
          release();
          resolve({
            error: error,
            value: value,
          });
        });
      } catch (e) {
        release();
        resolve({ error: e, value: null });
      }
    });
  }

  _readObjectFull(device, type, instance) {
    const that = this;
    // Use device-specific options for reading all properties
    const readOptions = that.getDeviceSpecificOptions(device);

    const readIndividualPropsOptions = {
      maxSegments: 0,
      maxApdu: readOptions.maxApdu, // #55: use the 0-5 max-APDU enum (from getDeviceSpecificOptions), NOT the raw octet count
    };

    let addressObject = {
      address: device.getAddress(),
      port: device.getPort(),
    };

    // Define default properties for non-device objects
    const defaultProperties = [
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

    // Use device-specific properties for type 8, otherwise use default
    const propertiesToRead = type === 8 ? BacnetDevice.getDeviceObjectProperties() : defaultProperties;

    // Function to read properties individually
    const readPropertiesIndividually = (resolve, reject) => {
      // Per-property reads now go through the gated helper (global + per-router slot) instead of
      // firing all ~12 at once ungated — that was a big part of the discovery flood on a trunk.
      const promises = propertiesToRead.map((property) =>
        that
          ._gatedReadProperty(addressObject, { type: type, instance: instance }, property.id, readIndividualPropsOptions)
          .then(({ err, value }) => {
            if (err || !value) return null;
            return {
              id: property.id,
              index: value.property ? value.property.index : undefined,
              value: value.values,
            };
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

    // Targeted middle tier: request the needed properties in ONE ReadPropertyMultiple.
    // Used when ALL is rejected (e.g. RC FlexOne / small MSTP that don't support reading
    // the ALL pseudo-property). Same property set as the per-property fallback, so stored
    // data is identical - just one request instead of ~12. Falls through to the
    // per-property reads only if this targeted read also fails.
    const readTargetedMultiple = (resolve, reject) => {
      that
        ._readObject(addressObject, type, instance, propertiesToRead, readOptions)
        .then((result) => {
          if (result.value && that._responseHasUsableName(result.value)) {
            resolve(result);
          } else {
            readPropertiesIndividually(resolve, reject);
          }
        })
        .catch(() => {
          readPropertiesIndividually(resolve, reject);
        });
    };

    return new Promise((resolve, reject) => {
      // For Device objects (type 8), skip ALL attempt - many MSTP devices don't support it
      // Go straight to reading individual properties for better reliability
      if (type === 8) {
        readPropertiesIndividually(resolve, reject);
        return;
      }

      // For other object types, try to read all properties at once first
      that
        ._readObject(addressObject, type, instance, [{ id: baEnum.PropertyIdentifier.ALL }], readOptions)
        .then((result) => {
          if (result.value && that._responseHasUsableName(result.value)) {
            // ALL returned genuinely usable data (has OBJECT_NAME) - resolve
            resolve(result);
          } else {
            // ALL returned no value, OR an ACK carrying only per-property errors
            // (device doesn't support the ALL pseudo-property) - fall back to the
            // targeted multi-property RPM before the per-property storm.
            readTargetedMultiple(resolve, reject);
          }
        })
        .catch(() => {
          // ALL errored - try the targeted multi-property RPM before falling back
          // to the per-property storm.
          readTargetedMultiple(resolve, reject);
        });
    });
  }

  _readObjectLite(device, type, instance) {
    const that = this;
    // Use device-specific options
    const readOptions = that.getDeviceSpecificOptions(device);

    const readIndividualPropsOptions = {
      maxSegments: 0,
      maxApdu: readOptions.maxApdu, // #55: use the 0-5 max-APDU enum (from getDeviceSpecificOptions), NOT the raw octet count
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
          if (result.value && that._responseHasUsableName(result.value)) {
            // Response has a usable OBJECT_NAME - resolve
            resolve(result);
          } else {
            // No value, or an error-only ACK with no OBJECT_NAME - read individually
            readPropertiesIndividually();
          }
        })
        .catch(() => {
          // On error, proceed to read individual properties
          readPropertiesIndividually();
        });

      // Function to read properties individually
      const readPropertiesIndividually = () => {
        const promises = allProperties.map((property) =>
          that
            ._gatedReadProperty(addressObject, { type: type, instance: instance }, property.id, readIndividualPropsOptions)
            .then(({ err, value }) => {
              if (err || !value) return null;
              return {
                id: property.id,
                index: value.property ? value.property.index : undefined,
                value: value.values,
              };
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

        let objectType = point.meta.objectId.type;
        let resolvedAppTag = that._resolveAppTag(objectType, options.appTag);
        let resolvedValue = that._coerceWriteValue(value, resolvedAppTag);

        let writeObject = {
          address: addressObject,
          objectId: {
            type: objectType,
            instance: point.meta.objectId.instance,
          },
          values: {
            property: {
              id: 85,
              index: point.meta.arrayIndex,
            },
            value: [
              {
                type: resolvedAppTag,
                value: resolvedValue,
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
              let objType = that.getObjectType(point.objectId.type) || point.objectId.type;
              that.logOut("writeProperty error for " + objType + ":" + point.objectId.instance + " - ", err);
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

  // A ReadPropertyMultiple(ALL) response can decode to a truthy value even when the
  // device answered with a per-property error (i.e. it doesn't support the ALL
  // pseudo-property). Such a response carries no usable OBJECT_NAME, so buildNetworkModel
  // would drop every object. Use this to decide whether an ALL/lite result is genuinely
  // usable before accepting it; if not, callers fall back to the targeted RPM / per-property
  // tiers. Mirrors buildNetworkModel's own name check (non-empty string).
  _responseHasUsableName(value) {
    try {
      if (!value || !Array.isArray(value.values)) return false;
      return value.values.some((rec) => {
        const name = this._findValueById(rec && rec.values ? rec.values : [], baEnum.PropertyIdentifier.OBJECT_NAME);
        return typeof name === "string" && name.length > 0;
      });
    } catch (e) {
      return false;
    }
  }

  scanDevice(device) {
    let that = this;
    return new Promise((resolve, reject) => {
      // Use device-specific options
      const readOptions = that.getDeviceSpecificOptions(device);
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
        resolve(true);
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
    // Prevent OVERLAPPING runs. doTreeBuilder is scheduled every 5s, but a full pass over a large
    // deviceList takes far longer, so runs pile up and mutate deviceList concurrently (racing the
    // add/dedupe paths) — the most likely source of the duplicate device entries. Serialise them.
    if (that._treeBuilderInProgress) return;
    that._treeBuilderInProgress = true;
    try {
      // Collapse any duplicates first so the render list and cache never persist redundant copies.
      that._dedupeDeviceList();
      // Then re-link orphaned MSTP children to their real router and drop redundant bare-IP stubs,
      // so the tree nests devices under their named routers instead of bare-<IP> placeholder folders.
      that._repairOrphanParents();

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
    } finally {
      that._treeBuilderInProgress = false;
    }
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
        return { deviceList: this.deviceList, pointList: this.networkTree };
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

      await this.buildNetworkModel(promiseArray, device);
      this.lastNetworkPoll = Date.now();

      return { deviceList: this.deviceList, pointList: this.networkTree };
    } catch (error) {
      this.logOut("Error while building json object: ", error);
      throw error;
    }
  }

  // Builds the data rich bacnet network model
  buildNetworkModel(fullObjects, device) {
    let that = this;
    const reg = /[$#\/\\+,]/gi;
    return new Promise(function (resolve, reject) {
      try {
        let deviceKey =
          typeof device.getAddress() == "object"
            ? device.getAddress().address + "-" + device.getDeviceId()
            : device.getAddress() + "-" + device.getDeviceId();
        let values = that.networkTree[deviceKey] ? that.networkTree[deviceKey] : {};
        // Prune any previously-stored non-whitelisted objects (e.g. carried in from a
        // pre-whitelist cache). The tree is otherwise append-only, so without this a
        // filtered-out type would linger forever. Only removes entries with a known,
        // non-whitelisted objectId type; leaves whitelisted points and the device entry alone.
        for (const _k of Object.keys(values)) {
          const _t =
            values[_k] && values[_k].meta && values[_k].meta.objectId ? values[_k].meta.objectId.type : undefined;
          if (_t !== undefined && !ALLOWED_OBJECT_TYPES.has(_t)) delete values[_k];
        }
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

              // Whitelist gate: never add a non-whitelisted object type to the tree, whatever
              // the source (discovery, manual update, re-read of cached/restored data). Single
              // choke point that keeps networkTree in sync with the pointsList filter.
              if (!ALLOWED_OBJECT_TYPES.has(objectType)) {
                return;
              }

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
                            that.logOut("buildNetworkModel PRESENT_VALUE error: ", e);
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
                            that.logOut("buildNetworkModel STATE_TEXT error: ", e);
                          }
                          break;
                        case baEnum.PropertyIdentifier.VENDOR_NAME:
                          if (object.value && object.value[0] && object.value[0].value && typeof object.value[0].value == "string") {
                            values[objectId].vendorName = object.value[0].value;
                          }
                          break;
                        case baEnum.PropertyIdentifier.MODEL_NAME:
                          if (object.value && object.value[0] && object.value[0].value && typeof object.value[0].value == "string") {
                            values[objectId].modelName = object.value[0].value;
                          }
                          break;
                        case baEnum.PropertyIdentifier.FIRMWARE_REVISION:
                          if (object.value && object.value[0] && object.value[0].value && typeof object.value[0].value == "string") {
                            values[objectId].firmwareRevision = object.value[0].value;
                          }
                          break;
                        case baEnum.PropertyIdentifier.APPLICATION_SOFTWARE_VERSION:
                          if (object.value && object.value[0] && object.value[0].value && typeof object.value[0].value == "string") {
                            values[objectId].applicationSoftwareVersion = object.value[0].value;
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
              } else {
                that.logOut(
                  "[discovery] dropped " + bac_obj + ":" + pointProperty.objectId.instance +
                  " on device " + device.getDeviceId() +
                  " - no OBJECT_NAME returned (read likely rejected)"
                );
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

  _resolveAppTag(objectType, userAppTag) {
    // If user explicitly set an app tag (not auto), use it
    if (userAppTag !== -1) return userAppTag;

    // Auto-detect based on BACnet object type
    switch (objectType) {
      case 3: // BI
      case 4: // BO
      case 5: // BV
        return 9; // ENUMERATED
      case 13: // MI
      case 14: // MO
      case 19: // MV
        return 2; // UNSIGNED_INT
      default:
        return 4; // REAL
    }
  }

  _coerceWriteValue(value, appTag) {
    switch (appTag) {
      case 9: // ENUMERATED - binary objects expect 0 (inactive) or 1 (active)
        if (value === true || value === 1 || value === "1" ||
            value === "true" || value === "active" || value === "on") {
          return 1;
        }
        return 0;
      case 2: // UNSIGNED_INT - multistate objects expect positive integers
        return parseInt(value) || 0;
      default:
        return value;
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
