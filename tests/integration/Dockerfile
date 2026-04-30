# Node-RED with this branch's @bitpoolos/edge-bacnet installed as a palette.
# Built from the repo root: `docker build -f tests/integration/Dockerfile -t <tag> .`
# The build context is the whole repo so we can `npm install` edge-bacnet from local source.
FROM nodered/node-red:latest

# Install edge-bacnet from the local source we COPY in (so the test exercises THIS branch,
# not whatever's published on npm).
USER root
COPY --chown=node-red:node-red . /tmp/edge-bacnet
WORKDIR /usr/src/node-red
RUN su node-red -s /bin/sh -c "npm install /tmp/edge-bacnet --no-audit --no-fund --omit=dev"

# Pre-loaded flow with a single Bacnet-Gateway configured to discover devices on the
# test Docker network. With toLogIam=true the gateway will log
# "BACnet device found: <deviceId> - <ip>" when it sees an I-Am — that's what the
# integration step asserts on.
COPY --chown=node-red:node-red tests/integration/flows.json /data/flows.json

USER node-red
