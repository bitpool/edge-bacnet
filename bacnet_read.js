const baEnum = require('./resources/bacstack/lib/enum');

module.exports = function (RED) {
    const { ReadCommandConfig } = require('./common');

    function BitpoolBacnetReadDevice (config) {
      RED.nodes.createNode(this, config);
      var node = this;

      this.json = config.json;
      this.mqtt = config.mqtt;
      this.roundDecimal = config.roundDecimal;
      this.pointsToRead = config.pointsToRead;
      this.readDevices = config.readDevices;
      this.id = config.id;

      this.object_property_presentVal = config.object_property_presentVal;
      this.object_property_objDescription = config.object_property_objDescription;
      this.object_property_statusFlag = config.object_property_statusFlag;
      this.object_property_reliability = config.object_property_reliability;
      this.object_property_outOfService = config.object_property_outOfService;
      this.object_property_units = config.object_property_units;
      this.object_props = getObjectProps(this);

      function getObjectProps(node) {
        var propArr = [];
        if(node.object_property_presentVal == true){
          propArr.push({ id: baEnum.PropertyIds.PROP_PRESENT_VALUE });
        }
        if(node.object_property_objDescription == true){
          propArr.push({ id: baEnum.PropertyIds.PROP_DESCRIPTION });
        }
        if(node.object_property_statusFlag == true){
          propArr.push({ id: baEnum.PropertyIds.PROP_STATUS_FLAGS });
        }
        if(node.object_property_reliability == true){
          propArr.push({ id: baEnum.PropertyIds.PROP_RELIABILITY });
        }
        if(node.object_property_outOfService == true){
          propArr.push({ id: baEnum.PropertyIds.PROP_OUT_OF_SERVICE });
        }
        if(node.object_property_units == true) {
          propArr.push({ id: baEnum.PropertyIds.PROP_UNITS });
        }

        //add object name for every request as its used in formatting
        propArr.push({ id: baEnum.PropertyIds.PROP_OBJECT_NAME});

        return propArr;
      };

      var nodeContext = this.context().flow;

      node.on('input', function(msg) {

        let readConfig = new ReadCommandConfig(node.pointsToRead, node.object_props, node.roundDecimal);

        let output = {
          type: "Read",
          id: node.id,
          options: readConfig,
          outputType: {
            json: node.json,
            mqtt: node.mqtt
          }
        };

        node.send(output);

      });

    };

    RED.nodes.registerType('Bacnet-Discovery', BitpoolBacnetReadDevice);
};