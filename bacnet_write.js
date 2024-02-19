/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

module.exports = function (RED) {
    function BitpoolBacnetWriteDevice (config) {
      RED.nodes.createNode(this, config);
      var node = this;
      node.priority = config.priority;
      node.appTag = config.applicationTag;
      node.pointsToWrite = config.pointsToWrite;
      node.writeDevices = config.writeDevices;

      this.id = config.id;

      node.on('input', function(msg) {

        let value = msg.payload == "null" ? null : msg.payload;
        let priority = node.priority == "null" ? null : parseInt(node.priority);

        let output = {
          type: "Write",
          id: node.id,
          options: {
            priority: priority,
            appTag: parseInt(node.appTag),
            pointsToWrite: node.pointsToWrite
          },
          value: value,
          outputType: {
            json: node.json,
            mqtt: node.mqtt
          }
        };

        node.send(output);
      });

      node.on('close', function() {
        //do nothing
      });

    };

    RED.nodes.registerType('Bacnet-Write', BitpoolBacnetWriteDevice);
};