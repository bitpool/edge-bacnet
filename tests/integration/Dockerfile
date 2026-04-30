# Node-RED with this branch's @bitpoolos/edge-bacnet installed as a palette.
# Built from the repo root: `docker build -f tests/integration/Dockerfile -t <tag> .`
# The build context is the whole repo so we can `npm install` edge-bacnet from local source.
FROM nodered/node-red:latest

USER root
# Copy the source we want to install (the .dockerignore at the repo root keeps
# node_modules / .git / docs out of the layer).
COPY --chown=node-red:node-red . /tmp/edge-bacnet
# Pre-loaded flow with a single Bacnet-Gateway configured to discover devices on
# the test Docker network. With toLogIam=true the gateway will log
# "BACnet device found: <deviceId> - <ip>" when it sees an I-Am — that's what
# the integration step asserts on.
COPY --chown=node-red:node-red tests/integration/flows.json /data/flows.json

# Install edge-bacnet AND its runtime deps into /data/node_modules — that's the
# standard Node-RED palette location and avoids permission issues writing to
# /usr/src/node-red. Run as the node-red user so the resulting tree is owned
# correctly at runtime.
USER node-red
WORKDIR /data
RUN npm install --no-audit --no-fund /tmp/edge-bacnet
