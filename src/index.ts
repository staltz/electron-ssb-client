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
  return Object.keys(origin).reduce(
    (acc, key) => {
      if (typeof origin[key] === 'object') {
        acc[key] = objMapDeep(origin[key], transform);
      } else {
        acc[key] = transform(origin[key]);
      }
      return acc;
    },
    {} as any,
  );
}

function pipe(first: any, ...cbs: Array<(x: any) => any>) {
  let res = first;
  for (let i = 0, n = cbs.length; i < n; i++) res = cbs[i](res);
  return res;
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

function hackId<T = any>(client: T): T {
  (client as any).whoami((err: any, val: any) => {
    if (err) console.error(err);
    else {
      (client as any).id = val.id;
    }
  });
  return client;
}

export default function ssbClient(manifest: any): SSBClient {
  const sanitizedManifest = objMapDeep(manifest, syncToAsync);

  const plugins: Array<any> = [];

  function builder(cb: Callback<any>) {
    const ms = MultiServer([
      [electronIpcPlugin({ipcRenderer}), noAuthPlugin()],
    ]);

    const address = 'channel~noauth';

    ms.client(address, (err: any, stream: any) => {
      if (err) {
        cb(err);
      } else {
        const client = pipe(
          muxrpc(sanitizedManifest, null)(),
          c => hackId(c),
          c => applyPlugins(c, plugins),
        );
        pull(stream, client.createStream(), stream);
        cb(null, client);
      }
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
