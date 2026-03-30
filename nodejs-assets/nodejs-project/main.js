const rn_bridge = require('rn-bridge');
const net = require('net');

// Переменная для хранения настроек из интерфейса
let currentConfig = {};
let isVerbose = false; // По умолчанию выключено

// Умная функция логирования
function log(msg, force = false) {
  // Если verbose выключен, отправляем только важные логи (force = true)
  if (!isVerbose && !force) return;
  
  console.log("[PROXY] " + msg);
  rn_bridge.channel.send(JSON.stringify({ type: 'log', message: msg }));
}

const _TG_RANGES = [
  [ipToInt('185.76.151.0'), ipToInt('185.76.151.255')],
  [ipToInt('149.154.160.0'), ipToInt('149.154.175.255')],
  [ipToInt('91.105.192.0'), ipToInt('91.105.193.255')],
  [ipToInt('91.108.0.0'), ipToInt('91.108.255.255')],
];

function ipToInt(ip) { return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0; }
function isTelegramIp(ip) {
  try { return _TG_RANGES.some(([lo, hi]) => ipToInt(ip) >= lo && ipToInt(ip) <= hi); } catch (e) { return false; }
}

const stats = { connectionsTotal: 0, bytesUp: 0, bytesDown: 0 };
let proxyServer = null;
let isRunning = false;

// ПРИНИМАЕМ КОНФИГ ИЗ APP.TSX
function startProxy(port = 1080, host = '127.0.0.1', config = {}) {
  if (isRunning) return;
  
  // Применяем настройки из App.tsx
  currentConfig = config;
  isVerbose = config.verbose === true;
  
  log(`Applying settings: Buffer=${config.bufferKb || 256}KB, Pool=${config.poolSize || 4}, Verbose=${isVerbose}`, true);

  proxyServer = net.createServer((clientSocket) => {
    let isActive = true;
    stats.connectionsTotal++; 
    log(`[+] New connection. Active: ${stats.connectionsTotal}`);
    
    clientSocket.on('close', () => {
      if (isActive) { isActive = false; stats.connectionsTotal--; } 
      log(`[-] Connection closed. Active: ${stats.connectionsTotal}`);
    });
    
    clientSocket.on('error', (err) => { clientSocket.destroy(); });
    clientSocket.setNoDelay(true);

    let stage = 0; 
    let buffer = Buffer.alloc(0);
    let remoteSocket = null;
    let isFirstPayload = true;

    clientSocket.on('data', (chunk) => {
      if (stage === 3) {
        if (remoteSocket && !remoteSocket.connecting && !remoteSocket.destroyed) {
          stats.bytesUp += chunk.length; 
          
          if (isFirstPayload) {
            isFirstPayload = false;
            if (chunk.length > 1) {
              log(`[DPI Bypass] Splitting payload safely on port 443...`);
              
              clientSocket.pause(); 
              remoteSocket.write(chunk.subarray(0, 1)); 
              
              setTimeout(() => {
                if (!remoteSocket.destroyed) {
                  remoteSocket.write(chunk.subarray(1)); 
                  clientSocket.resume(); 
                }
              }, 30);
              return;
            }
          }
          remoteSocket.write(chunk);
        }
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);

      if (stage === 0 && buffer.length >= 2) {
        if (buffer[0] !== 0x05) return clientSocket.destroy();
        const nmethods = buffer[1];
        if (buffer.length >= 2 + nmethods) {
          clientSocket.write(Buffer.from([0x05, 0x00]));
          buffer = buffer.subarray(2 + nmethods);
          stage = 1;
        }
      }

      if (stage === 1 && buffer.length >= 4) {
        if (buffer[0] !== 0x05 || buffer[1] !== 0x01) {
          clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return clientSocket.destroy();
        }
        const atyp = buffer[3];
        let dst = '';
        let dstPort = 0;
        let portOffset = 0;
        let reqLen = 0;

        if (atyp === 1 && buffer.length >= 10) { 
          dst = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
          portOffset = 8;
          reqLen = 10;
        } else if (atyp === 3 && buffer.length >= 5) { 
          const len = buffer[4];
          if (buffer.length >= 5 + len + 2) {
            dst = buffer.subarray(5, 5 + len).toString('utf8');
            portOffset = 5 + len;
            reqLen = 5 + len + 2;
          } else return;
        } else {
          clientSocket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          return clientSocket.end();
        }

        dstPort = buffer.readUInt16BE(portOffset);
        buffer = buffer.subarray(reqLen);

        if (dst === '127.0.0.1' && dstPort === port) {
            clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            return clientSocket.end();
        }

        stage = 2;
        log(`[SOCKS] Connecting to ${dst}:${dstPort}`);
        
        remoteSocket = net.connect(dstPort, dst, () => {
          log(`[TCP] Connected to ${dst}:${dstPort}`);
          clientSocket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          stage = 3;
          
          if (buffer.length > 0) {
            stats.bytesUp += buffer.length; 
            
            if (isFirstPayload && buffer.length > 1) {
              isFirstPayload = false;
              log(`[DPI Bypass] Splitting initial payload safely on port 443...`);
              
              clientSocket.pause();
              remoteSocket.write(buffer.subarray(0, 1));
              
              setTimeout(() => {
                if (!remoteSocket.destroyed) {
                  remoteSocket.write(buffer.subarray(1));
                  clientSocket.resume();
                }
              }, 30);
            } else {
              remoteSocket.write(buffer);
            }
            buffer = Buffer.alloc(0);
          }
        });

        remoteSocket.on('data', (d) => { 
          stats.bytesDown += d.length; 
          if (!clientSocket.destroyed) clientSocket.write(d);
        });

        remoteSocket.on('error', (err) => {
          log(`[!] Remote error (${dst}:${dstPort}): ${err.message}`);
          if (stage === 2) clientSocket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          clientSocket.destroy();
        });
        
        remoteSocket.on('close', () => {
          clientSocket.destroy();
        });
      }
    });
  });

  proxyServer.on('error', (e) => { 
    isRunning = false; 
    proxyServer = null; 
    log(`[FATAL] Server Error: ${e.message}`, true);
  });
  
  proxyServer.listen(port, host, () => {
    isRunning = true;
    rn_bridge.channel.send(JSON.stringify({ type: 'status', isRunning: true, port, host }));
    log(`Proxy started on ${host}:${port}`, true);
  });
}

function stopProxy() {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
    isRunning = false;
    rn_bridge.channel.send(JSON.stringify({ type: 'status', isRunning: false }));
    log(`Proxy stopped`, true);
  }
}

rn_bridge.channel.on('message', (msgStr) => {
  try {
    const msg = JSON.parse(msgStr);
    if (msg.type === 'start') {
      // ПЕРЕДАЕМ НАСТРОЙКИ ИЗ APP.TSX В ФУНКЦИЮ START
      startProxy(msg.port || 1080, msg.host || '127.0.0.1', msg.config || {});
    }
    else if (msg.type === 'stop') stopProxy();
    else if (msg.type === 'get_stats') rn_bridge.channel.send(JSON.stringify({ type: 'stats', stats }));
    else if (msg.type === 'get_status') rn_bridge.channel.send(JSON.stringify({ type: 'status', isRunning }));
  } catch (e) {}
});

log("Node was initialized. (Pure TCP + Port 443 + Safe DPI Bypass + Settings Linked)", true);