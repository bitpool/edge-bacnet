# Changelog

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
