/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

module.exports = function (RED) {
  const { BacnetClient } = require("./bacnet_client");
  const { BacnetClientConfig, getIpAddress } = require("./common");
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
    this.manual_instance_range_enabled = config.manual_instance_range_enabled;
    this.manual_instance_range_start = config.manual_instance_range_start;
    this.manual_instance_range_end = config.manual_instance_range_end;
    this.nodeName = config.name;
    this.toRestartNodeRed = config.toRestartNodeRed;
    this.deviceId = config.deviceId;
    this.logErrorToConsole = config.logErrorToConsole;
    this.bacnetServerEnabled = config.serverEnabled;
    this.retries = config.retries;
    this.bacnetServer = nodeContext.get("bacnetServer") || null;
    this.deviceRangeRegisters = config.deviceRangeRegisters;
    this.cacheFileEnabled = config.cacheFileEnabled;
    this.sanitise_device_schedule = config.sanitise_device_schedule;

    //client and config store
    this.bacnetConfig = nodeContext.get("bacnetConfig");
    this.bacnetClient = nodeContext.get("bacnetClient");
    // client and config names
    this.bacnetClientName = "bacnetClientWrite" + node.id;
    this.bacnetConfigName = "bacnetConfigWrite" + node.id;
    //determines whether or not to log a found device on whoIs response
    this.toLogIam = config.toLogIam;

    node.bacnetConfig = new BacnetClientConfig(
      node.apduTimeout,
      node.localDeviceAddress,
      node.local_device_port,
      node.apduSize,
      node.maxSegments,
      node.broadCastAddr,
      node.discover_polling_schedule,
      node.toRestartNodeRed,
      node.deviceId,
      node.manual_instance_range_enabled,
      node.manual_instance_range_start,
      node.manual_instance_range_end,
      node.device_read_schedule,
      node.retries,
      node.cacheFileEnabled,
      node.sanitise_device_schedule
    );

    nodeContext.set("bacnetConfig", node.bacnetConfig);

    if (typeof node.bacnetClient !== "undefined") {
      node.bacnetClient.removeAllListeners();
      bindEventListeners();
      node.bacnetClient.reinitializeClient(node.bacnetConfig);
    } else {
      node.bacnetClient = new BacnetClient(node.bacnetConfig);
      nodeContext.set("bacnetClient", node.bacnetClient);

      nodeContext.set("serverWritePropEvent", false);
    }

    node.bacnetClient.scanMatrix = node.deviceRangeRegisters.filter((ele) => ele.enabled === true);

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
    node.bacnetClient.on("values", (values, outputType, objectPropertyType, readNodeName, deviceIndex, devicesToRead) => {
      if (typeof values !== "undefined" && Object.keys(values).length) {
        let publishText = `Publishing ${readNodeName} ${deviceIndex} / ${devicesToRead} `;
        node.status({ fill: "blue", shape: "dot", text: publishText });
        if (deviceIndex == devicesToRead) {
          setTimeout(() => {
            node.status({});
          }, 3000);
        }
        let useDeviceName = outputType.useDeviceName;
        if (outputType.json && !outputType.mqtt && !outputType.pointJson) {
          //json
          if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            //simpleWithStatus
            sendSimpleWithStatus(values, readNodeName, true, useDeviceName);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
            //fullObject
            sendJsonAsMqtt(values, readNodeName, useDeviceName);
          } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
            //simplePayload
            sendSimpleJson(values, readNodeName, useDeviceName);
          }
        } else if (outputType.mqtt && !outputType.json && !outputType.pointJson) {
          //mqtt
          if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            //simpleWithStatus
            sendSimpleWithStatus(values, readNodeName, false, useDeviceName);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
            //fullObject
            sendAsMqtt(values, readNodeName, useDeviceName);
          } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
            //simplePayload
            sendSimpleMqtt(values, readNodeName, useDeviceName);
          }
        } else if (outputType.pointJson && !outputType.json && !outputType.mqtt) {
          //pointJson
          if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
            //simpleWithStatus
            sendSimpleWithStatus(values, readNodeName, false, useDeviceName);
          } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
            //fullObject
            sendIndividualMsgJson(values, readNodeName, useDeviceName);
          } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
            //simplePayload
            sendSimpleJsonPerPoint(values, readNodeName, useDeviceName);
          }
        }
      }
    });

    // Who Is / Iam event handler
    node.bacnetClient.on("deviceFound", (device) => {
      if (node.toLogIam) {
        if (device.source) {
          node.warn(
            `BACnet-MS/TP device found: ${device.deviceId} - ${device.address} - Network Id: ${device.source.net} - Mac: ${device.source.adr[0]}`
          );
        } else {
          node.warn(`BACnet device found: ${device.deviceId} - ${device.address}`);
        }
      }
    });

    node.bacnetClient.on("bacnetErrorLog", (param1, param2) => {
      logOut(param1, param2);
    });

    if (
      node.nodeName !== "gateway" &&
      node.nodeName !== "" &&
      node.nodeName !== "null" &&
      node.nodeName !== "undefined" &&
      typeof node.nodeName == "string"
    ) {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.setDeviceName(node.nodeName);
      }
    }

    if (node.bacnetServerEnabled == true && node.bacnetClient && node.bacnetServer && nodeContext.get("serverWritePropEvent") == false) {
      node.bacnetServer.on("writeProperty", (topic, newValue) => {
        let formattedTopic = topic;
        if (
          node.nodeName !== "gateway" &&
          node.nodeName !== "" &&
          node.nodeName !== "null" &&
          node.nodeName !== "undefined" &&
          typeof node.nodeName == "string"
        ) {
          formattedTopic = `${node.nodeName}/BITPOOL_EDGE_BACNET_GATEWAY/BACNET_SERVER/${topic}`;
        } else {
          formattedTopic = `BITPOOL_EDGE_BACNET_GATEWAY/BACNET_SERVER/${topic}`;
        }

        node.send({ payload: newValue, topic: formattedTopic });
      });
      nodeContext.set("serverWritePropEvent", true);
    }

    node.on("input", function (msg) {
      if (msg.topic && msg.payload !== null) {
        if (node.bacnetServer) {
          node.bacnetServer.addObject(msg.topic, msg.payload);
        }
      }

      if (msg.type == "Read") {
        node.bacnetClient.doRead(msg.options, msg.outputType, msg.objectPropertyType, msg.readNodeName);
      } else if (msg.type == "Write") {
        node.bacnetClient.doWrite(msg.value, msg.options);
      } else if (msg.doDiscover == true) {
        node.status({ fill: "blue", shape: "dot", text: "Sending global Who is" });
        node.bacnetClient.globalWhoIs();
        setTimeout(() => {
          node.status({});
        }, 2000);
      } else if (msg.payload == "BindEvents") {
        node.bacnetClient.removeAllListeners();
        bindEventListeners();
      } else if (msg.doUpdatePriorityDevices == true && msg.priorityDevices !== null) {
        node.bacnetClient
          .updatePriorityQueue(msg.priorityDevices)
          .then(function (result) { })
          .catch(function (error) {
            logOut("Error updating priorityQueue: ", error);
          });
      } else if (msg.testFunc == true) {
        node.bacnetClient.testFunction(msg.address, msg.type, msg.instance, msg.property);
      }
    });

    node.on("close", function () {
      //do nothing
    });

    //route handler for network data
    RED.httpAdmin.get("/bitpool-bacnet-data/getNetworkTree", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient: ", node.bacnetClient);
        //no bacnet client present
        res.send(false);
      } else {
        node.bacnetClient
          .getNetworkTreeData()
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error getting network data:  ", error);
          });
      }
    });

    //route handler for rebuild data model command
    RED.httpAdmin.get("/bitpool-bacnet-data/rebuildDataModel", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient: ", node.bacnetClient);
        //no bacnet client present
        res.send(false);
      } else {
        node.bacnetClient
          .rebuildDataModel()
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error getting network data:  ", error);
          });
      }
    });

    //route handler for the clear Bacnet server points function
    RED.httpAdmin.get("/bitpool-bacnet-data/clearBacnetServerPoints", function (req, res) {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.clearServerPoints();
        res.send(true);
      } else {
        res.send(false);
      }
    });

    //route handler for the clear Bacnet server point function
    RED.httpAdmin.post('/bitpool-bacnet-data/clearBacnetServerPoint', function (req, res) {
      if (node.bacnetServerEnabled == true && node.bacnetClient) {
        node.bacnetServer.clearServerPoint(req).then(function (result) {
          res.send(result);
        }).catch(function (error) {
          res.send(error);
        });
      } else {
        res.send(result);
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
    RED.httpAdmin.get("/bitpool-bacnet-data/getNetworkInterfaces", function (req, res) {
      getIpAddress()
        .then(function (result) {
          res.send(result);
        })
        .catch(function (error) {
          logOut("Error getting network interfaces for client: ", error);
        });
    });

    //route handler for getting device list
    RED.httpAdmin.get("/bitpool-bacnet-data/getDeviceList", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while getting device list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .getDeviceList()
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error getting network data:  ", error);
          });
      }
    });

    //route handler for updating device list
    RED.httpAdmin.post("/bitpool-bacnet-data/updateDeviceList", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while getting device list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .updateDeviceList(req)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error getting network data:  ", error);
          });
      }
    });

    //route handler for purge device
    RED.httpAdmin.post("/bitpool-bacnet-data/purgeDevice", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while getting device list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .purgeDevice(req.body.d)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error purging device:  ", error);
          });
      }
    });

    //route handler for updatePointsForDevice
    RED.httpAdmin.post("/bitpool-bacnet-data/updatePointsForDevice", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while updating device points list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .updatePointsForDevice(req.body.d)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error updating device:  ", error);
          });
      }
    });

    //route handler for setDeviceDisplayName
    RED.httpAdmin.post("/bitpool-bacnet-data/setDeviceDisplayName", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while updating device points list: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .setDeviceDisplayName(req.body.d, req.body.n)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error setting device display name:  ", error);
          });
      }
    });

    //route handler for setPointDisplayName
    RED.httpAdmin.post("/bitpool-bacnet-data/setPointDisplayName", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while updating point name: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .setPointDisplayName(req.body.k, req.body.p, req.body.n)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error setting device display name:  ", error);
          });
      }
    });

    //route handler for importReadList
    RED.httpAdmin.post("/bitpool-bacnet-data/importReadList", function (req, res) {
      if (!node.bacnetClient) {
        logOut("Issue with the bacnetClient while updating point name: ", node.bacnetClient);
        res.send(false);
      } else {
        node.bacnetClient
          .importReadList(req.body.p)
          .then(function (result) {
            res.send(result);
          })
          .catch(function (error) {
            res.send(error);
            logOut("Error setting device display name:  ", error);
          });
      }
    });


    function bindEventListeners() {
      // Value response event handler for READ commands
      node.bacnetClient.on("values", (values, outputType, objectPropertyType, readNodeName, deviceIndex, devicesToRead) => {
        if (typeof values !== "undefined" && Object.keys(values).length) {
          let publishText = `Publishing ${readNodeName} ${deviceIndex} / ${devicesToRead} `;
          node.status({ fill: "blue", shape: "dot", text: publishText });
          if (deviceIndex == devicesToRead) {
            setTimeout(() => {
              node.status({});
            }, 3000);
          }
          let useDeviceName = outputType.useDeviceName;
          if (outputType.json && !outputType.mqtt && !outputType.pointJson) {
            //json
            if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
              //simpleWithStatus
              sendSimpleWithStatus(values, readNodeName, true, useDeviceName);
            } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
              //fullObject
              sendJsonAsMqtt(values, readNodeName, useDeviceName);
            } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
              //simplePayload
              sendSimpleJson(values, readNodeName, useDeviceName);
            }
          } else if (outputType.mqtt && !outputType.json && !outputType.pointJson) {
            //mqtt
            if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
              //simpleWithStatus
              sendSimpleWithStatus(values, readNodeName, false, useDeviceName);
            } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
              //fullObject
              sendAsMqtt(values, readNodeName, useDeviceName);
            } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
              //simplePayload
              sendSimpleMqtt(values, readNodeName, useDeviceName);
            }
          } else if (outputType.pointJson && !outputType.json && !outputType.mqtt) {
            //pointJson
            if (objectPropertyType.simpleWithStatus && !objectPropertyType.fullObject && !objectPropertyType.simplePayload) {
              //simpleWithStatus
              sendSimpleWithStatus(values, readNodeName, false, useDeviceName);
            } else if (objectPropertyType.fullObject && !objectPropertyType.simplePayload && !objectPropertyType.simpleWithStatus) {
              //fullObject
              sendIndividualMsgJson(values, readNodeName, useDeviceName);
            } else if (objectPropertyType.simplePayload && !objectPropertyType.fullObject && !objectPropertyType.simpleWithStatus) {
              //simplePayload
              sendSimpleJsonPerPoint(values, readNodeName, useDeviceName);
            }
          }
        }
      });

      // Who Is / Iam event handler
      node.bacnetClient.on("deviceFound", (device) => {
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

    function getTopicString(type, useDeviceName, readNodeName, device, pointName, prop) {
      let topic = "";
      if (
        node.nodeName !== "gateway" &&
        node.nodeName !== "" &&
        node.nodeName !== "null" &&
        node.nodeName !== "undefined" &&
        typeof node.nodeName == "string"
      ) {
        if (readNodeName !== '' &&
          readNodeName !== null &&
          readNodeName !== undefined
        ) {
          if (useDeviceName) {
            topic = `${node.nodeName}/${readNodeName}/${device}`;
          } else {
            topic = `${node.nodeName}/${readNodeName}`;
          }

        } else {
          if (useDeviceName) {
            topic = `${node.nodeName}/${device}`;
          } else {
            topic = `${node.nodeName}`;
          }
        }
      } else {
        if (readNodeName !== '' &&
          readNodeName !== null &&
          readNodeName !== undefined
        ) {
          if (useDeviceName) {
            topic = `BITPOOL_BACNET_GATEWAY/${readNodeName}/${device}`;
          } else {
            topic = `BITPOOL_BACNET_GATEWAY/${readNodeName}`;
          }

        } else {
          if (useDeviceName) {
            topic = `BITPOOL_BACNET_GATEWAY/${device}`;
          } else {
            topic = `BITPOOL_BACNET_GATEWAY`;
          }
        }
      }

      switch (type) {
        case "sendSimpleWithStatus":
          topic += `/${pointName}`;
          break;

        case "sendSimpleWithStatusJson":
          //do nothing
          break;

        case "sendSimpleMqtt":
          topic += `/${pointName}`;
          break;

        case "sendAsMqtt":
          topic += `/${pointName}/${prop}`;
          break;

        case "sendSimpleJson":
          //do nothing
          break;

        case "sendJsonAsMqtt":
          //do nothing
          break;

        case "sendIndividualMsgJson":
          topic += `/${pointName}`;
          break;

        case "sendSimpleJsonPerPoint":
          topic += `/${pointName}`;
          break;

        default:
          break;
      }

      return topic;

    }

    sendSimpleWithStatus = function (values, readNodeName, isJson, useDeviceName) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          let structuredObject = {};
          let msgg = {};
          for (let point in points) {
            if (points[point] && "presentValue" in points[point]) {
              let pointName = getPointName(points[point], point);
              let topic = getTopicString("sendSimpleWithStatus", useDeviceName, readNodeName, device, pointName);

              msgg.topic = topic;
              let payload = {
                presentValue: points[point]["presentValue"],
                timestamp: points[point]["timestamp"],
                status: points[point]["status"]
              };

              if (isJson) {
                //json payload
                structuredObject[point] = payload;
              } else {
                //mqtt payload
                msgg.payload = payload;
                node.send(msgg);
                msgg = {};
              }
            }
          }

          if (isJson) {
            //json payload
            let topic = getTopicString("sendSimpleWithStatusJson", useDeviceName, readNodeName, device);

            msgg.topic = topic;
            msgg.payload = structuredObject;
            node.send(msgg);
            msgg = {};
          }
        }
      });
    }

    sendSimpleMqtt = function (values, readNodeName, useDeviceName) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          for (var point in points) {
            if (points[point]) {
              let pointName = getPointName(points[point], point);
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                let msg = {};
                if (prop == "presentValue") {
                  let topic = getTopicString("sendSimpleMqtt", useDeviceName, readNodeName, device, pointName);

                  msg.topic = topic;
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
    sendAsMqtt = function (values, readNodeName, useDeviceName) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          for (var point in points) {
            if (points[point]) {
              let pointName = getPointName(points[point], point);
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                let msg = {};
                if (prop !== "objectName") {
                  let topic = getTopicString("sendAsMqtt", useDeviceName, readNodeName, device, pointName, prop);
                  msg.topic = topic;
                  msg.payload = points[point][prop];
                  node.send(msg);
                }
              });
            }
          }
        }
      });
    };

    sendSimpleJson = function (values, readNodeName, useDeviceName) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        let msgg = {};
        if (device !== "_msgid") {
          let value = {
            [device]: {},
          };
          let points = values[device];
          for (var point in points) {
            if (points[point]) {
              let pointName = getPointName(points[point], point);
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function (prop) {
                if (prop == "presentValue") {
                  value[device][point] = {
                    presentValue: points[point][prop],
                  };
                }
              });
            }
          }
          let topic = getTopicString("sendSimpleJson", useDeviceName, readNodeName, device);
          msgg.topic = topic;
          msgg.payload = value[device];
          node.send(msgg);
        }
      });
    };

    sendJsonAsMqtt = function (values, readNodeName, useDeviceName) {
      if (typeof values == "object") {
        let keys = Object.keys(values);
        keys.forEach(function (key) {
          let points = values[key];
          let msgg = {};
          let structuredObject = {};

          let topic = getTopicString("sendJsonAsMqtt", useDeviceName, readNodeName, key);
          msgg.topic = topic;

          for (let point in points) {
            let pointName = getPointName(points[point], point);
            structuredObject[pointName] = points[point];
          }
          msgg.payload = structuredObject;
          node.send(msgg);
        });
      }
    };

    sendIndividualMsgJson = function (values, readNodeName, useDeviceName) {
      if (typeof values == "object") {
        let keys = Object.keys(values);
        keys.forEach(function (key) {
          let points = values[key];
          let msgg = {};
          for (let point in points) {
            let pointName = getPointName(points[point], point);
            let topic = getTopicString("sendIndividualMsgJson", useDeviceName, readNodeName, key, pointName);
            msgg.topic = topic;

            msgg.payload = points[point];
            node.send(msgg);
            msgg = {};
          }
        });
      }
    }

    sendSimpleJsonPerPoint = function (values, readNodeName, useDeviceName) {
      let devices = Object.keys(values);
      devices.forEach(function (device) {
        if (device !== "_msgid") {
          let points = values[device];
          let msgg = {};
          for (let point in points) {
            if (points[point] && "presentValue" in points[point]) {
              let pointName = getPointName(points[point], point);
              let topic = getTopicString("sendSimpleJsonPerPoint", useDeviceName, readNodeName, device, pointName);

              msgg.topic = topic;
              let payload = {
                presentValue: points[point]["presentValue"]
              };
              msgg.payload = payload;
              node.send(msgg);
              msgg = {};
            }
          }
        }
      });
    }

    function getPointName(object, pointName) {
      if (object.displayName) {
        return object.displayName;
      }
      return pointName;
    }

  }
  RED.nodes.registerType("Bacnet-Gateway", BitpoolBacnetGatewayDevice);
};
