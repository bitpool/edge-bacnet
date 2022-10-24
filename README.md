<h3>BITPOOL-EDGE BACNET</h3>


---

## About

A Node-RED node that reads and writes to BACnet devices.

This node utilises v0.0.1-beta.13 of the node-bacstack package (https://github.com/fh1ch/node-bacstack). None of the functionality here would be possible without the fantastic work done by the contributors of that project.

Please note: 

 - This project is still in development and by no means perfect. 

 - Gateway node changes require a restart of Node-RED. This includes any networking or interface adapter changes. 

 - If you are using this node in a linux environment, using the 'All interfaces : 0.0.0.0' can be more reliable with a greater range of BACnet devices. 


## Getting Started 

Use the procedures below to install the Bitpool-Edge BACnet node onto your running instance. Then either use the Node-RED help, or read the [wiki](https://wiki.bitpool.com/en/edge/apps/bitpool-edge/nr-bacnet) page to get you started on your next new project.

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

## Resources
- [bitpool.com](https://www.bitpool.com/) - who are we.
- [app.bitpool.com](https://app.bitpool.com/) - our platform.
- [wiki.bitpool.com](https://wiki.bitpool.com/) - helpful docs.
- [hub.docker.com](https://hub.docker.com/r/bitpoolos/bitpool-edge) - pre-canned nodes.

## License

This project is under the MIT license agreement. For more details, see the LICENSE file.


