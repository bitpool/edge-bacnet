# Node-RED with this branch's @bitpoolos/edge-bacnet installed as a palette.
# Built from the repo root: `docker build -f tests/integration/Dockerfile -t <tag> .`
# The build context is the whole repo so we can `npm install` edge-bacnet from local source.
# Pinned by digest for deterministic CI. Bump after verifying a newer image works.
FROM nodered/node-red:latest@sha256:a5cb1dcdf90a7148b02b9dba4acfe6bd98c7bf3bff1e845dcdecfd7af3a95a29

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
# correctly at runtime. Don't change WORKDIR — the base image's entrypoint
# (./entrypoint.sh) is relative to /usr/src/node-red.
USER node-red
# --install-links forces npm to TAR + COPY the local package (and resolve its
# runtime deps into /data/node_modules) instead of symlinking to /tmp/edge-bacnet.
# Without this, Node-RED loads edge-bacnet from /tmp via the symlink, looks for
# toad-scheduler etc. relative to /tmp/edge-bacnet/node_modules (which doesn't
# exist), and fails to register the palette.
RUN cd /data && npm install --no-audit --no-fund --install-links /tmp/edge-bacnet
