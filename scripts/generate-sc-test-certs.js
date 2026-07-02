'use strict';
/**
 * Generates the BACnet/SC test PKI used by the test suite and the dev test hub:
 * a test CA plus operational certificates for the hub and two nodes, written
 * as PEM files into test/sc/fixtures/ (gitignored — never commit keys).
 *
 *   node scripts/generate-sc-test-certs.js [--force] [--out <dir>]
 *
 * Existing fixtures are kept unless --force is passed. Pure JS (node-forge),
 * no OpenSSL CLI required.
 */
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const OUT_DIR = (() => {
  const flagIndex = process.argv.indexOf('--out');
  if (flagIndex !== -1 && process.argv[flagIndex + 1])
    return path.resolve(process.argv[flagIndex + 1]);
  return path.join(__dirname, '..', 'test', 'sc', 'fixtures');
})();
const FORCE = process.argv.includes('--force');

const FILES = [
  'ca.cert.pem',
  'hub.cert.pem', 'hub.key.pem',
  'node1.cert.pem', 'node1.key.pem',
  'node2.cert.pem', 'node2.key.pem'
];

const subject = (commonName) => [
  { name: 'commonName', value: commonName },
  { name: 'organizationName', value: 'Bitpool BACnet/SC Test PKI' }
];

const makeCert = ({ commonName, serial, issuerCert, issuerKey, isCa, sanDns }) => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  cert.setSubject(subject(commonName));
  cert.setIssuer(issuerCert ? issuerCert.subject.attributes : subject(commonName));
  const extensions = isCa
    ? [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
      ]
    : [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        // BACnet/SC peers are both TLS clients and servers
        { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
        {
          name: 'subjectAltName',
          altNames: (sanDns || ['localhost']).map((dns) => ({ type: 2, value: dns }))
            .concat([{ type: 7, ip: '127.0.0.1' }])
        }
      ];
  cert.setExtensions(extensions);
  cert.sign(issuerKey || keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
};

const main = () => {
  const allPresent = FILES.every((file) => fs.existsSync(path.join(OUT_DIR, file)));
  if (allPresent && !FORCE) {
    console.log(`SC test certificates already present in ${OUT_DIR} (use --force to regenerate)`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Generating BACnet/SC test PKI (RSA-2048, this takes a few seconds)...');
  const ca = makeCert({ commonName: 'Bitpool SC Test CA', serial: '01', isCa: true });
  const hub = makeCert({ commonName: 'sc-test-hub', serial: '02', issuerCert: ca.cert, issuerKey: ca.keys.privateKey });
  const node1 = makeCert({ commonName: 'sc-test-node-1', serial: '03', issuerCert: ca.cert, issuerKey: ca.keys.privateKey });
  const node2 = makeCert({ commonName: 'sc-test-node-2', serial: '04', issuerCert: ca.cert, issuerKey: ca.keys.privateKey });

  const write = (file, pem) => {
    fs.writeFileSync(path.join(OUT_DIR, file), pem);
    console.log(`  wrote ${file}`);
  };
  write('ca.cert.pem', forge.pki.certificateToPem(ca.cert));
  write('hub.cert.pem', forge.pki.certificateToPem(hub.cert));
  write('hub.key.pem', forge.pki.privateKeyToPem(hub.keys.privateKey));
  write('node1.cert.pem', forge.pki.certificateToPem(node1.cert));
  write('node1.key.pem', forge.pki.privateKeyToPem(node1.keys.privateKey));
  write('node2.cert.pem', forge.pki.certificateToPem(node2.cert));
  write('node2.key.pem', forge.pki.privateKeyToPem(node2.keys.privateKey));
  console.log(`Done. Fixtures in ${OUT_DIR}`);
};

main();
