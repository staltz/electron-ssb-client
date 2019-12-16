const pull = require('pull-stream');
const {ipcRenderer} = require('electron');
const MultiServer = require('multiserver');
const electronIpcPlugin = require('multiserver-electron-ipc');
const muxrpc = require('muxrpc');

export type Callback<T> = (err: any, value?: T) => void;

export interface SSBClient {
  (cb: Callback<any>): void;
  use(plugin: any): SSBClient;
  callPromise(): Promise<any>;
}

export type Keys = {
  id: string;
  public: string;
  private: string;
};

// Forked from multiserver/plugins/noauth because client-side we don't need
// to pass the public key to this plugin, only server-side we need to
function noAuthPlugin() {
  return {
    name: 'noauth',
    create() {
      return (stream: any, cb: any) => {
        cb(null, {
          remote: '',
          auth: {allow: null, deny: null},
          source: stream.source,
          sink: stream.sink,
          address: 'noauth',
        });
      };
    },
    parse(str: string) {
      if (str === 'noauth') return {};
      else return undefined;
    },
    stringify() {
      return 'noauth';
    },
  };
}

function objMapDeep(origin: any, transform: (s: string) => string): any {
  return Object.keys(origin).reduce((acc, key) => {
    if (typeof origin[key] === 'object') {
      acc[key] = objMapDeep(origin[key], transform);
    } else {
      acc[key] = transform(origin[key]);
    }
    return acc;
  }, {} as any);
}

function syncToAsync(str: string): string {
  return str === 'sync' ? 'async' : str;
}

function applyPlugins<T = any>(client: T, plugins: Array<any>): T {
  for (const plugin of plugins) {
    (client as any)[plugin.name] = plugin.init(client);
  }
  return client;
}

function hackId(client: any, cb: Callback<any>) {
  client.whoami((err: any, val: any) => {
    if (err) return cb(err);

    client.id = val.id;
    cb(null, client);
  });
}

function promisifyAsyncApi(fn: any) {
  return function(...args: Array<any>): Promise<any> | void {
    if (args.length === 0 || typeof args[args.length - 1] !== 'function') {
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, val: any) => {
          if (err) reject(err);
          else resolve(val);
        });
      });
    } else {
      fn(...args);
    }
  };
}

function asyncIterifySourceApi(fn: any) {
  return function(...args: Array<any>): AsyncIterable<any> | void {
    const readable = fn(...args);
    readable[Symbol.asyncIterator] = () => {
      return {
        next: () => {
          return new Promise((resolve, reject) => {
            readable(null, function(errOrEnd: any, value: any) {
              if (errOrEnd === true) resolve({done: true});
              else if (errOrEnd) reject(errOrEnd);
              else {
                resolve({done: false, value});
              }
            });
          });
        },
      };
    };
    return readable;
  };
}

function augmentApis(api: any, manifest: any) {
  for (let name of Object.keys(manifest)) {
    const value = manifest[name];
    if (typeof value === 'string') {
      if (typeof api[name] !== 'function') continue;
      if (value === 'async') api[name] = promisifyAsyncApi(api[name]);
      else if (value === 'source') api[name] = asyncIterifySourceApi(api[name]);
    } else if (typeof value === 'object') {
      for (let nameNested of Object.keys(value)) {
        const valueNested = value[nameNested];
        if (typeof valueNested !== 'string') continue;
        if (typeof api[name][nameNested] !== 'function') continue;
        if (valueNested === 'async') {
          api[name][nameNested] = promisifyAsyncApi(api[name][nameNested]);
        } else if (valueNested === 'source') {
          api[name][nameNested] = asyncIterifySourceApi(api[name][nameNested]);
        }
      }
    }
  }
  return api;
}

export default function ssbClient(manifest: any): SSBClient {
  const manifestOk = objMapDeep(manifest, syncToAsync);

  const plugins: Array<any> = [];

  function builder(cb: Callback<any>) {
    const ms = MultiServer([
      [electronIpcPlugin({ipcRenderer}), noAuthPlugin()],
    ]);

    const address = 'channel~noauth';

    ms.client(address, (err: any, stream: any) => {
      if (err) return cb(err);

      const client = augmentApis(
        applyPlugins(muxrpc(manifestOk, null)(), plugins),
        manifestOk,
      );
      pull(stream, client.createStream(), stream);
      hackId(client, cb);
    });
  }

  builder.use = function use(plugin: any) {
    plugins.push(plugin);
    return builder;
  };

  builder.callPromise = function callPromise() {
    return new Promise<any>((resolve, reject) => {
      builder((err: any, val: any) => {
        if (err) reject(err);
        else resolve(val);
      });
    });
  };

  return builder;
}
