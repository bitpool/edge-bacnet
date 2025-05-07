/*
  MIT License Copyright 2021, 2025 - Bitpool Pty Ltd
*/

const { randomUUID } = require("crypto");
const os = require("os");
const baEnum = require("./resources/node-bacstack-ts/dist/index.js").enum;
const fs = require("fs");
const fs2 = require("fs").promises;

class BacnetConfig {
  constructor(
    device,
    objects,
    bacnet_polling_schedule,
    apduTimeout,
    localIpAdrress,
    roundDecimal,
    local_device_port,
    apduSize,
    maxSegments,
    broadCastAddr
  ) {
    this.device = {
      deviceId: device.deviceId,
      address: device.address,
    };
    this.polling = {
      schedule: bacnet_polling_schedule,
    };
    this.objects = [
      {
        objectId: {
          type: objects.object_type,
          instance: objects.instance,
          properties: objects.object_props,
        },
      },
    ];
    this.apduTimeout = apduTimeout;
    this.localIpAdrress = localIpAdrress;
    this.roundDecimal = roundDecimal;
    this.port = local_device_port;
    this.apduSize = apduSize;
    this.maxSegments = maxSegments;
    this.broadCastAddr = broadCastAddr;
  }
}

class BacnetClientConfig {
  constructor(
    apduTimeout,
    localIpAdrress,
    local_device_port,
    apduSize,
    maxSegments,
    broadCastAddr,
    discover_polling_schedule,
    toRestartNodeRed,
    deviceId,
    manual_instance_range_enabled,
    manual_instance_range_start,
    manual_instance_range_end,
    device_read_schedule,
    retries,
    cacheFileEnabled,
    sanitise_device_schedule,
    portRangeMatrix,
    enable_device_discovery
  ) {
    this.apduTimeout = apduTimeout;
    this.localIpAdrress = localIpAdrress;
    this.port = local_device_port;
    this.apduSize = apduSize;
    this.maxSegments = maxSegments;
    this.broadCastAddr = broadCastAddr;
    this.discover_polling_schedule = discover_polling_schedule;
    this.toRestartNodeRed = toRestartNodeRed;
    this.deviceId = deviceId;
    this.manual_instance_range_enabled = manual_instance_range_enabled;
    this.manual_instance_range_start = manual_instance_range_start;
    this.manual_instance_range_end = manual_instance_range_end;
    this.device_read_schedule = device_read_schedule;
    this.retries = retries;
    this.cacheFileEnabled = cacheFileEnabled;
    this.sanitise_device_schedule = sanitise_device_schedule;
    this.portRangeMatrix = this.generatePortRangeArray(portRangeMatrix);
    this.enable_device_discovery = enable_device_discovery;
  }

  generatePortRangeArray(rangeMatrix) {
    let portArray = [];
    for (let x = 0; x < rangeMatrix.length; x++) {
      let rangeEntry = rangeMatrix[x];
      let start = parseInt(rangeEntry.start);
      let end = parseInt(rangeEntry.end);
      for (let i = start; i <= end; i++) {
        portArray.push(i);
      }
    }

    return portArray;
  }
}

class ReadCommandConfig {
  constructor(pointsToRead, objectProperties, decimalPrecision) {
    this.pointsToRead = pointsToRead;
    this.objectProperties = objectProperties;
    this.precision = decimalPrecision;
  }
}

class WriteCommandConfig {
  constructor(device, objects) {
    this.device = {
      deviceId: device.deviceId,
      address: device.address,
    };
    this.objects = [
      {
        objectId: {
          type: objects.object_type,
          instance: objects.instance,
          properties: objects.object_props,
        },
      },
    ];
  }
}

const getUnit = function (id) {
  for (var key in baEnum.EngineeringUnits) {
    if (baEnum.EngineeringUnits[key] == id) {
      if (baEnum.EngineeringUnits.hasOwnProperty(key)) {
        let unitsArr = key.split("_");
        let unit;
        unitsArr.forEach((ele, index) => {
          if (index == 0) {
            unit = ele.toLowerCase();
          } else {
            unit += "-" + ele.toLowerCase();
          }
        });
        return unit;
      }
    }
  }
  return "no-units";
};

const generateId = function () {
  return randomUUID();
};

const getIpAddress = function () {
  return new Promise(function (resolve, reject) {
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

    if (os.version().includes("Ubuntu") || os.version().includes("SMP")) {
      let allInterfaceName = "All interfaces";
      if (!results[allInterfaceName]) {
        results[allInterfaceName] = [];
      }
      results[allInterfaceName].push("0.0.0.0");
    } else if (os.version().includes("Windows")) {
      //do nothing
    }

    resolve(results);
  });
};

const roundDecimalPlaces = function (value, decimals) {
  if (decimals) return Number(Math.round(value + "e" + decimals) + "e-" + decimals);
  return value;
};

// STORE CONFIG FUNCTION ==========================================================
//
// ================================================================================

/*

async function Store_Config(data) {
  try {
    await fs.writeFile("edge-bacnet-datastore.cfg", data, { encoding: "utf8", flag: "w" }, (err) => {
      if (err) {
        console.log("Store_Config writeFile error: ", err);
      }
    });
  } catch (e) {
    //do nothing
  }
}

*/

// refactor:

let storeQueue = [];
let isStoreProcessing = false;

async function queueConfigStore(data) {
  storeQueue.push(data);

  if (!isStoreProcessing) {
    isStoreProcessing = true;

    while (storeQueue.length > 0) {
      const nextData = storeQueue.pop(); // Get most recent data
      storeQueue.length = 0; // Clear any accumulated data

      await Store_Config(nextData);

      // Add small delay between attempts
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    isStoreProcessing = false;
  }
}

async function Store_Config(data) {
  const mainFile = "edge-bacnet-datastore.cfg";
  const tempFile = "edge-bacnet-datastore.cfg.tmp";
  const backupFile = "edge-bacnet-datastore.cfg.bak";

  try {
    // First validate the JSON to ensure it's valid before writing
    try {
      JSON.parse(JSON.stringify(data));
    } catch (jsonError) {
      console.error("Invalid JSON data detected:", jsonError);
      return false;
    }

    // Write to temporary file first
    await fs2.writeFile(tempFile, JSON.stringify(data, null, 2), { encoding: "utf8" });

    // Verify the temporary file is valid JSON
    try {
      const tempContent = await fs2.readFile(tempFile, "utf8");
      JSON.parse(tempContent);
    } catch (verifyError) {
      console.error("Temporary file validation failed:", verifyError);
      await fs2.unlink(tempFile).catch(() => { });
      return false;
    }

    // Create backup of current file if it exists
    try {
      await fs2.access(mainFile);
      await fs2.copyFile(mainFile, backupFile);
    } catch (backupError) {
      // If main file doesn't exist, no backup needed
    }

    // Atomic rename of temporary file to main file
    await fs2.rename(tempFile, mainFile);
    return true;
  } catch (error) {
    console.error("Store_Config error:", error);

    // Cleanup temporary file if it exists
    try {
      await fs2.unlink(tempFile).catch(() => { });
    } catch (cleanupError) { }

    // If main file is corrupted and backup exists, restore from backup
    try {
      const backupExists = await fs2.access(backupFile).catch(() => false);
      if (backupExists) {
        await fs2.copyFile(backupFile, mainFile);
        console.log("Restored from backup file");
      }
    } catch (restoreError) {
      console.error("Failed to restore from backup:", restoreError);
    }

    return false;
  }
}

// READ CONFIG SYNC FUNCTION ======================================================
//
// ================================================================================

function Read_Config_Sync() {
  const mainFile = "edge-bacnet-datastore.cfg";
  const backupFile = "edge-bacnet-datastore.cfg.bak";
  const defaultData = "{}";

  try {
    // Try to read the main file
    let data = fsSync.readFileSync(mainFile, { encoding: "utf8" });

    // Validate JSON
    try {
      JSON.parse(data);
      return data;
    } catch (jsonError) {
      console.error("Main file contains invalid JSON, attempting backup recovery");

      // Try to read backup file
      try {
        const backupData = fsSync.readFileSync(backupFile, { encoding: "utf8" });
        JSON.parse(backupData); // Validate backup JSON

        // Restore from backup
        fsSync.copyFileSync(backupFile, mainFile);
        console.log("Successfully restored from backup file");
        return backupData;
      } catch (backupError) {
        console.error("Backup recovery failed, creating new file");
        fsSync.writeFileSync(mainFile, defaultData, { encoding: "utf8" });
        return defaultData;
      }
    }
  } catch (error) {
    console.error("Error reading config:", error);
    fsSync.writeFileSync(mainFile, defaultData, { encoding: "utf8" });
    return defaultData;
  }
}

// refactor:

async function Read_Config_Async() {
  // todo rename function, not using sync
  const mainFile = "edge-bacnet-datastore.cfg";
  const backupFile = "edge-bacnet-datastore.cfg.bak";
  const defaultData = "{}";

  try {
    // Try to read the main file
    const data = await fs2.readFile(mainFile, { encoding: "utf8" });

    // Validate JSON
    try {
      JSON.parse(data);

      return data;
    } catch (jsonError) {
      console.error("Main file contains invalid JSON, attempting backup recovery");

      // Try to read backup file
      try {
        const backupData = await fs2.readFile(backupFile, { encoding: "utf8" });
        JSON.parse(backupData); // Validate backup JSON

        // Restore from backup
        await fs.copyFile(backupFile, mainFile);
        console.log("Successfully restored from backup file");

        console.log("log2");

        return backupData;
      } catch (backupError) {
        console.error("Backup recovery failed, creating new file");
        await Store_Config(defaultData);

        console.log("log3");

        return defaultData;
      }
    }
  } catch (error) {
    console.error("Error reading config:", error);
    await Store_Config(defaultData);

    console.log("log4");

    return defaultData;
  }
}

// STORE CONFIG FUNCTION - BACNET SERVER ==========================================
//
// ================================================================================
async function Store_Config_Server(data) {
  try {
    await fs.writeFile("edge-bacnet-server-datastore.cfg", data, (err) => {
      if (err) {
        //console.log("Store_Config_Server writeFile error: ", err);
      }
    });
  } catch (err) { }
}

// READ CONFIG SYNC FUNCTION - BACNET SERVER ======================================
//
// ================================================================================
function Read_Config_Sync_Server() {
  var data = "{}";
  try {
    data = fs.readFileSync("edge-bacnet-server-datastore.cfg", { encoding: "utf8", flag: "r" });
  } catch (err) {
    if (err.errno == -4058) {
      data = "{}";
      Store_Config_Server(data);
    }
  }
  return data;
}

function isNumber(value) {
  return value != null && typeof value === "number" && !isNaN(value);
}

function decodeBitArray(size, bits) {
  let array = [];
  for (let i = 0; i < bits.length; i++) {
    let bit = bits[i];
    let bitString = bit.toString(2);
    if (bitString.length < size) {
      const remainingLength = size - bitString.length;
      const backFillString = "0".repeat(remainingLength);
      array.push(backFillString + bitString);
    } else if (bitString.length == size) {
      array.push(bitString);
    }
    if (i == bits.length - 1) {
      return array;
    }
  }
}

function getBacnetErrorString(classInt, codeInt) {
  const classString = Object.keys(baEnum.ErrorClass).find((key) => baEnum.ErrorClass[key] === classInt);
  const codeString = Object.keys(baEnum.ErrorCode).find((key) => baEnum.ErrorCode[key] === codeInt);
  return `BacnetError - Class:${classString} - Code:${codeString}`;
}

function parseBacnetError(error) {
  let err = error.message;
  if (err.includes("Class") && err.includes("Code")) {
    const match = err.match(/Class:(\d+) - Code:(\d+)/);
    if (match) {
      err = getBacnetErrorString(parseInt(match[1], 10), parseInt(match[2], 10));
    }
  } else if (err.includes("ERR_TIMEOUT")) {
    err = "Request TIMEOUT";
  }

  return err;
}
function debounce(func, wait) {
  let timeout;

  return function (...args) {
    const context = this;

    // Clear the previous timeout
    clearTimeout(timeout);

    // Set a new timeout
    timeout = setTimeout(() => {
      func.apply(context, args);
    }, wait);
  };
}

module.exports = {
  BacnetConfig,
  BacnetClientConfig,
  ReadCommandConfig,
  WriteCommandConfig,
  getUnit,
  generateId,
  getIpAddress,
  roundDecimalPlaces,
  queueConfigStore,
  Store_Config,
  Read_Config_Sync,
  Read_Config_Async,
  Store_Config_Server,
  Read_Config_Sync_Server,
  isNumber,
  decodeBitArray,
  parseBacnetError,
  getBacnetErrorString,
  debounce,
};
