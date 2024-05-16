<h3>BITPOOL-EDGE BACNET</h3>


---

## About

A Node-RED node that reads and writes to BACnet devices.

## Getting Started 

Use the procedures below to install the Bitpool-Edge BACnet node onto your running instance. Then either use the Node-RED help, or read the [wiki](https://wiki.bitpool.com/bitpool-edge/connectors/bitpool-edge-bacnet) page to get you started on your next new project.

*- Examples are available using the Import->Examples->Flows menu.*

## Installation

Install using the Node-RED manage palette,


```javascript
1. Click the 'Hamburger' icon at the top right corner.

2. Select the 'Manage palette' option.

3. Click the 'Install' tab and type '@bitpoolos/edge-bacnet' into the search field.

4. Find the latest version and click to install.
```

or using NPM from the command line.

```bash
$ npm install @bitpoolos/edge-bacnet
```

## Updating 

The module can be updated via the Node-RED pallette manager, or via the npm cli. 

```javascript
Upon updating to the latest version, we highly recommend:
 - Check out the changelog for latest feature notes and updates 
 - Remove all @bitpoolos/edge-bacnet nodes from all flows 
 - Deploy all flows 
 - Restart Node-RED 
 - Insert and reconfigure new @bitpoolos/edge-bacnet nodes. 
```
Main reason being, the behaviour of the bacnet client binding to network interfaces can remain stagnent if the Node-RED service is not restarted. This also ensures that all of the nodes are correctly configured as there are often properties added and removed from nodes. 


## Changelog 

[Changelog](CHANGELOG.md)

## Notes

 - This project is still in development and by no means perfect. 

 - Gateway node changes require a restart of Node-RED. This includes any networking or interface adapter changes. 

 - If you are using this node in a linux environment, using the 'All interfaces : 0.0.0.0' can be more reliable with a greater range of BACnet devices. 

## Resources
- [bitpool.com](https://www.bitpool.com/) - who are we.
- [wiki.bitpool.com](https://wiki.bitpool.com/) - helpful docs.
- [hub.docker.com](https://hub.docker.com/r/bitpoolos/bitpool-edge) - pre-canned nodes.

## Contributions

This node utilises v1.0.0-beta.2 of the node-bacnet package (https://github.com/HILA-TECH/ts-node-bacstack). None of the functionality here would be possible without the fantastic work done by the contributors of that project, and the original node-bacstack implementation (https://github.com/fh1ch/node-bacstack).

## License

This project is under the MIT license agreement. For more details, see the LICENSE file.


