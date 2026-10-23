import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => {
  throw new Error('Offline acceptance: network forbidden');
};
net.connect = net.createConnection = deny;
net.Socket.prototype.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = dns.resolve = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
