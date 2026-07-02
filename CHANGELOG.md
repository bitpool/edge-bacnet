# Changelog

## [1.7.0] - 02-07-2026

Feature: BACnet Secure Connect (BACnet/SC)

- The gateway node can now participate in BACnet/SC networks (ANSI/ASHRAE 135-2020, ANNEX AB) as an SC node: a new "Datalink" selector on the Gateway tab chooses between "BACnet/IP (UDP)" (default, unchanged behaviour) and "BACnet Secure Connect (hub)".
- SC mode connects out to a site hub over a mutually-authenticated TLS 1.3 WebSocket (subprotocol `hub.bsc.bacnet.org`), with primary + optional failover hub URIs, automatic reconnect with backoff, primary re-probing while on failover, spec heartbeats, and duplicate-VMAC recovery.
- Certificates (CA, operational certificate, private key + optional passphrase) accept pasted PEM or an absolute file path; pasted material is stored encrypted in Node-RED credentials.
- The gateway's device UUID and Random-48 VMAC are generated on first SC start and persisted in `edge-bacnet-sc-identity.cfg` (honours `BACNET_STORAGE_PATH`).
- All existing features work unchanged over SC: whoIs/iAm discovery, point polling, reads/writes, and the local BACnet server objects (served over the same hub connection). Devices are addressed by VMAC where an IP address would appear.
- Node status shows the live SC connection state (connected primary/failover, reconnecting, failed with the spec error taxonomy); the editor dialog shows state, VMAC and UUID.
- After switching datalink mode, devices re-learn their addresses on the first discovery cycle; reader-node point selections re-key to the new addresses (re-select points after a mode switch).
- New: in-repo BACnet/SC test hub for development (`node tools/sc-test-hub.js`) plus a self-signed test PKI generator (`node scripts/generate-sc-test-certs.js`) — dev-only, not part of the published package.
- BACnet/IP is untouched: in IP mode no SC code runs, and the IP wire format is byte-identical to 1.6.10 (regression-checked).
- Requires Node.js >= 18 (engines updated; TLS 1.3 + WebSocket stack).

## [1.6.10] - 01-07-2026

Bug fix:

- Packaging fix to ensure all required runtime files are included in the published package. Recommended upgrade for anyone on 1.6.9. Also carries the discovery fixes listed under 1.6.9.

## [1.6.9] - 01-07-2026

Bug fix:

- Recover missing points during discovery on small MSTP devices (e.g. RC FlexOne) that reject ReadProperty(ALL). When the "read all" attempt fails, discovery now tries a single targeted ReadPropertyMultiple for the required properties before falling back to per-property reads. This avoids the request storm that could cause the device to reject reads and silently drop Analog/Binary Output points from the model.

- Fixed object-type whitelist filter leaking non-whitelisted objects (e.g. trend-logs) into the model. A malformed object-list entry could throw and abort the filter, leaving the point list unfiltered. The filter is now null-safe, so it always applies and only whitelisted object types are kept.

- Added a discovery log when an object is dropped because no OBJECT_NAME was returned (read likely rejected), to aid diagnosis.

## [1.6.8] - 10-03-2026

Bug fix: 

- Spiking values. Large polling sites were experiencing intermittent spiking values, due to a overloaded invokeId stack. This stack has been refactored to be per device, instead of global. 

- Fixed byteLength errors

- Merged github PR's 36 and 37:
  - Fix startup error spam: empty point list during initialization
  - Fix boolean write failures with auto application tag detection

Minor update: 

- Added concurrency management. Max Concurrent Requests option in the gateway node, which throttles how many concurrent requests can be made at any given point.  

## [1.6.7] - 15-01-2026

Bug fix: 

- Fix UI tree rendering issue with MSTP folders

Minor update: 

- Styling
- Added properties to device points and minor change to device point polling

## [1.6.6] - 20-11-2025

Minor update:

- Added all stored point properties as columns to "Export point list" CSV in read node Properties tab.
- Adjustment to point polling, setting stricter maxApdu sizes 

## [1.6.5] - 09-10-2025

Bug fix:

- Specific users found issues of spiking values. Results after a read query are now force ordered. An adjustment made to the bacnet stack _getInvokeId function as it was running out of array space to process a high volume of request responses.


## [1.6.4] - 02-09-2025

Minor feature:

- Small update to file read / write logic for database files. Some deployments require a different storage location outside of the default. If a nodejs environment variable of BACNET_STORAGE_PATH is defined and set for that deployment, it will prefix that location to the file path, otherwise functionality will remain the same.

Bug fix:

- Some mstp devices were not showing in device list UI tree.

## [1.6.3] - 01-06-2025

Minor feature:

- Device List - new right click option to MSTP NET folders - Update All Devices. Specifically updates the mstp device listed in that selected network
- Inspector - Added statistic percentages as MQTT output in the Inspector node
- Inspector - Added online / offline stats and Total points to read as status on node
- Test Functions - Outputs results to both node-red console and node-red debug window now

Minor update / refactor:

- Datamodel - Importing and Exporting datamodel displays process status and related stats (file size etc) while importing or exporting, informing the user of current state
- Device List - UI tree no longer stored in datamodel, as it is generated dynamically on a schedule. This significantly reduces datamodel file size, read / write time, system start up processes.
- Datamodel - writes to file system for persistance and backup was being executed more often than needed. Process schedule is now on a larger interval, and write algorithm refactored and optimized.
- Device List - right click -> Set Point Name feature refactored, due to many scenarios where it wasnt executing as expected.
- BACnet read output - error and status field setting optimized
- Inspector - updated ObjectType column values to show object type enum string instead of integer

Bug fixes:

- Inspector - incorrect percentages, statistics and values in the statistics bar. Fixed and tested to represent site status more accurately
- Inpsector - not flagging offline points in error statistic and table filter. Now correctly identifies "offline" points as an Error type
- BACnet read output - was not updating error and status correctly for full object payloads.
- BACnet Server - was not outputting sucessfull write update MQTT msg after node-red deploy.

Updating:

- There shouldnt be a need for users to remove nodes or do any specific action when updating to this version, however backing up a datamodel export is advised.

## [1.6.2] - 07-05-2025

Minor feature:

- Added "Enable device discovery" check box to gateway settings, discovery tab.
  - This check box controls whether on not the auto point discovery and property discovery is enabled.
  - This can be used to turn off unecessary network traffic once you have discovered all of the desired devices and points.
  - IMPORTANT - if you are updating a existing deployment, the new property will be unticked, however new installs / dragging from the pallete will by default have the option checked. So if you want to keep this enabled on an existing deployment, please check the setting.
  - Note - This does not turn off the whoIs task schedule.
  - A user can use Right Click -> Update points on desired deviced in the read node tree if you would like to manually discover devices.

Minor update:

- Adjusted initial whoIs broadcast delay from 5seconds to 15seconds after node-red is started with a deployed gateway. This is to ensure large cached files are completely read and loaded.

Bug fixes:

- Inspector:
  - Table resized to avoid scroll bars
  - Percentage rounding to nearest 2 decimal places rather than whole integer for more detailed data.
  - Loading animation added
  - NAN years ago - removed as invalid time differential
  - Last seen for device points adjusted to be more accurate

## [1.6.1] - 14-04-2025

Bug fixes:

- Inspector stats were calculating incorrectly in certain scenarios
- Inspector downloaded HTML files had incorrect stat percentages
- Inspector Last_Polled_Time stat was always "UNKNOWN", now shows correct date time.

Minor updates:

- Inspector BACnet main stats now output on msg.type = getBacnetStats inject. Can be set on a scheduled inject.
- Updated Examples with Inspector

## [1.6.0] - 09-04-2025

New features:

- New node - Inspector version 1:

  - Link the outputs of all of your Read nodes and Gateway node into the inspector node for a more detailed analysis of that current state of your site.
  - There is a custom UI which can be viewed once the node is placed and deployed, via the open webpage link in the node properties view.
  - Basic point status statistics can be output in MQTT format via an injection of msg.type = "sendMqttStats" directly into the inspector node. This can be done with a node-red inject node or a bitpool-inject node.
  - The custom UI shows a data table with rich meta data, that can be filtered.
  - The inspector node comes with a variety of API routes that can be used for analysis and engineering
  - API routes available:

    - /inspector

      - view UI in web browser

    - /inspector-downloadhtml

      - downloads the html of the inspector in its current state

    - /inspector-downloadhtml?filter=tableKey&value=value1,value2

      - downloads the html of the inspector, but with a applied filter to the table.
      - tableKey in the above example can be any of the table columns, only 1 tableKey may be filtered on:
        deviceID, objectType, objectInstance, presentValue, dataModelStatus, pointName, discoveredBACnetPointName, displayName, deviceName, ipAddress, area, key, topic, lastSeen, error
      - value=value1,value2 etc can be any value that the tableKey can contain. This parameter can accept many comma separated values
      - an example filter request may look like:
        /inspector-downloadhtml?filter=dataModelStatus&value=error,missing

    - /getModelStats

      - returns JSON data with analysis of the BACnet model
      - contains point status, metrics, and detailed information

    - /pointstoread

      - downloads CSV file with all points in the read list
      - format: [siteName]_PointsToRead_[timestamp].csv

    - /getpointerrors
      - downloads CSV file with all points that have errors
      - format: [siteName]_PointErrors_[timestamp].csv
    - /getmodelstatscsv
      - downloads CSV file with all model stats data in CSV format
      - format: [siteName]_ModelStats_[timestamp].csv
    - /publishedpointslist

      - downloads CSV file with all published points and their current values
      - format: [siteName]_PublishedPointsList_[timestamp].csv
      - outputs mqtt topic and payloads with statistics about the current state of the bacnet network
      - output topics:
        EDGE*DEVICE*{IP*ID}/STATUS/LAST_POINT_PUSHED_TIME
        payload: Timestamp of when the last point was pushed (ISO string)
        EDGE_DEVICE*{IP*ID}/STATUS/LAST_STAT_CALC_TIME
        payload: Current timestamp (ISO string)
        EDGE_DEVICE*{IP*ID}/STATUS/UPTIME
        payload: System uptime formatted as string (e.g., "Uptime: 3 days, 5 hours, 12 minutes, 45 seconds")
        EDGE_DEVICE*{IP*ID}/STATUS/ONLINE_POINTS
        payload: Number of online points
        EDGE_DEVICE*{IP*ID}/STATUS/OFFLINE_POINTS
        payload: Number of offline points
        EDGE_DEVICE*{IP*ID}/STATUS/TOTAL_POLLED_POINTS
        payload: Total number of polled points
        EDGE_DEVICE*{IP*ID}/STATUS/AVERAGE_TIME_SINCE_COV_IN_SECONDS
        payload: Average time since last change of value in seconds
        EDGE_DEVICE*{IP*ID}/STATUS/TOTAL_POINTS_TO_READ
        payload: Total number of points to read
        EDGE_DEVICE*{IP*ID}/STATUS/DISCOVERED_POINT_COUNT
        payload: Number of discovered points
        EDGE_DEVICE*{IP_ID}/STATUS/DISCOVERED_DEVICE_COUNT
        payload: Number of discovered devices

        where {IP_ID} is the IP address of the device with periods removed (e.g., 192.168.1.100 becomes 192168110).
        each of these topics includes the site name as a tag in the message metadata with format geoAddr={siteName}.

  - Additional input options:

    - reset - resets the complete data model used for all of the inspector analytics

      - msg input format: msg.reset = true

    - sendMqttStats - outputs additional mqtt statistics

      - msg input format: msg.type = sendMqttStats
      - output topics:
        EDGE*DEVICE*{siteName}/BACNETSTATS/ok
        payload: Number of points with OK status
        EDGE*DEVICE*{siteName}/BACNETSTATS/error
        payload: Number of points with error status
        EDGE*DEVICE*{siteName}/BACNETSTATS/missing
        payload: Number of missing points
        EDGE*DEVICE*{siteName}/BACNETSTATS/warnings
        payload: Number of points with warnings
        EDGE*DEVICE*{siteName}/BACNETSTATS/moved
        payload: Number of points that have moved (e.g changed object instance)
        EDGE*DEVICE*{siteName}/BACNETSTATS/deviceIdChange
        payload: Number of points with changed device IDs
        EDGE*DEVICE*{siteName}/BACNETSTATS/deviceIdConflict
        payload: Number of points with conflicting device IDs
        EDGE*DEVICE*{siteName}/BACNETSTATS/unmapped
        payload: Number of unmapped points
        EDGE*DEVICE*{siteName}/BACNETSTATS/offlinePercentage
        payload: Percentage of points that are offline

        where {siteName} is the site name configured in the inspector node.

- Right click -> Update Point on a individual point in the device tree. (Read node UI)

- Added programmatic reinitialize/clear points on BACnet server via injecting { msg.reinitializeBacnetServer: true } into the gateway node. Optionally can include a msg.responseTopic string to get a confrimation published to that topic output from the gateway node on sucessfull reinitialize.
  - Example workflow:
    -inject into gateway node:
    ```javascript
    msg = {
      reinitializeBacnetServer: true,
      responseTopic: "/mqtt/subscriber/topic",
    };
    ```
    -upon sucessfull reinitialize, gateway outputs:
    ```javascript
    {
      topic: "/mqtt/subscriber/topic";
      payload: "Server successfully reinitialized";
    }
    ```

Refactor:

- Reading and Writing to the cache file of the datamodel.

  - write operations are now locked to 1 operation at a time
  - a rolling secondary backup file is now created, which can be used in case of corruption of the primary file

- Ported more of the project to async / await program flow vs Promise.then

Bug fixes:

- timeouts removed from import and export database file, as they can be very large.

## [1.5.3] - 23-01-2025

New feature:

- import / export buttons added to new tab in gateway node, used to manage the complete data model for backup or restore
- associated API end points for programatic backing up or restoring - /bitpool-bacnet-data/getDataModel; /bitpool-bacnet-data/updateDataModel;

Further async / await refactoring

Bug fixes:

- incorrect device name in read list export
- read command indexing unhandled scenario
- duplicating points in read list after pressing refresh tree button
- Multi State Values and other state text based points not being handled correctly in large volume scenarios

NOTE:
New importing and exporting feature handles a .json file instead of the .cfg file used in the back end. This is due to browsers flagging .cfg files as malicious. The contents of the file are unchanged.

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
