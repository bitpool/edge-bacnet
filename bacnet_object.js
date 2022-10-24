/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

module.exports = function (RED) {
    const baEnum = require('./resources/bacstack/lib/enum');
    function BitpoolBacnetObject (config) {
      RED.nodes.createNode(this, config)

      this.object_type_ai = config.object_type_ai;
      this.object_type_ao = config.object_type_ao;
      this.object_type_av = config.object_type_av;
      this.object_type_bi = config.object_type_bi;
      this.object_type_bo = config.object_type_bo;
      this.object_type_bv = config.object_type_bv;

      this.object_type_mi = config.object_type_mi;
      this.object_type_mo = config.object_type_mo;
      this.object_type_mv = config.object_type_mv;

      this.object_type = getObjectTypes(this);

      this.object_property_presentVal = config.object_property_presentVal;
      this.object_property_objDescription = config.object_property_objDescription;
      this.object_property_statusFlag = config.object_property_statusFlag;
      this.object_property_reliability = config.object_property_reliability;
      this.object_property_outOfService = config.object_property_outOfService;
      this.object_property_units = config.object_property_units;
      this.object_props = getObjectProps(this);
      
      this.instance_start = config.instance_start;
      this.instance_end = config.instance_end;
      
      this.instance = getInstanceRange(this);

      function getObjectTypes(node) {
        var typeArr = [];
        if(node.object_type_ai == true){
          typeArr.push("0");
        }
        if(node.object_type_ao == true){
          typeArr.push("1");
        }
        if(node.object_type_av == true){
          typeArr.push("2");
        }
        if(node.object_type_bi == true){
          typeArr.push("3");
        }
        if(node.object_type_bo == true){
          typeArr.push("4");
        }
        if(node.object_type_bv == true){
          typeArr.push("5");
        }
        if(node.object_type_mi == true){
          typeArr.push("13");
        }
        if(node.object_type_mo == true){
          typeArr.push("14");
        }
        if(node.object_type_mv == true){
          typeArr.push("19");
        }

        return typeArr.join();
      };

      function getObjectProps(node){
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

      function getInstanceRange(node){
        let start = node.instance_start;
        let end = node.instance_end;

        if(start == end) {
          return start;
        }

        if(start !== end && start < end) {
          return start + " - " + end;
        }

        if(start && !end) {
          return start;
        }
        
        if(start > end){
          return end + " - " + start;
        }
      };

    };


    RED.nodes.registerType('Bitpool-Bacnet-Object', BitpoolBacnetObject)
}