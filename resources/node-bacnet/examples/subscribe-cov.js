'use strict';

/**
 * This script will discover tze devices and tries to register a COV for ANALOG_INPUT 0
 * The script works very well when the Yabe Room Simulator exe is running
 *
 * After 20s the subscription is cancelled by updating it with a lifetime of 1s
 */

const Bacnet = require('../index');

// you need to run the Weather2 Station of the YABE BACnet package
// https://sourceforge.net/projects/yetanotherbacnetexplorer/

// create instance of Bacnet
const bacnetClient = new Bacnet({apduTimeout: 10000, interface: '0.0.0.0'});

// emitted for each new message
bacnetClient.on('message', (msg, rinfo) => {
  console.log(msg);
  if (rinfo) console.log(rinfo);
});

// emitted on errors
bacnetClient.on('error', (err) => {
  console.error(err);
  bacnetClient.close();
});

// emmitted when Bacnet server listens for incoming UDP packages
bacnetClient.on('listening', () => {
  console.log('sent whoIs ' + Date.now());
  // discover devices once we are listening
  bacnetClient.whoIs();
});

// emitted when "Change of object" Messages are coming in
bacnetClient.on('covNotifyUnconfirmed', (data) => {
  console.log('Received COV: ' + JSON.stringify(data));
});

// emitted when a new device is discovered in the network
bacnetClient.on('iAm', (device) => {
  console.log('Received iAm: ' + JSON.stringify(device, null, 4));
  // address object of discovered device,
  // just use in subsequent calls that are directed to this device
  const address = device.header.sender;

  //discovered device ID
  const deviceId = device.payload.deviceId;
  console.log('Found Device ' + deviceId + ' on ' + JSON.stringify(address));

  // Subscribe changes for RESENT_VALUE of ANALOG_INPUT,0 object
  // lifetime 0 means "for ever"
  bacnetClient.subscribeCov(address, {type: 0, instance: 0}, 85, false, false, 0, (err) => {
    console.log('subscribeCOV' + err);
  });

  // after 20s re-subscribe but with 1s lifetime to stop it
  // I had issues with "cancel" call with the simulated device
  setTimeout(() => {
    bacnetClient.subscribeCov(address, {type: 0, instance: 0}, 85, false, false, 1, (err) => {
      console.log('UnsubscribeCOV' + err);
    });
  }, 20000);

});

// after 30s end the connection
setTimeout(() => {

  bacnetClient.close();
  console.log('closed transport ' + Date.now());

}, 30000); // do not close to fast
