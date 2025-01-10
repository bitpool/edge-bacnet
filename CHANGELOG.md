# Changelog

## [1.5.2] - 10-01-2025

Mismatched network request hot fix


## [1.5.1] - 13-11-2024

### Summary

Npm package update - iconv-lite. Fix for incorrect character string decoding bug

Added dialog confirmation to rebuild data model. Fixed modal duplication bug in confirmation service implementation.

## [1.5.0] - 31-10-2024

### Summary

Major feature release - Port range binding

Large amount of bug fixes

Added error string to Full Object payload. Contains a BACnet string where an error is found for point, otherwise contains "none".

Proceed with caution as a correct port range has to be established in data model in order to continue uptime on existing sites. Doing a device discovery will update device model with port number.

Best method to update this version on existing installs:

- Install v1.5.0
- Restart node-red / docker container
- Add new port range entry to port range matrix in gateway node - Start: 47808 to End: 47808. Or any range that meets your requirements
- Deploy changes
- Restart node-red / docker container again.
- Inject manual discovery to gateway node a couple times

It is recommended you back up: your node-red flows and gateway Discovery tab device list, incase something goes wrong.

## [1.4.6] - 17-09-2024

### Summary

Minor fixes.

Wrapped updateDeviceName function with promise to avoid network conflict for clients.

Fixed UI styling bugs, primarily with long names and numbers wrapping.

Added ability to set device name of dummy MSTP routers.

Improved error handling for querying devices and building point json structures.

Fixed read node point export bug.

Excluded commas via point name conditioning

Fixed gateway port assignment bug - ability to communicate on different ports working now.

More async / await refactoring.

## [1.4.5] - 16-08-2024

### Summary

User interface redesign and restyle. Predominantly colors, buttons, fonts, and placement of UI components.

Added timestamp update, and online/offline status update for points when an error has occured during the network request for present value. Use in Simple with status and Full Object payload types.

## [1.4.4] - 08-08-2024

### Summary

Minor updates.

Added device details to meta property when full object property type is selected.

Implemented applyDisplayName feature. Triggered via:

```javascript
applyDisplayNames = true;
```

property in an inject node, directly linked to a read node. Function flow: inject applyDisplayNames = true to read node -> read node passes msg to gateway node -> gateway node updates bacnet model for device and point display names.

This feature is for use in scenarios where the flows.json or node json structure is programattically generated with a prefilled pointsToRead property. Some devices and points may need displayNames updating.

## [1.4.3] - 01-08-2024

### Summary

Minor updates.

Added refresh button to readList tab on read node, to handle scenarios where read node jsons may be programatically created.

Added "Use device name in topic" topic property in inject and read nodes. This option toggles whether or not the device name is included in the msg.topic.

Merge github PR 19. Added ability to configure the creation of a BacnetServer object:

```javascript
payload = {
  value: 12,
  resolution: 0,
  priorityArray: 0,
  units: 0,
};
```

Inject nodes may need to be deleted and replaced. Try deploying node-red 2 times to instantiate the new deviceName property.

## [1.4.2] - 23-07-2024

### Summary

Improved UI tree generation, fixing some unique scenarios where devices were not being correctly added.

Added new payload type: Individual JSON. This publishes JSON payloads to a point level, rather than to a device or property level.

Added payload and output types to be configured via Inject node. Any checked options in the inject node will take priority over read node options. Note - to use read node output types only, please deselect all inject node output options.

Added dumb BACnet parent devices to UI tree, for unique situations where MSTP devices are on a network without a parent IP device.

Bug fixes:

- Importing read list was incorrectly generating UI
- Block per device JSON payloads were not using DisplayName and JSON key
- Added node-red context variable to monitor if writeProperty event has been subscribed to, avoiding a new subscription for every node-red deploy.
- Fixed issue requiring Bacnet server to be constantly enabled in order for the node to function.

No nodes need to be deleted and replaced for this update.

## [1.4.1] - 09-07-2024

### Summary

Bug fixes

- incorrect variable used in doRead try catch
- setmaxlisteners on bacnet server event parent class

## [1.4.0] - 05-07-2024

### Summary

Fixed read list export for sites with large point counts.

Removed auto tree reload on read node UI. UI tree must be manually reloaded now.

Fixed export to CSV bug.

Fixed state array text not found bug

Removed unecessary debug.

Updated required json saved to node JSON file.

Added github pull requests - Added create object and delete object to bacnet server - Added write property to bacnet server

Added Simple With Status read property type. - This type sends a msg.payload that consists of {presentValue, timestamp, status} - Status is currently online and offline

Changed inject node to only 1 selectable type of inject (Discover or Poll)

## [1.3.2] - 18-06-2024

### Summary

Bug fix for API request URL paths. Updated for using node-red host setting.

## [1.3.1] - 06-06-2024

### Summary

Primarily bug fixes and performance improvements

### Bug Fixes

- Adding individual points for MSTP devices would add incorrect device name to read list

- Adding individual points for IP devices would add all MSTP network folders to read list

- Intermittent incorrect device naming issues

- Fixed BACnet server incompatibility with YABE and other BACnet browsers.

- Added undefined check to bacstack client

### Improvements

- First poll cycle only queries Object Name and Present Value properties for all applicable Object Types for smaller initial network load. Objects are then back populated with the remaining Object properties on the subsequent poll cycles.

- Devices are immediately added to the UI tree with a device placeholder on a whoIs/iAm response. The devices are then back populated with Names and BACnet Objects. This gives the user a fast understanding of the size and relationships of the BACnet network.

- Added docstrings to bacnet_server.js and code clean up.

- Set Server enable to default on True

## [1.3.0] - 16-05-2024

### Summary

This release includes several new features, bug fixes, and performance improvements.

### New Features

- Moved device "Online" & "Offline" status from coloured text to a green or red circle preceeding the device name

- Implemented MSTP device count icon

- Introduced separate MSTP NET{networkNumber} folders for child MSTP devices for logical separation

- Updated Add All button to add all sub MSTP devices if parent IP device button is selected

- Introduced Right click context menu for all device types present in Device List:

  - Purge Device
    - Purges device from active model, removing it from the device list
  - Update Points
    - Triggers point updating function for selected device, beneficial for large bacnet networks
  - Add All Points
    - Same as Add All button
  - Remove All Points
    - Same as Remove All button
  - Set device name
    - Sets device Display Name, which is used in the output of read operations

- Introduced Right click context menu for all points present in the Device List:

  - Set point Name
    - Sets point display name, used in the output of read operations
  - Update point
    - Triggers point update function, forces latest present value

- Introduced Export and Import of ReadList in the read node.

  - This feature Exports a light weight JSON file with all devices and points added to the Read List. This allows the user to rename all of the devices and points in the Read List via a plain text editor, then Import the modified file. The process of importing will update the Display Names of desired points and device. This feature was introduced with the intention of streamlinibg the naming convetions and processes used for site deployment.

- Added support for debian systems, displays All Interfaces (0.0.0.0) in network adapter property

- Added publish status under gateway node

- Implemented usage of gateway and read node names in MQTT topics
  - {gateway node name}/{read node name}/pointName

### Bug Fixes

- UI Bug Fixes

- Write to MSTP devices bug fix

### Performance Improvements

- Added support for a wider range of devices.

- Added getProtocolsSupported request to identify bacnet service support for each device

- Added apduSize based readPropertyMultiple packaging for reduced network requests

- Refactored device tree function and implemented treeBuilder.

- Refactored device object building / querying process

- Refactored user injected read function

### Other Changes

- Added Changelog

- Updated Readme for better node updating.

- Limited support to a set list of bacnet object types. The intention with this change is to improve performance by disregarding non-essential point types.
