/*
  MIT License Copyright 2021, 2022 - Bitpool Pty Ltd
*/

module.exports = function (RED) {
    const { BacnetClient } = require('./bacnet_client');
    const { BacnetClientConfig, getIpAddress } = require('./common');

    function BitpoolBacnetGatewayDevice (config) {
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
      this.device_id_range_enabled = config.device_id_range_enabled;
      this.device_id_range_start = config.device_id_range_start;
      this.device_id_range_end = config.device_id_range_end;

      //client and config store
      this.bacnetConfig = nodeContext.get("bacnetConfig");
      this.bacnetClient = nodeContext.get("bacnetClient");
      // client and config names
      this.bacnetClientName = "bacnetClientWrite"  + node.id;
      this.bacnetConfigName = "bacnetConfigWrite"  + node.id;
      //determines whether or not to log a found device on whoIs response
      this.toLogIam = config.toLogIam;

      this.websocketListener = null;

      if(node.apduTimeout && 
        node.localDeviceAddress &&
        node.local_device_port &&
        node.apduSize &&
        node.maxSegments &&
        node.broadCastAddr &&
        node.discover_polling_schedule) {

        //sets up or reinitializes node and bacnet device
          if(configHasChanged()) {
            
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
              node.device_id_range_end
            );
            nodeContext.set("bacnetConfig", node.bacnetConfig);

            if(typeof node.bacnetClient !== 'undefined') {
              node.bacnetClient.reinitializeClient(node.bacnetConfig);
              node.bacnetClient.removeAllListeners();
              bindEventListeners();
            } else {
              node.bacnetClient = new BacnetClient(node.bacnetConfig);
              nodeContext.set("bacnetClient", node.bacnetClient);
            }
          }

          // Clears event handlers of all listeners, avoiding memory leak
          node.bacnetClient.removeAllListeners();

          //bindEventListeners();

          // Value response event handler for READ commands
          node.bacnetClient.on('values', (device, values, outputType, msgId, fullResult) => {
            if(typeof values !== 'undefined' && Object.keys(values).length) {
              if (outputType.json && !outputType.mqtt) {
                node.send(values);
              } else if(!outputType.json && outputType.mqtt) {
                sendAsMqtt(values);
              } else if(outputType.json && outputType.mqtt) {
                node.send(values);
                sendAsMqtt(values);
              }
            }
          });

          // Who Is / Iam event handler
          node.bacnetClient.on('deviceFound', (device) => {
            if(node.toLogIam) node.warn(`Device found:  ${device.address}`);
          });

          node.status({});

      } else {
        console.log("Issue with client info: ", node);
        // No client information found
        node.status({fill:"red",shape:"dot",text:"Please define client"})
      }
      
      node.on('input', function(msg) {
        if(msg.type == "Read") {

          node.bacnetClient.doRead(msg.options, msg.outputType, msg._msgid);

        } else if(msg.type == "Write") {

          node.bacnetClient.doWrite(msg.value, msg.options).then(function(result){
          });

        } else if(msg.doDiscover == true) {

          node.status({fill:"blue",shape:"dot",text:"Forcing a global Who is"})

          node.bacnetClient.globalWhoIs();

          setTimeout(()=>{
            node.status({})
          }, 2000);
        } else if(msg.payload == "BindEvents") {
          node.bacnetClient.removeAllListeners();
          bindEventListeners();
        }
      });

      //route handler for network data
      RED.httpAdmin.get('/bitpool-bacnet-data/getNetworkTree', function(req, res) {
        if(!node.bacnetClient) {
          console.log("Issue with the bacnetClient: ", node.bacnetClient);
          //no bacnet client present
          node.status({fill:"red",shape:"dot",text:"Please define client"});
          res.send(false);
        } else {
          node.bacnetClient.getNetworkTreeData().then(function(result) {
            res.send(result);
          }).catch(function(error) {
            res.send(error);
            console.log("Error getting network data:  ", error);
          });
        }   
      });

      //route handler for network data
      RED.httpAdmin.get('/bitpool-bacnet-data/getNetworkInterfaces', function(req, res) {
        getIpAddress().then(function(result) {
          res.send(result);
        }).catch(function(error) {
          console.log("Error getting network interfaces for client: ", error);
        });
      });

      node.on('close', function() {
        //do nothing
      });

      function bindEventListeners() {
        // Value response event handler for READ commands
        node.bacnetClient.on('values', (device, values, outputType, msgId, fullResult) => {
          if(typeof values !== 'undefined' && Object.keys(values).length) {
            if (outputType.json && !outputType.mqtt) {
              node.send(values);
            } else if(!outputType.json && outputType.mqtt) {
              sendAsMqtt(values);
            } else if(outputType.json && outputType.mqtt) {
              node.send(values);
              sendAsMqtt(values);
            }
          }
        });

        // Who Is / Iam event handler
        node.bacnetClient.on('deviceFound', (device) => {
          if(node.toLogIam) node.warn(`Device found:  ${device.address}`);
        });
      }

      // Returns true if any config values have changed
      function configHasChanged() {
        if(node.bacnetConfig == null){ return true;}
        if(node.bacnetClient == null){ return true;}
        if(node.localDeviceAddress !== node.bacnetConfig.localIpAdrress){ return true;}
        if(node.local_device_port !== node.bacnetConfig.port){ return true;}
        if(node.apduSize !== node.bacnetConfig.apduSize){ return true;}
        if(node.maxSegments !== node.bacnetConfig.maxSegments){ return true;}
        if(node.broadCastAddr !== node.bacnetConfig.broadCastAddr){ return true;}
        if(node.apduTimeout !== node.bacnetConfig.apduTimeout){ return true;}
        if(node.device_id_range_enabled !== node.bacnetConfig.device_id_range_enabled){ return true;}
        if(node.device_id_range_start !== node.bacnetConfig.device_id_range_start){ return true;}
        if(node.device_id_range_end !== node.bacnetConfig.device_id_range_end){ return true;}

        return false;
      };

      // Breaks down response JSON object into mqtt topic / payload
      sendAsMqtt = function(values) {
        let devices = Object.keys(values);
        devices.forEach(function(device) {
          if(device !== "_msgid") {
            let points = values[device];
            for(var point in points) {
              let pointProps = Object.keys(points[point]);
              pointProps.forEach(function(prop) {
                let msg = {};
                if(prop !== "objectName") {
                  msg.topic = `BITPOOL_EDGE_BACNET/${device}/${point}/${prop}`;
                  msg.payload = points[point][prop];
                  node.send(msg);
                }
              });
            }
          }
        });
      };

    };

    RED.nodes.registerType('Bacnet-Gateway', BitpoolBacnetGatewayDevice);
};