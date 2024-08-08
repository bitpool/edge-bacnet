/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/



module.exports = function (RED) {
  const { ReadCommandConfig } = require('./common');
  const baEnum = require('./resources/node-bacstack-ts/dist/index.js').enum;

  function BitpoolBacnetReadDevice(config) {
    RED.nodes.createNode(this, config);
    var node = this;

    this.json = config.json;
    this.mqtt = config.mqtt;
    this.pointJson = config.pointJson;
    this.roundDecimal = config.roundDecimal;
    this.pointsToRead = config.pointsToRead;
    this.readDevices = config.readDevices;
    this.id = config.id;
    this.nodeName = config.name;

    this.object_property_simplePayload = config.object_property_simplePayload;
    this.object_property_simpleWithStatus = config.object_property_simpleWithStatus;
    this.object_property_fullObject = config.object_property_fullObject;

    this.useDeviceName = config.useDeviceName;

    this.object_props = getObjectProps(this);

    function getObjectProps(node) {
      var propArr = [];
      if (node.object_property_simplePayload == true) {
        propArr.push({ id: baEnum.PropertyIdentifier.PRESENT_VALUE });
      }
      if (node.object_property_fullObject == true) {
        propArr.push(
          { id: baEnum.PropertyIdentifier.PRESENT_VALUE },
          { id: baEnum.PropertyIdentifier.DESCRIPTION },
          { id: baEnum.PropertyIdentifier.STATUS_FLAGS },
          { id: baEnum.PropertyIdentifier.RELIABILITY },
          { id: baEnum.PropertyIdentifier.OUT_OF_SERVICE },
          { id: baEnum.PropertyIdentifier.UNITS }

        );
      }

      //add object name for every request as its used in formatting
      propArr.push({ id: baEnum.PropertyIdentifier.OBJECT_NAME });

      return propArr;
    };

    node.on('input', function (msg) {

      if (msg.applyDisplayNames) {

        msg.pointsToRead = node.pointsToRead;
        node.send(msg);

      } else {

        node.status({ fill: "blue", shape: "dot", text: "Reading values" });

        let object_property_simplePayload = false;
        let object_property_simpleWithStatus = false;
        let object_property_fullObject = false;

        let jsonType = false;
        let mqttType = false;
        let pointJsonType = false;
        let useDeviceName = false;

        if (msg.simplePayload) {
          object_property_simplePayload = msg.simplePayload;
        } else if (msg.simpleWithStatus) {
          object_property_simpleWithStatus = msg.simpleWithStatus;
        } else if (msg.fullObject) {
          object_property_fullObject = msg.fullObject;
        } else {
          object_property_simplePayload = node.object_property_simplePayload;
          object_property_simpleWithStatus = node.object_property_simpleWithStatus;
          object_property_fullObject = node.object_property_fullObject;
        }

        if (msg.json) {
          jsonType = msg.json;
        } else if (msg.mqtt) {
          mqttType = msg.mqtt;
        } else if (msg.pointJson) {
          pointJsonType = msg.pointJson;
        } else {
          jsonType = node.json;
          mqttType = node.mqtt;
          pointJsonType = node.pointJson
        }

        if (msg.useDeviceName) {
          useDeviceName = msg.useDeviceName;
        } else {
          useDeviceName = node.useDeviceName;
        }

        let readConfig = new ReadCommandConfig(node.pointsToRead, node.object_props, node.roundDecimal);

        let output = {
          type: "Read",
          id: node.id,
          readNodeName: node.nodeName,
          options: readConfig,
          objectPropertyType: {
            simplePayload: object_property_simplePayload,
            simpleWithStatus: object_property_simpleWithStatus,
            fullObject: object_property_fullObject
          },
          outputType: {
            json: jsonType,
            mqtt: mqttType,
            pointJson: pointJsonType,
            useDeviceName: useDeviceName
          }
        };

        node.send(output);

        setTimeout(() => {
          node.status({});
        }, 3000);

      }

    });

  };

  RED.nodes.registerType('Bacnet-Discovery', BitpoolBacnetReadDevice);
};