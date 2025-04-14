const { parentPort } = require("worker_threads");
const { Worker } = require("worker_threads");
const path = require("path");

function getRelativeTime(timestamp) {
  if (!timestamp) return "N/A";
  let now = Date.now();
  let timeDiff = now - timestamp;
  if (timeDiff < 0) return "In the future";

  let seconds = Math.floor(timeDiff / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  let days = Math.floor(hours / 24);
  let weeks = Math.floor(days / 7);
  let months = Math.floor(days / 30);
  let years = Math.floor(days / 365);

  if (seconds < 60) return `${seconds} seconds ago`;
  if (minutes < 60) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  if (days < 7) return `${days} days ago`;
  if (weeks < 4) return `${weeks} weeks ago`;
  if (months < 12) return `${months} months ago`;
  return `${years} years ago`;
}

// Main processing function
function processModelStats(data) {
  const { ReadList, DiscoveryList, PublishList, statBlock, filterKey, filterValue } = data;
  const ResultList = {};
  let readCount = 0;
  let pointOkCount = 0;
  let pointNotInDiscoveryCount = 0;
  let pointMatchDiscoveryNotPublishingCount = 0;
  let discoveryCount = 0;
  let unmappedCount = 0;

  // Reset all statBlock counters to ensure fresh counts
  statBlock.ok = 0;
  statBlock.error = 0;
  statBlock.missing = 0;
  statBlock.warnings = 0;
  statBlock.unmapped = 0;
  statBlock.moved = 0;
  statBlock.deviceIdChange = 0;
  statBlock.deviceIdConflict = 0;

  // Add this section to track device ID conflicts
  const deviceIdCount = {}; // Track count of each device ID
  const deviceIdIPs = {}; // Track IPs for each device ID for reporting
  const deviceIpDetails = {}; // Store additional details for debugging

  // Count device IDs while preprocessing DiscoveryList
  for (const [DiscoveryDevice, DiscoveryDeviceObj] of Object.entries(DiscoveryList)) {
    // Improved parsing with validation
    const parts = DiscoveryDevice.split("-");
    if (parts.length < 2) continue; // Skip invalid format

    const IP = parts[0];
    // Handle case where deviceID might be after the first dash
    // If there are multiple dashes, combine all parts after the first dash
    const DeviceID = parts.slice(1).join("-").trim();

    // Skip entries with empty deviceIDs
    if (!DeviceID) continue;

    // Normalize deviceID to avoid false conflicts
    // Convert to string and trim to avoid type and whitespace issues
    const normalizedDeviceID = String(DeviceID).trim();

    // Initialize or increment device ID count
    deviceIdCount[normalizedDeviceID] = (deviceIdCount[normalizedDeviceID] || 0) + 1;

    // Track IPs for this device ID
    if (!deviceIdIPs[normalizedDeviceID]) {
      deviceIdIPs[normalizedDeviceID] = new Set();
      deviceIpDetails[normalizedDeviceID] = [];
    }
    deviceIdIPs[normalizedDeviceID].add(IP);

    // Store enough details to help debug the issue
    deviceIpDetails[normalizedDeviceID].push({
      fullKey: DiscoveryDevice,
      ip: IP,
      deviceId: DeviceID,
      normalizedDeviceId: normalizedDeviceID,
      pointCount: Object.keys(DiscoveryDeviceObj).length
    });
  }

  // Count conflicts - a conflict exists when a device ID appears with multiple IPs
  for (const [deviceId, ipSet] of Object.entries(deviceIdIPs)) {
    // Only consider it a conflict if there are truly multiple distinct IPs
    // This additional validation helps filter out false positives
    if (ipSet.size > 1) {
      // Filter out any possible empty or invalid IPs
      const validIPs = Array.from(ipSet).filter(ip => ip && ip.trim().length > 0);

      if (validIPs.length > 1) {
        statBlock.deviceIdConflict++;

        // Optionally, add detailed information to a result list
        // This can be useful if you want to display the conflicts
        const ipsList = validIPs.join(', ');
        const conflictKey = `conflict:${deviceId}`;

        // Get more detailed information about the conflict for display
        const detailsText = deviceIpDetails[deviceId]
          .map(d => `[${d.ip} has ${d.pointCount} points]`)
          .join(', ');

        ResultList[conflictKey] = {
          deviceID: deviceId,
          ipAddress: ipsList,
          dataModelStatus: `Device ID Conflict - Same ID (${deviceId}) found on multiple IP addresses: ${ipsList}. ${detailsText}`,
          pointInReadList: false,
          pointMatchedDiscoveryList: true,
          pointBeingPublished: false,
          // Add other required fields with empty/default values
          objectType: 'N/A',
          objectInstance: 'N/A',
          pointName: 'N/A',
          displayName: 'Device ID Conflict',
          deviceName: 'Multiple Devices',
          presentValue: null,
          topic: 'N/A',
          discoveredBACnetPointName: 'N/A',
          lastSeen: 'N/A',
          error: 'Device ID Conflict'
        };
      }
    }
  }

  // Create a more flexible structure for matching - store multiple variations of the normalized topic
  const PublishTopicsNormalized = new Map();
  for (const [publishTopic, data] of Object.entries(PublishList)) {
    const parts = publishTopic.split("/");

    // Store multiple variations to increase match chances
    // 1. Full lowercased path
    const fullPath = publishTopic.toLowerCase();
    // 2. Remove the first 2 levels (traditional approach)
    const withoutPrefix = parts.length > 2 ? parts.slice(2).join("/").toLowerCase() : "";
    // 3. Just the last segment (for very short read paths)
    const lastSegment = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : "";

    // Store the data under all variations
    const publishData = {
      error: data.error || "N/A",
      presentValue: data.presentValue,
      bacnetLastSeen: data.bacnetLastSeen
    };

    PublishTopicsNormalized.set(fullPath, publishData);
    if (withoutPrefix) PublishTopicsNormalized.set(withoutPrefix, publishData);
    if (lastSegment) PublishTopicsNormalized.set(lastSegment, publishData);
  }

  // Preprocess DiscoveryList
  const DiscoveryKeys = new Set();
  const DiscoveryPointMap = {};

  for (const [DiscoveryDevice, DiscoveryDeviceObj] of Object.entries(DiscoveryList)) {
    const [IP, DeviceID] = DiscoveryDevice.split("-");

    for (const [DiscoveryPoint, DiscoveryPointObj] of Object.entries(DiscoveryDeviceObj)) {
      const DiscPointKey = `${IP}:${DeviceID}:${DiscoveryPointObj.meta.objectId.type}:${DiscoveryPointObj.meta.objectId.instance}`;
      DiscoveryKeys.add(DiscPointKey);
      DiscoveryPointMap[DiscPointKey] = DiscoveryPointObj;
    }
  }

  // Preprocess DiscoveryKeys into structured maps
  const discoveryMap = {
    withoutIP: new Set(),
    withoutTypeAndInstance: new Set(),
    deviceIDOnly: new Set(),
    ipTypeInstance: new Set(),
    deviceIPOnly: new Set(),
  };

  DiscoveryKeys.forEach((key) => {
    const parts = key.split(":");
    discoveryMap.withoutIP.add(parts.slice(-3).join(":"));
    discoveryMap.withoutTypeAndInstance.add(parts.slice(0, 2).join(":"));
    discoveryMap.deviceIDOnly.add(parts[1]);
    discoveryMap.ipTypeInstance.add([parts[0], parts[2], parts[3]].join(":"));
    discoveryMap.deviceIPOnly.add(parts[0]);
  });

  // Process read points
  for (const [ReadPoint, ReadPointObj] of Object.entries(ReadList)) {
    const ReadPointKey = `${ReadPointObj.ipAddress}:${ReadPointObj.key}`;
    const DiscoveryKeyMatch = DiscoveryKeys.has(ReadPointKey);

    // Create multiple variations of the read point path to increase match chances
    const parts = ReadPoint.split("/");
    const normalizedFull = ReadPoint.toLowerCase();
    const normalizedNoPrefix = parts.length > 2 ? parts.slice(2).join("/").toLowerCase() : "";
    const normalizedLastSegment = parts.length > 0 ? parts[parts.length - 1].toLowerCase() : "";

    // Try each variation to find a match
    let matchVariation = null;
    let PublishPointTopicMatch = false;

    if (PublishTopicsNormalized.has(normalizedFull)) {
      matchVariation = normalizedFull;
      PublishPointTopicMatch = true;
    } else if (normalizedNoPrefix && PublishTopicsNormalized.has(normalizedNoPrefix)) {
      matchVariation = normalizedNoPrefix;
      PublishPointTopicMatch = true;
    } else if (normalizedLastSegment && PublishTopicsNormalized.has(normalizedLastSegment)) {
      matchVariation = normalizedLastSegment;
      PublishPointTopicMatch = true;
    }

    const PointResult = { ...ReadPointObj };
    PointResult.topic = ReadPoint;
    PointResult.pointInReadList = true;
    PointResult.pointMatchedDiscoveryList = DiscoveryKeyMatch;
    PointResult.pointBeingPublished = PublishPointTopicMatch;

    if (PublishPointTopicMatch && matchVariation) {
      const publishData = PublishTopicsNormalized.get(matchVariation);
      PointResult.presentValue = publishData.presentValue ?? null;
      PointResult.lastSeenTimestamp = publishData.bacnetLastSeen;
    } else {
      PointResult.presentValue = null;
    }

    if (DiscoveryKeyMatch) {
      if (PublishPointTopicMatch) {
        const error = PublishTopicsNormalized.get(matchVariation).error;
        if (error !== "none" && error !== "N/A") {
          PointResult.dataModelStatus = `Point Error - Matched in Discovery / Data Model and publishing, however BACNet Error is present: ${error}`;
          statBlock.error++;
        } else {
          PointResult.dataModelStatus = "Point Ok - Matched in Discovery / Data Model and publishing";
          statBlock.ok++;
        }
        PointResult.error = error;
        pointOkCount++;
      } else {
        if (DiscoveryPointMap[ReadPointKey].objectName !== ReadPointObj.pointName) {
          PointResult.dataModelStatus = "Point Missing - Point name in BACnet controller has been changed. Point not publishing.";
        } else {
          PointResult.dataModelStatus = "Point Warning - Matched in Discovery / Data Model ok but not publishing";
        }
        PointResult.error = "N/A";
        pointMatchDiscoveryNotPublishingCount++;
      }

      PointResult.discoveredBACnetPointName = DiscoveryPointMap[ReadPointKey].objectName;
      const timestamp = DiscoveryPointMap[ReadPointKey].timestamp ?? "N/A";
      PointResult.lastSeen = getRelativeTime(timestamp);
    } else {
      PointResult.dataModelStatus = "Point Missing - Point in Read List but not Discovery / Data Model and not publishing";

      const readParts = ReadPointKey.split(":");
      const readWithoutIP = readParts.slice(-3).join(":");
      const readWithoutTypeAndInstance = readParts.slice(0, 2).join(":");
      const readDeviceIDOnly = readParts[1];
      const readIPTypeInstance = [readParts[0], readParts[2], readParts[3]].join(":");
      const readDeviceIPOnly = readParts[0];

      if (discoveryMap.withoutIP.has(readWithoutIP)) {
        PointResult.dataModelStatus += ". It appears like the IP associated with this device ID has changed.";
      } else if (discoveryMap.withoutTypeAndInstance.has(readWithoutTypeAndInstance)) {
        PointResult.dataModelStatus +=
          ". It appears like the device ID exists in the discovery with the correct IP but does not contain the required point (object type and instance).";
      } else if (discoveryMap.deviceIDOnly.has(readDeviceIDOnly)) {
        PointResult.dataModelStatus +=
          ". It appears like the device ID exists in the discovery but does not have the correct IP and does not have the required point (object type and instance).";
      } else if (discoveryMap.ipTypeInstance.has(readIPTypeInstance)) {
        PointResult.dataModelStatus +=
          ". It appears like the IP exists in the discovery but does not have the correct device ID. It does however have the required point (object type and instance).";
      } else if (discoveryMap.deviceIPOnly.has(readDeviceIPOnly)) {
        PointResult.dataModelStatus +=
          ". It appears like the IP exists in the discovery but does not have the correct device ID and does not have the required point (object type and instance).";
      } else {
        PointResult.dataModelStatus +=
          ". No matching combination of IP or ID and point (type and instance) can be found. Device is likely not on the network.";
      }

      PointResult.discoveredBACnetPointName = "N/A";
      PointResult.lastSeen = "N/A";
      PointResult.error = "N/A";
      pointNotInDiscoveryCount++;
    }

    ResultList[ReadPointKey] = PointResult;
    readCount++;
  }

  // Process unmapped points
  const ReadKeys = new Set(Object.values(ReadList).map((ReadPointObj) => `${ReadPointObj.ipAddress}:${ReadPointObj.key}`));
  const UnmappedKeys = {
    IDName: new Map(),
    IPTypeInstanceName: new Map(),
  };

  for (const DiscoveryKey of DiscoveryKeys) {
    if (!ReadKeys.has(DiscoveryKey)) {
      const parts = DiscoveryKey.split(":");
      const unmappedPoint = {
        deviceID: parts[1],
        objectType: parts[2],
        objectInstance: parts[3],
        pointName: DiscoveryPointMap[DiscoveryKey].objectName,
        displayName: DiscoveryPointMap[DiscoveryKey].displayName,
        deviceName: DiscoveryPointMap[DiscoveryKey]?.meta?.device?.deviceName || "N/A",
        ipAddress: parts[0] || "N/A",
        presentValue: DiscoveryPointMap[DiscoveryKey].presentValue || null,
        area: "N/A",
        key: DiscoveryKey,
        topic: "N/A",
        pointInReadList: false,
        pointMatchedDiscoveryList: false,
        pointBeingPublished: false,
        dataModelStatus: "Point Unmapped - In discovery list but not read list",
        discoveredBACnetPointName: "N/A",
        lastSeen: "N/A",
        error: "N/A",
      };

      ResultList[DiscoveryKey] = unmappedPoint;

      UnmappedKeys.IDName.set(unmappedPoint.deviceID + ":" + unmappedPoint.pointName, unmappedPoint.objectInstance);
      UnmappedKeys.IPTypeInstanceName.set(
        `${unmappedPoint.ipAddress}:${unmappedPoint.objectType}:${unmappedPoint.objectInstance}:${unmappedPoint.pointName}`,
        unmappedPoint.deviceID
      );
      unmappedCount++;
    }
    discoveryCount++;
  }

  // Find moved points
  for (const [ResultPoint, ResultPointObj] of Object.entries(ResultList)) {
    if (
      ResultPointObj.dataModelStatus.includes(
        ". It appears like the device ID exists in the discovery with the correct IP but does not contain the required point (object type and instance)."
      )
    ) {
      const key = ResultPointObj.deviceID + ":" + ResultPointObj.pointName;
      if (UnmappedKeys.IDName.has(key)) {
        ResultList[
          ResultPoint
        ].dataModelStatus = `Point Moved - Point not publishing - Point potentially moved from object instance ${ResultList[ResultPoint].objectInstance
        } to ${UnmappedKeys.IDName.get(key)}.`;
        statBlock.moved++;
      }
    } else if (
      ResultPointObj.dataModelStatus.includes(
        ". It appears like the IP exists in the discovery but does not have the correct device ID. It does however have the required point (object type and instance)."
      )
    ) {
      const key = `${ResultPointObj.ipAddress}:${ResultPointObj.objectType}:${ResultPointObj.objectInstance}:${ResultPointObj.pointName}`;
      if (UnmappedKeys.IPTypeInstanceName.has(key)) {
        ResultList[ResultPoint].dataModelStatus = `Device ID Changed - Point not publishing - Device ID potentially change from ${ResultList[ResultPoint].deviceID
          } to ${UnmappedKeys.IPTypeInstanceName.get(key)}.`;
        statBlock.deviceIdChange++;
      }
    }
  }

  // Update statBlock
  statBlock.missing = pointNotInDiscoveryCount;
  statBlock.warnings = pointMatchDiscoveryNotPublishingCount;
  statBlock.unmapped = unmappedCount;

  // If we're asked to filter the results directly in the worker
  if (filterKey && filterValue) {
    const filteredList = {};

    // Apply filtering to the ResultList
    for (const [key, item] of Object.entries(ResultList)) {
      try {
        // Handle nested properties using dot notation
        const value = filterKey.split(".").reduce((obj, key) => {
          if (obj === null || obj === undefined) return undefined;
          return obj[key];
        }, item);

        // Handle undefined/null values
        if (value === undefined || value === null) {
          continue;
        }

        // Split filter values by comma and trim whitespace
        const filterValues = filterValue.split(",").map((v) => v.trim());

        // Case-insensitive string comparison for string values
        if (typeof value === "string") {
          const valueLower = value.toLowerCase();
          if (filterValues.some((filterVal) => valueLower.includes(filterVal.toLowerCase()))) {
            filteredList[key] = item;
          }
          continue;
        }

        // Direct comparison for non-string values
        if (
          filterValues.some((filterVal) => {
            // Try to convert filterVal to the same type as value for comparison
            const convertedFilterVal = typeof value === "number" ? Number(filterVal) : filterVal;
            return value === convertedFilterVal;
          })
        ) {
          filteredList[key] = item;
        }
      } catch (err) {
        // Skip items that cause filter errors
        continue;
      }
    }

    // Return the filtered list instead
    return {
      ResultList: filteredList,
      statBlock,
      stat_counts: {
        readCount,
        discoveryCount,
        pointOkCount,
        pointNotInDiscoveryCount,
        pointMatchDiscoveryNotPublishingCount,
        unmappedCount,
      },
    };
  }

  return {
    ResultList,
    statBlock,
    stat_counts: {
      readCount,
      discoveryCount,
      pointOkCount,
      pointNotInDiscoveryCount,
      pointMatchDiscoveryNotPublishingCount,
      unmappedCount,
    },
  };
}

// Listen for messages from the main thread
parentPort.on("message", (data) => {
  try {
    const result = processModelStats(data);
    parentPort.postMessage(result);
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});

// Add these variables at the top with your other worker variables
let activeWorker = null;
let isWorkerBusy = false;
let workerQueue = [];
let workerTaskCount = 0;  // Add this to track number of tasks processed
const MAX_TASKS_PER_WORKER = 5;  // Terminate worker after 5 tasks

// Then modify the runWithWorker function
async function runWithWorker(task) {
  if (isWorkerBusy) {
    return new Promise((resolve, reject) => {
      workerQueue.push({ task, resolve, reject });
    });
  }

  isWorkerBusy = true;

  try {
    // Create worker if needed
    if (!activeWorker) {
      activeWorker = new Worker(path.join(__dirname, "bacnet_inspector_worker.js"));
      workerTaskCount = 0;  // Reset task count for new worker
    }

    // Increment task count
    workerTaskCount++;
    // Set up promise to get worker response
    const result = await new Promise((resolve, reject) => {
      const messageHandler = (data) => {
        activeWorker.removeListener("error", errorHandler);
        resolve(data);
      };

      const errorHandler = (error) => {
        activeWorker.removeListener("message", messageHandler);
        reject(error);
      };

      activeWorker.once("message", messageHandler);
      activeWorker.once("error", errorHandler);

      // Send the task data to the worker
      activeWorker.postMessage(task);
    });

    return result;
  } catch (error) {
    throw error;
  } finally {
    isWorkerBusy = false;

    // Process next task in queue or terminate worker
    if (workerQueue.length > 0) {
      const nextTask = workerQueue.shift();
      runWithWorker(nextTask.task).then(nextTask.resolve).catch(nextTask.reject);
    } else {
      // Check if worker has processed too many tasks
      if (workerTaskCount >= MAX_TASKS_PER_WORKER && activeWorker) {
        // Terminate worker immediately
        activeWorker.terminate().catch((err) => {
          console.error("Error terminating worker:", err);
        });
        activeWorker = null;
      } else if (activeWorker) {
        // Keep original timeout logic as a backup
        setTimeout(() => {
          if (!isWorkerBusy && activeWorker) {
            activeWorker.terminate().catch((err) => {
              console.error("Error terminating worker:", err);
            });
            activeWorker = null;
          }
        }, 2000); // Reduced from 5000ms to 2000ms
      }
    }
  }
}
