/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

module.exports = function (RED) {
  const { BacnetClient } = require('./bacnet_client');
  const { BacnetClientConfig, getIpAddress, doNodeRedRestart } = require('./common');
  const { exec } = require("child_process");
  const { BacnetServer } = require("./bacnet_server.js");

  function BitpoolBacnetGatewayDevice(config) {
    RED.nodes.createNode(this, config);

    var node = this;
    var nodeContext = this.context().flow;

    //bacnet local device info
    this.localDeviceAddress = config.local_device_address;
    this.local_device_port = config.local_device_port;
    this.apduSize = config.apduSize;
    this.maxSegments = config.maxSegments;
    this.apduTimeout = config.apduTimeout;
    this.broadCastAddr = config.broadCastAddr;
    this.discover_polling_schedule = config.discover_polling_schedule;
    this.device_read_schedule = config.device_read_schedule;
    this.device_id_range_enabled = config.device_id_range_enabled;
    this.device_id_range_start = config.device_id_range_start;
    this.device_id_range_end = config.device_id_range_end;
    this.manual_instance_range_enabled = config.manual_instance_range_enabled,
      this.manual_instance_range_start = config.manual_instance_range_start,
      this.manual_instance_range_end = config.manual_instance_range_end,
      this.nodeName = config.name;
    this.toRestartNodeRed = config.toRestartNodeRed;
    this.deviceId = config.deviceId;
    this.logErrorToConsole = config.logErrorToConsole;
    this.bacnetServerEnabled = config.serverEnabled;
    this.retries = config.retries;
    this.bacnetServer = nodeContext.get("bacnetServer") || null;

    //client and config store
    this.bacnetConfig = nodeContext.get("bacnetConfig");
    this.bacnetClient = nodeContext.get("bacnetClient");
    // client and config names
    this.bacnetClientName = "bacnetClientWrite" + node.id;
    this.bacnetConfigName = "bacnetConfigWrite" + node.id;
    //determines whether or not to log a found device on whoIs response
    this.toLogIam = config.toLogIam;

    this.websocketListener = null;

    node.bacnetConfig = new BacnetClientConfig(
      node.apduTimeout,
      node.localDeviceAddress,
      node.local_device_port,
      node.apduSize,
      node.maxSegments,
      node.broadCastAddr,
      node.discover_polling_schedule,
      node.device_id_range_enabled,
      node.device_id_range_start,
      node.device_id_range_end,
      node.toRestartNodeRed,
      node.deviceId,
      node.manual_instance_range_enabled,
      node.manual_instance_range_start,
      node.manual_instance_range_end,
      node.device_read_schedule,
      node.retries
    );

    nodeContext.set("bacnetConfig", node.bacnetConfig);

    if (typeof node.bacnetClient !== 'undefined') {
      node.bacnetClient.removeAllListeners();
      bindEventListeners();
      node.bacnetClient.reinitializeClient(node.bacnetConfig);
    } else {
      node.bacnetClient = new BacnetClient(node.bacnetConfig);
      nodeContext.set("bacnetClient", node.bacnetClient);
    }

    if (node.bacnetServerEnabled == true && node.bacnetClient && node.bacnetServer) {
      node.bacnetServer.deviceId = node.deviceId;
    }

    node.bacnetClient.bacnetServerEnabled = node.bacnetServerEnabled;

    if (node.bacnetServerEnabled == true && node.bacnetClient) {
      if (node.bacnetServer == null) {

        node.bacnetServer = new BacnetServer(node.bacnetClient, node.deviceId, RED.version());
        nodeContext.set("bacnetServer", node.bacnetServer);
      }
    } else if (node.bacnetServerEnabled == false) {
      node.bacnetServer = null;
    }

    // Clears event handlers of all listeners, avoiding memory leak
    node.bacnetClient.removeAllListeners();

    // Value response event handler for READ commands
    node.bacnetClient.on('values', (values, outputType, objectPropertyType) => {
      if (typeof values !== 'undefined' && Object.keys(values).length) {
        if (outputType.json && !outputType.mqtt) {
          if (objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleJson(values);
            sendJsonAsMqtt(values);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            sendJsonAsMqtt(values);
          } else if (!objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleJson(values);
          }
        } else if (!outputType.json && outputType.mqtt) {
          if (objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendAsMqtt(values);
            sendSimpleMqtt(values);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            sendAsMqtt(values);
          } else if (!objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleMqtt(values);
          }
        }
      }
    });

    // Who Is / Iam event handler
    node.bacnetClient.on('deviceFound', (device) => {
      if (node.toLogIam) {
        if (device.source) {
          node.warn(`BACnet-MS/TP device found: ${device.deviceId} - ${device.address} - Network Id: ${device.source.net} - Mac: ${device.source.adr[0]}`);
        } else {
          node.warn(`BACnet device found: ${device.deviceId} - ${device.address}`);
        }
      }
    });

    node.bacnetClient.on('bacnetErrorLog', (param1, param2) => {
      logOut(param1, param2);
    });

    if (node.nodeName !== "gateway" &&
      node.nodeName !== "" &&
      node.nodeName !== "null" &&
      node.nodeName !== "undefined" &&
      typeof node.nodeName == "string") {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.setDeviceName(node.nodeName);
      }
    }

    node.on('input', function (msg) {

      if (msg.topic && msg.payload !== null) {
        if (node.bacnetServer) {
          node.bacnetServer.addObject(msg.topic, msg.payload);
        }
      }

      if (msg.type == "Read") {

        node.bacnetClient.doRead(msg.options, msg.outputType, msg.objectPropertyType, msg._msgid);

      } else if (msg.type == "Write") {

        node.bacnetClient.doWrite(msg.value, msg.options).then(function (result) {
        });

      } else if (msg.doDiscover == true) {

        node.status({ fill: "blue", shape: "dot", text: "Sending global Who is" })

        node.bacnetClient.globalWhoIs();

        setTimeout(() => {
          node.status({})
        }, 2000);
      } else if (msg.payload == "BindEvents") {
        node.bacnetClient.removeAllListeners();
        bindEventListeners();
      } else if (msg.doUpdatePriorityDevices == true && msg.priorityDevices !== null) {
        node.bacnetClient.updatePriorityQueue(msg.priorityDevices).then(function (result) {
        }).catch(function (error) {
          logOut("Error updating priorityQueue: ", error);
        });
      }

    });

    //route handler for network data
    RED.httpAdmin.get('/bitpool-bacnet-data/getNetworkTree', function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient: ", node.bacnetClient);
        //no bacnet client present
        //node.status({fill:"red",shape:"dot",text:"Please define client"});
        res.send(false);
      } else {
        node.bacnetClient.getNetworkTreeData().then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
          logOut("Error getting network data:  ", error);
        });
      }
    });

    //route handler for rebuild data model command
    RED.httpAdmin.get('/bitpool-bacnet-data/rebuildDataModel', function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient: ", node.bacnetClient);
        //no bacnet client present
        //node.status({fill:"red",shape:"dot",text:"Please define client"});
        res.send(false);
      } else {
        node.bacnetClient.rebuildDataModel().then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
          logOut("Error getting network data:  ", error);
        });
      }
    });

    //route handler for the clear Bacnet server points function
    RED.httpAdmin.get('/bitpool-bacnet-data/clearBacnetServerPoints', function (req, res) {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.clearServerPoints();
        res.send(true);
      } else {
        res.send(false);
      }
    });

    //route handler for the retrieve Bacnet server points function
    RED.httpAdmin.get('/bitpool-bacnet-data/getBacnetServerPoints', function (req, res) {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.getServerPoints().then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
          logOut("Error getting server points:  ", error);
        });
      } else {
        res.send([]);
      }
    });

    //route handler for network data
    RED.httpAdmin.get('/bitpool-bacnet-data/getNetworkInterfaces', function (req, res) {
      getIpAddress().then(function (result) {
        res.send(result);
      }).catch(function (error) {
        logOut("Error getting network interfaces for client: ", error);
      });
    });

    //route handler for getting device list
    RED.httpAdmin.get('/bitpool-bacnet-data/getDeviceList', function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while getting device list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient.getDeviceList().then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
          logOut("Error getting network data:  ", error);
        });
      }
    });

    //route handler for updating device list
    RED.httpAdmin.post('/bitpool-bacnet-data/updateDeviceList', function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while getting device list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient.updateDeviceList(req).then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
          logOut("Error getting network data:  ", error);
        });
      }
    });

    node.on('close', function () {
      //do nothing
    });

    function bindEventListeners() {
      // Value response event handler for READ commands
      node.bacnetClient.on('values', (device, values, outputType, msgId, fullResult) => {
        if (outputType.json && !outputType.mqtt) {
          if (objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleJson(values);
            sendJsonAsMqtt(values);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            sendJsonAsMqtt(values);
          } else if (!objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleJson(values);
          }
        } else if (!outputType.json && outputType.mqtt) {
          if (objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendAsMqtt(values);
            sendSimpleMqtt(values);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            sendAsMqtt(values);
          } else if (!objectPropertyType.fullObject && objectPropertyType.simplePayload) {
            sendSimpleMqtt(values);
          }
        }
      });

      // Who Is / Iam event handler
      node.bacnetClient.on('deviceFound', (device) => {
        if (node.toLogIam) node.warn(`BACnet device found: ${device.deviceId} - ${device.address}`);
      });
    }

    function logOut(param1, param2) {
      if (node.logErrorToConsole == true) {
        if (arguments.length == 1) {
          console.log("BACnet Error: ");
          console.log(param1);
        } else if (arguments.length == 2) {
          console.log("BACnet Error: ");
          console.log(param1, param2);
        }
      }
    }

    sendSimpleMqtt = function (values) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          for (var point in points) {
            if (points[point]) {
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                let msg = {};
                if (prop == "presentValue") {
                  if (node.nodeName !== "gateway" &&
                    node.nodeName !== "" &&
                    node.nodeName !== "null" &&
                    node.nodeName !== "undefined" &&
                    typeof node.nodeName == "string") {
                    msg.topic = `${node.nodeName}/${device}/${point}`;
                  } else {
                    msg.topic = `BITPOOL_BACNET_GATEWAY/${device}/${point}`;
                  }
                  msg.payload = points[point][prop];
                  node.send(msg);
                }
              });

            }
          }
        }
      });
    };


    // Breaks down response JSON object into mqtt topic / payload
    sendAsMqtt = function (values) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          for (var point in points) {
            if (points[point]) {
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                let msg = {};
                if (prop !== "objectName") {
                  if (node.nodeName !== "gateway" &&
                    node.nodeName !== "" &&
                    node.nodeName !== "null" &&
                    node.nodeName !== "undefined" &&
                    typeof node.nodeName == "string") {
                    msg.topic = `${node.nodeName}/${device}/${point}/${prop}`;
                  } else {
                    msg.topic = `BITPOOL_BACNET_GATEWAY/${device}/${point}/${prop}`;
                  }
                  msg.payload = points[point][prop];
                  node.send(msg);
                }
              });
            }
          }
        }
      });
    };

    sendSimpleJson = function (values) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        let msgg = {};
        if (device !== "_msgid") {
          let value = {
            [device]: {}
          };
          let points = values[device];

          for (var point in points) {
            if (points[point]) {
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                if (prop == "presentValue") {
                  value[device][point] = {
                    "presentValue": points[point][prop]
                  };
                }
              });
            }

          }
          if (node.nodeName !== "gateway" &&
            node.nodeName !== "" &&
            node.nodeName !== "null" &&
            node.nodeName !== "undefined" &&
            typeof node.nodeName == "string") {
            msgg.topic = `${node.nodeName}/${device}`;
          } else {
            msgg.topic = `BITPOOL_BACNET_GATEWAY/${device}`;
          }
          msgg.payload = value[device];
          node.send(msgg);
        }
      });
    };

    sendJsonAsMqtt = function (values) {
      if (typeof values == "object") {
        let keys = Object.keys(values);
        keys.forEach(function (key) {
          let points = values[key];
          let msgg = {};

          if (node.nodeName !== "gateway" &&
            node.nodeName !== "" &&
            node.nodeName !== "null" &&
            node.nodeName !== "undefined" &&
            typeof node.nodeName == "string") {
            msgg.topic = `${node.nodeName}/${key}`;
          } else {
            msgg.topic = `BITPOOL_BACNET_GATEWAY/${key}`;
          }
          msgg.payload = points;
          node.send(msgg);
        });
      }
    };

  };

  RED.nodes.registerType('Bacnet-Gateway', BitpoolBacnetGatewayDevice);
};