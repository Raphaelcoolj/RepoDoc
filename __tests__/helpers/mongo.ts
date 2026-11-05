import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';

jest.setTimeout(30_000);

let proc: ChildProcess | null = null;
let dbPath = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`mongod did not listen on port ${port} in time`));
        } else {
          setTimeout(attempt, 50);
        }
      });
    };
    attempt();
  });
}

function waitForExit(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mongooseCache(): { conn: unknown; promise: unknown } {
  const cache =
    (global as { _mongooseCache?: { conn: unknown; promise: unknown } })
      ._mongooseCache ?? { conn: null, promise: null };
  (global as { _mongooseCache?: unknown })._mongooseCache = cache;
  return cache;
}

function resetConnectDbCache(): void {
  const cache = mongooseCache();
  cache.conn = null;
  cache.promise = null;
}

export async function startMongo(): Promise<string> {
  const port = await freePort();
  dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gramdoc-mongo-'));

  proc = spawn(
    'mongod',
    [
      '--dbpath',
      dbPath,
      '--port',
      String(port),
      '--bind_ip',
      '127.0.0.1',
      '--quiet',
    ],
    { stdio: 'ignore' }
  );

  const startupFailure = new Promise<never>((_, reject) => {
    proc?.once('error', (err) =>
      reject(new Error(`failed to start mongod: ${err.message}`))
    );
    proc?.once('exit', (code, signal) =>
      reject(
        new Error(
          `mongod exited during startup (code=${code} signal=${signal})`
        )
      )
    );
  });
  const ready = waitForPort(port);
  await Promise.race([ready, startupFailure]);

  const uri = `mongodb://127.0.0.1:${port}/gramdoc-tests`;
  process.env.MONGODB_URI = uri;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  resetConnectDbCache();
  await mongoose.connect(uri);
  // Satisfy connectDB's module-level cache so route handlers reuse this connection.
  mongooseCache().conn = mongoose;
  mongooseCache().promise = null;
  return uri;
}

export async function stopMongo(): Promise<void> {
  try {
    await mongoose.disconnect();
  } finally {
    resetConnectDbCache();
    if (proc) {
      await waitForExit(proc);
      proc = null;
    }
    if (dbPath) {
      fs.rmSync(dbPath, { recursive: true, force: true });
      dbPath = '';
    }
  }
}

export async function clearDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
}
