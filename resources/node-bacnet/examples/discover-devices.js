'use strict';

/**
 * This script will discover all devices in the network and print out their names
 *
 * After 30s the discovery is stopped automatically
 */

const Bacnet = require('../index');

// create instance of Bacnet
const bacnetClient = new Bacnet({apduTimeout: 10000, interface: '0.0.0.0'});

// emitted on errors
bacnetClient.on('error', (err) => {
  console.error(err);
  bacnetClient.close();
});

// emmitted when Bacnet server listens for incoming UDP packages
bacnetClient.on('listening', () => {
  console.log('discovering devices for 30 seconds ...');
  // discover devices once we are listening
  bacnetClient.whoIs();

  setTimeout(() => {
    bacnetClient.close();
    console.log('closed transport ' + Date.now());
  }, 30000);

});

const knownDevices = [];

// emitted when a new device is discovered in the network
bacnetClient.on('iAm', (device) => {
  // address object of discovered device,
  // just use in subsequent calls that are directed to this device
  const address = device.header.sender;

  //discovered device ID
  const deviceId = device.payload.deviceId;
  if (knownDevices.includes(deviceId)) return;

  bacnetClient.readProperty(address, {type: 8, instance: deviceId}, Bacnet.enum.PropertyIdentifier.OBJECT_NAME, (err, value) => {
    if (err) {
      console.log('Found Device ' + deviceId + ' on ' + JSON.stringify(address));
      console.log(err);
    } else {
      bacnetClient.readProperty(address, {type: 8, instance: deviceId}, Bacnet.enum.PropertyIdentifier.OBJECT_NAME, (err2, valueVendor) => {

        if (value && value.values && value.values[0].value) {
          console.log('Found Device ' + deviceId + ' on ' + JSON.stringify(address) + ': ' + value.values[0].value);
        } else {
          console.log('Found Device ' + deviceId + ' on ' + JSON.stringify(address));
          console.log('value: ', JSON.stringify(value));
        }
        if (!err2 && valueVendor && valueVendor.values && valueVendor.values[0].value) {
          console.log('Vendor: ' + valueVendor.values[0].value);
        }
        console.log();
      });
    }
  });
  knownDevices.push(deviceId);
});
