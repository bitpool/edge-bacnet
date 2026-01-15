const { queueConfigStore } = require("./common");
const { BacnetDevice } = require("./bacnet_device");

// Global state for smart caching - minimal memory overhead
let lastCacheTime = 0;
let lastDataHash = "";
let cacheInterval = 30000; // Start with 30 seconds
let consecutiveNoChangeCount = 0;
const MAX_CACHE_INTERVAL = 300000; // Max 5 minutes
const MIN_CACHE_INTERVAL = 20000; // Min 20 seconds

/**
 * Simple hash function for change detection
 */
function simpleHash(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return hash.toString();
}

/**
 * The `treeBuilder` class is responsible for building and processing the network tree structure.
 * It takes in a list of devices, a network tree object, a render list, a render list count, and an initial tree build flag.
 * The class provides methods for caching data, processing a device and its points, adding the root device folder to the render list,
 * processing points for a device, processing an individual point, extracting point properties, formatting display name for a point,
 * updating the render list, creating the folder JSON structure for a device, finalizing the network tree data, checking the interrupt flag,
 * getting the device IP address, computing the device name, sorting points, sorting devices, getting the point icon, and getting the device icon.
 *
 * @class
 * @name treeBuilder
 * @param {Array} deviceList - The list of devices.
 * @param {Object} networkTree - The network tree object.
 * @param {Array} renderList - The render list.
 * @param {number} renderListCount - The render list count.
 * @param {boolean} initialTreeBuild - The initial tree build flag.
 */
class treeBuilder {
  constructor(deviceList, networkTree, renderList, renderListCount, initialTreeBuild) {
    this.deviceList = deviceList;
    this.networkTree = networkTree;
    this.renderList = renderList;
    this.renderListCount = renderListCount;
    this.initialTreeBuild = initialTreeBuild;
  }

  /**
   * Smart cache with change detection and adaptive timing.
   * Only writes to file when data actually changes, with intelligent interval adjustment.
   *
   * @returns {void}
   */
  cacheData() {
    const now = Date.now();

    // Always allow caching on initial build
    if (this.initialTreeBuild) {
      this.performCache();
      return;
    }

    // Check if enough time has passed since last cache attempt
    if (now - lastCacheTime < cacheInterval) {
      return; // Skip this cache attempt
    }

    // Prepare data for hashing (only essential data to minimize hash computation)
    const cacheData = {
      deviceList: this.deviceList,
      pointList: this.networkTree,
    };

    // Generate hash of current data
    const currentHash = simpleHash(cacheData);

    // Check if data has actually changed
    if (currentHash === lastDataHash) {
      // No changes detected - increase cache interval (adaptive backing off)
      consecutiveNoChangeCount++;
      // Exponential backoff with cap
      if (consecutiveNoChangeCount >= 3) {
        cacheInterval = Math.min(cacheInterval * 1.5, MAX_CACHE_INTERVAL);
      }

      lastCacheTime = now;
      return; // Skip caching since no changes
    }

    // Data has changed - perform cache and reset adaptive timing
    lastDataHash = currentHash;
    lastCacheTime = now;
    consecutiveNoChangeCount = 0;

    // Reset interval to be more responsive during active changes
    cacheInterval = Math.max(cacheInterval * 0.8, MIN_CACHE_INTERVAL);

    // Perform the actual cache operation
    this.performCache();
  }

  /**
   * Performs the actual cache operation
   */
  performCache() {
    // Cache only the essential data, exclude renderList as it's too large and can be rebuilt
    queueConfigStore({
      deviceList: this.deviceList,
      pointList: this.networkTree,
      // renderList: excluded to reduce file size - will be rebuilt from deviceList and networkTree
      // renderListCount: excluded as it can be recalculated
    });
  }

  /**
   * Process a device and its points.
   *
   * @param {Device} device - The device to process.
   * @param {number} index - The index of the device.
   * @returns {Promise<void>} - A promise that resolves when the device and its points have been processed.
   */
  async processDevice(device, index) {
    const ipAddress = this.getDeviceIpAddress(device);
    const deviceId = device.getDeviceId();
    const deviceName = this.computeDeviceName(device);
    const deviceKey = `${ipAddress}-${deviceId}`;
    const deviceObject = this.networkTree[deviceKey];

    // Add the root device folder to the render list
    if (this.initialTreeBuild) {
      this.addRootDeviceFolder(device, deviceName, index, ipAddress, deviceId);
    }

    // Check if the device object exists and the device name is valid
    if (deviceObject) {
      await this.processDevicePoints(device, deviceObject, deviceName, ipAddress, deviceId, index);

      //delete dummy object if all conditions satisfied
      if (deviceName !== null) {
        if (deviceId !== null) {
          let lastIndex = deviceName.lastIndexOf(deviceId);
          if (lastIndex) {
            let formattedName = deviceName.substring(0, lastIndex);
            formattedName = `${formattedName.trim()}_Device_${deviceId}`;
            if (
              this.networkTree[deviceKey][formattedName] &&
              Object.keys(this.networkTree[deviceKey][formattedName]).length > 0 &&
              this.networkTree[deviceKey]["device"]
            ) {
              delete this.networkTree[deviceKey]["device"];
            }
          }
        }
      }
    } else {
      //invalid ip object, likely dumb mstp router

      if (device.getIsDumbMstpRouter()) {
        //update dumb mstp router name
        await this.updateDumbMstpRouterName(deviceName, ipAddress, deviceId);
      }
    }
  }

  async updateDumbMstpRouterName(deviceName, ipAddress, deviceId) {
    return new Promise((resolve, reject) => {
      let listDeviceIndex = this.renderList.findIndex(
        (item) => item.deviceId == deviceId && item.ipAddr == ipAddress && item.isDumbMstpRouter == true
      );
      if (listDeviceIndex !== -1) {
        this.renderList[listDeviceIndex].label = deviceName;
        this.renderList[listDeviceIndex].data = deviceName;
      }
      resolve();
    });
  }

  /**
   * Add the root device folder to the render list.
   *
   * @param {Object} device - The device object.
   * @param {string} deviceName - The name of the device.
   * @param {number} index - The index of the device.
   * @param {string} ipAddress - The IP address of the device.
   * @param {string} deviceId - The ID of the device.
   * @returns {void}
   */
  addRootDeviceFolder(device, deviceName, index, ipAddress, deviceId) {
    if (!this.renderList) {
      this.renderList = [];
    }

    if (!device.getIsMstpDevice()) {
      let displayName = deviceName ? deviceName : `${ipAddress} - ${deviceId}`;

      // Check if the device already exists in the renderList
      const existingDeviceIndex = this.renderList.findIndex((item) => item.deviceId === deviceId && item.ipAddr === ipAddress);
      if (existingDeviceIndex === -1) {
        // Device not found, add new entry
        let isDumbMstpRouter = false;
        if (device.getIsDumbMstpRouter() && deviceId == null) isDumbMstpRouter = true;
        const rootFolder = {
          key: index,
          label: displayName,
          data: displayName,
          icon: this.getDeviceIcon(device),
          children: [
            {
              key: `${deviceId}-0`,
              label: "Points",
              data: "Points Folder",
              icon: "pi pi-circle-fill",
              type: "pointFolder",
              children: [],
            },
          ],
          type: "device",
          lastSeen: device.getLastSeen(),
          showAdded: false,
          ipAddr: ipAddress,
          deviceId,
          isMstpDevice: device.getIsMstpDevice(),
          initialName: device.getDeviceName(),
          isDumbMstpRouter: isDumbMstpRouter,
        };

        // Add the root folder to the render list
        this.renderList.push(rootFolder);
      }
    }
  }

  addEmptyIpRootDevice(childDevice) {
    const ipAddress = this.getDeviceIpAddress(childDevice);

    //let deviceIndex = this.deviceList.findIndex(ele => ele.address === ipAddress && ele.deviceId === null && ele.deviceName === ipAddress && ele.displayName === ipAddress);
    let deviceIndex = this.deviceList.findIndex((ele) => ele.address === ipAddress && ele.deviceId === null);

    if (deviceIndex === -1) {
      let newDevice = {
        address: ipAddress,
        isMstp: false,
        deviceId: null,
        maxApdu: childDevice.getMaxApdu(),
        segmentation: childDevice.getSegmentation(),
        vendorId: childDevice.getVendorId(),
        lastSeen: null,
        deviceName: ipAddress,
        pointsList: [],
        pointListUpdateTs: null,
        manualDiscoveryMode: false,
        pointListRetryCount: 0,
        priorityQueueIsActive: false,
        priorityQueue: [],
        lastPriorityQueueTS: null,
        childDevices: [childDevice.getDeviceId()],
        parentDeviceId: null,
        displayName: ipAddress,
        protocolServicesSupported: [],
        isProtocolServicesSet: false,
        isInitialQuery: true,
        isDumbMstpRouter: true,
      };

      let newBacnetDevice = new BacnetDevice(true, newDevice);
      this.deviceList.push(newBacnetDevice);
    }
  }

  /**
   * Process the points of a device and add them to the render list.
   *
   * @param {Device} device - The device object.
   * @param {Object} deviceObject - The object containing the points of the device.
   * @param {string} deviceName - The name of the device.
   * @param {string} ipAddress - The IP address of the device.
   * @param {string} deviceId - The ID of the device.
   * @param {number} index - The index of the device.
   * @returns {Promise<void>} - A promise that resolves when the points have been processed and added to the render list.
   */
  async processDevicePoints(device, deviceObject, deviceName, ipAddress, deviceId, index) {
    // Initialize the list of children points
    let children = [];

    // Process each point in the device object
    for (const pointName in deviceObject) {
      // Ensure processing should continue
      this.checkInterruptFlag();

      // Process the point and add it to the list of children
      const point = deviceObject[pointName];
      const childPoint = await this.processPoint(point, pointName, index, deviceName, device);
      children.push(childPoint);
    }

    // Add the device and its children to the render list
    this.updateRenderList(children, device, deviceName, index, ipAddress, deviceId);
  }

  /**
   * Process a point and create a child point object.
   *
   * @param {Object} point - The point to process.
   * @param {string} pointName - The name of the point.
   * @param {number} index - The index of the point.
   * @param {string} deviceName - The name of the parent device.
   * @param {Object} device - The parent device object.
   * @returns {Object} - The child point object.
   */
  async processPoint(point, pointName, index, deviceName, device) {
    // Get the properties and data of the point
    const pointProperties = this.extractPointProperties(point);

    // Determine the point's display name and apply formatting if necessary
    const displayName = this.formatDisplayName(point, pointName);

    // Create the child point object
    return {
      key: `${index}-0-${pointName}`,
      label: displayName,
      data: displayName,
      pointName,
      icon: this.getPointIcon(point),
      children: pointProperties,
      type: "point",
      parentDevice: deviceName,
      parentDeviceId: device.getDeviceId(),
      showAdded: false,
      bacnetType: point.meta.objectId.type,
      bacnetInstance: point.meta.objectId.instance,
    };
  }

  /**
   * Extracts the properties of a point object.
   *
   * @param {Object} point - The point object to extract properties from.
   * @returns {Array} - An array of point properties.
   */
  extractPointProperties(point) {
    const pointProperties = [];

    // Add properties such as name, type, instance, and others
    this.addPointProperty(pointProperties, "Name", point.objectName);
    this.addPointProperty(pointProperties, "Object Type", point.meta.objectId.type);
    this.addPointProperty(pointProperties, "Object Instance", point.meta.objectId.instance);
    this.addPointProperty(pointProperties, "Description", point.description);
    this.addPointProperty(pointProperties, "Units", point.units);
    this.addPointProperty(pointProperties, "Present Value", point.presentValue);
    this.addPointProperty(pointProperties, "System Status", point.systemStatus);
    this.addPointProperty(pointProperties, "Modification Date", point.modificationDate);
    this.addPointProperty(pointProperties, "Program State", point.programState);
    this.addPointProperty(pointProperties, "Record Count", point.recordCount);
    
    // Add device-specific properties (type 8)
    this.addPointProperty(pointProperties, "Vendor Name", point.vendorName);
    this.addPointProperty(pointProperties, "Model Name", point.modelName);
    this.addPointProperty(pointProperties, "Firmware Revision", point.firmwareRevision);
    this.addPointProperty(pointProperties, "Application Software Version", point.applicationSoftwareVersion);

    // Return the array of point properties
    return pointProperties;
  }

  /**
   * Adds a property to the list of point properties.
   *
   * @param {Array} properties - The list of point properties.
   * @param {string} label - The label of the property.
   * @param {any} value - The value of the property.
   * @returns {void}
   */
  addPointProperty(properties, label, value) {
    if (value !== null && value !== undefined && value !== "") {
      properties.push({
        label: `${label}: ${value}`,
        data: value,
        icon: "pi pi-cog",
        children: null,
      });
    }
  }

  /**
   * Formats the display name for a point.
   *
   * If the point has a display name, it returns the display name.
   * Otherwise, it removes any special characters from the point name and returns it.
   *
   * @param {Object} point - The point object.
   * @param {string} pointName - The name of the point.
   * @returns {string} - The formatted display name.
   */
  formatDisplayName(point, pointName) {
    const reg = /[$#\/\\+]/gi;
    if (point.displayName) {
      return point.displayName;
    }
    return pointName.replace(reg, "");
  }

  /**
   * Updates the render list with the folder structure for a device.
   *
   * @param {Array} children - The children of the device.
   * @param {Object} device - The device object.
   * @param {string} deviceName - The name of the device.
   * @param {number} index - The index of the device.
   * @param {string} ipAddress - The IP address of the device.
   * @param {string} deviceId - The ID of the device.
   * @returns {void}
   */
  updateRenderList(children, device, deviceName, index, ipAddress, deviceId) {
    // Create the folder structure for the device
    const folderJson = this.createFolderJson(children, device.hasChildDevices(), deviceId);
    if (!this.renderList) {
      this.renderList = [];
    }

    // Find the device's entry in the render list
    let foundIndex = this.renderList.findIndex((ele) => ele.deviceId == deviceId && ele.ipAddr == ipAddress);

    // If the device is not in the render list, add it as a new entry
    const newDeviceEntry = {
      key: index,
      label: deviceName,
      data: deviceName,
      icon: this.getDeviceIcon(device),
      children: folderJson,
      type: "device",
      lastSeen: device.getLastSeen(),
      showAdded: false,
      ipAddr: ipAddress,
      deviceId,
      isMstpDevice: device.getIsMstpDevice(),
      initialName: device.getDeviceName(),
    };

    if (device.getIsMstpDevice()) {
      // For child MSTP devices, find the parent device and the MSTP network folder
      const parentDeviceId = device.getParentDeviceId();
      const parentDeviceIndex = this.renderList.findIndex((ele) => ele.deviceId == parentDeviceId && ele.ipAddr == ipAddress);
      const mstpNetworkNumber = device.getMstpNetworkNumber();

      if (parentDeviceIndex !== -1) {
        let parentDeviceEntry = this.renderList[parentDeviceIndex];
        let mstpNetworkFolder = parentDeviceEntry.children.find((child) => child.label === `MSTP NET${mstpNetworkNumber}`);

        // Create the MSTP network folder if it doesn't exist
        if (!mstpNetworkFolder) {
          mstpNetworkFolder = {
            key: `${deviceId}-mstp-${mstpNetworkNumber}`,
            label: `MSTP NET${mstpNetworkNumber}`,
            data: `Devices Folder (${mstpNetworkNumber})`,
            icon: "pi pi-database",
            type: "mstpfolder",
            children: [],
          };

          parentDeviceEntry.children.push(mstpNetworkFolder);
        }

        // Add or update the child MSTP device in the MSTP folder
        const mstpDeviceIndex = mstpNetworkFolder.children.findIndex(
          (ele) => ele.deviceId == deviceId && ele.ipAddr == ipAddress
        );
        if (mstpDeviceIndex === -1) {
          mstpNetworkFolder.children.push(newDeviceEntry);
        } else {
          mstpNetworkFolder.children[mstpDeviceIndex] = newDeviceEntry;
        }
      } else {
        //no parent found in render list

        if (parentDeviceId !== null) {
          let parentDeviceListIndex = this.deviceList.findIndex((ele) => ele.getDeviceId() == parentDeviceId);

          if (parentDeviceListIndex !== -1) {
            let parentDevice = this.deviceList[parentDeviceListIndex];
            this.addRootDeviceFolder(
              parentDevice,
              parentDevice.getDeviceName(),
              parentDeviceListIndex,
              parentDevice.getAddress(),
              parentDeviceId
            );
          }
        } else {
          this.addEmptyIpRootDevice(device);
        }
      }
    } else {
      // Add the new device entry to the root of the render list
      if (foundIndex === -1) {
        this.renderList.push(newDeviceEntry);
      } else {
        // If the device is already in the render list, preserve existing MSTP folders
        const existingDevice = this.renderList[foundIndex];

        // Preserve existing MSTP folders while updating the device info
        const existingMstpFolders = existingDevice.children.filter(
          (child) => child.type === "mstpfolder" || (child.label && child.label.includes("MSTP"))
        );

        // Start with the new device structure
        const updatedDevice = { ...newDeviceEntry };

        // Add back any existing MSTP folders
        existingMstpFolders.forEach((mstpFolder) => {
          const existingMstpIndex = updatedDevice.children.findIndex((child) => child.label === mstpFolder.label);
          if (existingMstpIndex === -1) {
            // MSTP folder doesn't exist in new structure, add it
            updatedDevice.children.push(mstpFolder);
          } else {
            // MSTP folder exists, keep the existing one (with all its children)
            updatedDevice.children[existingMstpIndex] = mstpFolder;
          }
        });

        this.renderList[foundIndex] = updatedDevice;
      }
    }
  }

  /**
   * Creates a folder JSON object for the network tree.
   *
   * @param {Array} children - The children nodes of the folder.
   * @param {boolean} hasChildDevices - Indicates if the device has child devices.
   * @param {string} deviceId - The ID of the device.
   * @returns {Array} - The folder JSON object.
   */
  createFolderJson(children, hasChildDevices, deviceId) {
    const folders = [
      {
        key: `${deviceId}-0`,
        label: "Points",
        data: "Points Folder",
        icon: "pi pi-circle-fill",
        type: "pointFolder",
        children: children.sort(this.sortPoints),
      },
    ];

    return folders;
  }

  /**
   * Finalize the network tree data
   *
   * @returns {Object} The finalized network tree data
   * - renderList: The list of devices and their points
   * - deviceList: The list of devices
   * - pointList: The list of points in the network tree
   * - pollFrequency: The polling schedule for discovery
   */
  finalizeNetworkTreeData() {
    this.renderList.sort(this.sortDevices);

    return {
      renderList: this.renderList,
      deviceList: this.deviceList,
      pointList: this.networkTree,
      pollFrequency: this.discover_polling_schedule,
    };
  }

  /**
   * Checks if the buildTreeException flag is set and throws an error if it is.
   *
   * @throws {Error} - Throws an error with the message 'Build tree interrupted' if the buildTreeException flag is set.
   */
  checkInterruptFlag() {
    if (this.buildTreeException) {
      throw new Error("Build tree interrupted");
    }
  }

  /**
   * Returns the IP address of the given device.
   *
   * @param {object} device - The device object.
   * @returns {string} The IP address of the device.
   */
  getDeviceIpAddress(device) {
    switch (typeof device.getAddress()) {
      case "object":
        return device.getAddress().address;
      case "string":
        return device.getAddress();
      default:
        return device.getAddress();
    }
  }

  /**
   * Computes the device name based on the provided device object.
   * If the device has a display name, it will be returned.
   * Otherwise, the device name will be returned.
   *
   * @param {Object} device - The device object.
   * @returns {string} - The computed device name.
   */
  computeDeviceName(device) {
    if (device.getDeviceName() == null && device.getDisplayName() == null) {
      return `${this.getDeviceIpAddress(device)}-${device.getDeviceId()}`;
    } else if (device.getDisplayName() !== null && device.getDisplayName() !== "" && device.getDisplayName() !== undefined) {
      return device.getDisplayName();
    }
    return device.getDeviceName();
  }

  /**
   * Sorts the points based on their BACnet type and label.
   *
   * @param {Object} a - The first point object to compare.
   * @param {Object} b - The second point object to compare.
   * @returns {number} - A negative number if a should be sorted before b, a positive number if b should be sorted before a, or 0 if they are equal.
   */
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

  /**
   * Sorts devices based on their deviceId.
   *
   * @param {Object} a - The first device object to compare.
   * @param {Object} b - The second device object to compare.
   * @returns {number} - Returns -1 if a.deviceId is less than b.deviceId, 1 if a.deviceId is greater than b.deviceId, or 0 if they are equal.
   */
  sortDevices(a, b) {
    if (a.deviceId < b.deviceId) {
      return -1;
    } else if (a.deviceId > b.deviceId) {
      return 1;
    }
    return 0; // deviceIds are equal
  }

  /**
   * Returns the icon class name for a given point based on its object type.
   *
   * @param {Object} values - The values object containing the point's metadata.
   * @returns {string} - The icon class name for the point.
   */
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

  /**
   * Returns the icon for a given device based on its properties.
   *
   * @param {Object} device - The device object.
   * @returns {string} - The icon class name.
   */
  getDeviceIcon(device) {
    const isMstp = device.getIsMstpDevice();
    const manualDiscoveryMode = device.getManualDiscoveryMode();

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

module.exports = { treeBuilder };
