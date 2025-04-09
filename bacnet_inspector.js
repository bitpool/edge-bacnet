const fs = require("fs");
const path = require("path");
const os = require("os");
const { debounce } = require("./common");
const { generatePrimeVueAppHtmlStatic, getLogoAsBase64 } = require("./ssrHtmlExporter.js");
const { Worker } = require("worker_threads");

module.exports = function (RED) {
  let context;
  let node;

  function BacnetInspector(config) {
    RED.nodes.createNode(this, config);
    node = this;
    context = node.context();
    node.name = config.name;
    node.siteName = config.siteName;
    node.uniqueReadTopics = config.uniqueReadTopics;
    node.totalUniqueReadCount = config.totalUniqueReadCount;
    node.statBlock = {
      ok: 0,
      error: 0,
      missing: 0,
      warnings: 0,
      moved: 0,
      deviceIdChange: 0,
      deviceIdConflict: 0,
      unmapped: 0,
      offlinePercentage: 0,
    };

    // Cache for flow context data
    let cachedData = {
      uniqueTopics: new Set(),
      uniqueReadTopics: new Set(),
      topicStatusMap: new Map(),
      topicDataMap: new Map(),
      ReadList: new Map(),
      totalUniquePolledCount: 0,
      onlineCount: 0,
      offlineCount: 0,
      offlinePercentage: 0,
      entriesWithErrors: new Map(),
      totalUniqueReadCount: 0,
      site_Name: node.siteName,
    };

    // Track what data has been modified and needs to be synced
    let dirtyFlags = {
      uniqueTopics: false,
      uniqueReadTopics: false,
      topicStatusMap: false,
      topicDataMap: false,
      ReadList: false,
      totalUniquePolledCount: false,
      onlineCount: false,
      offlineCount: false,
      offlinePercentage: false,
      entriesWithErrors: false,
      totalUniqueReadCount: false,
      site_Name: false,
    };

    // Initialize cache from flow context
    initializeCache();

    function initializeCache() {
      let flow = context.flow;

      // Load data from flow context into cache
      const uniqueTopics = flow.get("uniqueTopics") || [];
      const uniqueReadTopics = flow.get("uniqueReadTopics") || [];
      const topicStatusMap = flow.get("topicStatusMap") || {};
      const topicDataMap = flow.get("topicDataMap") || {};
      const ReadList = flow.get("ReadList") || {};
      const entriesWithErrors = flow.get("entriesWithErrors") || {};

      // Convert arrays to Sets for faster lookups
      cachedData.uniqueTopics = new Set(uniqueTopics);
      cachedData.uniqueReadTopics = new Set(uniqueReadTopics);

      // Convert objects to Maps for better performance
      Object.entries(topicStatusMap).forEach(([key, value]) => {
        cachedData.topicStatusMap.set(key, value);
      });

      Object.entries(topicDataMap).forEach(([key, value]) => {
        cachedData.topicDataMap.set(key, value);
      });

      Object.entries(ReadList).forEach(([key, value]) => {
        cachedData.ReadList.set(key, value);
      });

      Object.entries(entriesWithErrors).forEach(([key, value]) => {
        cachedData.entriesWithErrors.set(key, value);
      });

      // Load scalar values
      cachedData.totalUniquePolledCount = flow.get("totalUniquePolledCount") || 0;
      cachedData.onlineCount = flow.get("onlineCount") || 0;
      cachedData.offlineCount = flow.get("offlineCount") || 0;
      cachedData.offlinePercentage = flow.get("offlinePercentage") || 0;
      cachedData.totalUniqueReadCount = flow.get("totalUniqueReadCount") || 0;
      cachedData.site_Name = flow.get("site_Name") || node.siteName;
    }

    // Constants for batching and interval times
    const SYNC_INTERVAL = 5000; // Sync with flow context every 5 seconds
    let messageQueue = [];
    const MAX_BATCH_SIZE = 1000;
    const BATCH_PROCESS_INTERVAL = 200;

    // Set up periodic intervals
    this.batchInterval = setInterval(processBatch, BATCH_PROCESS_INTERVAL);
    this.syncInterval = setInterval(syncWithFlowContext, SYNC_INTERVAL);

    const debouncedGetBacnetStats = debounce((node, context, msg) => {
      getModelStats();
    }, 3000);

    // Function to sync cache to flow context
    function syncWithFlowContext() {
      const flow = context.flow;

      // Only sync data that has been modified
      if (dirtyFlags.uniqueTopics) {
        flow.set("uniqueTopics", Array.from(cachedData.uniqueTopics));
        dirtyFlags.uniqueTopics = false;
      }

      if (dirtyFlags.uniqueReadTopics) {
        flow.set("uniqueReadTopics", Array.from(cachedData.uniqueReadTopics));
        dirtyFlags.uniqueReadTopics = false;
      }

      if (dirtyFlags.topicStatusMap) {
        flow.set("topicStatusMap", Object.fromEntries(cachedData.topicStatusMap));
        dirtyFlags.topicStatusMap = false;
      }

      if (dirtyFlags.topicDataMap) {
        flow.set("topicDataMap", Object.fromEntries(cachedData.topicDataMap));
        dirtyFlags.topicDataMap = false;
      }

      if (dirtyFlags.ReadList) {
        flow.set("ReadList", Object.fromEntries(cachedData.ReadList));
        dirtyFlags.ReadList = false;
      }

      if (dirtyFlags.entriesWithErrors) {
        flow.set("entriesWithErrors", Object.fromEntries(cachedData.entriesWithErrors));
        dirtyFlags.entriesWithErrors = false;
      }

      if (dirtyFlags.totalUniquePolledCount) {
        flow.set("totalUniquePolledCount", cachedData.totalUniquePolledCount);
        dirtyFlags.totalUniquePolledCount = false;
      }

      if (dirtyFlags.onlineCount) {
        flow.set("onlineCount", cachedData.onlineCount);
        dirtyFlags.onlineCount = false;
      }

      if (dirtyFlags.offlineCount) {
        flow.set("offlineCount", cachedData.offlineCount);
        dirtyFlags.offlineCount = false;
      }

      if (dirtyFlags.offlinePercentage) {
        flow.set("offlinePercentage", cachedData.offlinePercentage);
        dirtyFlags.offlinePercentage = false;
      }

      if (dirtyFlags.totalUniqueReadCount) {
        flow.set("totalUniqueReadCount", cachedData.totalUniqueReadCount);
        dirtyFlags.totalUniqueReadCount = false;
      }

      if (dirtyFlags.site_Name) {
        flow.set("site_Name", cachedData.site_Name);
        dirtyFlags.site_Name = false;
      }
    }

    node.on("input", function (msg, send, done) {
      if (msg.type === "getBacnetStats") {
        processMessage(msg, send, done);
      } else if (msg.type === "Read") {
        calculateCombinedReadList(node, msg);
        if (done) done();
      } else if (msg.payload && msg.payload.error !== undefined && msg.payload.error !== "none") {
        // bacnet error msg found
        setErrorTopics(msg);
        if (done) done();
      } else if (msg.payload && msg.topic) {
        //regular bacnet output
        debouncedGetBacnetStats(node, context, msg);
        // Queue the message for batch processing instead of immediate processing
        messageQueue.push({ msg, send, done });
        if (messageQueue.length >= MAX_BATCH_SIZE) {
          processBatch();
        }
      } else if (msg.type === "sendMqttStats") {
        // Make sure we have the latest statBlock values before sending stats
        syncStatBlockWithWorkerResults().then(() => {
          let statBlock = node.statBlock;
          for (let key in statBlock) {
            let value = statBlock[key];
            let keyText = key.toUpperCase();
            let newMsg = {
              topic: `EDGE_DEVICE_${node.siteName}/BACNETSTATS/${keyText}`,
              payload: value,
            };
            node.send(newMsg);
          }
          if (done) done();
        });
      } else if (msg.reset === true) {
        node.status({ text: "Resetting..." });

        // Reset the cached data
        cachedData.uniqueTopics.clear();
        cachedData.uniqueReadTopics.clear();
        cachedData.topicStatusMap.clear();
        cachedData.topicDataMap.clear();
        cachedData.ReadList.clear();
        cachedData.entriesWithErrors.clear();
        cachedData.totalUniquePolledCount = 0;
        cachedData.onlineCount = 0;
        cachedData.offlineCount = 0;
        cachedData.offlinePercentage = 0;
        cachedData.totalUniqueReadCount = 0;

        // Force immediate sync with flow context
        Object.keys(dirtyFlags).forEach((key) => {
          dirtyFlags[key] = true;
        });
        syncWithFlowContext();

        setTimeout(() => {
          node.status({ text: "" });
        }, 2000);
        if (done) done();
      } else {
        if (done) done();
      }
    });

    // Process individual messages that shouldn't be batched
    function processMessage(msg, send, done) {
      try {
        getBacnetStats(node, context, msg);
        if (done) done();
      } catch (error) {
        console.error("Error processing message:", error);
        if (done) done(error);
      }
    }

    // Process a batch of messages efficiently
    function processBatch() {
      if (messageQueue.length === 0) return;

      const batch = messageQueue.splice(0, MAX_BATCH_SIZE);
      const combinedUpdates = {};

      // Aggregate updates from batch by topic (keep only most recent message per topic)
      batch.forEach(({ msg }) => {
        const topic = msg.topic;
        if (!combinedUpdates[topic]) combinedUpdates[topic] = msg;
        else {
          // Keep only the most recent message for each topic
          // Check timestamp if available
          if (msg.payload.timestamp > combinedUpdates[topic].payload.timestamp) {
            combinedUpdates[topic] = msg;
          }
        }
      });

      // Process aggregated data once
      processBatchData(Object.values(combinedUpdates));

      // Complete all message callbacks
      batch.forEach(({ done }) => done && done());
    }

    // Efficiently process a batch of aggregated data
    function processBatchData(messages) {
      if (messages.length === 0) return;

      // Use cached data instead of flow context
      const now = new Date();

      // Process all messages in the batch
      messages.forEach((msg) => {
        const topic = msg.topic;
        const status = msg.payload.status;
        const error = msg.payload.error;
        const presentValue = msg.payload.presentValue;
        const timestamp = msg.payload.timestamp;

        // Extract properties only if they exist
        const deviceID = msg.payload.meta?.device?.deviceId;
        const objectType = msg.payload.meta?.objectId?.type;
        const objectInstance = msg.payload.meta?.objectId?.instance;
        let pointName = msg.payload?.objectName;

        if (pointName !== undefined) {
          pointName = pointName + "_" + getObjectType(objectType) + "_" + objectInstance;
        }

        const displayName = msg.payload?.displayName;
        const deviceName = msg.payload.meta?.device?.deviceName;

        const ipAddress =
          typeof msg.payload.meta?.device?.address === "object"
            ? msg.payload.meta.device.address.address
            : msg.payload.meta?.device?.address;

        // Only proceed if the status key exists
        if (status !== undefined) {
          // Update site_Name in cache
          cachedData.site_Name = node.siteName;
          dirtyFlags.site_Name = true;

          // Check if the topic is already in the unique topics list
          if (!cachedData.uniqueTopics.has(topic)) {
            cachedData.uniqueTopics.add(topic);
            cachedData.totalUniquePolledCount++;
            dirtyFlags.uniqueTopics = true;
            dirtyFlags.totalUniquePolledCount = true;
          }

          // Update the status in the topicStatusMap
          const oldStatus = cachedData.topicStatusMap.get(topic);
          if (oldStatus !== status) {
            // Adjust counts based on the previous status
            if (oldStatus === "online") {
              cachedData.onlineCount--;
              dirtyFlags.onlineCount = true;
            } else if (oldStatus === "offline") {
              cachedData.offlineCount--;
              dirtyFlags.offlineCount = true;
            }

            // Update with the new status
            cachedData.topicStatusMap.set(topic, status);
            dirtyFlags.topicStatusMap = true;

            // Adjust counts based on the new status
            if (status === "online") {
              cachedData.onlineCount++;
              dirtyFlags.onlineCount = true;
            } else if (status === "offline") {
              cachedData.offlineCount++;
              dirtyFlags.offlineCount = true;
            }
          }

          // Handle topicDataMap updates
          let topicData = cachedData.topicDataMap.get(topic);
          if (!topicData) {
            // Create new entry
            topicData = {
              presentValue: presentValue,
              status: status,
              bacnetLastSeen: timestamp,
              lastCOVTime: now.getTime(),
            };

            // Add properties conditionally if they exist or are explicitly set to 0
            if (deviceID !== undefined) topicData.deviceID = deviceID;
            if (objectType !== undefined) topicData.objectType = objectType;
            if (objectInstance !== undefined) topicData.objectInstance = objectInstance;
            if (pointName !== undefined) topicData.pointName = pointName;
            if (displayName !== undefined) topicData.displayName = displayName;
            if (deviceName !== undefined) topicData.deviceName = deviceName;
            if (ipAddress !== undefined) topicData.ipAddress = ipAddress;
            if (error !== undefined) topicData.error = error;
            topicData.key = topicData.deviceID + ":" + topicData.objectType + ":" + topicData.objectInstance;

            cachedData.topicDataMap.set(topic, topicData);
            dirtyFlags.topicDataMap = true;
          } else {
            // Update existing entry
            let entryChanged = false;

            if (presentValue !== topicData.presentValue) {
              topicData.presentValue = presentValue;
              topicData.lastCOVTime = now.getTime();
              entryChanged = true;
            }

            topicData.bacnetLastSeen = timestamp;
            entryChanged = true;

            // Update properties conditionally if they exist or are explicitly set to 0
            if (deviceID !== undefined && topicData.deviceID !== deviceID) {
              topicData.deviceID = deviceID;
              entryChanged = true;
            }
            if (objectType !== undefined && topicData.objectType !== objectType) {
              topicData.objectType = objectType;
              entryChanged = true;
            }
            if (objectInstance !== undefined && topicData.objectInstance !== objectInstance) {
              topicData.objectInstance = objectInstance;
              entryChanged = true;
            }
            if (pointName !== undefined && topicData.pointName !== pointName) {
              topicData.pointName = pointName;
              entryChanged = true;
            }
            if (displayName !== undefined && topicData.displayName !== displayName) {
              topicData.displayName = displayName;
              entryChanged = true;
            }
            if (deviceName !== undefined && topicData.deviceName !== deviceName) {
              topicData.deviceName = deviceName;
              entryChanged = true;
            }
            if (ipAddress !== undefined && topicData.ipAddress !== ipAddress) {
              topicData.ipAddress = ipAddress;
              entryChanged = true;
            }
            if (error !== undefined && topicData.error !== error) {
              topicData.error = error;
              entryChanged = true;
            }

            if (entryChanged) {
              topicData.key = topicData.deviceID + ":" + topicData.objectType + ":" + topicData.objectInstance;
              dirtyFlags.topicDataMap = true;
            }
          }
        }
      });

      // Update calculated statistics
      if (dirtyFlags.onlineCount || dirtyFlags.offlineCount) {
        const offlinePercentage = (cachedData.offlineCount / (cachedData.onlineCount + cachedData.offlineCount)) * 100;
        node.statBlock.offlinePercentage = offlinePercentage;
        cachedData.offlinePercentage = offlinePercentage;
        dirtyFlags.offlinePercentage = true;
      }

      // Update the node status
      node.status({ text: "Points Online: " + cachedData.onlineCount + "/" + cachedData.totalUniquePolledCount });
    }

    //API Request Handlers Start

    // Serve custom HTML when "inspector" node is used
    RED.httpAdmin.get("/inspector", function (req, res) {
      const htmlPath = path.join(__dirname, "inspector.html"); // Path to your .html file
      fs.readFile(htmlPath, "utf8", (err, data) => {
        if (err) {
          res.status(500).send("Error loading HTML file");
        } else {
          res.send(data); // Send the file contents as the response
        }
      });
    });

    //inspector page data handler
    RED.httpAdmin.get("/getModelStats", async function (req, res) {
      try {
        let result = await getModelStatsData();

        if (result) {
          res.send(result);
        } else {
          res.status(400).send("Error getting data");
        }
      } catch (e) {
        console.log("Error getting model stats: ", e);
        res.status(400).send("Error getting data");
      }
    });

    //get export read list
    RED.httpAdmin.get("/pointstoread", async function (req, res) {
      try {
        let result = await exportTotalReadList();
        if (result) {
          res.set(result.headers);
          res.send(result.payload);
        } else {
          res.status(400).send("Error getting read list");
        }
      } catch (e) {
        console.log("Error getting read list: ", e);
        res.status(400).send("Error getting read list");
      }
    });

    //get point errors
    RED.httpAdmin.get("/getpointerrors", async function (req, res) {
      try {
        let result = await getErrorTopics();
        if (result) {
          res.set(result.headers);
          res.send(result.payload);
        } else {
          res.status(400).send("Error getting read list");
        }
      } catch (e) {
        console.log("Error getting point errors: ", e);
        res.status(400).send("Error getting point errors");
      }
    });

    //get point errors
    RED.httpAdmin.get("/getmodelstatscsv", async function (req, res) {
      try {
        let result = await getModelStatsData();
        if (result.resultList) {
          let csvResult = jsonToCsv(result.resultList);

          if (csvResult) {
            let headers = {
              "Content-Disposition": 'attachment; filename="' + node.siteName + "_ModelStats_" + getCurrentTimestamp() + '.csv"',
              "Content-Type": "text/csv",
            };
            res.set(headers);
            res.send(csvResult);
          } else {
            res.status(400).send("Error getting read list");
          }
        }
      } catch (e) {
        console.log("Error getting model stats csv ", e);
        res.status(400).send("Error getting model stats csv");
      }
    });

    RED.httpAdmin.get("/publishedpointslist", async function (req, res) {
      try {
        let result = await getPublishedPointsList();
        if (result.payload) {
          res.set(result.headers);
          res.send(result.payload);
        } else {
          res.status(400).send("Error getting published points list");
        }
      } catch (e) {
        console.log("Error getting published points list: ", e);
        res.status(400).send("Error getting published points list");
      }
    });

    // HTTP endpoint to download the HTML directly
    RED.httpAdmin.get("/inspector-downloadhtml", async function (req, res) {
      try {
        // Get filter parameters from query string
        const filterKey = req.query.filter;
        const filterValue = req.query.value;

        // Get app data from your data source with optional filtering
        const appData = await getModelStatsSSRData(filterKey, filterValue);

        // Generate HTML
        const html = await generatePrimeVueAppHtmlStatic(appData, null, {
          title: "BACnet Inspector Export",
          logoBase64: await getLogoAsBase64(path.join(__dirname, "/resources/Logo_Simplified_Positive.svg")),
        });

        // Set headers and send response
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Content-Disposition", `attachment; filename="bacnet-inspector-${Date.now()}.html"`);
        res.send(html);
      } catch (error) {
        console.error("Error generating export:", error);
        res.status(500).send("Error generating export");
      }
    });

    // API Request Handlers End

    // Worker functions

    function setErrorTopics(msg) {
      let topic = msg.topic;
      let error = msg.payload.error;

      // Extract properties only if they exist
      let deviceID = msg.payload.meta?.device?.deviceId;
      let objectType = msg.payload.meta?.objectId?.type;
      let objectInstance = msg.payload.meta?.objectId?.instance;
      let pointName = msg.payload?.objectName;
      let displayName = msg.payload?.displayName;
      let deviceName = msg.payload.meta?.device?.deviceName;

      let ipAddress =
        typeof msg.payload.meta?.device?.address === "object"
          ? msg.payload.meta.device.address.address
          : msg.payload.meta?.device?.address;

      if (error !== undefined && error !== "none") {
        // Use the cache instead of direct flow context access
        cachedData.entriesWithErrors.set(topic, {
          deviceID: deviceID,
          objectType: objectType,
          objectInstance: objectInstance,
          pointName: pointName,
          displayName: displayName,
          deviceName: deviceName,
          ipAddress: ipAddress,
          error: error,
        });

        // Mark as dirty so it will be synced to flow context
        dirtyFlags.entriesWithErrors = true;
      }
    }

    function getErrorTopics() {
      let csvOutput = "topic,deviceID,objectType,objectInstance,pointName,displayName,deviceName,ipAddress,error\n";
      let msg = {};

      // Use the cached entries with errors instead of accessing flow context
      for (const [entry, errorData] of cachedData.entriesWithErrors.entries()) {
        csvOutput =
          csvOutput +
          entry +
          "," +
          errorData.deviceID +
          "," +
          errorData.objectType +
          "," +
          errorData.objectInstance +
          "," +
          errorData.pointName +
          "," +
          errorData.displayName +
          "," +
          errorData.deviceName +
          "," +
          errorData.ipAddress +
          "," +
          errorData.error +
          "\n";
      }

      msg.headers = {
        "Content-Disposition": 'attachment; filename="' + node.siteName + "_PointErrors_" + getCurrentTimestamp() + '.csv"',
        "Content-Type": "text/csv",
      };

      msg.payload = csvOutput;
      msg.topic = "csvOutput";
      return msg;
    }

    //formats a csv data structure for api request of the read list
    function exportTotalReadList() {
      // // NOTE: You must do a full pull of the site (preferably after a reset of the read stats)
      // // to ensure the context is built out correctly and has the correct data before exporting.
      let flow = context.flow;
      let Read_Data = flow.get("ReadList") || {};
      let csvOutputStr = "ipAddress,deviceId,deviceName,pointName,objectType,displayName,area,full topic,objectInstance,key\n";
      let msg = {};

      for (let topic in Read_Data) {
        // Loop through the topic data map

        csvOutputStr =
          csvOutputStr +
          (Read_Data[topic].ipAddress || "") +
          "," +
          (Read_Data[topic].deviceID || "") +
          "," +
          (Read_Data[topic].deviceName || "") +
          "," +
          (Read_Data[topic].pointName || "") +
          "," +
          (Read_Data[topic].objectType === 0 ? "0" : Read_Data[topic].objectType || "") +
          "," + // Ensure "0" is output if objectType is 0
          (Read_Data[topic].displayName || "") +
          "," +
          (Read_Data[topic].area || "") +
          "," + // area
          topic +
          "," +
          (Read_Data[topic].objectInstance || "") +
          "," +
          (Read_Data[topic].key || "") +
          "\n";
      }

      let site_Name = flow.get("site_Name") || "";
      msg.payload = csvOutputStr;
      msg.headers = {
        "Content-Disposition": 'attachment; filename="' + site_Name + "_PointsToRead_" + getCurrentTimestamp() + '.csv"',
        "Content-Type": "text/csv",
      };
      return msg;
    }

    // calculates combined read lists that are linked to the inspector node. Sets to flow context and node status
    function calculateCombinedReadList(node, msg) {
      // Use Set directly from cache for better performance
      let topicSet = cachedData.uniqueReadTopics;
      let pointsToRead = msg.options.pointsToRead;
      let readNodeName = msg.readNodeName;

      var device_info = "";
      var device_IP = "";
      var device_ID = "";
      var device_Name = "";
      var display_Name = "";
      var point_Name = "";
      var area = "";
      var object_Type = -1;
      var object_Instance = -1;

      // Loop through the pointsToRead section
      for (let deviceKey in pointsToRead) {
        // Loop through each device
        let device = pointsToRead[deviceKey]; // Get the device object

        device_info = deviceKey.split("-");
        device_IP = device_info[0];
        device_ID = device_info[1];
        device_Name = device.deviceName;

        area = readNodeName;

        // Loop through each point in the device
        for (let pointKey in device) {
          if (device[pointKey].displayName) {
            display_Name = device[pointKey].displayName;
            point_Name = device[pointKey].objectName;
            object_Type = device[pointKey].meta.objectId.type;
            object_Instance = device[pointKey].meta.objectId.instance;

            // Calculate the topic
            var topic = readNodeName + "/" + display_Name;

            // Get existing entry or create new one
            let topicData = cachedData.ReadList.get(topic) || {};

            // Update properties conditionally if they exist or are explicitly set to 0
            if (device_ID !== undefined) topicData.deviceID = device_ID;
            if (object_Type !== undefined) topicData.objectType = object_Type;
            if (object_Instance !== undefined) topicData.objectInstance = object_Instance;
            if (point_Name !== undefined) topicData.pointName = point_Name;
            if (display_Name !== undefined) topicData.displayName = display_Name;
            if (device_Name !== undefined) topicData.deviceName = device_Name;
            if (device_IP !== undefined) topicData.ipAddress = device_IP;
            if (area !== undefined) topicData.area = area;
            topicData.key = device_ID + ":" + object_Type + ":" + object_Instance;

            // Update the cache
            cachedData.ReadList.set(topic, topicData);
            dirtyFlags.ReadList = true;

            // Add the topic to the set if it's not already present
            if (!topicSet.has(topic)) {
              topicSet.add(topic);
              cachedData.totalUniqueReadCount++;
              dirtyFlags.uniqueReadTopics = true;
              dirtyFlags.totalUniqueReadCount = true;
            }
          }
        }
      }

      // Update the node property
      node.totalUniqueReadCount = cachedData.totalUniqueReadCount;

      // Force sync with flow context to ensure data is immediately available
      syncWithFlowContext();

      // Update the node status
      node.status({ text: "Points To Read: " + cachedData.totalUniqueReadCount });
    }

    function getPublishedPointsList() {
      node.warn("Generating Published Points List...");
      let flow = context.flow;
      let now = new Date();

      let topicDataMap = flow.get("topicDataMap") || {}; // Store presentValue, timestamp, and last value change time per topic
      let totalUniqueCount = flow.get("totalUniquePolledCount") || 0;
      let onlineCount = flow.get("onlineCount") || 0;
      let offlineCount = flow.get("offlineCount") || 0;
      let site_Name = node.siteName;
      let IP_Add = getIPAddresses(); // Get the IP address of the current device
      let IP_Str = "NA";
      if (IP_Add[0]) {
        IP_Str = IP_Add[0].replace(/\./g, "");
      }

      // Calculate the average timeSinceCOVSec across all unique topics
      let totalCOVTime = 0;
      let topicCount = 0;
      let csvOutputStr =
        "ipAddress,deviceId,deviceName,pointName,objectType,displayName,area,full topic,preset value,status,bacnet last seen,lastCovTime (UTC),timeSinceCov (Seconds),timeSinceCov,objectInstance,key\n";

      for (let topic in topicDataMap) {
        // Loop through the topic data map

        let timeDiffMs = now.getTime() - topicDataMap[topic].lastCOVTime; // Calculate the time since last value change
        let hours = Math.floor(timeDiffMs / (1000 * 60 * 60)); // Calculate hours value
        let minutes = Math.floor((timeDiffMs % (1000 * 60 * 60)) / (1000 * 60)); // Calculate minutes value
        let seconds = Math.floor((timeDiffMs % (1000 * 60)) / 1000); // Calculate seconds value

        topicDataMap[topic].timeSinceCOVSec = timeDiffMs / 1000; // Output the time difference as seconds
        topicDataMap[topic].timeSinceCOVFormatted = `${hours}hrs ${minutes}min ${seconds}sec`; // Output as hours, minutes and seconds

        if (topicDataMap[topic].timeSinceCOVSec !== undefined) {
          totalCOVTime += topicDataMap[topic].timeSinceCOVSec;
          topicCount++;
        }

        // Calculate the area
        var area = removeFirstTwoTopicLevels(topic); // Remove the first two levels from the full topic
        area = area.replace(topicDataMap[topic].displayName || "", ""); // Remove the display name
        area = removeTrailingSlash(area); // Remove the trailing slash

        csvOutputStr =
          csvOutputStr +
          (topicDataMap[topic].ipAddress || "") +
          "," +
          (topicDataMap[topic].deviceID || "") +
          "," +
          (topicDataMap[topic].deviceName || "") +
          "," +
          (topicDataMap[topic].pointName || "") +
          "," +
          (topicDataMap[topic].objectType === 0 ? "0" : topicDataMap[topic].objectType || "") +
          "," + // Ensure "0" is output if objectType is 0
          (topicDataMap[topic].displayName || "") +
          "," +
          area +
          "," + // area
          topic +
          "," +
          topicDataMap[topic].presentValue +
          "," +
          topicDataMap[topic].status +
          "," +
          new Date(topicDataMap[topic].bacnetLastSeen).toLocaleString().replace(",", "") +
          "," +
          new Date(topicDataMap[topic].lastCOVTime).toLocaleString().replace(",", "") +
          "," +
          topicDataMap[topic].timeSinceCOVSec +
          "," +
          topicDataMap[topic].timeSinceCOVFormatted +
          "," +
          (topicDataMap[topic].objectInstance || "") +
          "," +
          topicDataMap[topic].key +
          "\n";
      }

      let averageCOVSec = topicCount > 0 ? totalCOVTime / topicCount : 0; // Avoid division by zero
      let newMsg = { payload: "" };

      // Set up the tagging
      const baseMsg = {
        PoolTags: "geoAddr=" + site_Name,
        meta: "geoAddr=" + site_Name
      };

      const lastPointPushedTime = flow.get("Last_Point_Pushed_Time") || "UNKNOWN";

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/LAST_POINT_PUSHED_TIME";
      newMsg.payload = lastPointPushedTime;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/LAST_STAT_CALC_TIME";
      newMsg.payload = now.toISOString();
      node.send([Object.assign({}, baseMsg, newMsg)]);

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/UPTIME";
      newMsg.payload = getUptime();
      node.send([Object.assign({}, baseMsg, newMsg)]);


      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/ONLINE_POINTS";
      newMsg.payload = onlineCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/OFFLINE_POINTS";
      newMsg.payload = offlineCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/TOTAL_POLLED_POINTS";
      newMsg.payload = totalUniqueCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/AVERAGE_TIME_SINCE_COV_IN_SECONDS";
      newMsg.payload = averageCOVSec;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      let totalUniqueReadCount = flow.get("totalUniqueReadCount") || 0;
      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/TOTAL_POINTS_TO_READ";
      newMsg.payload = totalUniqueReadCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      let DiscoveryPointCount = flow.get("discoveryPointCount") || 0;

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/DISCOVERED_POINT_COUNT";
      newMsg.payload = DiscoveryPointCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      let DiscoveryDeviceCount = flow.get("discoveryDeviceCount") || 0;

      newMsg.topic = "EDGE_DEVICE_" + IP_Str + "/STATUS/DISCOVERED_DEVICE_COUNT";
      newMsg.payload = DiscoveryDeviceCount;
      node.send([Object.assign({}, baseMsg, newMsg)]);

      let msg = {};
      msg.payload = csvOutputStr;
      msg.headers = {
        "Content-Disposition": 'attachment; filename="' + site_Name + "_PublishedPointsList_" + getCurrentTimestamp() + '.csv"',
        "Content-Type": "text/csv",
      };

      return msg;
    }

    //calculates bacnet stats on correctly injected msg to inspector node
    //fired on every valid bacnet output
    function getBacnetStats(node, context, msg) {
      let flow = context.flow;
      let now = new Date(); // Create a new Date object

      // Initialize or retrieve the current list of unique topics and the count from the context context
      let uniqueTopics = flow.get("uniqueReadTopics") || [];
      let topicStatusMap = flow.get("topicStatusMap") || {}; // Store status per topic
      let topicDataMap = flow.get("topicDataMap") || {}; // Store presentValue, timestamp, and last value change time per topic
      let totalUniqueCount = flow.get("totalUniquePolledCount") || 0;
      let onlineCount = flow.get("onlineCount") || 0;
      let offlineCount = flow.get("offlineCount") || 0;

      flow.set("site_Name", node.siteName);

      // Calculate the IP address of the edge device
      var IP_Add = getIPAddresses(); // Get the IP address of the current device
      var IP_Str = "NA";
      if (IP_Add[0]) {
        IP_Str = IP_Add[0].replace(/\./g, "");
      } // If an IP address of the first network adapter exists remove the full stops

      // Get the current message's topic, status, presentValue, and timestamp
      let topic = msg.topic;
      let status = msg.payload.status;
      let error = msg.payload.error;
      let presentValue = msg.payload.presentValue;
      let timestamp = msg.payload.timestamp;

      // Extract properties only if they exist
      let deviceID = msg.payload.meta?.device?.deviceId;
      let objectType = msg.payload.meta?.objectId?.type;
      let objectInstance = msg.payload.meta?.objectId?.instance;
      let pointName = msg.payload?.objectName;

      if (pointName !== undefined) {
        pointName = pointName + "_" + getObjectType(objectType) + "_" + objectInstance;
      }

      let displayName = msg.payload?.displayName;
      let deviceName = msg.payload.meta?.device?.deviceName;

      let ipAddress =
        typeof msg.payload.meta?.device?.address === "object"
          ? msg.payload.meta.device.address.address
          : msg.payload.meta?.device?.address;

      // Only proceed if the status key exists
      if (status !== undefined) {
        // Check if the topic is already in the unique topics list
        if (!uniqueTopics.includes(topic)) {
          uniqueTopics.push(topic);
          totalUniqueCount++;
        }

        // Update the status in the topicStatusMap
        if (topicStatusMap[topic] !== status) {
          // Adjust counts based on the previous status
          if (topicStatusMap[topic] === "online") {
            onlineCount--;
          } else if (topicStatusMap[topic] === "offline") {
            offlineCount--;
          }

          // Update with the new status
          topicStatusMap[topic] = status;

          // Adjust counts based on the new status
          if (status === "online") {
            onlineCount++;
          } else if (status === "offline") {
            offlineCount++;
          }
        }

        // Create an entry in the data map if it doesn't already exist
        if (!topicDataMap[topic]) {
          topicDataMap[topic] = {
            presentValue: presentValue,
            status: status,
            bacnetLastSeen: timestamp,
            lastCOVTime: now.getTime(), // Initialize last value change time
          };

          // Add properties conditionally if they exist or are explicitly set to 0
          if (deviceID !== undefined) topicDataMap[topic].deviceID = deviceID;
          if (objectType !== undefined) topicDataMap[topic].objectType = objectType;
          if (objectInstance !== undefined) topicDataMap[topic].objectInstance = objectInstance;
          if (pointName !== undefined) topicDataMap[topic].pointName = pointName;
          if (displayName !== undefined) topicDataMap[topic].displayName = displayName;
          if (deviceName !== undefined) topicDataMap[topic].deviceName = deviceName;
          if (ipAddress !== undefined) topicDataMap[topic].ipAddress = ipAddress;
          if (error !== undefined) topicDataMap[topic].error = error;
          topicDataMap[topic].key =
            topicDataMap[topic].deviceID + ":" + topicDataMap[topic].objectType + ":" + topicDataMap[topic].objectInstance;
        } else {
          // If the entry already exists

          if (presentValue != topicDataMap[topic].presentValue) {
            // If the present value has changed
            topicDataMap[topic].lastCOVTime = now.getTime(); // Update last value change time
          }

          topicDataMap[topic].presentValue = presentValue; // Update the existing timestamp and present value
          topicDataMap[topic].bacnetLastSeen = timestamp; // Update timestamp

          // Update properties conditionally if they exist or are explicitly set to 0
          if (deviceID !== undefined) topicDataMap[topic].deviceID = deviceID;
          if (objectType !== undefined) topicDataMap[topic].objectType = objectType;
          if (objectInstance !== undefined) topicDataMap[topic].objectInstance = objectInstance;
          if (pointName !== undefined) topicDataMap[topic].pointName = pointName;
          if (displayName !== undefined) topicDataMap[topic].displayName = displayName;
          if (deviceName !== undefined) topicDataMap[topic].deviceName = deviceName;
          if (ipAddress !== undefined) topicDataMap[topic].ipAddress = ipAddress;
          if (error !== undefined) topicDataMap[topic].error = error;
          topicDataMap[topic].key =
            topicDataMap[topic].deviceID + ":" + topicDataMap[topic].objectType + ":" + topicDataMap[topic].objectInstance;
        }
      } else {
        node.warn("Status key is missing for topic: " + topic);
      }

      let offlinePercentage = (offlineCount / (onlineCount + offlineCount)) * 100;

      node.statBlock.offlinePercentage = offlinePercentage;

      // Store the updated unique topics, status map, topic data map, and counts back in the context context
      flow.set("uniqueTopics", uniqueTopics);
      flow.set("topicStatusMap", topicStatusMap);
      flow.set("topicDataMap", topicDataMap);
      flow.set("totalUniquePolledCount", totalUniqueCount);
      flow.set("onlineCount", onlineCount);
      flow.set("offlineCount", offlineCount);
      flow.set("offlinePercentage", offlinePercentage);

      // Update the node status
      node.status({ text: "Points Online: " + onlineCount + "/" + totalUniqueCount });
    }

    function makeGetRequest(route) {
      return new Promise((resolve, reject) => {
        try {
          const httpModule = RED.settings.https ? require("https") : require("http");
          let host = RED.settings.uiHost || "localhost";
          if (host === "0.0.0.0") host = "localhost";
          const port = RED.settings.uiPort || 1880;
          const url = `${RED.settings.https ? "https" : "http"}://${host}:${port}${route}`;

          httpModule
            .get(url, (res) => {
              let data = "";
              // A chunk of data has been received
              res.on("data", (chunk) => {
                data += chunk;
              });

              // The whole response has been received
              res.on("end", () => {
                try {
                  const parsedData = JSON.parse(data);
                  resolve(parsedData);
                } catch (e) {
                  resolve(data);
                }
              });
            })
            .on("error", (err) => {
              reject(err);
            });
        } catch (e) {
          reject(err);
        }
      });
    }

    async function parseBacnetInfo() {
      let flow = context.flow;
      try {
        const data = await makeGetRequest("/bitpool-bacnet-data/getNetworkTree");
        if (data) {
          const devices = Object.keys(data.pointList);
          let pointCount = 0;
          for (const guid of devices) {
            const deviceObject = data.pointList[guid];
            const points = Object.keys(deviceObject);
            pointCount = pointCount + points.length;
          }

          flow.set("discoveryPointCount", pointCount);
          flow.set("discoveryDeviceCount", devices.length);
          flow.set("discoveryList", data.pointList);
        }
      } catch (error) {
        //console.error("Error:", error);
      }
    }

    // Worker thread resource management
    let activeWorker = null;
    let isWorkerBusy = false;
    let workerQueue = [];

    // Helper function to run tasks with the worker
    async function runWithWorker(task) {
      // If there's already a task running, queue this one
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
        }

        // Set up promise for worker response
        const workerPromise = new Promise((resolve, reject) => {
          const messageHandler = (data) => {
            activeWorker.removeListener("error", errorHandler);
            activeWorker.removeListener("exit", exitHandler);
            resolve(data);
          };

          const errorHandler = (error) => {
            activeWorker.removeListener("message", messageHandler);
            activeWorker.removeListener("exit", exitHandler);
            reject(error);
          };

          const exitHandler = (code) => {
            activeWorker.removeListener("message", messageHandler);
            activeWorker.removeListener("error", errorHandler);
            if (code !== 0) {
              reject(new Error(`Worker stopped with exit code ${code}`));
            }
          };

          activeWorker.once("message", messageHandler);
          activeWorker.once("error", errorHandler);
          activeWorker.once("exit", exitHandler);

          // Send the task data to the worker
          activeWorker.postMessage(task);
        });

        // Add timeout protection
        const result = await Promise.race([
          workerPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("Worker timeout")), 30000)),
        ]);

        return result;
      } catch (error) {
        throw error;
      } finally {
        isWorkerBusy = false;

        // Process next task in queue if any
        if (workerQueue.length > 0) {
          const nextTask = workerQueue.shift();
          runWithWorker(nextTask.task).then(nextTask.resolve).catch(nextTask.reject);
        } else if (activeWorker) {
          // If queue is empty, terminate worker after a delay to allow for quickly successive requests
          setTimeout(() => {
            if (!isWorkerBusy && activeWorker) {
              activeWorker.terminate().catch((err) => {
                console.error("Error terminating worker:", err);
              });
              activeWorker = null;
            }
          }, 5000); // Keep worker alive for 5 seconds in case of another request
        }
      }
    }

    // used by inspector custom ui page to get all necessary data
    async function getModelStats() {
      let flow = context.flow;

      try {
        await parseBacnetInfo();

        let ReadList = flow.get("ReadList") || {};
        let DiscoveryList = flow.get("discoveryList") || {};
        let PublishList = flow.get("topicDataMap") || {};
        let statBlock = node.statBlock;

        // Use the worker pool instead of creating a new worker each time
        const result = await runWithWorker({
          ReadList,
          DiscoveryList,
          PublishList,
          statBlock,
        });

        // Update the node with the results
        flow.set("discoveryList", DiscoveryList);
        flow.set("topicDataMap", PublishList);
        result.stat_counts.statBlock = result.statBlock;
        node.resultList = result.ResultList;
        node.statCounts = result.stat_counts;
      } catch (e) {
        console.log("getModelStats error: ", e);
      }
    }

    function getModelStatsData() {
      return { siteName: node.siteName, resultList: node.resultList, statCounts: node.statCounts };
    }

    async function getModelStatsSSRData(filterKey = null, filterValue = null) {
      try {
        // Get the base data
        const baseData = await getModelStatsData();

        // If we don't have data yet or need to filter, use the worker
        if (!baseData.resultList || Object.keys(baseData.resultList).length === 0 || (filterKey && filterValue)) {
          const flow = context.flow;

          // First ensure we have discovery info
          await parseBacnetInfo();

          // Get the raw data
          const ReadList = flow.get("ReadList") || {};
          const DiscoveryList = flow.get("discoveryList") || {};
          const PublishList = flow.get("topicDataMap") || {};
          const statBlock = { ...node.statBlock };

          // Process with worker
          const result = await runWithWorker({
            ReadList,
            DiscoveryList,
            PublishList,
            statBlock,
            filterKey,
            filterValue,
          });

          // For SSR data we just need the filtered table data
          let tableData = Object.values(result.ResultList || {});

          // Create a complete statCounts object with all properties
          const completeStatCounts = {
            ...result.stat_counts,
            statBlock: result.statBlock || {}
          };

          return {
            tableData: tableData,
            siteName: baseData.siteName || "Unknown Site",
            statCounts: completeStatCounts,
          };
        }

        // If no filter is applied and we have cached data, use that
        if (!filterKey || !filterValue) {
          // Ensure the statCounts has all required properties
          const completeStatCounts = {
            ...baseData.statCounts,
            statBlock: baseData.statCounts?.statBlock || node.statBlock || {}
          };

          return {
            tableData: Object.values(baseData.resultList),
            siteName: baseData.siteName || "Unknown Site",
            statCounts: completeStatCounts,
          };
        }

        // Apply filtering to cached data
        let tableData = [];
        try {
          // Convert resultList to array and apply filtering
          tableData = Object.values(baseData.resultList).filter((item) => {
            if (!filterKey || !filterValue) return true;

            try {
              // Handle nested properties using dot notation
              const value = filterKey.split(".").reduce((obj, key) => {
                if (obj === null || obj === undefined) return undefined;
                return obj[key];
              }, item);

              // Handle undefined/null values
              if (value === undefined || value === null) {
                return false;
              }

              // Split filter values by comma and trim whitespace
              const filterValues = filterValue.split(",").map((v) => v.trim());

              // Case-insensitive string comparison for string values
              if (typeof value === "string") {
                const valueLower = value.toLowerCase();
                return filterValues.some((filterVal) => valueLower.includes(filterVal.toLowerCase()));
              }

              // Direct comparison for non-string values
              return filterValues.some((filterVal) => {
                // Try to convert filterVal to the same type as value for comparison
                const convertedFilterVal = typeof value === "number" ? Number(filterVal) : filterVal;
                return value === convertedFilterVal;
              });
            } catch (filterError) {
              console.error("Error applying filter:", filterError);
              return false; // Skip items that cause filter errors
            }
          });
        } catch (filterError) {
          console.error("Error processing table data:", filterError);
          // If filtering fails, return all data
          tableData = Object.values(baseData.resultList);
        }

        // Create a complete statCounts object with all properties
        const completeStatCounts = {
          ...result.stat_counts,
          statBlock: result.statBlock || {}
        };

        return {
          tableData: tableData,
          siteName: baseData.siteName || "Unknown Site",
          statCounts: completeStatCounts,
        };
      } catch (error) {
        console.error("Error in getModelStatsSSRData:", error);

        // Return a safe default object in case of errors
        return {
          tableData: [],
          siteName: "Unknown Site",
          statCounts: {},
        };
      }
    }

    // Start Common Functions

    function getCurrentTimestamp() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
      const day = String(now.getDate()).padStart(2, "0");
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const seconds = String(now.getSeconds()).padStart(2, "0");

      return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    }

    // Convert JSON object to CSV
    function jsonToCsv(jsonObject) {
      const rows = [];
      const headers = new Set();

      // Collect all unique headers
      for (const key in jsonObject) {
        Object.keys(jsonObject[key]).forEach((header) => headers.add(header));
      }

      // Convert Set to Array for consistent ordering
      const headersArray = Array.from(headers);
      rows.push(headersArray.join(",")); // Add headers as the first row

      // Add each object's values as rows
      for (const key in jsonObject) {
        const row = headersArray.map((header) => {
          const value = jsonObject[key][header];
          return typeof value === "string" ? `"${value}"` : value ?? "N/A"; // Handle undefined values
        });
        rows.push(row.join(","));
      }

      return rows.join("\n");
    }

    // GET IP ADDRESSES ====================================================================
    // This functions get the IP address of all of the network adapters and returns them in
    // an array.
    // =====================================================================================
    function getIPAddresses() {
      const interfaces = os.networkInterfaces(); // Get the network interfaces object
      let addresses = []; // Delcare an array to hold the addresses
      for (let iface in interfaces) {
        // Loop through each interface
        interfaces[iface].forEach((details) => {
          // Get the IPV4 addres for each interface
          if (details.family === "IPv4" && !details.internal) {
            addresses.push(details.address);
          }
        });
      }
      return addresses; // Return the addresses array
    }

    // CALCULATE SYSTEM UPTIME =============================================================
    // This function calculates the time since last restart of the system.
    // =====================================================================================
    function getUptime() {
      const uptimeSeconds = os.uptime(); // Get the uptime of the system in seconds

      // Calculate days, hours, minutes, and seconds
      const days = Math.floor(uptimeSeconds / (24 * 60 * 60));
      const hours = Math.floor((uptimeSeconds % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((uptimeSeconds % (60 * 60)) / 60);
      const seconds = Math.floor(uptimeSeconds % 60);

      // Format the uptime as a string
      const uptime_str = `Uptime: ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`;

      return uptime_str; // Return the result
    }

    // REMOVE FIRST TWO TOPIC LEVELS =======================================================
    // This function removes the first 2 mqtt topic levels from a string.
    // =====================================================================================
    function removeFirstTwoTopicLevels(topic) {
      const topicLevels = topic.split("/");
      if (topicLevels.length <= 2) {
        // If there are less than or exactly two levels, return an empty string
        return "";
      }
      // Join the remaining levels after the first two
      return topicLevels.slice(2).join("/");
    }

    // REMOVE TRAILING SLASH ===============================================================
    // This function removes the trailing slash from a string.
    // =====================================================================================
    function removeTrailingSlash(str) {
      return str.endsWith("/") ? str.slice(0, -1) : str;
    }

    // GET OBJECT TYPE =====================================================================
    // This function returns the string representation of the object type.
    // =====================================================================================
    function getObjectType(objectId) {
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

    // End Common Functions

    // Clean up resources when node is closed (on redeploy or shutdown)
    this.on("close", function (done) {
      // Clear all intervals
      if (this.batchInterval) {
        clearInterval(this.batchInterval);
        this.batchInterval = null;
      }

      if (this.syncInterval) {
        clearInterval(this.syncInterval);
        this.syncInterval = null;
      }

      // Terminate worker if it exists
      if (activeWorker) {
        activeWorker
          .terminate()
          .then(() => {
            activeWorker = null;
            done();
          })
          .catch((err) => {
            console.error("Error terminating worker:", err);
            activeWorker = null;
            done();
          });
      } else {
        done();
      }
    });

    // Add this function to synchronize statBlock with worker results
    async function syncStatBlockWithWorkerResults() {
      try {
        // Reset the statBlock before getting new stats
        node.statBlock = {
          ok: 0,
          error: 0,
          missing: 0,
          warnings: 0,
          moved: 0,
          deviceIdChange: 0,
          deviceIdConflict: 0,
          unmapped: 0,
          offlinePercentage: node.statBlock.offlinePercentage || 0,
        };

        // Call getModelStats to ensure we have the latest data
        await getModelStats();

        // If we have stat counts from the worker, update the node's statBlock
        if (node.statCounts && node.statCounts.statBlock) {
          // Update node.statBlock with values from worker
          for (let key in node.statCounts.statBlock) {
            node.statBlock[key] = node.statCounts.statBlock[key];
          }
        }
      } catch (error) {
        console.error("Error syncing statBlock with worker results:", error);
      }
    }
  }
  RED.nodes.registerType("Bacnet-Inspector", BacnetInspector);
};
