module.exports = function (RED) {
    function BitpoolBacnetDevice (config) {
      RED.nodes.createNode(this, config)
      this.deviceId_start = config.deviceId_start;
      this.deviceId_end = config.deviceId_end;
      this.address_start = config.address_start;
      this.address_end = config.address_end;
      this.deviceId = getDeviceId(this);
      this.address = getIpAddr(this);

      function getDeviceId(node){
        let start = node.deviceId_start;
        let end = node.deviceId_end;

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

      function getIpAddr(node){
        let start = node.address_start;
        let end = node.address_end;

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
    RED.nodes.registerType('Bitpool-Bacnet-Device', BitpoolBacnetDevice)
  }